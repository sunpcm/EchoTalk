use super::*;
use crate::auth::tests::MediaAuthFixture;
use std::collections::VecDeque;
use std::sync::{mpsc, Condvar};

const ID: &str = "12345678-1234-4234-8234-123456789abc";
const OTHER_ID: &str = "87654321-4321-4321-8321-abcdef123456";
const TOKEN: &str = concat!("e30.", "eyJleHAiOjE0MDB9", ".c2ln"); // synthetic, exp=1400

struct Seen {
    method: Method,
    url: String,
    bearer: String,
    body: Vec<u8>,
}
struct Step {
    response: Result<Response, Error>,
    hook: Option<Box<dyn FnOnce() + Send>>,
}
impl Step {
    fn json(status: u16, body: &str) -> Self {
        Self {
            response: Ok(Response {
                status,
                body: Zeroizing::new(body.as_bytes().to_vec()),
            }),
            hook: None,
        }
    }
    fn hook(mut self, hook: impl FnOnce() + Send + 'static) -> Self {
        self.hook = Some(Box::new(hook));
        self
    }
}
#[derive(Default)]
struct Script {
    steps: Mutex<VecDeque<Step>>,
    seen: Mutex<Vec<Seen>>,
}
impl Script {
    fn add(&self, steps: impl IntoIterator<Item = Step>) {
        self.steps.lock().unwrap().extend(steps);
    }
    fn count(&self) -> usize {
        self.seen.lock().unwrap().len()
    }
    fn drained(&self) {
        assert!(self.steps.lock().unwrap().is_empty());
    }
}
impl Http for Script {
    fn send(&self, request: Request<'_>) -> Result<Response, Error> {
        self.seen.lock().unwrap().push(Seen {
            method: request.method,
            url: request.url,
            bearer: request.bearer.to_owned(),
            body: request.body.to_vec(),
        });
        let step = self
            .steps
            .lock()
            .unwrap()
            .pop_front()
            .expect("unexpected HTTP call");
        if let Some(hook) = step.hook {
            hook();
        }
        step.response
    }
}

fn configured() -> Result<Option<MediaConfig>, Error> {
    parse_config(
        r#"{"version":1,"api_origin":"https://api.example.test","media_origins":["wss://room.example.test"]}"#,
    )
}
fn caps() -> Step {
    Step::json(
        200,
        r#"{"protocol_version":1,"call_lease_mode":"disabled"}"#,
    )
}
fn session(id: &str, status: &str) -> Step {
    Step::json(
        200,
        &format!(
            r#"{{"id":"{id}","status":"{status}","user_id":"synthetic","mode":"free_talk","transcripts":[]}}"#
        ),
    )
}
fn token(value: &str, ws_url: &str) -> Step {
    Step::json(
        200,
        &format!(r#"{{"token":"{value}","ws_url":"{ws_url}"}}"#),
    )
}
fn room_token() -> Step {
    token(TOKEN, "wss://room.example.test")
}
fn dispatch_ok() -> Step {
    Step::json(200, r#"{"dispatched":true}"#)
}
fn normal_prepare() -> [Step; 3] {
    [caps(), session(ID, "active"), room_token()]
}

struct Fixture {
    identity: MediaAuthFixture,
    http: Arc<Script>,
    media: Arc<Media>,
}
impl Fixture {
    fn new() -> Self {
        let identity = MediaAuthFixture::new();
        let http = Arc::new(Script::default());
        let media = Arc::new(Media::new(
            configured(),
            identity.auth(),
            http.clone(),
            identity.clock(),
        ));
        Self {
            identity,
            http,
            media,
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
        assert!(
            *released && !timeout.timed_out(),
            "synthetic HTTP gate must release"
        );
    }
    fn release(&self) {
        *self.released.lock().unwrap() = true;
        self.cond.notify_all();
    }
}

#[test]
fn strict_disabled_and_enabled_config() {
    assert!(parse_config(include_str!("../media-config.json"))
        .unwrap()
        .is_none());
    assert!(configured().unwrap().is_some());
    for raw in [
        r#"{}"#,
        r#"{"version":1,"media_origins":[]}"#,
        r#"{"version":1,"api_origin":null}"#,
        r#"{"version":2,"api_origin":null,"media_origins":[]}"#,
        r#"{"version":1,"api_origin":null,"media_origins":[],"env":true}"#,
        r#"{"version":1,"version":1,"api_origin":null,"media_origins":[]}"#,
        r#"{"version":1,"api_origin":null,"api_origin":null,"media_origins":[]}"#,
        r#"{"version":1,"api_origin":null,"media_origins":["wss://room.example.test"]}"#,
        r#"{"version":1,"api_origin":"https://api.example.test","media_origins":[]}"#,
    ] {
        assert!(parse_config(raw).is_err(), "must fail strict schema");
    }
    assert!(parse_config(&" ".repeat(16385)).is_err());
}

#[test]
fn reject_origin_injection_without_network() {
    for invalid in [
        "http://api.example.test",
        "https://api.example.test/",
        "https://api.example.test/path",
        "https://user@api.example.test",
        "https://api.example.test?x=1",
        "https://api.example.test#x",
        "https://API.example.test",
        "https://api.example.test:443",
        "https://api.example.test/%2f",
        "https://api.example.test/../",
        "https://api.example.test\\path",
        "https://api.example.test\n",
    ] {
        assert!(!origin(invalid, "https"), "rejected before transport");
    }
    let mut config = configured().unwrap().unwrap();
    assert!(!config.allows_media("wss://attacker.example.test"));
    assert!(!config.allows_media("wss://room.example.test/path"));
    assert!(!config.allows_media("ws://room.example.test"));
    config.media_origins.push(config.media_origins[0].clone());
    assert!(!config.valid());
    assert!(origin("https://localhost:9443", "https"));
}

#[test]
fn actual_fixed_request_order_body_and_safe_ipc_shapes() {
    let f = Fixture::new();
    f.http.add(normal_prepare());
    f.http.add([dispatch_ok(), session(ID, "completed")]);
    let grant = f.media.prepare().unwrap();
    assert_eq!(grant.expires_at, 1400);
    assert_eq!(grant.session_id, ID);
    assert_eq!(grant.token, TOKEN);
    assert_eq!(grant.ws_url, "wss://room.example.test");
    assert_ne!(grant.token, f.identity.auth().lease().unwrap().bearer());
    let grant_json = serde_json::to_value(&grant).unwrap();
    let mut keys = grant_json
        .as_object()
        .unwrap()
        .keys()
        .map(String::as_str)
        .collect::<Vec<_>>();
    keys.sort();
    assert_eq!(
        keys,
        ["expires_at", "generation", "session_id", "token", "ws_url"]
    );
    assert_eq!(f.media.dispatch(grant.generation).unwrap().phase, "active");
    assert!(f.media.dispatch(grant.generation).is_err());
    let status = f.media.stop().unwrap();
    assert_eq!(status.phase, "stopped");
    assert_eq!(status.end_state, "ended");
    let json = serde_json::to_value(&status).unwrap();
    let mut keys = json
        .as_object()
        .unwrap()
        .keys()
        .map(String::as_str)
        .collect::<Vec<_>>();
    keys.sort();
    assert_eq!(
        keys,
        ["end_state", "error", "generation", "phase", "session_id"]
    );
    let seen = f.http.seen.lock().unwrap();
    let expected = [
        (Method::Get, "/api/call-capabilities", b"".as_slice()),
        (
            Method::Post,
            "/api/sessions",
            br#"{"mode":"free_talk"}"#.as_slice(),
        ),
        (
            Method::Get,
            "/api/sessions/12345678-1234-4234-8234-123456789abc/token",
            b"".as_slice(),
        ),
        (
            Method::Post,
            "/api/sessions/12345678-1234-4234-8234-123456789abc/dispatch",
            b"".as_slice(),
        ),
        (
            Method::Post,
            "/api/sessions/12345678-1234-4234-8234-123456789abc/end",
            b"".as_slice(),
        ),
    ];
    assert_eq!(seen.len(), expected.len());
    for (request, (method, path, body)) in seen.iter().zip(expected) {
        assert_eq!(request.method, method);
        assert_eq!(request.url, format!("https://api.example.test{path}"));
        assert_eq!(request.body, body);
        assert_eq!(request.bearer, "synthetic-old-bearer");
    }
    assert!(!serde_json::to_string(&status)
        .unwrap()
        .contains("synthetic"));
    assert!(f.media.lock().unwrap().lease.is_none());
    f.http.drained();
}

#[test]
fn unconfigured_invalid_config_and_unauthenticated_never_send() {
    let f = Fixture::new();
    for config in [Ok(None), Err("raw injected secret")] {
        let media = Media::new(
            config,
            f.identity.auth(),
            f.http.clone(),
            f.identity.clock(),
        );
        assert_eq!(media.status().unwrap().phase, "unconfigured");
        assert!(media.prepare().is_err());
        assert_eq!(media.stop().unwrap().phase, "unconfigured");
    }
    f.identity.auth().cancel().unwrap();
    assert!(f.media.prepare().is_err());
    assert_eq!(f.http.count(), 0);
}

#[test]
fn capabilities_fail_closed_before_create() {
    for (code, response) in [
        (
            200,
            r#"{"protocol_version":1,"call_lease_mode":"livekit_cloud"}"#,
        ),
        (
            200,
            r#"{"protocol_version":2,"call_lease_mode":"disabled"}"#,
        ),
        (
            200,
            r#"{"protocol_version":1,"call_lease_mode":"disabled","extra":true}"#,
        ),
        (
            200,
            r#"{"protocol_version":1,"protocol_version":1,"call_lease_mode":"disabled"}"#,
        ),
        (302, "raw secret redirect"),
        (403, "raw secret forbidden"),
        (200, "not JSON"),
    ] {
        let f = Fixture::new();
        f.http.add([Step::json(code, response)]);
        assert!(f.media.prepare().is_err());
        assert_eq!(f.http.count(), 1);
        assert_eq!(f.media.status().unwrap().end_state, "not_needed");
        assert!(!serde_json::to_string(&f.media.status().unwrap())
            .unwrap()
            .contains("raw secret"));
    }
}

#[test]
fn unknown_create_result_remains_blocked_without_retry() {
    for response in [
        Step {
            response: Err("secret in adapter failure"),
            hook: None,
        },
        Step::json(500, "secret in server failure"),
        Step::json(302, "redirect"),
        Step::json(200, "not JSON"),
        Step::json(200, r#"{"id":"../attack","status":"active"}"#),
        Step::json(
            200,
            r#"{"id":"00000000-0000-0000-0000-000000000000","status":"active"}"#,
        ),
        Step::json(200, &"x".repeat(MAX_BODY + 1)),
    ] {
        let f = Fixture::new();
        f.http.add([caps(), response]);
        assert!(f.media.prepare().is_err());
        for _ in 0..3 {
            let status = f.media.stop().unwrap();
            assert_eq!(status.phase, "blocked");
            assert_eq!(status.end_state, "unknown");
            assert!(f.media.prepare().is_err());
            assert_eq!(f.media.status().unwrap().phase, "blocked");
        }
        assert_eq!(f.http.count(), 2);
        assert!(f.media.lock().unwrap().lease.is_none());
    }
}

#[test]
fn definite_create_rejection_can_be_explicitly_retried() {
    let f = Fixture::new();
    f.http.add([caps(), Step::json(422, "secret body")]);
    assert!(f.media.prepare().is_err());
    assert_eq!(f.media.status().unwrap().phase, "failed");
    f.http.add(normal_prepare());
    assert!(f.media.prepare().is_ok());
    assert_eq!(f.http.count(), 5);
}

#[test]
fn known_create_with_bad_status_is_still_cleaned() {
    for body in [
        format!(r#"{{"id":"{ID}","status":"completed"}}"#),
        format!(r#"{{"id":"{ID}","status":123}}"#),
        format!(r#"{{"id":"{ID}"}}"#),
    ] {
        let f = Fixture::new();
        f.http
            .add([caps(), Step::json(200, &body), session(ID, "completed")]);
        assert!(f.media.prepare().is_err());
        let status = f.media.status().unwrap();
        assert_eq!(status.phase, "failed");
        assert_eq!(status.end_state, "ended");
        assert_eq!(f.http.count(), 3);
        assert!(f.http.seen.lock().unwrap()[2]
            .url
            .ends_with(&format!("/{ID}/end")));
    }
}

#[test]
fn token_validation_errors_end_only_owned_session() {
    for step in [
        token(TOKEN, "wss://attacker.example.test"),
        token(TOKEN, "wss://room.example.test/path"),
        token("synthetic-oidc-bearer", "wss://room.example.test"),
        token(
            concat!("e30.", "eyJleHAiOjk5OX0", ".c2ln"),
            "wss://room.example.test",
        ), // exp=999
        Step::json(
            200,
            r#"{"token":"x","ws_url":"wss://room.example.test","extra":1}"#,
        ),
        Step::json(200, &"x".repeat(MAX_BODY + 1)),
        Step::json(401, "secret response body"),
    ] {
        let f = Fixture::new();
        f.http.add([
            caps(),
            session(ID, "active"),
            step,
            session(ID, "completed"),
        ]);
        assert!(f.media.prepare().is_err());
        assert_eq!(f.media.status().unwrap().end_state, "ended");
        assert_eq!(f.http.count(), 4);
        assert!(f.media.lock().unwrap().lease.is_none());
    }
}

#[test]
fn grant_expiry_is_bounded_by_auth_and_room_expiry() {
    let f = Fixture::new();
    f.http.add([
        caps(),
        session(ID, "active"),
        token(
            concat!("e30.", "eyJleHAiOjIwMDB9", ".c2ln"),
            "wss://room.example.test",
        ),
    ]);
    assert_eq!(f.media.prepare().unwrap().expires_at, 1500);
    for token in [
        "",
        "a.b.c",
        "a.abcde.c",
        "a.ab.c",
        "a.e30.c",
        concat!("a.", "eyJleHAiOi0xfQ", ".c"),
        concat!("a.", "eyJleHAiOjEuMn0", ".c"),
    ] {
        assert!(room_expiry(token).is_err());
    }
    assert_eq!(room_expiry(TOKEN).unwrap(), 1400);
    assert!(room_expiry(&"x".repeat(MAX_TOKEN + 1)).is_err());
}

#[test]
fn stale_and_malicious_dispatch_generations_send_nothing() {
    let f = Fixture::new();
    f.http.add(normal_prepare());
    let grant = f.media.prepare().unwrap();
    for generation in [0, MAX_GENERATION + 1, grant.generation + 1] {
        assert!(f.media.dispatch(generation).is_err());
    }
    assert!(f.media.prepare().is_err());
    assert_eq!(f.http.count(), 3);
}

#[test]
fn dispatch_failure_cleans_and_cannot_retry_same_grant() {
    for step in [
        Step::json(200, r#"{"dispatched":false}"#),
        Step::json(200, r#"{"dispatched":true,"secret":"x"}"#),
        Step::json(502, "raw secret"),
        Step {
            response: Err("raw secret"),
            hook: None,
        },
    ] {
        let f = Fixture::new();
        f.http.add(normal_prepare());
        f.http.add([step, session(ID, "completed")]);
        let grant = f.media.prepare().unwrap();
        assert!(f.media.dispatch(grant.generation).is_err());
        assert!(f.media.dispatch(grant.generation).is_err());
        assert_eq!(f.media.status().unwrap().end_state, "ended");
        assert_eq!(f.http.count(), 5);
    }
}

#[test]
fn stop_during_each_prepare_stage_is_bounded_and_cleans_late_create() {
    for blocked_stage in 0..3 {
        let f = Fixture::new();
        let (gate, entered) = Gate::new();
        let blocking = gate.clone();
        let mut steps = normal_prepare()
            .into_iter()
            .take(blocked_stage + 1)
            .collect::<Vec<_>>();
        steps[blocked_stage].hook = Some(Box::new(move || blocking.block()));
        if blocked_stage > 0 {
            steps.push(session(ID, "completed"));
        }
        f.http.add(steps);
        let media = f.media.clone();
        let worker = std::thread::spawn(move || media.prepare());
        entered.recv_timeout(Duration::from_secs(2)).unwrap();
        assert!(f.media.prepare().is_err());
        let stop = f.media.stop().unwrap();
        assert_eq!(stop.phase, "stopping");
        assert_eq!(stop.end_state, "pending");
        assert_eq!(stop.error, None);
        // Reentrant cancellation/status do not wait for HTTP or schedule more work.
        assert_eq!(f.media.stop().unwrap().phase, "stopping");
        assert_eq!(f.media.status().unwrap().phase, "stopping");
        assert!(f.media.prepare().is_err());
        gate.release();
        assert!(worker.join().unwrap().is_err());
        let status = f.media.status().unwrap();
        assert_eq!(status.phase, "stopped");
        assert_eq!(status.error, None);
        assert_eq!(
            status.end_state,
            if blocked_stage == 0 {
                "not_needed"
            } else {
                "ended"
            }
        );
        assert_eq!(
            f.http.count(),
            blocked_stage + 1 + usize::from(blocked_stage > 0)
        );
        f.http.drained();
    }
}

#[test]
fn stop_during_dispatch_does_not_dispatch_twice_or_leak_into_new_session() {
    let f = Fixture::new();
    f.http.add(normal_prepare());
    let grant = f.media.prepare().unwrap();
    let (gate, entered) = Gate::new();
    let blocking = gate.clone();
    f.http.add([
        dispatch_ok().hook(move || blocking.block()),
        session(ID, "completed"),
    ]);
    let media = f.media.clone();
    let generation = grant.generation;
    let worker = std::thread::spawn(move || media.dispatch(generation));
    entered.recv_timeout(Duration::from_secs(2)).unwrap();
    assert!(f.media.dispatch(generation).is_err());
    assert_eq!(f.media.stop().unwrap().phase, "stopping");
    assert!(f.media.prepare().is_err());
    gate.release();
    assert!(worker.join().unwrap().is_err());
    f.http
        .add([caps(), session(OTHER_ID, "active"), room_token()]);
    let next = f.media.prepare().unwrap();
    assert!(next.generation > generation);
    assert_eq!(next.session_id, OTHER_ID);
    assert!(f.media.dispatch(generation).is_err());
    // A stale status reconciliation is not allowed to cancel the new generation.
    let status = f.media.stop_if_generation(Some(generation), None).unwrap();
    assert_eq!(status.phase, "prepared");
    assert_eq!(status.session_id.as_deref(), Some(OTHER_ID));
    assert_eq!(f.http.count(), 8);
}

#[test]
fn late_401_and_cleanup_use_old_principal_and_preserve_new_login() {
    let f = Fixture::new();
    let (gate, entered) = Gate::new();
    let blocking = gate.clone();
    f.http.add([
        caps(),
        session(ID, "active"),
        Step::json(401, "secret").hook(move || blocking.block()),
        session(ID, "completed"),
    ]);
    let media = f.media.clone();
    let worker = std::thread::spawn(move || media.prepare());
    entered.recv_timeout(Duration::from_secs(2)).unwrap();
    f.identity.login("synthetic-new-bearer");
    gate.release();
    assert!(worker.join().unwrap().is_err());
    assert!(f.identity.auth().status().unwrap().authenticated);
    assert_eq!(
        f.identity.auth().lease().unwrap().bearer(),
        "synthetic-new-bearer"
    );
    assert_eq!(f.media.status().unwrap().end_state, "ended");
    assert!(f
        .http
        .seen
        .lock()
        .unwrap()
        .iter()
        .all(|r| r.bearer == "synthetic-old-bearer"));
}

#[test]
fn matching_401_invalidates_only_that_auth_generation() {
    let f = Fixture::new();
    f.http.add([Step::json(401, "secret")]);
    assert!(f.media.prepare().is_err());
    assert!(!f.identity.auth().status().unwrap().authenticated);
    assert_eq!(f.http.count(), 1);
    assert_eq!(f.media.status().unwrap().end_state, "not_needed");
}

#[test]
fn late_success_after_identity_change_is_cleaned_without_grant_publication() {
    let f = Fixture::new();
    let (gate, entered) = Gate::new();
    let blocking = gate.clone();
    f.http.add([
        caps(),
        session(ID, "active").hook(move || blocking.block()),
        session(ID, "completed"),
    ]);
    let media = f.media.clone();
    let worker = std::thread::spawn(move || media.prepare());
    entered.recv_timeout(Duration::from_secs(2)).unwrap();
    f.identity.login("synthetic-new-bearer");
    assert_eq!(f.media.status().unwrap().phase, "stopping");
    gate.release();
    assert!(worker.join().unwrap().is_err());
    assert_eq!(f.media.status().unwrap().end_state, "ended");
    assert_eq!(f.http.count(), 3);
    assert_eq!(
        f.http.seen.lock().unwrap()[2].bearer,
        "synthetic-old-bearer"
    );
}

#[test]
fn end_unknown_blocks_until_explicit_retry_with_same_old_bearer_and_id() {
    let f = Fixture::new();
    f.http.add(normal_prepare());
    f.media.prepare().unwrap();
    f.http.add([Step::json(500, "secret")]);
    assert_eq!(f.media.stop().unwrap().phase, "blocked");
    f.identity.login("synthetic-new-bearer");
    for _ in 0..4 {
        let status = f.media.status().unwrap();
        assert_eq!(status.phase, "blocked");
        assert_eq!(status.end_state, "unknown");
        assert_eq!(status.error, Some("MEDIA_END_UNKNOWN"));
        assert!(f.media.prepare().is_err());
    }
    assert_eq!(f.http.count(), 4); // Polling never retries end.
    f.http.add([session(ID, "completed")]);
    assert_eq!(f.media.stop().unwrap().end_state, "ended");
    assert_eq!(
        f.http.seen.lock().unwrap()[4].bearer,
        "synthetic-old-bearer"
    );
    assert!(f.identity.auth().status().unwrap().authenticated);
    assert!(f.media.lock().unwrap().lease.is_none());
}

#[test]
fn end_response_must_confirm_exact_owned_uuid_and_completed_status() {
    for step in [
        session(OTHER_ID, "completed"),
        session(ID, "active"),
        Step::json(204, ""),
        Step::json(404, "not found"),
        Step::json(302, "redirect"),
        Step {
            response: Err("secret timeout"),
            hook: None,
        },
    ] {
        let f = Fixture::new();
        f.http.add(normal_prepare());
        f.media.prepare().unwrap();
        f.http.add([step]);
        let status = f.media.stop().unwrap();
        assert_eq!(status.phase, "blocked");
        assert_eq!(status.end_state, "unknown");
        assert_eq!(status.session_id.as_deref(), Some(ID));
    }
}

#[test]
fn stopping_while_end_in_flight_never_spawns_or_queues_more_cleanup() {
    let f = Fixture::new();
    f.http.add(normal_prepare());
    f.media.prepare().unwrap();
    let (gate, entered) = Gate::new();
    let blocking = gate.clone();
    f.http
        .add([session(ID, "completed").hook(move || blocking.block())]);
    let media = f.media.clone();
    let worker = std::thread::spawn(move || media.stop());
    entered.recv_timeout(Duration::from_secs(2)).unwrap();
    for _ in 0..3 {
        assert_eq!(f.media.stop().unwrap().phase, "stopping");
        assert!(f.media.prepare().is_err());
    }
    assert_eq!(f.http.count(), 4);
    gate.release();
    assert_eq!(worker.join().unwrap().unwrap().end_state, "ended");
}

#[test]
fn auth_cancel_and_expiry_stop_prepared_media_before_dispatch() {
    for expire in [false, true] {
        let f = Fixture::new();
        f.http.add(normal_prepare());
        let grant = f.media.prepare().unwrap();
        if expire {
            f.identity.time(1500);
        } else {
            f.identity.auth().cancel().unwrap();
        }
        f.http.add([session(ID, "completed")]);
        assert!(f.media.dispatch(grant.generation).is_err());
        assert_eq!(f.media.status().unwrap().end_state, "ended");
        assert_eq!(f.http.count(), 4);
    }
}

#[test]
fn status_expiry_reconciles_once_and_room_expiry_is_enforced_at_dispatch() {
    for use_status in [false, true] {
        let f = Fixture::new();
        f.http.add(normal_prepare());
        let grant = f.media.prepare().unwrap();
        f.identity.time(1400);
        f.http.add([session(ID, "completed")]);
        if use_status {
            assert_eq!(f.media.status().unwrap().end_state, "ended");
        } else {
            assert!(f.media.dispatch(grant.generation).is_err());
        }
        for _ in 0..3 {
            f.media.status().unwrap();
        }
        assert_eq!(f.http.count(), 4);
    }
}

#[test]
fn generation_exhaustion_reserves_a_cancellation_generation() {
    let f = Fixture::new();
    f.media.lock().unwrap().status.generation = MAX_GENERATION - 2;
    f.http.add(normal_prepare());
    let grant = f.media.prepare().unwrap();
    assert_eq!(grant.generation, MAX_GENERATION - 1);
    f.http.add([session(ID, "completed")]);
    assert_eq!(f.media.stop().unwrap().generation, MAX_GENERATION);
    assert!(f.media.prepare().is_err());
    assert_eq!(f.media.stop().unwrap().end_state, "ended");
    assert_eq!(f.http.count(), 4);
}

#[test]
fn request_mapper_rejects_uuid_injection_before_transport() {
    let f = Fixture::new();
    let lease = f.identity.auth().lease().unwrap();
    for id in [
        "../token",
        "x?token=secret",
        "",
        "12345678-1234-4234-8234-123456789abz",
    ] {
        for operation in [
            Operation::Token(id),
            Operation::Dispatch(id),
            Operation::End(id),
        ] {
            assert!(f.media.request(operation, &lease).is_err());
        }
    }
    assert_eq!(f.http.count(), 0);
}

#[test]
fn bounded_reader_checks_declared_chunked_and_failing_streams() {
    assert_eq!(bounded_body(&b"ok"[..], Some(2)).unwrap().as_slice(), b"ok");
    assert!(bounded_body(&b""[..], Some(MAX_BODY as u64 + 1)).is_err());
    assert!(bounded_body(&vec![0u8; MAX_BODY + 1][..], None).is_err());
    assert_eq!(
        bounded_body(&vec![0u8; MAX_BODY][..], None).unwrap().len(),
        MAX_BODY
    );
    struct Broken;
    impl Read for Broken {
        fn read(&mut self, _: &mut [u8]) -> std::io::Result<usize> {
            Err(std::io::Error::other("synthetic confidential raw error"))
        }
    }
    assert_eq!(bounded_body(Broken, None).err(), Some("MEDIA_HTTP_FAILED"));
}

#[test]
fn reentrant_http_hook_proves_media_and_auth_locks_are_not_held_over_io() {
    let f = Fixture::new();
    let media = f.media.clone();
    let auth = f.identity.auth();
    f.http.add([caps().hook(move || {
        assert!(auth.lease().is_ok());
        assert_eq!(media.snapshot().unwrap().phase, "preparing");
        assert_eq!(media.stop().unwrap().phase, "stopping");
    })]);
    assert!(f.media.prepare().is_err());
    assert_eq!(f.media.status().unwrap().phase, "stopped");
    assert_eq!(f.http.count(), 1);
}

#[test]
fn frozen_receipts_pending_then_ended_allow_another_explicit_start() {
    let f = Fixture::new();
    let (gate, entered) = Gate::new();
    let blocking = gate.clone();
    f.http.add([
        caps(),
        session(ID, "active").hook(move || blocking.block()),
        session(ID, "completed"),
    ]);
    let media = f.media.clone();
    let worker = std::thread::spawn(move || media.prepare());
    entered.recv_timeout(Duration::from_secs(2)).unwrap();
    assert_eq!(
        serde_json::to_value(f.media.stop().unwrap()).unwrap(),
        serde_json::json!({
            "phase":"stopping", "generation":2, "session_id":null, "error":null, "end_state":"pending"
        })
    );
    gate.release();
    assert!(worker.join().unwrap().is_err());
    assert_eq!(
        serde_json::to_value(f.media.status().unwrap()).unwrap(),
        serde_json::json!({
            "phase":"stopped", "generation":2, "session_id":ID, "error":null, "end_state":"ended"
        })
    );
    f.http.add(normal_prepare());
    assert_eq!(f.media.prepare().unwrap().generation, 3);
}

#[test]
fn frozen_receipts_distinguish_disabled_known_failure_and_unknown() {
    let f = Fixture::new();
    let disabled = Media::new(
        Ok(None),
        f.identity.auth(),
        f.http.clone(),
        f.identity.clock(),
    );
    assert_eq!(
        serde_json::to_value(disabled.status().unwrap()).unwrap(),
        serde_json::json!({
            "phase":"unconfigured", "generation":0, "session_id":null,
            "error":"MEDIA_CONFIG_MISSING", "end_state":"not_needed"
        })
    );
    f.http.add([
        caps(),
        session(ID, "active"),
        token("invalid", "wss://room.example.test"),
        session(ID, "completed"),
    ]);
    assert!(f.media.prepare().is_err());
    assert_eq!(
        serde_json::to_value(f.media.status().unwrap()).unwrap(),
        serde_json::json!({
            "phase":"failed", "generation":1, "session_id":ID,
            "error":"MEDIA_TOKEN_INVALID", "end_state":"ended"
        })
    );
    // Real failure is historical after confirmed cleanup; the NEXT explicit start is permitted.
    f.http.add(normal_prepare());
    assert_eq!(f.media.prepare().unwrap().generation, 2);
    f.http.add([Step::json(500, "secret")]);
    assert_eq!(
        serde_json::to_value(f.media.stop().unwrap()).unwrap(),
        serde_json::json!({
            "phase":"blocked", "generation":3, "session_id":ID,
            "error":"MEDIA_END_UNKNOWN", "end_state":"unknown"
        })
    );
    assert!(f.media.prepare().is_err());
}

#[test]
fn reserved_prepare_is_cancelled_before_worker_starts_and_performs_no_http() {
    let f = Fixture::new();
    let expected = f.media.receipt().unwrap().generation;
    assert_eq!(f.media.invalidate().unwrap().phase, "stopped");
    assert!(f.media.prepare_at(expected).is_err());
    assert_eq!(f.http.count(), 0);
}

#[test]
fn local_invalidation_during_http_returns_before_release_and_worker_cleans_owned_id() {
    let f = Fixture::new();
    let (gate, entered) = Gate::new();
    let blocking = gate.clone();
    f.http.add([
        caps(),
        session(ID, "active").hook(move || blocking.block()),
        session(ID, "completed"),
    ]);
    let media = f.media.clone();
    let worker = std::thread::spawn(move || media.prepare());
    entered.recv_timeout(Duration::from_secs(2)).unwrap();
    let receipt = f.media.invalidate().unwrap();
    assert_eq!(receipt.phase, "stopping");
    assert_eq!(receipt.end_state, "pending");
    // Auth cancellation is deliberately possible while this HTTP is still gated.
    f.identity.auth().cancel().unwrap();
    assert!(!f.identity.auth().status().unwrap().authenticated);
    gate.release();
    assert!(worker.join().unwrap().is_err());
    assert_eq!(f.media.status().unwrap().end_state, "ended");
}
