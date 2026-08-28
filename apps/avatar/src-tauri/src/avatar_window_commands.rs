use super::*;
use tauri::{PhysicalPosition, State, WebviewWindow};

#[tauri::command]
pub(crate) async fn nimi_avatar_get_launch_context(
    window: WebviewWindow,
    registry: State<'_, AvatarInstanceRegistry>,
) -> Result<AvatarRendererLaunchContext, String> {
    let context = registry
        .context_for_window(window.label())?
        .ok_or_else(|| {
            "avatar launch context is required; launch from desktop orchestrator".to_string()
        })?;
    Ok(AvatarRendererLaunchContext::from(&context))
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
