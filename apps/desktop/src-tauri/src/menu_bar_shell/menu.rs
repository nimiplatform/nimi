use tauri::image::Image;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Manager};

use super::actions;
use super::state::MenuBarShellStore;

pub const MENU_BAR_TRAY_ID: &str = "nimi-menu-bar";
const MENU_BAR_TEMPLATE_ICON_BYTES: &[u8] = include_bytes!("../../icons/nimi-tray-template.png");

#[derive(Clone)]
pub struct MenuBarMenuHandles {
    pub status_header: MenuItem<tauri::Wry>,
    pub runtime_line: MenuItem<tauri::Wry>,
    pub detail_line: MenuItem<tauri::Wry>,
    pub providers_line: MenuItem<tauri::Wry>,
    pub grpc_line: MenuItem<tauri::Wry>,
    pub pid_line: MenuItem<tauri::Wry>,
    pub managed_line: MenuItem<tauri::Wry>,
    pub last_check_line: MenuItem<tauri::Wry>,
    pub start_runtime: MenuItem<tauri::Wry>,
    pub restart_runtime: MenuItem<tauri::Wry>,
    pub stop_runtime: MenuItem<tauri::Wry>,
    pub refresh_status: MenuItem<tauri::Wry>,
}

pub fn initialize(app: &AppHandle) -> Result<(), String> {
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        return Ok(());
    }

    #[cfg(target_os = "macos")]
    {
        let menu = Menu::new(app).map_err(|error| error.to_string())?;

        let status_header = MenuItem::with_id(
            app,
            "menu-bar-status-header",
            "Nimi Runtime is stopped",
            false,
            None::<&str>,
        )
        .map_err(|error| error.to_string())?;
        let open_nimi = MenuItem::with_id(
            app,
            actions::MENU_ID_OPEN_NIMI,
            "Open Nimi",
            true,
            None::<&str>,
        )
        .map_err(|error| error.to_string())?;
        let open_runtime = MenuItem::with_id(
            app,
            actions::MENU_ID_OPEN_RUNTIME_DASHBOARD,
            "Open Runtime Dashboard",
            true,
            None::<&str>,
        )
        .map_err(|error| error.to_string())?;
        let open_local = MenuItem::with_id(
            app,
            actions::MENU_ID_OPEN_LOCAL_MODELS,
            "Open Local Models",
            true,
            None::<&str>,
        )
        .map_err(|error| error.to_string())?;
        let open_cloud = MenuItem::with_id(
            app,
            actions::MENU_ID_OPEN_CLOUD_CONNECTORS,
            "Open Cloud Connectors",
            true,
            None::<&str>,
        )
        .map_err(|error| error.to_string())?;
        let open_settings = MenuItem::with_id(
            app,
            actions::MENU_ID_OPEN_SETTINGS,
            "Open Settings",
            true,
            None::<&str>,
        )
        .map_err(|error| error.to_string())?;

        let runtime_line = MenuItem::with_id(
            app,
            "menu-bar-runtime-line",
            "Runtime: STOPPED",
            false,
            None::<&str>,
        )
        .map_err(|error| error.to_string())?;
        let providers_line = MenuItem::with_id(
            app,
            "menu-bar-providers-line",
            "Providers: pending",
            false,
            None::<&str>,
        )
        .map_err(|error| error.to_string())?;
        let detail_line = MenuItem::with_id(
            app,
            "menu-bar-detail-line",
            "Window: visible",
            false,
            None::<&str>,
        )
        .map_err(|error| error.to_string())?;
        let grpc_line = MenuItem::with_id(
            app,
            "menu-bar-grpc-line",
            "gRPC: 127.0.0.1:46371",
            false,
            None::<&str>,
        )
        .map_err(|error| error.to_string())?;
        let pid_line = MenuItem::with_id(app, "menu-bar-pid-line", "PID: -", false, None::<&str>)
            .map_err(|error| error.to_string())?;
        let managed_line = MenuItem::with_id(
            app,
            "menu-bar-managed-line",
            "Managed by Desktop",
            false,
            None::<&str>,
        )
        .map_err(|error| error.to_string())?;
        let last_check_line = MenuItem::with_id(
            app,
            "menu-bar-last-check-line",
            "Last check: -",
            false,
            None::<&str>,
        )
        .map_err(|error| error.to_string())?;

        let start_runtime = MenuItem::with_id(
            app,
            actions::MENU_ID_START_RUNTIME,
            "Start Runtime",
            true,
            None::<&str>,
        )
        .map_err(|error| error.to_string())?;
        let restart_runtime = MenuItem::with_id(
            app,
            actions::MENU_ID_RESTART_RUNTIME,
            "Restart Runtime",
            false,
            None::<&str>,
        )
        .map_err(|error| error.to_string())?;
        let stop_runtime = MenuItem::with_id(
            app,
            actions::MENU_ID_STOP_RUNTIME,
            "Stop Runtime",
            false,
            None::<&str>,
        )
        .map_err(|error| error.to_string())?;
        let refresh_status = MenuItem::with_id(
            app,
            actions::MENU_ID_REFRESH_STATUS,
            "Refresh Status",
            true,
            None::<&str>,
        )
        .map_err(|error| error.to_string())?;
        let quit_item = MenuItem::with_id(
            app,
            actions::MENU_ID_QUIT_NIMI,
            "Quit Nimi",
            true,
            None::<&str>,
        )
        .map_err(|error| error.to_string())?;

        let separator_a = PredefinedMenuItem::separator(app).map_err(|error| error.to_string())?;
        let separator_b = PredefinedMenuItem::separator(app).map_err(|error| error.to_string())?;
        let separator_c = PredefinedMenuItem::separator(app).map_err(|error| error.to_string())?;
        let separator_d = PredefinedMenuItem::separator(app).map_err(|error| error.to_string())?;

        menu.append(&status_header)
            .map_err(|error| error.to_string())?;
        menu.append(&separator_a)
            .map_err(|error| error.to_string())?;
        menu.append(&open_nimi).map_err(|error| error.to_string())?;
        menu.append(&open_runtime)
            .map_err(|error| error.to_string())?;
        menu.append(&open_local)
            .map_err(|error| error.to_string())?;
        menu.append(&open_cloud)
            .map_err(|error| error.to_string())?;
        menu.append(&open_settings)
            .map_err(|error| error.to_string())?;
        menu.append(&separator_b)
            .map_err(|error| error.to_string())?;
        menu.append(&runtime_line)
            .map_err(|error| error.to_string())?;
        menu.append(&detail_line)
            .map_err(|error| error.to_string())?;
        menu.append(&providers_line)
            .map_err(|error| error.to_string())?;
        menu.append(&grpc_line).map_err(|error| error.to_string())?;
        menu.append(&pid_line).map_err(|error| error.to_string())?;
        menu.append(&managed_line)
            .map_err(|error| error.to_string())?;
        menu.append(&last_check_line)
            .map_err(|error| error.to_string())?;
        menu.append(&separator_c)
            .map_err(|error| error.to_string())?;
        menu.append(&start_runtime)
            .map_err(|error| error.to_string())?;
        menu.append(&restart_runtime)
            .map_err(|error| error.to_string())?;
        menu.append(&stop_runtime)
            .map_err(|error| error.to_string())?;
        menu.append(&refresh_status)
            .map_err(|error| error.to_string())?;
        menu.append(&separator_d)
            .map_err(|error| error.to_string())?;
        menu.append(&quit_item).map_err(|error| error.to_string())?;

        let icon = Image::from_bytes(MENU_BAR_TEMPLATE_ICON_BYTES)
            .ok()
            .or_else(|| app.default_window_icon().cloned());
        let mut builder = TrayIconBuilder::with_id(MENU_BAR_TRAY_ID)
            .menu(&menu)
            .show_menu_on_left_click(true)
            .tooltip("Nimi Desktop")
            .icon_as_template(true)
            .on_menu_event(|app, event| {
                let _ = actions::handle_menu_event(app, event.id().as_ref());
            });
        if let Some(image) = icon {
            builder = builder.icon(image);
        }
        let tray = builder.build(app).map_err(|error| error.to_string())?;
        let _ = tray.set_icon_as_template(true);

        let store = app.state::<MenuBarShellStore>();
        store.set_handles(MenuBarMenuHandles {
            status_header,
            runtime_line,
            detail_line,
            providers_line,
            grpc_line,
            pid_line,
            managed_line,
            last_check_line,
            start_runtime,
            restart_runtime,
            stop_runtime,
            refresh_status,
        });
        Ok(())
    }
}

pub fn apply_state(app: &AppHandle) {
    let store = app.state::<MenuBarShellStore>();
    store.with_handles(|handles, snapshot, renderer_stale, quit_pending| {
        let presentation = snapshot.presentation(renderer_stale, quit_pending);
        let _ = handles.status_header.set_text(presentation.status_header);
        let _ = handles.runtime_line.set_text(presentation.runtime_line);
        let _ = handles.detail_line.set_text(presentation.detail_line);
        let _ = handles.providers_line.set_text(presentation.providers_line);
        let _ = handles.grpc_line.set_text(presentation.grpc_line);
        let _ = handles.pid_line.set_text(presentation.pid_line);
        let _ = handles.managed_line.set_text(presentation.managed_line);
        let _ = handles
            .last_check_line
            .set_text(presentation.last_check_line);
        let _ = handles
            .start_runtime
            .set_enabled(presentation.start_enabled);
        let _ = handles
            .restart_runtime
            .set_enabled(presentation.restart_enabled);
        let _ = handles.stop_runtime.set_enabled(presentation.stop_enabled);
        let _ = handles
            .refresh_status
            .set_enabled(presentation.refresh_enabled);
    });
}
