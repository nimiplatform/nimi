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
    pub jwt_issuer: String,
    pub jwt_audience: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeExecutionDefaults {
    pub local_provider_endpoint: String,
    pub local_provider_model: String,
    pub local_open_ai_endpoint: String,
    pub credential_ref_id: String,
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
    let jwks_url = normalize_loopback_http_url(
        env_value("NIMI_REALM_JWKS_URL", default_jwks_url.as_str()).as_str(),
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
            jwt_issuer,
            jwt_audience: env_value("NIMI_REALM_JWT_AUDIENCE", "nimi-runtime"),
        },
        runtime: RuntimeExecutionDefaults {
            local_provider_endpoint: env_value(
                "NIMI_LOCAL_PROVIDER_ENDPOINT",
                "http://127.0.0.1:1234/v1",
            ),
            local_provider_model: env_value("NIMI_LOCAL_PROVIDER_MODEL", "local-model"),
            local_open_ai_endpoint: env_value(
                "NIMI_LOCAL_OPENAI_ENDPOINT",
                "http://127.0.0.1:1234/v1",
            ),
            credential_ref_id: env_value("NIMI_CREDENTIAL_REF_ID", ""),
            target_type: env_value("NIMI_TARGET_TYPE", "AGENT"),
            target_account_id: env_value("NIMI_TARGET_ACCOUNT_ID", ""),
            agent_id: env_value("NIMI_AGENT_ID", ""),
            world_id: env_value("NIMI_WORLD_ID", ""),
            provider: env_value("NIMI_PROVIDER", ""),
            user_confirmed_upload: env_value("NIMI_USER_CONFIRMED_UPLOAD", "") == "1",
        },
    }
}
