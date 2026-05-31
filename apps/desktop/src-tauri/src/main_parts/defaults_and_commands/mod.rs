use super::*;

pub(crate) mod macos_smoke;
pub(crate) mod system_resources;
pub(crate) mod window_and_logs;

pub(crate) const HTTP_REQUEST_RATE_LIMIT_BURST: usize = 32;
pub(crate) const HTTP_REQUEST_RATE_LIMIT_WINDOW: Duration = Duration::from_secs(5);

static HTTP_REQUEST_CLIENT: OnceLock<Result<reqwest::Client, String>> = OnceLock::new();
static HTTP_REQUEST_RATE_LIMITER: OnceLock<Mutex<HashMap<String, VecDeque<Duration>>>> =
    OnceLock::new();

fn shared_http_client() -> Result<&'static reqwest::Client, String> {
    match HTTP_REQUEST_CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .timeout(Duration::from_secs(20))
            .pool_max_idle_per_host(8)
            .build()
            .map_err(|error| error.to_string())
    }) {
        Ok(client) => Ok(client),
        Err(error) => Err(error.clone()),
    }
}

pub(crate) fn allow_http_request_origin_with_history(
    history: &mut VecDeque<Duration>,
    now: Duration,
) -> bool {
    let cutoff = now.saturating_sub(HTTP_REQUEST_RATE_LIMIT_WINDOW);
    while history.front().is_some_and(|timestamp| *timestamp < cutoff) {
        history.pop_front();
    }
    if history.len() >= HTTP_REQUEST_RATE_LIMIT_BURST {
        return false;
    }
    history.push_back(now);
    true
}

fn allow_http_request_origin(origin: &str) -> bool {
    let limiter = HTTP_REQUEST_RATE_LIMITER.get_or_init(|| Mutex::new(HashMap::new()));
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    let mut guard = limiter
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let history = guard
        .entry(origin.trim().to_string())
        .or_insert_with(VecDeque::new);
    allow_http_request_origin_with_history(history, now)
}

#[tauri::command]
pub(crate) fn runtime_defaults() -> Result<RuntimeDefaults, String> {
    if let Some(override_defaults) = crate::desktop_e2e_fixture::runtime_defaults_override()? {
        return Ok(override_defaults);
    }
    let defaults = nimi_shell_tauri::runtime_defaults::runtime_defaults();

    #[cfg(debug_assertions)]
    {
        if verbose_renderer_logs_enabled() {
            eprintln!(
                "[desktop] runtime_defaults loaded: realm_base_url={}, jwks_url={}, access_token_len={}",
                defaults.realm.realm_base_url,
                defaults.realm.jwks_url,
                defaults.realm.access_token.len()
            );
        }
    }

    Ok(defaults)
}

#[tauri::command]
pub(crate) async fn http_request(
    payload: HttpRequestPayload,
) -> Result<HttpResponsePayload, String> {
    let diag_session_id = payload
        .diagnostic_session_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.to_string());
    let method = normalize_http_method(payload.method)?;
    let url = Url::parse(payload.url.as_str()).map_err(|error| error.to_string())?;
    let origin = normalize_origin(&url)?;
    let allowed = allowed_http_origins();

    // Allow all HTTPS origins (matches CSP connect-src 'self' https:).
    // HTTP origins require explicit allow-list or LAN private IP targets.
    let is_https = url.scheme() == "https";
    if !is_https && !allowed.contains(&origin) && !is_private_lan_http_origin(&url) {
        let allowed_list = allowed.iter().cloned().collect::<Vec<_>>();
        eprintln!(
            "[http] × {} {} blocked origin={} allowed={}",
            method,
            url,
            origin,
            allowed_list.join(", ")
        );
        append_diag_log_entry(
            "http-request",
            "warn",
            "http_request",
            "request:blocked-origin",
            diag_session_id.as_deref(),
            None,
            None,
            json!({
                "method": method.to_string(),
                "url": url.as_str(),
                "origin": origin,
                "allowedOrigins": allowed_list,
            }),
        );
        return Err(format!(
            "目标地址不在允许列表：{origin}。允许列表：{}",
            allowed_list.join(", ")
        ));
    }
    if !allow_http_request_origin(&origin) {
        append_diag_log_entry(
            "http-request",
            "warn",
            "http_request",
            "request:rate-limited",
            diag_session_id.as_deref(),
            None,
            None,
            json!({
                "method": method.to_string(),
                "url": url.as_str(),
                "origin": origin,
                "windowSeconds": HTTP_REQUEST_RATE_LIMIT_WINDOW.as_secs(),
                "burst": HTTP_REQUEST_RATE_LIMIT_BURST,
            }),
        );
        return Err("HTTP 请求过于频繁，请稍后重试".to_string());
    }

    // 打印请求日志
    let mut redacted_headers = payload
        .headers
        .as_ref()
        .map(|h| {
            h.iter()
                .map(|(k, v)| {
                    if is_sensitive_key(k) {
                        (k.clone(), "[REDACTED]".to_string())
                    } else {
                        (k.clone(), v.clone())
                    }
                })
                .collect::<HashMap<String, String>>()
        })
        .unwrap_or_default();
    if payload.authorization.as_deref().is_some() {
        redacted_headers.insert("authorization".to_string(), "[REDACTED]".to_string());
    }
    let body_preview = payload
        .body
        .as_ref()
        .map(|b| redact_body_preview(b, 200))
        .unwrap_or_default();
    let body_tag = if body_preview.is_empty() {
        String::new()
    } else {
        format!(" | body: {}", body_preview)
    };
    eprintln!("[http] → {} {}{}", method, url, body_tag);
    append_diag_log_entry(
        "http-request",
        "info",
        "http_request",
        "request:start",
        diag_session_id.as_deref(),
        None,
        None,
        json!({
            "method": method.to_string(),
            "url": url.as_str(),
            "headers": redacted_headers,
            "bodyPreview": body_preview,
            "bodyBytes": payload.body.as_ref().map(|value| value.len()).unwrap_or(0),
        }),
    );

    let headers = sanitize_headers(payload.headers)?;
    let client = shared_http_client()?;
    let mut request = client.request(method.clone(), url.clone()).headers(headers);
    if let Some(authorization) = payload
        .authorization
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        let authorization_value = reqwest::header::HeaderValue::from_str(authorization)
            .map_err(|error| error.to_string())?;
        request = request.header(reqwest::header::AUTHORIZATION, authorization_value);
    }

    if !matches!(method, Method::GET | Method::HEAD) {
        if let Some(body) = payload.body {
            request = request.body(body);
        }
    }

    let start = std::time::Instant::now();
    let diag_session_for_request = diag_session_id.clone();
    let response = request.send().await.map_err(|error| {
        eprintln!("[http] × {} {} 发送失败: {}", method, url, error);
        append_diag_log_entry(
            "http-request",
            "error",
            "http_request",
            "request:send-failed",
            diag_session_for_request.as_deref(),
            None,
            None,
            json!({
                "method": method.to_string(),
                "url": url.as_str(),
                "error": error.to_string(),
            }),
        );
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
    let body_preview = redact_body_preview(&body, 200);
    let elapsed_ms = elapsed.as_secs_f64() * 1000.0;
    let resp_body_tag = if body_preview.is_empty() {
        String::new()
    } else {
        format!(" | {}", body_preview)
    };
    eprintln!(
        "[http] ← {} {} {} {:.1}ms{}",
        method,
        url,
        status.as_u16(),
        elapsed_ms,
        resp_body_tag
    );
    append_diag_log_entry(
        "http-request",
        if status.is_success() { "info" } else { "warn" },
        "http_request",
        "request:complete",
        diag_session_id.as_deref(),
        None,
        None,
        json!({
            "method": method.to_string(),
            "url": url.as_str(),
            "status": status.as_u16(),
            "ok": status.is_success(),
            "elapsedMs": elapsed.as_secs_f64() * 1000.0,
            "responseBodyPreview": body_preview,
            "responseBodyBytes": body.len(),
        }),
    );

    Ok(HttpResponsePayload {
        status: status.as_u16(),
        ok: status.is_success(),
        headers: response_headers,
        body,
    })
}
