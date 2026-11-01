fn main() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("native-host startup failed");
}
