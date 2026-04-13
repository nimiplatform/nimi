use serde::Serialize;
use url::Url;

fn env_value(key: &str, default: &str) -> String {
    std::env::var(key)
        .ok()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| default.to_string())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RealmDefaults {
    pub realm_base_url: String,
    pub realtime_url: String,
    pub access_token: String,
    pub jwks_url: String,
    pub revocation_url: String,
    pub jwt_issuer: String,
    pub jwt_audience: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeExecutionDefaults {
    pub local_provider_endpoint: String,
    pub local_provider_model: String,
    pub local_open_ai_endpoint: String,
    pub connector_id: String,
    pub target_type: String,
    pub target_account_id: String,
    pub agent_id: String,
    pub world_id: String,
    pub provider: String,
    pub user_confirmed_upload: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeDefaults {
    pub realm: RealmDefaults,
    pub runtime: RuntimeExecutionDefaults,
}

fn normalize_loopback_http_url(raw: &str, default_port: u16, trim_trailing_slash: bool) -> String {
    let value = raw.trim();
    if value.is_empty() {
        return String::new();
    }

    let mut normalized = match Url::parse(value) {
        Ok(mut parsed) => {
            let host = parsed
                .host_str()
                .map(|text| text.to_ascii_lowercase())
                .unwrap_or_default();
            let has_explicit_port = parsed.port().is_some();
            let is_loopback_http =
                parsed.scheme() == "http" && (host == "localhost" || host == "127.0.0.1");
            if is_loopback_http && !has_explicit_port {
                let _ = parsed.set_port(Some(default_port));
            }
            parsed.to_string()
        }
        Err(_) => value.to_string(),
    };

    if trim_trailing_slash {
        normalized = normalized.trim_end_matches('/').to_string();
    }

    normalized
}

fn resolve_realm_default_port(realm_base_url: &str) -> u16 {
    Url::parse(realm_base_url)
        .ok()
        .and_then(|parsed| parsed.port_or_known_default())
        .unwrap_or(3002)
}

fn env_value_any(keys: &[&str], default: &str) -> String {
    keys.iter()
        .find_map(|key| {
            std::env::var(key)
                .ok()
                .filter(|value| !value.trim().is_empty())
        })
        .unwrap_or_else(|| default.to_string())
}

#[tauri::command]
pub fn runtime_defaults() -> RuntimeDefaults {
    let realm_base_url = normalize_loopback_http_url(
        env_value("NIMI_REALM_URL", "http://localhost:3002").as_str(),
        3002,
        true,
    );
    let realm_default_port = resolve_realm_default_port(realm_base_url.as_str());
    let normalized_realm_base_url = realm_base_url.trim_end_matches('/');
    let default_jwks_url = if normalized_realm_base_url.is_empty() {
        "http://localhost:3002/api/auth/jwks".to_string()
    } else {
        format!("{}/api/auth/jwks", normalized_realm_base_url)
    };
    let default_revocation_url = if normalized_realm_base_url.is_empty() {
        "http://localhost:3002/api/auth/revocation".to_string()
    } else {
        format!("{}/api/auth/revocation", normalized_realm_base_url)
    };
    let jwks_url = normalize_loopback_http_url(
        env_value("NIMI_REALM_JWKS_URL", default_jwks_url.as_str()).as_str(),
        realm_default_port,
        true,
    );
    let revocation_url = normalize_loopback_http_url(
        env_value("NIMI_REALM_REVOCATION_URL", default_revocation_url.as_str()).as_str(),
        realm_default_port,
        true,
    );
    let jwt_issuer = normalize_loopback_http_url(
        env_value("NIMI_REALM_JWT_ISSUER", realm_base_url.as_str()).as_str(),
        realm_default_port,
        true,
    );

    RuntimeDefaults {
        realm: RealmDefaults {
            realm_base_url: realm_base_url.clone(),
            realtime_url: env_value("NIMI_REALTIME_URL", ""),
            access_token: String::new(),
            jwks_url,
            revocation_url,
            jwt_issuer,
            jwt_audience: env_value("NIMI_REALM_JWT_AUDIENCE", "nimi-runtime"),
        },
        runtime: RuntimeExecutionDefaults {
            local_provider_endpoint: env_value("NIMI_LOCAL_PROVIDER_ENDPOINT", ""),
            local_provider_model: env_value("NIMI_LOCAL_PROVIDER_MODEL", ""),
            local_open_ai_endpoint: env_value("NIMI_LOCAL_OPENAI_ENDPOINT", ""),
            connector_id: env_value_any(&["NIMI_CONNECTOR_ID", "NIMI_CREDENTIAL_REF_ID"], ""),
            target_type: env_value("NIMI_TARGET_TYPE", ""),
            target_account_id: env_value("NIMI_TARGET_ACCOUNT_ID", ""),
            agent_id: env_value("NIMI_AGENT_ID", ""),
            world_id: env_value("NIMI_WORLD_ID", ""),
            provider: env_value("NIMI_PROVIDER", ""),
            user_confirmed_upload: env_value("NIMI_USER_CONFIRMED_UPLOAD", "") == "1",
        },
    }
}

#[cfg(test)]
mod tests {
    use super::runtime_defaults;

    fn with_env_vars(vars: &[(&str, Option<&str>)], run: impl FnOnce()) {
        let saved: Vec<(String, Option<String>)> = vars
            .iter()
            .map(|(key, _)| ((*key).to_string(), std::env::var(key).ok()))
            .collect();
        for (key, value) in vars {
            match value {
                Some(value) => std::env::set_var(key, value),
                None => std::env::remove_var(key),
            }
        }

        run();

        for (key, value) in saved {
            match value {
                Some(value) => std::env::set_var(&key, value),
                None => std::env::remove_var(&key),
            }
        }
    }

    #[test]
    fn runtime_defaults_provide_non_empty_required_realm_defaults_without_env() {
        with_env_vars(
            &[
                ("NIMI_REALM_URL", None),
                ("NIMI_REALM_JWKS_URL", None),
                ("NIMI_REALM_REVOCATION_URL", None),
                ("NIMI_REALM_JWT_ISSUER", None),
                ("NIMI_REALM_JWT_AUDIENCE", None),
            ],
            || {
                let defaults = runtime_defaults();
                assert_eq!(defaults.realm.realm_base_url, "http://localhost:3002");
                assert_eq!(defaults.realm.jwks_url, "http://localhost:3002/api/auth/jwks");
                assert_eq!(
                    defaults.realm.revocation_url,
                    "http://localhost:3002/api/auth/revocation"
                );
                assert_eq!(defaults.realm.jwt_issuer, "http://localhost:3002");
                assert_eq!(defaults.realm.jwt_audience, "nimi-runtime");
            },
        );
    }

    #[test]
    fn runtime_defaults_normalize_loopback_without_explicit_port() {
        with_env_vars(
            &[
                ("NIMI_REALM_URL", Some("http://localhost")),
                ("NIMI_REALM_JWKS_URL", None),
                ("NIMI_REALM_REVOCATION_URL", None),
                ("NIMI_REALM_JWT_ISSUER", None),
                ("NIMI_REALM_JWT_AUDIENCE", None),
            ],
            || {
                let defaults = runtime_defaults();
                assert_eq!(defaults.realm.realm_base_url, "http://localhost:3002");
                assert_eq!(defaults.realm.jwks_url, "http://localhost:3002/api/auth/jwks");
                assert_eq!(
                    defaults.realm.revocation_url,
                    "http://localhost:3002/api/auth/revocation"
                );
                assert_eq!(defaults.realm.jwt_issuer, "http://localhost:3002");
            },
        );
    }

    #[test]
    fn runtime_defaults_emit_connector_id_and_allow_legacy_env_fallback() {
        with_env_vars(
            &[
                ("NIMI_CONNECTOR_ID", None),
                ("NIMI_CREDENTIAL_REF_ID", Some("legacy-ref")),
            ],
            || {
                let defaults = runtime_defaults();
                assert_eq!(defaults.runtime.connector_id, "legacy-ref");
            },
        );
    }
}
