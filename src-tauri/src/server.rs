use std::collections::HashMap;
use std::fs::{self, File, OpenOptions};
use std::io::{BufReader, Read, Write};
use std::net::UdpSocket;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use flate2::write::GzEncoder;
use flate2::Compression;
use serde::{Deserialize, Serialize};
use tiny_http::{Header, Request, Response, Server, StatusCode};

/// Web 启动模式（--server）：静态文件只从磁盘读，支持热重载；
/// 桌面模式默认 false：只用 exe 内嵌副本，不碰磁盘。
static DISK_MODE: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

#[allow(dead_code)]
pub fn set_disk_mode(on: bool) {
    DISK_MODE.store(on, std::sync::atomic::Ordering::Relaxed);
}

fn is_disk_mode() -> bool {
    DISK_MODE.load(std::sync::atomic::Ordering::Relaxed)
}

/// 前端静态文件根目录（仅 web 模式使用）。启动后自动定位一次。
static WEB_ROOT: std::sync::OnceLock<Option<PathBuf>> = std::sync::OnceLock::new();

fn web_root() -> Option<&'static PathBuf> {
    WEB_ROOT
        .get_or_init(|| {
            let mut candidates: Vec<PathBuf> = Vec::new();
            if let Ok(exe) = std::env::current_exe() {
                if let Some(dir) = exe.parent() {
                    candidates.push(dir.join("..").join("..").join("app"));
                    candidates.push(dir.join("..").join("..").join("..").join("app"));
                    candidates.push(dir.join("app"));
                }
            }
            if let Ok(cwd) = std::env::current_dir() {
                candidates.push(cwd.join("app"));
            }
            for c in candidates {
                if c.join("index.html").exists() {
                    return Some(c);
                }
            }
            None
        })
        .as_ref()
}

/// Windows 控制台默认 GBK，先切到 UTF-8，避免中文打印乱码
#[cfg(windows)]
fn set_utf8_console() {
    #[link(name = "kernel32")]
    extern "system" {
        fn SetConsoleOutputCP(cp: u32) -> i32;
    }
    unsafe {
        SetConsoleOutputCP(65001);
    }
}

/// 日志目录，不依赖 cwd —— 定锚到 app 目录的上级（即项目根）或 exe 位置。
fn log_dir() -> PathBuf {
    if let Some(root) = web_root() {
        root.parent().unwrap_or(&PathBuf::from(".")).join("logs")
    } else {
        PathBuf::from("logs")
    }
}

/// 日志系统：写入 logs/latest.log，旧日志自动归档为 YYYY-MM-DD-N.log.gz
fn init_logger() {
    let base = log_dir();
    let _ = fs::create_dir_all(&base);
    // 归档旧日志
    let latest = base.join("latest.log");
    if latest.exists() {
        let now = chrono_now();
        let mut n = 1;
        loop {
            let gz_name = base.join(format!("{}-{}.log.gz", now, n));
            if !gz_name.exists() {
                let tmp = base.join(format!("{}-{}.log", now, n));
                let _ = fs::rename(&latest, &tmp);
                // gzip
                if let Ok(src) = File::open(&tmp) {
                    if let Ok(dst) = File::create(&gz_name) {
                        let mut enc = GzEncoder::new(dst, Compression::default());
                        let mut buf = Vec::new();
                        if BufReader::new(src).read_to_end(&mut buf).is_ok() {
                            let _ = enc.write_all(&buf);
                            let _ = enc.finish();
                        }
                    }
                }
                let _ = fs::remove_file(&tmp);
                break;
            }
            n += 1;
        }
    }
    // 打开新日志文件
    if let Ok(file) = OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .open(base.join("latest.log"))
    {
        let _ = LOG_FILE.set(std::sync::Mutex::new(file));
    }
}

fn chrono_now() -> String {
    let d = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    let secs = d.as_secs();
    let days = secs / 86400;
    let time = secs % 86400;
    let y = 1970 + (days as f64 / 365.25) as u64;
    let remain = days - ((y - 1970) as f64 * 365.25) as u64;
    let is_leap = (y % 4 == 0 && y % 100 != 0) || y % 400 == 0;
    let days_in_month = [31, if is_leap { 29 } else { 28 }, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    let mut m = 0;
    let mut d_rem = remain;
    while d_rem >= days_in_month[m] { d_rem -= days_in_month[m]; m += 1; }
    let h = time / 3600;
    let mi = (time % 3600) / 60;
    let s = time % 60;
    format!("{:04}-{:02}-{:02}-{:02}{:02}{:02}", y, m + 1, d_rem + 1, h, mi, s)
}

static LOG_FILE: std::sync::OnceLock<std::sync::Mutex<std::fs::File>> = std::sync::OnceLock::new();

/// 写入日志（同时输出到控制台和文件）
macro_rules! logln {
    ($($arg:tt)*) => {{
        let msg = format!($($arg)*);
        eprintln!("{}", msg);
        if let Some(file) = LOG_FILE.get() {
            let _ = writeln!(file.lock().unwrap(), "{}", msg);
        }
    }};
}

/// Start the LAN server in a background daemon thread (used by desktop & Android).
pub fn start_background_server() {
    let state: Arc<ServerState> = Arc::new(ServerState::default());
    let server_thread = std::thread::spawn(move || state.start());
    std::mem::forget(server_thread);
}

const PORT: u16 = 8788;
const DISCOVER_PORT: u16 = 8789;
const DISCOVER_MAGIC: &[u8] = b"CARD_DUEL_DISCOVER";
const DISCOVER_RESP: &[u8] = b"CARD_DUEL_HERE";
const CODE_CHARS: &[char] = &[
    'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'J', 'K', 'M', 'N', 'P', 'Q', 'R', 'S', 'T', 'U', 'V',
    'W', 'X', 'Y', 'Z', '2', '3', '4', '5', '6', '7', '8', '9',
];
const ROOM_TTL: Duration = Duration::from_secs(7200);
const LIST_TTL: Duration = Duration::from_secs(3600);

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Room {
    pub name: String,
    pub mods: bool,
    pub state: Option<State>,
    pub picks: [Option<Pick>; 4],
    pub teams: [Option<u8>; 4],
    pub ready: [bool; 4],
    pub capacity: u8,
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
    pub log: Vec<serde_json::Value>,
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
    pub subfaction: serde_json::Value,
    pub cards: Vec<serde_json::Value>,
    pub effects: Vec<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_human: Option<bool>,
}

pub struct ServerState {
    pub rooms: Arc<Mutex<HashMap<String, Room>>>,
    pub last_pk: Arc<Mutex<HashMap<String, String>>>,
    pub shared_mods: Arc<Mutex<HashMap<String, Vec<u8>>>>,
    pub games: Arc<Mutex<HashMap<String, crate::game::Battle>>>,
}

impl Default for ServerState {
    fn default() -> Self {
        Self {
            rooms: Arc::new(Mutex::new(HashMap::new())),
            last_pk: Arc::new(Mutex::new(HashMap::new())),
            shared_mods: Arc::new(Mutex::new(HashMap::new())),
            games: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

impl ServerState {
    pub fn start(self: Arc<Self>) {
        self.start_inner(None);
    }

    #[cfg(feature = "tls")]
    pub fn start_with_tls(self: Arc<Self>, cert_path: &str, key_path: &str) {
        self.start_inner(Some((cert_path.to_string(), key_path.to_string())));
    }

fn start_inner(self: Arc<Self>, tls: Option<(String, String)>) {
        #[cfg(windows)]
        set_utf8_console();
        init_logger();
        if is_disk_mode() && web_root().is_none() {
            logln!("警告：未找到 app/ 目录，网页静态文件将无法加载。请从项目目录运行。");
        }
        let server: Server = match tls {
            #[cfg(feature = "tls")]
            Some((cert, key)) => {
                let cert_pem = std::fs::read_to_string(&cert).unwrap_or_else(|e| {
                    logln!("读取证书文件失败 {}: {}", cert, e);
                    std::process::exit(1);
                });
                let key_pem = std::fs::read_to_string(&key).unwrap_or_else(|e| {
                    logln!("Failed to read key file {}: {}", key, e);
                    std::process::exit(1);
                });
                let mut builder = openssl::ssl::SslAcceptor::mozilla_intermediate_v5(
                    openssl::ssl::SslMethod::tls_server(),
                )
                .unwrap();
                builder
                    .set_private_key(
                        &openssl::pkey::PKey::private_key_from_pem(key_pem.as_bytes()).unwrap(),
                    )
                    .unwrap();
                builder
                    .set_certificate_chain_pem(cert_pem.as_bytes())
                    .unwrap();
                match Server::https(("0.0.0.0", PORT), builder.build()) {
                    Ok(s) => s,
                    Err(e) => {
                        logln!("端口 {} 启动 HTTPS 服务器失败: {}", PORT, e);
                        return;
                    }
                }
            },
            #[cfg(not(feature = "tls"))]
            Some(_) => {
                logln!("未启用 HTTPS 支持，请使用 --features tls 重新构建。");
                return;
            }
            None => match Server::http(("0.0.0.0", PORT)) {
                Ok(s) => s,
                Err(e) => {
                    logln!("端口 {} 启动服务器失败（可能被占用）: {}", PORT, e);
                    return;
                }
            },
        };
        let proto = if tls.is_some() { "https" } else { "http" };
        logln!("服务器已启动: {}://0.0.0.0:{}", proto, PORT);

        // Cleanup thread
        let cleanup_rooms = self.rooms.clone();
        thread::spawn(move || loop {
            thread::sleep(Duration::from_secs(300));
            let now = elapsed();
            let mut rooms = cleanup_rooms.lock().unwrap();
            rooms.retain(|_, r| now - r.t <= ROOM_TTL.as_secs_f64());
        });

        // UDP 局域网发现（仅当有房间时才响应）
        let discover_rooms = self.rooms.clone();
        thread::spawn(move || {
            if let Ok(sock) = UdpSocket::bind(("0.0.0.0", DISCOVER_PORT)) {
                let mut buf = [0u8; 256];
                loop {
                    if let Ok((len, src)) = sock.recv_from(&mut buf) {
                        if &buf[..len] == DISCOVER_MAGIC {
                            let has_rooms = discover_rooms.lock().map(|r| !r.is_empty()).unwrap_or(false);
                            if has_rooms {
                                let _ = sock.send_to(DISCOVER_RESP, src);
                            }
                        }
                    }
                }
            }
        });

        for request in server.incoming_requests() {
            self.handle_request(request);
        }
    }

    fn handle_request(&self, request: Request) {
        let url = request.url().to_string();
        let method = request.method().to_string();
        let (path, query) = match url.find('?') {
            Some(i) => (&url[..i], &url[i + 1..]),
            None => (&url[..], ""),
        };

        if method == "OPTIONS" {
            self.respond_json(request, 204, &serde_json::json!({}));
            return;
        }

        match path {
            "/" | "/index.html" => {
                self.serve_file(request, "/index.html", "text/html; charset=utf-8")
            }
            "/manifest.json" => {
                self.serve_file(request, "/manifest.json", "application/manifest+json")
            }
            "/icon-192.png" => self.serve_file(request, "/icon-192.png", "image/png"),
            "/icon-512.png" => self.serve_file(request, "/icon-512.png", "image/png"),
            "/css/style.css" => {
                self.serve_file(request, "/css/style.css", "text/css; charset=utf-8")
            }
            path if path.starts_with("/js/") && path.ends_with(".js") => {
                self.serve_file(request, path, "application/javascript; charset=utf-8")
            }
            path if path.starts_with("/js/") && path.ends_with(".wasm") => {
                self.serve_file(request, path, "application/wasm")
            }
            path if path.starts_with("/js/") && path.ends_with(".map") => {
                self.serve_file(request, path, "application/json")
            }
            path if path.starts_with("/mods/") => self.serve_disk_file(request, path),
            "/card_duel/assets/splash.txt" => {
                self.serve_file(request, "/splash.txt", "text/plain; charset=utf-8")
            }
            path if path.starts_with("/card_duel/") => self.serve_disk_file(request, path),
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
            "/discover" => self.handle_discover(request),
            "/pick" => self.handle_pick(request),
            "/team" => self.handle_team(request),
            "/ready" => self.handle_ready(request),
            "/leave" => self.handle_leave(request),
            "/api/mod/list" => self.handle_mod_list(request),
            "/api/mod/upload" => self.handle_mod_upload(request),
            "/api/mod/download" => self.handle_mod_download(request, query),
            "/api/game/list" => self.handle_game_list(request),
            "/api/game/new" => self.handle_game_new(request, query),
            path if path.starts_with("/api/game/") => self.handle_game_action(request, &path[10..], method.as_str(), query),
            _ => {
                if method == "GET" {
                    self.serve_file(request, "/index.html", "text/html; charset=utf-8")
                } else {
                    self.respond_json(
                        request,
                        404,
                        &serde_json::json!({"ok": false, "err": "not found"}),
                    )
                }
            }
        }
    }

    fn serve_file(&self, request: Request, path: &str, content_type: &str) {
        let content = match load_static(path) {
            Some(bytes) => bytes,
            None => {
                self.respond_json(
                    request,
                    404,
                    &serde_json::json!({"ok": false, "err": "not found"}),
                );
                return;
            }
        };

        // Replace placeholders in index.html with LAN IPs
        let content = if path == "/index.html" {
            let ips = crate::net::local_ips();
            let ip = crate::net::lan_ip();
            let ip_list = serde_json::to_string(&ips).unwrap_or_else(|_| "[]".to_string());
            let html = String::from_utf8_lossy(&content);
            html.replace(
                "const __IP_LIST__ = [];",
                &format!("const __IP_LIST__ = {};", ip_list),
            )
            .replace(
                "const __PHONE_IP__ = \"\";",
                &format!("const __PHONE_IP__ = \"{}\";", ip),
            )
            .replace("__VERSION__", env!("CARGO_PKG_VERSION"))
            .into_bytes()
        } else {
            content
        };

        let headers = vec![
            Header::from_bytes(&b"Content-Type"[..], content_type.as_bytes()).unwrap(),
            Header::from_bytes(
                &b"Cache-Control"[..],
                &b"no-store, no-cache, must-revalidate"[..],
            )
            .unwrap(),
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

    fn serve_disk_file(&self, request: Request, path: &str) {
        let rel = path.trim_start_matches('/');
        if rel.contains("..") {
            self.respond_json(
                request,
                404,
                &serde_json::json!({"ok": false, "err": "not found"}),
            );
            return;
        }
        let disk_path = match web_root() {
            Some(root) => root.join(rel),
            None => PathBuf::from("app").join(rel),
        };
        match std::fs::read(&disk_path) {
            Ok(content) => {
                let ext = path.rsplit('.').next().unwrap_or("");
                let ct = match ext {
                    "wasm" => "application/wasm",
                    "json" => "application/json",
                    "ogg" => "audio/ogg",
                    "png" => "image/png",
                    "js" => "application/javascript; charset=utf-8",
                    "css" => "text/css; charset=utf-8",
                    "html" => "text/html; charset=utf-8",
                    _ => "application/octet-stream",
                };
                let headers = vec![
                    Header::from_bytes(&b"Content-Type"[..], ct.as_bytes()).unwrap(),
                    Header::from_bytes(
                        &b"Cache-Control"[..],
                        &b"no-store, no-cache, must-revalidate"[..],
                    )
                    .unwrap(),
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
            Err(_) => {
                self.respond_json(
                    request,
                    404,
                    &serde_json::json!({"ok": false, "err": "not found"}),
                );
            }
        }
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
            Header::from_bytes(&b"Access-Control-Allow-Methods"[..], b"GET, POST, OPTIONS")
                .unwrap(),
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

    fn handle_create(&self, mut request: Request) {
        let (name, mods) = {
            let body = Self::read_body(&mut request);
            if body.is_empty() {
                ("卡牌对决".to_string(), true)
            } else {
                let data: serde_json::Value = serde_json::from_str(&body).unwrap_or_default();
                let n = data
                    .get("name")
                    .and_then(|v| v.as_str())
                    .unwrap_or("卡牌对决")
                    .to_string();
                let m = data.get("mods").and_then(|v| v.as_bool()).unwrap_or(true);
                (n, m)
            }
        };
        let room = Self::gen_code();
        {
            let mut rooms = self.rooms.lock().unwrap();
            rooms.insert(
                room.clone(),
                Room {
                    name,
                    mods,
                    state: None,
                    picks: [None, None, None, None],
                    teams: [None, None, None, None],
                    ready: [false, false, false, false],
                    capacity: 4,
                    t: elapsed(),
                    data: None,
                },
            );
        }
        self.slog(&format!("CREATE room={}", room));
        self.respond_json(request, 200, &serde_json::json!({"ok": true, "room": room}));
    }

    fn handle_join(&self, request: Request, query: &str) {
        let room = Self::extract_param(query, "room").to_uppercase();
        if room.is_empty() {
            self.respond_json(
                request,
                400,
                &serde_json::json!({"ok": false, "err": "room required"}),
            );
            return;
        }
        {
            let mut rooms = self.rooms.lock().unwrap();
            if let Some(r) = rooms.get_mut(&room) {
                if r.state.is_some() {
                    self.respond_json(request, 400, &serde_json::json!({"ok": false, "err": "game already started"}));
                    return;
                }
                // Assign first empty seat
                let side = r.picks.iter().position(|p| p.is_none());
                match side {
                    Some(s) => {
                        r.t = elapsed();
                        self.slog(&format!("JOIN room={} side={}", room, s));
                        self.respond_json(request, 200, &serde_json::json!({"ok": true, "side": s}));
                    }
                    None => {
                        self.respond_json(request, 400, &serde_json::json!({"ok": false, "err": "room full"}));
                    }
                }
            } else {
                self.respond_json(request, 404, &serde_json::json!({"ok": false, "err": "room not found"}));
            }
        }
    }

    fn handle_rooms(&self, request: Request) {
        let now = elapsed();
        let rooms = self.rooms.lock().unwrap();
        let room_list: Vec<serde_json::Value> = rooms
            .iter()
            .filter(|(_, r)| now - r.t <= LIST_TTL.as_secs_f64())
            .map(|(code, r)| {
                let picks = r.picks.iter().filter(|x| x.is_some()).count();
                let ready_count = r.ready.iter().filter(|x| **x).count();
                serde_json::json!({
                    "room": code,
                    "name": r.name,
                    "mods": r.mods,
                    "picks": picks,
                    "capacity": r.capacity,
                    "ready": ready_count,
                    "playing": r.state.is_some()
                })
            })
            .collect();
        self.respond_json(
            request,
            200,
            &serde_json::json!({"ok": true, "rooms": room_list}),
        );
    }

    fn handle_get_state(&self, request: Request, query: &str) {
        let room = Self::extract_param(query, "room").to_uppercase();
        if room.is_empty() {
            self.respond_json(
                request,
                400,
                &serde_json::json!({"ok": false, "err": "room required"}),
            );
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
                        self.slog(&format!(
                            "STATE room={} picks={}",
                            room,
                            &pk[..120.min(pk.len())]
                        ));
                    }
                    self.respond_json(
                        request,
                        200,
                        &serde_json::json!({
                            "ok": true,
                            "state": state,
                            "picks": r.picks,
                            "teams": r.teams,
                            "ready": r.ready,
                            "capacity": r.capacity
                        }),
                    );
                    return;
                }
            }
        }
        self.respond_json(
            request,
            404,
            &serde_json::json!({"ok": false, "err": "room not found"}),
        );
    }

    fn handle_post_state(&self, mut request: Request) {
        let data: serde_json::Value = match serde_json::from_str(&Self::read_body(&mut request)) {
            Ok(d) => d,
            Err(_) => {
                self.respond_json(
                    request,
                    400,
                    &serde_json::json!({"ok": false, "err": "bad json"}),
                );
                return;
            }
        };

        let room = data
            .get("room")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_uppercase();
        let state: State = match data
            .get("state")
            .and_then(|v| serde_json::from_value(v.clone()).ok())
        {
            Some(s) => s,
            None => {
                self.respond_json(
                    request,
                    400,
                    &serde_json::json!({"ok": false, "err": "missing state"}),
                );
                return;
            }
        };

        {
            let mut rooms = self.rooms.lock().unwrap();
            let r = match rooms.get_mut(&room) {
                Some(r) => r,
                None => {
                    self.respond_json(
                        request,
                        404,
                        &serde_json::json!({"ok": false, "err": "room not found"}),
                    );
                    return;
                }
            };
            if let Some(current) = &r.state {
                if current.seq >= state.seq {
                    self.respond_json(
                        request,
                        409,
                        &serde_json::json!({"ok": false, "err": "回合冲突，状态已过期"}),
                    );
                    return;
                }
            }
            r.state = Some(state);
            r.t = elapsed();
        }
        self.respond_json(request, 200, &serde_json::json!({"ok": true}));
    }

    fn handle_pick(&self, mut request: Request) {
        let data: serde_json::Value = match serde_json::from_str(&Self::read_body(&mut request)) {
            Ok(d) => d,
            Err(_) => {
                self.respond_json(
                    request,
                    400,
                    &serde_json::json!({"ok": false, "err": "bad json"}),
                );
                return;
            }
        };

        let room = data
            .get("room")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_uppercase();
        let side: u8 = data.get("side").and_then(|v| v.as_u64()).unwrap_or(255) as u8;
        {
            let mut rooms = self.rooms.lock().unwrap();
            let r = match rooms.get_mut(&room) {
                Some(r) => r,
                None => {
                    self.respond_json(request, 404, &serde_json::json!({"ok": false, "err": "room not found"}));
                    return;
                }
            };
            if side >= r.capacity {
                self.respond_json(request, 400, &serde_json::json!({"ok": false, "err": "side invalid"}));
                return;
            }

            let cards = match data
                .get("cards")
                .cloned()
                .unwrap_or(serde_json::Value::Array(vec![]))
            {
                serde_json::Value::Array(arr) => arr,
                _ => Vec::new(),
            };
            let effects = match data
                .get("effects")
                .cloned()
                .unwrap_or(serde_json::Value::Array(vec![]))
            {
                serde_json::Value::Array(arr) => arr,
                _ => Vec::new(),
            };
            let pick = Pick {
                subfaction: data.get("subfaction").cloned().unwrap_or(data.get("role").cloned().unwrap_or_default()),
                cards,
                effects,
                is_human: data.get("is_human").and_then(|v| v.as_bool()),
            };
            r.picks[side as usize] = Some(pick);
            if let Some(team) = data.get("team").and_then(|v| v.as_u64()) {
                r.teams[side as usize] = Some(team as u8);
            }
            r.t = elapsed();
        }
        self.slog(&format!("PICK room={} side={}", room, side));
        self.respond_json(request, 200, &serde_json::json!({"ok": true}));
    }

    fn handle_team(&self, mut request: Request) {
        let data: serde_json::Value = match serde_json::from_str(&Self::read_body(&mut request)) {
            Ok(d) => d,
            Err(_) => {
                self.respond_json(request, 400, &serde_json::json!({"ok": false, "err": "bad json"}));
                return;
            }
        };
        let room = data.get("room").and_then(|v| v.as_str()).unwrap_or("").to_uppercase();
        let side = data.get("side").and_then(|v| v.as_u64()).unwrap_or(255) as u8;
        let team = data.get("team").and_then(|v| v.as_u64()).unwrap_or(0) as u8;
        {
            let mut rooms = self.rooms.lock().unwrap();
            if let Some(r) = rooms.get_mut(&room) {
                if side < r.capacity {
                    r.teams[side as usize] = Some(team);
                    r.t = elapsed();
                }
            }
        }
        self.respond_json(request, 200, &serde_json::json!({"ok": true}));
    }

    fn handle_ready(&self, mut request: Request) {
        let data: serde_json::Value = match serde_json::from_str(&Self::read_body(&mut request)) {
            Ok(d) => d,
            Err(_) => {
                self.respond_json(request, 400, &serde_json::json!({"ok": false, "err": "bad json"}));
                return;
            }
        };
        let room = data.get("room").and_then(|v| v.as_str()).unwrap_or("").to_uppercase();
        let side = data.get("side").and_then(|v| v.as_u64()).unwrap_or(255) as u8;
        let ready = data.get("ready").and_then(|v| v.as_bool()).unwrap_or(true);
        {
            let mut rooms = self.rooms.lock().unwrap();
            if let Some(r) = rooms.get_mut(&room) {
                if side < r.capacity {
                    r.ready[side as usize] = ready;
                    r.t = elapsed();
                }
            }
        }
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
        self.respond_json(request, 200, &serde_json::json!({"ok": true, "data": data}));
    }

    fn handle_post_hostdata(&self, mut request: Request) {
        let data: serde_json::Value = match serde_json::from_str(&Self::read_body(&mut request)) {
            Ok(d) => d,
            Err(_) => {
                self.respond_json(
                    request,
                    400,
                    &serde_json::json!({"ok": false, "err": "bad json"}),
                );
                return;
            }
        };

        let room = data
            .get("room")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_uppercase();
        let host_data = data.get("data").cloned();
        {
            let mut rooms = self.rooms.lock().unwrap();
            if let Some(r) = rooms.get_mut(&room) {
                r.data = host_data;
                r.t = elapsed();
            }
        }
        self.slog(&format!("HOSTDATA_SET room={}", room));
        self.respond_json(request, 200, &serde_json::json!({"ok": true}));
    }

    fn handle_ping(&self, request: Request) {
        self.respond_json(request, 200, &serde_json::json!({"ok": true}));
    }

    fn handle_discover(&self, request: Request) {
        let ips = std::sync::Mutex::new(Vec::new());
        if let Ok(sock) = UdpSocket::bind("0.0.0.0:0") {
            if sock.set_read_timeout(Some(Duration::from_secs(2))).is_ok() {
                let _ = sock.set_broadcast(true);
                let _ = sock.send_to(DISCOVER_MAGIC, ("255.255.255.255", DISCOVER_PORT));
                let mut buf = [0u8; 256];
                loop {
                    match sock.recv_from(&mut buf) {
                        Ok((len, src)) => {
                            if &buf[..len] == DISCOVER_RESP {
                                let mut list = ips.lock().unwrap();
                                if !list.contains(&src.ip().to_string()) {
                                    list.push(src.ip().to_string());
                                }
                            }
                        }
                        Err(_) => break,
                    }
                }
            }
        }
        let found = ips.lock().unwrap().clone();
        self.respond_json(request, 200, &serde_json::json!({"ok": true, "servers": found}));
    }

    fn handle_leave(&self, mut request: Request) {
        let data: serde_json::Value = match serde_json::from_str(&Self::read_body(&mut request)) {
            Ok(d) => d,
            Err(_) => {
                self.respond_json(
                    request,
                    400,
                    &serde_json::json!({"ok": false, "err": "bad json"}),
                );
                return;
            }
        };

        let room = data
            .get("room")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_uppercase();
        let side: u8 = data.get("side").and_then(|v| v.as_u64()).unwrap_or(0) as u8;
        {
            let mut rooms = self.rooms.lock().unwrap();
            if side == 0 || side == 255 {
                rooms.remove(&room);
            } else if let Some(r) = rooms.get_mut(&room) {
                r.picks[side as usize] = None;
            }
        }
        self.slog(&format!("LEAVE room={} side={}", room, side));
        self.respond_json(request, 200, &serde_json::json!({"ok": true}));
    }

    fn handle_mod_list(&self, mut request: Request) {
        let data: serde_json::Value = match serde_json::from_str(&Self::read_body(&mut request)) {
            Ok(d) => d,
            Err(_) => {
                self.respond_json(
                    request,
                    400,
                    &serde_json::json!({"ok": false, "err": "bad json"}),
                );
                return;
            }
        };
        let room = data
            .get("room")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_uppercase();
        let mods = data
            .get("mods")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();
        {
            let mut rooms = self.rooms.lock().unwrap();
            if let Some(r) = rooms.get_mut(&room) {
                r.data = Some(serde_json::json!({"mods": mods}));
            }
        }
        self.respond_json(request, 200, &serde_json::json!({"ok": true}));
    }

    fn handle_mod_upload(&self, mut request: Request) {
        let data: serde_json::Value = match serde_json::from_str(&Self::read_body(&mut request)) {
            Ok(d) => d,
            Err(_) => {
                self.respond_json(
                    request,
                    400,
                    &serde_json::json!({"ok": false, "err": "bad json"}),
                );
                return;
            }
        };
        let mod_id = data
            .get("mod_id")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let content = data.get("content").and_then(|v| v.as_str()).unwrap_or("");
        if mod_id.is_empty() || content.is_empty() {
            self.respond_json(
                request,
                400,
                &serde_json::json!({"ok": false, "err": "mod_id and content required"}),
            );
            return;
        }
        let bytes = content.as_bytes().to_vec();
        {
            let mut mods = self.shared_mods.lock().unwrap();
            mods.insert(mod_id.clone(), bytes);
        }
        self.slog(&format!("MOD_UPLOAD mod_id={}", mod_id));
        self.respond_json(request, 200, &serde_json::json!({"ok": true}));
    }

    fn handle_mod_download(&self, request: Request, query: &str) {
        let mod_id = Self::extract_param(query, "mod_id").to_string();
        let mods = self.shared_mods.lock().unwrap();
        if let Some(content) = mods.get(&mod_id) {
            let b64 = base64_encode(content);
            self.respond_json(
                request,
                200,
                &serde_json::json!({"ok": true, "content": b64}),
            );
        } else {
            self.respond_json(
                request,
                404,
                &serde_json::json!({"ok": false, "err": "mod not found"}),
            );
        }
    }

    fn handle_game_list(&self, request: Request) {
        let games = self.games.lock().unwrap();
        let info: Vec<serde_json::Value> = games.keys().map(|id| {
            serde_json::json!({"id": id})
        }).collect();
        self.respond_json(request, 200, &serde_json::json!({"ok": true, "games": info}));
    }

    fn handle_game_new(&self, request: Request, query: &str) {
        let app_dir = "app";
        let defs = match crate::game::load_defs(app_dir) {
            Ok(d) => d,
            Err(e) => { self.respond_json(request, 400, &serde_json::json!({"ok": false, "err": e})); return; }
        };
        let p0 = crate::game::get_subfaction_index(&defs, Self::extract_param(query, "p0"))
            .unwrap_or(0);
        let p1 = crate::game::get_subfaction_index(&defs, Self::extract_param(query, "p1"))
            .unwrap_or(if defs.subfactions.len() > 1 { 1 } else { 0 });
        let seed = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_nanos() as u64;
        let mut b = crate::game::new_battle("cpu", &defs, p0, p1, seed);
        crate::game::start_turn(&mut b);
        let id = format!("g{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_secs());
        self.games.lock().unwrap().insert(id.clone(), b);
        self.respond_json(request, 200, &serde_json::json!({"ok": true, "game_id": id}));
    }

    fn handle_game_action(&self, request: Request, path: &str, method: &str, query: &str) {
        let parts: Vec<&str> = path.splitn(2, '/').collect();
        if parts.len() < 2 {
            self.respond_json(request, 404, &serde_json::json!({"ok": false, "err": "not found"}));
            return;
        }
        let game_id = parts[0].to_string();
        let action = parts[1].to_string();

        if action == "act" && method != "POST" {
            self.respond_json(request, 405, &serde_json::json!({"ok": false, "err": "method not allowed"}));
            return;
        }

        let body = if action == "act" {
            let mut req = request;
            let b = Self::read_body(&mut req);
            let params: serde_json::Value = serde_json::from_str(&b).unwrap_or(serde_json::json!({}));
            let player = params["player"].as_i64().unwrap_or(1) as usize;
            let action_type = params["action"].as_str().unwrap_or("").to_string();
            let card_idx = params["card"].as_i64().unwrap_or(0) as usize;

            let mut games = self.games.lock().unwrap();
            let b = match games.get_mut(&game_id) {
                Some(b) => b,
                None => { self.respond_json(req, 404, &serde_json::json!({"ok": false, "err": "game not found"})); return; }
            };

            match action_type.as_str() {
                "play" => {
                    match crate::game::play_card(b, player, card_idx) {
                        Ok(_) => self.respond_json(req, 200, &serde_json::json!({"ok": true, "winner": b.winner, "state": crate::game::format_battle_state(b)})),
                        Err(e) => self.respond_json(req, 400, &serde_json::json!({"ok": false, "err": e})),
                    }
                }
                "endturn" => {
                    crate::game::end_turn(b, player);
                    self.respond_json(req, 200, &serde_json::json!({"ok": true, "state": crate::game::format_battle_state(b)}));
                }
                "cpu" => {
                    if b.actor != 0 {
                        self.respond_json(req, 400, &serde_json::json!({"ok": false, "err": "not CPU turn"}));
                        return;
                    }
                    let action_name = match crate::game::choose_cpu_action(b) {
                        crate::game::CpuAction::PlayCard(i, tgt) => {
                            if crate::game::play_card_target(b, 0, i, tgt).is_ok() {
                                format!("play {}", i)
                            } else {
                                crate::game::end_turn(b, 0);
                                "endturn".to_string()
                            }
                        }
                        crate::game::CpuAction::EndTurn => {
                            crate::game::end_turn(b, 0);
                            "endturn".to_string()
                        }
                    };
                    self.respond_json(req, 200, &serde_json::json!({
                        "ok": true, "action": action_name,
                        "state": crate::game::format_battle_state(b),
                    }));
                }
                _ => self.respond_json(req, 400, &serde_json::json!({"ok": false, "err": "unknown action"})),
            }
            return;
        };

        let mut games = self.games.lock().unwrap();
        let b = match games.get_mut(&game_id) {
            Some(b) => b,
            None => { self.respond_json(request, 404, &serde_json::json!({"ok": false, "err": "game not found"})); return; }
        };

        match action.as_str() {
            "state" => {
                let viewer = Self::extract_param(query, "viewer").parse::<usize>().unwrap_or(1);
                let viewer = if viewer < 2 { viewer } else { 1 };
                self.respond_json(request, 200, &serde_json::json!({
                    "ok": true,
                    "state": crate::game::format_battle_state_for(b, viewer),
                    "log": crate::game::format_log(b),
                    "winner": b.winner,
                    "turn": b.turn,
                    "actor": b.actor,
                    "players": b.players.iter().map(|p| serde_json::json!({
                        "name": p.role.name,
                        "hp": p.hp,
                        "max_hp": p.role.hp,
                        "def": p.def,
                        "energy": p.energy,
                        "max_energy": p.role.eng,
                        "hand": p.hand.iter().enumerate().map(|(i, c)| serde_json::json!({
                            "index": i, "id": c.id, "name": c.name, "cost": c.cost,
                            "desc": c.desc
                        })).collect::<Vec<_>>(),
                        "deck_size": p.draw.len(),
                        "discard_size": p.discard.len(),
                    })).collect::<Vec<_>>(),
                }));
            }
            _ => self.respond_json(request, 404, &serde_json::json!({"ok": false, "err": "not found"})),
        }
    }

    fn read_body(request: &mut Request) -> String {
        let content_length: usize = request
            .headers()
            .iter()
            .find(|h| h.field.as_str() == "Content-Length")
            .and_then(|h| h.value.to_string().parse().ok())
            .unwrap_or(0);
        let mut buf = Vec::new();
        let _ = request
            .as_reader()
            .take(content_length as u64)
            .read_to_end(&mut buf);
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
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default();
        let secs = now.as_secs();
        let time_str = format!(
            "{:02}:{:02}:{:02}",
            (secs / 3600) % 24,
            (secs % 3600) / 60,
            secs % 60
        );
        logln!("[{}] {}", time_str, msg);
    }
}

fn elapsed() -> f64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs_f64()
}

fn base64_encode(data: &[u8]) -> String {
    const CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::new();
    for chunk in data.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = *chunk.get(1).unwrap_or(&0) as u32;
        let b2 = *chunk.get(2).unwrap_or(&0) as u32;
        let n = (b0 << 16) | (b1 << 8) | b2;
        out.push(CHARS[(n >> 18) as usize & 63] as char);
        out.push(CHARS[(n >> 12) as usize & 63] as char);
        out.push(if chunk.len() > 1 {
            CHARS[(n >> 6) as usize & 63] as char
        } else {
            '='
        });
        out.push(if chunk.len() > 2 {
            CHARS[n as usize & 63] as char
        } else {
            '='
        });
    }
    out
}

/// 静态文件加载，两种模式互不混合：
/// - web 模式（--server）：只从磁盘读，读不到=404，绝不回退内嵌副本（避免静默旧文件）
/// - 桌面模式：只用 exe 内嵌副本，不碰磁盘
fn load_static(path: &str) -> Option<Vec<u8>> {
    let rel = path.trim_start_matches('/');
    if rel.contains("..") {
        return None;
    }
    if is_disk_mode() {
        if let Some(root) = web_root() {
            if let Ok(content) = std::fs::read(root.join(rel)) {
                return Some(content);
            }
        }
        embedded_static_file(path).map(|bytes| bytes.to_vec())
    } else {
        embedded_static_file(path).map(|bytes| bytes.to_vec())
    }
}

fn embedded_static_file(path: &str) -> Option<&'static [u8]> {
    Some(match path {
        "/index.html" => include_bytes!("../../app/index.html"),
        "/manifest.json" => include_bytes!("../../app/manifest.json"),
        "/splash.txt" => include_bytes!("../../app/card_duel/assets/splash.txt"),
        "/icon-192.png" => include_bytes!("../../app/icon-192.png"),
        "/icon-512.png" => include_bytes!("../../app/icon-512.png"),
        "/css/style.css" => include_bytes!("../../app/css/style.css"),
        "/js/app.js" => include_bytes!("../../app/js/app.js"),
        "/js/util.js" => include_bytes!("../../app/js/util.js"),
        "/js/state.js" => include_bytes!("../../app/js/state.js"),
        "/js/data.js" => include_bytes!("../../app/js/data.js"),
        "/js/core.js" => include_bytes!("../../app/js/core.js"),
        "/js/render.js" => include_bytes!("../../app/js/render.js"),
        "/js/battle.js" => include_bytes!("../../app/js/battle.js"),
        "/js/lan.js" => include_bytes!("../../app/js/lan.js"),
        "/js/pick.js" => include_bytes!("../../app/js/pick.js"),
        "/js/editor.js" => include_bytes!("../../app/js/editor.js"),
        "/js/library.js" => include_bytes!("../../app/js/library.js"),
        "/js/i18n.js" => include_bytes!("../../app/js/i18n.js"),
        "/js/sound.js" => include_bytes!("../../app/js/sound.js"),
        "/js/modloader.js" => include_bytes!("../../app/js/modloader.js"),
        "/js/jszip.min.js" => include_bytes!("../../app/js/jszip.min.js"),
        "/js/engine.js" => include_bytes!("../../app/js/engine.js"),
        "/js/card_duel_wasm.js" => include_bytes!("../../app/js/card_duel_wasm.js"),
        "/js/card_duel_wasm_bg.wasm" => include_bytes!("../../app/js/card_duel_wasm_bg.wasm"),
        _ => return None,
    })
}
