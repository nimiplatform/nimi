use super::*;
use crate::{chat_ai_store, desktop_release, desktop_updates, local_runtime, menu_bar_shell};
use nimi_shell_tauri::{
    capabilities::data::{
        resolve_standard_app_storage_roots, StandardAppStorageRootSlot, StandardDataRootBinding,
    },
    capabilities::desktop_product_local_agent::desktop_shell_runtime_account_caller,
    capabilities::diagnostics::{
        build_renderer_entry_probe_script, RendererEntryProbeScriptConfig,
    },
    capabilities::local_agent::{set_standard_local_agent_host_hooks, StandardLocalAgentHostHooks},
    capabilities::local_assets::{
        set_standard_local_assets_host_hooks, StandardLocalAssetsHostHooks,
    },
    capabilities::runtime::{
        RuntimeBridgeHostHooks, RuntimeBridgeMetadata, RuntimeBridgeTrustedMetadata,
        RUNTIME_APP_GET_APP_STORAGE_METHOD_ID,
    },
    capabilities::shell_ui::{StandardConfirmDialogPayload, StandardShellUiHostHooks},
};
use std::sync::Arc;

fn install_shared_runtime_bridge_hooks() {
    let hooks = RuntimeBridgeHostHooks {
        status_override: {
            #[cfg(any(test, feature = "desktop-e2e-fixture"))]
            {
                Some(Arc::new(|| {
                    crate::desktop_e2e_fixture::runtime_bridge_status_override()
                }))
            }
            #[cfg(not(any(test, feature = "desktop-e2e-fixture")))]
            {
                None
            }
        },
        unary_override: {
            #[cfg(any(test, feature = "desktop-e2e-fixture"))]
            {
                Some(Arc::new(|payload| {
                    crate::desktop_e2e_fixture::runtime_bridge_unary_override(payload)
                }))
            }
            #[cfg(not(any(test, feature = "desktop-e2e-fixture")))]
            {
                None
            }
        },
        trusted_metadata: Some(Arc::new(|request| {
            Box::pin(async move {
                if request.method_id != RUNTIME_APP_GET_APP_STORAGE_METHOD_ID {
                    return Ok(None);
                }
                Ok(Some(RuntimeBridgeTrustedMetadata {
                    metadata: Some(RuntimeBridgeMetadata {
                        app_id: Some("nimi.desktop".to_string()),
                        participant_id: Some("nimi.desktop".to_string()),
                        caller_kind: Some("desktop-shell".to_string()),
                        caller_id: Some("nimi.desktop.shell".to_string()),
                        ..RuntimeBridgeMetadata::default()
                    }),
                    ..RuntimeBridgeTrustedMetadata::default()
                }))
            })
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
    };
    let _ = nimi_shell_tauri::capabilities::runtime::set_runtime_bridge_host_hooks(hooks);
}

/// Inject the desktop host adapters behind the standard shell-ui commands. Kit
/// registers `confirm_dialog` / `start_window_drag` / `focus_main_window`; the
/// behavior lives here so the desktop no longer forks the same command names.
fn install_standard_shell_ui_host_hooks() {
    use super::defaults_and_commands::window_and_logs;
    let hooks = StandardShellUiHostHooks {
        confirm_dialog: Some(Arc::new(|payload: &StandardConfirmDialogPayload| {
            window_and_logs::confirm_dialog_host_provider(super::ConfirmDialogPayload {
                title: payload.title.clone(),
                description: payload.description.clone(),
                level: payload.level.clone(),
            })
        })),
        focus_main_window: Some(Arc::new(|app| {
            window_and_logs::focus_main_window_host_provider(app)
        })),
        start_window_drag: Some(Arc::new(|window| {
            window_and_logs::start_window_drag_host_provider(window)
        })),
    };
    let _ = nimi_shell_tauri::capabilities::shell_ui::set_standard_shell_ui_host_hooks(hooks);
}

/// Admit Desktop-owned runtime local asset roots for the shared standard
/// `file-reveal.reveal` command. Renderer code still supplies only a concrete
/// target path; the Tauri host resolves the authoritative product data root.
fn install_standard_local_assets_host_hooks() {
    let hooks = StandardLocalAssetsHostHooks {
        local_asset_roots: Some(Arc::new(|| {
            let data_root = crate::desktop_paths::resolve_nimi_data_dir()?;
            Ok(vec![
                nimi_shell_tauri::capabilities::local_assets::runtime_models_dir(&data_root),
            ])
        })),
    };
    let _ = set_standard_local_assets_host_hooks(hooks);
}

/// Bind the Desktop shell as the host-derived Runtime account caller for
/// standard local-agent Runtime access. Desktop intentionally does not bind a
/// local-agent identity hook here; Electron keeps that surface unbound too, and
/// the renderer must not fabricate a local-agent ref.
pub(super) fn install_standard_local_agent_host_hooks() {
    let hooks = StandardLocalAgentHostHooks {
        identity: None,
        runtime_trusted_caller: Some(Arc::new(|| {
            desktop_shell_runtime_account_caller("nimi.desktop")
        })),
    };
    let _ = set_standard_local_agent_host_hooks(hooks);
}

/// Resolve and manage the standard app storage slot. Desktop's renderer does
/// not yet consume the standard storage commands, but the kit macro registers
/// them with `State<StandardAppStorageRootSlot>`, so the slot must be managed
/// for those commands to remain fail-closed instead of panicking on a missing
/// binding. Roots come from Runtime `GetAppStorage` for the desktop app id; if
/// resolution fails (e.g. Runtime not ready) the slot stays unbound and the
/// storage commands fail closed with `tauri-standard-storage-binding-missing`.
fn install_standard_app_storage_slot(app: &tauri::App<tauri::Wry>) {
    let slot = StandardAppStorageRootSlot::empty();
    match tauri::async_runtime::block_on(resolve_standard_app_storage_roots(
        StandardDataRootBinding::RuntimeGetAppStorage {
            app_id: "nimi.desktop".to_string(),
        },
    )) {
        Ok(roots) => {
            if let Err(error) = slot.bind(roots) {
                eprintln!(
                    "[boot:{:}] standard app storage slot bind failed: {}",
                    now_ms(),
                    error
                );
            }
        }
        Err(error) => {
            eprintln!(
                "[boot:{:}] standard app storage slot left unbound (fail-closed): {}",
                now_ms(),
                error
            );
        }
    }
    app.manage(slot);
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
        .on_page_load(|webview, payload| {
            let event = match payload.event() {
                tauri::webview::PageLoadEvent::Started => "started",
                tauri::webview::PageLoadEvent::Finished => "finished",
            };
            if matches!(payload.event(), tauri::webview::PageLoadEvent::Started) {
                set_desktop_open_intent_ready(webview.app_handle(), false);
            }
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
                // Production builds register the renderer-entry probe, but the probe must stay
                // side-effect-free unless `desktop_macos_smoke_context_get` reports an enabled
                // fixture. Any write/report path must route through fixture-gated smoke commands.
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
            install_standard_shell_ui_host_hooks();
            install_standard_local_assets_host_hooks();
            install_standard_local_agent_host_hooks();
            install_standard_app_storage_slot(app);
            match crate::desktop_open_intent::start_desktop_open_intent_bridge(app.handle().clone())
            {
                Ok(runtime) => {
                    eprintln!("[boot:{:}] desktop open intent bridge initialized", now_ms());
                    app.manage(runtime);
                }
                Err(error) => {
                    eprintln!(
                        "[boot:{:}] desktop open intent bridge disabled fail-closed: {}",
                        now_ms(),
                        error
                    );
                }
            }
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
                        if !crate::menu_bar_shell::is_enabled() {
                            return;
                        }
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
            if crate::menu_bar_shell::is_enabled() {
                let _ = crate::menu_bar_shell::setup(app.handle());
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
            crate::desktop_open_intent::desktop_open_intent_set_ready,
            crate::desktop_product_control::product_control_record_get,
            crate::desktop_product_control::product_control_selected_data_root_get,
            crate::desktop_product_control::product_control_record_ensure_created,
            crate::desktop_product_control::product_control_record_select_data_root,
            crate::desktop_product_control::product_control_record_complete_first_run_device_environment_scan,
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
            super::defaults_and_commands::system_resources::get_system_resource_snapshot,
            super::defaults_and_commands::http_request,
            super::defaults_and_commands::window_and_logs::desktop_avatar_launch_handoff,
            super::defaults_and_commands::window_and_logs::desktop_avatar_close_handoff,
            crate::desktop_avatar_instance_registry::commands::desktop_avatar_instance_registry_list,
            super::defaults_and_commands::macos_smoke::desktop_macos_smoke_context_get,
            super::defaults_and_commands::macos_smoke::desktop_macos_smoke_report_write,
            super::defaults_and_commands::macos_smoke::desktop_macos_smoke_ping,
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
            local_runtime::commands::runtime_local_pick_asset_manifest_path,
        ])
        .build(tauri::generate_context!())
}

fn set_desktop_open_intent_ready(app_handle: &tauri::AppHandle, ready: bool) {
    if let Some(runtime) =
        app_handle.try_state::<crate::desktop_open_intent::DesktopOpenIntentRuntime>()
    {
        runtime.set_ready(ready);
    }
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
            app.run(|app_handle, event| match event {
                tauri::RunEvent::WindowEvent { label, event, .. } => {
                    if label == "main" && matches!(event, tauri::WindowEvent::Destroyed) {
                        set_desktop_open_intent_ready(app_handle, false);
                    }
                }
                tauri::RunEvent::ExitRequested { api, .. } => {
                    set_desktop_open_intent_ready(app_handle, false);
                    if let Some(runtime) = app_handle
                        .try_state::<crate::desktop_open_intent::DesktopOpenIntentRuntime>(
                    ) {
                        runtime.shutdown();
                    }
                    if !crate::menu_bar_shell::is_enabled() {
                        return;
                    }
                    let store = app_handle.state::<crate::menu_bar_shell::MenuBarShellStore>();
                    if !store.quit_pending() {
                        api.prevent_exit();
                        let _ = crate::menu_bar_shell::request_quit(app_handle);
                    }
                }
                _ => {}
            });
            eprintln!("[boot:{:}] tauri run completed", now_ms());
        }
        Err(error) => {
            eprintln!("[boot:{:}] tauri run failed: {error}", now_ms());
            panic!("error while running tauri application: {error}");
        }
    }
}
