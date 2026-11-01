use super::*;

fn config() -> OidcConfig {
    OidcConfig {
        issuer: "https://issuer.example.test/".into(),
        client_id: "m1-native".into(),
        redirect_uri: crate::config::REDIRECT.into(),
        authorization_endpoint: "https://issuer.example.test/auth".into(),
        token_endpoint: "https://issuer.example.test/token".into(),
        jwks_uri: "https://issuer.example.test/keys".into(),
    }
}

#[test]
fn real_openidconnect_signed_tokens_reject_nonce_issuer_audience_signature_expiry_azp_and_hash() {
    let fixture: serde_json::Value =
        serde_json::from_str(include_str!("oidc-fixture.json")).unwrap();
    let keys: CoreJsonWebKeySet = serde_json::from_value(fixture["jwks"].clone()).unwrap();
    let config = config();
    let verifier = CoreIdTokenVerifier::new_public_client(
        ClientId::new(config.client_id.clone()),
        IssuerUrl::new(config.issuer.clone()).unwrap(),
        keys,
    );
    let access = AccessToken::new("synthetic-access".into());
    for (name, jwt) in fixture["tokens"].as_object().unwrap() {
        let id: CoreIdToken = jwt.as_str().unwrap().parse().unwrap();
        let result = verify_identity(&id, &access, &verifier, &config, &"N".repeat(43));
        if name == "valid" {
            assert_eq!(
                result.unwrap(),
                ("synthetic-test-subject".into(), 4102444800)
            );
        } else {
            assert_eq!(result.err(), Some("IDENTITY_INVALID"), "case {name}");
        }
    }
}

#[test]
fn http_destinations_and_methods_are_frozen_before_any_network() {
    let http = BoundedHttp::new(&config()).unwrap();
    for (method, url, allowed) in [
        (
            "GET",
            "https://issuer.example.test/.well-known/openid-configuration",
            true,
        ),
        ("GET", "https://issuer.example.test/keys", true),
        ("POST", "https://issuer.example.test/token", true),
        ("GET", "https://issuer.example.test/token", false),
        ("POST", "https://issuer.example.test/keys", false),
        ("GET", "https://evil.test/keys", false),
        ("POST", "http://issuer.example.test/token", false),
        (
            "POST",
            "https://issuer.example.test/token?injection=1",
            false,
        ),
    ] {
        let request = openidconnect::http::Request::builder()
            .method(method)
            .uri(url)
            .body(Vec::new())
            .unwrap();
        assert_eq!(http.allowed(&request), allowed);
        if !allowed {
            assert_eq!(
                http.call(request).unwrap_err().to_string(),
                "OIDC_HTTP_FAILED"
            );
        }
    }
}

#[test]
fn discovery_uses_real_library_but_rejects_mismatched_endpoints_without_real_http() {
    let config = config();
    let metadata = serde_json::json!({
        "issuer": config.issuer,
        "authorization_endpoint": "https://evil.test/auth",
        "token_endpoint": config.token_endpoint,
        "jwks_uri": config.jwks_uri,
        "response_types_supported": ["code"],
        "subject_types_supported": ["public"],
        "id_token_signing_alg_values_supported": ["RS256"]
    });
    let http = |request: HttpRequest| -> Result<HttpResponse, std::io::Error> {
        let body = if request.uri().to_string() == config.discovery_url() {
            serde_json::to_vec(&metadata).unwrap()
        } else {
            assert_eq!(request.uri().to_string(), config.jwks_uri);
            br#"{"keys":[]}"#.to_vec()
        };
        Ok(openidconnect::http::Response::builder()
            .status(200)
            .header("content-type", "application/json")
            .body(body)
            .unwrap())
    };
    assert_eq!(
        discover(&config, &http).err(),
        Some("OIDC_METADATA_REJECTED")
    );
}

#[test]
fn production_oidc_flow_with_injected_http_uses_public_pkce_and_keeps_access_token_distinct() {
    use std::sync::atomic::{AtomicUsize, Ordering};
    let fixture: serde_json::Value =
        serde_json::from_str(include_str!("oidc-fixture.json")).unwrap();
    let config = config();
    let tx = Transaction {
        state: "S".repeat(43),
        nonce: "N".repeat(43),
        verifier: "V".repeat(43),
        config: config.clone(),
        created_at: 1000,
        expires_at: 1300,
        generation: 1,
    };
    let metadata = serde_json::json!({
        "issuer": config.issuer, "authorization_endpoint": config.authorization_endpoint,
        "token_endpoint": config.token_endpoint, "jwks_uri": config.jwks_uri,
        "response_types_supported": ["code"], "subject_types_supported": ["public"],
        "id_token_signing_alg_values_supported": ["RS256"]
    });
    let exchanges = AtomicUsize::new(0);
    let http = |request: HttpRequest| -> Result<HttpResponse, std::io::Error> {
        let uri = request.uri().to_string();
        let body = if uri == config.discovery_url() {
            assert_eq!(request.method().as_str(), "GET");
            metadata.clone()
        } else if uri == config.jwks_uri {
            assert_eq!(request.method().as_str(), "GET");
            fixture["jwks"].clone()
        } else {
            assert_eq!(uri, config.token_endpoint);
            assert_eq!(request.method().as_str(), "POST");
            assert!(!request.headers().contains_key("authorization"));
            let pairs: std::collections::HashMap<_, _> =
                url::form_urlencoded::parse(request.body())
                    .into_owned()
                    .collect();
            assert_eq!(pairs.get("client_id").unwrap(), &config.client_id);
            assert_eq!(pairs.get("redirect_uri").unwrap(), crate::config::REDIRECT);
            assert_eq!(pairs.get("grant_type").unwrap(), "authorization_code");
            assert_eq!(pairs.get("code_verifier").unwrap(), &tx.verifier);
            assert_eq!(pairs.get("code").unwrap(), "synthetic-code");
            assert!(!pairs.contains_key("client_secret"));
            assert!(!pairs.contains_key("refresh_token"));
            exchanges.fetch_add(1, Ordering::SeqCst);
            serde_json::json!({"token_type":"Bearer", "access_token":"synthetic-access",
                "expires_in":60, "id_token":fixture["tokens"]["valid"],
                "refresh_token":"synthetic-refresh-not-retained"})
        };
        Ok(openidconnect::http::Response::builder()
            .status(200)
            .header("content-type", "application/json")
            .body(serde_json::to_vec(&body).unwrap())
            .unwrap())
    };
    let url = authorization_with_http(&tx, &http).unwrap();
    assert!(crate::auth::authorization_valid(&url, &tx));
    let session = exchange_with_http(&tx, "synthetic-code", &http).unwrap();
    assert_eq!(session.access_token.as_str(), "synthetic-access");
    assert_ne!(
        session.access_token.as_str(),
        fixture["tokens"]["valid"].as_str().unwrap()
    );
    assert_eq!(exchanges.load(Ordering::SeqCst), 1);
}
