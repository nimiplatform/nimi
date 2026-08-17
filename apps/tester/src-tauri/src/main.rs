mod world_tour;

fn install_local_app_runtime_host(app: &tauri::App<tauri::Wry>) {
    use tauri::Manager;
    app.manage(
        nimi_shell_tauri::capabilities::runtime::RuntimeBridgeLocalAppHost::platform_default(),
    );
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            install_local_app_runtime_host(app);
            Ok(())
        })
        .invoke_handler(
            nimi_shell_tauri::nimi_shell_tauri_local_app_standard_shell_handler![
                world_tour::resolve_world_tour_fixture,
                world_tour::claim_world_tour_viewer_launch,
                world_tour::save_world_tour_viewer_preset,
                world_tour::open_world_tour_window,
            ],
        )
        .run(tauri::generate_context!())
        .expect("failed to run Nimi Lab shell");
}

#[cfg(test)]
mod tests {
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn tester_consumes_shared_platform_catalog_from_kit() {
        let speech_profile =
            nimi_shell_tauri::capabilities::ai_profile::resolve_factory_ai_profile_alias(
                "local-speech",
            )
            .expect("local speech profile");
        assert_eq!(speech_profile.alias, "local-speech");

        let profile_index = nimi_shell_tauri::capabilities::platform_projection::factory_profile_index::build_factory_profile_index_record()
            .expect("factory profile index projection");
        assert!(profile_index
            .profiles
            .iter()
            .any(|row| row.alias == "local-speech"));
    }

    #[test]
    fn tester_consumes_shared_platform_projection_materializers_from_kit() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("nimi-tester-platform-projection-{unique}"));
        let factory_path = dir.join("profiles").join("factory-index.json");

        let factory_outcome = nimi_shell_tauri::capabilities::platform_projection::factory_profile_index::materialize_factory_profile_index_projection(
            &factory_path,
        )
        .expect("materialize factory index");
        assert!(matches!(
            factory_outcome,
            nimi_shell_tauri::capabilities::config::ConfigReadOutcome::Ready(_)
        ));
        assert!(factory_path.exists());

        let future_factory_path = dir.join("profiles").join("future-factory-index.json");
        let mut future_factory = nimi_shell_tauri::capabilities::platform_projection::factory_profile_index::build_factory_profile_index_record()
            .expect("factory record");
        future_factory.schema_version = 9999;
        let future_factory_raw =
            serde_json::to_string_pretty(&future_factory).expect("factory json");
        std::fs::write(&future_factory_path, &future_factory_raw).expect("write factory");

        match nimi_shell_tauri::capabilities::platform_projection::factory_profile_index::materialize_factory_profile_index_projection(
            &future_factory_path,
        )
        .expect("future factory materialize")
        {
            nimi_shell_tauri::capabilities::config::ConfigReadOutcome::Repair { severity, reason } => {
                assert_eq!(
                    severity,
                    nimi_shell_tauri::capabilities::config::ConfigRepairSeverity::RepairRequired
                );
                assert!(reason.contains("newer than the supported version"));
            }
            other => panic!("expected factory repair state, got {other:?}"),
        }
        assert_eq!(
            std::fs::read_to_string(&future_factory_path).expect("read factory"),
            future_factory_raw
        );
    }

    #[test]
    fn tester_consumes_shared_governed_config_repair_framework() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("nimi-tester-governed-config-{unique}"));
        std::fs::create_dir_all(&dir).expect("create temp dir");
        let path = dir.join("probe.json");
        let ready_path = dir.join("nested").join("ready.json");
        nimi_shell_tauri::capabilities::config::write_governed_json_config(
            &ready_path,
            &serde_json::json!({
                "schemaVersion": 1,
                "displayName": "ready"
            }),
            |record| {
                if record
                    .get("schemaVersion")
                    .and_then(serde_json::Value::as_u64)
                    == Some(1)
                {
                    Ok(())
                } else {
                    Err("schemaVersion mismatch".to_string())
                }
            },
        )
        .expect("write governed config");
        assert!(ready_path.exists());

        std::fs::write(
            &path,
            serde_json::to_string_pretty(&serde_json::json!({
                "schemaVersion": 99,
                "displayName": "future"
            }))
            .expect("json"),
        )
        .expect("write probe");

        let file = nimi_shell_tauri::capabilities::config::GovernedConfigFile::new(
            "tester_probe",
            "~/.nimi/tester/probe.json",
            1,
        );
        let outcome = nimi_shell_tauri::capabilities::config::read_governed_config(
            &file,
            &path,
            |document| Ok(document.clone()),
        )
        .expect("read governed config");

        match outcome {
            nimi_shell_tauri::capabilities::config::ConfigReadOutcome::Repair {
                severity,
                reason,
            } => {
                assert_eq!(
                    severity,
                    nimi_shell_tauri::capabilities::config::ConfigRepairSeverity::RepairRequired
                );
                assert!(reason.contains("newer than the supported version"));
                assert!(reason.contains("~/.nimi/tester/probe.json"));
            }
            other => panic!("expected shared governed-config repair state, got {other:?}"),
        }
    }

    #[test]
    fn tester_consumes_shared_runtime_bridge_unary_codec_helpers() {
        let request =
            nimi_shell_tauri::capabilities::runtime::generated::GetAccountSessionStatusRequest {
                caller: None,
            };
        let payload = nimi_shell_tauri::capabilities::runtime::build_unary_payload(
            nimi_shell_tauri::capabilities::runtime::RUNTIME_ACCOUNT_GET_ACCOUNT_SESSION_STATUS_METHOD_ID,
            request,
            Some(7_000),
        );
        assert_eq!(
            payload.method_id,
            nimi_shell_tauri::capabilities::runtime::RUNTIME_ACCOUNT_GET_ACCOUNT_SESSION_STATUS_METHOD_ID
        );
        assert_eq!(payload.timeout_ms, Some(7_000));
        assert_eq!(
            payload.request_bytes_base64.trim(),
            "",
            "protobuf default requests encode to an empty payload"
        );

        let result = nimi_shell_tauri::capabilities::runtime::RuntimeBridgeUnaryResult {
            response_bytes_base64: String::new(),
            response_metadata: None,
        };
        let decoded_response: nimi_shell_tauri::capabilities::runtime::generated::GetAccountSessionStatusResponse =
            nimi_shell_tauri::capabilities::runtime::decode_unary_result(
                nimi_shell_tauri::capabilities::runtime::RUNTIME_ACCOUNT_GET_ACCOUNT_SESSION_STATUS_METHOD_ID,
                &result,
            )
            .expect("decode response");
        assert!(!decoded_response.accepted);
        assert!(decoded_response.snapshot.is_none());
    }

    #[test]
    fn tester_consumes_shared_nimi_data_directory_primitives() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time")
            .as_nanos();
        let data_root = std::env::temp_dir().join(format!("nimi-tester-data-root-{unique}"));
        nimi_shell_tauri::capabilities::data::enforce_data_root_layout(&data_root)
            .expect("enforce data root layout");

        for name in nimi_shell_tauri::capabilities::data::first_level_directory_names() {
            assert!(data_root.join(name).is_dir(), "{name} directory must exist");
        }

        std::fs::write(data_root.join("logs").join("probe.log"), b"log").expect("write log probe");
        let log_plan =
            nimi_shell_tauri::capabilities::data::plan_directory_cleanup(&data_root, "logs")
                .expect("log cleanup plan");
        assert!(log_plan.requires_confirmation);

        std::fs::write(data_root.join("models").join("model.bin"), b"model")
            .expect("write model probe");
        let error = nimi_shell_tauri::capabilities::data::execute_directory_cleanup(
            &data_root,
            "models",
            Some(nimi_shell_tauri::capabilities::data::DESTRUCTIVE_CLEANUP_CONFIRMATION),
        )
        .expect_err("runtime-owned cleanup must fail closed");
        assert!(error.contains("Runtime"));
        assert!(data_root.join("models").join("model.bin").exists());
    }

}
