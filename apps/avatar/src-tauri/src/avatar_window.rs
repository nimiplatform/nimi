use super::*;
use serde::Serialize;
use std::hash::{Hash, Hasher};
use tauri::{Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

#[derive(Clone, Serialize)]
pub(crate) struct ReadyPayload {
    pub(crate) label: String,
    pub(crate) width: u32,
    pub(crate) height: u32,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AvatarCursorClientPosition {
    pub(crate) screen_x: f64,
    pub(crate) screen_y: f64,
    pub(crate) client_x: f64,
    pub(crate) client_y: f64,
    pub(crate) scale_factor: f64,
}

pub(crate) const AVATAR_WINDOW_LABEL_PREFIX: &str = "avatar-instance";
pub(crate) const AVATAR_LAUNCH_CONTEXT_UPDATED_EVENT: &str = "avatar://launch-context-updated";
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

pub(crate) fn is_avatar_window_label(label: &str) -> bool {
    label.starts_with(&format!("{AVATAR_WINDOW_LABEL_PREFIX}-"))
}

pub(crate) fn emit_avatar_shell_ready_for_webview(webview: &tauri::Webview) {
    let size = webview.window().inner_size().ok();
    let payload = ReadyPayload {
        label: webview.label().to_string(),
        width: size.as_ref().map(|s| s.width).unwrap_or(0),
        height: size.as_ref().map(|s| s.height).unwrap_or(0),
    };
    let _ = webview.emit("avatar://shell-ready", payload);
}

pub(crate) fn sync_avatar_window_to_launch_context(
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
        let _ = window.emit(
            AVATAR_LAUNCH_CONTEXT_UPDATED_EVENT,
            AvatarRendererLaunchContext::from(context),
        );
    }
}

pub(crate) fn attach_avatar_window_lifecycle(window: &WebviewWindow, app: &tauri::AppHandle) {
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

pub(crate) fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}

pub(crate) fn sync_avatar_instance_projection(registry: &AvatarInstanceRegistry) {
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
        .filter_map(|entry| projection_record_from_registry_entry(&entry))
        .collect::<Vec<_>>();
    if let Err(error) = persist_projection(std::process::id(), published_at_ms, projection) {
        eprintln!("[avatar-instance-projection] persist failed: {error}");
    }
}

pub(crate) fn start_avatar_instance_projection_heartbeat(app: &tauri::AppHandle) {
    let app_handle = app.clone();
    std::thread::spawn(move || loop {
        std::thread::sleep(std::time::Duration::from_millis(1_000));
        let registry = app_handle.state::<AvatarInstanceRegistry>();
        sync_avatar_instance_projection(&registry);
    });
}

pub(crate) fn build_avatar_window(
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
    // with `start_dragging()` and click-through semantics. The Avatar window
    // stays in the dock; we accept that until tray icon plumbing lands.
    let window = WebviewWindowBuilder::new(app, window_label, WebviewUrl::App("/".into()))
        .title("Nimi Avatar")
        .inner_size(400.0, 600.0)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .resizable(false)
        .build()
        .map_err(|error| format!("failed to build avatar window: {error}"))?;
    let _ = window.set_always_on_top(true);
    #[cfg(debug_assertions)]
    window.open_devtools();
    Ok(window)
}

pub(crate) fn normalize_avatar_launch_instance_id(
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

pub(crate) fn route_avatar_launch_context(
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
            return Ok(());
        }
    }

    let window_label = avatar_window_label_for_instance(&instance_id);
    registry.bind_window(window_label.clone(), context.clone())?;
    let window = match build_avatar_window(app, &window_label) {
        Ok(window) => window,
        Err(error) => {
            let _ = registry.remove_window(&window_label);
            sync_avatar_instance_projection(registry);
            return Err(error);
        }
    };
    attach_avatar_window_lifecycle(&window, app);
    sync_avatar_window_to_launch_context(&window, &context, false);
    sync_avatar_instance_projection(registry);
    Ok(())
}

pub(crate) fn close_avatar_instance(
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
