use super::*;

#[tauri::command]
pub(crate) fn confirm_private_sync(payload: ConfirmPrivateSyncPayload) -> ConfirmPrivateSyncResult {
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
pub(crate) fn confirm_dialog(payload: ConfirmDialogPayload) -> ConfirmDialogResult {
    if let Ok(Some(confirmed)) = crate::desktop_e2e_fixture::next_confirm_dialog_override() {
        return ConfirmDialogResult { confirmed };
    }

    let title = payload.title.trim();
    let description = payload.description.trim();
    let level = match payload.level.as_deref().map(str::trim) {
        Some("error") => rfd::MessageLevel::Error,
        Some("warning") => rfd::MessageLevel::Warning,
        _ => rfd::MessageLevel::Info,
    };

    let confirmed = rfd::MessageDialog::new()
        .set_title(if title.is_empty() { "确认" } else { title })
        .set_description(if description.is_empty() {
            "确认继续当前操作？"
        } else {
            description
        })
        .set_level(level)
        .set_buttons(rfd::MessageButtons::YesNo)
        .show();

    ConfirmDialogResult {
        confirmed: matches!(confirmed, rfd::MessageDialogResult::Yes),
    }
}

#[tauri::command]
pub(crate) fn log_renderer_event(payload: RendererLogPayload) {
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
        .unwrap_or_default();
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
pub(crate) fn start_window_drag(window: tauri::WebviewWindow) -> Result<(), String> {
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
pub(crate) fn focus_main_window(app: tauri::AppHandle) -> Result<(), String> {
    crate::menu_bar_shell::window::focus_main_window(&app)?;
    crate::menu_bar_shell::set_window_visible(&app, true);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{confirm_dialog, ConfirmDialogPayload};
    use crate::test_support::test_guard;
    use std::{fs, path::PathBuf};

    fn make_temp_dir(prefix: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "nimi-desktop-confirm-dialog-{}-{}",
            prefix,
            std::process::id()
        ));
        fs::create_dir_all(&dir).expect("create temp dir");
        dir
    }

    #[test]
    fn confirm_dialog_uses_desktop_e2e_override_sequence() {
        let _guard = test_guard();
        let temp = make_temp_dir("fixture");
        let fixture_path = temp.join("fixture.json");
        fs::write(
            &fixture_path,
            r#"{
  "tauriFixture": {
    "confirmDialog": {
      "responses": [
        { "confirmed": false },
        { "confirmed": true }
      ]
    }
  }
}"#,
        )
        .expect("write fixture");

        let previous = std::env::var("NIMI_E2E_FIXTURE_PATH").ok();
        std::env::set_var("NIMI_E2E_FIXTURE_PATH", fixture_path.as_os_str());

        let first = confirm_dialog(ConfirmDialogPayload {
            title: "Upgrade to Standard memory".to_string(),
            description: "Bind canonical memory?".to_string(),
            level: Some("warning".to_string()),
        });
        let second = confirm_dialog(ConfirmDialogPayload {
            title: "Upgrade to Standard memory".to_string(),
            description: "Bind canonical memory?".to_string(),
            level: Some("warning".to_string()),
        });
        let third = confirm_dialog(ConfirmDialogPayload {
            title: "Upgrade to Standard memory".to_string(),
            description: "Bind canonical memory?".to_string(),
            level: Some("warning".to_string()),
        });

        match previous {
            Some(value) => std::env::set_var("NIMI_E2E_FIXTURE_PATH", value),
            None => std::env::remove_var("NIMI_E2E_FIXTURE_PATH"),
        }

        assert!(!first.confirmed);
        assert!(second.confirmed);
        assert!(third.confirmed);
        let _ = fs::remove_dir_all(temp);
    }
}
