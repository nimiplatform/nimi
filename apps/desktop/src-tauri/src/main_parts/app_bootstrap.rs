fn main() {
    install_panic_hook();
    eprintln!(
        "[boot:{:}] desktop process start pid={}",
        now_ms(),
        std::process::id()
    );
    log_boot_marker("main() entered");
    load_dotenv_files();
    log_boot_marker("dotenv files loaded");

    let result = tauri::Builder::default()
        .setup(|app| {
            eprintln!("[boot:{:}] setup entered", now_ms());
            let gateway_state =
                external_agent_gateway::ExternalAgentGatewayState::new(app.handle().clone());
            external_agent_gateway::start_external_agent_gateway(gateway_state.clone());
            app.manage(gateway_state);
            app.manage(crate::menu_bar_shell::MenuBarShellStore::new());
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
            let _ = crate::menu_bar_shell::setup(&app.handle());
            let _ = crate::runtime_mod::store::sync_runtime_mod_source_watchers(&app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            runtime_defaults,
            get_system_resource_snapshot,
            http_request,
            open_external_url,
            oauth_token_exchange,
            oauth_listen_for_code,
            confirm_private_sync,
            log_renderer_event,
            focus_main_window,
            start_window_drag,
            menu_bar_shell::menu_bar_sync_runtime_health,
            menu_bar_shell::menu_bar_complete_quit,
            runtime_mod::commands::runtime_mod_append_audit,
            runtime_mod::commands::runtime_mod_query_audit,
            runtime_mod::commands::runtime_mod_delete_audit,
            runtime_mod::commands::runtime_mod_list_local_manifests,
            runtime_mod::commands::runtime_mod_read_local_entry,
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
            runtime_mod::commands::runtime_mod_read_manifest,
            runtime_mod::commands::runtime_mod_install_progress,
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
            local_runtime::commands::runtime_local_models_list,
            local_runtime::commands::runtime_local_audits_list,
            local_runtime::commands::runtime_local_pick_manifest_path,
            local_runtime::commands::runtime_local_pick_artifact_manifest_path,
            local_runtime::commands::runtime_local_models_verified_list,
            local_runtime::commands::runtime_local_models_catalog_search,
            local_runtime::commands::runtime_local_models_catalog_list_variants,
            local_runtime::commands::runtime_local_models_catalog_resolve_install_plan,
            local_runtime::commands::runtime_local_dependencies_resolve,
            local_runtime::commands::runtime_local_device_profile_collect,
            local_runtime::commands::runtime_local_dependencies_apply,
            local_runtime::commands::runtime_local_services_list,
            local_runtime::commands::runtime_local_services_install,
            local_runtime::commands::runtime_local_services_start,
            local_runtime::commands::runtime_local_services_stop,
            local_runtime::commands::runtime_local_services_health,
            local_runtime::commands::runtime_local_services_remove,
            local_runtime::commands::runtime_local_nodes_catalog_list,
            local_runtime::commands::runtime_local_models_install,
            local_runtime::commands::runtime_local_models_install_verified,
            local_runtime::commands::runtime_local_downloads_list,
            local_runtime::commands::runtime_local_downloads_pause,
            local_runtime::commands::runtime_local_downloads_resume,
            local_runtime::commands::runtime_local_downloads_cancel,
            local_runtime::commands::runtime_local_models_import,
            local_runtime::commands::runtime_local_models_adopt,
            local_runtime::commands::runtime_local_pick_model_file,
            local_runtime::commands::runtime_local_models_import_file,
            local_runtime::commands::runtime_local_models_remove,
            local_runtime::commands::runtime_local_models_start,
            local_runtime::commands::runtime_local_models_stop,
            local_runtime::commands::runtime_local_models_health,
            local_runtime::commands::runtime_local_append_inference_audit,
            local_runtime::commands::runtime_local_append_runtime_audit,
            local_runtime::commands::runtime_local_models_reveal_in_folder,
            local_runtime::commands::runtime_local_models_scan_orphans,
            local_runtime::commands::runtime_local_models_scaffold_orphan,
            local_runtime::commands::runtime_local_artifacts_scan_orphans,
            local_runtime::commands::runtime_local_artifacts_scaffold_orphan
        ])
        .build(tauri::generate_context!());

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
