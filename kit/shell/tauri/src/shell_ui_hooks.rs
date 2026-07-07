// Standard shell-ui host hooks.
//
// Apps own the presentation of confirm dialogs and window focus/drag behavior;
// kit owns the standard shell wire contract. Hooks follow the
// runtime_bridge::RuntimeBridgeHostHooks OnceLock precedent: set once per
// process in production, replaceable under cfg(test).

use serde::Deserialize;
use serde_json::{json, Value};
use std::sync::{Arc, Mutex, OnceLock};

/// Wire payload of `nimi.shell.ui.confirmDialog` (renderer sends
/// `{ payload: { title, description, level? } }`).
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
pub struct StandardConfirmDialogPayload {
    pub title: String,
    pub description: String,
    #[serde(default)]
    pub level: Option<String>,
}

pub type StandardConfirmDialogHook =
    Arc<dyn Fn(&StandardConfirmDialogPayload) -> Result<bool, String> + Send + Sync>;
pub type StandardFocusMainWindowHook =
    Arc<dyn Fn(&tauri::AppHandle) -> Result<(), String> + Send + Sync>;
/// `Ok(Some(()))` means the hook handled the drag; `Ok(None)` means the hook
/// declined and kit falls back to the default `window.start_dragging()`.
pub type StandardStartWindowDragHook =
    Arc<dyn Fn(&tauri::WebviewWindow) -> Result<Option<()>, String> + Send + Sync>;

#[derive(Clone, Default)]
pub struct StandardShellUiHostHooks {
    pub confirm_dialog: Option<StandardConfirmDialogHook>,
    pub focus_main_window: Option<StandardFocusMainWindowHook>,
    pub start_window_drag: Option<StandardStartWindowDragHook>,
}

static SHELL_UI_HOST_HOOKS: OnceLock<Mutex<StandardShellUiHostHooks>> = OnceLock::new();

pub fn set_standard_shell_ui_host_hooks(hooks: StandardShellUiHostHooks) -> Result<(), String> {
    if SHELL_UI_HOST_HOOKS.get().is_some() {
        #[cfg(test)]
        {
            let existing = SHELL_UI_HOST_HOOKS
                .get()
                .ok_or_else(|| "STANDARD_SHELL_UI_HOST_HOOKS_MISSING".to_string())?;
            *existing
                .lock()
                .map_err(|_| "STANDARD_SHELL_UI_HOST_HOOKS_LOCK_POISONED".to_string())? = hooks;
            return Ok(());
        }
        #[cfg(not(test))]
        {
            return Err("STANDARD_SHELL_UI_HOST_HOOKS_ALREADY_SET".to_string());
        }
    }
    SHELL_UI_HOST_HOOKS
        .set(Mutex::new(hooks))
        .map_err(|_| "STANDARD_SHELL_UI_HOST_HOOKS_ALREADY_SET".to_string())
}

#[cfg(test)]
pub(crate) fn with_standard_shell_ui_host_hooks<R>(
    hooks: StandardShellUiHostHooks,
    run: impl FnOnce() -> R,
) -> R {
    let _guard = crate::test_support::test_guard();
    let previous = host_hooks().unwrap_or_default();
    set_standard_shell_ui_host_hooks(hooks).expect("set temporary standard shell ui host hooks");
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(run));
    set_standard_shell_ui_host_hooks(previous).expect("restore standard shell ui host hooks");
    match result {
        Ok(value) => value,
        Err(payload) => std::panic::resume_unwind(payload),
    }
}

fn host_hooks() -> Option<StandardShellUiHostHooks> {
    SHELL_UI_HOST_HOOKS
        .get()
        .and_then(|hooks| hooks.lock().ok().map(|hooks| hooks.clone()))
}

pub(crate) fn confirm_dialog_hook() -> Option<StandardConfirmDialogHook> {
    host_hooks().and_then(|hooks| hooks.confirm_dialog.clone())
}

pub(crate) fn focus_main_window_hook() -> Option<StandardFocusMainWindowHook> {
    host_hooks().and_then(|hooks| hooks.focus_main_window.clone())
}

pub(crate) fn start_window_drag_hook() -> Option<StandardStartWindowDragHook> {
    host_hooks().and_then(|hooks| hooks.start_window_drag.clone())
}

/// Hook errors that already carry a standard shell envelope pass through
/// unchanged; anything else is wrapped fail-closed so the renderer always
/// receives the standard envelope shape.
pub(crate) fn shell_ui_hook_error_to_standard_error(
    error: String,
    command: &str,
    reason_code: &str,
    action_hint: &str,
) -> String {
    if let Ok(value) = serde_json::from_str::<Value>(error.as_str()) {
        if value.get("code").and_then(Value::as_str).is_some()
            && value.get("reasonCode").and_then(Value::as_str).is_some()
        {
            return error;
        }
    }
    crate::capabilities::standard_shell_error(
        "host-internal-error",
        reason_code,
        action_hint,
        "tauri",
        Some(json!({ "command": command, "cause": error })),
    )
}

pub(crate) fn run_confirm_dialog(payload: Value) -> Result<Value, String> {
    let Some(hook) = confirm_dialog_hook() else {
        return Err(crate::capabilities::standard_shell_error(
            "capability-unavailable",
            "tauri-standard-confirm-dialog-unavailable",
            "provide_host_confirm_dialog_implementation",
            "tauri",
            Some(json!({ "command": "confirm_dialog", "payload": payload })),
        ));
    };
    let parsed =
        serde_json::from_value::<StandardConfirmDialogPayload>(payload).map_err(|error| {
            crate::capabilities::standard_shell_error(
                "invalid-payload",
                "tauri-standard-confirm-dialog-payload-invalid",
                "send_confirm_dialog_title_description_level",
                "tauri",
                Some(json!({ "command": "confirm_dialog", "cause": error.to_string() })),
            )
        })?;
    let confirmed = hook(&parsed).map_err(|error| {
        shell_ui_hook_error_to_standard_error(
            error,
            "confirm_dialog",
            "tauri-standard-confirm-dialog-hook-failed",
            "inspect_host_confirm_dialog_hook",
        )
    })?;
    Ok(json!({ "confirmed": confirmed }))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum StandardWindowDragDecision {
    HandledByHook,
    FallbackToDefault,
}

pub(crate) fn interpret_start_window_drag_hook_outcome(
    outcome: Option<Result<Option<()>, String>>,
) -> Result<StandardWindowDragDecision, String> {
    match outcome {
        None | Some(Ok(None)) => Ok(StandardWindowDragDecision::FallbackToDefault),
        Some(Ok(Some(()))) => Ok(StandardWindowDragDecision::HandledByHook),
        Some(Err(error)) => Err(shell_ui_hook_error_to_standard_error(
            error,
            "start_window_drag",
            "tauri-standard-window-drag-hook-failed",
            "inspect_host_window_drag_hook",
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::{
        interpret_start_window_drag_hook_outcome, run_confirm_dialog,
        with_standard_shell_ui_host_hooks, StandardShellUiHostHooks, StandardWindowDragDecision,
    };
    use serde_json::{json, Value};
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Arc;

    fn parse_envelope(error: &str) -> Value {
        serde_json::from_str::<Value>(error).expect("standard shell error envelope")
    }

    #[test]
    fn confirm_dialog_without_hook_keeps_fail_closed_stub_error() {
        with_standard_shell_ui_host_hooks(StandardShellUiHostHooks::default(), || {
            let error = run_confirm_dialog(json!({
                "title": "Delete run history",
                "description": "This cannot be undone.",
            }))
            .expect_err("no hook must fail closed");
            let parsed = parse_envelope(error.as_str());
            assert_eq!(
                parsed.get("code").and_then(Value::as_str),
                Some("capability-unavailable")
            );
            assert_eq!(
                parsed.get("reasonCode").and_then(Value::as_str),
                Some("tauri-standard-confirm-dialog-unavailable")
            );
        });
    }

    #[test]
    fn confirm_dialog_hook_receives_typed_payload_and_wraps_confirmed_result() {
        let saw_expected_payload = Arc::new(AtomicBool::new(false));
        let saw = saw_expected_payload.clone();
        with_standard_shell_ui_host_hooks(
            StandardShellUiHostHooks {
                confirm_dialog: Some(Arc::new(move |payload| {
                    saw.store(
                        payload.title == "Delete run history"
                            && payload.description == "This cannot be undone."
                            && payload.level.as_deref() == Some("warning"),
                        Ordering::SeqCst,
                    );
                    Ok(true)
                })),
                ..Default::default()
            },
            || {
                let result = run_confirm_dialog(json!({
                    "title": "Delete run history",
                    "description": "This cannot be undone.",
                    "level": "warning",
                }))
                .expect("hooked confirm dialog");
                assert_eq!(result, json!({ "confirmed": true }));
                assert!(saw_expected_payload.load(Ordering::SeqCst));
            },
        );
    }

    #[test]
    fn confirm_dialog_hook_rejects_invalid_payload_before_calling_hook() {
        with_standard_shell_ui_host_hooks(
            StandardShellUiHostHooks {
                confirm_dialog: Some(Arc::new(|_| panic!("hook must not run on invalid payload"))),
                ..Default::default()
            },
            || {
                let error = run_confirm_dialog(json!({ "description": "missing title" }))
                    .expect_err("invalid payload rejected");
                let parsed = parse_envelope(error.as_str());
                assert_eq!(
                    parsed.get("code").and_then(Value::as_str),
                    Some("invalid-payload")
                );
                assert_eq!(
                    parsed.get("reasonCode").and_then(Value::as_str),
                    Some("tauri-standard-confirm-dialog-payload-invalid")
                );
            },
        );
    }

    #[test]
    fn confirm_dialog_hook_errors_pass_through_envelopes_and_wrap_plain_strings() {
        let envelope = crate::capabilities::standard_shell_error(
            "capability-unavailable",
            "app-confirm-dialog-suppressed",
            "retry_after_first_run",
            "tauri",
            None,
        );
        let envelope_clone = envelope.clone();
        with_standard_shell_ui_host_hooks(
            StandardShellUiHostHooks {
                confirm_dialog: Some(Arc::new(move |_| Err(envelope_clone.clone()))),
                ..Default::default()
            },
            || {
                let error = run_confirm_dialog(json!({ "title": "t", "description": "d" }))
                    .expect_err("hook error propagates");
                assert_eq!(error, envelope);
            },
        );

        with_standard_shell_ui_host_hooks(
            StandardShellUiHostHooks {
                confirm_dialog: Some(Arc::new(|_| Err("boom".to_string()))),
                ..Default::default()
            },
            || {
                let error = run_confirm_dialog(json!({ "title": "t", "description": "d" }))
                    .expect_err("hook error propagates");
                let parsed = parse_envelope(error.as_str());
                assert_eq!(
                    parsed.get("code").and_then(Value::as_str),
                    Some("host-internal-error")
                );
                assert_eq!(
                    parsed.get("reasonCode").and_then(Value::as_str),
                    Some("tauri-standard-confirm-dialog-hook-failed")
                );
                assert_eq!(
                    parsed
                        .get("details")
                        .and_then(|details| details.get("cause"))
                        .and_then(Value::as_str),
                    Some("boom")
                );
            },
        );
    }

    #[test]
    fn window_drag_hook_outcome_falls_back_without_hook_or_on_declined_hook() {
        assert_eq!(
            interpret_start_window_drag_hook_outcome(None).expect("no hook"),
            StandardWindowDragDecision::FallbackToDefault
        );
        assert_eq!(
            interpret_start_window_drag_hook_outcome(Some(Ok(None))).expect("declined hook"),
            StandardWindowDragDecision::FallbackToDefault
        );
        assert_eq!(
            interpret_start_window_drag_hook_outcome(Some(Ok(Some(())))).expect("handled hook"),
            StandardWindowDragDecision::HandledByHook
        );
        let error = interpret_start_window_drag_hook_outcome(Some(Err("drag broke".to_string())))
            .expect_err("hook error fails closed");
        let parsed = parse_envelope(error.as_str());
        assert_eq!(
            parsed.get("reasonCode").and_then(Value::as_str),
            Some("tauri-standard-window-drag-hook-failed")
        );
    }
}
