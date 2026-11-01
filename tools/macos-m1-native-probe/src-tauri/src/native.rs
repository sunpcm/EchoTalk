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
