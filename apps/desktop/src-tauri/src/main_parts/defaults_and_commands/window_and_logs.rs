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
        .unwrap_or_else(String::new);
    let detail_text_raw = payload
        .details
        .as_ref()
        .map(serde_json::to_string)
        .and_then(Result::ok)
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

#[tauri::command]
fn focus_main_window(app: tauri::AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "main window unavailable".to_string())?;

    let _ = window.unminimize();
    window.show().map_err(|error| error.to_string())?;
    window.set_focus().map_err(|error| error.to_string())?;
    Ok(())
}
