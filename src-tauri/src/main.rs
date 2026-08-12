#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[path = "game.rs"]
mod game;
mod net;
mod server;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.contains(&"--server".to_string()) {
        server::set_disk_mode(true);
        let state = std::sync::Arc::new(server::ServerState::default());
        let cert = args
            .iter()
            .position(|a| a == "--cert")
            .and_then(|i| args.get(i + 1));
        let key = args
            .iter()
            .position(|a| a == "--key")
            .and_then(|i| args.get(i + 1));
        match (cert, key) {
            #[cfg(feature = "tls")]
            (Some(c), Some(k)) => state.start_with_tls(c, k),
            _ => state.start(),
        }
        std::thread::park();
        return;
    }

    // Desktop: LAN server reads from disk (hot reload for LAN players)
    server::set_disk_mode(true);
    server::start_background_server();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![get_lan_info])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[tauri::command]
fn get_lan_info() -> serde_json::Value {
    let ips = net::local_ips();
    let phone_ip = net::lan_ip();
    serde_json::json!({
        "ips": ips,
        "phone_ip": phone_ip,
        "port": 8788
    })
}
