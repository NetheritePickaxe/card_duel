#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod net;
mod server;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.contains(&"--server".to_string()) {
        // Headless server mode for web hosting
        let state = std::sync::Arc::new(server::ServerState::default());
        state.start();
        std::thread::park();
        return;
    }

    // Desktop: start server in background + launch Tauri app
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
