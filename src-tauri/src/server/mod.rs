//! HTTP 服务模块（分层后的入口层）。
//!
//! 架构定位：
//! - `mod.rs`    路由分发 + HTTP 基础设施（ServerState、日志、静态资源加载开关）
//! - `rooms.rs`  LAN 大厅（创建/加入/选择/就绪/主机数据）—— 联机会话 Control
//! - `battle.rs` 房间战斗（服务端权威结算，Layer 4 Control + 公开状态投影）
//! - `gameapi.rs` /api/game/*（LLM API 适配器）
//! - `assets.rs` 静态文件服务（表现层适配器）
//! - `discover.rs` UDP 局域网发现
//!
//! 禁止在路由处理函数中实现业务逻辑：战斗结算一律经 `game::action::execute`。

mod assets;
mod battle;
mod discover;
mod gameapi;
mod rooms;

use std::collections::HashMap;
use std::fs::{self, File, OpenOptions};
use std::io::{BufReader, Read, Write};
use std::net::UdpSocket;
use std::path::PathBuf;
use std::sync::Arc;

use parking_lot::Mutex;
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use flate2::write::GzEncoder;
use flate2::Compression;
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

pub(crate) fn web_root() -> Option<&'static PathBuf> {
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
            candidates
                .into_iter()
                .find(|c| c.join("index.html").exists())
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
        let _ = LOG_FILE.set(parking_lot::Mutex::new(file));
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
    let days_in_month = [
        31,
        if is_leap { 29 } else { 28 },
        31,
        30,
        31,
        30,
        31,
        31,
        30,
        31,
        30,
        31,
    ];
    let mut m = 0;
    let mut d_rem = remain;
    while d_rem >= days_in_month[m] {
        d_rem -= days_in_month[m];
        m += 1;
    }
    let h = time / 3600;
    let mi = (time % 3600) / 60;
    let s = time % 60;
    format!(
        "{:04}-{:02}-{:02}-{:02}{:02}{:02}",
        y,
        m + 1,
        d_rem + 1,
        h,
        mi,
        s
    )
}

static LOG_FILE: std::sync::OnceLock<parking_lot::Mutex<std::fs::File>> =
    std::sync::OnceLock::new();

/// 写入日志（同时输出到控制台和文件）
macro_rules! logln {
    ($($arg:tt)*) => {{
        let msg = format!($($arg)*);
        eprintln!("{}", msg);
        if let Some(file) = LOG_FILE.get() {
            let _ = writeln!(file.lock(), "{}", msg);
        }
    }};
}

/// Start the LAN server in a background daemon thread (used by desktop & Android).
pub fn start_background_server() {
    let state: Arc<ServerState> = Arc::new(ServerState::default());
    let server_thread = std::thread::spawn(move || state.start());
    std::mem::forget(server_thread);
}

pub(crate) const PORT: u16 = 8788;
pub(crate) const DISCOVER_PORT: u16 = 8789;
pub(crate) const DISCOVER_MAGIC: &[u8] = b"CARD_DUEL_DISCOVER";
pub(crate) const DISCOVER_RESP: &[u8] = b"CARD_DUEL_HERE";
const CODE_CHARS: &[char] = &[
    'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'J', 'K', 'M', 'N', 'P', 'Q', 'R', 'S', 'T', 'U', 'V',
    'W', 'X', 'Y', 'Z', '2', '3', '4', '5', '6', '7', '8', '9',
];
pub(crate) const ROOM_TTL: Duration = Duration::from_secs(7200);
pub(crate) const LIST_TTL: Duration = Duration::from_secs(3600);

/// 服务器全局状态：房间表 + 共享模组 + LLM 对局表
pub struct ServerState {
    pub rooms: Arc<Mutex<HashMap<String, rooms::Room>>>,
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
            }
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
            let mut rooms = cleanup_rooms.lock();
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
                            let has_rooms = !discover_rooms.lock().is_empty();
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
                    self.respond_json(
                        request,
                        404,
                        &serde_json::json!({"ok": false, "err": "not found"}),
                    );
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
            "/act" => self.handle_act(request),
            "/api/mod/list" => self.handle_mod_list(request),
            "/api/mod/upload" => self.handle_mod_upload(request),
            "/api/mod/download" => self.handle_mod_download(request, query),
            "/api/game/list" => self.handle_game_list(request),
            "/api/game/new" => self.handle_game_new(request, query),
            path if path.starts_with("/api/game/") => {
                self.handle_game_action(request, &path[10..], method.as_str(), query)
            }
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

    pub(crate) fn gen_code() -> String {
        use rand::Rng;
        let mut rng = rand::thread_rng();
        (0..5)
            .map(|_| CODE_CHARS[rng.gen_range(0..CODE_CHARS.len())])
            .collect()
    }

    pub(crate) fn respond_json(&self, request: Request, status: u16, body: &serde_json::Value) {
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

    pub(crate) fn read_body(request: &mut Request) -> String {
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

    pub(crate) fn extract_param<'a>(query: &'a str, key: &str) -> &'a str {
        for pair in query.split('&') {
            let mut kv = pair.splitn(2, '=');
            if kv.next() == Some(key) {
                return kv.next().unwrap_or("");
            }
        }
        ""
    }

    pub(crate) fn slog(&self, msg: &str) {
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

pub(crate) fn elapsed() -> f64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs_f64()
}

pub(crate) fn base64_encode(data: &[u8]) -> String {
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
