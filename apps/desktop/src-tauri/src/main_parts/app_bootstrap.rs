use super::*;
use crate::{
    chat_agent_store, chat_ai_store, desktop_agent_backdrop_store, desktop_release,
    desktop_updates, external_agent_gateway, local_runtime, menu_bar_shell, runtime_bridge,
    runtime_mod,
};
use nimi_kit_shell_tauri::runtime_bridge::RuntimeBridgeHostHooks;
use std::sync::Arc;

fn install_shared_runtime_bridge_hooks() {
    let _ = nimi_kit_shell_tauri::runtime_bridge::set_runtime_bridge_host_hooks(
        RuntimeBridgeHostHooks {
            status_override: Some(Arc::new(|| {
                crate::desktop_e2e_fixture::runtime_bridge_status_override()
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
        },
    );
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
                let probe_script = r#"
(() => {
  try {
    const globalRecord = globalThis;
    if (globalRecord.__NIMI_MACOS_SMOKE_EVAL_STARTED__) {
      return;
    }
    globalRecord.__NIMI_MACOS_SMOKE_EVAL_STARTED__ = true;
    const invoke =
      globalRecord.__TAURI__?.core?.invoke
      || globalRecord.__TAURI_INTERNALS__?.invoke
      || globalRecord.__TAURI_IPC__?.invoke
      || globalRecord.window?.__TAURI__?.core?.invoke
      || globalRecord.window?.__TAURI_INTERNALS__?.invoke
      || globalRecord.window?.__TAURI_IPC__?.invoke;
    const invokeSafe = (command, payload) => {
      if (typeof invoke !== 'function') {
        return Promise.resolve(undefined);
      }
      return Promise.resolve(invoke(command, payload)).catch(() => undefined);
    };
    const scriptSrc =
      globalRecord.document?.querySelector('script[type="module"]')?.src || '';
    const details = {
      href: globalRecord.location?.href || '',
      readyState: globalRecord.document?.readyState || '',
      hasRoot: Boolean(globalRecord.document?.getElementById('root')),
      hasInvoke: typeof invoke === 'function',
      scriptSrc,
    };
    if (typeof invoke === 'function') {
      void invokeSafe('desktop_macos_smoke_ping', {
        payload: {
          stage: 'window-eval-probe',
          details,
        },
      });
      if (!scriptSrc) {
        void invokeSafe('desktop_macos_smoke_report_write', {
          payload: {
            ok: false,
            failedStep: 'renderer-module-script-missing',
            steps: ['window-eval-probe'],
            errorMessage: 'main module script src is missing',
            route: globalRecord.location?.href || '',
            htmlSnapshot: globalRecord.document?.documentElement?.outerHTML || '',
          },
        });
        return;
      }
      void import(scriptSrc)
        .then(() => invokeSafe('desktop_macos_smoke_ping', {
          payload: {
            stage: 'window-dynamic-import-ok',
            details: {
              scriptSrc,
            },
          },
        }))
        .catch((error) => invokeSafe('desktop_macos_smoke_report_write', {
          payload: {
            ok: false,
            failedStep: 'renderer-module-import-failed',
            steps: ['window-eval-probe', 'renderer-module-import'],
            errorName: error?.name || '',
            errorMessage: error?.message || String(error || 'dynamic import failed'),
            errorStack: error?.stack || '',
            errorCause: error?.cause ? String(error.cause) : '',
            route: globalRecord.location?.href || '',
            htmlSnapshot: globalRecord.document?.documentElement?.outerHTML || '',
          },
        }));
    }
  } catch (_) {
    // no-op
  }
})();
"#;
                if let Err(error) = webview.eval(probe_script) {
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
            let gateway_state =
                external_agent_gateway::ExternalAgentGatewayState::new(app.handle().clone());
            external_agent_gateway::start_external_agent_gateway(gateway_state.clone());
            app.manage(gateway_state);
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
            let _ = crate::runtime_mod::store::sync_runtime_mod_source_watchers(app.handle());

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
        .invoke_handler(tauri::generate_handler![
            super::defaults_and_commands::runtime_defaults,
            crate::auth_session_commands::auth_session_load,
            crate::auth_session_commands::auth_session_save,
            crate::auth_session_commands::auth_session_clear,
            desktop_release::desktop_release_info_get,
            desktop_updates::desktop_update_state_get,
            desktop_updates::desktop_update_check,
            desktop_updates::desktop_update_download,
            desktop_updates::desktop_update_install,
            desktop_updates::desktop_update_restart,
            super::defaults_and_commands::system_resources::get_system_resource_snapshot,
            super::defaults_and_commands::http_request,
            super::defaults_and_commands::open_external_url,
            super::defaults_and_commands::window_and_logs::desktop_avatar_launch_handoff,
            super::defaults_and_commands::window_and_logs::desktop_avatar_close_handoff,
            crate::desktop_avatar_instance_registry::commands::desktop_avatar_instance_registry_list,
            super::defaults_and_commands::oauth_token_exchange,
            super::defaults_and_commands::oauth_listen_for_code,
            super::defaults_and_commands::runtime_agent_memory::agent_memory_bind_standard,
            super::defaults_and_commands::runtime_memory_embedding::memory_embedding_runtime_inspect,
            super::defaults_and_commands::runtime_memory_embedding::memory_embedding_runtime_request_bind,
            super::defaults_and_commands::runtime_memory_embedding::memory_embedding_runtime_request_cutover,
            super::defaults_and_commands::macos_smoke::desktop_macos_smoke_context_get,
            super::defaults_and_commands::macos_smoke::desktop_macos_smoke_avatar_evidence_read,
            super::defaults_and_commands::macos_smoke::desktop_macos_smoke_report_write,
            super::defaults_and_commands::macos_smoke::desktop_macos_smoke_ping,
            super::defaults_and_commands::window_and_logs::confirm_dialog,
            super::defaults_and_commands::window_and_logs::confirm_private_sync,
            super::defaults_and_commands::window_and_logs::log_renderer_event,
            super::defaults_and_commands::window_and_logs::focus_main_window,
            super::defaults_and_commands::window_and_logs::start_window_drag,
            menu_bar_shell::menu_bar_sync_runtime_health,
            menu_bar_shell::menu_bar_complete_quit,
            runtime_mod::commands::runtime_mod_append_audit,
            runtime_mod::commands::runtime_mod_query_audit,
            runtime_mod::commands::runtime_mod_delete_audit,
            runtime_mod::commands::runtime_mod_list_local_manifests,
            runtime_mod::commands::runtime_mod_read_local_entry,
            runtime_mod::commands::runtime_mod_read_local_asset,
            runtime_mod::commands::runtime_mod_list_installed,
            runtime_mod::commands::runtime_mod_sources_list,
            runtime_mod::commands::runtime_mod_sources_upsert,
            runtime_mod::commands::runtime_mod_sources_remove,
            runtime_mod::commands::runtime_mod_dev_mode_get,
            runtime_mod::commands::runtime_mod_dev_mode_set,
            runtime_mod::commands::runtime_mod_storage_dirs_get,
            runtime_mod::commands::runtime_mod_data_dir_set,
            runtime_mod::commands::runtime_mod_diagnostics_list,
            runtime_mod::commands::runtime_mod_reload,
            runtime_mod::commands::runtime_mod_reload_all,
            runtime_mod::commands::runtime_mod_open_dir,
            runtime_mod::commands::runtime_mod_install,
            runtime_mod::commands::runtime_mod_update,
            runtime_mod::commands::runtime_mod_uninstall,
            runtime_mod::commands::runtime_mod_storage_file_read,
            runtime_mod::commands::runtime_mod_storage_file_write,
            runtime_mod::commands::runtime_mod_storage_file_delete,
            runtime_mod::commands::runtime_mod_storage_file_list,
            runtime_mod::commands::runtime_mod_storage_file_stat,
            runtime_mod::commands::runtime_mod_storage_sqlite_query,
            runtime_mod::commands::runtime_mod_storage_sqlite_execute,
            runtime_mod::commands::runtime_mod_storage_sqlite_transaction,
            runtime_mod::commands::runtime_mod_storage_data_purge,
            runtime_mod::commands::runtime_mod_read_manifest,
            runtime_mod::commands::runtime_mod_catalog_list,
            runtime_mod::commands::runtime_mod_catalog_get,
            runtime_mod::commands::runtime_mod_catalog_updates_check,
            runtime_mod::commands::runtime_mod_catalog_install,
            runtime_mod::commands::runtime_mod_catalog_update,
            runtime_mod::commands::runtime_mod_install_progress,
            runtime_mod::commands::runtime_mod_restore_backup,
            runtime_mod::commands::runtime_mod_get_action_idempotency,
            runtime_mod::commands::runtime_mod_put_action_idempotency,
            runtime_mod::commands::runtime_mod_purge_action_idempotency,
            runtime_mod::commands::runtime_mod_get_action_verify_ticket,
            runtime_mod::commands::runtime_mod_put_action_verify_ticket,
            runtime_mod::commands::runtime_mod_delete_action_verify_ticket,
            runtime_mod::commands::runtime_mod_purge_action_verify_tickets,
            runtime_mod::commands::runtime_mod_put_action_execution_ledger,
            runtime_mod::commands::runtime_mod_query_action_execution_ledger,
            runtime_mod::commands::runtime_mod_purge_action_execution_ledger,
            runtime_mod::commands::runtime_mod_media_cache_put,
            runtime_mod::commands::runtime_mod_media_cache_gc,
            chat_ai_store::chat_ai_list_threads,
            chat_ai_store::chat_ai_get_thread_bundle,
            chat_ai_store::chat_ai_create_thread,
            chat_ai_store::chat_ai_update_thread_metadata,
            chat_ai_store::chat_ai_create_message,
            chat_ai_store::chat_ai_update_message,
            chat_ai_store::chat_ai_get_draft,
            chat_ai_store::chat_ai_put_draft,
            chat_ai_store::chat_ai_delete_draft,
            chat_agent_store::chat_agent_list_threads,
            chat_agent_store::chat_agent_get_thread_bundle,
            chat_agent_store::chat_agent_create_thread,
            chat_agent_store::chat_agent_update_thread_metadata,
            chat_agent_store::chat_agent_create_message,
            chat_agent_store::chat_agent_update_message,
            chat_agent_store::chat_agent_update_turn_beat,
            chat_agent_store::chat_agent_get_draft,
            chat_agent_store::chat_agent_put_draft,
            chat_agent_store::chat_agent_delete_draft,
            chat_agent_store::chat_agent_delete_thread,
            chat_agent_store::chat_agent_delete_message,
            chat_agent_store::chat_agent_load_turn_context,
            chat_agent_store::chat_agent_commit_turn_result,
            chat_agent_store::chat_agent_cancel_turn,
            chat_agent_store::chat_agent_rebuild_projection,
            desktop_agent_backdrop_store::desktop_agent_backdrop_pick_image,
            desktop_agent_backdrop_store::desktop_agent_backdrop_get_binding,
            desktop_agent_backdrop_store::desktop_agent_backdrop_import,
            desktop_agent_backdrop_store::desktop_agent_backdrop_clear,
            external_agent_gateway::external_agent_issue_token,
            external_agent_gateway::external_agent_revoke_token,
            external_agent_gateway::external_agent_list_tokens,
            external_agent_gateway::external_agent_verify_execution_context,
            external_agent_gateway::external_agent_sync_action_descriptors,
            external_agent_gateway::external_agent_complete_execution,
            external_agent_gateway::external_agent_gateway_status,
            runtime_bridge::runtime_bridge_unary,
            runtime_bridge::runtime_bridge_stream_open,
            runtime_bridge::runtime_bridge_stream_close,
            runtime_bridge::runtime_bridge_status,
            runtime_bridge::runtime_bridge_start,
            runtime_bridge::runtime_bridge_stop,
            runtime_bridge::runtime_bridge_restart,
            runtime_bridge::runtime_bridge_config_get,
            runtime_bridge::runtime_bridge_config_set,
            local_runtime::commands::runtime_local_audits_list,
            local_runtime::commands::runtime_local_pick_asset_manifest_path,
            local_runtime::commands::runtime_local_pick_asset_file,
            local_runtime::commands::runtime_local_pick_asset_directory,
            local_runtime::commands::runtime_local_models_catalog_search,
            local_runtime::commands::runtime_local_recommendation_feed_get,
            local_runtime::commands::runtime_local_models_catalog_list_variants,
            local_runtime::commands::runtime_local_models_catalog_resolve_install_plan,
            local_runtime::commands::runtime_local_profiles_resolve,
            local_runtime::commands::runtime_local_device_profile_collect,
            local_runtime::commands::runtime_local_profiles_apply,
            local_runtime::commands::runtime_local_services_list,
            local_runtime::commands::runtime_local_services_install,
            local_runtime::commands::runtime_local_services_start,
            local_runtime::commands::runtime_local_services_stop,
            local_runtime::commands::runtime_local_services_health,
            local_runtime::commands::runtime_local_services_remove,
            local_runtime::commands::runtime_local_nodes_catalog_list,
            local_runtime::commands::runtime_local_assets_install,
            local_runtime::commands::runtime_local_assets_install_verified,
            local_runtime::commands::runtime_local_downloads_list,
            local_runtime::commands::runtime_local_downloads_pause,
            local_runtime::commands::runtime_local_downloads_resume,
            local_runtime::commands::runtime_local_downloads_cancel,
            local_runtime::commands::runtime_local_assets_import,
            local_runtime::commands::runtime_local_assets_import_file,
            local_runtime::commands::runtime_local_assets_import_bundle,
            local_runtime::commands::runtime_local_assets_remove,
            local_runtime::commands::runtime_local_assets_start,
            local_runtime::commands::runtime_local_assets_stop,
            local_runtime::commands::runtime_local_assets_health,
            local_runtime::commands::runtime_local_assets_rescan_bundle,
            local_runtime::commands::runtime_local_append_inference_audit,
            local_runtime::commands::runtime_local_append_runtime_audit,
            local_runtime::commands::runtime_local_assets_reveal_in_folder,
            local_runtime::commands::runtime_local_assets_reveal_root_folder,
            local_runtime::commands::runtime_local_assets_scan_unregistered,
            local_runtime::commands::runtime_local_assets_scaffold_orphan,
            super::defaults_and_commands::tester_storage::tester_image_history_load,
            super::defaults_and_commands::tester_storage::tester_image_history_save,
            super::defaults_and_commands::tester_storage::tester_fixture_read_file,
            super::defaults_and_commands::world_tour::resolve_world_tour_fixture,
            super::defaults_and_commands::world_tour::save_world_tour_viewer_preset,
            super::defaults_and_commands::world_tour::open_world_tour_window
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
        "mods" => Some("mods"),
        "data-management" => Some("data-management"),
        "performance" => Some("performance"),
        "mod-developer" => Some("mod-developer"),
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
