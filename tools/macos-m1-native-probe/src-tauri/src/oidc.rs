use std::io::Read;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use openidconnect::core::{
    CoreAuthenticationFlow, CoreClient, CoreIdToken, CoreIdTokenVerifier, CoreJsonWebKeySet,
    CoreProviderMetadata,
};
use openidconnect::{
    AccessToken, AccessTokenHash, AuthType, AuthorizationCode, ClientId, CsrfToken, HttpRequest,
    HttpResponse, IssuerUrl, Nonce, OAuth2TokenResponse, PkceCodeChallenge, PkceCodeVerifier,
    RedirectUrl, SyncHttpClient, TokenResponse,
};
use url::Url;
use zeroize::Zeroizing;

use crate::auth::{Error, Oidc, Session, Transaction};
use crate::config::OidcConfig;

const MAX_RESPONSE: u64 = 262144;

// Only this adapter sees reqwest errors/bodies; they never become UI/log text.
pub struct BoundedHttp {
    config: OidcConfig,
    client: reqwest::blocking::Client,
}

impl BoundedHttp {
    fn new(config: &OidcConfig) -> Result<Self, Error> {
        let client = reqwest::blocking::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .no_proxy()
            .connect_timeout(Duration::from_secs(3))
            .timeout(Duration::from_secs(10))
            .build()
            .map_err(|_| "OIDC_UNAVAILABLE")?;
        Ok(Self {
            config: config.clone(),
            client,
        })
    }

    fn allowed(&self, request: &HttpRequest) -> bool {
        let uri = request.uri().to_string();
        match request.method().as_str() {
            "GET" => uri == self.config.discovery_url() || uri == self.config.jwks_uri,
            "POST" => uri == self.config.token_endpoint,
            _ => false,
        }
    }
}

impl SyncHttpClient for BoundedHttp {
    type Error = std::io::Error;

    fn call(&self, request: HttpRequest) -> Result<HttpResponse, Self::Error> {
        let failed = || std::io::Error::other("OIDC_HTTP_FAILED");
        if !self.allowed(&request) || request.body().len() > 16384 {
            return Err(failed());
        }
        let response = self
            .client
            .request(request.method().clone(), request.uri().to_string())
            .headers(request.headers().clone())
            .body(request.body().clone())
            .send()
            .map_err(|_| failed())?;
        if response.status().is_redirection()
            || response.content_length().is_some_and(|n| n > MAX_RESPONSE)
        {
            return Err(failed());
        }
        let status = response.status();
        let headers = response.headers().clone();
        let mut bytes = Zeroizing::new(Vec::new());
        response
            .take(MAX_RESPONSE + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| failed())?;
        if bytes.len() as u64 > MAX_RESPONSE {
            return Err(failed());
        }
        let mut result = HttpResponse::new(bytes.to_vec());
        *result.status_mut() = status;
        *result.headers_mut() = headers;
        Ok(result)
    }
}

fn discover(
    config: &OidcConfig,
    http: &impl SyncHttpClient,
) -> Result<CoreProviderMetadata, Error> {
    let metadata = CoreProviderMetadata::discover(
        &IssuerUrl::new(config.issuer.clone()).map_err(|_| "CONFIG_INVALID")?,
        http,
    )
    .map_err(|_| "OIDC_DISCOVERY_FAILED")?;
    if metadata.issuer().as_str() != config.issuer
        || metadata.authorization_endpoint().as_str() != config.authorization_endpoint
        || metadata.token_endpoint().as_ref().map(|s| s.as_str())
            != Some(config.token_endpoint.as_str())
        || metadata.jwks_uri().as_str() != config.jwks_uri
    {
        return Err("OIDC_METADATA_REJECTED");
    }
    Ok(metadata)
}

// Shared by production exchange and the real-library, signed-token regression tests.
pub fn verify_identity(
    id: &CoreIdToken,
    access: &AccessToken,
    verifier: &CoreIdTokenVerifier<'_>,
    config: &OidcConfig,
    nonce: &str,
) -> Result<(String, u64), Error> {
    let nonce = Nonce::new(nonce.to_owned());
    let claims = id
        .claims(verifier, &nonce)
        .map_err(|_| "IDENTITY_INVALID")?;
    if claims
        .authorized_party()
        .is_some_and(|azp| azp.as_str() != config.client_id)
        || (claims.audiences().len() > 1 && claims.authorized_party().is_none())
        || claims.subject().as_str().is_empty()
    {
        return Err("IDENTITY_INVALID");
    }
    if let Some(expected) = claims.access_token_hash() {
        let actual = AccessTokenHash::from_token(
            access,
            id.signing_alg().map_err(|_| "IDENTITY_INVALID")?,
            id.signing_key(verifier).map_err(|_| "IDENTITY_INVALID")?,
        )
        .map_err(|_| "IDENTITY_INVALID")?;
        if &actual != expected {
            return Err("IDENTITY_INVALID");
        }
    }
    let expires = u64::try_from(claims.expiration().timestamp()).map_err(|_| "IDENTITY_INVALID")?;
    Ok((claims.subject().as_str().to_owned(), expires))
}

pub struct NativeOidc;

impl Oidc for NativeOidc {
    fn authorization(&self, tx: &Transaction) -> Result<Url, Error> {
        let http = BoundedHttp::new(&tx.config)?;
        authorization_with_http(tx, &http)
    }

    fn exchange(&self, tx: &Transaction, code: &str) -> Result<Session, Error> {
        let http = BoundedHttp::new(&tx.config)?;
        exchange_with_http(tx, code, &http)
    }
}

fn authorization_with_http(tx: &Transaction, http: &impl SyncHttpClient) -> Result<Url, Error> {
    let client = CoreClient::from_provider_metadata(
        discover(&tx.config, http)?,
        ClientId::new(tx.config.client_id.clone()),
        None,
    )
    .set_redirect_uri(
        RedirectUrl::new(tx.config.redirect_uri.clone()).map_err(|_| "CONFIG_INVALID")?,
    );
    let challenge =
        PkceCodeChallenge::from_code_verifier_sha256(&PkceCodeVerifier::new(tx.verifier.clone()));
    // The library retains 'static generators. Own copies of this durable
    // transaction's values rather than borrowing tx or generating new ones.
    let state = tx.state.clone();
    let nonce = tx.nonce.clone();
    let (url, _, _) = client
        .authorize_url(
            CoreAuthenticationFlow::AuthorizationCode,
            move || CsrfToken::new(state.clone()),
            move || Nonce::new(nonce.clone()),
        )
        .set_pkce_challenge(challenge)
        .url();
    Ok(url)
}

fn exchange_with_http(
    tx: &Transaction,
    code: &str,
    http: &impl SyncHttpClient,
) -> Result<Session, Error> {
    let metadata = discover(&tx.config, http)?;
    let keys: CoreJsonWebKeySet = metadata.jwks().clone();
    let client = CoreClient::from_provider_metadata(
        metadata,
        ClientId::new(tx.config.client_id.clone()),
        None,
    )
    .set_auth_type(AuthType::RequestBody)
    .set_redirect_uri(
        RedirectUrl::new(tx.config.redirect_uri.clone()).map_err(|_| "CONFIG_INVALID")?,
    );
    let mut tokens = client
        .exchange_code(AuthorizationCode::new(code.to_owned()))
        .map_err(|_| "OIDC_EXCHANGE_FAILED")?
        .set_pkce_verifier(PkceCodeVerifier::new(tx.verifier.clone()))
        .request(http)
        .map_err(|_| "OIDC_EXCHANGE_FAILED")?;
    // Some providers include a refresh token even for scope=openid. Drop it
    // immediately; never persist it or issue a refresh-token request.
    tokens.set_refresh_token(None);
    let id = tokens.id_token().ok_or("IDENTITY_INVALID")?;
    let verifier = CoreIdTokenVerifier::new_public_client(
        ClientId::new(tx.config.client_id.clone()),
        IssuerUrl::new(tx.config.issuer.clone()).map_err(|_| "CONFIG_INVALID")?,
        keys,
    );
    let (subject, id_expiry) =
        verify_identity(id, tokens.access_token(), &verifier, &tx.config, &tx.nonce)?;
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| "CLOCK_INVALID")?
        .as_secs();
    let ttl = tokens.expires_in().ok_or("IDENTITY_INVALID")?.as_secs();
    let expires_at = now
        .checked_add(ttl)
        .ok_or("IDENTITY_INVALID")?
        .min(id_expiry);
    if expires_at <= now {
        return Err("IDENTITY_INVALID");
    }
    Ok(Session {
        access_token: Zeroizing::new(tokens.access_token().secret().to_owned()),
        subject: Zeroizing::new(subject),
        expires_at,
    })
}

#[cfg(test)]
#[path = "oidc_tests.rs"]
mod tests;
