fn load_dotenv_files() {
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

fn load_dotenv_file_preserve_env(path: &Path) -> Result<(), String> {
    let iter = dotenvy::from_path_iter(path)
        .map_err(|error| format!("open dotenv file failed: {error}"))?;
    let mut parsed = HashMap::<String, String>::new();
    for item in iter {
        let (key, value) = item.map_err(|error| format!("parse dotenv failed: {error}"))?;
        parsed.insert(key, value);
    }

    // For project-scoped NIMI variables, prefer dotenv values to avoid stale
    // inherited shell/IDE env overriding repository .env unexpectedly.
    // For non-NIMI keys, keep explicit process env precedence.
    for (key, value) in parsed {
        let should_override = key.starts_with("NIMI_") || key.starts_with("VITE_NIMI_");
        if should_override || env::var_os(&key).is_none() {
            env::set_var(key, value);
        }
    }
    Ok(())
}

fn normalize_http_method(input: Option<String>) -> Result<Method, String> {
    let method = input.unwrap_or_else(|| "GET".to_string()).to_uppercase();
    match method.as_str() {
        "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "OPTIONS" | "HEAD" => {
            Method::from_bytes(method.as_bytes()).map_err(|error| error.to_string())
        }
        _ => Err(format!("不支持的请求方法：{method}")),
    }
}

fn normalize_origin(url: &Url) -> Result<String, String> {
    let scheme = url.scheme();
    if scheme != "http" && scheme != "https" {
        return Err(format!("不支持的协议：{scheme}"));
    }

    let host = url
        .host_str()
        .ok_or_else(|| "URL 缺少 host".to_string())?
        .to_ascii_lowercase();

    let port = url.port_or_known_default().unwrap_or(80);
    Ok(format!("{scheme}://{host}:{port}"))
}

fn allowed_http_origins() -> HashSet<String> {
    let mut origins = HashSet::new();
    let candidates = [
        env_value("NIMI_REALM_URL", "http://localhost:3002"),
        "http://localhost".to_string(),
        "http://127.0.0.1".to_string(),
        "http://localhost:3002".to_string(),
        "http://127.0.0.1:3002".to_string(),
        env_value("NIMI_LOCAL_PROVIDER_ENDPOINT", ""),
        env_value("NIMI_LOCAL_OPENAI_ENDPOINT", ""),
    ];

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

fn is_private_lan_http_origin(url: &Url) -> bool {
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

fn sanitize_headers(headers: Option<HashMap<String, String>>) -> Result<HeaderMap, String> {
    let mut header_map = HeaderMap::new();
    if let Some(values) = headers {
        for (name, value) in values {
            let normalized_name = name.trim().to_ascii_lowercase();
            if is_restricted_outbound_header(normalized_name.as_str()) {
                return Err(format!("不允许覆盖受限请求头：{name}"));
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

fn is_loopback_http(url: &Url) -> bool {
    if url.scheme() != "http" {
        return false;
    }
    matches!(url.host_str(), Some("localhost" | "127.0.0.1"))
}

fn validate_external_url(url: &Url) -> Result<(), String> {
    if url.scheme() == "https" || is_loopback_http(url) {
        return Ok(());
    }
    Err("仅支持 https 或 localhost/127.0.0.1 的 http 地址".to_string())
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

fn parse_oauth_redirect_uri(redirect_uri: &str) -> Result<(String, u16, String), String> {
    let url = Url::parse(redirect_uri).map_err(|error| error.to_string())?;
    if url.scheme() != "http" {
        return Err("OAuth redirect_uri 仅支持 http loopback".to_string());
    }
    let host = url
        .host_str()
        .ok_or_else(|| "OAuth redirect_uri 缺少 host".to_string())?
        .to_ascii_lowercase();
    if host != "localhost" && host != "127.0.0.1" {
        return Err("OAuth redirect_uri host 必须是 localhost 或 127.0.0.1".to_string());
    }
    let port = url
        .port_or_known_default()
        .ok_or_else(|| "OAuth redirect_uri 缺少端口".to_string())?;
    if url.query().is_some() || url.fragment().is_some() {
        return Err("OAuth redirect_uri 不允许携带 query 或 fragment".to_string());
    }
    let path = if url.path().trim().is_empty() {
        "/".to_string()
    } else {
        url.path().to_string()
    };
    Ok((host, port, path))
}

fn normalize_oauth_callback_target(target: &str, expected_path: &str) -> Result<String, String> {
    let normalized_target = target.trim();
    if normalized_target.is_empty() {
        return Err("OAuth callback 缺少请求 target".to_string());
    }
    if !normalized_target.starts_with('/') || normalized_target.starts_with("//") {
        return Err("OAuth callback target 必须是绝对路径".to_string());
    }
    if normalized_target.contains('#') {
        return Err("OAuth callback target 不允许包含 fragment".to_string());
    }
    let callback_url = format!("http://localhost{normalized_target}");
    let parsed = Url::parse(callback_url.as_str()).map_err(|error| error.to_string())?;
    if parsed.path() != expected_path {
        return Err(format!(
            "OAuth callback path 不匹配：expected={expected_path} actual={}",
            parsed.path()
        ));
    }
    let mut normalized = parsed.path().to_string();
    if let Some(query) = parsed.query() {
        normalized.push('?');
        normalized.push_str(query);
    }
    Ok(normalized)
}

fn read_request_target(stream: &mut std::net::TcpStream) -> Result<String, String> {
    let mut buffer = [0_u8; 8192];
    let bytes = stream
        .read(&mut buffer)
        .map_err(|error| error.to_string())?;
    if bytes == 0 {
        return Err("OAuth callback 请求体为空".to_string());
    }
    let request = String::from_utf8_lossy(&buffer[..bytes]);
    let first_line = request
        .lines()
        .next()
        .ok_or_else(|| "OAuth callback 请求格式无效".to_string())?;
    let mut parts = first_line.split_whitespace();
    let method = parts.next().unwrap_or_default().to_ascii_uppercase();
    let target = parts.next().unwrap_or_default().to_string();
    if method != "GET" {
        return Err(format!("OAuth callback 仅支持 GET，当前={method}"));
    }
    if target.trim().is_empty() {
        return Err("OAuth callback 缺少请求 target".to_string());
    }
    Ok(target)
}

const DESKTOP_OAUTH_RESULT_PAGE_TEMPLATE: &str = include_str!(
    "../../../../_libs/shell-auth/src/logic/native-oauth-result-page.template.html"
);

fn render_oauth_callback_page(success: bool) -> String {
    if success {
        DESKTOP_OAUTH_RESULT_PAGE_TEMPLATE
            .replace("__PAGE_TITLE__", "OAuth Complete - Nimi")
            .replace("__BODY_BACKGROUND__", "#ffffff")
            .replace("__LOGO_ANIMATION_NAME__", "float")
            .replace("__LOGO_ANIMATION_DURATION__", "3s")
            .replace("__LOGO_ANIMATION_REPEAT__", "infinite")
            .replace("__LOGO_FILTER__", "none")
            .replace(
                "__SUCCESS_ICON_ANIMATION__",
                "scaleIn 0.5s ease-out 0.3s both",
            )
            .replace("__ERROR_ICON_ANIMATION__", "scaleIn 0.5s ease-out")
            .replace("__STATUS_ICON_CLASS__", "success_icon")
            .replace(
                "__STATUS_ICON_SVG__",
                r#"<svg class="checkmark" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"></polyline></svg>"#,
            )
            .replace("__HEADING__", "Authentication Complete!")
            .replace("__HEADING_ANIMATION__", "fadeIn 0.5s ease-out 0.4s both")
            .replace(
                "__MESSAGE_PRIMARY__",
                "You have successfully signed in to Nimi.",
            )
            .replace("__MESSAGE_ANIMATION__", "fadeIn 0.5s ease-out 0.5s both")
            .replace("__MESSAGE_SECONDARY_BLOCK__", "")
            .replace(
                "__ACTION_BLOCK__",
                r#"<div class="auto_close">You can close this window now<span class="dots"><span class="dot"></span><span class="dot"></span><span class="dot"></span></span></div>"#,
            )
            .replace("__ACTION_ANIMATION__", "fadeIn 0.5s ease-out 0.7s both")
            .replace(
                "__AUTO_CLOSE_SCRIPT__",
                r#"<script>setTimeout(function(){window.close();}, 3000);</script>"#,
            )
    } else {
        DESKTOP_OAUTH_RESULT_PAGE_TEMPLATE
            .replace("__PAGE_TITLE__", "OAuth Failed - Nimi")
            .replace(
                "__BODY_BACKGROUND__",
                "linear-gradient(135deg, #f093fb 0%, #f5576c 100%)",
            )
            .replace("__LOGO_ANIMATION_NAME__", "shake")
            .replace("__LOGO_ANIMATION_DURATION__", "0.8s")
            .replace("__LOGO_ANIMATION_REPEAT__", "1")
            .replace(
                "__LOGO_FILTER__",
                "drop-shadow(0 10px 20px rgba(240, 147, 251, 0.3))",
            )
            .replace(
                "__SUCCESS_ICON_ANIMATION__",
                "scaleIn 0.5s ease-out 0.3s both",
            )
            .replace("__ERROR_ICON_ANIMATION__", "scaleIn 0.5s ease-out")
            .replace("__STATUS_ICON_CLASS__", "error_icon")
            .replace(
                "__STATUS_ICON_SVG__",
                r#"<svg class="x_mark" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>"#,
            )
            .replace("__HEADING__", "Authentication Failed")
            .replace("__HEADING_ANIMATION__", "fadeIn 0.5s ease-out 0.2s both")
            .replace(
                "__MESSAGE_PRIMARY__",
                "Something went wrong during the sign-in process.",
            )
            .replace("__MESSAGE_ANIMATION__", "fadeIn 0.5s ease-out 0.3s both")
            .replace(
                "__MESSAGE_SECONDARY_BLOCK__",
                "<p>Please return to the app and try again.</p>",
            )
            .replace(
                "__ACTION_BLOCK__",
                r#"<button class="retry_btn" onclick="window.close()">Close Window</button>"#,
            )
            .replace("__ACTION_ANIMATION__", "fadeIn 0.5s ease-out 0.4s both")
            .replace("__AUTO_CLOSE_SCRIPT__", "")
    }
}

fn write_oauth_callback_page(stream: &mut std::net::TcpStream, success: bool) {
    let body = render_oauth_callback_page(success);
    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nCache-Control: no-store, no-cache, must-revalidate\r\nPragma: no-cache\r\nExpires: 0\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        body.len(),
        body
    );
    let _ = stream.write_all(response.as_bytes());
    let _ = stream.flush();
}

fn oauth_listen_for_code_blocking(
    payload: OauthListenForCodePayload,
) -> Result<OauthListenForCodeResult, String> {
    let (host, port, expected_path) = parse_oauth_redirect_uri(payload.redirect_uri.as_str())?;
    let bind_host = if host == "localhost" {
        "127.0.0.1".to_string()
    } else {
        host.clone()
    };
    let address = format!("{bind_host}:{port}");
    let listener = TcpListener::bind(address.as_str()).map_err(|error| error.to_string())?;
    listener
        .set_nonblocking(true)
        .map_err(|error| error.to_string())?;

    let timeout_ms = payload.timeout_ms.unwrap_or(180_000).clamp(10_000, 600_000);
    let deadline = std::time::Instant::now() + std::time::Duration::from_millis(timeout_ms);

    loop {
        match listener.accept() {
            Ok((mut stream, _)) => {
                stream
                    .set_nonblocking(false)
                    .map_err(|error| error.to_string())?;
                let _ = stream.set_read_timeout(Some(std::time::Duration::from_secs(5)));
                let target = read_request_target(&mut stream)?;
                let normalized_target =
                    match normalize_oauth_callback_target(target.as_str(), expected_path.as_str())
                    {
                        Ok(value) => value,
                        Err(_) => {
                            write_oauth_callback_page(&mut stream, false);
                            continue;
                        }
                    };

                let callback_url = format!("http://localhost:{port}{normalized_target}");
                let parsed =
                    Url::parse(callback_url.as_str()).map_err(|error| error.to_string())?;
                let code = parsed
                    .query_pairs()
                    .find(|(key, _)| key == "code")
                    .map(|(_, value)| value.to_string());
                let state = parsed
                    .query_pairs()
                    .find(|(key, _)| key == "state")
                    .map(|(_, value)| value.to_string());
                let error = parsed
                    .query_pairs()
                    .find(|(key, _)| key == "error")
                    .map(|(_, value)| value.to_string());

                write_oauth_callback_page(&mut stream, code.is_some() && error.is_none());

                return Ok(OauthListenForCodeResult {
                    callback_url,
                    code,
                    state,
                    error,
                });
            }
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                if std::time::Instant::now() >= deadline {
                    return Err("等待 OAuth 回调超时".to_string());
                }
                std::thread::sleep(std::time::Duration::from_millis(80));
            }
            Err(error) => {
                return Err(error.to_string());
            }
        }
    }
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
    fn sanitize_headers_allows_safe_custom_headers() {
        let mut headers = HashMap::new();
        headers.insert("Content-Type".to_string(), "application/json".to_string());
        headers.insert("X-Nimi-Trace".to_string(), "trace-123".to_string());
        let sanitized = sanitize_headers(Some(headers)).expect("headers should be accepted");
        assert!(sanitized.contains_key("content-type"));
        assert!(sanitized.contains_key("x-nimi-trace"));
    }

    #[test]
    fn parse_oauth_redirect_uri_rejects_query_and_fragment() {
        assert!(parse_oauth_redirect_uri("http://127.0.0.1:4100/oauth/callback?next=%2F")
            .is_err());
        assert!(parse_oauth_redirect_uri("http://127.0.0.1:4100/oauth/callback#done").is_err());
    }

    #[test]
    fn normalize_oauth_callback_target_requires_exact_callback_path() {
        assert_eq!(
            normalize_oauth_callback_target(
                "/oauth/callback?code=abc&state=123",
                "/oauth/callback"
            )
            .unwrap(),
            "/oauth/callback?code=abc&state=123"
        );
        assert!(
            normalize_oauth_callback_target("/oauth/callback/extra?code=abc", "/oauth/callback")
                .is_err()
        );
        assert!(
            normalize_oauth_callback_target("//oauth/callback?code=abc", "/oauth/callback")
                .is_err()
        );
    }
}

fn preview_text_utf8_safe(input: &str, max_bytes: usize) -> String {
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

fn is_sensitive_key(key: &str) -> bool {
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

fn redact_body_preview(input: &str, max_bytes: usize) -> String {
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
