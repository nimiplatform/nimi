#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::collections::{HashMap, HashSet};
use std::io::{Read, Write};
use std::net::TcpListener;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use std::{env, path::PathBuf};

use reqwest::{header::HeaderMap, Method, Url};
use serde::{Deserialize, Serialize};
use tauri::Manager;

mod external_agent_gateway;
mod llm_adapter;
mod runtime_bridge;
mod runtime_mod;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeDefaults {
    api_base_url: String,
    realtime_url: String,
    access_token: String,
    local_provider_endpoint: String,
    local_provider_model: String,
    local_open_ai_endpoint: String,
    local_open_ai_api_key: String,
    target_type: String,
    target_account_id: String,
    agent_id: String,
    world_id: String,
    provider: String,
    user_confirmed_upload: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HttpRequestPayload {
    url: String,
    method: Option<String>,
    headers: Option<HashMap<String, String>>,
    body: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct HttpResponsePayload {
    status: u16,
    ok: bool,
    headers: HashMap<String, String>,
    body: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ConfirmPrivateSyncPayload {
    agent_id: Option<String>,
    session_id: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ConfirmPrivateSyncResult {
    confirmed: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OpenExternalUrlPayload {
    url: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct OpenExternalUrlResult {
    opened: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OauthTokenExchangePayload {
    token_url: String,
    client_id: String,
    code: String,
    code_verifier: Option<String>,
    redirect_uri: Option<String>,
    client_secret: Option<String>,
    extra: Option<HashMap<String, String>>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct OauthTokenExchangeResult {
    access_token: String,
    refresh_token: Option<String>,
    token_type: Option<String>,
    expires_in: Option<i64>,
    scope: Option<String>,
    raw: serde_json::Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OauthListenForCodePayload {
    redirect_uri: String,
    timeout_ms: Option<u64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct OauthListenForCodeResult {
    callback_url: String,
    code: Option<String>,
    state: Option<String>,
    error: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RendererLogPayload {
    level: String,
    area: String,
    message: String,
    trace_id: Option<String>,
    #[serde(rename = "flowId")]
    flow_id: Option<String>,
    source: Option<String>,
    #[serde(rename = "costMs")]
    cost_ms: Option<f64>,
    details: Option<serde_json::Value>,
}

fn env_value(key: &str, default: &str) -> String {
    std::env::var(key)
        .ok()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| default.to_string())
}

fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

fn log_boot_marker(message: &str) {
    eprintln!("[boot:{}] {}", now_ms(), message);
}

fn env_flag(name: &str) -> bool {
    matches!(
        env::var(name).ok().as_deref(),
        Some("1" | "true" | "TRUE" | "yes" | "YES" | "on" | "ON")
    )
}

fn debug_boot_enabled() -> bool {
    env_flag("NIMI_DEBUG_BOOT") || env_flag("VITE_NIMI_DEBUG_BOOT")
}

#[cfg(target_os = "macos")]
fn apply_macos_traffic_light_position(
    window: &tauri::WebviewWindow,
    x: f64,
    y: f64,
) -> Result<(), String> {
    use objc2_app_kit::{NSWindow, NSWindowButton};

    let x = x.max(0.0);
    let y = y.max(0.0);

    window
        .with_webview(move |webview| unsafe {
            let ns_window: &NSWindow = &*webview.ns_window().cast();

            let Some(close_button) = ns_window.standardWindowButton(NSWindowButton::CloseButton)
            else {
                return;
            };
            let Some(mini_button) =
                ns_window.standardWindowButton(NSWindowButton::MiniaturizeButton)
            else {
                return;
            };
            let Some(zoom_button) = ns_window.standardWindowButton(NSWindowButton::ZoomButton)
            else {
                return;
            };

            let close_frame = close_button.frame();
            let mini_frame = mini_button.frame();
            let space_between = mini_frame.origin.x - close_frame.origin.x;
            let baseline_button_y = close_frame.origin.y;

            if let Some(title_bar_container_view) =
                close_button.superview().and_then(|view| view.superview())
            {
                let mut title_bar_frame = title_bar_container_view.frame();
                let title_bar_height = close_frame.size.height + y;
                title_bar_frame.size.height = title_bar_height;
                title_bar_frame.origin.y = ns_window.frame().size.height - title_bar_height;
                title_bar_container_view.setFrame(title_bar_frame);
            }

            for (index, button) in [&close_button, &mini_button, &zoom_button]
                .into_iter()
                .enumerate()
            {
                let mut frame = button.frame();
                frame.origin.x = x + (space_between * index as f64);
                frame.origin.y = baseline_button_y;
                button.setFrame(frame);
            }
        })
        .map_err(|error| error.to_string())
}

#[cfg(target_os = "macos")]
fn schedule_macos_traffic_light_reapply(window: tauri::WebviewWindow, x: f64, y: f64) {
    for delay_ms in [80_u64, 240_u64, 800_u64] {
        let window_for_timer = window.clone();
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(delay_ms));
            let window_for_apply = window_for_timer.clone();
            let _ = window_for_timer.run_on_main_thread(move || {
                if let Err(error) = apply_macos_traffic_light_position(&window_for_apply, x, y) {
                    eprintln!(
                        "[boot:{:}] delayed traffic-light reapply failed: {}",
                        now_ms(),
                        error
                    );
                }
            });
        });
    }
}

fn install_panic_hook() {
    std::panic::set_hook(Box::new(|panic_info| {
        let payload = panic_info
            .payload()
            .downcast_ref::<&str>()
            .map(|value| (*value).to_string())
            .or_else(|| panic_info.payload().downcast_ref::<String>().cloned())
            .unwrap_or_else(|| "unknown panic payload".to_string());

        let location = panic_info
            .location()
            .map(|value| format!("{}:{}:{}", value.file(), value.line(), value.column()))
            .unwrap_or_else(|| "-".to_string());

        let thread_name = std::thread::current()
            .name()
            .map(|value| value.to_string())
            .unwrap_or_else(|| "unnamed".to_string());

        eprintln!(
            "[panic:{}] thread={} location={} payload={}",
            now_ms(),
            thread_name,
            location,
            payload,
        );
    }));
}

fn load_dotenv_files() {
    let cwd = env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));

    let candidates = [
        cwd.join(".env"),
        cwd.join("nimi/apps/desktop/.env"),
        cwd.join("../.env"),
        cwd.join("../../.env"),
        manifest_dir.join(".env"),
        manifest_dir.join("../.env"),
        manifest_dir.join("../../.env"),
    ];

    for path in candidates {
        eprintln!(
            "[boot:{:}] load_dotenv_candidate path={}",
            now_ms(),
            path.display()
        );
        if path.exists() {
            let _ = dotenvy::from_path(&path);
            eprintln!("[boot:{:}] dotenv loaded path={}", now_ms(), path.display());
        } else {
            eprintln!(
                "[boot:{:}] dotenv skipped path={}",
                now_ms(),
                path.display()
            );
        }
    }
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
        env_value("NIMI_API_BASE_URL", "http://localhost:3002"),
        "http://localhost".to_string(),
        "http://127.0.0.1".to_string(),
        "http://localhost:3002".to_string(),
        "http://127.0.0.1:3002".to_string(),
        env_value("NIMI_LOCAL_PROVIDER_ENDPOINT", "http://127.0.0.1:1234/v1"),
        env_value("NIMI_LOCAL_OPENAI_ENDPOINT", "http://127.0.0.1:1234/v1"),
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

fn sanitize_headers(headers: Option<HashMap<String, String>>) -> Result<HeaderMap, String> {
    let mut header_map = HeaderMap::new();
    if let Some(values) = headers {
        for (name, value) in values {
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
    let path = if url.path().trim().is_empty() {
        "/".to_string()
    } else {
        url.path().to_string()
    };
    Ok((host, port, path))
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

fn write_oauth_callback_page(stream: &mut std::net::TcpStream, success: bool) {
    let body = if success {
        "<html><body><h3>OAuth complete</h3><p>You can close this window now.</p></body></html>"
    } else {
        "<html><body><h3>OAuth callback failed</h3><p>Please return to app and retry.</p></body></html>"
    };
    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        body.as_bytes().len(),
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
                let _ = stream.set_read_timeout(Some(std::time::Duration::from_secs(5)));
                let target = read_request_target(&mut stream)?;
                if !target.starts_with(expected_path.as_str()) {
                    write_oauth_callback_page(&mut stream, false);
                    continue;
                }

                let callback_url = format!("http://localhost:{port}{target}");
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

#[tauri::command]
fn runtime_defaults() -> RuntimeDefaults {
    let defaults = RuntimeDefaults {
        api_base_url: env_value("NIMI_API_BASE_URL", "http://localhost:3002"),
        realtime_url: env_value("NIMI_REALTIME_URL", ""),
        access_token: env_value("NIMI_ACCESS_TOKEN", ""),
        local_provider_endpoint: env_value(
            "NIMI_LOCAL_PROVIDER_ENDPOINT",
            "http://127.0.0.1:1234/v1",
        ),
        local_provider_model: env_value("NIMI_LOCAL_PROVIDER_MODEL", "local-model"),
        local_open_ai_endpoint: env_value("NIMI_LOCAL_OPENAI_ENDPOINT", "http://127.0.0.1:1234/v1"),
        local_open_ai_api_key: env_value("NIMI_LOCAL_OPENAI_API_KEY", ""),
        target_type: env_value("NIMI_TARGET_TYPE", "AGENT"),
        target_account_id: env_value("NIMI_TARGET_ACCOUNT_ID", ""),
        agent_id: env_value("NIMI_AGENT_ID", ""),
        world_id: env_value("NIMI_WORLD_ID", ""),
        provider: env_value("NIMI_PROVIDER", ""),
        user_confirmed_upload: env_value("NIMI_USER_CONFIRMED_UPLOAD", "") == "1",
    };

    #[cfg(debug_assertions)]
    eprintln!(
        "[desktop] runtime_defaults loaded: api_base_url={}, access_token_len={}",
        defaults.api_base_url,
        defaults.access_token.len()
    );

    defaults
}

#[tauri::command]
async fn http_request(payload: HttpRequestPayload) -> Result<HttpResponsePayload, String> {
    let method = normalize_http_method(payload.method)?;
    let url = Url::parse(payload.url.as_str()).map_err(|error| error.to_string())?;
    let origin = normalize_origin(&url)?;
    let allowed = allowed_http_origins();

    // Allow all HTTPS origins (matches CSP connect-src 'self' https:).
    // HTTP origins still require explicit allow-list (localhost only).
    let is_https = url.scheme() == "https";
    if !is_https && !allowed.contains(&origin) {
        let allowed_list = allowed.iter().cloned().collect::<Vec<_>>();
        eprintln!(
            "[http_request] × {} {} - blocked origin={} allowed={}",
            method,
            url,
            origin,
            allowed_list.join(", ")
        );
        return Err(format!(
            "目标地址不在允许列表：{origin}。允许列表：{}",
            allowed_list.join(", ")
        ));
    }

    // 打印请求日志
    let headers_str = payload
        .headers
        .as_ref()
        .map(|h| {
            h.iter()
                .map(|(k, v)| {
                    if is_sensitive_key(k) {
                        format!("  {}: [REDACTED]", k)
                    } else {
                        format!("  {}: {}", k, v)
                    }
                })
                .collect::<Vec<_>>()
                .join("\n")
        })
        .unwrap_or_else(|| "  (无)".to_string());
    let body_preview = payload
        .body
        .as_ref()
        .map(|b| redact_body_preview(b, 500))
        .unwrap_or_else(|| "(无)".to_string());
    eprintln!(
        "[http_request] → {} {}\n[http_request] Headers:\n{}\n[http_request] Body: {}",
        method, url, headers_str, body_preview
    );

    let headers = sanitize_headers(payload.headers)?;
    let client = reqwest::Client::new();
    let mut request = client.request(method.clone(), url.clone()).headers(headers);

    if !matches!(method, Method::GET | Method::HEAD) {
        if let Some(body) = payload.body {
            request = request.body(body);
        }
    }

    let start = std::time::Instant::now();
    let response = request.send().await.map_err(|error| {
        eprintln!("[http_request] × {} {} - 发送失败: {}", method, url, error);
        error.to_string()
    })?;
    let elapsed = start.elapsed();
    let status = response.status();

    let response_headers = response
        .headers()
        .iter()
        .map(|(name, value)| {
            (
                name.to_string(),
                value
                    .to_str()
                    .map_or_else(|_| String::new(), |result| result.to_string()),
            )
        })
        .collect::<HashMap<_, _>>();

    let body = response.text().await.map_err(|error| error.to_string())?;

    // 打印响应日志
    let body_preview = redact_body_preview(&body, 500);
    eprintln!(
        "[http_request] ← {} {} - {} ({:?})\n[http_request] Response Body: {}",
        method, url, status, elapsed, body_preview
    );

    Ok(HttpResponsePayload {
        status: status.as_u16(),
        ok: status.is_success(),
        headers: response_headers,
        body,
    })
}

#[tauri::command]
fn open_external_url(payload: OpenExternalUrlPayload) -> Result<OpenExternalUrlResult, String> {
    let parsed = Url::parse(payload.url.as_str()).map_err(|error| error.to_string())?;
    validate_external_url(&parsed)?;
    webbrowser::open(parsed.as_str()).map_err(|error| error.to_string())?;
    Ok(OpenExternalUrlResult { opened: true })
}

#[tauri::command]
async fn oauth_token_exchange(
    payload: OauthTokenExchangePayload,
) -> Result<OauthTokenExchangeResult, String> {
    let token_url = Url::parse(payload.token_url.as_str()).map_err(|error| error.to_string())?;
    validate_external_url(&token_url)?;

    let mut form = HashMap::<String, String>::new();
    form.insert("grant_type".to_string(), "authorization_code".to_string());
    form.insert(
        "client_id".to_string(),
        payload.client_id.trim().to_string(),
    );
    form.insert("code".to_string(), payload.code.trim().to_string());

    if let Some(value) = payload.code_verifier.as_deref() {
        let normalized = value.trim();
        if !normalized.is_empty() {
            form.insert("code_verifier".to_string(), normalized.to_string());
        }
    }
    if let Some(value) = payload.redirect_uri.as_deref() {
        let normalized = value.trim();
        if !normalized.is_empty() {
            form.insert("redirect_uri".to_string(), normalized.to_string());
        }
    }
    if let Some(value) = payload.client_secret.as_deref() {
        let normalized = value.trim();
        if !normalized.is_empty() {
            form.insert("client_secret".to_string(), normalized.to_string());
        }
    }
    if let Some(extra) = payload.extra {
        for (key, value) in extra {
            let normalized_key = key.trim().to_string();
            if normalized_key.is_empty() {
                continue;
            }
            form.insert(normalized_key, value);
        }
    }

    let response = reqwest::Client::new()
        .post(token_url.clone())
        .header("content-type", "application/x-www-form-urlencoded")
        .form(&form)
        .send()
        .await
        .map_err(|error| error.to_string())?;

    let status = response.status();
    let body_text = response.text().await.map_err(|error| error.to_string())?;
    if !status.is_success() {
        let body_preview = redact_body_preview(&body_text, 300);
        return Err(format!(
            "OAuth token exchange failed: HTTP {} body={}",
            status, body_preview
        ));
    }

    let parsed = serde_json::from_str::<serde_json::Value>(&body_text)
        .map_err(|error| format!("OAuth token 响应不是 JSON: {error}"))?;

    let access_token = parsed
        .get("access_token")
        .and_then(|value| value.as_str())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "OAuth token 响应缺少 access_token".to_string())?;

    let refresh_token = parsed
        .get("refresh_token")
        .and_then(|value| value.as_str())
        .map(|value| value.to_string());
    let token_type = parsed
        .get("token_type")
        .and_then(|value| value.as_str())
        .map(|value| value.to_string());
    let scope = parsed
        .get("scope")
        .and_then(|value| value.as_str())
        .map(|value| value.to_string());
    let expires_in = parsed.get("expires_in").and_then(|value| value.as_i64());

    Ok(OauthTokenExchangeResult {
        access_token,
        refresh_token,
        token_type,
        expires_in,
        scope,
        raw: parsed,
    })
}

#[tauri::command]
async fn oauth_listen_for_code(
    payload: OauthListenForCodePayload,
) -> Result<OauthListenForCodeResult, String> {
    tauri::async_runtime::spawn_blocking(move || oauth_listen_for_code_blocking(payload))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
fn confirm_private_sync(payload: ConfirmPrivateSyncPayload) -> ConfirmPrivateSyncResult {
    let target_label = payload
        .agent_id
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("私有智能体");

    let session_detail = payload
        .session_id
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .map(|value| format!("\n会话：{value}"))
        .unwrap_or_default();

    let confirmed = rfd::MessageDialog::new()
    .set_title("PRIVATE 同步确认")
    .set_description(format!(
      "是否为 {target_label} 同步 PRIVATE 内容？{session_detail}\n\n这会将本地 PRIVATE 运行时内容上传到平台治理链。仅在你明确同意时继续。"
    ))
    .set_level(rfd::MessageLevel::Warning)
    .set_buttons(rfd::MessageButtons::YesNo)
    .show();

    ConfirmPrivateSyncResult {
        confirmed: matches!(confirmed, rfd::MessageDialogResult::Yes),
    }
}

#[tauri::command]
fn log_renderer_event(payload: RendererLogPayload) {
    let area = payload.area.trim();
    if area.is_empty() {
        return;
    }
    let level = payload.level.to_lowercase();
    if level == "debug" && !debug_boot_enabled() {
        return;
    }
    let flow_id = payload.flow_id.clone().unwrap_or_else(|| "-".to_string());
    let trace_id = payload.trace_id.unwrap_or_else(|| flow_id.clone());
    let source = payload.source.unwrap_or_else(|| "-".to_string());
    let cost_ms = payload
        .cost_ms
        .map(|value| format!(" {value}ms"))
        .unwrap_or_else(|| String::new());
    let detail_text_raw = payload
        .details
        .as_ref()
        .map(serde_json::to_string)
        .and_then(|result| result.ok())
        .unwrap_or_else(|| "-".to_string());
    let detail_text = preview_text_utf8_safe(&detail_text_raw, 1000);
    eprintln!(
        "[renderer-log][{}] {} flow_id={} source={}{} message={} details={}",
        level, area, flow_id, source, cost_ms, payload.message, detail_text,
    );
    if trace_id != flow_id {
        eprintln!(
            "[renderer-log][{}] {} trace_id={} (flow_id={}) source={}{} message={} details={}",
            level, area, trace_id, flow_id, source, cost_ms, payload.message, detail_text,
        );
    }
}

#[tauri::command]
fn start_window_drag(window: tauri::WebviewWindow) -> Result<(), String> {
    window.start_dragging().map_err(|error| error.to_string())
}

fn main() {
    install_panic_hook();
    eprintln!(
        "[boot:{:}] desktop process start pid={}",
        now_ms(),
        std::process::id()
    );
    log_boot_marker("main() entered");
    load_dotenv_files();
    log_boot_marker("dotenv files loaded");

    let result = tauri::Builder::default()
        .setup(|app| {
            eprintln!("[boot:{:}] setup entered", now_ms());
            let gateway_state =
                external_agent_gateway::ExternalAgentGatewayState::new(app.handle().clone());
            external_agent_gateway::start_external_agent_gateway(gateway_state.clone());
            app.manage(gateway_state);
            #[cfg(target_os = "macos")]
            let configured_traffic_light_position = app
                .config()
                .app
                .windows
                .iter()
                .find(|entry| entry.label == "main")
                .and_then(|window_config| {
                    window_config
                        .traffic_light_position
                        .as_ref()
                        .map(|position| (position.x, position.y))
                });
            if let Some(window) = app.get_webview_window("main") {
                eprintln!("[boot:{:}] setup found main window", now_ms());
                #[cfg(target_os = "macos")]
                {
                    let _ = window.set_title("");
                    if let Some((x, y)) = configured_traffic_light_position {
                        if let Err(error) = apply_macos_traffic_light_position(&window, x, y) {
                            eprintln!(
                                "[boot:{:}] failed to apply native traffic light position: {}",
                                now_ms(),
                                error
                            );
                        }
                        let window_for_relayout = window.clone();
                        window.on_window_event(move |event| {
                            if matches!(
                                event,
                                tauri::WindowEvent::Resized(_)
                                    | tauri::WindowEvent::ScaleFactorChanged { .. }
                            ) {
                                if let Err(error) =
                                    apply_macos_traffic_light_position(&window_for_relayout, x, y)
                                {
                                    eprintln!(
                                        "[boot:{:}] failed to re-apply traffic light position: {}",
                                        now_ms(),
                                        error
                                    );
                                }
                            }
                        });
                        schedule_macos_traffic_light_reapply(window.clone(), x, y);
                    }
                }
                #[cfg(debug_assertions)]
                {
                    let debug_boot_enabled = debug_boot_enabled();
                    eprintln!(
                        "[boot:{:}] setup debug_boot_enabled={}",
                        now_ms(),
                        debug_boot_enabled
                    );
                    if debug_boot_enabled {
                        window.open_devtools();
                        window.set_focus().ok();
                        eprintln!("[boot:{:}] devtools opened by NIMI_DEBUG_BOOT", now_ms());
                    }
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            runtime_defaults,
            http_request,
            open_external_url,
            oauth_token_exchange,
            oauth_listen_for_code,
            confirm_private_sync,
            log_renderer_event,
            start_window_drag,
            llm_adapter::commands::credential_upsert_entry,
            llm_adapter::commands::credential_list_entries,
            llm_adapter::commands::credential_delete_entry,
            llm_adapter::commands::credential_set_secret,
            llm_adapter::commands::credential_get_secret,
            llm_adapter::commands::credential_delete_secret,
            llm_adapter::commands::usage_insert_record,
            llm_adapter::commands::usage_query_records,
            llm_adapter::commands::usage_summary_records,
            runtime_mod::commands::runtime_mod_append_audit,
            runtime_mod::commands::runtime_mod_query_audit,
            runtime_mod::commands::runtime_mod_delete_audit,
            runtime_mod::commands::runtime_mod_list_local_manifests,
            runtime_mod::commands::runtime_mod_read_local_entry,
            runtime_mod::commands::runtime_mod_pick_manifest_path,
            runtime_mod::commands::runtime_mod_get_action_idempotency,
            runtime_mod::commands::runtime_mod_put_action_idempotency,
            runtime_mod::commands::runtime_mod_purge_action_idempotency,
            runtime_mod::commands::runtime_mod_get_action_verify_ticket,
            runtime_mod::commands::runtime_mod_put_action_verify_ticket,
            runtime_mod::commands::runtime_mod_delete_action_verify_ticket,
            runtime_mod::commands::runtime_mod_purge_action_verify_tickets,
            runtime_mod::commands::runtime_mod_put_action_execution_ledger,
            runtime_mod::commands::runtime_mod_query_action_execution_ledger,
            runtime_mod::commands::runtime_mod_purge_action_execution_ledger,
            external_agent_gateway::external_agent_issue_token,
            external_agent_gateway::external_agent_revoke_token,
            external_agent_gateway::external_agent_list_tokens,
            external_agent_gateway::external_agent_verify_execution_context,
            external_agent_gateway::external_agent_sync_action_descriptors,
            external_agent_gateway::external_agent_complete_execution,
            external_agent_gateway::external_agent_gateway_status,
            runtime_bridge::runtime_bridge_unary,
            runtime_bridge::runtime_bridge_stream_open,
            runtime_bridge::runtime_bridge_stream_close,
            runtime_bridge::runtime_bridge_status,
            runtime_bridge::runtime_bridge_start,
            runtime_bridge::runtime_bridge_stop,
            runtime_bridge::runtime_bridge_restart
        ])
        .run(tauri::generate_context!());

    match result {
        Ok(_) => {
            eprintln!("[boot:{:}] tauri run completed", now_ms());
        }
        Err(error) => {
            eprintln!("[boot:{:}] tauri run failed: {error}", now_ms());
            panic!("error while running tauri application: {error}");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{allowed_http_origins, normalize_origin};
    use reqwest::Url;

    #[test]
    fn normalize_origin_keeps_scheme_host_and_default_port() {
        let parsed = Url::parse("https://api.example.com/v1/chat").expect("valid url");
        let origin = normalize_origin(&parsed).expect("origin");
        assert_eq!(origin, "https://api.example.com:443");
    }

    #[test]
    fn normalize_origin_rejects_non_http_scheme() {
        let parsed = Url::parse("file:///tmp/data.txt").expect("valid url");
        let result = normalize_origin(&parsed);
        assert!(result.is_err());
    }

    #[test]
    fn allowed_http_origins_contains_runtime_defaults() {
        std::env::set_var("NIMI_API_BASE_URL", "https://gateway.nimi.local/v1");
        std::env::set_var("NIMI_LOCAL_PROVIDER_ENDPOINT", "http://127.0.0.1:1234/v1");
        std::env::set_var("NIMI_LOCAL_OPENAI_ENDPOINT", "http://localhost:1234/v1");

        let origins = allowed_http_origins();

        assert!(origins.contains("https://gateway.nimi.local:443"));
        assert!(origins.contains("http://127.0.0.1:1234"));
        assert!(origins.contains("http://localhost:1234"));
    }
}
