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
            "id": "app-host.bootstrap.native-unavailable",
            "command": "app_host_bootstrap",
            "expectError": true,
        }),
        serde_json::json!({
            "id": "artifacts.readRuntimeBytes.native-unavailable",
            "command": "artifacts_read_runtime_bytes",
            "payload": {
                "payload": {
                    "artifactId": "runtime-artifact-acceptance",
                }
            },
            "expectError": true,
        }),
        serde_json::json!({
            "id": "ai-config.set.negative",
            "command": "ai_config_set",
            "payload": {
                "payload": {
                    "scopeRef": "app:nimi.tester:app-lab",
                    "config": {
                        "scopeRef": {
                            "kind": "app",
                            "ownerId": "nimi.tester",
                            "surfaceId": "app-lab"
                        },
                        "capabilities": {
                            "targetRefs": {},
                            "selectedParams": {}
                        },
                        "profileOrigin": null
                    }
                }
            },
            "expectError": true,
        }),
        serde_json::json!({
            "id": "ai-config.get.negative",
            "command": "ai_config_get",
            "payload": {
                "payload": {
                    "scopeRef": "app:nimi.tester:app-lab",
                }
            },
            "expectError": true,
        }),
        serde_json::json!({
            "id": "config.get.negative",
            "command": "runtime_bridge_config_get",
            "expectError": true,
        }),
        serde_json::json!({
            "id": "standard-storage.runHistory.write.negative",
            "command": "storage_write_json",
            "payload": {
                "payload": {
                    "relativePath": "tester-run-history.json",
                    "value": {
                        "schemaVersion": 1,
                        "runs": []
                    }
                },
            },
            "expectError": true,
        }),
        serde_json::json!({
            "id": "standard-storage.runHistory.read.negative",
            "command": "storage_read_json",
            "payload": {
                "payload": {
                    "relativePath": "tester-run-history.json",
                },
            },
            "expectError": true,
        }),
        serde_json::json!({
            "id": "runtime-lifecycle.status.negative",
            "command": "runtime_bridge_status",
            "expectError": true,
        }),
        serde_json::json!({
            "id": "runtime-defaults.get.negative",
            "command": "runtime_defaults",
            "expectError": true,
        }),
        serde_json::json!({
            "id": "auth.sessionLoad.negative",
            "command": "auth_session_load",
            "expectError": true,
        }),
        serde_json::json!({
            "id": "local-agent.identity.negative",
            "command": "local_agent_identity",
            "expectError": true,
        }),
        serde_json::json!({
            "id": "unsupported-standard-command.negative",
            "command": "unsupported-standard-command",
            "expectError": true,
        }),
    ]
}
