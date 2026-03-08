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
fn runtime_defaults() -> RuntimeDefaults {
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

    defaults
}

fn parse_digits_u64(raw: &str) -> Option<u64> {
    let digits = raw
        .chars()
        .filter(|ch| ch.is_ascii_digit())
        .collect::<String>();
    if digits.is_empty() {
        return None;
    }
    digits.parse::<u64>().ok()
}

fn read_command_output(program: &str, args: &[&str]) -> Option<String> {
    let output = std::process::Command::new(program)
        .args(args)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if text.is_empty() {
        return None;
    }
    Some(text)
}

fn parse_df_root_bytes(raw: &str) -> Option<(u64, u64)> {
    let row = raw.lines().skip(1).find(|line| !line.trim().is_empty())?;
    let columns = row.split_whitespace().collect::<Vec<_>>();
    if columns.len() < 3 {
        return None;
    }
    let total_bytes = columns[1].parse::<u64>().ok()?.saturating_mul(1024);
    let used_bytes = columns[2].parse::<u64>().ok()?.saturating_mul(1024);
    Some((used_bytes, total_bytes))
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
fn collect_disk_usage_bytes() -> Option<(u64, u64)> {
    let output = read_command_output("df", &["-Pk", "/"])?;
    parse_df_root_bytes(output.as_str())
}

#[cfg(target_os = "macos")]
fn collect_cpu_percent() -> Option<f64> {
    let ps_output = read_command_output("ps", &["-A", "-o", "%cpu"])?;
    let sum_cpu = ps_output
        .lines()
        .skip(1)
        .filter_map(|line| line.trim().parse::<f64>().ok())
        .sum::<f64>();
    let cpu_count = read_command_output("sysctl", &["-n", "hw.ncpu"])
        .and_then(|value| value.trim().parse::<f64>().ok())
        .filter(|value| *value > 0.0)
        .unwrap_or(1.0);
    Some((sum_cpu / cpu_count).clamp(0.0, 100.0))
}

#[cfg(target_os = "macos")]
fn collect_memory_usage_bytes() -> Option<(u64, u64)> {
    let total_bytes = read_command_output("sysctl", &["-n", "hw.memsize"])
        .and_then(|value| value.trim().parse::<u64>().ok())?;

    let vm_stat = read_command_output("vm_stat", &[])?;
    let page_size = vm_stat
        .lines()
        .next()
        .and_then(parse_digits_u64)
        .filter(|value| *value > 0)?;

    let mut free_pages = 0_u64;
    for line in vm_stat.lines() {
        if line.starts_with("Pages free:") || line.starts_with("Pages speculative:") {
            if let Some(value) = parse_digits_u64(line) {
                free_pages = free_pages.saturating_add(value);
            }
        }
    }

    let free_bytes = free_pages.saturating_mul(page_size);
    let used_bytes = total_bytes.saturating_sub(free_bytes.min(total_bytes));
    Some((used_bytes, total_bytes))
}

#[cfg(target_os = "macos")]
fn collect_temperature_celsius() -> Option<f64> {
    None
}

#[cfg(target_os = "linux")]
fn read_proc_stat_cpu_totals() -> Option<(u64, u64)> {
    let content = std::fs::read_to_string("/proc/stat").ok()?;
    let cpu_line = content.lines().next()?;
    let mut parts = cpu_line.split_whitespace();
    if parts.next()? != "cpu" {
        return None;
    }

    let mut values = Vec::<u64>::new();
    for item in parts {
        if let Ok(parsed) = item.parse::<u64>() {
            values.push(parsed);
        }
    }
    if values.len() < 4 {
        return None;
    }

    let idle = values.get(3).copied().unwrap_or(0);
    let io_wait = values.get(4).copied().unwrap_or(0);
    let idle_total = idle.saturating_add(io_wait);
    let total = values.into_iter().sum::<u64>();
    Some((idle_total, total))
}

#[cfg(target_os = "linux")]
fn collect_cpu_percent() -> Option<f64> {
    let (idle_a, total_a) = read_proc_stat_cpu_totals()?;
    std::thread::sleep(Duration::from_millis(120));
    let (idle_b, total_b) = read_proc_stat_cpu_totals()?;

    let idle_delta = idle_b.saturating_sub(idle_a);
    let total_delta = total_b.saturating_sub(total_a);
    if total_delta == 0 {
        return None;
    }

    let usage = 100.0 * (1.0 - (idle_delta as f64 / total_delta as f64));
    Some(usage.clamp(0.0, 100.0))
}

#[cfg(target_os = "linux")]
fn collect_memory_usage_bytes() -> Option<(u64, u64)> {
    let meminfo = std::fs::read_to_string("/proc/meminfo").ok()?;
    let mut total_kb: Option<u64> = None;
    let mut available_kb: Option<u64> = None;
    let mut free_kb: Option<u64> = None;

    for line in meminfo.lines() {
        if line.starts_with("MemTotal:") {
            total_kb = line
                .split_whitespace()
                .nth(1)
                .and_then(|value| value.parse::<u64>().ok());
        } else if line.starts_with("MemAvailable:") {
            available_kb = line
                .split_whitespace()
                .nth(1)
                .and_then(|value| value.parse::<u64>().ok());
        } else if line.starts_with("MemFree:") {
            free_kb = line
                .split_whitespace()
                .nth(1)
                .and_then(|value| value.parse::<u64>().ok());
        }
    }

    let total_bytes = total_kb?.saturating_mul(1024);
    let available_bytes = available_kb.or(free_kb)?.saturating_mul(1024);
    let used_bytes = total_bytes.saturating_sub(available_bytes.min(total_bytes));
    Some((used_bytes, total_bytes))
}

#[cfg(target_os = "linux")]
fn collect_temperature_celsius() -> Option<f64> {
    let candidates = std::fs::read_dir("/sys/class/thermal").ok()?;
    for entry in candidates.filter_map(Result::ok) {
        let path = entry.path().join("temp");
        let Ok(raw) = std::fs::read_to_string(path) else {
            continue;
        };
        let milli_c = raw.trim().parse::<f64>().ok()?;
        if milli_c <= 0.0 {
            continue;
        }
        let celsius = milli_c / 1000.0;
        if celsius.is_finite() && celsius > 0.0 && celsius < 150.0 {
            return Some(celsius);
        }
    }
    None
}

#[cfg(target_os = "windows")]
fn read_powershell_output(script: &str) -> Option<String> {
    read_command_output(
        "powershell",
        &[
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            script,
        ],
    )
}

#[cfg(target_os = "windows")]
fn collect_cpu_percent() -> Option<f64> {
    let raw = read_powershell_output(
        "(Get-Counter '\\Processor(_Total)\\% Processor Time').CounterSamples.CookedValue",
    )?;
    raw.lines()
        .find_map(|line| line.trim().parse::<f64>().ok())
        .map(|value| value.clamp(0.0, 100.0))
}

#[cfg(target_os = "windows")]
fn collect_memory_usage_bytes() -> Option<(u64, u64)> {
    let raw = read_powershell_output(
        "$os=Get-CimInstance Win32_OperatingSystem; \"$($os.TotalVisibleMemorySize) $($os.FreePhysicalMemory)\"",
    )?;
    let values = raw
        .split_whitespace()
        .filter_map(|item| item.parse::<u64>().ok())
        .collect::<Vec<_>>();
    if values.len() < 2 {
        return None;
    }
    let total_bytes = values[0].saturating_mul(1024);
    let free_bytes = values[1].saturating_mul(1024);
    let used_bytes = total_bytes.saturating_sub(free_bytes.min(total_bytes));
    Some((used_bytes, total_bytes))
}

#[cfg(target_os = "windows")]
fn collect_disk_usage_bytes() -> Option<(u64, u64)> {
    let raw = read_powershell_output(
        "$d=Get-CimInstance Win32_LogicalDisk -Filter \"DeviceID='C:'\"; \"$($d.Size) $($d.FreeSpace)\"",
    )?;
    let values = raw
        .split_whitespace()
        .filter_map(|item| item.parse::<u64>().ok())
        .collect::<Vec<_>>();
    if values.len() < 2 {
        return None;
    }
    let total_bytes = values[0];
    let free_bytes = values[1];
    let used_bytes = total_bytes.saturating_sub(free_bytes.min(total_bytes));
    Some((used_bytes, total_bytes))
}

#[cfg(target_os = "windows")]
fn collect_temperature_celsius() -> Option<f64> {
    None
}

#[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
fn collect_cpu_percent() -> Option<f64> {
    None
}

#[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
fn collect_memory_usage_bytes() -> Option<(u64, u64)> {
    None
}

#[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
fn collect_disk_usage_bytes() -> Option<(u64, u64)> {
    None
}

#[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
fn collect_temperature_celsius() -> Option<f64> {
    None
}

fn collect_system_resource_snapshot() -> SystemResourceSnapshot {
    let cpu_percent = collect_cpu_percent().unwrap_or(0.0);
    let (memory_used_bytes, memory_total_bytes) = collect_memory_usage_bytes().unwrap_or((0, 0));
    let (disk_used_bytes, disk_total_bytes) = collect_disk_usage_bytes().unwrap_or((0, 0));
    let temperature_celsius = collect_temperature_celsius();
    let source = if cpu_percent > 0.0 || memory_total_bytes > 0 || disk_total_bytes > 0 {
        format!("tauri-{}", std::env::consts::OS)
    } else {
        "tauri-fallback".to_string()
    };

    SystemResourceSnapshot {
        cpu_percent,
        memory_used_bytes,
        memory_total_bytes,
        disk_used_bytes,
        disk_total_bytes,
        temperature_celsius,
        captured_at_ms: u64::try_from(now_ms()).unwrap_or(u64::MAX),
        source,
    }
}

#[tauri::command]
fn get_system_resource_snapshot() -> SystemResourceSnapshot {
    collect_system_resource_snapshot()
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
    let should_echo = should_echo_renderer_log(level.as_str());
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
    if should_echo {
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
    if should_echo_diag_log("renderer-log", level.as_str()) {
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
}

#[tauri::command]
fn start_window_drag(window: tauri::WebviewWindow) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    if window.is_fullscreen().unwrap_or(false) {
        return Ok(());
    }

    match std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        window.start_dragging().map_err(|error| error.to_string())
    })) {
        Ok(result) => result,
        Err(_) => {
            eprintln!("[boot:{:}] start_window_drag panicked", now_ms());
            Err("window drag unavailable".to_string())
        }
    }
}
