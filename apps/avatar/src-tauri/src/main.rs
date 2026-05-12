#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod agent_center_avatar_package;
mod avatar_evidence_projection;
mod avatar_instance_projection;
mod avatar_instance_registry;
mod avatar_launch_context;
mod avatar_visual_commands;
use agent_center_avatar_package::nimi_avatar_resolve_agent_center_avatar_package;
#[cfg(test)]
use agent_center_avatar_package::AgentCenterAvatarPackageResolvePayload;
use avatar_evidence_projection::AvatarEvidenceRecordInput;
use avatar_instance_projection::{persist_projection, AvatarInstanceProjectionRecord};
use avatar_instance_registry::AvatarInstanceRegistry;
use avatar_launch_context::{
    parse_avatar_deep_link_request, resolve_initial_avatar_request, AvatarCloseRequest,
    AvatarDeepLinkRequest, AvatarLaunchContext, AVATAR_LAUNCH_SCHEME,
};
pub(crate) use avatar_visual_commands::{
    nimi_avatar_read_binary_file, nimi_avatar_read_text_file, nimi_avatar_resolve_model,
    nimi_avatar_scan_nas_handlers, nimi_avatar_unwatch_nas_handlers,
    nimi_avatar_watch_nas_handlers, NasWatcherRegistry,
};
#[cfg(test)]
pub(crate) use avatar_visual_commands::{
    resolve_runtime_dir, scan_handler_dir, validated_avatar_visual_path,
};
use nimi_kit_shell_tauri::runtime_bridge;
use nimi_kit_shell_tauri::runtime_defaults as defaults;
use serde::Serialize;
use serde_json::json;
#[cfg(test)]
use sha2::{Digest, Sha256};
use std::hash::{Hash, Hasher};
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

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct AvatarCursorClientPosition {
    screen_x: f64,
    screen_y: f64,
    client_x: f64,
    client_y: f64,
    scale_factor: f64,
}
const AVATAR_WINDOW_LABEL_PREFIX: &str = "avatar-instance";
const AVATAR_LAUNCH_CONTEXT_UPDATED_EVENT: &str = "avatar://launch-context-updated";
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
    // K-NAV-SHELL-001: transparent + decorations(false) + skip_taskbar(true) +
    // shadow(false) are required (not optional) per app-shell-contract §1.1.
    // Transparent is what lets the embodiment-stage's transparent background
    // actually show desktop underneath outside the model alpha + companion
    // surface bounds. Without it the window paints opaque dark, defeating the
    // entire "桌面悬浮 embodiment surface" product form.
    // skip_taskbar deliberately omitted: on macOS it switches the window to
    // utility-style (NSWindow.canJoinAllSpaces / stationary) which interferes
    // with `start_dragging()` and click-through semantics. The pet stays in
    // the dock; we accept that until tray icon plumbing lands.
    let window = WebviewWindowBuilder::new(app, window_label, WebviewUrl::App("/".into()))
        .title("Nimi Avatar")
        .inner_size(400.0, 600.0)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .resizable(true)
        .build()
        .map_err(|error| format!("failed to build avatar window: {error}"))?;
    let _ = window.set_always_on_top(true);
    #[cfg(debug_assertions)]
    window.open_devtools();
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

// Wave 4 drag fallback — manual delta-based window move. macOS NSWindow with
// transparent + always_on_top + decorations(false) does not consistently
// honor `start_dragging()`; this command lets the renderer feed pointer
// screen-coord deltas frame-by-frame and have Rust adjust the window's
// outer position. Permissions: relies on `core:window:allow-set-position`
// which is already granted; no extra JS-side permission required because
// outer_position is read internally.
#[tauri::command]
async fn nimi_avatar_drag_window_by(
    window: WebviewWindow,
    delta_x: i32,
    delta_y: i32,
) -> Result<(), String> {
    let pos = window.outer_position().map_err(|e| e.to_string())?;
    window
        .set_position(PhysicalPosition::new(pos.x + delta_x, pos.y + delta_y))
        .map_err(|e| e.to_string())
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

fn compute_avatar_cursor_client_position(
    cursor_position: PhysicalPosition<f64>,
    content_position: PhysicalPosition<i32>,
    scale_factor: f64,
) -> AvatarCursorClientPosition {
    let scale = if scale_factor.is_finite() && scale_factor > 0.0 {
        scale_factor
    } else {
        1.0
    };
    AvatarCursorClientPosition {
        screen_x: cursor_position.x,
        screen_y: cursor_position.y,
        client_x: (cursor_position.x - f64::from(content_position.x)) / scale,
        client_y: (cursor_position.y - f64::from(content_position.y)) / scale,
        scale_factor: scale,
    }
}

#[tauri::command]
async fn nimi_avatar_get_cursor_client_position(
    window: WebviewWindow,
) -> Result<AvatarCursorClientPosition, String> {
    let cursor_position = window.cursor_position().map_err(|e| e.to_string())?;
    let content_position = window.inner_position().map_err(|e| e.to_string())?;
    let scale_factor = window.scale_factor().map_err(|e| e.to_string())?;
    Ok(compute_avatar_cursor_client_position(
        cursor_position,
        content_position,
        scale_factor,
    ))
}

// Wave 4 — pure constraint math extracted so cargo tests can cover it
// without spinning up a Tauri WebviewWindow. Encodes
// window-bounds-policy.yaml visible_area rule (K-NAV-SHELL-010):
// at least `min_visible_ratio` of the window must remain inside the active
// monitor's work area.
pub(crate) fn compute_constrained_window_position(
    window_position: (i32, i32),
    window_size: (u32, u32),
    monitor_position: (i32, i32),
    monitor_size: (u32, u32),
    min_visible_ratio: f64,
) -> (i32, i32) {
    let ratio = if min_visible_ratio.is_finite() {
        min_visible_ratio.clamp(0.05, 1.0)
    } else {
        0.2
    };
    let min_visible_width = ((window_size.0 as f64) * ratio).ceil() as i32;
    let min_visible_height = ((window_size.1 as f64) * ratio).ceil() as i32;
    let min_x = monitor_position.0 - window_size.0 as i32 + min_visible_width;
    let max_x = monitor_position.0 + monitor_size.0 as i32 - min_visible_width;
    let min_y = monitor_position.1 - window_size.1 as i32 + min_visible_height;
    let max_y = monitor_position.1 + monitor_size.1 as i32 - min_visible_height;
    (
        window_position.0.clamp(min_x, max_x),
        window_position.1.clamp(min_y, max_y),
    )
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
    let (cx, cy) = compute_constrained_window_position(
        (position.x, position.y),
        (size.width, size.height),
        (monitor_position.x, monitor_position.y),
        (monitor_size.width, monitor_size.height),
        min_visible_ratio,
    );
    let constrained = PhysicalPosition::new(cx, cy);
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
            nimi_avatar_drag_window_by,
            nimi_avatar_set_window_size,
            nimi_avatar_set_ignore_cursor_events,
            nimi_avatar_get_cursor_client_position,
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
