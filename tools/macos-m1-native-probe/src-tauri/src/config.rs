use serde::{Deserialize, Serialize};
use url::Url;

pub const REDIRECT: &str = "echotalk-m1://oauth/callback";

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PublicConfig {
    pub version: u8,
    pub oidc: Option<OidcConfig>,
}

#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OidcConfig {
    pub issuer: String,
    pub client_id: String,
    pub redirect_uri: String,
    pub authorization_endpoint: String,
    pub token_endpoint: String,
    pub jwks_uri: String,
}

pub fn https_endpoint(raw: &str) -> bool {
    if raw.len() > 2048 || !raw.is_ascii() || raw.contains(['\\', '%']) {
        return false;
    }
    let Ok(url) = Url::parse(raw) else {
        return false;
    };
    url.scheme() == "https"
        && url.host_str().is_some()
        && url.username().is_empty()
        && url.password().is_none()
        && url.query().is_none()
        && url.fragment().is_none()
        && url.as_str() == raw
}

impl OidcConfig {
    pub fn valid(&self) -> bool {
        self.redirect_uri == REDIRECT
            && !self.client_id.is_empty()
            && self.client_id.len() <= 256
            && self.client_id.bytes().all(|c| c.is_ascii_graphic())
            && [
                &self.issuer,
                &self.authorization_endpoint,
                &self.token_endpoint,
                &self.jwks_uri,
            ]
            .iter()
            .all(|value| https_endpoint(value))
            && self.authorization_endpoint != self.token_endpoint
            && self.token_endpoint != self.jwks_uri
    }

    pub fn discovery_url(&self) -> String {
        format!(
            "{}/.well-known/openid-configuration",
            self.issuer.trim_end_matches('/')
        )
    }
}

pub fn parse(raw: &str) -> Result<Option<OidcConfig>, &'static str> {
    if raw.len() > 16384 {
        return Err("CONFIG_INVALID");
    }
    let config: PublicConfig = serde_json::from_str(raw).map_err(|_| "CONFIG_INVALID")?;
    let value: serde_json::Value = serde_json::from_str(raw).map_err(|_| "CONFIG_INVALID")?;
    if value.get("oidc").is_none() {
        return Err("CONFIG_INVALID");
    }
    if config.version != 1 || config.oidc.as_ref().is_some_and(|c| !c.valid()) {
        return Err("CONFIG_INVALID");
    }
    Ok(config.oidc)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_and_strict_schema() {
        assert!(parse(r#"{"version":1,"oidc":null}"#).unwrap().is_none());
        assert!(parse(include_str!("../public-config.json"))
            .unwrap()
            .is_some());
        for raw in [
            r#"{}"#,
            r#"{"version":2,"oidc":null}"#,
            r#"{"version":1,"oidc":null,"secret":"x"}"#,
            r#"{"version":1,"version":1,"oidc":null}"#,
        ] {
            assert!(parse(raw).is_err());
        }
    }

    #[test]
    fn reject_network_injection() {
        for raw in [
            "http://localhost/",
            "https://user@idp.test/",
            "https://idp.test/?x=1",
            "https://idp.test/#x",
            "https://idp.test/%2f",
            "https://idp.test/../token",
            "https://idp.test/\\token",
            "https://idp.test/\n",
        ] {
            assert!(!https_endpoint(raw));
        }
        assert!(https_endpoint("https://localhost:9443/realm/token"));
    }
}
