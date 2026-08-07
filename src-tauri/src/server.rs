use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tiny_http::{Header, Request, Response, Server, StatusCode};

const PORT: u16 = 8788;
const CODE_CHARS: &[char] = &[
    'A','B','C','D','E','F','G','H','J','K','M','N','P','Q','R','S','T','U','V','W','X','Y','Z',
    '2','3','4','5','6','7','8','9',
];

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Room {
    pub state: Option<State>,
    pub picks: [Option<Pick>; 2],
    pub t: f64,
    pub data: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct State {
    pub seq: u64,
    pub turn: u32,
    pub actor: u8,
    pub winner: Option<u8>,
    pub phase: String,
    pub defs: serde_json::Value,
    pub p: Vec<PlayerState>,
    pub log: Vec<String>,
    pub play: Option<PlayEvent>,
    pub fd: Option<ForceDiscardEvent>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlayerState {
    pub hp: u32,
    pub def: i32,
    pub energy: u32,
    pub buffs: Vec<Buff>,
    pub draw_count: u32,
    pub hand_count: u32,
    pub discard: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Buff {
    #[serde(rename = "type")]
    pub btype: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlayEvent {
    pub seq: u64,
    pub pi: u8,
    pub card: serde_json::Value,
    pub events: Vec<EventFx>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EventFx {
    pub target: u8,
    pub fx: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ForceDiscardEvent {
    pub seq: u64,
    pub side: u8,
    pub count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Pick {
    pub role: serde_json::Value,
    pub cards: Vec<serde_json::Value>,
}

pub struct ServerState {
    pub rooms: Arc<Mutex<HashMap<String, Room>>>,
    pub last_pk: Arc<Mutex<HashMap<String, String>>>,
    pub log_path: String,
}

impl ServerState {
    pub fn new() -> Self {
        Self {
            rooms: Arc::new(Mutex::new(HashMap::new())),
            last_pk: Arc::new(Mutex::new(HashMap::new())),
            log_path: "server.log".to_string(),
        }
    }

    pub fn start(self: Arc<Self>) {
        let server = match Server::http(("0.0.0.0", PORT)) {
            Ok(s) => s,
            Err(e) => {
                eprintln!("Failed to start server on port {}: {}", PORT, e);
                return;
            }
        };
        println!("LAN server started on http://0.0.0.0:{}", PORT);

        // Cleanup thread
        let cleanup_rooms = self.rooms.clone();
        thread::spawn(move || {
            loop {
                thread::sleep(std::time::Duration::from_secs(300));
                let now = SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap()
                    .as_secs_f64();
                let mut rooms = cleanup_rooms.lock().unwrap();
                rooms.retain(|_, r| now - r.t <= 7200.0);
            }
        });

        for request in server.incoming_requests() {
            self.handle_request(request);
        }
    }

    fn handle_request(&self, request: Request) {
        let url = request.url().to_string();
        let method = request.method().to_string();
        let path = url.split('?').next().unwrap_or("");
        let query = if url.contains('?') {
            url.split_at(url.find('?').unwrap() + 1).1
        } else {
            ""
        };

        if method == "OPTIONS" {
            self.respond_json(request, 204, &serde_json::json!({}));
            return;
        }

        match path {
            "/" | "/index.html" => {
                self.serve_file(request, "/index.html", "text/html; charset=utf-8");
            }
            "/manifest.json" => {
                self.serve_file(request, "/manifest.json", "application/manifest+json");
            }
            "/sw.js" => {
                self.serve_file(request, "/sw.js", "application/javascript");
            }
            "/icon-192.png" => {
                self.serve_file(request, "/icon-192.png", "image/png");
            }
            "/icon-512.png" => {
                self.serve_file(request, "/icon-512.png", "image/png");
            }
            "/create" => self.handle_create(request),
            "/join" => self.handle_join(request, query),
            "/rooms" => self.handle_rooms(request),
            "/state" => {
                if method == "GET" {
                    self.handle_get_state(request, query);
                } else {
                    self.handle_post_state(request);
                }
            }
            "/hostdata" => {
                if method == "GET" {
                    self.handle_get_hostdata(request, query);
                } else {
                    self.handle_post_hostdata(request);
                }
            }
            "/ping" => self.handle_ping(request),
            "/pick" => self.handle_pick(request),
            "/leave" => self.handle_leave(request),
            _ => {
                self.respond_json(request, 404, &serde_json::json!({"ok": false}));
            }
        }
    }

    fn serve_file(&self, request: Request, path: &str, content_type: &str) {
        let content: Vec<u8> = match path {
            "/index.html" => include_bytes!("../../app/index.html").to_vec(),
            "/manifest.json" => include_bytes!("../../app/manifest.json").to_vec(),
            "/sw.js" => include_bytes!("../../app/sw.js").to_vec(),
            "/icon-192.png" => include_bytes!("../../app/icon-192.png").to_vec(),
            "/icon-512.png" => include_bytes!("../../app/icon-512.png").to_vec(),
            _ => Vec::new(),
        };

        let mut content = content;

        // Replace placeholders in index.html with LAN IPs
        if path == "/index.html" {
            let ips = crate::net::local_ips();
            let ip = crate::net::lan_ip();
            let ip_list = serde_json::to_string(&ips).unwrap_or_else(|_| "[]".to_string());
            let html = String::from_utf8_lossy(&content);
            let modified = html
                .replace("const __IP_LIST__ = [];", &format!("const __IP_LIST__ = {};", ip_list))
                .replace("const __PHONE_IP__ = \"\";", &format!("const __PHONE_IP__ = \"{}\";", ip));
            content = modified.into_bytes();
        }

        let headers = vec![
            Header::from_bytes(&b"Content-Type"[..], content_type.as_bytes()).unwrap(),
            Header::from_bytes(&b"Cache-Control"[..], &b"no-store, no-cache, must-revalidate"[..]).unwrap(),
            Header::from_bytes(&b"Access-Control-Allow-Origin"[..], &b"*"[..]).unwrap(),
        ];

        let _ = request.respond(Response::new(
            StatusCode(200),
            headers,
            Box::new(std::io::Cursor::new(content)) as Box<dyn std::io::Read + Send>,
            None,
            None,
        ));
    }

    fn gen_code() -> String {
        use rand::Rng;
        let mut rng = rand::thread_rng();
        (0..5)
            .map(|_| CODE_CHARS[rng.gen_range(0..CODE_CHARS.len())])
            .collect()
    }

    fn respond_json(&self, request: Request, status: u16, body: &serde_json::Value) {
        let resp_str = body.to_string();
        let headers = vec![
            Header::from_bytes(&b"Content-Type"[..], b"application/json; charset=utf-8").unwrap(),
            Header::from_bytes(&b"Access-Control-Allow-Origin"[..], b"*").unwrap(),
            Header::from_bytes(&b"Access-Control-Allow-Methods"[..], b"GET, POST, OPTIONS").unwrap(),
            Header::from_bytes(&b"Access-Control-Allow-Headers"[..], b"Content-Type").unwrap(),
        ];
        let _ = request.respond(Response::new(
            StatusCode(status),
            headers,
            Box::new(std::io::Cursor::new(resp_str.into_bytes())) as Box<dyn std::io::Read + Send>,
            None,
            None,
        ));
    }

    fn handle_create(&self, request: Request) {
        let room = Self::gen_code();
        let room_clone = room.clone();
        {
            let mut rooms = self.rooms.lock().unwrap();
            rooms.insert(room_clone.clone(), Room {
                state: None,
                picks: [None, None],
                t: SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs_f64(),
                data: None,
            });
        }
        self.slog(&format!("CREATE room={}", room_clone));
        self.respond_json(request, 200, &serde_json::json!({"ok": true, "room": room_clone}));
    }

    fn handle_join(&self, request: Request, query: &str) {
        let room = Self::extract_param(query, "room").to_uppercase();
        if room.is_empty() {
            self.respond_json(request, 400, &serde_json::json!({"ok": false, "err": "room required"}));
            return;
        }

        {
            let mut rooms = self.rooms.lock().unwrap();
            if let Some(r) = rooms.get_mut(&room) {
                r.t = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs_f64();
            }
        }
        self.slog(&format!("JOIN room={}", room));
        self.respond_json(request, 200, &serde_json::json!({"ok": true}));
    }

    fn handle_rooms(&self, request: Request) {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs_f64();

        let rooms = self.rooms.lock().unwrap();
        let room_list: Vec<serde_json::Value> = rooms.iter()
            .filter(|(_, r)| now - r.t <= 3600.0)
            .map(|(code, r)| {
                let picks = r.picks.iter().filter(|x| x.is_some()).count();
                serde_json::json!({
                    "room": code,
                    "picks": picks,
                    "playing": r.state.is_some()
                })
            })
            .collect();

        self.respond_json(request, 200, &serde_json::json!({"ok": true, "rooms": room_list}));
    }

    fn handle_get_state(&self, request: Request, query: &str) {
        let room = Self::extract_param(query, "room").to_uppercase();
        if room.is_empty() {
            self.respond_json(request, 400, &serde_json::json!({"ok": false, "err": "room required"}));
            return;
        }

        {
            let rooms = self.rooms.lock().unwrap();
            if let Some(r) = rooms.get(&room) {
                if let Some(state) = &r.state {
                    let pk = serde_json::to_string(&r.picks).unwrap_or_default();
                    let mut last_pk = self.last_pk.lock().unwrap();
                    if last_pk.get(&room) != Some(&pk) {
                        last_pk.insert(room.clone(), pk.clone());
                        self.slog(&format!("STATE room={} picks={}", room, &pk[..120.min(pk.len())]));
                    }
                    self.respond_json(request, 200, &serde_json::json!({
                        "ok": true,
                        "state": state,
                        "picks": r.picks
                    }));
                    return;
                }
            }
        }
        self.respond_json(request, 404, &serde_json::json!({"ok": false, "err": "room not found"}));
    }

    fn handle_post_state(&self, mut request: Request) {
        let body = Self::read_body(&mut request);
        let data: serde_json::Value = match serde_json::from_str(&body) {
            Ok(d) => d,
            Err(_) => {
                self.respond_json(request, 400, &serde_json::json!({"ok": false, "err": "bad json"}));
                return;
            }
        };

        let room = data.get("room").and_then(|v| v.as_str()).unwrap_or("").to_uppercase();
        let state: State = match data.get("state").and_then(|v| serde_json::from_value(v.clone()).ok()) {
            Some(s) => s,
            None => {
                self.respond_json(request, 400, &serde_json::json!({"ok": false, "err": "missing state"}));
                return;
            }
        };

        {
            let mut rooms = self.rooms.lock().unwrap();
            let r = match rooms.get_mut(&room) {
                Some(r) => r,
                None => {
                    self.respond_json(request, 404, &serde_json::json!({"ok": false, "err": "room not found"}));
                    return;
                }
            };

            // Check seq conflict
            if let Some(current) = &r.state {
                if current.seq >= state.seq {
                    self.respond_json(request, 409, &serde_json::json!({"ok": false, "err": "回合冲突，状态已过期"}));
                    return;
                }
            }

            r.state = Some(state);
            r.t = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs_f64();
        }
        self.respond_json(request, 200, &serde_json::json!({"ok": true}));
    }

    fn handle_pick(&self, mut request: Request) {
        let body = Self::read_body(&mut request);
        let data: serde_json::Value = match serde_json::from_str(&body) {
            Ok(d) => d,
            Err(_) => {
                self.respond_json(request, 400, &serde_json::json!({"ok": false, "err": "bad json"}));
                return;
            }
        };

        let room = data.get("room").and_then(|v| v.as_str()).unwrap_or("").to_uppercase();
        let side: u8 = data.get("side").and_then(|v| v.as_u64()).unwrap_or(255) as u8;

        if side > 1 {
            self.respond_json(request, 400, &serde_json::json!({"ok": false, "err": "side invalid"}));
            return;
        }

        let role = data.get("role").cloned();
        let cards = data.get("cards").cloned().unwrap_or(serde_json::Value::Array(vec![]));
        let pick = Pick {
            role: role.unwrap_or_default(),
            cards: match cards {
                serde_json::Value::Array(arr) => arr,
                _ => Vec::new(),
            },
        };
        let room_clone = room.clone();
        {
            let mut rooms = self.rooms.lock().unwrap();
            if let Some(r) = rooms.get_mut(&room_clone) {
                r.picks[side as usize] = Some(pick);
                r.t = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs_f64();
            }
        }
        self.slog(&format!("PICK room={} side={}", room_clone, side));
        self.respond_json(request, 200, &serde_json::json!({"ok": true}));
    }

    fn handle_get_hostdata(&self, request: Request, query: &str) {
        let room = Self::extract_param(query, "room").to_uppercase();
        if room.is_empty() {
            self.respond_json(request, 400, &serde_json::json!({"ok": false}));
            return;
        }

        let rooms = self.rooms.lock().unwrap();
        let data = rooms.get(&room).and_then(|r| r.data.clone());
        self.slog(&format!("HOSTDATA_GET room={} has={}", room, data.is_some()));
        self.respond_json(request, 200, &serde_json::json!({"ok": true, "data": data}));
    }

    fn handle_post_hostdata(&self, mut request: Request) {
        let body = Self::read_body(&mut request);
        let data: serde_json::Value = match serde_json::from_str(&body) {
            Ok(d) => d,
            Err(_) => {
                self.respond_json(request, 400, &serde_json::json!({"ok": false, "err": "bad json"}));
                return;
            }
        };

        let room = data.get("room").and_then(|v| v.as_str()).unwrap_or("").to_uppercase();
        let room_clone = room.clone();
        let host_data = data.get("data").cloned();
        {
            let mut rooms = self.rooms.lock().unwrap();
            if let Some(r) = rooms.get_mut(&room_clone) {
                r.data = host_data;
                r.t = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs_f64();
            }
        }
        self.slog(&format!("HOSTDATA_SET room={}", room_clone));
        self.respond_json(request, 200, &serde_json::json!({"ok": true}));
    }

    fn handle_ping(&self, request: Request) {
        self.respond_json(request, 200, &serde_json::json!({"ok": true}));
    }

    fn handle_leave(&self, mut request: Request) {
        let body = Self::read_body(&mut request);
        let data: serde_json::Value = match serde_json::from_str(&body) {
            Ok(d) => d,
            Err(_) => {
                self.respond_json(request, 400, &serde_json::json!({"ok": false, "err": "bad json"}));
                return;
            }
        };

        let room = data.get("room").and_then(|v| v.as_str()).unwrap_or("").to_uppercase();
        let side: u8 = data.get("side").and_then(|v| v.as_u64()).unwrap_or(0) as u8;
        let room_clone = room.clone();

        {
            let mut rooms = self.rooms.lock().unwrap();
            if side == 0 || side == 255 {
                rooms.remove(&room_clone);
            } else {
                if let Some(r) = rooms.get_mut(&room_clone) {
                    r.picks[side as usize] = None;
                }
            }
        }
        self.slog(&format!("LEAVE room={} side={}", room_clone, side));
        self.respond_json(request, 200, &serde_json::json!({"ok": true}));
    }

    fn read_body(request: &mut Request) -> String {
        let content_length: usize = request
            .headers()
            .iter()
            .find(|h| h.field.as_str() == "Content-Length")
            .and_then(|h| h.value.to_string().parse().ok())
            .unwrap_or(0);
        let reader = request.as_reader();
        let mut buf = Vec::new();
        let _ = reader.take(content_length as u64).read_to_end(&mut buf);
        String::from_utf8_lossy(&buf).to_string()
    }

    fn extract_param<'a>(query: &'a str, key: &str) -> &'a str {
        for pair in query.split('&') {
            let mut kv = pair.splitn(2, '=');
            if kv.next() == Some(key) {
                return kv.next().unwrap_or("");
            }
        }
        ""
    }

    fn slog(&self, msg: &str) {
        if let Ok(ts) = SystemTime::now().duration_since(UNIX_EPOCH) {
            let secs = ts.as_secs();
            let h = (secs / 3600) % 24;
            let m = (secs % 3600) / 60;
            let s = secs % 60;
            let time_str = format!("{:02}:{:02}:{:02}", h, m, s);
            let log_line = format!("[{}] {}\n", time_str, msg);
            if let Ok(mut f) = std::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(&self.log_path)
            {
                let _ = f.write_all(log_line.as_bytes());
            }
        }
    }
}
