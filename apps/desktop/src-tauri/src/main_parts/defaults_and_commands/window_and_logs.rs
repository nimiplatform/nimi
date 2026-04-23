use super::*;
use std::process::Command;

const AVATAR_HANDOFF_SCHEME: &str = "nimi-avatar";
const AVATAR_HANDOFF_LAUNCH_HOST: &str = "launch";
const AVATAR_HANDOFF_CLOSE_HOST: &str = "close";

fn structured_avatar_handoff_error(reason_code: &str, message: &str) -> String {
    json!({
        "reasonCode": reason_code,
        "message": message,
    })
    .to_string()
}

fn normalize_required_handoff_value(value: &str, field: &str) -> Result<String, String> {
    let normalized = value.trim();
    if normalized.is_empty() {
        return Err(structured_avatar_handoff_error(
            "DESKTOP_AVATAR_HANDOFF_INVALID",
            &format!("avatar handoff requires {}", field),
        ));
    }
    Ok(normalized.to_string())
}

fn normalize_optional_handoff_value(value: Option<&str>) -> Option<String> {
    let normalized = value.unwrap_or_default().trim();
    if normalized.is_empty() {
        None
    } else {
        Some(normalized.to_string())
    }
}

fn build_avatar_handoff_uri(payload: &DesktopAvatarLaunchHandoffPayload) -> Result<String, String> {
    let agent_id = normalize_required_handoff_value(payload.agent_id.as_str(), "agent_id")?;
    let avatar_instance_id = normalize_required_handoff_value(
        payload.avatar_instance_id.as_str(),
        "avatar_instance_id",
    )?;
    let launched_by = normalize_optional_handoff_value(payload.launched_by.as_deref())
        .unwrap_or_else(|| "desktop".to_string());
    let source_surface = normalize_optional_handoff_value(payload.source_surface.as_deref())
        .unwrap_or_else(|| "desktop-agent-chat".to_string());
    let anchor_mode =
        normalize_required_handoff_value(payload.anchor_mode.as_str(), "anchor_mode")?;
    if anchor_mode != "existing" && anchor_mode != "open_new" {
        return Err(structured_avatar_handoff_error(
            "DESKTOP_AVATAR_HANDOFF_INVALID",
            "avatar handoff anchor_mode must be existing or open_new",
        ));
    }
    let conversation_anchor_id =
        normalize_optional_handoff_value(payload.conversation_anchor_id.as_deref());
    if anchor_mode == "existing" && conversation_anchor_id.is_none() {
        return Err(structured_avatar_handoff_error(
            "DESKTOP_AVATAR_HANDOFF_INVALID",
            "avatar handoff requires conversation_anchor_id when anchor_mode=existing",
        ));
    }
    if anchor_mode == "open_new" && conversation_anchor_id.is_some() {
        return Err(structured_avatar_handoff_error(
            "DESKTOP_AVATAR_HANDOFF_INVALID",
            "avatar handoff must omit conversation_anchor_id when anchor_mode=open_new",
        ));
    }

    let mut serializer = url::form_urlencoded::Serializer::new(String::new());
    serializer.append_pair("agent_id", agent_id.as_str());
    serializer.append_pair("avatar_instance_id", avatar_instance_id.as_str());
    serializer.append_pair("anchor_mode", anchor_mode.as_str());
    serializer.append_pair("launched_by", launched_by.as_str());
    serializer.append_pair("source_surface", source_surface.as_str());
    if let Some(conversation_anchor_id) = conversation_anchor_id {
        serializer.append_pair("conversation_anchor_id", conversation_anchor_id.as_str());
    }
    Ok(format!(
        "{AVATAR_HANDOFF_SCHEME}://{AVATAR_HANDOFF_LAUNCH_HOST}?{}",
        serializer.finish()
    ))
}

fn build_avatar_close_handoff_uri(
    payload: &DesktopAvatarCloseHandoffPayload,
) -> Result<String, String> {
    let avatar_instance_id = normalize_required_handoff_value(
        payload.avatar_instance_id.as_str(),
        "avatar_instance_id",
    )?;
    let closed_by = normalize_optional_handoff_value(payload.closed_by.as_deref())
        .unwrap_or_else(|| "desktop".to_string());
    let source_surface = normalize_optional_handoff_value(payload.source_surface.as_deref())
        .unwrap_or_else(|| "desktop-agent-chat".to_string());

    let mut serializer = url::form_urlencoded::Serializer::new(String::new());
    serializer.append_pair("avatar_instance_id", avatar_instance_id.as_str());
    serializer.append_pair("closed_by", closed_by.as_str());
    serializer.append_pair("source_surface", source_surface.as_str());

    Ok(format!(
        "{AVATAR_HANDOFF_SCHEME}://{AVATAR_HANDOFF_CLOSE_HOST}?{}",
        serializer.finish()
    ))
}

fn open_avatar_handoff_uri(uri: &str) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(uri)
            .status()
            .map_err(|error| error.to_string())
            .and_then(|status| {
                if status.success() {
                    Ok(())
                } else {
                    Err(format!("open exited with status {}", status))
                }
            })?;
        return Ok(());
    }

    #[cfg(target_os = "windows")]
    {
        Command::new("cmd")
            .args(["/C", "start", "", uri])
            .status()
            .map_err(|error| error.to_string())
            .and_then(|status| {
                if status.success() {
                    Ok(())
                } else {
                    Err(format!("cmd start exited with status {}", status))
                }
            })?;
        return Ok(());
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        Command::new("xdg-open")
            .arg(uri)
            .status()
            .map_err(|error| error.to_string())
            .and_then(|status| {
                if status.success() {
                    Ok(())
                } else {
                    Err(format!("xdg-open exited with status {}", status))
                }
            })?;
        return Ok(());
    }
}

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

#[tauri::command]
pub(crate) fn desktop_avatar_launch_handoff(
    payload: DesktopAvatarLaunchHandoffPayload,
) -> Result<DesktopAvatarLaunchHandoffResult, String> {
    let handoff_uri = build_avatar_handoff_uri(&payload)?;
    open_avatar_handoff_uri(handoff_uri.as_str()).map_err(|error| {
        structured_avatar_handoff_error(
            "DESKTOP_AVATAR_HANDOFF_OPEN_FAILED",
            &format!("failed to open avatar handoff uri: {error}"),
        )
    })?;
    Ok(DesktopAvatarLaunchHandoffResult {
        opened: true,
        handoff_uri,
    })
}

#[tauri::command]
pub(crate) fn desktop_avatar_close_handoff(
    payload: DesktopAvatarCloseHandoffPayload,
) -> Result<DesktopAvatarCloseHandoffResult, String> {
    let handoff_uri = build_avatar_close_handoff_uri(&payload)?;
    open_avatar_handoff_uri(handoff_uri.as_str()).map_err(|error| {
        structured_avatar_handoff_error(
            "DESKTOP_AVATAR_CLOSE_OPEN_FAILED",
            &format!("failed to open avatar close handoff uri: {error}"),
        )
    })?;
    Ok(DesktopAvatarCloseHandoffResult {
        opened: true,
        handoff_uri,
    })
}

#[cfg(test)]
mod tests {
    use super::{
        build_avatar_close_handoff_uri, build_avatar_handoff_uri, confirm_dialog,
        ConfirmDialogPayload, DesktopAvatarCloseHandoffPayload, DesktopAvatarLaunchHandoffPayload,
    };
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

    #[test]
    fn avatar_handoff_uri_includes_existing_anchor_context_without_identity_leak() {
        let uri = build_avatar_handoff_uri(&DesktopAvatarLaunchHandoffPayload {
            agent_id: "agent-1".to_string(),
            avatar_instance_id: "instance-1".to_string(),
            conversation_anchor_id: Some("anchor-1".to_string()),
            anchor_mode: "existing".to_string(),
            launched_by: Some("desktop".to_string()),
            source_surface: Some("desktop-agent-chat".to_string()),
        })
        .expect("valid handoff uri");

        assert!(uri.starts_with("nimi-avatar://launch?"));
        assert!(uri.contains("agent_id=agent-1"));
        assert!(uri.contains("avatar_instance_id=instance-1"));
        assert!(uri.contains("conversation_anchor_id=anchor-1"));
        assert!(!uri.contains("subject_user_id"));
        assert!(!uri.contains("access_token"));
    }

    #[test]
    fn avatar_handoff_uri_rejects_missing_anchor_for_existing_mode() {
        let error = build_avatar_handoff_uri(&DesktopAvatarLaunchHandoffPayload {
            agent_id: "agent-1".to_string(),
            avatar_instance_id: "instance-1".to_string(),
            conversation_anchor_id: None,
            anchor_mode: "existing".to_string(),
            launched_by: Some("desktop".to_string()),
            source_surface: Some("desktop-agent-chat".to_string()),
        })
        .expect_err("missing anchor should fail");

        let payload: serde_json::Value =
            serde_json::from_str(error.as_str()).expect("structured error json");
        assert_eq!(
            payload
                .get("reasonCode")
                .and_then(serde_json::Value::as_str),
            Some("DESKTOP_AVATAR_HANDOFF_INVALID"),
        );
    }

    #[test]
    fn avatar_close_handoff_uri_includes_instance_context() {
        let uri = build_avatar_close_handoff_uri(&DesktopAvatarCloseHandoffPayload {
            avatar_instance_id: "instance-1".to_string(),
            closed_by: Some("desktop".to_string()),
            source_surface: Some("desktop-agent-chat".to_string()),
        })
        .expect("valid close uri");

        assert!(uri.starts_with("nimi-avatar://close?"));
        assert!(uri.contains("avatar_instance_id=instance-1"));
        assert!(uri.contains("closed_by=desktop"));
        assert!(uri.contains("source_surface=desktop-agent-chat"));
    }

    #[test]
    fn avatar_close_handoff_uri_rejects_missing_instance_id() {
        let error = build_avatar_close_handoff_uri(&DesktopAvatarCloseHandoffPayload {
            avatar_instance_id: "   ".to_string(),
            closed_by: None,
            source_surface: None,
        })
        .expect_err("missing instance should fail");

        let payload: serde_json::Value =
            serde_json::from_str(error.as_str()).expect("structured error json");
        assert_eq!(
            payload
                .get("reasonCode")
                .and_then(serde_json::Value::as_str),
            Some("DESKTOP_AVATAR_HANDOFF_INVALID"),
        );
    }
}
