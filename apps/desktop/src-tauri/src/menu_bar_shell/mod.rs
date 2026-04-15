mod actions;
mod menu;
mod state;
pub(crate) mod window;

use serde::Deserialize;
use tauri::{AppHandle, Manager, State};

pub use state::MenuBarShellStore;

use crate::runtime_bridge::{self, RuntimeBridgeDaemonStatus};

#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub const MENU_BAR_OPEN_TAB_EVENT: &str = "menu-bar://open-tab";
pub const MENU_BAR_QUIT_REQUESTED_EVENT: &str = "menu-bar://quit-requested";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MenuBarRuntimeHealthSyncPayload {
    pub runtime_health_status: Option<String>,
    pub runtime_health_reason: Option<String>,
    pub provider_summary: Option<state::MenuBarProviderSummary>,
    pub updated_at: Option<String>,
}

pub fn setup(app: &AppHandle) -> Result<(), String> {
    refresh_from_daemon(app);
    #[cfg(target_os = "macos")]
    {
        menu::initialize(app)?;
        menu::apply_state(app);
    }
    Ok(())
}

pub fn set_window_visible(app: &AppHandle, visible: bool) {
    let store = app.state::<MenuBarShellStore>();
    store.set_window_visible(visible);
    #[cfg(target_os = "macos")]
    menu::apply_state(app);
}

pub fn set_action_in_flight(app: &AppHandle, action: Option<&str>) {
    let store = app.state::<MenuBarShellStore>();
    store.set_action_in_flight(action);
    #[cfg(target_os = "macos")]
    menu::apply_state(app);
}

pub fn sync_daemon_status(app: &AppHandle, status: RuntimeBridgeDaemonStatus) {
    let store = app.state::<MenuBarShellStore>();
    store.set_daemon_status(status);
    #[cfg(target_os = "macos")]
    menu::apply_state(app);
}

pub fn refresh_from_daemon(app: &AppHandle) {
    let status = runtime_bridge::current_daemon_status();
    sync_daemon_status(app, status);
}

pub fn request_quit(app: &AppHandle) -> Result<(), String> {
    actions::request_quit(app)
}

#[tauri::command]
pub fn menu_bar_sync_runtime_health(
    app: AppHandle,
    payload: MenuBarRuntimeHealthSyncPayload,
    store: State<MenuBarShellStore>,
) {
    store.sync_renderer_health(
        state::MenuBarRuntimeHealthSummary {
            status: payload.runtime_health_status,
            reason: payload.runtime_health_reason,
        },
        payload.provider_summary,
        payload.updated_at,
    );
    refresh_from_daemon(&app);
}

#[tauri::command]
pub fn menu_bar_complete_quit(
    app: AppHandle,
    store: State<MenuBarShellStore>,
) -> Result<(), String> {
    let _ = store;
    actions::force_complete_quit(&app)
}

#[cfg(test)]
mod tests {
    use super::state::{MenuBarRuntimeHealthSummary, MenuBarShellStateSnapshot};
    use crate::runtime_bridge::RuntimeBridgeDaemonStatus;

    #[test]
    fn presentation_disables_restart_for_external_runtime() {
        let snapshot = MenuBarShellStateSnapshot {
            daemon_status: Some(RuntimeBridgeDaemonStatus {
                running: true,
                managed: false,
                launch_mode: "RELEASE".to_string(),
                grpc_addr: "127.0.0.1:46371".to_string(),
                pid: Some(42),
                version: None,
                last_error: None,
                debug_log_path: None,
            }),
            runtime_health: MenuBarRuntimeHealthSummary {
                status: Some("READY".to_string()),
                reason: None,
            },
            ..MenuBarShellStateSnapshot::default()
        };

        let presentation = snapshot.presentation(false, false);
        assert!(!presentation.restart_enabled);
        assert!(!presentation.stop_enabled);
        assert!(presentation.status_header.contains("running"));
    }

    #[test]
    fn presentation_surfaces_runtime_reason_before_window_state() {
        let snapshot = MenuBarShellStateSnapshot {
            runtime_health: MenuBarRuntimeHealthSummary {
                status: Some("DEGRADED".to_string()),
                reason: Some("provider quorum lost".to_string()),
            },
            window_visible: false,
            ..MenuBarShellStateSnapshot::default()
        };

        let presentation = snapshot.presentation(false, false);
        assert_eq!(presentation.detail_line, "Detail: provider quorum lost");
    }
}
