use std::process::{Command, Stdio};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use url::Url;
use zeroize::Zeroizing;

use crate::auth::{Browser, Clock, Error, Store, Transaction};

const SERVICE: &str = "org.echotalk.m1nativeprobe.auth";
const ACCOUNT: &str = "pending-auth-v1";

pub struct Keychain;

impl Keychain {
    fn entry() -> Result<keyring::Entry, Error> {
        // Never enumerate or accept a service/account from IPC/config.
        keyring::Entry::new(SERVICE, ACCOUNT).map_err(|_| "AUTH_STORAGE_FAILED")
    }
}

impl Store for Keychain {
    fn load(&self) -> Result<Option<Transaction>, Error> {
        let raw = match Self::entry()?.get_password() {
            Ok(raw) => Zeroizing::new(raw),
            Err(keyring::Error::NoEntry) => return Ok(None),
            Err(_) => return Err("AUTH_STORAGE_FAILED"),
        };
        if raw.len() > 16384 {
            return Err("AUTH_STORAGE_FAILED");
        }
        serde_json::from_str(&raw)
            .map(Some)
            .map_err(|_| "AUTH_STORAGE_FAILED")
    }

    fn save(&self, tx: &Transaction) -> Result<(), Error> {
        let raw = Zeroizing::new(serde_json::to_string(tx).map_err(|_| "AUTH_STORAGE_FAILED")?);
        Self::entry()?
            .set_password(&raw)
            .map_err(|_| "AUTH_STORAGE_FAILED")
    }

    fn delete(&self) -> Result<(), Error> {
        // NoEntry is NOT success: another process may already have consumed it.
        Self::entry()?
            .delete_credential()
            .map_err(|_| "AUTH_STORAGE_FAILED")
    }
}

pub struct SystemBrowser;

impl Browser for SystemBrowser {
    fn open(&self, url: &Url) -> Result<(), Error> {
        // Caller has verified the complete URL against the frozen config+transaction.
        // No shell, no URL from JS, no output containing authorization parameters.
        let mut child = Command::new("/usr/bin/open")
            .arg(url.as_str())
            .env_clear()
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|_| "BROWSER_FAILED")?;
        let deadline = Instant::now() + Duration::from_secs(3);
        loop {
            match child.try_wait() {
                Ok(Some(status)) => {
                    return if status.success() {
                        Ok(())
                    } else {
                        Err("BROWSER_FAILED")
                    }
                }
                Ok(None) if Instant::now() < deadline => {
                    std::thread::sleep(Duration::from_millis(10))
                }
                _ => {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err("BROWSER_FAILED");
                }
            }
        }
    }
}

pub struct SystemClock;
impl Clock for SystemClock {
    fn now(&self) -> u64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(u64::MAX)
    }
}

pub fn trusted_page(label: &str, url: &Url) -> bool {
    label == "main"
        && url.scheme() == "tauri"
        && url.host_str() == Some("localhost")
        && url.username().is_empty()
        && url.password().is_none()
        && url.port().is_none()
        && ["", "/", "/index.html"].contains(&url.path())
        && url.query().is_none()
        && url.fragment().is_none()
}

pub fn empty_arguments(value: &serde_json::Value) -> bool {
    value.as_object().is_some_and(|object| object.is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn packaged_tauri_default_root_without_slash_is_trusted() {
        // Tauri 2.12.5 get_app_url/tauri_protocol_url uses this exact URL for
        // the default App(index.html); it is not the slash-terminated form.
        let root = Url::parse("tauri://localhost").unwrap();
        assert_eq!(root.as_str(), "tauri://localhost");
        assert_eq!(root.path(), "");
        assert!(trusted_page("main", &root));
    }

    #[test]
    fn actual_local_origin_and_window_required() {
        assert!(trusted_page(
            "main",
            &Url::parse("tauri://localhost/").unwrap()
        ));
        assert!(trusted_page(
            "main",
            &Url::parse("tauri://localhost/index.html").unwrap()
        ));
        for (label, raw) in [
            ("other", "tauri://localhost/"),
            ("other", "tauri://localhost"),
            ("main", "https://localhost/"),
            ("main", "http://localhost/"),
            ("main", "https://idp.test/"),
            ("main", "tauri://evil/"),
            ("main", "tauri://evil"),
            ("main", "tauri://user@localhost/"),
            ("main", "tauri://user:x@localhost"),
            ("main", "tauri://localhost:443"),
            ("main", "tauri://localhost:80/index.html"),
            ("main", "tauri://localhost?x=1"),
            ("main", "tauri://localhost?"),
            ("main", "tauri://localhost/?x=1"),
            ("main", "tauri://localhost/index.html?x=1"),
            ("main", "tauri://localhost#fragment"),
            ("main", "tauri://localhost#"),
            ("main", "tauri://localhost/index.html#fragment"),
            ("main", "tauri://localhost/other.html"),
            ("main", "tauri://localhost/index.html/other"),
            ("main", "tauri://localhost/other/index.html"),
        ] {
            assert!(!trusted_page(label, &Url::parse(raw).unwrap()));
        }
    }
    #[test]
    fn commands_accept_only_an_empty_object() {
        assert!(empty_arguments(&serde_json::json!({})));
        for value in [
            serde_json::json!({"url": "https://evil.test/"}),
            serde_json::json!({"config": null}),
            serde_json::json!({"callback": "secret"}),
            serde_json::json!(null),
            serde_json::json!([]),
            serde_json::json!("unknown"),
        ] {
            assert!(!empty_arguments(&value));
        }
    }
}

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DispatchArgs {
    pub generation: u64,
}

// All production commands use this exact guard, also exercised by Rust tests.
pub fn command_arguments(
    label: &str,
    url: &Url,
    command: &str,
    value: &serde_json::Value,
) -> Result<Option<DispatchArgs>, Error> {
    if !trusted_page(label, url) {
        return Err("IPC_FORBIDDEN");
    }
    if command == "media_dispatch" {
        let args: DispatchArgs =
            serde_json::from_value(value.clone()).map_err(|_| "IPC_ARGUMENTS_FORBIDDEN")?;
        if args.generation == 0 || args.generation > 9_007_199_254_740_991 {
            return Err("IPC_ARGUMENTS_FORBIDDEN");
        }
        Ok(Some(args))
    } else if [
        "auth_begin",
        "auth_cancel",
        "auth_status",
        "media_prepare",
        "media_stop",
        "media_status",
    ]
    .contains(&command)
        && empty_arguments(value)
    {
        Ok(None)
    } else {
        Err("IPC_ARGUMENTS_FORBIDDEN")
    }
}

// One permit per fixed operation type; callers reject rather than enqueue more work.
#[derive(Default, Clone)]
pub struct WorkSlot(std::sync::Arc<std::sync::atomic::AtomicBool>);
pub struct WorkPermit(std::sync::Arc<std::sync::atomic::AtomicBool>);
impl WorkSlot {
    pub fn busy(&self) -> bool {
        self.0.load(std::sync::atomic::Ordering::Acquire)
    }
    pub fn acquire(&self) -> Result<WorkPermit, Error> {
        self.0
            .compare_exchange(
                false,
                true,
                std::sync::atomic::Ordering::AcqRel,
                std::sync::atomic::Ordering::Acquire,
            )
            .map_err(|_| "IPC_BUSY")?;
        Ok(WorkPermit(self.0.clone()))
    }
}
impl Drop for WorkPermit {
    fn drop(&mut self) {
        self.0.store(false, std::sync::atomic::Ordering::Release);
    }
}

#[cfg(test)]
mod media_ipc_tests {
    use super::*;
    #[test]
    fn production_guard_strictly_types_generation_and_rejects_extra_keys() {
        let local = Url::parse("tauri://localhost").unwrap();
        for value in [
            serde_json::json!({"generation":1}),
            serde_json::json!({"generation":9007199254740991u64}),
        ] {
            assert!(command_arguments("main", &local, "media_dispatch", &value)
                .unwrap()
                .is_some());
        }
        for raw in [
            r#"{}"#,
            r#"{"generation":0}"#,
            r#"{"generation":-1}"#,
            r#"{"generation":1.0}"#,
            r#"{"generation":1.5}"#,
            r#"{"generation":"1"}"#,
            r#"{"generation":9007199254740992}"#,
            r#"{"generation":null}"#,
            r#"{"generation":1,"url":"https://evil.test"}"#,
            r#"[]"#,
        ] {
            let value = serde_json::from_str(raw).unwrap();
            assert!(command_arguments("main", &local, "media_dispatch", &value).is_err());
        }
        for command in [
            "auth_begin",
            "auth_cancel",
            "auth_status",
            "media_prepare",
            "media_stop",
            "media_status",
        ] {
            assert!(
                command_arguments("main", &local, command, &serde_json::json!({}))
                    .unwrap()
                    .is_none()
            );
            assert!(command_arguments(
                "main",
                &local,
                command,
                &serde_json::json!({"generation":1})
            )
            .is_err());
        }
        assert!(command_arguments("main", &local, "unknown", &serde_json::json!({})).is_err());
        for (label, raw) in [
            ("other", "tauri://localhost"),
            ("main", "https://localhost/"),
            ("main", "tauri://localhost?evil=1"),
            ("main", "tauri://evil/"),
        ] {
            assert!(command_arguments(
                label,
                &Url::parse(raw).unwrap(),
                "media_dispatch",
                &serde_json::json!({"generation":1})
            )
            .is_err());
        }
    }
    #[test]
    fn fixed_work_slot_has_no_queue_and_releases_on_drop() {
        let slot = WorkSlot::default();
        let permit = slot.acquire().unwrap();
        assert!(slot.busy());
        assert!(slot.acquire().is_err());
        drop(permit);
        assert!(!slot.busy());
        assert!(slot.acquire().is_ok());
    }
}
