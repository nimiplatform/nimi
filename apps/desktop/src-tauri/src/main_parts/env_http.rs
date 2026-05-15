use super::*;

pub(super) fn load_dotenv_files() {
    let root_env_path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../.env");
    eprintln!(
        "[boot:{:}] load_dotenv_candidate path={}",
        now_ms(),
        root_env_path.display()
    );
    if root_env_path.exists() {
        match load_dotenv_file_preserve_env(&root_env_path) {
            Ok(()) => eprintln!(
                "[boot:{:}] dotenv loaded path={}",
                now_ms(),
                root_env_path.display()
            ),
            Err(error) => eprintln!(
                "[boot:{:}] dotenv load failed path={} error={}",
                now_ms(),
                root_env_path.display(),
                error
            ),
        }
    } else {
        eprintln!(
            "[boot:{:}] dotenv skipped path={}",
            now_ms(),
            root_env_path.display()
        );
    }
}

pub(super) fn load_dotenv_file_preserve_env(path: &Path) -> Result<(), String> {
    let iter = dotenvy::from_path_iter(path)
        .map_err(|error| format!("open dotenv file failed: {error}"))?;
    let mut parsed = HashMap::<String, String>::new();
    for item in iter {
        let (key, value) = item.map_err(|error| format!("parse dotenv failed: {error}"))?;
        parsed.insert(key, value);
    }

    for (key, value) in parsed {
        if !cfg!(debug_assertions) && is_security_critical_dotenv_key(&key) {
            continue;
        }
        if should_preserve_existing_env_override(&key) && env::var_os(&key).is_some() {
            continue;
        }
        let should_override = key.starts_with("NIMI_") || key.starts_with("VITE_NIMI_");
        if should_override || env::var_os(&key).is_none() {
            env::set_var(key, value);
        }
    }
    Ok(())
}

fn should_preserve_existing_env_override(key: &str) -> bool {
    matches!(key.trim(), "NIMI_RUNTIME_BRIDGE_MODE")
}

fn is_security_critical_dotenv_key(key: &str) -> bool {
    matches!(
        key.trim(),
        "NIMI_ACCESS_TOKEN"
            | "NIMI_REALM_URL"
            | "NIMI_REALM_JWKS_URL"
            | "NIMI_REALM_JWT_ISSUER"
            | "NIMI_REALM_JWT_AUDIENCE"
            | "NIMI_LOCAL_PROVIDER_ENDPOINT"
            | "NIMI_LOCAL_OPENAI_ENDPOINT"
            | "NIMI_EXTERNAL_AGENT_BIND"
            | "NIMI_EXTERNAL_AGENT_ISSUER"
            | "NIMI_DESKTOP_UPDATER_ENDPOINT"
            | "NIMI_DESKTOP_UPDATER_PUBLIC_KEY"
            | "VITE_NIMI_WEB_URL"
            | "VITE_NIMI_REALM_URL"
    )
}

fn env_http_error(code: &str, message: impl AsRef<str>) -> String {
    crate::runtime_bridge::bridge_error(code, message.as_ref())
}

pub(super) fn normalize_http_method(input: Option<String>) -> Result<Method, String> {
    let method = input.unwrap_or_else(|| "GET".to_string()).to_uppercase();
    match method.as_str() {
        "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "OPTIONS" | "HEAD" => {
            Method::from_bytes(method.as_bytes()).map_err(|error| error.to_string())
        }
        _ => Err(env_http_error(
            "DESKTOP_HTTP_METHOD_INVALID",
            format!("unsupported request method: {method}"),
        )),
    }
}

pub(super) fn normalize_origin(url: &Url) -> Result<String, String> {
    let scheme = url.scheme();
    if scheme != "http" && scheme != "https" {
        return Err(env_http_error(
            "DESKTOP_HTTP_URL_SCHEME_INVALID",
            format!("unsupported URL scheme: {scheme}"),
        ));
    }

    let host = url
        .host_str()
        .ok_or_else(|| env_http_error("DESKTOP_HTTP_URL_HOST_MISSING", "URL host is required"))?
        .to_ascii_lowercase();

    let port = url.port_or_known_default().unwrap_or(80);
    Ok(format!("{scheme}://{host}:{port}"))
}

pub(super) fn allowed_http_origins() -> HashSet<String> {
    let mut origins = HashSet::new();
    let mut candidates = vec![
        env_value("NIMI_REALM_URL", "http://localhost:3002"),
        "http://localhost".to_string(),
        "http://127.0.0.1".to_string(),
        "http://localhost:3002".to_string(),
        "http://127.0.0.1:3002".to_string(),
        env_value("NIMI_LOCAL_PROVIDER_ENDPOINT", ""),
        env_value("NIMI_LOCAL_OPENAI_ENDPOINT", ""),
    ];
    if let Ok(Some(defaults)) = crate::desktop_e2e_fixture::runtime_defaults_override() {
        candidates.push(defaults.realm.realm_base_url);
        candidates.push(defaults.realm.jwks_url);
        candidates.push(defaults.realm.revocation_url);
        candidates.push(defaults.realm.jwt_issuer);
    }

    for candidate in candidates {
        if let Ok(url) = Url::parse(candidate.as_str()) {
            if let Ok(origin) = normalize_origin(&url) {
                origins.insert(origin);
            }
            // Allow localhost and 127.0.0.1 as loopback aliases for the same port.
            if let Some(host) = url.host_str() {
                let port = url.port_or_known_default().unwrap_or(80);
                let scheme = url.scheme();
                match host {
                    "localhost" => {
                        origins.insert(format!("{scheme}://127.0.0.1:{port}"));
                    }
                    "127.0.0.1" => {
                        origins.insert(format!("{scheme}://localhost:{port}"));
                    }
                    _ => {}
                }
            }
        }
    }

    origins
}

pub(super) fn is_private_lan_http_origin(url: &Url) -> bool {
    if url.scheme() != "http" {
        return false;
    }

    let Some(host) = url.host_str() else {
        return false;
    };

    let Ok(ip) = host.parse::<std::net::IpAddr>() else {
        return false;
    };

    match ip {
        std::net::IpAddr::V4(addr) => {
            let octets = addr.octets();
            // RFC1918 private IPv4 ranges.
            octets[0] == 10
                || (octets[0] == 172 && (16..=31).contains(&octets[1]))
                || (octets[0] == 192 && octets[1] == 168)
        }
        std::net::IpAddr::V6(addr) => {
            let first = addr.segments()[0];
            // Unique local (fc00::/7) and link-local (fe80::/10).
            (first & 0xfe00) == 0xfc00 || (first & 0xffc0) == 0xfe80
        }
    }
}

pub(super) fn sanitize_headers(
    headers: Option<HashMap<String, String>>,
) -> Result<HeaderMap, String> {
    let mut header_map = HeaderMap::new();
    if let Some(values) = headers {
        for (name, value) in values {
            let normalized_name = name.trim().to_ascii_lowercase();
            if is_restricted_outbound_header(normalized_name.as_str()) {
                return Err(env_http_error(
                    "DESKTOP_HTTP_HEADER_RESTRICTED",
                    format!("restricted outbound header override blocked: {name}"),
                ));
            }
            let header_name = reqwest::header::HeaderName::from_bytes(name.as_bytes())
                .map_err(|error| error.to_string())?;
            let header_value = reqwest::header::HeaderValue::from_str(&value)
                .map_err(|error| error.to_string())?;
            header_map.insert(header_name, header_value);
        }
    }
    Ok(header_map)
}

fn is_restricted_outbound_header(name: &str) -> bool {
    matches!(
        name,
        "authorization"
            | "connection"
            | "content-length"
            | "cookie"
            | "forwarded"
            | "host"
            | "proxy-authorization"
            | "te"
            | "trailer"
            | "transfer-encoding"
            | "upgrade"
            | "via"
            | "x-real-ip"
    ) || name.starts_with("proxy-")
        || name.starts_with("x-forwarded-")
}

#[cfg(test)]
mod env_http_tests {
    use super::*;

    #[test]
    fn sanitize_headers_rejects_ssrf_sensitive_overrides() {
        let mut headers = HashMap::new();
        headers.insert("Host".to_string(), "evil.example".to_string());
        assert!(sanitize_headers(Some(headers)).is_err());
    }

    #[test]
    fn sanitize_headers_rejects_authorization_override() {
        let mut headers = HashMap::new();
        headers.insert("Authorization".to_string(), "Bearer secret".to_string());
        assert!(sanitize_headers(Some(headers)).is_err());
    }

    #[test]
    fn sanitize_headers_allows_safe_custom_headers() {
        let mut headers = HashMap::new();
        headers.insert("Content-Type".to_string(), "application/json".to_string());
        headers.insert("X-Nimi-Trace".to_string(), "trace-123".to_string());
        let sanitized = sanitize_headers(Some(headers)).expect("headers should be accepted");
        assert!(sanitized.contains_key("content-type"));
        assert!(sanitized.contains_key("x-nimi-trace"));
    }

    #[test]
    fn security_critical_dotenv_keys_are_blocked_in_release_mode() {
        assert!(is_security_critical_dotenv_key("NIMI_ACCESS_TOKEN"));
        assert!(is_security_critical_dotenv_key("NIMI_EXTERNAL_AGENT_BIND"));
        assert!(!is_security_critical_dotenv_key("NIMI_OPTIONAL_LABEL"));
    }
}

pub(super) fn preview_text_utf8_safe(input: &str, max_bytes: usize) -> String {
    if input.len() <= max_bytes {
        return input.to_string();
    }

    let mut end = max_bytes.min(input.len());
    while end > 0 && !input.is_char_boundary(end) {
        end -= 1;
    }

    let head = &input[..end];
    format!("{head}... (截断, 共 {} 字节)", input.len())
}

pub(super) fn is_sensitive_key(key: &str) -> bool {
    let normalized = key.trim().to_ascii_lowercase();
    normalized == "authorization"
        || normalized == "cookie"
        || normalized == "set-cookie"
        || normalized.contains("token")
        || normalized.contains("password")
        || normalized.contains("secret")
        || normalized.contains("api_key")
        || normalized.contains("apikey")
}

fn redact_json_value(value: &mut serde_json::Value) {
    match value {
        serde_json::Value::Object(map) => {
            let keys = map.keys().cloned().collect::<Vec<_>>();
            for key in keys {
                if let Some(entry) = map.get_mut(&key) {
                    if is_sensitive_key(&key) {
                        *entry = serde_json::Value::String("[REDACTED]".to_string());
                    } else {
                        redact_json_value(entry);
                    }
                }
            }
        }
        serde_json::Value::Array(items) => {
            for item in items {
                redact_json_value(item);
            }
        }
        _ => {}
    }
}

pub(super) fn redact_body_preview(input: &str, max_bytes: usize) -> String {
    let trimmed = input.trim();
    if trimmed.starts_with('{') || trimmed.starts_with('[') {
        if let Ok(mut parsed) = serde_json::from_str::<serde_json::Value>(trimmed) {
            redact_json_value(&mut parsed);
            if let Ok(redacted) = serde_json::to_string(&parsed) {
                return preview_text_utf8_safe(&redacted, max_bytes);
            }
        }
    }
    preview_text_utf8_safe(input, max_bytes)
}
