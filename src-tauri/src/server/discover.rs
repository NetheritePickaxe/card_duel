//! UDP 局域网发现。

use super::{DISCOVER_MAGIC, DISCOVER_PORT, DISCOVER_RESP};
use parking_lot::Mutex;
use std::net::UdpSocket;
use std::time::Duration;
use tiny_http::Request;

impl super::ServerState {
    /// 广播发现请求，收集局域网内的 Card Duel 服务器
    pub(crate) fn handle_discover(&self, request: Request) {
        let ips = Mutex::new(Vec::new());
        if let Ok(sock) = UdpSocket::bind("0.0.0.0:0") {
            if sock.set_read_timeout(Some(Duration::from_secs(2))).is_ok() {
                let _ = sock.set_broadcast(true);
                let _ = sock.send_to(DISCOVER_MAGIC, ("255.255.255.255", DISCOVER_PORT));
                let mut buf = [0u8; 256];
                while let Ok((len, src)) = sock.recv_from(&mut buf) {
                    if &buf[..len] == DISCOVER_RESP {
                        let mut list = ips.lock();
                        if !list.contains(&src.ip().to_string()) {
                            list.push(src.ip().to_string());
                        }
                    }
                }
            }
        }
        let found = ips.lock().clone();
        self.respond_json(
            request,
            200,
            &serde_json::json!({"ok": true, "servers": found}),
        );
    }
}
