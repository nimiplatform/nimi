use super::*;
use serde_json::json;
use tauri::{PhysicalPosition, State, WebviewWindow};

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
            runtime_source_ref: payload.runtime_source_ref,
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

// Window control primitives (drag / size / ignore-cursor / constrain /
// always-on-top / hide / close) are migrated to the kit standard
// `nimi_shell_tauri` floating-window commands, registered in `main.rs`. The
// pure geometry helpers (manual-drag position, visible-area constraint) live
// in `nimi_shell_tauri::standard_floating_window` and are unit-tested there.
// Avatar keeps only the cursor hit-testing query below, which is app-owned
// (tightly coupled to the alpha-mask click-through decision).

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
