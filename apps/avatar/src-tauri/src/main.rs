#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use nimi_kit_shell_tauri::auth_session_commands;
use nimi_kit_shell_tauri::runtime_bridge;
use nimi_kit_shell_tauri::runtime_defaults as defaults;
use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager, PhysicalSize, State, WebviewWindow};
use url::Url;

#[derive(Clone, Serialize)]
struct ReadyPayload {
    label: String,
    width: u32,
    height: u32,
}

const AVATAR_LAUNCH_SCHEME: &str = "nimi-avatar";
const AVATAR_LAUNCH_HOST: &str = "launch";
const AVATAR_WINDOW_LABEL: &str = "avatar";
const AVATAR_LAUNCH_CONTEXT_UPDATED_EVENT: &str = "avatar://launch-context-updated";

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum AvatarAnchorMode {
    Existing,
    OpenNew,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct AvatarLaunchContext {
    agent_id: String,
    avatar_instance_id: String,
    conversation_anchor_id: Option<String>,
    anchor_mode: AvatarAnchorMode,
    launched_by: String,
    source_surface: Option<String>,
}

#[derive(Default)]
struct AvatarLaunchContextState {
    context: Mutex<Option<AvatarLaunchContext>>,
}

impl AvatarLaunchContextState {
    fn new(initial: Option<AvatarLaunchContext>) -> Self {
        Self {
            context: Mutex::new(initial),
        }
    }

    fn get(&self) -> Result<Option<AvatarLaunchContext>, String> {
        self.context
            .lock()
            .map(|guard| guard.clone())
            .map_err(|_| "failed to lock avatar launch context".to_string())
    }

    fn set(&self, context: AvatarLaunchContext) -> Result<(), String> {
        self.context
            .lock()
            .map(|mut guard| {
                *guard = Some(context);
            })
            .map_err(|_| "failed to lock avatar launch context".to_string())
    }
}

#[derive(Serialize)]
struct ModelManifest {
    runtime_dir: String,
    model_id: String,
    model3_json_path: String,
    nimi_dir: Option<String>,
}

#[derive(Serialize)]
struct NasHandlerManifest {
    activity: Vec<NasHandlerEntry>,
    event: Vec<NasHandlerEntry>,
    continuous: Vec<NasHandlerEntry>,
    config_json_path: Option<String>,
}

#[derive(Serialize)]
struct NasHandlerEntry {
    file_stem: String,
    absolute_path: String,
}

fn normalize_required_query_value(value: Option<String>, field: &str) -> Result<String, String> {
    let normalized = value.unwrap_or_default().trim().to_string();
    if normalized.is_empty() {
        return Err(format!("missing required launch context field: {field}"));
    }
    Ok(normalized)
}

fn normalize_optional_query_value(value: Option<String>) -> Option<String> {
    let normalized = value.unwrap_or_default().trim().to_string();
    if normalized.is_empty() {
        None
    } else {
        Some(normalized)
    }
}

fn parse_anchor_mode(value: &str) -> Result<AvatarAnchorMode, String> {
    match value.trim() {
        "existing" => Ok(AvatarAnchorMode::Existing),
        "open_new" => Ok(AvatarAnchorMode::OpenNew),
        _ => Err("anchor_mode must be one of: existing, open_new".to_string()),
    }
}

fn parse_avatar_launch_context(raw_url: &str) -> Result<AvatarLaunchContext, String> {
    let parsed = Url::parse(raw_url).map_err(|error| error.to_string())?;
    if parsed.scheme() != AVATAR_LAUNCH_SCHEME {
        return Err(format!(
            "unsupported avatar launch scheme: {}",
            parsed.scheme()
        ));
    }
    if parsed.host_str().unwrap_or_default() != AVATAR_LAUNCH_HOST {
        return Err("avatar launch host must be launch".to_string());
    }

    let mut agent_id = None;
    let mut avatar_instance_id = None;
    let mut conversation_anchor_id = None;
    let mut anchor_mode = None;
    let mut launched_by = None;
    let mut source_surface = None;

    for (key, value) in parsed.query_pairs() {
        match key.as_ref() {
            "agent_id" => agent_id = Some(value.into_owned()),
            "avatar_instance_id" => avatar_instance_id = Some(value.into_owned()),
            "conversation_anchor_id" => conversation_anchor_id = Some(value.into_owned()),
            "anchor_mode" => anchor_mode = Some(value.into_owned()),
            "launched_by" => launched_by = Some(value.into_owned()),
            "source_surface" => source_surface = Some(value.into_owned()),
            "access_token" | "refresh_token" | "subject_user_id" => {
                return Err(format!(
                    "forbidden avatar launch query parameter: {}",
                    key.as_ref()
                ));
            }
            _ => {}
        }
    }

    let agent_id = normalize_required_query_value(agent_id, "agent_id")?;
    let avatar_instance_id =
        normalize_required_query_value(avatar_instance_id, "avatar_instance_id")?;
    let launched_by = normalize_required_query_value(launched_by, "launched_by")?;
    let anchor_mode =
        parse_anchor_mode(normalize_required_query_value(anchor_mode, "anchor_mode")?.as_str())?;
    let conversation_anchor_id = normalize_optional_query_value(conversation_anchor_id);

    match anchor_mode {
        AvatarAnchorMode::Existing => {
            if conversation_anchor_id.is_none() {
                return Err(
                    "conversation_anchor_id is required when anchor_mode=existing".to_string(),
                );
            }
        }
        AvatarAnchorMode::OpenNew => {
            if conversation_anchor_id.is_some() {
                return Err(
                    "conversation_anchor_id must be empty when anchor_mode=open_new".to_string(),
                );
            }
        }
    }

    Ok(AvatarLaunchContext {
        agent_id,
        avatar_instance_id,
        conversation_anchor_id,
        anchor_mode,
        launched_by,
        source_surface: normalize_optional_query_value(source_surface),
    })
}

fn resolve_initial_launch_context() -> Option<AvatarLaunchContext> {
    std::env::args()
        .filter(|arg| arg.starts_with(&format!("{AVATAR_LAUNCH_SCHEME}://")))
        .find_map(|arg| parse_avatar_launch_context(arg.as_str()).ok())
}

fn sync_avatar_window_to_launch_context(
    app: &tauri::AppHandle,
    context: &AvatarLaunchContext,
    emit_update_event: bool,
) {
    let Some(window) = app.get_webview_window(AVATAR_WINDOW_LABEL) else {
        return;
    };
    let _ = window.set_title(&format!("Nimi Avatar · {}", context.avatar_instance_id));
    let _ = window.show();
    let _ = window.set_focus();
    if emit_update_event {
        let _ = window.emit(AVATAR_LAUNCH_CONTEXT_UPDATED_EVENT, context);
    }
}

fn apply_avatar_launch_context(
    app: &tauri::AppHandle,
    state: &AvatarLaunchContextState,
    context: AvatarLaunchContext,
    emit_update_event: bool,
) -> Result<(), String> {
    state.set(context.clone())?;
    sync_avatar_window_to_launch_context(app, &context, emit_update_event);
    Ok(())
}

#[tauri::command]
async fn nimi_avatar_get_launch_context(
    state: State<'_, AvatarLaunchContextState>,
) -> Result<AvatarLaunchContext, String> {
    state.get()?.ok_or_else(|| {
        "avatar launch context is required; launch from desktop orchestrator".to_string()
    })
}

#[tauri::command]
async fn nimi_avatar_start_window_drag(window: WebviewWindow) -> Result<(), String> {
    window.start_dragging().map_err(|e| e.to_string())
}

#[tauri::command]
async fn nimi_avatar_set_window_size(
    window: WebviewWindow,
    width: u32,
    height: u32,
) -> Result<(), String> {
    window
        .set_size(PhysicalSize::new(width, height))
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn nimi_avatar_set_ignore_cursor_events(
    window: WebviewWindow,
    ignore: bool,
) -> Result<(), String> {
    window
        .set_ignore_cursor_events(ignore)
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn nimi_avatar_set_always_on_top(
    window: WebviewWindow,
    always_on_top: bool,
) -> Result<(), String> {
    window
        .set_always_on_top(always_on_top)
        .map_err(|e| e.to_string())
}

fn resolve_runtime_dir(input: &Path) -> Result<PathBuf, String> {
    let direct = input.join("runtime");
    if direct.is_dir() {
        return Ok(direct);
    }
    if input.is_dir() && input.file_name().and_then(|s| s.to_str()) == Some("runtime") {
        return Ok(input.to_path_buf());
    }
    Err(format!("no runtime/ subdirectory at {}", input.display()))
}

#[tauri::command]
async fn nimi_avatar_resolve_model(path: String) -> Result<ModelManifest, String> {
    let root = PathBuf::from(&path);
    if !root.exists() {
        return Err(format!("model path does not exist: {}", path));
    }
    let runtime_dir = resolve_runtime_dir(&root)?;
    let mut model3_json: Option<PathBuf> = None;
    for entry in fs::read_dir(&runtime_dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        if let Some(name) = entry.file_name().to_str() {
            if name.ends_with(".model3.json") {
                model3_json = Some(entry.path());
                break;
            }
        }
    }
    let model3 = model3_json
        .ok_or_else(|| format!("no *.model3.json found in {}", runtime_dir.display()))?;
    let model_id = model3
        .file_name()
        .and_then(|s| s.to_str())
        .and_then(|s| s.strip_suffix(".model3.json"))
        .ok_or_else(|| "failed to infer model_id".to_string())?
        .to_string();
    let nimi_dir = {
        let candidate = runtime_dir.join("nimi");
        if candidate.is_dir() {
            Some(candidate.display().to_string())
        } else {
            None
        }
    };
    Ok(ModelManifest {
        runtime_dir: runtime_dir.display().to_string(),
        model_id,
        model3_json_path: model3.display().to_string(),
        nimi_dir,
    })
}

fn scan_handler_dir(root: &Path) -> Vec<NasHandlerEntry> {
    let Ok(entries) = fs::read_dir(root) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let Some(name) = path.file_name().and_then(|s| s.to_str()) else {
            continue;
        };
        if !name.ends_with(".js") {
            continue;
        }
        if name.starts_with('_') {
            continue;
        }
        let Some(stem) = name.strip_suffix(".js") else {
            continue;
        };
        out.push(NasHandlerEntry {
            file_stem: stem.to_string(),
            absolute_path: path.display().to_string(),
        });
    }
    out.sort_by(|a, b| a.file_stem.cmp(&b.file_stem));
    out
}

#[tauri::command]
async fn nimi_avatar_scan_nas_handlers(nimi_dir: String) -> Result<NasHandlerManifest, String> {
    let root = PathBuf::from(&nimi_dir);
    if !root.is_dir() {
        return Err(format!("nimi directory does not exist: {}", nimi_dir));
    }
    let config_json = {
        let candidate = root.join("config.json");
        if candidate.is_file() {
            Some(candidate.display().to_string())
        } else {
            None
        }
    };
    Ok(NasHandlerManifest {
        activity: scan_handler_dir(&root.join("activity")),
        event: scan_handler_dir(&root.join("event")),
        continuous: scan_handler_dir(&root.join("continuous")),
        config_json_path: config_json,
    })
}

#[tauri::command]
async fn nimi_avatar_read_text_file(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| format!("read {} failed: {}", path, e))
}

fn configure_runtime_bridge_env() {
    if cfg!(debug_assertions) && std::env::var_os("NIMI_RUNTIME_BRIDGE_MODE").is_none() {
        std::env::set_var("NIMI_RUNTIME_BRIDGE_MODE", "RUNTIME");
    }
}

fn main() {
    let _ = dotenvy::dotenv();
    configure_runtime_bridge_env();
    let initial_launch_context = resolve_initial_launch_context();

    tauri::Builder::default()
        .manage(AvatarLaunchContextState::new(initial_launch_context))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            defaults::runtime_defaults,
            auth_session_commands::auth_session_load,
            auth_session_commands::auth_session_save,
            auth_session_commands::auth_session_clear,
            runtime_bridge::runtime_bridge_unary,
            runtime_bridge::runtime_bridge_stream_open,
            runtime_bridge::runtime_bridge_stream_close,
            runtime_bridge::runtime_bridge_status,
            runtime_bridge::runtime_bridge_start,
            runtime_bridge::runtime_bridge_stop,
            runtime_bridge::runtime_bridge_restart,
            runtime_bridge::runtime_bridge_config_get,
            runtime_bridge::runtime_bridge_config_set,
            nimi_avatar_start_window_drag,
            nimi_avatar_set_window_size,
            nimi_avatar_set_ignore_cursor_events,
            nimi_avatar_set_always_on_top,
            nimi_avatar_get_launch_context,
            nimi_avatar_resolve_model,
            nimi_avatar_scan_nas_handlers,
            nimi_avatar_read_text_file,
        ])
        .setup(|app| {
            use tauri_plugin_deep_link::DeepLinkExt;

            #[cfg(desktop)]
            {
                let _ = app.deep_link().register(AVATAR_LAUNCH_SCHEME);
            }
            let app_handle_for_deep_link = app.handle().clone();
            app.deep_link().on_open_url(move |event| {
                let state = app_handle_for_deep_link.state::<AvatarLaunchContextState>();
                for raw_url in event.urls() {
                    let Ok(context) = parse_avatar_launch_context(raw_url.as_str()) else {
                        continue;
                    };
                    let _ = apply_avatar_launch_context(
                        &app_handle_for_deep_link,
                        &state,
                        context,
                        true,
                    );
                }
            });

            if let Some(window) = app.get_webview_window("avatar") {
                let size = window.inner_size().ok();
                let payload = ReadyPayload {
                    label: window.label().to_string(),
                    width: size.as_ref().map(|s| s.width).unwrap_or(0),
                    height: size.as_ref().map(|s| s.height).unwrap_or(0),
                };
                let _ = window.emit("avatar://shell-ready", payload);
                if let Some(context) = app.state::<AvatarLaunchContextState>().get()? {
                    sync_avatar_window_to_launch_context(app.handle(), &context, false);
                }
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running nimi-avatar tauri application");
}

#[cfg(test)]
mod tests {
    use super::{
        parse_avatar_launch_context, AvatarAnchorMode, AVATAR_LAUNCH_HOST, AVATAR_LAUNCH_SCHEME,
    };

    #[test]
    fn parse_avatar_launch_context_accepts_existing_anchor_mode() {
        let parsed = parse_avatar_launch_context(&format!(
            "{AVATAR_LAUNCH_SCHEME}://{AVATAR_LAUNCH_HOST}?agent_id=agent-1&avatar_instance_id=instance-1&anchor_mode=existing&conversation_anchor_id=anchor-1&launched_by=desktop&source_surface=desktop-agent-chat"
        ))
        .expect("valid launch context");

        assert_eq!(parsed.agent_id, "agent-1");
        assert_eq!(parsed.avatar_instance_id, "instance-1");
        assert_eq!(parsed.conversation_anchor_id.as_deref(), Some("anchor-1"));
        assert_eq!(parsed.anchor_mode, AvatarAnchorMode::Existing);
        assert_eq!(parsed.launched_by, "desktop");
        assert_eq!(parsed.source_surface.as_deref(), Some("desktop-agent-chat"));
    }

    #[test]
    fn parse_avatar_launch_context_rejects_missing_anchor_for_existing_mode() {
        let error = parse_avatar_launch_context(&format!(
            "{AVATAR_LAUNCH_SCHEME}://{AVATAR_LAUNCH_HOST}?agent_id=agent-1&avatar_instance_id=instance-1&anchor_mode=existing&launched_by=desktop"
        ))
        .expect_err("missing anchor should fail");

        assert!(error.contains("conversation_anchor_id is required"));
    }

    #[test]
    fn parse_avatar_launch_context_rejects_forbidden_identity_fields() {
        let error = parse_avatar_launch_context(&format!(
            "{AVATAR_LAUNCH_SCHEME}://{AVATAR_LAUNCH_HOST}?agent_id=agent-1&avatar_instance_id=instance-1&anchor_mode=open_new&launched_by=desktop&subject_user_id=user-1"
        ))
        .expect_err("forbidden identity field should fail");

        assert!(error.contains("forbidden avatar launch query parameter"));
    }
}
