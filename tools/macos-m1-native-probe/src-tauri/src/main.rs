mod auth;
mod config;
mod native;
mod oidc;

use auth::{Auth, Error, Status};
use std::sync::mpsc::{sync_channel, SyncSender};
use std::sync::Arc;
use tauri::{Manager, State, WebviewWindow};
use tauri_plugin_deep_link::DeepLinkExt;

fn guard(window: &WebviewWindow, request: &tauri::ipc::Request<'_>) -> Result<(), Error> {
    let url = window.url().map_err(|_| "IPC_FORBIDDEN")?;
    if !native::trusted_page(window.label(), &url) {
        return Err("IPC_FORBIDDEN");
    }
    match request.body() {
        tauri::ipc::InvokeBody::Json(value) if native::empty_arguments(value) => Ok(()),
        _ => Err("IPC_ARGUMENTS_FORBIDDEN"),
    }
}

#[tauri::command]
async fn auth_begin(
    window: WebviewWindow,
    state: State<'_, Arc<Auth>>,
    request: tauri::ipc::Request<'_>,
) -> Result<Status, Error> {
    guard(&window, &request)?;
    let auth = Arc::clone(state.inner());
    tauri::async_runtime::spawn_blocking(move || {
        auth.begin()?;
        auth.status()
    })
    .await
    .map_err(|_| "AUTH_UNAVAILABLE")?
}

#[tauri::command]
async fn auth_cancel(
    window: WebviewWindow,
    state: State<'_, Arc<Auth>>,
    request: tauri::ipc::Request<'_>,
) -> Result<Status, Error> {
    guard(&window, &request)?;
    let auth = Arc::clone(state.inner());
    tauri::async_runtime::spawn_blocking(move || {
        auth.cancel()?;
        auth.status()
    })
    .await
    .map_err(|_| "AUTH_UNAVAILABLE")?
}

#[tauri::command]
async fn auth_status(
    window: WebviewWindow,
    state: State<'_, Arc<Auth>>,
    request: tauri::ipc::Request<'_>,
) -> Result<Status, Error> {
    guard(&window, &request)?;
    let auth = Arc::clone(state.inner());
    tauri::async_runtime::spawn_blocking(move || auth.status())
        .await
        .map_err(|_| "AUTH_UNAVAILABLE")?
}

fn receive(queue: &SyncSender<zeroize::Zeroizing<String>>, urls: Vec<url::Url>) {
    // Native only: callback URLs are never relayed to JavaScript.
    if urls.len() != 1 {
        return;
    }
    let raw = zeroize::Zeroizing::new(urls[0].as_str().to_owned());
    if raw.len() <= 8192 {
        let _ = queue.try_send(raw);
    }
}

fn main() {
    let auth = Arc::new(Auth::new(
        config::parse(include_str!("../public-config.json")),
        Arc::new(native::Keychain),
        Arc::new(native::SystemBrowser),
        Arc::new(native::SystemClock),
        Arc::new(oidc::NativeOidc),
    ));
    tauri::Builder::default()
        .plugin(tauri_plugin_deep_link::init())
        .manage(auth)
        .invoke_handler(tauri::generate_handler![
            auth_begin,
            auth_cancel,
            auth_status
        ])
        .setup(|app| {
            // Lifetime lock for this fixed bundle ID. Never unlink it: replacing its
            // inode would permit two controllers to race on one Keychain account.
            let directory = app.path().app_local_data_dir()?;
            std::fs::create_dir_all(&directory)?;
            let lock = std::fs::OpenOptions::new()
                .read(true)
                .write(true)
                .create(true)
                .truncate(false)
                .open(directory.join("auth-process.lock"))?;
            lock.try_lock()
                .map_err(|_| std::io::Error::other("AUTH_INSTANCE_BUSY"))?;
            app.manage(lock);
            tauri::WebviewWindowBuilder::from_config(app, &app.config().app.windows[0])?
                .on_navigation(|url| native::trusted_page("main", url))
                .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny)
                .build()?;
            let auth = Arc::clone(app.state::<Arc<Auth>>().inner());
            let (queue, callbacks) = sync_channel::<zeroize::Zeroizing<String>>(8);
            std::thread::spawn(move || {
                for raw in callbacks {
                    let _ = auth.callback(&raw);
                }
            });
            let warm = queue.clone();
            app.deep_link()
                .on_open_url(move |event| receive(&warm, event.urls()));
            match app.deep_link().get_current() {
                Ok(Some(urls)) => receive(&queue, urls),
                Ok(None) => {}
                Err(_) => return Err(std::io::Error::other("DEEP_LINK_UNAVAILABLE").into()),
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("native-host startup failed");
}
