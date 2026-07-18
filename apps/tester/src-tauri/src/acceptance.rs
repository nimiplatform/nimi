pub(crate) fn tester_renderer_entry_probe_script() -> Result<String, String> {
    nimi_shell_tauri::capabilities::diagnostics::build_renderer_entry_probe_script(
        &nimi_shell_tauri::capabilities::diagnostics::RendererEntryProbeScriptConfig {
            started_flag: "__NIMI_TESTER_RENDERER_PROBE_STARTED__".to_string(),
            ping_command: "tester_renderer_probe_ping".to_string(),
            report_command: "tester_renderer_probe_report_write".to_string(),
            context_command: "tester_renderer_probe_context_get".to_string(),
            reset_local_storage_scenario_ids: Vec::new(),
        },
    )
}

pub(crate) fn tester_tauri_acceptance_command_checks() -> Vec<serde_json::Value> {
    vec![
        serde_json::json!({
            "id": "local-app.session-status.native-unavailable",
            "command": "local_app_session_status",
            "expectError": true,
        }),
        serde_json::json!({
            "id": "local-app.permission-status.native-unavailable",
            "command": "local_app_permission_status",
            "payload": {
                "payload": {
                    "permissionId": "agents.interact",
                }
            },
            "expectError": true,
        }),
        serde_json::json!({
            "id": "local-app.permission-request.native-unavailable",
            "command": "local_app_permission_request",
            "payload": {
                "payload": {
                    "permissionId": "agents.interact",
                    "reason": "Tester plain-shell negative acceptance",
                }
            },
            "expectError": true,
        }),
        serde_json::json!({
            "id": "app-private-storage.read.native-unavailable",
            "command": "storage_read_json",
            "payload": {
                "payload": {
                    "relativePath": "acceptance/private.json",
                }
            },
            "expectError": true,
        }),
        serde_json::json!({
            "id": "app-private-storage.write.native-unavailable",
            "command": "storage_write_json",
            "payload": { "payload": { "relativePath": "acceptance/private.json", "value": { "source": "tester" } } },
            "expectError": true,
        }),
        serde_json::json!({
            "id": "app-private-storage.remove.native-unavailable",
            "command": "storage_remove_json",
            "payload": { "payload": { "relativePath": "acceptance/private.json" } },
            "expectError": true,
        }),
        serde_json::json!({
            "id": "ai-config.unadmitted.negative",
            "command": "ai_config_get",
            "expectError": true,
        }),
        serde_json::json!({
            "id": "unsupported-standard-command.negative",
            "command": "unsupported-standard-command",
            "expectError": true,
        }),
    ]
}
