#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod agent_center_avatar_package;
mod avatar_evidence_projection;
mod avatar_instance_projection;
mod avatar_instance_registry;
mod avatar_launch_context;
use agent_center_avatar_package::{
    nimi_avatar_resolve_agent_center_avatar_package, AgentCenterAvatarPackageResolvePayload,
    ModelManifest,
};
use avatar_evidence_projection::AvatarEvidenceRecordInput;
use avatar_instance_projection::{persist_projection, AvatarInstanceProjectionRecord};
use avatar_instance_registry::AvatarInstanceRegistry;
use avatar_launch_context::{
    parse_avatar_deep_link_request, resolve_initial_avatar_request, AvatarCloseRequest,
    AvatarDeepLinkRequest, AvatarLaunchContext, AVATAR_LAUNCH_SCHEME,
};
use nimi_kit_shell_tauri::runtime_bridge;
use nimi_kit_shell_tauri::runtime_defaults as defaults;
use notify::{Config, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use serde_json::json;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{
    Emitter, Manager, PhysicalPosition, PhysicalSize, State, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder,
};
#[cfg(test)]
pub(crate) fn test_env_guard() -> std::sync::MutexGuard<'static, ()> {
    static GUARD: std::sync::OnceLock<std::sync::Mutex<()>> = std::sync::OnceLock::new();
    GUARD
        .get_or_init(|| std::sync::Mutex::new(()))
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}
#[derive(Clone, Serialize)]
struct ReadyPayload {
    label: String,
    width: u32,
    height: u32,
}
const AVATAR_WINDOW_LABEL_PREFIX: &str = "avatar-instance";
const AVATAR_LAUNCH_CONTEXT_UPDATED_EVENT: &str = "avatar://launch-context-updated";
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
#[derive(Default)]
struct NasWatcherRegistry {
    watchers: Mutex<HashMap<String, RecommendedWatcher>>,
}
#[derive(Clone, Serialize)]
struct NasHandlersChangedPayload {
    watcher_id: String,
    nimi_dir: String,
    changed_files: Vec<String>,
    reload_mode: String,
}
const NAS_HANDLERS_CHANGED_EVENT: &str = "avatar://nas-handlers-changed";
fn sanitize_window_label_component(input: &str) -> String {
    let mut sanitized = String::new();
    for ch in input.chars() {
        if ch.is_ascii_alphanumeric() {
            sanitized.push(ch.to_ascii_lowercase());
        } else if matches!(ch, '-' | '_') {
            sanitized.push(ch);
        } else {
            sanitized.push('_');
        }
    }
    let trimmed = sanitized.trim_matches('_').to_string();
    if trimmed.is_empty() {
        "instance".to_string()
    } else {
        trimmed
    }
}

fn avatar_window_label_for_instance(avatar_instance_id: &str) -> String {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    avatar_instance_id.hash(&mut hasher);
    let digest = hasher.finish();
    let sanitized = sanitize_window_label_component(avatar_instance_id);
    let prefix = sanitized.chars().take(24).collect::<String>();
    format!("{AVATAR_WINDOW_LABEL_PREFIX}-{prefix}-{digest:016x}")
}

fn is_avatar_window_label(label: &str) -> bool {
    label.starts_with(&format!("{AVATAR_WINDOW_LABEL_PREFIX}-"))
}

fn emit_avatar_shell_ready_for_webview(webview: &tauri::Webview) {
    let size = webview.window().inner_size().ok();
    let payload = ReadyPayload {
        label: webview.label().to_string(),
        width: size.as_ref().map(|s| s.width).unwrap_or(0),
        height: size.as_ref().map(|s| s.height).unwrap_or(0),
    };
    let _ = webview.emit("avatar://shell-ready", payload);
}

fn sync_avatar_window_to_launch_context(
    window: &WebviewWindow,
    context: &AvatarLaunchContext,
    emit_update_event: bool,
) {
    let title_instance = context
        .avatar_instance_id
        .as_deref()
        .unwrap_or_else(|| window.label());
    let _ = window.set_title(&format!("Nimi Avatar · {}", title_instance));
    let _ = window.show();
    let _ = window.set_focus();
    if emit_update_event {
        let _ = window.emit(AVATAR_LAUNCH_CONTEXT_UPDATED_EVENT, context);
    }
}

fn attach_avatar_window_lifecycle(window: &WebviewWindow, app: &tauri::AppHandle) {
    let app_handle = app.clone();
    let window_label = window.label().to_string();
    window.on_window_event(move |event| {
        if matches!(event, tauri::WindowEvent::Destroyed) {
            let registry = app_handle.state::<AvatarInstanceRegistry>();
            let _ = registry.remove_window(&window_label);
            sync_avatar_instance_projection(&registry);
        }
    });
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}

fn sync_avatar_instance_projection(registry: &AvatarInstanceRegistry) {
    let published_at_ms = now_ms();
    let snapshot = match registry.snapshot() {
        Ok(snapshot) => snapshot,
        Err(error) => {
            eprintln!("[avatar-instance-projection] snapshot failed: {error}");
            return;
        }
    };
    let projection = snapshot
        .into_iter()
        .map(|entry| AvatarInstanceProjectionRecord {
            avatar_instance_id: entry
                .context
                .avatar_instance_id
                .unwrap_or_else(|| entry.window_label.clone()),
            agent_id: entry.context.agent_id,
            launch_source: entry.context.launch_source,
        })
        .collect::<Vec<_>>();
    if let Err(error) = persist_projection(std::process::id(), published_at_ms, projection) {
        eprintln!("[avatar-instance-projection] persist failed: {error}");
    }
}

fn start_avatar_instance_projection_heartbeat(app: &tauri::AppHandle) {
    let app_handle = app.clone();
    std::thread::spawn(move || loop {
        std::thread::sleep(std::time::Duration::from_millis(1_000));
        let registry = app_handle.state::<AvatarInstanceRegistry>();
        sync_avatar_instance_projection(&registry);
    });
}

fn now_evidence_timestamp() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

fn record_avatar_backend_evidence(
    context: &AvatarLaunchContext,
    kind: &str,
    detail: serde_json::Value,
) {
    if let Err(error) = avatar_evidence_projection::append_evidence_record(
        context.clone(),
        AvatarEvidenceRecordInput {
            kind: kind.to_string(),
            recorded_at: now_evidence_timestamp(),
            detail,
            consume: json!({ "mode": "sdk", "authority": "runtime" }),
            model: json!({}),
        },
    ) {
        eprintln!("[avatar-carrier-evidence] backend diagnostic failed: {error}");
    }
}

fn build_avatar_window(
    app: &tauri::AppHandle,
    window_label: &str,
) -> Result<WebviewWindow, String> {
    let window = WebviewWindowBuilder::new(app, window_label, WebviewUrl::App("/".into()))
        .title("Nimi Avatar")
        .inner_size(400.0, 600.0)
        .decorations(false)
        .resizable(true)
        .build()
        .map_err(|error| format!("failed to build avatar window: {error}"))?;
    let _ = window.set_always_on_top(true);
    Ok(window)
}

fn normalize_avatar_launch_instance_id(
    context: &mut AvatarLaunchContext,
    fallback_instance_id: String,
) -> String {
    match context.avatar_instance_id.clone() {
        Some(instance_id) => instance_id,
        None => {
            context.avatar_instance_id = Some(fallback_instance_id.clone());
            fallback_instance_id
        }
    }
}

fn route_avatar_launch_context(
    app: &tauri::AppHandle,
    registry: &AvatarInstanceRegistry,
    mut context: AvatarLaunchContext,
    emit_update_event_for_reused_window: bool,
) -> Result<(), String> {
    let instance_id =
        normalize_avatar_launch_instance_id(&mut context, format!("avatar-{}", now_ms()));
    if let Some(window_label) = registry.window_label_for_instance(&instance_id)? {
        if let Some(window) = app.get_webview_window(&window_label) {
            registry.bind_window(window.label().to_string(), context.clone())?;
            sync_avatar_window_to_launch_context(
                &window,
                &context,
                emit_update_event_for_reused_window,
            );
            sync_avatar_instance_projection(registry);
            record_avatar_backend_evidence(
                &context,
                "avatar.launch.context-bound",
                json!({
                    "source": "avatar-backend",
                    "window_label": window.label(),
                    "window_reused": true
                }),
            );
            return Ok(());
        }
    }

    let window_label = avatar_window_label_for_instance(&instance_id);
    let window = build_avatar_window(app, &window_label)?;
    attach_avatar_window_lifecycle(&window, app);
    registry.bind_window(window.label().to_string(), context.clone())?;
    sync_avatar_window_to_launch_context(&window, &context, false);
    sync_avatar_instance_projection(registry);
    record_avatar_backend_evidence(
        &context,
        "avatar.launch.context-bound",
        json!({
            "source": "avatar-backend",
            "window_label": window.label(),
            "window_reused": false
        }),
    );
    Ok(())
}

fn close_avatar_instance(
    app: &tauri::AppHandle,
    registry: &AvatarInstanceRegistry,
    request: &AvatarCloseRequest,
) -> Result<(), String> {
    let Some(window_label) = registry.window_label_for_instance(&request.avatar_instance_id)?
    else {
        return Err(format!(
            "avatar instance is not active: {}",
            request.avatar_instance_id
        ));
    };
    let Some(window) = app.get_webview_window(&window_label) else {
        registry.remove_window(&window_label)?;
        sync_avatar_instance_projection(registry);
        return Err(format!(
            "avatar instance window is unavailable: {}",
            request.avatar_instance_id
        ));
    };
    window
        .close()
        .map_err(|error| format!("failed to close avatar instance: {error}"))
}

#[tauri::command]
async fn nimi_avatar_get_launch_context(
    window: WebviewWindow,
    registry: State<'_, AvatarInstanceRegistry>,
) -> Result<AvatarLaunchContext, String> {
    let context = registry
        .context_for_window(window.label())?
        .ok_or_else(|| {
            "avatar launch context is required; launch from desktop orchestrator".to_string()
        })?;
    record_avatar_backend_evidence(
        &context,
        "avatar.renderer.launch-context-read",
        json!({
            "source": "avatar-backend",
            "window_label": window.label()
        }),
    );
    Ok(context)
}

#[tauri::command]
async fn nimi_avatar_record_evidence(
    window: WebviewWindow,
    registry: State<'_, AvatarInstanceRegistry>,
    payload: AvatarEvidenceRecordInput,
) -> Result<String, String> {
    let context = registry
        .context_for_window(window.label())?
        .ok_or_else(|| {
            "avatar evidence requires launch context; launch from desktop orchestrator".to_string()
        })?;
    let path = avatar_evidence_projection::append_evidence_record(context, payload)?;
    Ok(path.display().to_string())
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
async fn nimi_avatar_constrain_window_to_visible_area(
    window: WebviewWindow,
    min_visible_ratio: f64,
) -> Result<(), String> {
    let position = window.outer_position().map_err(|e| e.to_string())?;
    let size = window.outer_size().map_err(|e| e.to_string())?;
    let monitor = window
        .current_monitor()
        .map_err(|e| e.to_string())?
        .or_else(|| window.primary_monitor().ok().flatten())
        .ok_or_else(|| "no monitor is available for avatar edge constraints".to_string())?;
    let monitor_position = monitor.position();
    let monitor_size = monitor.size();
    let ratio = if min_visible_ratio.is_finite() {
        min_visible_ratio.clamp(0.05, 1.0)
    } else {
        0.2
    };
    let min_visible_width = ((size.width as f64) * ratio).ceil() as i32;
    let min_visible_height = ((size.height as f64) * ratio).ceil() as i32;
    let min_x = monitor_position.x - size.width as i32 + min_visible_width;
    let max_x = monitor_position.x + monitor_size.width as i32 - min_visible_width;
    let min_y = monitor_position.y - size.height as i32 + min_visible_height;
    let max_y = monitor_position.y + monitor_size.height as i32 - min_visible_height;
    let constrained = PhysicalPosition::new(
        position.x.clamp(min_x, max_x),
        position.y.clamp(min_y, max_y),
    );
    if constrained != position {
        window
            .set_position(constrained)
            .map_err(|e| e.to_string())?;
    }
    Ok(())
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

fn path_is_within(path: &Path, root: &Path) -> bool {
    path == root || path.starts_with(root)
}

fn is_agent_center_visual_package_file(path: &Path, home: &Path) -> bool {
    let account_data_root = home.join(".nimi").join("data").join("accounts");
    let Ok(relative) = path.strip_prefix(&account_data_root) else {
        return false;
    };
    let segments = relative
        .components()
        .filter_map(|component| component.as_os_str().to_str())
        .collect::<Vec<_>>();
    if segments.len() < 11 {
        return false;
    }
    if segments.get(1) != Some(&"agents") {
        return false;
    }
    segments.windows(7).any(|window| {
        window[0] == "agent-center"
            && window[1] == "modules"
            && window[2] == "avatar_package"
            && window[3] == "packages"
            && window[6] == "files"
    })
}

fn validated_avatar_visual_path(path: &Path) -> Result<PathBuf, String> {
    let canonical = path
        .canonicalize()
        .map_err(|e| format!("resolve {} failed: {}", path.display(), e))?;
    let home = std::env::var_os("HOME")
        .map(PathBuf::from)
        .ok_or_else(|| "HOME is required for avatar visual path validation".to_string())?;
    let canonical_home = home
        .canonicalize()
        .map_err(|e| format!("resolve HOME {} failed: {}", home.display(), e))?;
    let nimi_root = canonical_home.join(".nimi");
    if path_is_within(&canonical, &nimi_root)
        && !is_agent_center_visual_package_file(&canonical, &canonical_home)
    {
        return Err(format!(
            "avatar file access is limited to launch-approved visual package files: {}",
            path.display()
        ));
    }
    Ok(canonical)
}

#[tauri::command]
async fn nimi_avatar_resolve_model(path: String) -> Result<ModelManifest, String> {
    let root = validated_avatar_visual_path(&PathBuf::from(&path))?;
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
    let adapter_manifest_path = {
        let candidate = runtime_dir.join("nimi").join("live2d-adapter.json");
        if candidate.is_file() {
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
        adapter_manifest_path,
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
    let root = validated_avatar_visual_path(&PathBuf::from(&nimi_dir))?;
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
    let canonical = validated_avatar_visual_path(&PathBuf::from(&path))?;
    fs::read_to_string(&canonical).map_err(|e| format!("read {} failed: {}", path, e))
}

#[tauri::command]
async fn nimi_avatar_read_binary_file(path: String) -> Result<Vec<u8>, String> {
    let canonical = validated_avatar_visual_path(&PathBuf::from(&path))?;
    fs::read(&canonical).map_err(|e| format!("read {} failed: {}", path, e))
}

fn nas_reload_mode_for_event(kind: &EventKind) -> &'static str {
    match kind {
        EventKind::Create(_) => "add",
        EventKind::Remove(_) => "remove",
        EventKind::Modify(_) => "update",
        _ => "update",
    }
}

#[tauri::command]
async fn nimi_avatar_watch_nas_handlers(
    app: tauri::AppHandle,
    state: State<'_, NasWatcherRegistry>,
    nimi_dir: String,
    watcher_id: String,
) -> Result<(), String> {
    let root = validated_avatar_visual_path(&PathBuf::from(&nimi_dir))?;
    if !root.is_dir() {
        return Err(format!("nimi directory does not exist: {}", nimi_dir));
    }
    if watcher_id.trim().is_empty() {
        return Err("NAS watcher id is required".to_string());
    }

    let event_root = root.clone();
    let event_nimi_dir = nimi_dir.clone();
    let event_watcher_id = watcher_id.clone();
    let mut watcher = RecommendedWatcher::new(
        move |result: notify::Result<notify::Event>| {
            let Ok(event) = result else {
                return;
            };
            let changed_files = event
                .paths
                .iter()
                .map(|path| {
                    path.strip_prefix(&event_root)
                        .unwrap_or(path)
                        .display()
                        .to_string()
                })
                .collect::<Vec<_>>();
            if changed_files.is_empty() {
                return;
            }
            let payload = NasHandlersChangedPayload {
                watcher_id: event_watcher_id.clone(),
                nimi_dir: event_nimi_dir.clone(),
                changed_files,
                reload_mode: nas_reload_mode_for_event(&event.kind).to_string(),
            };
            let _ = app.emit(NAS_HANDLERS_CHANGED_EVENT, payload);
        },
        Config::default(),
    )
    .map_err(|e| format!("create NAS watcher failed: {e}"))?;
    watcher
        .watch(&root, RecursiveMode::Recursive)
        .map_err(|e| format!("watch NAS directory failed: {e}"))?;

    let mut watchers = state
        .watchers
        .lock()
        .map_err(|_| "NAS watcher registry lock poisoned".to_string())?;
    watchers.insert(watcher_id, watcher);
    Ok(())
}

#[tauri::command]
async fn nimi_avatar_unwatch_nas_handlers(
    state: State<'_, NasWatcherRegistry>,
    watcher_id: String,
) -> Result<(), String> {
    let mut watchers = state
        .watchers
        .lock()
        .map_err(|_| "NAS watcher registry lock poisoned".to_string())?;
    watchers.remove(&watcher_id);
    Ok(())
}

fn configure_runtime_bridge_env() {
    if cfg!(debug_assertions) && std::env::var_os("NIMI_RUNTIME_BRIDGE_MODE").is_none() {
        std::env::set_var("NIMI_RUNTIME_BRIDGE_MODE", "RUNTIME");
    }
}

fn main() {
    let _ = dotenvy::dotenv();
    configure_runtime_bridge_env();
    let initial_avatar_request = resolve_initial_avatar_request();

    tauri::Builder::default()
        .manage(AvatarInstanceRegistry::new())
        .manage(NasWatcherRegistry::default())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .on_page_load(|webview, payload| {
            if matches!(payload.event(), tauri::webview::PageLoadEvent::Finished)
                && is_avatar_window_label(webview.label())
            {
                emit_avatar_shell_ready_for_webview(webview);
                let registry = webview.app_handle().state::<AvatarInstanceRegistry>();
                if let Ok(Some(context)) = registry.context_for_window(webview.label()) {
                    record_avatar_backend_evidence(
                        &context,
                        "avatar.window.page-loaded",
                        json!({
                            "source": "avatar-backend",
                            "window_label": webview.label()
                        }),
                    );
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            defaults::runtime_defaults,
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
            nimi_avatar_constrain_window_to_visible_area,
            nimi_avatar_set_always_on_top,
            nimi_avatar_get_launch_context,
            nimi_avatar_record_evidence,
            nimi_avatar_resolve_model,
            nimi_avatar_resolve_agent_center_avatar_package,
            nimi_avatar_scan_nas_handlers,
            nimi_avatar_read_text_file,
            nimi_avatar_read_binary_file,
            nimi_avatar_watch_nas_handlers,
            nimi_avatar_unwatch_nas_handlers,
        ])
        .setup(|app| {
            use tauri_plugin_deep_link::DeepLinkExt;

            #[cfg(desktop)]
            {
                let _ = app.deep_link().register(AVATAR_LAUNCH_SCHEME);
            }
            let app_handle_for_deep_link = app.handle().clone();
            app.deep_link().on_open_url(move |event| {
                let registry = app_handle_for_deep_link.state::<AvatarInstanceRegistry>();
                for raw_url in event.urls() {
                    let Ok(request) = parse_avatar_deep_link_request(raw_url.as_str()) else {
                        continue;
                    };
                    match request {
                        AvatarDeepLinkRequest::Launch(context) => {
                            let _ = route_avatar_launch_context(
                                &app_handle_for_deep_link,
                                &registry,
                                context,
                                true,
                            );
                        }
                        AvatarDeepLinkRequest::Close(request) => {
                            let _ = close_avatar_instance(
                                &app_handle_for_deep_link,
                                &registry,
                                &request,
                            );
                        }
                    }
                }
            });

            {
                let registry = app.state::<AvatarInstanceRegistry>();
                sync_avatar_instance_projection(&registry);
            }
            start_avatar_instance_projection_heartbeat(app.handle());
            if let Some(request) = initial_avatar_request {
                let registry = app.state::<AvatarInstanceRegistry>();
                match request {
                    AvatarDeepLinkRequest::Launch(context) => {
                        route_avatar_launch_context(app.handle(), &registry, context, false)?;
                    }
                    AvatarDeepLinkRequest::Close(request) => {
                        let _ = close_avatar_instance(app.handle(), &registry, &request);
                    }
                }
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running nimi-avatar tauri application");
}

#[cfg(test)]
mod main_tests;
