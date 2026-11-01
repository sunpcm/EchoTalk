use super::*;
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::{mpsc, Condvar};
use std::time::Duration;

pub fn config() -> OidcConfig {
    OidcConfig {
        issuer: "https://issuer.example.test/".into(),
        client_id: "m1-native".into(),
        redirect_uri: REDIRECT.into(),
        authorization_endpoint: "https://issuer.example.test/auth".into(),
        token_endpoint: "https://issuer.example.test/token".into(),
        jwks_uri: "https://issuer.example.test/keys".into(),
    }
}
#[derive(Default)]
struct MemoryStore {
    value: Mutex<Option<String>>,
    faults: AtomicUsize,
    deletes: AtomicUsize,
}
impl Store for MemoryStore {
    fn load(&self) -> Result<Option<Transaction>, Error> {
        if self.faults.load(Ordering::SeqCst) & 1 != 0 {
            return Err("AUTH_STORAGE_FAILED");
        }
        self.value
            .lock()
            .unwrap()
            .as_ref()
            .map(|s| serde_json::from_str(s).map_err(|_| "AUTH_STORAGE_FAILED"))
            .transpose()
    }
    fn save(&self, tx: &Transaction) -> Result<(), Error> {
        if self.faults.load(Ordering::SeqCst) & 2 != 0 {
            return Err("AUTH_STORAGE_FAILED");
        }
        *self.value.lock().unwrap() = Some(serde_json::to_string(tx).unwrap());
        Ok(())
    }
    fn delete(&self) -> Result<(), Error> {
        self.deletes.fetch_add(1, Ordering::SeqCst);
        if self.faults.load(Ordering::SeqCst) & 4 != 0 {
            return Err("AUTH_STORAGE_FAILED");
        }
        self.value
            .lock()
            .unwrap()
            .take()
            .map(|_| ())
            .ok_or("AUTH_STORAGE_FAILED")
    }
}
struct FakeClock(AtomicU64);
impl Clock for FakeClock {
    fn now(&self) -> u64 {
        self.0.load(Ordering::SeqCst)
    }
}
struct FakeBrowser {
    store: Arc<MemoryStore>,
    calls: AtomicUsize,
    fail: AtomicBool,
}
impl Browser for FakeBrowser {
    fn open(&self, _: &Url) -> Result<(), Error> {
        assert!(
            self.store.load()?.is_some(),
            "transaction saved before browser"
        );
        self.calls.fetch_add(1, Ordering::SeqCst);
        if self.fail.load(Ordering::SeqCst) {
            Err("BROWSER_FAILED")
        } else {
            Ok(())
        }
    }
}
struct Gate {
    entered: Mutex<Option<mpsc::Sender<()>>>,
    released: Mutex<bool>,
    cond: Condvar,
}
impl Gate {
    fn new() -> (Arc<Self>, mpsc::Receiver<()>) {
        let (send, receive) = mpsc::channel();
        (
            Arc::new(Self {
                entered: Mutex::new(Some(send)),
                released: Mutex::new(false),
                cond: Condvar::new(),
            }),
            receive,
        )
    }
    fn block(&self) {
        self.entered
            .lock()
            .unwrap()
            .take()
            .unwrap()
            .send(())
            .unwrap();
        let (released, timeout) = self
            .cond
            .wait_timeout_while(
                self.released.lock().unwrap(),
                Duration::from_secs(3),
                |done| !*done,
            )
            .unwrap();
        assert!(*released && !timeout.timed_out(), "test gate must release");
    }
    fn release(&self) {
        *self.released.lock().unwrap() = true;
        self.cond.notify_all();
    }
}
struct FakeOidc {
    calls: AtomicUsize,
    store: Arc<MemoryStore>,
    prepare_gate: Mutex<Option<Arc<Gate>>>,
    exchange_gate: Mutex<Option<Arc<Gate>>>,
    fail_prepare: AtomicBool,
    fail_exchange: AtomicBool,
}
impl Oidc for FakeOidc {
    fn authorization(&self, tx: &Transaction) -> Result<Url, Error> {
        let gate = self.prepare_gate.lock().unwrap().take();
        if let Some(gate) = gate {
            gate.block();
        }
        if self.fail_prepare.load(Ordering::SeqCst) {
            return Err("OIDC_DISCOVERY_FAILED");
        }
        let mut url = Url::parse(&tx.config.authorization_endpoint).unwrap();
        let verifier = openidconnect::PkceCodeVerifier::new(tx.verifier.clone());
        let challenge = PkceCodeChallenge::from_code_verifier_sha256(&verifier);
        url.query_pairs_mut().extend_pairs([
            ("response_type", "code"),
            ("client_id", &tx.config.client_id),
            ("redirect_uri", REDIRECT),
            ("scope", "openid"),
            ("state", &tx.state),
            ("nonce", &tx.nonce),
            ("code_challenge_method", "S256"),
            ("code_challenge", challenge.as_str()),
        ]);
        Ok(url)
    }
    fn exchange(&self, _: &Transaction, _: &str) -> Result<Session, Error> {
        assert!(
            self.store.load()?.is_none(),
            "durable consume before network exchange"
        );
        self.calls.fetch_add(1, Ordering::SeqCst);
        let gate = self.exchange_gate.lock().unwrap().take();
        if let Some(gate) = gate {
            gate.block();
        }
        if self.fail_exchange.load(Ordering::SeqCst) {
            return Err("OIDC_EXCHANGE_FAILED");
        }
        Ok(Session {
            access_token: Zeroizing::new("synthetic-access".into()),
            subject: Zeroizing::new("synthetic-subject".into()),
            expires_at: 1500,
        })
    }
}
struct Fixture {
    auth: Arc<Auth>,
    store: Arc<MemoryStore>,
    oidc: Arc<FakeOidc>,
    browser: Arc<FakeBrowser>,
    clock: Arc<FakeClock>,
}
impl Fixture {
    fn new() -> Self {
        let store = Arc::new(MemoryStore::default());
        let browser = Arc::new(FakeBrowser {
            store: store.clone(),
            calls: AtomicUsize::new(0),
            fail: AtomicBool::new(false),
        });
        let clock = Arc::new(FakeClock(AtomicU64::new(1000)));
        let oidc = Arc::new(FakeOidc {
            calls: AtomicUsize::new(0),
            store: store.clone(),
            prepare_gate: Mutex::new(None),
            exchange_gate: Mutex::new(None),
            fail_prepare: AtomicBool::new(false),
            fail_exchange: AtomicBool::new(false),
        });
        let auth = Arc::new(Auth::new(
            Ok(Some(config())),
            store.clone(),
            browser.clone(),
            clock.clone(),
            oidc.clone(),
        ));
        Self {
            auth,
            store,
            oidc,
            browser,
            clock,
        }
    }
    fn callback(&self) -> String {
        format!(
            "{}?state={}&code=synthetic-code",
            REDIRECT,
            self.store.load().unwrap().unwrap().state
        )
    }
    fn restarted(&self) -> Auth {
        Auth::new(
            Ok(Some(config())),
            self.store.clone(),
            self.browser.clone(),
            self.clock.clone(),
            self.oidc.clone(),
        )
    }
}

#[test]
fn warm_success_once_expiry_logout_and_next_login() {
    let f = Fixture::new();
    f.auth.begin().unwrap();
    let callback = f.callback();
    f.auth.callback(&callback).unwrap();
    assert!(f.auth.status().unwrap().authenticated);
    assert_eq!(f.auth.callback(&callback), Err("CALLBACK_REJECTED"));
    assert_eq!(f.oidc.calls.load(Ordering::SeqCst), 1);
    let status = serde_json::to_string(&f.auth.status().unwrap()).unwrap();
    assert!(!status.contains("synthetic") && !status.contains("issuer"));
    f.clock.0.store(1500, Ordering::SeqCst);
    assert!(!f.auth.status().unwrap().authenticated);
    assert_eq!(f.auth.status().unwrap().error, Some("AUTH_EXPIRED"));
    f.clock.0.store(1000, Ordering::SeqCst);
    f.auth.begin().unwrap();
    f.auth.cancel().unwrap();
    assert!(f.store.load().unwrap().is_none());
    f.auth.begin().unwrap();
    f.auth.callback(&f.callback()).unwrap();
    f.auth.cancel().unwrap();
    assert!(!f.auth.status().unwrap().authenticated);
}

#[test]
fn cold_restore_and_expired_or_changed_binding_rejected() {
    let f = Fixture::new();
    f.auth.begin().unwrap();
    let callback = f.callback();
    f.restarted().callback(&callback).unwrap();
    let f = Fixture::new();
    f.auth.begin().unwrap();
    let callback = f.callback();
    f.clock.0.store(1300, Ordering::SeqCst);
    assert_eq!(f.restarted().callback(&callback), Err("CALLBACK_REJECTED"));
    assert_eq!(f.oidc.calls.load(Ordering::SeqCst), 0);
    assert!(f.store.load().unwrap().is_none());
    let f = Fixture::new();
    f.auth.begin().unwrap();
    let callback = f.callback();
    let mut tx = f.store.load().unwrap().unwrap();
    tx.config.client_id = "other".into();
    f.store.save(&tx).unwrap();
    assert_eq!(f.restarted().callback(&callback), Err("CALLBACK_REJECTED"));
    assert_eq!(f.oidc.calls.load(Ordering::SeqCst), 0);
}

#[test]
fn malformed_wrong_state_and_denial_preserve_or_consume_correct_item() {
    let f = Fixture::new();
    f.auth.begin().unwrap();
    let callback = f.callback();
    let state = f.store.load().unwrap().unwrap().state.clone();
    for bad in [
        callback.replace("oauth", "other"),
        format!("{callback}&code=duplicate"),
        format!("{callback}&error=denied"),
        format!("{callback}#fragment"),
        format!("{REDIRECT}?state={state}&code="),
        format!("{REDIRECT}?state={state}"),
        format!("{REDIRECT}?state={state}&error=denied&code="),
        callback.replace(&state, &"x".repeat(43)),
        format!("{callback}&iss=https://evil.test/"),
    ] {
        assert!(f.auth.callback(&bad).is_err());
        assert_eq!(f.store.load().unwrap().unwrap().state, state);
        assert_eq!(f.oidc.calls.load(Ordering::SeqCst), 0);
    }
    assert_eq!(
        f.auth
            .callback(&format!("{REDIRECT}?state={state}&error=access_denied")),
        Err("AUTH_DENIED")
    );
    assert!(f.store.load().unwrap().is_none());
    f.auth.begin().unwrap();
    f.auth.callback(&f.callback()).unwrap();
}

#[test]
fn storage_and_browser_failures_refuse_auth_and_recover_explicitly() {
    for fault in [1, 2, 4] {
        let f = Fixture::new();
        if fault == 4 {
            f.auth.begin().unwrap();
        }
        let callback = if fault == 4 { Some(f.callback()) } else { None };
        f.store.faults.store(fault, Ordering::SeqCst);
        assert_eq!(
            match callback {
                Some(c) => f.auth.callback(&c),
                None => f.auth.begin(),
            },
            Err("AUTH_STORAGE_FAILED")
        );
        assert!(!f.auth.status().unwrap().authenticated);
        assert_eq!(f.oidc.calls.load(Ordering::SeqCst), 0);
        assert_eq!(f.auth.begin(), Err("AUTH_STORAGE_FAILED"));
        f.store.faults.store(0, Ordering::SeqCst);
        f.auth.cancel().unwrap();
        f.auth.begin().unwrap();
        f.auth.callback(&f.callback()).unwrap();
    }
    let f = Fixture::new();
    f.browser.fail.store(true, Ordering::SeqCst);
    assert_eq!(f.auth.begin(), Err("BROWSER_FAILED"));
    assert!(f.store.load().unwrap().is_none());
    f.browser.fail.store(false, Ordering::SeqCst);
    f.auth.begin().unwrap();
    f.auth.callback(&f.callback()).unwrap();
}

#[test]
fn strict_missing_delete_never_becomes_success() {
    let store = MemoryStore::default();
    assert!(store.delete().is_err());
    // Simulate an item disappearing between read and delete using the same production controller.
    struct Vanishing(Arc<MemoryStore>);
    impl Store for Vanishing {
        fn load(&self) -> Result<Option<Transaction>, Error> {
            let tx = self.0.load()?;
            self.0.value.lock().unwrap().take();
            Ok(tx)
        }
        fn save(&self, tx: &Transaction) -> Result<(), Error> {
            self.0.save(tx)
        }
        fn delete(&self) -> Result<(), Error> {
            self.0.delete()
        }
    }
    let f = Fixture::new();
    f.auth.begin().unwrap();
    let callback = f.callback();
    let auth = Auth::new(
        Ok(Some(config())),
        Arc::new(Vanishing(f.store.clone())),
        f.browser.clone(),
        f.clock.clone(),
        f.oidc.clone(),
    );
    assert_eq!(auth.callback(&callback), Err("AUTH_STORAGE_FAILED"));
    assert_eq!(f.oidc.calls.load(Ordering::SeqCst), 0);
}

#[test]
fn cancel_old_prepare_or_exchange_success_and_failure_cannot_touch_new_login() {
    for prepare in [true, false] {
        for fail in [false, true] {
            let f = Fixture::new();
            let (gate, entered) = Gate::new();
            let callback = if prepare {
                None
            } else {
                f.auth.begin().unwrap();
                Some(f.callback())
            };
            if prepare {
                *f.oidc.prepare_gate.lock().unwrap() = Some(gate.clone());
            } else {
                *f.oidc.exchange_gate.lock().unwrap() = Some(gate.clone());
            }
            let auth = f.auth.clone();
            let worker = std::thread::spawn(move || match callback {
                Some(c) => auth.callback(&c),
                None => auth.begin(),
            });
            entered.recv_timeout(Duration::from_secs(2)).unwrap();
            f.auth.cancel().unwrap();
            f.auth.begin().unwrap();
            let next = f.callback();
            let flag = if prepare {
                &f.oidc.fail_prepare
            } else {
                &f.oidc.fail_exchange
            };
            flag.store(fail, Ordering::SeqCst);
            gate.release();
            assert_eq!(worker.join().unwrap(), Err("AUTH_CANCELLED"));
            assert_eq!(f.callback(), next);
            assert_eq!(f.auth.status().unwrap().phase, "waiting");
            flag.store(false, Ordering::SeqCst);
            f.auth.callback(&next).unwrap();
            assert!(f.auth.status().unwrap().authenticated);
        }
    }
}

#[test]
fn concurrent_callbacks_exchange_at_most_once() {
    let f = Fixture::new();
    f.auth.begin().unwrap();
    let callback = f.callback();
    let (gate, entered) = Gate::new();
    *f.oidc.exchange_gate.lock().unwrap() = Some(gate.clone());
    let auth = f.auth.clone();
    let first = callback.clone();
    let worker = std::thread::spawn(move || auth.callback(&first));
    entered.recv_timeout(Duration::from_secs(2)).unwrap();
    assert_eq!(f.auth.callback(&callback), Err("CALLBACK_REJECTED"));
    assert_eq!(f.oidc.calls.load(Ordering::SeqCst), 1);
    gate.release();
    worker.join().unwrap().unwrap();
    assert!(f.auth.status().unwrap().authenticated);
}

#[test]
fn cancelled_cold_callback_and_expiry_during_exchange_never_publish() {
    let f = Fixture::new();
    f.auth.begin().unwrap();
    let callback = f.callback();
    f.auth.cancel().unwrap();
    assert_eq!(f.restarted().callback(&callback), Err("CALLBACK_REJECTED"));
    let f = Fixture::new();
    f.auth.begin().unwrap();
    let callback = f.callback();
    let (gate, entered) = Gate::new();
    *f.oidc.exchange_gate.lock().unwrap() = Some(gate.clone());
    let auth = f.auth.clone();
    let worker = std::thread::spawn(move || auth.callback(&callback));
    entered.recv_timeout(Duration::from_secs(2)).unwrap();
    f.clock.0.store(1300, Ordering::SeqCst);
    gate.release();
    assert_eq!(worker.join().unwrap(), Err("IDENTITY_INVALID"));
    assert!(!f.auth.status().unwrap().authenticated);
}

#[test]
fn null_configuration_has_no_store_browser_or_http_effect() {
    let f = Fixture::new();
    f.store.faults.store(7, Ordering::SeqCst);
    let auth = Auth::new(
        Ok(None),
        f.store.clone(),
        f.browser.clone(),
        f.clock.clone(),
        f.oidc.clone(),
    );
    assert_eq!(auth.status().unwrap().phase, "unconfigured");
    assert!(auth.begin().is_err() && auth.cancel().is_err());
    assert_eq!(f.browser.calls.load(Ordering::SeqCst), 0);
    assert_eq!(f.oidc.calls.load(Ordering::SeqCst), 0);
}

#[test]
fn expired_waiting_login_can_begin_again_without_sticking_busy() {
    let f = Fixture::new();
    f.auth.begin().unwrap();
    let old = f.callback();
    f.clock.0.store(1300, Ordering::SeqCst);
    f.auth.begin().unwrap();
    assert_ne!(old, f.callback());
    assert_eq!(f.auth.callback(&old), Err("CALLBACK_REJECTED"));
    assert!(f.store.load().unwrap().is_some());
    f.auth.callback(&f.callback()).unwrap();
    assert!(f.auth.status().unwrap().authenticated);
}

// Independent Keycloak 26.8.1 observation supplied only these response keys:
// code, iss, session_state, state. Every value here is synthetic test data.
fn keycloak_callback(fixture: &Fixture, session_state: Option<&str>) -> String {
    let tx = fixture.store.load().unwrap().unwrap();
    let mut url = Url::parse(REDIRECT).unwrap();
    let mut query = url.query_pairs_mut();
    query.append_pair("code", "offline-code");
    query.append_pair("iss", &tx.config.issuer);
    if let Some(value) = session_state {
        query.append_pair("session_state", value);
    }
    query.append_pair("state", &tx.state);
    drop(query);
    url.to_string()
}

#[test]
fn keycloak_observed_callback_keys_succeed_warm_and_cold_once() {
    for cold in [false, true] {
        let f = Fixture::new();
        f.auth.begin().unwrap();
        let metadata = "24bbce62-a6bc-4f7e-a331-27918ff115c3";
        let callback = keycloak_callback(&f, Some(metadata));
        let auth = if cold {
            Arc::new(f.restarted())
        } else {
            f.auth.clone()
        };
        auth.callback(&callback).unwrap();
        assert!(auth.status().unwrap().authenticated);
        assert!(f.store.load().unwrap().is_none());
        assert_eq!(f.store.deletes.load(Ordering::SeqCst), 1);
        assert_eq!(f.oidc.calls.load(Ordering::SeqCst), 1);
        assert!(!serde_json::to_string(&auth.status().unwrap())
            .unwrap()
            .contains(metadata));
        assert_eq!(auth.callback(&callback), Err("CALLBACK_REJECTED"));
        assert_eq!(f.store.deletes.load(Ordering::SeqCst), 1);
        assert_eq!(f.oidc.calls.load(Ordering::SeqCst), 1);
    }
}

#[test]
fn optional_session_state_has_bounded_opaque_metadata_semantics() {
    let maximum = "S".repeat(256);
    for metadata in [None, Some("a"), Some("AZaz09-_.~"), Some(maximum.as_str())] {
        let f = Fixture::new();
        f.auth.begin().unwrap();
        f.auth.callback(&keycloak_callback(&f, metadata)).unwrap();
        assert!(f.auth.status().unwrap().authenticated);
        assert_eq!(f.oidc.calls.load(Ordering::SeqCst), 1);
    }
}

#[test]
fn bad_or_duplicate_session_state_is_rejected_before_consuming_valid_transaction() {
    for cold in [false, true] {
        let f = Fixture::new();
        f.auth.begin().unwrap();
        let auth = if cold {
            Arc::new(f.restarted())
        } else {
            f.auth.clone()
        };
        let valid = keycloak_callback(&f, Some("offline-session"));
        let state = f.store.load().unwrap().unwrap().state.clone();
        for metadata in [
            "".to_owned(),
            "a".repeat(257),
            "with space".into(),
            "\0".into(),
            "\n".into(),
            "\u{7f}".into(),
            "中文".into(),
            "a&state=b".into(),
            "https://other.test/".into(),
            "\u{fffd}".into(),
        ] {
            let callback = keycloak_callback(&f, Some(&metadata));
            assert_eq!(auth.callback(&callback), Err("CALLBACK_INVALID"));
            assert_eq!(f.store.load().unwrap().unwrap().state, state);
            assert_eq!(f.store.deletes.load(Ordering::SeqCst), 0);
            assert_eq!(f.oidc.calls.load(Ordering::SeqCst), 0);
        }
        for callback in [
            format!("{valid}&session_state=other"),
            format!("{valid}&%73ession_state=other"),
            format!("{valid}&unknown_metadata=ignored"),
        ] {
            assert_eq!(auth.callback(&callback), Err("CALLBACK_INVALID"));
            assert_eq!(f.store.load().unwrap().unwrap().state, state);
            assert_eq!(f.store.deletes.load(Ordering::SeqCst), 0);
            assert_eq!(f.oidc.calls.load(Ordering::SeqCst), 0);
        }
        auth.callback(&valid).unwrap();
        assert!(auth.status().unwrap().authenticated);
    }
}

#[test]
fn session_state_cannot_replace_state_issuer_or_cancel_new_transaction() {
    let f = Fixture::new();
    f.auth.begin().unwrap();
    let original = keycloak_callback(&f, Some("offline-session"));
    let state = f.store.load().unwrap().unwrap().state.clone();
    // Even metadata equal to the correct state cannot authorize a wrong actual state.
    let mut bad_state = Url::parse(&keycloak_callback(&f, Some(&state))).unwrap();
    let pairs: Vec<_> = bad_state
        .query_pairs()
        .map(|(key, value)| {
            let value = if key == "state" {
                "x".repeat(43)
            } else {
                value.into_owned()
            };
            (key.into_owned(), value)
        })
        .collect();
    bad_state.set_query(None);
    bad_state.query_pairs_mut().extend_pairs(pairs);
    assert_eq!(
        f.auth.callback(bad_state.as_str()),
        Err("CALLBACK_REJECTED")
    );
    let bad_issuer = original.replace("issuer.example.test", "other.example.test");
    assert_eq!(f.auth.callback(&bad_issuer), Err("CALLBACK_INVALID"));
    assert_eq!(f.store.load().unwrap().unwrap().state, state);
    assert_eq!(f.store.deletes.load(Ordering::SeqCst), 0);
    assert_eq!(f.oidc.calls.load(Ordering::SeqCst), 0);
    f.auth.cancel().unwrap();
    f.auth.begin().unwrap();
    let next = keycloak_callback(&f, Some("different-offline-session"));
    let next_state = f.store.load().unwrap().unwrap().state.clone();
    assert_eq!(f.auth.callback(&original), Err("CALLBACK_REJECTED"));
    assert_eq!(f.store.load().unwrap().unwrap().state, next_state);
    f.auth.callback(&next).unwrap();
    assert!(f.auth.status().unwrap().authenticated);
}
