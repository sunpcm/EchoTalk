fn main() {
    println!("cargo:rerun-if-changed=public-config.json");
    println!("cargo:rerun-if-changed=Info.plist");
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&["auth_begin", "auth_cancel", "auth_status"]),
    ))
    .expect("native build policy failed");
}
