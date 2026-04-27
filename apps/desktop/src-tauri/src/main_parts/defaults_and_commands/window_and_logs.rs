use super::*;
use std::process::Command;

const AVATAR_HANDOFF_SCHEME: &str = "nimi-avatar";
const AVATAR_HANDOFF_LAUNCH_HOST: &str = "launch";
const AVATAR_HANDOFF_CLOSE_HOST: &str = "close";
const DESKTOP_RUNTIME_APP_ID: &str = "nimi.desktop";

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

fn validate_normalized_handoff_id(value: &str, field: &str) -> Result<String, String> {
    let normalized = normalize_required_handoff_value(value, field)?;
    if normalized.len() > 256
        || normalized == "."
        || normalized == ".."
        || normalized.contains("://")
        || !normalized.chars().any(|ch| ch.is_ascii_alphanumeric())
        || !normalized.chars().all(|ch| {
            ch.is_ascii_alphanumeric() || matches!(ch, '_' | '-' | '.' | '~' | ':' | '@' | '+')
        })
    {
        return Err(structured_avatar_handoff_error(
            "DESKTOP_AVATAR_HANDOFF_INVALID",
            &format!("{field} must use Agent Center normalized id characters"),
        ));
    }
    Ok(normalized)
}

fn validate_avatar_package_kind(value: &str) -> Result<String, String> {
    let normalized = normalize_required_handoff_value(value, "avatar_package_kind")?;
    if normalized != "live2d" && normalized != "vrm" {
        return Err(structured_avatar_handoff_error(
            "DESKTOP_AVATAR_HANDOFF_INVALID",
            "avatar handoff avatar_package_kind must be live2d or vrm",
        ));
    }
    Ok(normalized)
}

fn validate_avatar_package_id(value: &str, kind: &str) -> Result<String, String> {
    let normalized = normalize_required_handoff_value(value, "avatar_package_id")?;
    let expected_prefix = format!("{kind}_");
    if !normalized.starts_with(expected_prefix.as_str()) {
        return Err(structured_avatar_handoff_error(
            "DESKTOP_AVATAR_HANDOFF_INVALID",
            "avatar handoff avatar_package_id must match avatar_package_kind",
        ));
    }
    let suffix = &normalized[expected_prefix.len()..];
    if suffix.len() != 12
        || !suffix
            .chars()
            .all(|ch| ch.is_ascii_hexdigit() && !ch.is_ascii_uppercase())
    {
        return Err(structured_avatar_handoff_error(
            "DESKTOP_AVATAR_HANDOFF_INVALID",
            "avatar handoff avatar_package_id must use a 12-character lowercase hex digest suffix",
        ));
    }
    Ok(normalized)
}

fn build_avatar_handoff_uri(payload: &DesktopAvatarLaunchHandoffPayload) -> Result<String, String> {
    let account_id = validate_normalized_handoff_id(
        payload.agent_center_account_id.as_str(),
        "agent_center_account_id",
    )?;
    let agent_id = normalize_required_handoff_value(payload.agent_id.as_str(), "agent_id")?;
    let avatar_package_kind = validate_avatar_package_kind(payload.avatar_package_kind.as_str())?;
    let avatar_package_id = validate_avatar_package_id(
        payload.avatar_package_id.as_str(),
        avatar_package_kind.as_str(),
    )?;
    let avatar_package_schema_version = payload.avatar_package_schema_version.unwrap_or(1);
    if avatar_package_schema_version != 1 {
        return Err(structured_avatar_handoff_error(
            "DESKTOP_AVATAR_HANDOFF_INVALID",
            "avatar handoff avatar_package_schema_version must be 1",
        ));
    }
    let avatar_instance_id = normalize_required_handoff_value(
        payload.avatar_instance_id.as_str(),
        "avatar_instance_id",
    )?;
    let launched_by = normalize_optional_handoff_value(payload.launched_by.as_deref())
        .unwrap_or_else(|| DESKTOP_RUNTIME_APP_ID.to_string());
    let runtime_app_id = normalize_optional_handoff_value(payload.runtime_app_id.as_deref())
        .unwrap_or_else(|| DESKTOP_RUNTIME_APP_ID.to_string());
    if runtime_app_id != DESKTOP_RUNTIME_APP_ID {
        return Err(structured_avatar_handoff_error(
            "DESKTOP_AVATAR_HANDOFF_INVALID",
            "avatar handoff runtime_app_id must be nimi.desktop",
        ));
    }
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
    serializer.append_pair("agent_center_account_id", account_id.as_str());
    serializer.append_pair("agent_id", agent_id.as_str());
    serializer.append_pair("avatar_package_kind", avatar_package_kind.as_str());
    serializer.append_pair("avatar_package_id", avatar_package_id.as_str());
    serializer.append_pair(
        "avatar_package_schema_version",
        avatar_package_schema_version.to_string().as_str(),
    );
    serializer.append_pair("avatar_instance_id", avatar_instance_id.as_str());
    serializer.append_pair("anchor_mode", anchor_mode.as_str());
    serializer.append_pair("launched_by", launched_by.as_str());
    serializer.append_pair("runtime_app_id", runtime_app_id.as_str());
    serializer.append_pair("source_surface", source_surface.as_str());
    if let Some(conversation_anchor_id) = conversation_anchor_id {
        serializer.append_pair("conversation_anchor_id", conversation_anchor_id.as_str());
    }
    if let Ok(defaults) = runtime_defaults() {
        if !defaults.realm.realm_base_url.trim().is_empty() {
            serializer.append_pair("realm_base_url", defaults.realm.realm_base_url.trim());
        }
        if !defaults.runtime.world_id.trim().is_empty() {
            serializer.append_pair("world_id", defaults.runtime.world_id.trim());
        }
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

fn open_avatar_handoff_binary(uri: &str) -> Result<(), String> {
    let binary_path = std::env::var("NIMI_AVATAR_BINARY_PATH")
        .map(|value| value.trim().to_string())
        .unwrap_or_default();
    if binary_path.is_empty() {
        return Err("NIMI_AVATAR_BINARY_PATH is not configured".to_string());
    }
    let path = std::path::PathBuf::from(&binary_path);
    if !path.is_absolute() {
        return Err("NIMI_AVATAR_BINARY_PATH must be absolute".to_string());
    }
    if !path.is_file() {
        return Err(format!(
            "NIMI_AVATAR_BINARY_PATH does not point to a file: {}",
            path.display()
        ));
    }
    let mut command = Command::new(path);
    apply_avatar_runtime_env(&mut command)?;
    command
        .arg(uri)
        .spawn()
        .map_err(|error| format!("spawn avatar binary failed: {error}"))?;
    Ok(())
}

fn avatar_runtime_env_pairs() -> Result<Vec<(&'static str, String)>, String> {
    let defaults = runtime_defaults()?;
    let mut pairs = vec![
        ("NIMI_REALM_URL", defaults.realm.realm_base_url),
        ("NIMI_REALTIME_URL", defaults.realm.realtime_url),
        ("NIMI_REALM_JWKS_URL", defaults.realm.jwks_url),
        ("NIMI_REALM_REVOCATION_URL", defaults.realm.revocation_url),
        ("NIMI_REALM_JWT_ISSUER", defaults.realm.jwt_issuer),
        ("NIMI_REALM_JWT_AUDIENCE", defaults.realm.jwt_audience),
        (
            "NIMI_LOCAL_PROVIDER_ENDPOINT",
            defaults.runtime.local_provider_endpoint,
        ),
        (
            "NIMI_LOCAL_PROVIDER_MODEL",
            defaults.runtime.local_provider_model,
        ),
        (
            "NIMI_LOCAL_OPENAI_ENDPOINT",
            defaults.runtime.local_open_ai_endpoint,
        ),
        ("NIMI_CONNECTOR_ID", defaults.runtime.connector_id),
        ("NIMI_TARGET_TYPE", defaults.runtime.target_type),
        ("NIMI_TARGET_ACCOUNT_ID", defaults.runtime.target_account_id),
        ("NIMI_AGENT_ID", defaults.runtime.agent_id),
        ("NIMI_WORLD_ID", defaults.runtime.world_id),
        ("NIMI_PROVIDER", defaults.runtime.provider),
        (
            "NIMI_USER_CONFIRMED_UPLOAD",
            if defaults.runtime.user_confirmed_upload {
                "1".to_string()
            } else {
                String::new()
            },
        ),
    ];
    for key in [
        "NIMI_RUNTIME_CONFIG_PATH",
        "NIMI_RUNTIME_GRPC_ADDR",
        "NIMI_RUNTIME_HTTP_ADDR",
        "NIMI_RUNTIME_LOCAL_STATE_PATH",
        "NIMI_RUNTIME_BRIDGE_DEBUG",
        "NIMI_E2E_AUTH_SESSION_STORAGE",
        "NIMI_E2E_AUTH_SESSION_MASTER_KEY",
        "NIMI_E2E_PROFILE",
        "NIMI_E2E_FIXTURE_PATH",
    ] {
        if let Ok(value) = std::env::var(key) {
            if !value.trim().is_empty() {
                pairs.push((key, value));
            }
        }
    }
    Ok(pairs)
}

fn apply_avatar_runtime_env(command: &mut Command) -> Result<(), String> {
    for (key, value) in avatar_runtime_env_pairs()? {
        command.env(key, value);
    }
    Ok(())
}

#[cfg(target_os = "macos")]
fn open_avatar_handoff_app(uri: &str) -> Result<(), String> {
    let app_path = std::env::var("NIMI_AVATAR_APP_PATH")
        .map(|value| value.trim().to_string())
        .unwrap_or_default();
    if app_path.is_empty() {
        return Err("NIMI_AVATAR_APP_PATH is not configured".to_string());
    }
    let path = std::path::PathBuf::from(&app_path);
    if !path.is_absolute() {
        return Err("NIMI_AVATAR_APP_PATH must be absolute".to_string());
    }
    if !path.is_dir() {
        return Err(format!(
            "NIMI_AVATAR_APP_PATH does not point to an app bundle: {}",
            path.display()
        ));
    }
    let executable_path = path
        .join("Contents")
        .join("MacOS")
        .join("nimiplatform-avatar");
    if !executable_path.is_file() {
        return Err(format!(
            "NIMI_AVATAR_APP_PATH is missing Avatar executable: {}",
            executable_path.display()
        ));
    }
    let mut command = Command::new(executable_path);
    apply_avatar_runtime_env(&mut command)?;
    command
        .arg(uri)
        .spawn()
        .map_err(|error| format!("spawn avatar app executable failed: {error}"))?;
    Ok(())
}

#[cfg(not(target_os = "macos"))]
fn open_avatar_handoff_app(_uri: &str) -> Result<(), String> {
    Err("NIMI_AVATAR_APP_PATH launch is supported only on macOS".to_string())
}

fn open_avatar_handoff_uri_or_binary(uri: &str) -> Result<(), String> {
    if std::env::var("NIMI_AVATAR_APP_PATH")
        .map(|value| !value.trim().is_empty())
        .unwrap_or(false)
    {
        return open_avatar_handoff_app(uri).or_else(|app_error| {
            open_avatar_handoff_binary(uri).map_err(|binary_error| {
                format!("app fallback failed: {app_error}; binary fallback failed: {binary_error}")
            })
        });
    }

    match open_avatar_handoff_uri(uri) {
        Ok(()) => Ok(()),
        Err(primary_error) => match open_avatar_handoff_app(uri) {
            Ok(()) => Ok(()),
            Err(app_error) => open_avatar_handoff_binary(uri).map_err(|binary_error| {
                format!(
                    "{primary_error}; app fallback failed: {app_error}; binary fallback failed: {binary_error}"
                )
            }),
        },
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
    open_avatar_handoff_uri_or_binary(handoff_uri.as_str()).map_err(|error| {
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
    open_avatar_handoff_uri_or_binary(handoff_uri.as_str()).map_err(|error| {
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
        avatar_runtime_env_pairs, build_avatar_close_handoff_uri, build_avatar_handoff_uri,
        confirm_dialog, ConfirmDialogPayload, DesktopAvatarCloseHandoffPayload,
        DesktopAvatarLaunchHandoffPayload, DESKTOP_RUNTIME_APP_ID,
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

    fn launch_payload(
        anchor_mode: &str,
        conversation_anchor_id: Option<&str>,
    ) -> DesktopAvatarLaunchHandoffPayload {
        DesktopAvatarLaunchHandoffPayload {
            agent_center_account_id: "account_1".to_string(),
            agent_id: "agent-1".to_string(),
            avatar_package_kind: "live2d".to_string(),
            avatar_package_id: "live2d_ab12cd34ef56".to_string(),
            avatar_package_schema_version: Some(1),
            avatar_instance_id: "instance-1".to_string(),
            conversation_anchor_id: conversation_anchor_id.map(str::to_string),
            anchor_mode: anchor_mode.to_string(),
            launched_by: Some(DESKTOP_RUNTIME_APP_ID.to_string()),
            runtime_app_id: Some(DESKTOP_RUNTIME_APP_ID.to_string()),
            source_surface: Some("desktop-agent-chat".to_string()),
        }
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
            conversation_anchor_id: Some("anchor-1".to_string()),
            ..launch_payload("existing", Some("anchor-1"))
        })
        .expect("valid handoff uri");

        assert!(uri.starts_with("nimi-avatar://launch?"));
        assert!(uri.contains("agent_center_account_id=account_1"));
        assert!(uri.contains("agent_id=agent-1"));
        assert!(uri.contains("avatar_package_kind=live2d"));
        assert!(uri.contains("avatar_package_id=live2d_ab12cd34ef56"));
        assert!(uri.contains("avatar_package_schema_version=1"));
        assert!(uri.contains("avatar_instance_id=instance-1"));
        assert!(uri.contains("conversation_anchor_id=anchor-1"));
        assert!(uri.contains("runtime_app_id=nimi.desktop"));
        assert!(!uri.contains("subject_user_id"));
        assert!(!uri.contains("access_token"));
        assert!(!uri.contains("manifest_path"));
        assert!(!uri.contains("package_path"));
    }

    #[test]
    fn avatar_handoff_uri_accepts_opaque_agent_center_account_id() {
        let uri = build_avatar_handoff_uri(&DesktopAvatarLaunchHandoffPayload {
            agent_center_account_id: "account:abc.def+1".to_string(),
            ..launch_payload("open_new", None)
        })
        .expect("opaque account id should be valid handoff context");

        assert!(uri.contains("agent_center_account_id=account%3Aabc.def%2B1"));
    }

    #[test]
    fn avatar_runtime_env_pairs_forward_realm_and_runtime_defaults_without_token() {
        let _guard = test_guard();
        let keys = [
            "NIMI_E2E_FIXTURE_PATH",
            "NIMI_REALM_URL",
            "NIMI_REALM_JWKS_URL",
            "NIMI_REALM_REVOCATION_URL",
            "NIMI_REALM_JWT_ISSUER",
            "NIMI_REALM_JWT_AUDIENCE",
            "NIMI_WORLD_ID",
            "NIMI_AGENT_ID",
            "NIMI_ACCESS_TOKEN",
            "NIMI_E2E_AUTH_SESSION_STORAGE",
            "NIMI_E2E_AUTH_SESSION_MASTER_KEY",
            "NIMI_E2E_PROFILE",
            "NIMI_RUNTIME_CONFIG_PATH",
            "NIMI_RUNTIME_GRPC_ADDR",
            "NIMI_RUNTIME_HTTP_ADDR",
            "NIMI_RUNTIME_LOCAL_STATE_PATH",
            "NIMI_RUNTIME_BRIDGE_DEBUG",
        ];
        let saved: Vec<(&str, Option<String>)> = keys
            .iter()
            .map(|key| (*key, std::env::var(key).ok()))
            .collect();
        let fixture_dir = make_temp_dir("avatar-runtime-env");
        let fixture_path = fixture_dir.join("fixture.json");
        fs::write(&fixture_path, "{}").expect("write fixture");
        std::env::remove_var("NIMI_E2E_FIXTURE_PATH");
        std::env::set_var("NIMI_REALM_URL", "http://127.0.0.1:50803");
        std::env::set_var(
            "NIMI_REALM_JWKS_URL",
            "http://127.0.0.1:50803/api/auth/jwks",
        );
        std::env::set_var(
            "NIMI_REALM_REVOCATION_URL",
            "http://127.0.0.1:50803/api/auth/revocation",
        );
        std::env::set_var("NIMI_REALM_JWT_ISSUER", "http://127.0.0.1:50803");
        std::env::set_var("NIMI_REALM_JWT_AUDIENCE", "nimi-runtime");
        std::env::set_var("NIMI_WORLD_ID", "world-e2e-1");
        std::env::set_var("NIMI_AGENT_ID", "agent-e2e-alpha");
        std::env::set_var("NIMI_ACCESS_TOKEN", "must-not-forward");
        std::env::set_var("NIMI_E2E_AUTH_SESSION_STORAGE", "encrypted-file");
        std::env::set_var("NIMI_E2E_AUTH_SESSION_MASTER_KEY", "master-key");
        std::env::set_var("NIMI_E2E_PROFILE", "chat.live2d-avatar-product-smoke");
        std::env::set_var("NIMI_E2E_FIXTURE_PATH", fixture_path.as_os_str());
        std::env::set_var(
            "NIMI_RUNTIME_CONFIG_PATH",
            fixture_dir.join("runtime-config.json").as_os_str(),
        );
        std::env::set_var("NIMI_RUNTIME_GRPC_ADDR", "127.0.0.1:51801");
        std::env::set_var("NIMI_RUNTIME_HTTP_ADDR", "127.0.0.1:51802");
        std::env::set_var(
            "NIMI_RUNTIME_LOCAL_STATE_PATH",
            fixture_dir.join("runtime-state.json").as_os_str(),
        );
        std::env::set_var("NIMI_RUNTIME_BRIDGE_DEBUG", "1");

        let pairs = avatar_runtime_env_pairs().expect("avatar env pairs");

        for (key, value) in saved {
            match value {
                Some(value) => std::env::set_var(key, value),
                None => std::env::remove_var(key),
            }
        }

        assert!(pairs.contains(&("NIMI_REALM_URL", "http://127.0.0.1:50803".to_string())));
        assert!(pairs.contains(&("NIMI_WORLD_ID", "world-e2e-1".to_string())));
        assert!(pairs.contains(&("NIMI_AGENT_ID", "agent-e2e-alpha".to_string())));
        assert!(pairs.contains(&(
            "NIMI_E2E_AUTH_SESSION_STORAGE",
            "encrypted-file".to_string()
        )));
        assert!(pairs.contains(&(
            "NIMI_E2E_PROFILE",
            "chat.live2d-avatar-product-smoke".to_string()
        )));
        assert!(pairs.contains(&(
            "NIMI_E2E_FIXTURE_PATH",
            fixture_path.to_string_lossy().to_string()
        )));
        assert!(pairs.contains(&(
            "NIMI_RUNTIME_CONFIG_PATH",
            fixture_dir
                .join("runtime-config.json")
                .to_string_lossy()
                .to_string()
        )));
        assert!(pairs.contains(&("NIMI_RUNTIME_GRPC_ADDR", "127.0.0.1:51801".to_string())));
        assert!(pairs.contains(&("NIMI_RUNTIME_HTTP_ADDR", "127.0.0.1:51802".to_string())));
        assert!(pairs.contains(&(
            "NIMI_RUNTIME_LOCAL_STATE_PATH",
            fixture_dir
                .join("runtime-state.json")
                .to_string_lossy()
                .to_string()
        )));
        assert!(!pairs.iter().any(|(key, _)| key.contains("ACCESS_TOKEN")));
        let _ = fs::remove_dir_all(fixture_dir);
    }

    #[test]
    fn avatar_handoff_uri_rejects_missing_anchor_for_existing_mode() {
        let error = build_avatar_handoff_uri(&launch_payload("existing", None))
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
