use std::sync::{Arc, Mutex, MutexGuard};

use openidconnect::{CsrfToken, Nonce, PkceCodeChallenge};
use serde::{Deserialize, Serialize};
use url::Url;
use zeroize::{Zeroize, Zeroizing};

use crate::config::{OidcConfig, REDIRECT};

pub type Error = &'static str;
pub const TTL: u64 = 300;

// No Debug/IPC serialization for transactions, URLs, tokens or identity.
#[derive(Serialize, Deserialize, Zeroize)]
#[zeroize(drop)]
#[serde(deny_unknown_fields)]
pub struct Transaction {
    pub state: String,
    pub nonce: String,
    pub verifier: String,
    #[zeroize(skip)]
    pub config: OidcConfig,
    pub created_at: u64,
    pub expires_at: u64,
    pub generation: u64,
}

fn secret_valid(value: &str) -> bool {
    value.len() == 43
        && value
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-')
}

impl Transaction {
    fn new(config: OidcConfig, now: u64, generation: u64) -> Self {
        let (_, verifier) = PkceCodeChallenge::new_random_sha256();
        Self {
            state: CsrfToken::new_random_len(32).secret().to_owned(),
            nonce: Nonce::new_random_len(32).secret().to_owned(),
            verifier: verifier.secret().to_owned(),
            config,
            created_at: now,
            expires_at: now.saturating_add(TTL),
            generation,
        }
    }

    fn valid(&self, config: &OidcConfig, now: u64) -> bool {
        self.config == *config
            && self.generation > 0
            && self.created_at <= now
            && now < self.expires_at
            && self.created_at.checked_add(TTL) == Some(self.expires_at)
            && secret_valid(&self.state)
            && secret_valid(&self.nonce)
            && secret_valid(&self.verifier)
    }
}

pub struct Session {
    pub access_token: Zeroizing<String>,
    pub subject: Zeroizing<String>,
    pub expires_at: u64,
}

pub trait Store: Send + Sync {
    fn load(&self) -> Result<Option<Transaction>, Error>;
    fn save(&self, tx: &Transaction) -> Result<(), Error>;
    // Strict destructive delete. Missing item MUST return an error here.
    fn delete(&self) -> Result<(), Error>;
}
pub trait Browser: Send + Sync {
    fn open(&self, url: &Url) -> Result<(), Error>;
}
pub trait Clock: Send + Sync {
    fn now(&self) -> u64;
}
pub trait Oidc: Send + Sync {
    fn authorization(&self, tx: &Transaction) -> Result<Url, Error>;
    fn exchange(&self, tx: &Transaction, code: &str) -> Result<Session, Error>;
}

#[derive(Clone, Serialize)]
pub struct Status {
    pub phase: &'static str,
    pub authenticated: bool,
    pub expires_at: Option<u64>,
    pub error: Option<Error>,
}

struct State {
    generation: u64,
    phase: &'static str,
    error: Option<Error>,
    session: Option<Session>,
    deadline: Option<(u64, u64)>,
}

pub struct Auth {
    config: Option<OidcConfig>,
    state: Mutex<State>,
    store: Arc<dyn Store>,
    browser: Arc<dyn Browser>,
    clock: Arc<dyn Clock>,
    oidc: Arc<dyn Oidc>,
}

impl Auth {
    pub fn new(
        config: Result<Option<OidcConfig>, Error>,
        store: Arc<dyn Store>,
        browser: Arc<dyn Browser>,
        clock: Arc<dyn Clock>,
        oidc: Arc<dyn Oidc>,
    ) -> Self {
        let (config, phase, error) = match config {
            Ok(Some(c)) if c.valid() => (Some(c), "idle", None),
            Ok(None) => (None, "unconfigured", Some("CONFIG_MISSING")),
            _ => (None, "unavailable", Some("CONFIG_INVALID")),
        };
        Self {
            config,
            state: Mutex::new(State {
                generation: 0,
                phase,
                error,
                session: None,
                deadline: None,
            }),
            store,
            browser,
            clock,
            oidc,
        }
    }

    fn lock(&self) -> Result<MutexGuard<'_, State>, Error> {
        self.state.lock().map_err(|_| "AUTH_UNAVAILABLE")
    }

    fn config(&self) -> Result<&OidcConfig, Error> {
        self.config.as_ref().ok_or("AUTH_UNAVAILABLE")
    }

    fn failure(state: &mut State, code: Error) {
        state.session = None;
        state.deadline = None;
        state.phase = "failed";
        state.error = Some(code);
    }

    fn storage_failure(state: &mut State) -> Error {
        Self::failure(state, "AUTH_STORAGE_FAILED");
        state.phase = "blocked";
        "AUTH_STORAGE_FAILED"
    }

    fn next(state: &mut State) -> Result<u64, Error> {
        state.generation = state.generation.checked_add(1).ok_or("AUTH_UNAVAILABLE")?;
        Ok(state.generation)
    }

    pub fn status(&self) -> Result<Status, Error> {
        let mut state = self.lock()?;
        self.expire(&mut state)?;
        Ok(Status {
            phase: state.phase,
            authenticated: state.session.is_some(),
            expires_at: state.session.as_ref().map(|s| s.expires_at),
            error: state.error,
        })
    }

    fn expire(&self, state: &mut State) -> Result<(), Error> {
        let now = self.clock.now();
        if state.session.as_ref().is_some_and(|s| now >= s.expires_at)
            || state
                .deadline
                .is_some_and(|(created, expiry)| now < created || now >= expiry)
        {
            Self::next(state)?;
            Self::failure(state, "AUTH_EXPIRED");
        }
        Ok(())
    }

    pub fn begin(&self) -> Result<(), Error> {
        let config = self.config()?.clone();
        let tx = {
            let mut state = self.lock()?;
            self.expire(&mut state)?;
            if state.phase == "blocked" {
                return Err("AUTH_STORAGE_FAILED");
            }
            if ["preparing", "waiting", "exchanging"].contains(&state.phase) {
                return Err("AUTH_BUSY");
            }
            let pending = self
                .store
                .load()
                .map_err(|_| Self::storage_failure(&mut state))?;
            if let Some(pending) = pending {
                // Cold launch must preserve a live transaction until explicit cancel.
                if pending.valid(&config, self.clock.now()) {
                    state.generation = state.generation.max(pending.generation);
                    state.phase = "waiting";
                    state.deadline = Some((pending.created_at, pending.expires_at));
                    return Err("AUTH_BUSY");
                }
                self.store
                    .delete()
                    .map_err(|_| Self::storage_failure(&mut state))?;
            }
            let generation = Self::next(&mut state)?;
            state.session = None;
            state.phase = "preparing";
            state.error = None;
            let tx = Transaction::new(config, self.clock.now(), generation);
            state.deadline = Some((tx.created_at, tx.expires_at));
            tx
        };
        // Discovery/HTTP never holds the controller lock; cancel/new login can proceed.
        let result = self.oidc.authorization(&tx);
        let mut state = self.lock()?;
        if state.generation != tx.generation {
            return Err("AUTH_CANCELLED");
        }
        let url = match result {
            Ok(url) => url,
            Err(code) => {
                Self::failure(&mut state, code);
                return Err(code);
            }
        };
        if !tx.valid(self.config()?, self.clock.now()) || !authorization_valid(&url, &tx) {
            Self::failure(&mut state, "AUTHORIZATION_INVALID");
            return Err("AUTHORIZATION_INVALID");
        }
        self.store
            .save(&tx)
            .map_err(|_| Self::storage_failure(&mut state))?;
        // Serialize save+fixed bounded browser launch against cancel. No window/UI thread blocks.
        if self.browser.open(&url).is_err() {
            self.store
                .delete()
                .map_err(|_| Self::storage_failure(&mut state))?;
            Self::failure(&mut state, "BROWSER_FAILED");
            return Err("BROWSER_FAILED");
        }
        state.phase = "waiting";
        Ok(())
    }

    pub fn cancel(&self) -> Result<(), Error> {
        self.config()?;
        let mut state = self.lock()?;
        Self::next(&mut state)?;
        state.session = None;
        state.deadline = None;
        state.phase = "cancelled";
        state.error = None;
        if self
            .store
            .load()
            .map_err(|_| Self::storage_failure(&mut state))?
            .is_some()
        {
            self.store
                .delete()
                .map_err(|_| Self::storage_failure(&mut state))?;
        }
        Ok(())
    }

    pub fn callback(&self, raw: &str) -> Result<(), Error> {
        let config = self.config()?;
        let callback = Callback::parse(raw, config)?;
        let tx = {
            let mut state = self.lock()?;
            if state.phase == "blocked" {
                return Err("AUTH_STORAGE_FAILED");
            }
            if ["preparing", "exchanging"].contains(&state.phase) {
                return Err("CALLBACK_REJECTED");
            }
            let tx = self
                .store
                .load()
                .map_err(|_| Self::storage_failure(&mut state))?
                .ok_or("CALLBACK_REJECTED")?;
            if CsrfToken::new(tx.state.clone()) != CsrfToken::new(callback.state.clone()) {
                return Err("CALLBACK_REJECTED"); // Do NOT delete a newer valid transaction.
            }
            if !tx.valid(config, self.clock.now()) {
                self.store
                    .delete()
                    .map_err(|_| Self::storage_failure(&mut state))?;
                Self::failure(&mut state, "CALLBACK_REJECTED");
                return Err("CALLBACK_REJECTED");
            }
            // A new process adopts only the stored generation. A cancelled live one cannot.
            if state.generation == 0 {
                state.generation = tx.generation;
            }
            if state.generation != tx.generation {
                return Err("CALLBACK_REJECTED");
            }
            // Both entrypoints use this critical section; cross-process racing deletion
            // is also strict: only the successful Keychain deleter may exchange.
            self.store
                .delete()
                .map_err(|_| Self::storage_failure(&mut state))?;
            if callback.denied {
                Self::failure(&mut state, "AUTH_DENIED");
                return Err("AUTH_DENIED");
            }
            state.phase = "exchanging";
            state.deadline = Some((tx.created_at, tx.expires_at));
            state.error = None;
            tx
        };
        let result = self.oidc.exchange(&tx, &callback.code);
        let mut state = self.lock()?;
        if state.generation != tx.generation {
            return Err("AUTH_CANCELLED");
        }
        match result {
            Ok(session)
                if tx.valid(config, self.clock.now())
                    && session.expires_at > self.clock.now()
                    && !session.access_token.is_empty()
                    && !session.subject.is_empty() =>
            {
                state.session = Some(session);
                state.deadline = None;
                state.phase = "authenticated";
                state.error = None;
                Ok(())
            }
            Ok(_) => {
                Self::failure(&mut state, "IDENTITY_INVALID");
                Err("IDENTITY_INVALID")
            }
            Err(code) => {
                Self::failure(&mut state, code);
                Err(code)
            }
        }
    }
}

pub fn authorization_valid(url: &Url, tx: &Transaction) -> bool {
    let mut endpoint = url.clone();
    endpoint.set_query(None);
    if endpoint.as_str() != tx.config.authorization_endpoint || url.fragment().is_some() {
        return false;
    }
    let expected_challenge = PkceCodeChallenge::from_code_verifier_sha256(
        &openidconnect::PkceCodeVerifier::new(tx.verifier.clone()),
    );
    let expected = [
        ("response_type", "code"),
        ("client_id", tx.config.client_id.as_str()),
        ("redirect_uri", REDIRECT),
        ("scope", "openid"),
        ("state", tx.state.as_str()),
        ("nonce", tx.nonce.as_str()),
        ("code_challenge_method", "S256"),
        ("code_challenge", expected_challenge.as_str()),
    ];
    let pairs: Vec<_> = url.query_pairs().collect();
    pairs.len() == expected.len()
        && expected.iter().all(|(key, value)| {
            pairs
                .iter()
                .filter(|(k, v)| k.as_ref() == *key && v.as_ref() == *value)
                .count()
                == 1
        })
}

struct Callback {
    state: String,
    code: Zeroizing<String>,
    denied: bool,
}

impl Callback {
    fn parse(raw: &str, config: &OidcConfig) -> Result<Self, Error> {
        if raw.len() > 8192
            || raw.split('?').next() != Some(REDIRECT)
            || raw.contains('#')
            || raw.bytes().any(|b| b.is_ascii_control())
        {
            return Err("CALLBACK_INVALID");
        }
        let url = Url::parse(raw).map_err(|_| "CALLBACK_INVALID")?;
        let mut pairs = std::collections::HashMap::new();
        for (key, value) in url.query_pairs() {
            let allowed = [
                "state",
                "code",
                "error",
                "error_description",
                "error_uri",
                "iss",
                "session_state",
            ];
            if !allowed.contains(&key.as_ref())
                || pairs.insert(key.to_string(), value.to_string()).is_some()
            {
                return Err("CALLBACK_INVALID");
            }
        }
        // Keycloak's optional protocol metadata is not an identity or transaction
        // binding. Validate its bounded opaque form, then discard it completely.
        if let Some(value) = pairs.remove("session_state") {
            if value.is_empty()
                || value.len() > 256
                || !value.bytes().all(|byte| {
                    byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'~')
                })
            {
                return Err("CALLBACK_INVALID");
            }
        }
        let state = pairs.remove("state").ok_or("CALLBACK_INVALID")?;
        let has_code = pairs.contains_key("code");
        let code = Zeroizing::new(pairs.remove("code").unwrap_or_default());
        let error = pairs.remove("error");
        if !secret_valid(&state)
            || (has_code == error.is_some())
            || (has_code && code.is_empty())
            || code.len() > 2048
            || error.as_ref().is_some_and(|s| s.is_empty())
            || pairs.get("iss").is_some_and(|iss| iss != &config.issuer)
        {
            return Err("CALLBACK_INVALID");
        }
        Ok(Self {
            state,
            code,
            denied: error.is_some(),
        })
    }
}

#[cfg(test)]
#[path = "auth_tests.rs"]
mod tests;
