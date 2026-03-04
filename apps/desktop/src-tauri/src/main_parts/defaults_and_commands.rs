#[tauri::command]
fn runtime_defaults() -> RuntimeDefaults {
    let defaults = RuntimeDefaults {
        realm: RealmDefaults {
            realm_base_url: env_value("NIMI_REALM_URL", "http://localhost:3002"),
            realtime_url: env_value("NIMI_REALTIME_URL", ""),
            access_token: env_value("NIMI_ACCESS_TOKEN", ""),
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
    };

    #[cfg(debug_assertions)]
    eprintln!(
        "[desktop] runtime_defaults loaded: realm_base_url={}, access_token_len={}",
        defaults.realm.realm_base_url,
        defaults.realm.access_token.len()
    );

    defaults
}

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

    let session_trace_id = session_trace_id_from_details(&payload.details)
        .unwrap_or_else(|| app_run_session_id().to_string());
    let details = payload.details.unwrap_or_else(|| json!({}));
    let trace_id_for_diag = if trace_id.trim().is_empty() || trace_id == "-" {
        None
    } else {
        Some(trace_id.as_str())
    };
    let flow_id_for_diag = if flow_id.trim().is_empty() || flow_id == "-" {
        None
    } else {
        Some(flow_id.as_str())
    };
    append_diag_log_entry(
        "renderer-log",
        level.as_str(),
        area,
        payload.message.as_str(),
        Some(session_trace_id.as_str()),
        trace_id_for_diag,
        flow_id_for_diag,
        details,
    );
}

#[tauri::command]
fn start_window_drag(window: tauri::WebviewWindow) -> Result<(), String> {
    window.start_dragging().map_err(|error| error.to_string())
}

