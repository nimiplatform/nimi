// Standard shell `floating-window.*` (nimi.shell.floatingWindow.*).
//
// Shared Tauri host glue for the eight floating-window operations. Each
// command acts on the invoking `tauri::WebviewWindow`. Kit owns payload
// validation and the wire result shapes; the OS/window manager owns the
// actual geometry. The pure position math (`compute_*`) is extracted so
// cargo tests can cover it without spinning up a real window.
//
// Manual-drag semantics: `begin_manual_drag` always reports `mode = "manual"`
// plus the window's current outer position as the drag origin, because a
// system-level `start_dragging()` is unreliable for transparent,
// always-on-top, chrome-less floating windows. The `"system"` variant is
// reserved for a future platform that can drive an OS-level drag session.

use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::{PhysicalPosition, PhysicalSize, WebviewWindow};

// ---------------------------------------------------------------------------
// Payloads (renderer camelCase -> serde) and results.
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
pub struct FloatingWindowSetBoundsPayload {
    #[serde(default)]
    pub x: Option<i32>,
    #[serde(default)]
    pub y: Option<i32>,
    #[serde(default)]
    pub width: Option<u32>,
    #[serde(default)]
    pub height: Option<u32>,
}

impl FloatingWindowSetBoundsPayload {
    pub fn is_empty(&self) -> bool {
        self.x.is_none() && self.y.is_none() && self.width.is_none() && self.height.is_none()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
pub struct FloatingWindowSetIgnoreCursorEventsPayload {
    pub ignore: bool,
    /// Electron-only knob; accepted but ignored by the Tauri host.
    #[serde(default)]
    pub forward: Option<bool>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
pub struct FloatingWindowSetAlwaysOnTopPayload {
    pub always_on_top: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
pub struct FloatingWindowMoveManualDragPayload {
    pub origin_x: i32,
    pub origin_y: i32,
    pub total_delta_x: i32,
    pub total_delta_y: i32,
}

#[derive(Debug, Clone, Copy, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
pub struct FloatingWindowConstrainPayload {
    pub min_visible_ratio: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FloatingWindowManualDragOrigin {
    /// Always `"manual"` for the current implementation. See module docs.
    pub mode: &'static str,
    pub origin_x: i32,
    pub origin_y: i32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FloatingWindowConstrainResult {
    pub constrained: bool,
}

// ---------------------------------------------------------------------------
// Pure geometry math (unit-tested without a WebviewWindow).
// ---------------------------------------------------------------------------

/// Manual-drag target position = origin + total pointer delta.
pub fn compute_manual_drag_window_position(
    origin: (i32, i32),
    total_delta: (i32, i32),
) -> (i32, i32) {
    (origin.0 + total_delta.0, origin.1 + total_delta.1)
}

/// Clamp a window position so at least `min_visible_ratio` of the window
/// stays inside the monitor. Ratio is clamped to `0.05..=1.0`; a non-finite
/// ratio falls back to `0.2`. Minimum visible extents are `ceil(size*ratio)`.
pub fn compute_constrained_window_position(
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

// ---------------------------------------------------------------------------
// Errors.
// ---------------------------------------------------------------------------

fn floating_window_error(
    command: &str,
    code: &str,
    reason_code: &str,
    action_hint: &str,
    cause: Option<String>,
) -> String {
    crate::capabilities::standard_shell_error(
        code,
        reason_code,
        action_hint,
        "tauri",
        Some(json!({ "command": command, "cause": cause })),
    )
}

fn invalid_payload_error(command: &str, cause: String) -> String {
    floating_window_error(
        command,
        "invalid-payload",
        "tauri-floating-window-payload-invalid",
        "send_floating_window_payload_matching_contract",
        Some(cause),
    )
}

fn host_internal_error(command: &str, cause: String) -> String {
    floating_window_error(
        command,
        "host-internal-error",
        "tauri-floating-window-host-operation-failed",
        "inspect_tauri_floating_window_support",
        Some(cause),
    )
}

fn parse_payload<T: for<'de> Deserialize<'de>>(
    command: &str,
    payload: serde_json::Value,
) -> Result<T, String> {
    serde_json::from_value::<T>(payload)
        .map_err(|error| invalid_payload_error(command, error.to_string()))
}

// ---------------------------------------------------------------------------
// Commands.
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn floating_window_set_bounds(
    window: WebviewWindow,
    payload: serde_json::Value,
) -> Result<(), String> {
    const COMMAND: &str = "floating_window_set_bounds";
    let parsed = parse_payload::<FloatingWindowSetBoundsPayload>(COMMAND, payload)?;
    if parsed.is_empty() {
        return Err(floating_window_error(
            COMMAND,
            "invalid-payload",
            "tauri-floating-window-bounds-empty",
            "send_at_least_one_of_x_y_width_height",
            None,
        ));
    }
    if let (Some(width), Some(height)) = (parsed.width, parsed.height) {
        window
            .set_size(PhysicalSize::new(width, height))
            .map_err(|error| host_internal_error(COMMAND, error.to_string()))?;
    } else if parsed.width.is_some() || parsed.height.is_some() {
        return Err(floating_window_error(
            COMMAND,
            "invalid-payload",
            "tauri-floating-window-bounds-partial-size",
            "send_both_width_and_height_together",
            None,
        ));
    }
    if let (Some(x), Some(y)) = (parsed.x, parsed.y) {
        window
            .set_position(PhysicalPosition::new(x, y))
            .map_err(|error| host_internal_error(COMMAND, error.to_string()))?;
    } else if parsed.x.is_some() || parsed.y.is_some() {
        return Err(floating_window_error(
            COMMAND,
            "invalid-payload",
            "tauri-floating-window-bounds-partial-position",
            "send_both_x_and_y_together",
            None,
        ));
    }
    Ok(())
}

#[tauri::command]
pub fn floating_window_set_ignore_cursor_events(
    window: WebviewWindow,
    payload: serde_json::Value,
) -> Result<(), String> {
    const COMMAND: &str = "floating_window_set_ignore_cursor_events";
    let parsed = parse_payload::<FloatingWindowSetIgnoreCursorEventsPayload>(COMMAND, payload)?;
    window
        .set_ignore_cursor_events(parsed.ignore)
        .map_err(|error| host_internal_error(COMMAND, error.to_string()))
}

#[tauri::command]
pub fn floating_window_set_always_on_top(
    window: WebviewWindow,
    payload: serde_json::Value,
) -> Result<(), String> {
    const COMMAND: &str = "floating_window_set_always_on_top";
    let parsed = parse_payload::<FloatingWindowSetAlwaysOnTopPayload>(COMMAND, payload)?;
    window
        .set_always_on_top(parsed.always_on_top)
        .map_err(|error| host_internal_error(COMMAND, error.to_string()))
}

#[tauri::command]
pub fn floating_window_hide(window: WebviewWindow) -> Result<(), String> {
    const COMMAND: &str = "floating_window_hide";
    window
        .hide()
        .map_err(|error| host_internal_error(COMMAND, error.to_string()))
}

#[tauri::command]
pub fn floating_window_close(window: WebviewWindow) -> Result<(), String> {
    const COMMAND: &str = "floating_window_close";
    window
        .close()
        .map_err(|error| host_internal_error(COMMAND, error.to_string()))
}

#[tauri::command]
pub fn floating_window_begin_manual_drag(
    window: WebviewWindow,
) -> Result<FloatingWindowManualDragOrigin, String> {
    const COMMAND: &str = "floating_window_begin_manual_drag";
    let position = window
        .outer_position()
        .map_err(|error| host_internal_error(COMMAND, error.to_string()))?;
    Ok(FloatingWindowManualDragOrigin {
        mode: "manual",
        origin_x: position.x,
        origin_y: position.y,
    })
}

#[tauri::command]
pub fn floating_window_move_manual_drag(
    window: WebviewWindow,
    payload: serde_json::Value,
) -> Result<(), String> {
    const COMMAND: &str = "floating_window_move_manual_drag";
    let parsed = parse_payload::<FloatingWindowMoveManualDragPayload>(COMMAND, payload)?;
    let (x, y) = compute_manual_drag_window_position(
        (parsed.origin_x, parsed.origin_y),
        (parsed.total_delta_x, parsed.total_delta_y),
    );
    window
        .set_position(PhysicalPosition::new(x, y))
        .map_err(|error| host_internal_error(COMMAND, error.to_string()))
}

#[tauri::command]
pub fn floating_window_constrain_to_visible_area(
    window: WebviewWindow,
    payload: serde_json::Value,
) -> Result<FloatingWindowConstrainResult, String> {
    const COMMAND: &str = "floating_window_constrain_to_visible_area";
    let parsed = parse_payload::<FloatingWindowConstrainPayload>(COMMAND, payload)?;
    let position = window
        .outer_position()
        .map_err(|error| host_internal_error(COMMAND, error.to_string()))?;
    let size = window
        .outer_size()
        .map_err(|error| host_internal_error(COMMAND, error.to_string()))?;
    let monitor = window
        .current_monitor()
        .map_err(|error| host_internal_error(COMMAND, error.to_string()))?
        .or_else(|| window.primary_monitor().ok().flatten())
        .ok_or_else(|| {
            floating_window_error(
                COMMAND,
                "host-internal-error",
                "tauri-floating-window-no-monitor-available",
                "ensure_a_monitor_is_available_before_constraining",
                None,
            )
        })?;
    let monitor_position = monitor.position();
    let monitor_size = monitor.size();
    let (cx, cy) = compute_constrained_window_position(
        (position.x, position.y),
        (size.width, size.height),
        (monitor_position.x, monitor_position.y),
        (monitor_size.width, monitor_size.height),
        parsed.min_visible_ratio,
    );
    let constrained = cx != position.x || cy != position.y;
    if constrained {
        window
            .set_position(PhysicalPosition::new(cx, cy))
            .map_err(|error| host_internal_error(COMMAND, error.to_string()))?;
    }
    Ok(FloatingWindowConstrainResult { constrained })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Value};

    fn reason_code(error: &str) -> String {
        serde_json::from_str::<Value>(error)
            .expect("standard shell error envelope")
            .get("reasonCode")
            .and_then(Value::as_str)
            .expect("reasonCode")
            .to_string()
    }

    #[test]
    fn manual_drag_position_is_origin_plus_total_delta() {
        assert_eq!(
            compute_manual_drag_window_position((100, 200), (15, -30)),
            (115, 170)
        );
        assert_eq!(
            compute_manual_drag_window_position((-50, 0), (-25, 40)),
            (-75, 40)
        );
    }

    #[test]
    fn move_manual_drag_payload_parses_all_fields() {
        let parsed: FloatingWindowMoveManualDragPayload = serde_json::from_value(json!({
            "originX": 10,
            "originY": 20,
            "totalDeltaX": 3,
            "totalDeltaY": -4,
        }))
        .expect("valid move payload");
        assert_eq!(parsed.origin_x, 10);
        assert_eq!(parsed.origin_y, 20);
        assert_eq!(parsed.total_delta_x, 3);
        assert_eq!(parsed.total_delta_y, -4);
    }

    #[test]
    fn constrain_keeps_position_when_already_visible() {
        // Window fully inside the monitor stays put.
        let result =
            compute_constrained_window_position((100, 100), (400, 300), (0, 0), (1920, 1080), 0.2);
        assert_eq!(result, (100, 100));
    }

    #[test]
    fn constrain_clamps_each_direction() {
        // ratio 0.2, size 400x300 -> min visible 80 wide, 60 tall.
        // Off the left/top edge: min_x = 0 - 400 + 80 = -320, min_y = -240.
        let far_top_left = compute_constrained_window_position(
            (-9999, -9999),
            (400, 300),
            (0, 0),
            (1920, 1080),
            0.2,
        );
        assert_eq!(far_top_left, (-320, -240));
        // Off the right/bottom edge: max_x = 1920 - 80 = 1840, max_y = 1080 - 60 = 1020.
        let far_bottom_right = compute_constrained_window_position(
            (9999, 9999),
            (400, 300),
            (0, 0),
            (1920, 1080),
            0.2,
        );
        assert_eq!(far_bottom_right, (1840, 1020));
    }

    #[test]
    fn constrain_ratio_bounds_and_default_are_applied() {
        // ratio below 0.05 clamps to 0.05: min visible width ceil(400*0.05)=20.
        let low =
            compute_constrained_window_position((-9999, 0), (400, 300), (0, 0), (1920, 1080), 0.0);
        assert_eq!(low.0, 0 - 400 + 20);
        // ratio above 1.0 clamps to 1.0: min visible width = 400 (full window).
        let high =
            compute_constrained_window_position((-9999, 0), (400, 300), (0, 0), (1920, 1080), 5.0);
        assert_eq!(high.0, 0 - 400 + 400);
        // non-finite ratio falls back to 0.2: min visible width ceil(400*0.2)=80.
        let default = compute_constrained_window_position(
            (-9999, 0),
            (400, 300),
            (0, 0),
            (1920, 1080),
            f64::NAN,
        );
        assert_eq!(default.0, 0 - 400 + 80);
    }

    #[test]
    fn set_bounds_payload_rejects_empty() {
        let parsed: FloatingWindowSetBoundsPayload =
            serde_json::from_value(json!({})).expect("empty object parses");
        assert!(parsed.is_empty());
    }

    #[test]
    fn set_bounds_payload_rejects_unknown_fields() {
        let error = parse_payload::<FloatingWindowSetBoundsPayload>(
            "floating_window_set_bounds",
            json!({
                "x": 1,
                "z": 9,
            }),
        )
        .expect_err("unknown field rejected");
        assert_eq!(
            reason_code(error.as_str()),
            "tauri-floating-window-payload-invalid"
        );
    }

    #[test]
    fn set_bounds_payload_rejects_non_integer_position() {
        let error = parse_payload::<FloatingWindowSetBoundsPayload>(
            "floating_window_set_bounds",
            json!({
                "x": 1.5,
            }),
        )
        .expect_err("non-integer position rejected");
        assert_eq!(
            reason_code(error.as_str()),
            "tauri-floating-window-payload-invalid"
        );
    }

    #[test]
    fn ignore_cursor_events_payload_accepts_forward_but_requires_ignore() {
        let parsed: FloatingWindowSetIgnoreCursorEventsPayload =
            serde_json::from_value(json!({ "ignore": true, "forward": true }))
                .expect("valid payload");
        assert!(parsed.ignore);
        assert_eq!(parsed.forward, Some(true));

        let error = parse_payload::<FloatingWindowSetIgnoreCursorEventsPayload>(
            "floating_window_set_ignore_cursor_events",
            json!({ "forward": true }),
        )
        .expect_err("missing ignore rejected");
        assert_eq!(
            reason_code(error.as_str()),
            "tauri-floating-window-payload-invalid"
        );
    }

    #[test]
    fn constrain_payload_requires_min_visible_ratio() {
        let error = parse_payload::<FloatingWindowConstrainPayload>(
            "floating_window_constrain_to_visible_area",
            json!({}),
        )
        .expect_err("missing ratio rejected");
        assert_eq!(
            reason_code(error.as_str()),
            "tauri-floating-window-payload-invalid"
        );
    }

    #[test]
    fn begin_manual_drag_origin_serializes_camel_case_manual_mode() {
        let origin = FloatingWindowManualDragOrigin {
            mode: "manual",
            origin_x: 12,
            origin_y: 34,
        };
        let value = serde_json::to_value(origin).expect("serialize origin");
        assert_eq!(value.get("mode").and_then(Value::as_str), Some("manual"));
        assert_eq!(value.get("originX").and_then(Value::as_i64), Some(12));
        assert_eq!(value.get("originY").and_then(Value::as_i64), Some(34));
    }

    #[test]
    fn constrain_result_serializes_camel_case() {
        let value = serde_json::to_value(FloatingWindowConstrainResult { constrained: true })
            .expect("serialize result");
        assert_eq!(
            value.get("constrained").and_then(Value::as_bool),
            Some(true)
        );
    }
}
