use super::*;
use std::path::PathBuf;
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
    let avatar_instance_id =
        normalize_optional_handoff_value(payload.avatar_instance_id.as_deref());
    let launch_source = normalize_optional_handoff_value(payload.launch_source.as_deref())
        .or_else(|| normalize_optional_handoff_value(payload.source_surface.as_deref()));

    let mut serializer = url::form_urlencoded::Serializer::new(String::new());
    serializer.append_pair("agent_id", agent_id.as_str());
    if let Some(avatar_instance_id) = avatar_instance_id {
        serializer.append_pair("avatar_instance_id", avatar_instance_id.as_str());
    }
    if let Some(launch_source) = launch_source {
        serializer.append_pair("launch_source", launch_source.as_str());
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

fn spawn_avatar_handoff_binary(path: PathBuf, uri: &str) -> Result<(), String> {
    if !path.is_absolute() {
        return Err(format!(
            "avatar binary path must be absolute: {}",
            path.display()
        ));
    }
    if !path.is_file() {
        return Err(format!(
            "avatar binary path does not point to a file: {}",
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

fn open_avatar_handoff_binary(uri: &str) -> Result<(), String> {
    let binary_path = std::env::var("NIMI_AVATAR_BINARY_PATH")
        .map(|value| value.trim().to_string())
        .unwrap_or_default();
    if binary_path.is_empty() {
        return Err("NIMI_AVATAR_BINARY_PATH is not configured".to_string());
    }
    spawn_avatar_handoff_binary(PathBuf::from(&binary_path), uri)
}

fn avatar_runtime_env_pairs() -> Result<Vec<(&'static str, String)>, String> {
    let defaults = runtime_defaults()?;
    let mut pairs = vec![
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
fn spawn_avatar_handoff_app(path: PathBuf, uri: &str) -> Result<(), String> {
    if !path.is_absolute() {
        return Err(format!(
            "avatar app bundle path must be absolute: {}",
            path.display()
        ));
    }
    if !path.is_dir() {
        return Err(format!(
            "avatar app bundle path does not point to an app bundle: {}",
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

#[cfg(target_os = "macos")]
fn open_avatar_handoff_app(uri: &str) -> Result<(), String> {
    let app_path = std::env::var("NIMI_AVATAR_APP_PATH")
        .map(|value| value.trim().to_string())
        .unwrap_or_default();
    if app_path.is_empty() {
        return Err("NIMI_AVATAR_APP_PATH is not configured".to_string());
    }
    spawn_avatar_handoff_app(PathBuf::from(&app_path), uri)
}

#[cfg(not(target_os = "macos"))]
fn open_avatar_handoff_app(_uri: &str) -> Result<(), String> {
    Err("NIMI_AVATAR_APP_PATH launch is supported only on macOS".to_string())
}

fn repo_root_candidates() -> Vec<PathBuf> {
    let mut seeds = Vec::new();
    if let Ok(current_dir) = std::env::current_dir() {
        seeds.push(current_dir);
    }
    if let Ok(current_exe) = std::env::current_exe() {
        if let Some(parent) = current_exe.parent() {
            seeds.push(parent.to_path_buf());
        }
    }

    let mut candidates = Vec::new();
    for seed in seeds {
        for ancestor in seed.ancestors() {
            let candidate = ancestor.to_path_buf();
            if !candidates.iter().any(|existing| existing == &candidate) {
                candidates.push(candidate);
            }
        }
    }
    candidates
}

#[cfg(target_os = "macos")]
fn inferred_avatar_app_path() -> Option<PathBuf> {
    repo_root_candidates()
        .into_iter()
        .map(|root| {
            root.join("apps")
                .join("avatar")
                .join("src-tauri")
                .join("target")
                .join("release")
                .join("bundle")
                .join("macos")
                .join("Nimi Avatar.app")
        })
        .find(|path| path.is_dir())
}

fn inferred_avatar_binary_path() -> Option<PathBuf> {
    repo_root_candidates()
        .into_iter()
        .map(|root| {
            root.join("apps")
                .join("avatar")
                .join("src-tauri")
                .join("target")
                .join("release")
                .join(if cfg!(target_os = "windows") {
                    "nimiplatform-avatar.exe"
                } else {
                    "nimiplatform-avatar"
                })
        })
        .find(|path| path.is_file())
}

fn open_inferred_avatar_handoff_target(uri: &str) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    if let Some(app_path) = inferred_avatar_app_path() {
        return spawn_avatar_handoff_app(app_path, uri);
    }
    if let Some(binary_path) = inferred_avatar_binary_path() {
        return spawn_avatar_handoff_binary(binary_path, uri);
    }
    Err("repo-local Avatar app/binary is not built; run pnpm build:avatar".to_string())
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

    match open_inferred_avatar_handoff_target(uri) {
        Ok(()) => Ok(()),
        Err(inferred_error) => match open_avatar_handoff_uri(uri) {
            Ok(()) => Ok(()),
            Err(primary_error) => match open_avatar_handoff_app(uri) {
                Ok(()) => Ok(()),
                Err(app_error) => open_avatar_handoff_binary(uri).map_err(|binary_error| {
                    format!(
                        "inferred target failed: {inferred_error}; {primary_error}; app fallback failed: {app_error}; binary fallback failed: {binary_error}"
                    )
                }),
            },
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
#[path = "window_and_logs_tests.rs"]
mod window_and_logs_tests;
