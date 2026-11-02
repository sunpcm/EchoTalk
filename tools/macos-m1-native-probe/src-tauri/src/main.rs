mod auth;
mod config;
mod media_api;
mod native;
mod oidc;

use auth::{Auth, Error, Status};
use media_api::{JoinGrant, Media, MediaStatus};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{sync_channel, SyncSender};
use std::sync::Arc;
use tauri::{Manager, State, WebviewWindow};
use tauri_plugin_deep_link::DeepLinkExt;

struct Host {
    auth: Arc<Auth>,
    media: Arc<Media>,
    begin: native::WorkSlot,
    cancel: native::WorkSlot,
    status: native::WorkSlot,
    media_work: native::WorkSlot,
    cleanup_requested: AtomicBool,
}

fn guard(
    window: &WebviewWindow,
    request: &tauri::ipc::Request<'_>,
    command: &str,
) -> Result<Option<native::DispatchArgs>, Error> {
    let url = window.url().map_err(|_| "IPC_FORBIDDEN")?;
    match request.body() {
        tauri::ipc::InvokeBody::Json(value) => {
            native::command_arguments(window.label(), &url, command, value)
        }
        _ => Err("IPC_ARGUMENTS_FORBIDDEN"),
    }
}

// Coalesce Auth/stop cleanup into one flag; no queue and no automatic retry.
fn schedule_cleanup(host: &Arc<Host>) {
    if !host.cleanup_requested.load(Ordering::Acquire) {
        return;
    }
    let Ok(permit) = host.media_work.acquire() else {
        return;
    };
    if !host.cleanup_requested.swap(false, Ordering::AcqRel) {
        return;
    }
    let host = host.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _ = host.media.stop();
        drop(permit);
        schedule_cleanup(&host);
    });
}

fn invalidate_media(host: &Arc<Host>) -> Result<(), Error> {
    host.media.invalidate()?;
    host.cleanup_requested.store(true, Ordering::Release);
    schedule_cleanup(host);
    Ok(())
}

async fn media_job<T: Send + 'static>(
    host: Arc<Host>,
    permit: native::WorkPermit,
    work: impl FnOnce(&Host) -> Result<T, Error> + Send + 'static,
) -> Result<T, Error> {
    tauri::async_runtime::spawn_blocking(move || {
        let result = work(&host);
        drop(permit);
        schedule_cleanup(&host);
        result
    })
    .await
    .map_err(|_| "MEDIA_UNAVAILABLE")?
}

#[tauri::command]
async fn auth_begin(
    window: WebviewWindow,
    state: State<'_, Arc<Host>>,
    request: tauri::ipc::Request<'_>,
) -> Result<Status, Error> {
    guard(&window, &request, "auth_begin")?;
    let host = state.inner().clone();
    if host.cancel.busy() {
        return Err("AUTH_BUSY");
    }
    let permit = host.begin.acquire()?;
    invalidate_media(&host)?;
    tauri::async_runtime::spawn_blocking(move || {
        let _permit = permit;
        host.auth.begin()?;
        host.auth.status()
    })
    .await
    .map_err(|_| "AUTH_UNAVAILABLE")?
}

#[tauri::command]
async fn auth_cancel(
    window: WebviewWindow,
    state: State<'_, Arc<Host>>,
    request: tauri::ipc::Request<'_>,
) -> Result<Status, Error> {
    guard(&window, &request, "auth_cancel")?;
    let host = state.inner().clone();
    let permit = host.cancel.acquire()?;
    invalidate_media(&host)?;
    tauri::async_runtime::spawn_blocking(move || {
        let _permit = permit;
        host.auth.cancel()?;
        host.auth.status()
    })
    .await
    .map_err(|_| "AUTH_UNAVAILABLE")?
}

#[tauri::command]
async fn auth_status(
    window: WebviewWindow,
    state: State<'_, Arc<Host>>,
    request: tauri::ipc::Request<'_>,
) -> Result<Status, Error> {
    guard(&window, &request, "auth_status")?;
    let host = state.inner().clone();
    let permit = host.status.acquire()?;
    tauri::async_runtime::spawn_blocking(move || {
        let _permit = permit;
        host.auth.status()
    })
    .await
    .map_err(|_| "AUTH_UNAVAILABLE")?
}

#[tauri::command]
async fn media_prepare(
    window: WebviewWindow,
    state: State<'_, Arc<Host>>,
    request: tauri::ipc::Request<'_>,
) -> Result<JoinGrant, Error> {
    guard(&window, &request, "media_prepare")?;
    let host = state.inner().clone();
    let expected = host.media.receipt()?.generation;
    if host.begin.busy() || host.cancel.busy() {
        return Err("MEDIA_AUTH_CHANGED");
    }
    let permit = host.media_work.acquire()?;
    media_job(host, permit, move |host| {
        if host.begin.busy() || host.cancel.busy() {
            return Err("MEDIA_AUTH_CHANGED");
        }
        host.media.prepare_at(expected)
    })
    .await
}

#[tauri::command]
async fn media_dispatch(
    window: WebviewWindow,
    state: State<'_, Arc<Host>>,
    request: tauri::ipc::Request<'_>,
) -> Result<MediaStatus, Error> {
    let args = guard(&window, &request, "media_dispatch")?.ok_or("IPC_ARGUMENTS_FORBIDDEN")?;
    let host = state.inner().clone();
    if host.begin.busy() || host.cancel.busy() {
        return Err("MEDIA_AUTH_CHANGED");
    }
    let permit = host.media_work.acquire()?;
    media_job(host, permit, move |host| {
        if host.begin.busy() || host.cancel.busy() {
            return Err("MEDIA_AUTH_CHANGED");
        }
        host.media.dispatch(args.generation)
    })
    .await
}

#[tauri::command]
async fn media_stop(
    window: WebviewWindow,
    state: State<'_, Arc<Host>>,
    request: tauri::ipc::Request<'_>,
) -> Result<MediaStatus, Error> {
    guard(&window, &request, "media_stop")?;
    let host = state.inner().clone();
    host.media.invalidate()?;
    host.cleanup_requested.store(true, Ordering::Release);
    let Ok(permit) = host.media_work.acquire() else {
        return host.media.receipt();
    };
    host.cleanup_requested.store(false, Ordering::Release);
    media_job(host, permit, |host| host.media.stop()).await
}

#[tauri::command]
async fn media_status(
    window: WebviewWindow,
    state: State<'_, Arc<Host>>,
    request: tauri::ipc::Request<'_>,
) -> Result<MediaStatus, Error> {
    guard(&window, &request, "media_status")?;
    let host = state.inner().clone();
    let Ok(permit) = host.media_work.acquire() else {
        return host.media.receipt();
    };
    media_job(host, permit, |host| {
        if host.cleanup_requested.swap(false, Ordering::AcqRel) {
            host.media.stop()
        } else {
            host.media.status()
        }
    })
    .await
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
    let media = Arc::new(Media::new(
        media_api::parse_config(include_str!("../media-config.json")),
        auth.clone(),
        Arc::new(media_api::NativeHttp),
        Arc::new(native::SystemClock),
    ));
    let host = Arc::new(Host {
        auth,
        media,
        begin: native::WorkSlot::default(),
        cancel: native::WorkSlot::default(),
        status: native::WorkSlot::default(),
        media_work: native::WorkSlot::default(),
        cleanup_requested: AtomicBool::new(false),
    });
    tauri::Builder::default()
        .plugin(tauri_plugin_deep_link::init())
        .manage(host)
        .invoke_handler(tauri::generate_handler![
            auth_begin,
            auth_cancel,
            auth_status,
            media_prepare,
            media_dispatch,
            media_stop,
            media_status
        ])
        .on_window_event(|window, event| {
            // No hidden/tray process survives closing the sole webview. JS pagehide
            // disposes tracks; process exit is the final M1 microphone boundary.
            if matches!(event, tauri::WindowEvent::Destroyed) {
                window.app_handle().exit(0);
            }
        })
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
            let auth = app.state::<Arc<Host>>().auth.clone();
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
