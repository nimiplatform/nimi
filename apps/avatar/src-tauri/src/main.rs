#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod avatar_asset_commands;
mod avatar_instance_projection;
mod avatar_instance_registry;
mod avatar_launch_context;
mod avatar_paths;
mod avatar_visual_commands;
mod avatar_window;
mod avatar_window_commands;
use avatar_asset_commands::nimi_avatar_resolve_agent_center_avatar_asset;
use avatar_instance_projection::{persist_projection, projection_record_from_registry_entry};
use avatar_instance_registry::AvatarInstanceRegistry;
use avatar_launch_context::{
    parse_avatar_deep_link_request, resolve_initial_avatar_request, AvatarCloseRequest,
    AvatarDeepLinkRequest, AvatarLaunchContext, AvatarRendererLaunchContext, AVATAR_LAUNCH_SCHEME,
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
use avatar_window::*;
use avatar_window_commands::*;
#[cfg(test)]
use nimi_shell_tauri::capabilities::avatar::AgentCenterAvatarAssetResolvePayload;
use nimi_shell_tauri::capabilities::data::StandardAppStorageRootSlot;
use nimi_shell_tauri::capabilities::runtime as runtime_bridge;
#[cfg(test)]
use sha2::{Digest, Sha256};
use std::sync::Arc;
use tauri::Manager;
#[cfg(test)]
use tauri::PhysicalPosition;
#[cfg(test)]
pub(crate) fn test_env_guard() -> std::sync::MutexGuard<'static, ()> {
    let _ = runtime_bridge::set_runtime_bridge_host_hooks(runtime_bridge::RuntimeBridgeHostHooks {
        resolve_nimi_data_dir: Some(Arc::new(crate::avatar_paths::resolve_avatar_nimi_data_dir)),
        ..Default::default()
    });
    static GUARD: std::sync::OnceLock<std::sync::Mutex<()>> = std::sync::OnceLock::new();
    GUARD
        .get_or_init(|| std::sync::Mutex::new(()))
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}
fn configure_runtime_bridge_env() {
    if cfg!(debug_assertions) && std::env::var_os("NIMI_RUNTIME_BRIDGE_MODE").is_none() {
        std::env::set_var("NIMI_RUNTIME_BRIDGE_MODE", "RUNTIME");
    }
}

fn configure_runtime_bridge_host_hooks() {
    let hooks = runtime_bridge::RuntimeBridgeHostHooks {
        resolve_nimi_data_dir: Some(Arc::new(crate::avatar_paths::resolve_avatar_nimi_data_dir)),
        ..Default::default()
    };
    let _ = runtime_bridge::set_runtime_bridge_host_hooks(hooks);
}

fn main() {
    let _ = dotenvy::dotenv();
    configure_runtime_bridge_env();
    configure_runtime_bridge_host_hooks();
    let initial_avatar_request = resolve_initial_avatar_request();

    tauri::Builder::default()
        .manage(AvatarInstanceRegistry::new())
        .manage(NasWatcherRegistry::default())
        // The shared kit runtime-bridge macro registers standard storage/file
        // commands. Avatar does not bind app storage roots today, so keep the
        // slot intentionally empty: those commands fail closed with the
        // standard binding-missing envelope instead of missing Tauri state.
        .manage(StandardAppStorageRootSlot::empty())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .on_page_load(|webview, payload| {
            if matches!(payload.event(), tauri::webview::PageLoadEvent::Finished)
                && is_avatar_window_label(webview.label())
            {
                emit_avatar_shell_ready_for_webview(webview);
            }
        })
        .invoke_handler(nimi_shell_tauri::nimi_shell_tauri_runtime_bridge_handler![
            // Kit standard floating-window commands (window control primitive).
            // These act on the invoking WebviewWindow and replace the retired
            // avatar-local window commands. Passed as extra app commands into
            // the runtime-bridge handler so Avatar keeps its single
            // generate_handler with runtime bridge + floating-window +
            // avatar product commands.
            nimi_shell_tauri::standard_floating_window::floating_window_set_bounds,
            nimi_shell_tauri::standard_floating_window::floating_window_set_ignore_cursor_events,
            nimi_shell_tauri::standard_floating_window::floating_window_set_always_on_top,
            nimi_shell_tauri::standard_floating_window::floating_window_hide,
            nimi_shell_tauri::standard_floating_window::floating_window_close,
            nimi_shell_tauri::standard_floating_window::floating_window_begin_manual_drag,
            nimi_shell_tauri::standard_floating_window::floating_window_move_manual_drag,
            nimi_shell_tauri::standard_floating_window::floating_window_constrain_to_visible_area,
            // Avatar app-owned cursor hit-testing (tightly coupled to the
            // alpha-mask click-through decision; not a kit floating-window
            // primitive).
            nimi_avatar_get_cursor_client_position,
            nimi_avatar_get_launch_context,
            nimi_avatar_resolve_model,
            nimi_avatar_resolve_agent_center_avatar_asset,
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
