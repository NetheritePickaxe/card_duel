//! 独立联机的 Web 后端（纯 Rust，不链接 Tauri / 无图形界面）。
//! 与 `card-duel.exe --server` 共用同一份 server.rs / net.rs，
//! 但不依赖 tauri，体积小、可单独部署（局域网开房 / VPS）。
//!
//! 用法:
//!     card-duel-server                # HTTP 监听 0.0.0.0:8788
//!     card-duel-server --cert c.pem --key k.pem   # (--features tls) HTTPS

#![allow(dead_code)]

#[path = "../net.rs"]
mod net;
#[path = "../server.rs"]
mod server;

use std::sync::Arc;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let cert = args
        .iter()
        .position(|a| a == "--cert")
        .and_then(|i| args.get(i + 1));
    let key = args
        .iter()
        .position(|a| a == "--key")
        .and_then(|i| args.get(i + 1));

    server::set_disk_mode(true);
    let state = Arc::new(server::ServerState::default());
    match (cert, key) {
        #[cfg(feature = "tls")]
        (Some(c), Some(k)) => state.start_with_tls(c, k),
        _ => state.start(),
    }
    std::thread::park();
}