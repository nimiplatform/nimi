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

fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

fn app_run_session_id() -> &'static str {
    APP_RUN_SESSION_ID
        .get_or_init(|| format!("desktop-run-{}-{}", now_ms(), std::process::id()))
        .as_str()
}

fn normalize_session_trace_id(raw: &str) -> String {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return app_run_session_id().to_string();
    }
    let mut normalized = String::with_capacity(trimmed.len());
    for ch in trimmed.chars() {
        if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
            normalized.push(ch);
        } else {
            normalized.push('_');
        }
    }
    let compact = normalized.trim_matches('_');
    if compact.is_empty() {
        app_run_session_id().to_string()
    } else if compact.len() > 140 {
        compact[..140].to_string()
    } else {
        compact.to_string()
    }
}

fn append_diag_log_entry(
    source: &str,
    level: &str,
    area: &str,
    message: &str,
    session_trace_id: Option<&str>,
    trace_id: Option<&str>,
    flow_id: Option<&str>,
    details: serde_json::Value,
) {
    let session = normalize_session_trace_id(session_trace_id.unwrap_or_default());
    let trace = trace_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.to_string());
    let flow = flow_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.to_string());
    let entry = DiagLogEntry {
        ts: now_iso(),
        source: source.trim().to_string(),
        level: level.trim().to_string(),
        area: area.trim().to_string(),
        message: preview_text_utf8_safe(message, DIAG_LOG_MESSAGE_PREVIEW_BYTES),
        session_trace_id: session.clone(),
        trace_id: trace,
        flow_id: flow,
        details,
    };
    if !should_echo_diag_log(source, level) {
        return;
    }
    let line = match serde_json::to_string(&entry) {
        Ok(value) => value,
        Err(error) => {
            eprintln!("[diag-log] serialize failed: {}", error);
            return;
        }
    };
    // Diagnostic logging is intentionally non-persistent: do not write to local files.
    eprintln!("[diag-log] {line}");
}

fn session_trace_id_from_details(details: &Option<serde_json::Value>) -> Option<String> {
    details
        .as_ref()
        .and_then(|value| value.as_object())
        .and_then(|object| object.get("sessionTraceId"))
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.to_string())
}

fn log_boot_marker(message: &str) {
    let boot_ms = now_ms();
    let trace_id = format!("boot-{boot_ms}");
    eprintln!("[boot:{boot_ms}] {}", message);
    append_diag_log_entry(
        "boot",
        "info",
        "boot",
        message,
        Some(app_run_session_id()),
        Some(trace_id.as_str()),
        None,
        json!({ "bootMs": boot_ms }),
    );
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

fn verbose_renderer_logs_enabled() -> bool {
    debug_boot_enabled()
        || env_flag("NIMI_VERBOSE_RENDERER_LOGS")
        || env_flag("VITE_NIMI_VERBOSE_RENDERER_LOGS")
}

fn should_echo_renderer_log(level: &str) -> bool {
    match level.trim().to_ascii_lowercase().as_str() {
        "warn" | "error" => true,
        "debug" | "info" => verbose_renderer_logs_enabled(),
        _ => verbose_renderer_logs_enabled(),
    }
}

fn should_echo_diag_log(source: &str, level: &str) -> bool {
    let normalized_source = source.trim().to_ascii_lowercase();
    if normalized_source == "renderer-log" {
        return should_echo_renderer_log(level);
    }
    if normalized_source == "boot" {
        return verbose_renderer_logs_enabled();
    }
    match level.trim().to_ascii_lowercase().as_str() {
        "warn" | "error" => true,
        _ => verbose_renderer_logs_enabled(),
    }
}

#[cfg(target_os = "macos")]
fn apply_macos_traffic_light_position(
    window: &tauri::WebviewWindow,
    x: f64,
    y: f64,
) -> Result<(), String> {
    use objc2_app_kit::{NSWindow, NSWindowButton};

    if window.is_fullscreen().unwrap_or(false) {
        return Ok(());
    }

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
            std::thread::sleep(std::time::Duration::from_millis(delay_ms));
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
