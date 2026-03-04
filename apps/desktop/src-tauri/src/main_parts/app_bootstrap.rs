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
                                if let Err(error) =
                                    apply_macos_traffic_light_position(&window_for_relayout, x, y)
                                {
                                    eprintln!(
                                        "[boot:{:}] failed to re-apply traffic light position: {}",
                                        now_ms(),
                                        error
                                    );
                                }
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
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            runtime_defaults,
            http_request,
            open_external_url,
            oauth_token_exchange,
            oauth_listen_for_code,
            confirm_private_sync,
            log_renderer_event,
            start_window_drag,
            runtime_mod::commands::runtime_mod_append_audit,
            runtime_mod::commands::runtime_mod_query_audit,
            runtime_mod::commands::runtime_mod_delete_audit,
            runtime_mod::commands::runtime_mod_list_local_manifests,
            runtime_mod::commands::runtime_mod_read_local_entry,
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
            local_ai_runtime::commands::local_ai_models_list,
            local_ai_runtime::commands::local_ai_audits_list,
            local_ai_runtime::commands::local_ai_pick_manifest_path,
            local_ai_runtime::commands::local_ai_models_verified_list,
            local_ai_runtime::commands::local_ai_models_catalog_search,
            local_ai_runtime::commands::local_ai_models_catalog_resolve_install_plan,
            local_ai_runtime::commands::local_ai_dependencies_resolve,
            local_ai_runtime::commands::local_ai_device_profile_collect,
            local_ai_runtime::commands::local_ai_dependencies_apply,
            local_ai_runtime::commands::local_ai_services_list,
            local_ai_runtime::commands::local_ai_services_install,
            local_ai_runtime::commands::local_ai_services_start,
            local_ai_runtime::commands::local_ai_services_stop,
            local_ai_runtime::commands::local_ai_services_health,
            local_ai_runtime::commands::local_ai_services_remove,
            local_ai_runtime::commands::local_ai_nodes_catalog_list,
            local_ai_runtime::commands::local_ai_models_install,
            local_ai_runtime::commands::local_ai_models_install_verified,
            local_ai_runtime::commands::local_ai_downloads_list,
            local_ai_runtime::commands::local_ai_downloads_pause,
            local_ai_runtime::commands::local_ai_downloads_resume,
            local_ai_runtime::commands::local_ai_downloads_cancel,
            local_ai_runtime::commands::local_ai_models_import,
            local_ai_runtime::commands::local_ai_pick_model_file,
            local_ai_runtime::commands::local_ai_models_import_file,
            local_ai_runtime::commands::local_ai_models_remove,
            local_ai_runtime::commands::local_ai_models_start,
            local_ai_runtime::commands::local_ai_models_stop,
            local_ai_runtime::commands::local_ai_models_health,
            local_ai_runtime::commands::local_ai_append_inference_audit,
            local_ai_runtime::commands::local_ai_append_runtime_audit,
            local_ai_runtime::commands::local_ai_models_reveal_in_folder
        ])
        .run(tauri::generate_context!());

    match result {
        Ok(_) => {
            eprintln!("[boot:{:}] tauri run completed", now_ms());
        }
        Err(error) => {
            eprintln!("[boot:{:}] tauri run failed: {error}", now_ms());
            panic!("error while running tauri application: {error}");
        }
    }
}
