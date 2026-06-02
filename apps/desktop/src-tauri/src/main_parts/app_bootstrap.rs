use super::*;
use crate::{
    chat_ai_store, desktop_agent_center_store, desktop_release, desktop_updates, local_runtime,
    menu_bar_shell,
};
use nimi_shell_tauri::{
    renderer_entry_probe::{build_renderer_entry_probe_script, RendererEntryProbeScriptConfig},
    runtime_bridge::RuntimeBridgeHostHooks,
};
use std::sync::Arc;

fn install_shared_runtime_bridge_hooks() {
    let _ =
        nimi_shell_tauri::runtime_bridge::set_runtime_bridge_host_hooks(RuntimeBridgeHostHooks {
            status_override: Some(Arc::new(|| {
                crate::desktop_e2e_fixture::runtime_bridge_status_override()
            })),
            unary_override: Some(Arc::new(|payload| {
                crate::desktop_e2e_fixture::runtime_bridge_unary_override(payload)
            })),
            sync_daemon_status: Some(Arc::new(|app, status| {
                crate::menu_bar_shell::sync_daemon_status(app, status);
            })),
            set_action_in_flight: Some(Arc::new(|app, action| {
                crate::menu_bar_shell::set_action_in_flight(app, action);
            })),
            staged_runtime_binary_path: Some(Arc::new(|| {
                crate::desktop_release::staged_runtime_binary_path()
            })),
            runtime_last_error: Some(Arc::new(|| crate::desktop_release::runtime_last_error())),
            current_release_version: Some(Arc::new(|| {
                crate::desktop_release::current_release_version()
            })),
            resolve_nimi_dir: Some(Arc::new(crate::desktop_paths::resolve_nimi_dir)),
            resolve_nimi_data_dir: Some(Arc::new(crate::desktop_paths::resolve_nimi_data_dir)),
        });
}

fn build_desktop_app() -> Result<tauri::App<tauri::Wry>, tauri::Error> {
    let updater_pubkey = crate::desktop_updates::configured_updater_pubkey();
    let updater_plugin = if let Some(pubkey) = updater_pubkey {
        tauri_plugin_updater::Builder::new().pubkey(pubkey).build()
    } else {
        tauri_plugin_updater::Builder::new().build()
    };
    tauri::Builder::default()
        .plugin(updater_plugin)
        .plugin(tauri_plugin_deep_link::init())
        .on_page_load(|webview, payload| {
            let event = match payload.event() {
                tauri::webview::PageLoadEvent::Started => "started",
                tauri::webview::PageLoadEvent::Finished => "finished",
            };
            let details = json!({
                "event": event,
                "url": payload.url().to_string(),
                "label": webview.label(),
            });
            let _ = super::defaults_and_commands::macos_smoke::append_macos_smoke_backend_stage(
                "window-page-load",
                Some(&details),
            );
            if matches!(payload.event(), tauri::webview::PageLoadEvent::Finished) {
                let probe_script =
                    match build_renderer_entry_probe_script(&RendererEntryProbeScriptConfig {
                        started_flag: "__NIMI_MACOS_SMOKE_EVAL_STARTED__".to_string(),
                        ping_command: "desktop_macos_smoke_ping".to_string(),
                        report_command: "desktop_macos_smoke_report_write".to_string(),
                        context_command: "desktop_macos_smoke_context_get".to_string(),
                        reset_local_storage_scenario_ids: vec![
                            "boot.anonymous.login-screen".to_string(),
                        ],
                    }) {
                        Ok(script) => script,
                        Err(error) => {
                            let _ = super::defaults_and_commands::macos_smoke::append_macos_smoke_backend_stage(
                                "window-page-error",
                                Some(&json!({
                                    "reason": "eval-probe-build-failed",
                                    "message": error,
                                    "url": payload.url().to_string(),
                                    "label": webview.label(),
                                })),
                            );
                            return;
                        }
                    };
                if let Err(error) = webview.eval(probe_script.as_str()) {
                    let _ =
                        super::defaults_and_commands::macos_smoke::append_macos_smoke_backend_stage(
                            "window-page-error",
                            Some(&json!({
                                "reason": "eval-dispatch-failed",
                                "message": error.to_string(),
                                "url": payload.url().to_string(),
                                "label": webview.label(),
                            })),
                        );
                }
            }
        })
        .setup(|app| {
            eprintln!("[boot:{:}] setup entered", now_ms());
            install_shared_runtime_bridge_hooks();
            app.manage(crate::menu_bar_shell::MenuBarShellStore::new());
            match crate::desktop_release::initialize(app.handle()) {
                Ok(info) => {
                    eprintln!(
                        "[boot:{:}] desktop release initialized version={} runtime={} ready={}",
                        now_ms(),
                        info.desktop_version,
                        info.runtime_version,
                        info.runtime_ready,
                    );
                }
                Err(error) => {
                    crate::desktop_release::record_initialize_error(error.clone());
                    eprintln!(
                        "[boot:{:}] desktop release initialization failed: {}",
                        now_ms(),
                        error
                    );
                }
            }
            #[cfg(target_os = "macos")]
            let configured_traffic_light_position = app
                .config()
                .app
                .windows
                .iter()
                .find(|entry| entry.label == "main")
                .and_then(|window_config| {
                    window_config
                        .traffic_light_position
                        .as_ref()
                        .map(|position| (position.x, position.y))
                });
            if let Some(window) = app.get_webview_window("main") {
                eprintln!("[boot:{:}] setup found main window", now_ms());
                #[cfg(target_os = "macos")]
                {
                    let app_handle_for_close = app.handle().clone();
                    let window_for_close = window.clone();
                    window.on_window_event(move |event| {
                        match event {
                            tauri::WindowEvent::CloseRequested { api, .. } => {
                                api.prevent_close();
                                let _ = window_for_close.hide();
                                crate::menu_bar_shell::set_window_visible(
                                    &app_handle_for_close,
                                    false,
                                );
                            }
                            tauri::WindowEvent::Focused(true) => {
                                crate::menu_bar_shell::set_window_visible(
                                    &app_handle_for_close,
                                    true,
                                );
                            }
                            _ => {}
                        }
                    });
                }
                #[cfg(target_os = "macos")]
                {
                    let _ = window.set_title("");
                    if let Some((x, y)) = configured_traffic_light_position {
                        if let Err(error) = apply_macos_traffic_light_position(&window, x, y) {
                            eprintln!(
                                "[boot:{:}] failed to apply native traffic light position: {}",
                                now_ms(),
                                error
                            );
                        }
                        let window_for_relayout = window.clone();
                        window.on_window_event(move |event| {
                            if matches!(
                                event,
                                tauri::WindowEvent::Resized(_)
                                    | tauri::WindowEvent::ScaleFactorChanged { .. }
                            ) {
                                let window_for_apply = window_for_relayout.clone();
                                let _ = window_for_relayout.run_on_main_thread(move || {
                                    if let Err(error) =
                                        apply_macos_traffic_light_position(&window_for_apply, x, y)
                                    {
                                        eprintln!(
                                            "[boot:{:}] failed to re-apply traffic light position: {}",
                                            now_ms(),
                                            error
                                        );
                                    }
                                });
                            }
                        });
                        schedule_macos_traffic_light_reapply(window.clone(), x, y);
                    }
                }
                #[cfg(debug_assertions)]
                {
                    let debug_boot_enabled = debug_boot_enabled();
                    eprintln!(
                        "[boot:{:}] setup debug_boot_enabled={}",
                        now_ms(),
                        debug_boot_enabled
                    );
                    if debug_boot_enabled {
                        window.open_devtools();
                        window.set_focus().ok();
                        eprintln!("[boot:{:}] devtools opened by NIMI_DEBUG_BOOT", now_ms());
                    }
                }
            }
            let _ = crate::menu_bar_shell::setup(app.handle());

            // RL-INTOP-004 — Deep-link URL scheme handler (nimi-desktop://runtime-config/{pageId})
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                #[cfg(desktop)]
                {
                    let _ = app.deep_link().register("nimi-desktop");
                }
                let app_handle_for_deep_link = app.handle().clone();
                app.deep_link().on_open_url(move |event| {
                    for url in event.urls() {
                        handle_deep_link_url(&app_handle_for_deep_link, url.as_str());
                    }
                });
            }

            Ok(())
        })
        .invoke_handler(nimi_shell_tauri::nimi_shell_tauri_auth_oauth_runtime_bridge_handler![
            @with_runtime_defaults super::defaults_and_commands::runtime_defaults;
            desktop_release::desktop_release_info_get,
            desktop_updates::desktop_update_state_get,
            desktop_updates::desktop_update_check,
            desktop_updates::desktop_update_download,
            desktop_updates::desktop_update_install,
            desktop_updates::desktop_update_restart,
            crate::desktop_product_control::product_control_record_get,
            crate::desktop_product_control::product_control_selected_data_root_get,
            crate::desktop_product_control::product_control_record_ensure_created,
            crate::desktop_product_control::product_control_record_select_data_root,
            crate::desktop_product_control::product_control_record_complete_first_run_device_environment_scan,
            crate::desktop_product_control::product_control_pick_data_root_directory,
            crate::desktop_product_control::product_control_default_data_root_directory,
            crate::desktop_product_control::product_control_record_set_first_run_install_level,
            crate::desktop_product_control::product_control_record_ensure_account_default_profile,
            crate::desktop_product_control::product_control_record_prepare_first_run_local_ai_ready,
            crate::desktop_product_control::product_control_record_reconcile_first_run_setup_state,
            crate::desktop_product_control::account_default_profile_for_scope_init,
            crate::desktop_product_control::built_in_ai_config_for_scope_init,
            crate::account_profile_library_commands::account_profile_library_list,
            crate::account_profile_library_commands::account_profile_library_create,
            crate::account_profile_library_commands::account_profile_library_edit,
            crate::account_profile_library_commands::account_profile_library_import,
            crate::account_profile_library_commands::account_profile_library_export,
            crate::account_profile_library_commands::account_profile_library_delete,
            crate::desktop_product_control_admission::product_control_record_admit_ready_for_use,
            crate::nimi_data_directory::nimi_data_cleanup_plan,
            crate::nimi_data_directory::nimi_data_cleanup_execute,
            crate::desktop_logs_export::desktop_logs_export,
            crate::apps_bridge_projection::apps_bridge_projection_get,
            crate::account_apps_library_commands::account_app_library_get,
            super::defaults_and_commands::system_resources::get_system_resource_snapshot,
            super::defaults_and_commands::http_request,
            super::defaults_and_commands::window_and_logs::desktop_avatar_launch_handoff,
            super::defaults_and_commands::window_and_logs::desktop_avatar_close_handoff,
            crate::desktop_avatar_instance_registry::commands::desktop_avatar_instance_registry_list,
            super::defaults_and_commands::macos_smoke::desktop_macos_smoke_context_get,
            super::defaults_and_commands::macos_smoke::desktop_macos_smoke_avatar_evidence_read,
            super::defaults_and_commands::macos_smoke::desktop_macos_smoke_avatar_product_local_asset_fault_apply,
            super::defaults_and_commands::macos_smoke::desktop_macos_smoke_report_write,
            super::defaults_and_commands::macos_smoke::desktop_macos_smoke_ping,
            super::defaults_and_commands::window_and_logs::confirm_dialog,
            super::defaults_and_commands::window_and_logs::confirm_private_sync,
            super::defaults_and_commands::window_and_logs::focus_main_window,
            super::defaults_and_commands::window_and_logs::start_window_drag,
            menu_bar_shell::menu_bar_sync_runtime_health,
            menu_bar_shell::menu_bar_complete_quit,
            chat_ai_store::chat_ai_list_threads,
            chat_ai_store::chat_ai_get_thread_bundle,
            chat_ai_store::chat_ai_create_thread,
            chat_ai_store::chat_ai_update_thread_metadata,
            chat_ai_store::chat_ai_create_message,
            chat_ai_store::chat_ai_update_message,
            chat_ai_store::chat_ai_get_draft,
            chat_ai_store::chat_ai_put_draft,
            chat_ai_store::chat_ai_delete_draft,
            desktop_agent_center_store::desktop_agent_center_account_local_resources_remove,
            desktop_agent_center_store::desktop_agent_center_agent_local_resources_remove,
            desktop_agent_center_store::desktop_agent_center_avatar_asset_import,
            desktop_agent_center_store::desktop_agent_center_avatar_asset_list,
            desktop_agent_center_store::desktop_agent_center_avatar_asset_pick_live2d_source,
            desktop_agent_center_store::desktop_agent_center_avatar_asset_pick_vrm_source,
            desktop_agent_center_store::desktop_agent_center_avatar_asset_remove,
            desktop_agent_center_store::desktop_agent_center_avatar_asset_select,
            desktop_agent_center_store::desktop_agent_center_avatar_asset_validate,
            desktop_agent_center_store::desktop_agent_center_live2d_adapter_manifest_import,
            desktop_agent_center_store::desktop_agent_center_live2d_adapter_manifest_pick_source,
            desktop_agent_center_store::desktop_agent_center_background_asset_get,
            desktop_agent_center_store::desktop_agent_center_background_import,
            desktop_agent_center_store::desktop_agent_center_background_pick_source,
            desktop_agent_center_store::desktop_agent_center_background_remove,
            desktop_agent_center_store::desktop_agent_center_background_validate,
            desktop_agent_center_store::desktop_agent_center_config_get,
            desktop_agent_center_store::desktop_agent_center_config_put,
            local_runtime::commands::runtime_local_pick_asset_manifest_path,
            local_runtime::commands::runtime_local_pick_asset_file,
            local_runtime::commands::runtime_local_pick_asset_directory,
            local_runtime::commands::runtime_local_assets_reveal_in_folder,
            local_runtime::commands::runtime_local_assets_reveal_root_folder,
        ])
        .build(tauri::generate_context!())
}

/// RL-INTOP-004 — Parse deep-link URL and emit navigation event to webview.
/// URL format: nimi-desktop://runtime-config/{pageId}
pub(super) fn normalize_runtime_config_page_id(page_id: Option<&str>) -> Option<&'static str> {
    match page_id.unwrap_or("overview") {
        "" | "overview" => Some("overview"),
        "recommend" => Some("recommend"),
        "local" => Some("local"),
        "cloud" => Some("cloud"),
        "catalog" => Some("catalog"),
        "runtime" => Some("runtime"),
        "data-management" => Some("data-management"),
        "performance" => Some("performance"),
        _ => None,
    }
}

fn handle_deep_link_url(app: &tauri::AppHandle, raw_url: &str) {
    use tauri::Emitter;
    eprintln!("[deep-link] received url: {}", raw_url);
    let parsed = match url::Url::parse(raw_url) {
        Ok(u) => u,
        Err(_) => return,
    };
    if parsed.scheme() != "nimi-desktop" {
        return;
    }
    let host = parsed.host_str().unwrap_or("");
    if host != "runtime-config" {
        return;
    }
    let Some(page_id) =
        normalize_runtime_config_page_id(parsed.path_segments().and_then(|mut s| s.next()))
    else {
        return;
    };

    #[derive(Clone, serde::Serialize)]
    #[serde(rename_all = "camelCase")]
    struct DeepLinkOpenTabPayload {
        tab: String,
        page: Option<String>,
    }

    // Focus + show window first
    let _ = crate::menu_bar_shell::window::focus_main_window(app);
    crate::menu_bar_shell::set_window_visible(app, true);

    // Emit same event shape as menu-bar://open-tab so the existing listener handles it
    let _ = app.emit(
        crate::menu_bar_shell::MENU_BAR_OPEN_TAB_EVENT,
        DeepLinkOpenTabPayload {
            tab: "runtime".to_string(),
            page: Some(page_id.to_string()),
        },
    );
}

pub(crate) fn run() {
    install_panic_hook();
    eprintln!(
        "[boot:{:}] desktop process start pid={}",
        now_ms(),
        std::process::id()
    );
    log_boot_marker("main() entered");
    load_dotenv_files();
    log_boot_marker("dotenv files loaded");

    let result = build_desktop_app();

    match result {
        Ok(app) => {
            app.run(|app_handle, event| {
                if let tauri::RunEvent::ExitRequested { api, .. } = event {
                    let store = app_handle.state::<crate::menu_bar_shell::MenuBarShellStore>();
                    if !store.quit_pending() {
                        api.prevent_exit();
                        let _ = crate::menu_bar_shell::request_quit(app_handle);
                    }
                }
            });
            eprintln!("[boot:{:}] tauri run completed", now_ms());
        }
        Err(error) => {
            eprintln!("[boot:{:}] tauri run failed: {error}", now_ms());
            panic!("error while running tauri application: {error}");
        }
    }
}
