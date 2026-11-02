//! Isolated M1 disabled-lease API bridge. No commands/UI are registered here.
//! Blocking methods belong on the native blocking executor, never the UI thread.
use std::io::Read;
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use url::Url;
use zeroize::{Zeroize, Zeroizing};

use crate::auth::{Auth, Clock, Error, Lease};

const MAX_BODY: usize = 65536;
const MAX_TOKEN: usize = 16384;
const MAX_GENERATION: u64 = 9_007_199_254_740_991;

#[derive(Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MediaConfig {
    version: u8,
    api_origin: Option<String>,
    media_origins: Vec<String>,
}

fn origin(raw: &str, scheme: &str) -> bool {
    if raw.len() > 2048
        || !raw.is_ascii()
        || raw
            .bytes()
            .any(|b| b.is_ascii_control() || b.is_ascii_whitespace())
        || raw.contains(['\\', '%'])
    {
        return false;
    }
    let Ok(url) = Url::parse(raw) else {
        return false;
    };
    url.scheme() == scheme
        && url.host_str().is_some()
        && url.username().is_empty()
        && url.password().is_none()
        && url.query().is_none()
        && url.fragment().is_none()
        && url.path() == "/"
        // Config uses canonical origins WITHOUT the URL parser's trailing slash.
        && url.origin().ascii_serialization() == raw
}

pub fn parse_config(raw: &str) -> Result<Option<MediaConfig>, Error> {
    if raw.len() > 16384 {
        return Err("MEDIA_CONFIG_INVALID");
    }
    let config: MediaConfig = serde_json::from_str(raw).map_err(|_| "MEDIA_CONFIG_INVALID")?;
    // Option alone would accept a missing api_origin. Every key is mandatory.
    let keys: serde_json::Value = serde_json::from_str(raw).map_err(|_| "MEDIA_CONFIG_INVALID")?;
    if keys.get("api_origin").is_none() || !config.valid() {
        return Err("MEDIA_CONFIG_INVALID");
    }
    Ok(config.api_origin.as_ref().map(|_| config.clone()))
}

impl MediaConfig {
    fn valid(&self) -> bool {
        self.version == 1
            && self.media_origins.len() <= 8
            && self
                .media_origins
                .iter()
                .enumerate()
                .all(|(i, value)| origin(value, "wss") && !self.media_origins[..i].contains(value))
            && match &self.api_origin {
                Some(value) => origin(value, "https") && !self.media_origins.is_empty(),
                None => self.media_origins.is_empty(),
            }
    }

    fn allows_media(&self, raw: &str) -> bool {
        // This contract allows origins only, not server-selected arbitrary paths.
        origin(raw, "wss") && self.media_origins.iter().any(|allowed| allowed == raw)
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Method {
    Get,
    Post,
}

// Constructed only by the fixed API operation mapper. No JS-controlled HTTP input.
// No Debug/Serialize on requests, replies or auth leases.
pub struct Request<'a> {
    method: Method,
    url: String,
    bearer: &'a str,
    body: &'static [u8],
}

pub struct Response {
    status: u16,
    body: Zeroizing<Vec<u8>>,
}

pub trait Http: Send + Sync {
    fn send(&self, request: Request<'_>) -> Result<Response, Error>;
}

pub struct BoundedHttp {
    client: reqwest::blocking::Client,
}

impl BoundedHttp {
    pub fn new() -> Result<Self, Error> {
        let client = reqwest::blocking::Client::builder()
            .https_only(true)
            .redirect(reqwest::redirect::Policy::none())
            .no_proxy()
            .connect_timeout(Duration::from_secs(3))
            .timeout(Duration::from_secs(10))
            .build()
            .map_err(|_| "MEDIA_HTTP_UNAVAILABLE")?;
        Ok(Self { client })
    }
}

impl Http for BoundedHttp {
    fn send(&self, request: Request<'_>) -> Result<Response, Error> {
        let bearer = request.bearer;
        if bearer.is_empty()
            || bearer.len() > MAX_TOKEN
            || !bearer.bytes().all(|b| b.is_ascii_graphic())
        {
            return Err("MEDIA_HTTP_FAILED");
        }
        let authorization = Zeroizing::new(format!("Bearer {bearer}"));
        let mut header = reqwest::header::HeaderValue::from_str(&authorization)
            .map_err(|_| "MEDIA_HTTP_FAILED")?;
        header.set_sensitive(true);
        let method = match request.method {
            Method::Get => reqwest::Method::GET,
            Method::Post => reqwest::Method::POST,
        };
        let mut builder = self
            .client
            .request(method, &request.url)
            .header(reqwest::header::AUTHORIZATION, header)
            .header(reqwest::header::ACCEPT, "application/json")
            .header(reqwest::header::CACHE_CONTROL, "no-store");
        if !request.body.is_empty() {
            builder = builder
                .header(reqwest::header::CONTENT_TYPE, "application/json")
                .body(request.body);
        }
        let response = builder.send().map_err(|_| "MEDIA_HTTP_FAILED")?;
        let status = response.status().as_u16();
        // Never retain or parse error text, redirects or their Location headers.
        if !(200..300).contains(&status) {
            return Ok(Response {
                status,
                body: Zeroizing::new(Vec::new()),
            });
        }
        let length = response.content_length();
        let body = bounded_body(response, length)?;
        Ok(Response { status, body })
    }
}

fn bounded_body(reader: impl Read, length: Option<u64>) -> Result<Zeroizing<Vec<u8>>, Error> {
    if length.is_some_and(|n| n > MAX_BODY as u64) {
        return Err("MEDIA_RESPONSE_TOO_LARGE");
    }
    let mut body = Zeroizing::new(Vec::new());
    reader
        .take(MAX_BODY as u64 + 1)
        .read_to_end(&mut body)
        .map_err(|_| "MEDIA_HTTP_FAILED")?;
    if body.len() > MAX_BODY {
        return Err("MEDIA_RESPONSE_TOO_LARGE");
    }
    Ok(body)
}

pub struct NativeHttp;
impl Http for NativeHttp {
    fn send(&self, request: Request<'_>) -> Result<Response, Error> {
        BoundedHttp::new()?.send(request)
    }
}

#[derive(Clone, Copy)]
enum Operation<'a> {
    Capabilities,
    Create,
    Token(&'a str),
    Dispatch(&'a str),
    End(&'a str),
}

fn uuid(raw: &str) -> bool {
    raw.len() == 36
        && raw.bytes().enumerate().all(|(i, b)| {
            if [8, 13, 18, 23].contains(&i) {
                b == b'-'
            } else {
                b.is_ascii_digit() || (b'a'..=b'f').contains(&b)
            }
        })
        && raw != "00000000-0000-0000-0000-000000000000"
}

#[derive(Serialize, Zeroize)]
#[zeroize(drop)]
pub struct JoinGrant {
    pub generation: u64,
    pub session_id: String,
    pub token: String,
    pub ws_url: String,
    pub expires_at: u64,
}

#[derive(Clone, Serialize)]
pub struct MediaStatus {
    pub phase: &'static str,
    pub generation: u64,
    pub session_id: Option<String>,
    pub error: Option<Error>,
    pub end_state: &'static str,
}

struct State {
    status: MediaStatus,
    lease: Option<Lease>,
    in_flight: bool,
    create_unknown: bool,
    grant_expires: Option<u64>,
    stop_error: Option<Error>,
}

pub struct Media {
    config: Option<MediaConfig>,
    auth: Arc<Auth>,
    http: Arc<dyn Http>,
    clock: Arc<dyn Clock>,
    state: Mutex<State>,
}

impl Media {
    pub fn new(
        config: Result<Option<MediaConfig>, Error>,
        auth: Arc<Auth>,
        http: Arc<dyn Http>,
        clock: Arc<dyn Clock>,
    ) -> Self {
        let (config, phase, error) = match config {
            Ok(Some(c)) if c.valid() && c.api_origin.is_some() => (Some(c), "idle", None),
            Ok(None) => (None, "unconfigured", Some("MEDIA_CONFIG_MISSING")),
            _ => (None, "unconfigured", Some("MEDIA_CONFIG_INVALID")),
        };
        Self {
            config,
            auth,
            http,
            clock,
            state: Mutex::new(State {
                status: MediaStatus {
                    phase,
                    generation: 0,
                    session_id: None,
                    error,
                    end_state: "not_needed",
                },
                lease: None,
                in_flight: false,
                create_unknown: false,
                grant_expires: None,
                stop_error: None,
            }),
        }
    }

    fn lock(&self) -> Result<MutexGuard<'_, State>, Error> {
        self.state.lock().map_err(|_| "MEDIA_UNAVAILABLE")
    }

    fn advance(state: &mut State) -> Result<u64, Error> {
        if state.status.generation >= MAX_GENERATION - 1 {
            state.status.phase = "blocked";
            state.status.error = Some("MEDIA_GENERATION_EXHAUSTED");
            return Err("MEDIA_GENERATION_EXHAUSTED");
        }
        state.status.generation += 1;
        Ok(state.status.generation)
    }

    fn current(&self, generation: u64, lease: &Lease) -> Result<(), Error> {
        if !self.auth.lease_current(lease).unwrap_or(false) {
            return Err("MEDIA_AUTH_CHANGED");
        }
        if self.lock()?.status.generation != generation {
            return Err("MEDIA_CANCELLED");
        }
        Ok(())
    }

    fn request(&self, operation: Operation<'_>, lease: &Lease) -> Result<Response, Error> {
        let config = self.config.as_ref().ok_or("MEDIA_CONFIG_MISSING")?;
        let (method, path, body): (_, _, &'static [u8]) = match operation {
            Operation::Capabilities => (Method::Get, "/api/call-capabilities".to_owned(), b""),
            Operation::Create => (
                Method::Post,
                "/api/sessions".to_owned(),
                br#"{"mode":"free_talk"}"#,
            ),
            Operation::Token(id) | Operation::Dispatch(id) | Operation::End(id) => {
                if !uuid(id) {
                    return Err("MEDIA_RESPONSE_INVALID");
                }
                let (method, suffix) = match operation {
                    Operation::Token(_) => (Method::Get, "token"),
                    Operation::Dispatch(_) => (Method::Post, "dispatch"),
                    _ => (Method::Post, "end"),
                };
                (method, format!("/api/sessions/{id}/{suffix}"), b"")
            }
        };
        let response = self
            .http
            .send(Request {
                method,
                url: format!(
                    "{}{path}",
                    config.api_origin.as_deref().ok_or("MEDIA_CONFIG_MISSING")?
                ),
                bearer: lease.bearer(),
                body,
            })
            // Even a faulty injected adapter cannot send raw text to callers.
            .map_err(|_| "MEDIA_HTTP_FAILED")?;
        if response.status == 401 {
            self.auth.invalidate_lease(lease)?;
        }
        if response.body.len() > MAX_BODY {
            return Err("MEDIA_RESPONSE_TOO_LARGE");
        }
        Ok(response)
    }

    fn success(response: &Response) -> Result<(), Error> {
        match response.status {
            200..=299 => Ok(()),
            401 => Err("MEDIA_AUTH_EXPIRED"),
            _ => Err("MEDIA_API_REJECTED"),
        }
    }

    pub fn prepare(&self) -> Result<JoinGrant, Error> {
        self.prepare_generation(None)
    }

    pub fn prepare_at(&self, generation: u64) -> Result<JoinGrant, Error> {
        self.prepare_generation(Some(generation))
    }

    fn prepare_generation(&self, expected: Option<u64>) -> Result<JoinGrant, Error> {
        self.config.as_ref().ok_or("MEDIA_CONFIG_MISSING")?;
        let lease = self.auth.lease().map_err(|_| "MEDIA_AUTH_REQUIRED")?;
        let generation = {
            let mut state = self.lock()?;
            if expected.is_some_and(|expected| state.status.generation != expected) {
                return Err("MEDIA_CANCELLED");
            }
            if state.in_flight
                || state.create_unknown
                || !["idle", "stopped", "failed"].contains(&state.status.phase)
            {
                return Err("MEDIA_BUSY");
            }
            let generation = Self::advance(&mut state)?;
            state.status.phase = "preparing";
            state.status.error = None;
            state.status.session_id = None;
            state.status.end_state = "not_needed";
            state.lease = Some(lease.clone());
            state.grant_expires = None;
            state.stop_error = None;
            state.in_flight = true;
            generation
        };
        let result = self.prepare_inner(generation, &lease);
        if let Ok(grant) = &result {
            self.lock()?.grant_expires = Some(grant.expires_at);
        }
        self.finish(generation, &lease, "prepared", result)
    }

    fn prepare_inner(&self, generation: u64, lease: &Lease) -> Result<JoinGrant, Error> {
        self.current(generation, lease)?;
        let response = self.request(Operation::Capabilities, lease)?;
        Self::success(&response)?;
        let capabilities: Capabilities = decode(&response)?;
        if capabilities.protocol_version != 1 || capabilities.call_lease_mode != "disabled" {
            return Err("MEDIA_LEASE_MODE_UNSUPPORTED");
        }
        self.current(generation, lease)?;
        {
            let mut state = self.lock()?;
            if state.status.generation != generation {
                return Err("MEDIA_CANCELLED");
            }
            state.status.end_state = "pending";
        }
        // This is the only create attempt. Cancellation does not prove it wasn't committed.
        let response = match self.request(Operation::Create, lease) {
            Ok(response) => response,
            Err(code) => {
                self.lock()?.create_unknown = true;
                return Err(code);
            }
        };
        if !(200..300).contains(&response.status) {
            // Only definite pre-creation rejections permit another user attempt.
            if ![400, 401, 403, 404, 405, 422, 429].contains(&response.status) {
                self.lock()?.create_unknown = true;
            }
            return Self::success(&response).and(Err("MEDIA_RESPONSE_INVALID"));
        }
        // Capture a known created ID BEFORE validating the rest of the response.
        let known = decode::<SessionId>(&response).ok().filter(|s| uuid(&s.id));
        let id = match known {
            Some(known) => {
                let mut state = self.lock()?;
                state.status.session_id = Some(known.id.clone());
                state.status.end_state = "pending";
                known.id
            }
            None => {
                self.lock()?.create_unknown = true;
                return Err("MEDIA_RESPONSE_INVALID");
            }
        };
        validate_session(&response, &id, "active")?;
        self.current(generation, lease)?;
        let response = self.request(Operation::Token(&id), lease)?;
        Self::success(&response)?;
        let token: RoomToken = decode(&response)?;
        if !self
            .config
            .as_ref()
            .is_some_and(|c| c.allows_media(&token.ws_url))
        {
            return Err("MEDIA_URL_REJECTED");
        }
        // The API supplies a room JWT, not expires_at. Read ONLY its expiry as an
        // upper bound; this never authenticates an identity or verifies a JWT signature.
        let now = self.clock.now();
        let expires_at = room_expiry(&token.token)?.min(lease.expires_at);
        if expires_at <= now {
            return Err("MEDIA_TOKEN_EXPIRED");
        }
        Ok(JoinGrant {
            generation,
            session_id: id,
            token: token.token.to_string(),
            ws_url: token.ws_url.clone(),
            expires_at,
        })
    }

    pub fn dispatch(&self, generation: u64) -> Result<MediaStatus, Error> {
        if generation == 0 || generation > MAX_GENERATION {
            return Err("MEDIA_GENERATION_INVALID");
        }
        let (id, lease) = {
            let mut state = self.lock()?;
            if state.in_flight
                || state.status.phase != "prepared"
                || state.status.generation != generation
            {
                return Err("MEDIA_STALE_GRANT");
            }
            let id = state.status.session_id.clone().ok_or("MEDIA_UNAVAILABLE")?;
            let lease = state.lease.clone().ok_or("MEDIA_UNAVAILABLE")?;
            state.in_flight = true;
            state.status.phase = "dispatching";
            (id, lease)
        };
        let result = (|| {
            self.current(generation, &lease)?;
            if self
                .lock()?
                .grant_expires
                .is_none_or(|expiry| self.clock.now() >= expiry)
            {
                return Err("MEDIA_TOKEN_EXPIRED");
            }
            let response = self.request(Operation::Dispatch(&id), &lease)?;
            Self::success(&response)?;
            if !decode::<Dispatched>(&response)?.dispatched {
                return Err("MEDIA_RESPONSE_INVALID");
            }
            Ok(())
        })();
        self.finish(generation, &lease, "active", result)?;
        self.snapshot()
    }

    fn finish<T>(
        &self,
        generation: u64,
        lease: &Lease,
        phase: &'static str,
        result: Result<T, Error>,
    ) -> Result<T, Error> {
        let result = match result {
            Ok(value) => {
                // Only local publication holds Auth -> Media locks together.
                // Thus cancel/new login cannot slip between validation and publish.
                let published = self.auth.publish_if_current(lease, || {
                    let mut state = self.lock()?;
                    if state.status.generation != generation {
                        return Err("MEDIA_CANCELLED");
                    }
                    if self.lock_grant_expired(&state) {
                        return Err("MEDIA_TOKEN_EXPIRED");
                    }
                    state.status.phase = phase;
                    state.status.error = None;
                    state.in_flight = false;
                    Ok(())
                });
                match published {
                    Ok(()) => return Ok(value),
                    Err(code) => Err(match code {
                        "MEDIA_CANCELLED" | "MEDIA_TOKEN_EXPIRED" | "MEDIA_UNAVAILABLE" => code,
                        _ => "MEDIA_AUTH_CHANGED",
                    }),
                }
            }
            Err(code) => Err(code),
        };
        let mut state = self.lock()?;
        let cancelled = state.status.generation != generation;
        let operation_error = result.as_ref().err().copied();
        let result = if cancelled {
            Err("MEDIA_CANCELLED")
        } else {
            result
        };
        let code = result
            .as_ref()
            .err()
            .copied()
            .unwrap_or("MEDIA_UNAVAILABLE");
        // A cancellation receipt describes completion, not a historical UI reason.
        // Keep real failures, including automatic auth/expiry cancellation.
        let receipt_error = if cancelled {
            state
                .stop_error
                .or(operation_error.filter(|code| *code != "MEDIA_CANCELLED"))
        } else {
            Some(code)
        };
        state.status.error = receipt_error;
        if let (Some(id), Some(lease)) = (state.status.session_id.clone(), state.lease.clone()) {
            state.status.phase = "stopping";
            state.status.end_state = "pending";
            drop(state);
            let final_phase = if cancelled && receipt_error.is_none() {
                "stopped"
            } else {
                "failed"
            };
            self.cleanup(&id, &lease, final_phase, receipt_error)?;
        } else {
            state.in_flight = false;
            state.lease = None;
            state.status.phase = if state.create_unknown {
                "blocked"
            } else if cancelled {
                "stopped"
            } else {
                "failed"
            };
            state.status.end_state = if state.create_unknown {
                "unknown"
            } else {
                "not_needed"
            };
            if state.create_unknown {
                state.status.error = Some("MEDIA_CREATE_UNKNOWN");
            }
        }
        result
    }

    fn cleanup(
        &self,
        id: &str,
        lease: &Lease,
        final_phase: &'static str,
        error: Option<Error>,
    ) -> Result<(), Error> {
        // Intentionally use the captured OLD bearer, never a newly logged-in account.
        let result = self
            .request(Operation::End(id), lease)
            .and_then(|response| {
                Self::success(&response)?;
                validate_session(&response, id, "completed")
            });
        let mut state = self.lock()?;
        state.in_flight = false;
        state.grant_expires = None;
        if result.is_ok() {
            state.lease = None;
            state.status.phase = final_phase;
            state.status.end_state = "ended";
            state.status.error = error;
        } else {
            state.status.phase = "blocked";
            state.status.end_state = "unknown";
            state.status.error = Some("MEDIA_END_UNKNOWN");
        }
        Ok(())
    }

    fn lock_grant_expired(&self, state: &State) -> bool {
        state
            .grant_expires
            .is_some_and(|expiry| self.clock.now() >= expiry)
    }

    // Immediate local invalidation for IPC/Auth actions: never performs HTTP.
    pub fn invalidate(&self) -> Result<MediaStatus, Error> {
        let mut state = self.lock()?;
        if self.config.is_none() {
            return Ok(state.status.clone());
        }
        if state.status.generation < MAX_GENERATION {
            state.status.generation += 1;
        }
        state.grant_expires = None;
        if state.create_unknown {
            state.status.phase = "blocked";
            state.status.end_state = "unknown";
            state.status.error = Some("MEDIA_CREATE_UNKNOWN");
        } else if state.in_flight || state.lease.is_some() {
            if state.status.phase != "stopping" {
                state.stop_error = None;
            }
            state.status.phase = "stopping";
            state.status.end_state = "pending";
        } else {
            state.status.phase = "stopped";
            state.status.error = None;
        }
        Ok(state.status.clone())
    }

    pub fn receipt(&self) -> Result<MediaStatus, Error> {
        self.snapshot()
    }

    pub fn stop(&self) -> Result<MediaStatus, Error> {
        self.stop_if_generation(None, None)
    }

    fn stop_if_generation(
        &self,
        expected: Option<u64>,
        reason: Option<Error>,
    ) -> Result<MediaStatus, Error> {
        let mut state = self.lock()?;
        if expected.is_some_and(|expected| state.status.generation != expected) {
            return Ok(state.status.clone());
        }
        if self.config.is_none() {
            return Ok(state.status.clone());
        }
        // Generation MAX is reserved for cancellation; prepare never consumes it.
        if state.status.generation < MAX_GENERATION {
            state.status.generation += 1;
        }
        state.grant_expires = None;
        if state.in_flight {
            // The single existing worker owns completion/late-create cleanup.
            if state.status.phase != "stopping" {
                state.stop_error = reason;
            }
            state.status.phase = "stopping";
            state.status.error = state.stop_error;
            state.status.end_state = "pending";
            return Ok(state.status.clone());
        }
        if state.create_unknown {
            state.status.phase = "blocked";
            state.status.end_state = "unknown";
            state.status.error = Some("MEDIA_CREATE_UNKNOWN");
            return Ok(state.status.clone());
        }
        let cleanup = state.status.session_id.clone().zip(state.lease.clone());
        if let Some((id, lease)) = cleanup {
            state.in_flight = true;
            state.status.phase = "stopping";
            state.status.end_state = "pending";
            drop(state);
            self.cleanup(
                &id,
                &lease,
                if reason.is_some() {
                    "failed"
                } else {
                    "stopped"
                },
                reason,
            )?;
            self.snapshot()
        } else {
            state.lease = None;
            state.status.phase = "stopped";
            state.status.error = None;
            Ok(state.status.clone())
        }
    }

    fn snapshot(&self) -> Result<MediaStatus, Error> {
        Ok(self.lock()?.status.clone())
    }

    pub fn status(&self) -> Result<MediaStatus, Error> {
        let (lease, expiry, generation, phase) = {
            let state = self.lock()?;
            (
                state.lease.clone(),
                state.grant_expires,
                state.status.generation,
                state.status.phase,
            )
        };
        if ["preparing", "prepared", "dispatching", "active"].contains(&phase) {
            let reason =
                if lease.is_some_and(|lease| !self.auth.lease_current(&lease).unwrap_or(false)) {
                    Some("MEDIA_AUTH_CHANGED")
                } else if expiry.is_some_and(|expiry| self.clock.now() >= expiry) {
                    Some("MEDIA_TOKEN_EXPIRED")
                } else {
                    None
                };
            if reason.is_some() {
                return self.stop_if_generation(Some(generation), reason);
            }
        }
        self.snapshot()
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Capabilities {
    protocol_version: u8,
    call_lease_mode: String,
}

#[derive(Deserialize)]
struct SessionId {
    id: String,
}

#[derive(Deserialize)]
struct SessionState {
    id: String,
    status: String,
}

#[derive(Deserialize, Zeroize)]
#[zeroize(drop)]
#[serde(deny_unknown_fields)]
struct RoomToken {
    #[serde(deserialize_with = "secret_string")]
    token: Zeroizing<String>,
    ws_url: String,
}

fn secret_string<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> Result<Zeroizing<String>, D::Error> {
    // Even a partially deserialized/rejected response drops the bearer safely.
    String::deserialize(deserializer).map(Zeroizing::new)
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Dispatched {
    dispatched: bool,
}

fn decode<T: serde::de::DeserializeOwned>(response: &Response) -> Result<T, Error> {
    serde_json::from_slice(&response.body).map_err(|_| "MEDIA_RESPONSE_INVALID")
}

fn validate_session(response: &Response, id: &str, status: &str) -> Result<(), Error> {
    let session: SessionState = decode(response)?;
    if session.id != id || !uuid(&session.id) || session.status != status {
        return Err("MEDIA_RESPONSE_INVALID");
    }
    Ok(())
}

fn room_expiry(token: &str) -> Result<u64, Error> {
    if token.len() > MAX_TOKEN {
        return Err("MEDIA_TOKEN_INVALID");
    }
    let parts: Vec<_> = token.split('.').collect();
    if parts.len() != 3
        || parts.iter().any(|s| {
            s.is_empty()
                || !s
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_'))
        })
    {
        return Err("MEDIA_TOKEN_INVALID");
    }
    // Bounded base64url decoding of the payload for an expiry upper bound only.
    let payload = parts[1];
    if payload.len() % 4 == 1 {
        return Err("MEDIA_TOKEN_INVALID");
    }
    let mut bytes = Zeroizing::new(Vec::new());
    let mut accumulator = 0u32;
    let mut bits = 0u8;
    for byte in payload.bytes() {
        let digit = match byte {
            b'A'..=b'Z' => byte - b'A',
            b'a'..=b'z' => byte - b'a' + 26,
            b'0'..=b'9' => byte - b'0' + 52,
            b'-' => 62,
            _ => 63,
        };
        accumulator = (accumulator << 6) | u32::from(digit);
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            bytes.push((accumulator >> bits) as u8);
        }
        accumulator &= (1u32 << bits) - 1;
    }
    if accumulator != 0 {
        return Err("MEDIA_TOKEN_INVALID");
    }
    #[derive(Deserialize)]
    struct Expiry {
        exp: u64,
    }
    let claims: Expiry = serde_json::from_slice(&bytes).map_err(|_| "MEDIA_TOKEN_INVALID")?;
    if claims.exp > MAX_GENERATION {
        return Err("MEDIA_TOKEN_INVALID");
    }
    Ok(claims.exp)
}

#[cfg(test)]
#[path = "media_api_tests.rs"]
mod tests;
