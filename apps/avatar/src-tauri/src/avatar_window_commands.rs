use super::*;
use serde_json::json;
use tauri::{PhysicalPosition, PhysicalSize, State, WebviewWindow};

#[tauri::command]
pub(crate) async fn nimi_avatar_get_launch_context(
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
pub(crate) async fn nimi_avatar_bind_runtime_identity(
    window: WebviewWindow,
    registry: State<'_, AvatarInstanceRegistry>,
    payload: AvatarRuntimeIdentityBindingPayload,
) -> Result<(), String> {
    let context = registry
        .context_for_window(window.label())?
        .ok_or_else(|| {
            "avatar runtime identity binding requires launch context; launch from desktop orchestrator".to_string()
        })?;
    let context_instance_id = context
        .avatar_instance_id
        .as_deref()
        .unwrap_or_else(|| window.label())
        .trim();
    if context_instance_id != payload.avatar_instance_id.trim() {
        return Err("avatar runtime identity binding avatar_instance_id mismatch".to_string());
    }
    registry.bind_runtime_identity(
        window.label(),
        AvatarInstanceRuntimeIdentity {
            avatar_instance_id: payload.avatar_instance_id,
            owner_user_id: payload.owner_user_id,
            realm_agent_id: payload.realm_agent_id,
            local_agent_ref: payload.local_agent_ref,
            launch_source: payload.launch_source.or(context.launch_source.clone()),
        },
    )?;
    sync_avatar_instance_projection(&registry);
    record_avatar_backend_evidence(
        &context,
        "avatar.runtime.identity-bound",
        json!({
            "source": "avatar-backend",
            "window_label": window.label(),
        }),
    );
    Ok(())
}

#[tauri::command]
pub(crate) async fn nimi_avatar_record_evidence(
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
pub(crate) async fn nimi_avatar_write_evidence_artifact(
    window: WebviewWindow,
    registry: State<'_, AvatarInstanceRegistry>,
    payload: AvatarEvidenceArtifactInput,
) -> Result<AvatarEvidenceArtifactWriteResult, String> {
    let context = registry
        .context_for_window(window.label())?
        .ok_or_else(|| {
            "avatar evidence artifact requires launch context; launch from desktop orchestrator"
                .to_string()
        })?;
    avatar_evidence_projection::write_visual_artifact(context, payload)
}

#[tauri::command]
pub(crate) async fn nimi_avatar_start_window_drag(window: WebviewWindow) -> Result<(), String> {
    window.start_dragging().map_err(|e| e.to_string())
}

// Wave 4 drag fallback — manual absolute window move. macOS NSWindow with
// transparent + always_on_top + decorations(false) does not consistently
// honor `start_dragging()`. The renderer reads the origin once at drag
// start, then sends total pointer deltas so the hot path avoids a per-frame
// `outer_position()` read.
#[tauri::command]
pub(crate) async fn nimi_avatar_begin_manual_drag_window(
    window: WebviewWindow,
) -> Result<AvatarManualDragWindowOrigin, String> {
    let pos = window.outer_position().map_err(|e| e.to_string())?;
    Ok(AvatarManualDragWindowOrigin { x: pos.x, y: pos.y })
}

pub(crate) fn compute_manual_drag_window_position(
    origin: (i32, i32),
    total_delta: (i32, i32),
) -> PhysicalPosition<i32> {
    PhysicalPosition::new(origin.0 + total_delta.0, origin.1 + total_delta.1)
}

#[tauri::command]
pub(crate) async fn nimi_avatar_move_manual_drag_window(
    window: WebviewWindow,
    origin_x: i32,
    origin_y: i32,
    total_delta_x: i32,
    total_delta_y: i32,
) -> Result<(), String> {
    let target =
        compute_manual_drag_window_position((origin_x, origin_y), (total_delta_x, total_delta_y));
    window.set_position(target).map_err(|e| e.to_string())
}

#[tauri::command]
pub(crate) async fn nimi_avatar_set_window_size(
    window: WebviewWindow,
    width: u32,
    height: u32,
) -> Result<(), String> {
    window
        .set_size(PhysicalSize::new(width, height))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub(crate) async fn nimi_avatar_set_ignore_cursor_events(
    window: WebviewWindow,
    ignore: bool,
) -> Result<(), String> {
    window
        .set_ignore_cursor_events(ignore)
        .map_err(|e| e.to_string())
}

pub(crate) fn compute_avatar_cursor_client_position(
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
pub(crate) async fn nimi_avatar_get_cursor_client_position(
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
pub(crate) async fn nimi_avatar_constrain_window_to_visible_area(
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
pub(crate) async fn nimi_avatar_set_always_on_top(
    window: WebviewWindow,
    always_on_top: bool,
) -> Result<(), String> {
    window
        .set_always_on_top(always_on_top)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub(crate) async fn nimi_avatar_hide_window(window: WebviewWindow) -> Result<(), String> {
    window.hide().map_err(|e| e.to_string())
}

#[tauri::command]
pub(crate) async fn nimi_avatar_close_window(window: WebviewWindow) -> Result<(), String> {
    window.close().map_err(|e| e.to_string())
}
