#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod avatar_instance_projection;
mod avatar_instance_registry;
mod avatar_launch_context;

use std::collections::HashMap;
use std::fs;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use avatar_instance_projection::{persist_projection, AvatarInstanceProjectionRecord};
use avatar_instance_registry::AvatarInstanceRegistry;
use avatar_launch_context::{
    parse_avatar_deep_link_request, resolve_initial_avatar_request, AvatarCloseRequest,
    AvatarDeepLinkRequest, AvatarLaunchContext, AVATAR_LAUNCH_SCHEME,
};
use nimi_kit_shell_tauri::auth_session_commands;
use nimi_kit_shell_tauri::runtime_bridge;
use nimi_kit_shell_tauri::runtime_defaults as defaults;
use notify::{Config, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use tauri::{
    Emitter, Manager, PhysicalPosition, PhysicalSize, State, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder,
};

#[derive(Clone, Serialize)]
struct ReadyPayload {
    label: String,
    width: u32,
    height: u32,
}

const AVATAR_WINDOW_LABEL: &str = "avatar";
const AVATAR_WINDOW_LABEL_PREFIX: &str = "avatar-instance";
const AVATAR_LAUNCH_CONTEXT_UPDATED_EVENT: &str = "avatar://launch-context-updated";

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
    label == AVATAR_WINDOW_LABEL || label.starts_with(&format!("{AVATAR_WINDOW_LABEL_PREFIX}-"))
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
    let _ = window.set_title(&format!("Nimi Avatar · {}", context.avatar_instance_id));
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
            avatar_instance_id: entry.context.avatar_instance_id,
            agent_id: entry.context.agent_id,
            conversation_anchor_id: entry.context.conversation_anchor_id,
            anchor_mode: entry.context.anchor_mode,
            launched_by: entry.context.launched_by,
            source_surface: entry.context.source_surface,
        })
        .collect::<Vec<_>>();
    if let Err(error) = persist_projection(std::process::id(), published_at_ms, projection) {
        eprintln!("[avatar-instance-projection] persist failed: {error}");
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

fn route_avatar_launch_context(
    app: &tauri::AppHandle,
    registry: &AvatarInstanceRegistry,
    context: AvatarLaunchContext,
    emit_update_event_for_reused_window: bool,
) -> Result<(), String> {
    if let Some(window_label) = registry.window_label_for_instance(&context.avatar_instance_id)? {
        if let Some(window) = app.get_webview_window(&window_label) {
            registry.bind_window(window.label().to_string(), context.clone())?;
            sync_avatar_window_to_launch_context(
                &window,
                &context,
                emit_update_event_for_reused_window,
            );
            sync_avatar_instance_projection(registry);
            return Ok(());
        }
    }

    if let Some(window) = app.get_webview_window(AVATAR_WINDOW_LABEL) {
        if !registry.is_window_bound(window.label())? {
            registry.bind_window(window.label().to_string(), context.clone())?;
            sync_avatar_window_to_launch_context(
                &window,
                &context,
                emit_update_event_for_reused_window,
            );
            sync_avatar_instance_projection(registry);
            return Ok(());
        }
    }

    let window_label = avatar_window_label_for_instance(&context.avatar_instance_id);
    let window = build_avatar_window(app, &window_label)?;
    attach_avatar_window_lifecycle(&window, app);
    registry.bind_window(window.label().to_string(), context.clone())?;
    sync_avatar_window_to_launch_context(&window, &context, false);
    sync_avatar_instance_projection(registry);
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
    registry.context_for_window(window.label())?.ok_or_else(|| {
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
        window.set_position(constrained).map_err(|e| e.to_string())?;
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

#[tauri::command]
async fn nimi_avatar_read_binary_file(path: String) -> Result<Vec<u8>, String> {
    fs::read(&path).map_err(|e| format!("read {} failed: {}", path, e))
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
    let root = PathBuf::from(&nimi_dir);
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
            }
        })
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
            nimi_avatar_constrain_window_to_visible_area,
            nimi_avatar_set_always_on_top,
            nimi_avatar_get_launch_context,
            nimi_avatar_resolve_model,
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

            if let Some(window) = app.get_webview_window(AVATAR_WINDOW_LABEL) {
                attach_avatar_window_lifecycle(&window, app.handle());
            }
            {
                let registry = app.state::<AvatarInstanceRegistry>();
                sync_avatar_instance_projection(&registry);
            }
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
mod tests {
    use super::*;

    fn unique_temp_dir(name: &str) -> PathBuf {
        let suffix = format!(
            "{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        );
        std::env::temp_dir().join(format!("nimi-avatar-{name}-{suffix}"))
    }

    #[test]
    fn scan_handler_dir_returns_only_public_js_files_sorted() {
        let root = unique_temp_dir("scan-handlers");
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("zeta.js"), "export default {}").unwrap();
        fs::write(root.join("alpha.js"), "export default {}").unwrap();
        fs::write(root.join("_private.js"), "export default {}").unwrap();
        fs::write(root.join("notes.txt"), "ignore").unwrap();
        fs::create_dir_all(root.join("nested.js")).unwrap();

        let entries = scan_handler_dir(&root);

        assert_eq!(
            entries
                .iter()
                .map(|entry| entry.file_stem.as_str())
                .collect::<Vec<_>>(),
            vec!["alpha", "zeta"]
        );
        assert!(entries
            .iter()
            .all(|entry| entry.absolute_path.ends_with(".js")));

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn resolve_runtime_dir_accepts_package_root_or_runtime_dir_only() {
        let root = unique_temp_dir("runtime-dir");
        let runtime = root.join("runtime");
        fs::create_dir_all(&runtime).unwrap();

        assert_eq!(resolve_runtime_dir(&root).unwrap(), runtime);
        assert_eq!(resolve_runtime_dir(&root.join("runtime")).unwrap(), runtime);
        assert!(resolve_runtime_dir(&root.join("missing")).is_err());

        let _ = fs::remove_dir_all(&root);
    }
}
