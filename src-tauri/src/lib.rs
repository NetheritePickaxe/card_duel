#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod net;
mod server;

use std::sync::Arc;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![get_lan_info])
        .setup(|app| {
            // Start the LAN server in a background thread
            let state = Arc::new(server::ServerState::new());
            let server_thread = std::thread::spawn(move || {
                state.start();
            });
            std::mem::forget(server_thread);
            Ok(())
        })
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
