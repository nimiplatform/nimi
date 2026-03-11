use std::thread;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use crate::runtime_bridge::{self, RuntimeBridgeDaemonStatus};

use super::menu;
use super::state::MenuBarShellStore;
use super::window;
use super::{
    refresh_from_daemon, set_action_in_flight, set_window_visible, MENU_BAR_OPEN_TAB_EVENT,
    MENU_BAR_QUIT_REQUESTED_EVENT,
};

pub const MENU_ID_OPEN_NIMI: &str = "menu-bar-open-nimi";
pub const MENU_ID_OPEN_RUNTIME_DASHBOARD: &str = "menu-bar-open-runtime-dashboard";
pub const MENU_ID_OPEN_LOCAL_MODELS: &str = "menu-bar-open-local-models";
pub const MENU_ID_OPEN_CLOUD_CONNECTORS: &str = "menu-bar-open-cloud-connectors";
pub const MENU_ID_OPEN_SETTINGS: &str = "menu-bar-open-settings";
pub const MENU_ID_START_RUNTIME: &str = "menu-bar-start-runtime";
pub const MENU_ID_RESTART_RUNTIME: &str = "menu-bar-restart-runtime";
pub const MENU_ID_STOP_RUNTIME: &str = "menu-bar-stop-runtime";
pub const MENU_ID_REFRESH_STATUS: &str = "menu-bar-refresh-status";
pub const MENU_ID_QUIT_NIMI: &str = "menu-bar-quit-nimi";

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct MenuBarOpenTabPayload {
    tab: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    page: Option<String>,
}

#[derive(Clone, Copy, Debug)]
enum RuntimeAction {
    Start,
    Restart,
    Stop,
}

pub fn handle_menu_event(app: &AppHandle, menu_id: &str) -> Result<(), String> {
    match menu_id {
        MENU_ID_OPEN_NIMI => {
            window::focus_main_window(app)?;
            set_window_visible(app, true);
        }
        MENU_ID_OPEN_RUNTIME_DASHBOARD => open_tab(app, "runtime", Some("overview"))?,
        MENU_ID_OPEN_LOCAL_MODELS => open_tab(app, "runtime", Some("local"))?,
        MENU_ID_OPEN_CLOUD_CONNECTORS => open_tab(app, "runtime", Some("cloud"))?,
        MENU_ID_OPEN_SETTINGS => open_tab(app, "settings", None)?,
        MENU_ID_START_RUNTIME => {
            let status = runtime_bridge::current_daemon_status();
            if !runtime_action_enabled(&status, RuntimeAction::Start) {
                refresh_from_daemon(app);
                menu::apply_state(app);
                return Ok(());
            }
            set_action_in_flight(app, Some("start"));
            let _ = runtime_bridge::start_daemon();
            set_action_in_flight(app, None);
            refresh_from_daemon(app);
        }
        MENU_ID_RESTART_RUNTIME => {
            let status = runtime_bridge::current_daemon_status();
            if !runtime_action_enabled(&status, RuntimeAction::Restart) {
                refresh_from_daemon(app);
                menu::apply_state(app);
                return Ok(());
            }
            set_action_in_flight(app, Some("restart"));
            let _ = runtime_bridge::restart_daemon();
            set_action_in_flight(app, None);
            refresh_from_daemon(app);
        }
        MENU_ID_STOP_RUNTIME => {
            let status = runtime_bridge::current_daemon_status();
            if !runtime_action_enabled(&status, RuntimeAction::Stop) {
                refresh_from_daemon(app);
                menu::apply_state(app);
                return Ok(());
            }
            set_action_in_flight(app, Some("stop"));
            let _ = runtime_bridge::stop_daemon();
            set_action_in_flight(app, None);
            refresh_from_daemon(app);
        }
        MENU_ID_REFRESH_STATUS => refresh_from_daemon(app),
        MENU_ID_QUIT_NIMI => request_quit(app)?,
        _ => {}
    }
    menu::apply_state(app);
    Ok(())
}

fn open_tab(app: &AppHandle, tab: &str, page: Option<&str>) -> Result<(), String> {
    window::focus_main_window(app)?;
    set_window_visible(app, true);
    app.emit(
        MENU_BAR_OPEN_TAB_EVENT,
        MenuBarOpenTabPayload {
            tab: tab.to_string(),
            page: page.map(|value| value.to_string()),
        },
    )
    .map_err(|error| error.to_string())
}

pub fn request_quit(app: &AppHandle) -> Result<(), String> {
    let store = app.state::<MenuBarShellStore>();
    if store.quit_pending() {
        return Ok(());
    }
    store.mark_quit_pending(true);
    menu::apply_state(app);
    app.emit(MENU_BAR_QUIT_REQUESTED_EVENT, ())
        .map_err(|error| error.to_string())?;

    let app_handle = app.clone();
    thread::spawn(move || {
        thread::sleep(Duration::from_millis(2500));
        let store = app_handle.state::<MenuBarShellStore>();
        if store.quit_pending() {
            let _ = force_complete_quit(&app_handle);
        }
    });

    Ok(())
}

fn runtime_action_enabled(status: &RuntimeBridgeDaemonStatus, action: RuntimeAction) -> bool {
    let launch_mode = status.launch_mode.trim().to_uppercase();
    match action {
        RuntimeAction::Start => !status.running && launch_mode != "INVALID",
        RuntimeAction::Restart | RuntimeAction::Stop => status.running && status.managed,
    }
}

pub fn force_complete_quit(app: &AppHandle) -> Result<(), String> {
    let store = app.state::<MenuBarShellStore>();
    store.mark_quit_pending(false);
    menu::apply_state(app);

    let daemon_status = runtime_bridge::current_daemon_status();
    if daemon_status.managed && daemon_status.running {
        let _ = runtime_bridge::stop_daemon();
    }
    app.exit(0);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{runtime_action_enabled, RuntimeAction};
    use crate::runtime_bridge::RuntimeBridgeDaemonStatus;

    fn daemon_status(running: bool, managed: bool, launch_mode: &str) -> RuntimeBridgeDaemonStatus {
        RuntimeBridgeDaemonStatus {
            running,
            managed,
            launch_mode: launch_mode.to_string(),
            grpc_addr: "127.0.0.1:46371".to_string(),
            pid: None,
            last_error: None,
            debug_log_path: None,
        }
    }

    #[test]
    fn external_runtime_actions_are_blocked() {
        let running_external = daemon_status(true, false, "RELEASE");
        assert!(!runtime_action_enabled(
            &running_external,
            RuntimeAction::Restart
        ));
        assert!(!runtime_action_enabled(
            &running_external,
            RuntimeAction::Stop
        ));
    }

    #[test]
    fn unavailable_runtime_cannot_start() {
        let unavailable = daemon_status(false, true, "INVALID");
        assert!(!runtime_action_enabled(&unavailable, RuntimeAction::Start));
    }
}
