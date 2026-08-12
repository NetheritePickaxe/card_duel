fn main() {
    if cfg!(feature = "desktop") {
        tauri_build::build();
    }
    println!("cargo:rustc-check-cfg=cfg(mobile)");
}
