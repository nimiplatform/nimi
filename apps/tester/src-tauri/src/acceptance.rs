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
            "id": "local-app.permission-posture.native-unavailable",
            "command": "local_app_permission_posture",
            "payload": {
                "payload": {
                    "operationId": "runtime_agent.conversation.turn.send",
                    "resourceRef": "agent:tester/conversation:acceptance",
                }
            },
            "expectError": true,
        }),
        serde_json::json!({
            "id": "local-app.permission-request.native-unavailable",
            "command": "local_app_permission_request",
            "payload": {
                "payload": {
                    "operationId": "runtime_agent.conversation.turn.send",
                    "resourceRef": "agent:tester/conversation:acceptance",
                    "purpose": "Tester plain-shell negative acceptance",
                }
            },
            "expectError": true,
        }),
        serde_json::json!({
            "id": "local-app.artifact-read.native-unavailable",
            "command": "local_app_artifacts_read_runtime_bytes",
            "payload": {
                "payload": {
                    "artifactId": "runtime-artifact-acceptance",
                }
            },
            "expectError": true,
        }),
        serde_json::json!({
            "id": "local-app.agent-open.native-unavailable",
            "command": "local_app_agent_open_conversation",
            "payload": { "payload": { "agentId": "tester", "requestedAnchorDisposition": "create-or-resume" } },
            "expectError": true,
        }),
        serde_json::json!({
            "id": "local-app.agent-send.native-unavailable",
            "command": "local_app_agent_send_turn",
            "payload": { "payload": { "agentId": "tester", "conversationAnchorId": "anchor", "clientTurnId": "turn", "userText": "hello" } },
            "expectError": true,
        }),
        serde_json::json!({
            "id": "local-app.agent-subscribe.native-unavailable",
            "command": "local_app_agent_subscribe_turn",
            "payload": { "payload": { "agentId": "tester", "conversationAnchorId": "anchor", "cursor": "" } },
            "expectError": true,
        }),
        serde_json::json!({
            "id": "local-app.agent-snapshot.native-unavailable",
            "command": "local_app_agent_get_conversation_snapshot",
            "payload": { "payload": { "agentId": "tester", "conversationAnchorId": "anchor" } },
            "expectError": true,
        }),
        serde_json::json!({
            "id": "ai-config.unadmitted.negative",
            "command": "ai_config_get",
            "expectError": true,
        }),
        serde_json::json!({
            "id": "standard-storage.unadmitted.negative",
            "command": "storage_read_json",
            "expectError": true,
        }),
        serde_json::json!({
            "id": "unsupported-standard-command.negative",
            "command": "unsupported-standard-command",
            "expectError": true,
        }),
    ]
}
