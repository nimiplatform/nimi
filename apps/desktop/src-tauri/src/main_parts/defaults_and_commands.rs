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
fn runtime_defaults() -> Result<RuntimeDefaults, String> {
    if let Some(override_defaults) = crate::desktop_e2e_fixture::runtime_defaults_override()? {
        return Ok(override_defaults);
    }
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

    let defaults = RuntimeDefaults {
        realm: RealmDefaults {
            realm_base_url: realm_base_url.clone(),
            realtime_url: env_value("NIMI_REALTIME_URL", ""),
            access_token: env_value("NIMI_ACCESS_TOKEN", ""),
            jwks_url,
            jwt_issuer,
            jwt_audience: env_value("NIMI_REALM_JWT_AUDIENCE", "nimi-runtime"),
        },
        runtime: RuntimeExecutionDefaults {
            local_provider_endpoint: env_value("NIMI_LOCAL_PROVIDER_ENDPOINT", ""),
            local_provider_model: env_value("NIMI_LOCAL_PROVIDER_MODEL", ""),
            local_open_ai_endpoint: env_value("NIMI_LOCAL_OPENAI_ENDPOINT", ""),
            connector_id: env_value("NIMI_CONNECTOR_ID", ""),
            target_type: env_value("NIMI_TARGET_TYPE", ""),
            target_account_id: env_value("NIMI_TARGET_ACCOUNT_ID", ""),
            agent_id: env_value("NIMI_AGENT_ID", ""),
            world_id: env_value("NIMI_WORLD_ID", ""),
            provider: env_value("NIMI_PROVIDER", ""),
            user_confirmed_upload: env_value("NIMI_USER_CONFIRMED_UPLOAD", "") == "1",
        },
    };

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

include!("defaults_and_commands/system_resources.rs");

#[tauri::command]
async fn http_request(payload: HttpRequestPayload) -> Result<HttpResponsePayload, String> {
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
            "[http_request] × {} {} - blocked origin={} allowed={}",
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

    // 打印请求日志
    let redacted_headers = payload
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
    let headers_str = if redacted_headers.is_empty() {
        "  (无)".to_string()
    } else {
        redacted_headers
            .iter()
            .map(|(k, v)| format!("  {}: {}", k, v))
            .collect::<Vec<_>>()
            .join("\n")
    };
    let body_preview = payload
        .body
        .as_ref()
        .map(|b| redact_body_preview(b, 500))
        .unwrap_or_else(|| "(无)".to_string());
    eprintln!(
        "[http_request] → {} {}\n[http_request] Headers:\n{}\n[http_request] Body: {}",
        method, url, headers_str, body_preview
    );
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
    let client = reqwest::Client::new();
    let mut request = client.request(method.clone(), url.clone()).headers(headers);

    if !matches!(method, Method::GET | Method::HEAD) {
        if let Some(body) = payload.body {
            request = request.body(body);
        }
    }

    let start = std::time::Instant::now();
    let diag_session_for_request = diag_session_id.clone();
    let response = request.send().await.map_err(|error| {
        eprintln!("[http_request] × {} {} - 发送失败: {}", method, url, error);
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
    let body_preview = redact_body_preview(&body, 500);
    eprintln!(
        "[http_request] ← {} {} - {} ({:?})\n[http_request] Response Body: {}",
        method, url, status, elapsed, body_preview
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

include!("defaults_and_commands/window_and_logs.rs");
