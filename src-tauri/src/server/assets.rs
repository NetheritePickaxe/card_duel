//! 静态文件服务（表现层适配器）。
//!
//! 两种模式互不混合：
//! - web 模式（--server）：只从磁盘读，读不到=404，绝不回退内嵌副本（避免静默旧文件）
//! - 桌面模式：只用 exe 内嵌副本，不碰磁盘

use super::{is_disk_mode, web_root};
use std::path::PathBuf;
use tiny_http::{Header, Request, Response, StatusCode};

impl super::ServerState {
    pub(crate) fn serve_file(&self, request: Request, path: &str, content_type: &str) {
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

    pub(crate) fn serve_disk_file(&self, request: Request, path: &str) {
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
}

/// 静态文件加载：web 模式只读磁盘；桌面模式只用内嵌副本
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
        "/index.html" => include_bytes!("../../../app/index.html"),
        "/manifest.json" => include_bytes!("../../../app/manifest.json"),
        "/splash.txt" => include_bytes!("../../../app/card_duel/assets/splash.txt"),
        "/icon-192.png" => include_bytes!("../../../app/icon-192.png"),
        "/icon-512.png" => include_bytes!("../../../app/icon-512.png"),
        "/css/style.css" => include_bytes!("../../../app/css/style.css"),
        "/js/app.js" => include_bytes!("../../../app/js/app.js"),
        "/js/settings.js" => include_bytes!("../../../app/js/settings.js"),
        "/js/share.js" => include_bytes!("../../../app/js/share.js"),
        "/js/mods-ui.js" => include_bytes!("../../../app/js/mods-ui.js"),
        "/js/util.js" => include_bytes!("../../../app/js/util.js"),
        "/js/state.js" => include_bytes!("../../../app/js/state.js"),
        "/js/data.js" => include_bytes!("../../../app/js/data.js"),
        "/js/core.js" => include_bytes!("../../../app/js/core.js"),
        "/js/render.js" => include_bytes!("../../../app/js/render.js"),
        "/js/battle.js" => include_bytes!("../../../app/js/battle.js"),
        "/js/lan.js" => include_bytes!("../../../app/js/lan.js"),
        "/js/pick.js" => include_bytes!("../../../app/js/pick.js"),
        "/js/editor.js" => include_bytes!("../../../app/js/editor.js"),
        "/js/library.js" => include_bytes!("../../../app/js/library.js"),
        "/js/i18n.js" => include_bytes!("../../../app/js/i18n.js"),
        "/js/sound.js" => include_bytes!("../../../app/js/sound.js"),
        "/js/modloader.js" => include_bytes!("../../../app/js/modloader.js"),
        "/js/jszip.min.js" => include_bytes!("../../../app/js/jszip.min.js"),
        "/js/engine.js" => include_bytes!("../../../app/js/engine.js"),
        "/js/card_duel_wasm.js" => include_bytes!("../../../app/js/card_duel_wasm.js"),
        "/js/card_duel_wasm_bg.wasm" => include_bytes!("../../../app/js/card_duel_wasm_bg.wasm"),
        _ => return None,
    })
}
