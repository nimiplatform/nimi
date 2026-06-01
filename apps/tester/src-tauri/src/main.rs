mod tester_storage;
mod world_tour;

fn tester_renderer_entry_probe_script() -> Result<String, String> {
    nimi_shell_tauri::renderer_entry_probe::build_renderer_entry_probe_script(
        &nimi_shell_tauri::renderer_entry_probe::RendererEntryProbeScriptConfig {
            started_flag: "__NIMI_TESTER_RENDERER_PROBE_STARTED__".to_string(),
            ping_command: "tester_renderer_probe_ping".to_string(),
            report_command: "tester_renderer_probe_report_write".to_string(),
            context_command: "tester_renderer_probe_context_get".to_string(),
            reset_local_storage_scenario_ids: Vec::new(),
        },
    )
}

fn main() {
    tauri::Builder::default()
        .on_page_load(|webview, payload| {
            if !matches!(payload.event(), tauri::webview::PageLoadEvent::Finished) {
                return;
            }
            if let Ok(script) = tester_renderer_entry_probe_script() {
                let _ = webview.eval(script.as_str());
            }
        })
        .invoke_handler(nimi_shell_tauri::nimi_shell_tauri_runtime_bridge_handler![
            @with_runtime_defaults nimi_shell_tauri::runtime_defaults::runtime_defaults;
            tester_storage::tester_image_history_load,
            tester_storage::tester_image_history_save,
            tester_storage::tester_run_history_load,
            tester_storage::tester_run_history_save,
            world_tour::resolve_world_tour_fixture,
            world_tour::claim_world_tour_viewer_launch,
            world_tour::save_world_tour_viewer_preset,
            world_tour::world_tour_render_acceptance_load,
            world_tour::world_tour_render_acceptance_save,
            world_tour::open_world_tour_window,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Nimi Tester shell");
}

#[cfg(test)]
mod tests {
    use std::time::{SystemTime, UNIX_EPOCH};

    fn with_env_vars(vars: &[(&str, Option<&str>)], run: impl FnOnce()) {
        let saved: Vec<(String, Option<String>)> = vars
            .iter()
            .map(|(key, _)| ((*key).to_string(), std::env::var(key).ok()))
            .collect();
        for (key, value) in vars {
            match value {
                Some(value) => std::env::set_var(key, value),
                None => std::env::remove_var(key),
            }
        }

        run();

        for (key, value) in saved {
            match value {
                Some(value) => std::env::set_var(&key, value),
                None => std::env::remove_var(&key),
            }
        }
    }

    #[test]
    fn tester_consumes_shared_renderer_entry_probe_from_kit() {
        let script = super::tester_renderer_entry_probe_script().expect("probe script");

        assert!(script.contains("__NIMI_TESTER_RENDERER_PROBE_STARTED__"));
        assert!(script.contains("tester_renderer_probe_ping"));
        assert!(script.contains("tester_renderer_probe_report_write"));
        assert!(script.contains("tester_renderer_probe_context_get"));
        assert!(script.contains("return import(scriptSrc);"));
        let forbidden_desktop_command = ["desktop", "macos", "smoke", "ping"].join("_");
        assert!(!script.contains(forbidden_desktop_command.as_str()));
    }

    #[test]
    fn tester_consumes_shared_platform_catalog_from_kit() {
        let first_run_profile =
            nimi_shell_tauri::platform_catalog::ai_profile_factory::verify_first_run_factory_ai_profile(
                "local-speech-ready",
                "minimal",
            )
            .expect("first-run profile");
        assert_eq!(first_run_profile.alias, "local-speech-ready");

        let descriptor =
            nimi_shell_tauri::platform_catalog::nimi_app_registry::resolve_release_descriptor(
                "nimi.avatar.bundled-with-nimi",
            )
            .expect("avatar release descriptor");
        assert_eq!(descriptor.app_id, "nimi.avatar");

        let app_registry =
            nimi_shell_tauri::platform_projection::apps_registry::build_apps_registry_record()
                .expect("apps registry projection");
        assert!(app_registry
            .apps
            .iter()
            .any(|row| row.app_id == "nimi.avatar"));
        let profile_index = nimi_shell_tauri::platform_projection::factory_profile_index::build_factory_profile_index_record()
            .expect("factory profile index projection");
        assert!(profile_index
            .profiles
            .iter()
            .any(|row| row.alias == "local-speech-ready"));

        let bridge_projection =
            nimi_shell_tauri::platform_projection::apps_bridge::build_apps_bridge_projection(
                "~/.nimi/apps/registry.json".to_string(),
                "~/.nimi/apps/packages.json".to_string(),
            )
            .expect("apps bridge projection");
        assert_eq!(
            bridge_projection.registry_rows.len(),
            nimi_shell_tauri::platform_catalog::nimi_app_registry::PLATFORM_NIMI_APP_REGISTRY_ROWS
                .len()
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
        nimi_shell_tauri::governed_config::write_governed_json_config(
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

        let file = nimi_shell_tauri::governed_config::GovernedConfigFile::new(
            "tester_probe",
            "~/.nimi/tester/probe.json",
            1,
        );
        let outcome =
            nimi_shell_tauri::governed_config::read_governed_config(&file, &path, |document| {
                Ok(document.clone())
            })
            .expect("read governed config");

        match outcome {
            nimi_shell_tauri::governed_config::ConfigReadOutcome::Repair { severity, reason } => {
                assert_eq!(
                    severity,
                    nimi_shell_tauri::governed_config::ConfigRepairSeverity::RepairRequired
                );
                assert!(reason.contains("newer than the supported version"));
                assert!(reason.contains("~/.nimi/tester/probe.json"));
            }
            other => panic!("expected shared governed-config repair state, got {other:?}"),
        }
    }

    #[test]
    fn tester_consumes_shared_runtime_defaults_projection() {
        with_env_vars(
            &[
                ("NIMI_REALM_URL", Some("http://localhost")),
                ("NIMI_REALM_JWKS_URL", None),
                ("NIMI_REALM_REVOCATION_URL", None),
                ("NIMI_REALM_JWT_ISSUER", None),
                ("NIMI_REALM_JWT_AUDIENCE", None),
                ("NIMI_ACCESS_TOKEN", Some("tester-runtime-token")),
                (
                    "NIMI_LOCAL_PROVIDER_ENDPOINT",
                    Some("http://127.0.0.1:1234/v1"),
                ),
                ("NIMI_LOCAL_PROVIDER_MODEL", Some("legacy-model")),
                ("NIMI_PROVIDER", Some("legacy-provider")),
            ],
            || {
                let defaults = nimi_shell_tauri::runtime_defaults::runtime_defaults();
                assert_eq!(defaults.realm.realm_base_url, "http://localhost:3002");
                assert_eq!(
                    defaults.realm.jwks_url,
                    "http://localhost:3002/api/auth/jwks"
                );
                assert_eq!(
                    defaults.realm.revocation_url,
                    "http://localhost:3002/api/auth/sessions/introspect"
                );
                assert_eq!(defaults.realm.jwt_issuer, "http://localhost:3002");
                assert_eq!(defaults.realm.jwt_audience, "nimi-runtime");
                assert_eq!(defaults.realm.access_token, "tester-runtime-token");

                let runtime = serde_json::to_value(defaults.runtime).expect("runtime json");
                for retired_key in [
                    "localProviderEndpoint",
                    "localProviderModel",
                    "localOpenAiEndpoint",
                    "connectorId",
                    "provider",
                ] {
                    assert!(
                        runtime.get(retired_key).is_none(),
                        "shared runtime defaults must not emit retired route field {retired_key}"
                    );
                }
            },
        );
    }

    #[test]
    fn tester_consumes_shared_runtime_account_caller_projection() {
        let caller =
            nimi_shell_tauri::runtime_account_caller::local_first_party_runtime_account_caller(
                "app.nimi.tester",
            )
            .expect("caller");

        assert_eq!(caller.app_id, "app.nimi.tester");
        assert_eq!(caller.app_instance_id, "app.nimi.tester.local-first-party");
        assert_eq!(caller.device_id, "local-first-party-device");
        assert_eq!(
            caller.mode,
            nimi_shell_tauri::runtime_bridge::generated::AccountCallerMode::LocalFirstPartyApp
                as i32
        );
        assert!(caller.scopes.is_empty());
    }

    #[test]
    fn tester_consumes_shared_runtime_bridge_unary_codec_helpers() {
        let request = nimi_shell_tauri::runtime_bridge::generated::GetAccountSessionStatusRequest {
            caller: None,
        };
        let payload = nimi_shell_tauri::runtime_bridge::build_unary_payload(
            nimi_shell_tauri::runtime_bridge::RUNTIME_ACCOUNT_GET_ACCOUNT_SESSION_STATUS_METHOD_ID,
            request,
            Some(7_000),
        );
        assert_eq!(
            payload.method_id,
            nimi_shell_tauri::runtime_bridge::RUNTIME_ACCOUNT_GET_ACCOUNT_SESSION_STATUS_METHOD_ID
        );
        assert_eq!(payload.timeout_ms, Some(7_000));
        assert_eq!(
            payload.request_bytes_base64.trim(),
            "",
            "protobuf default requests encode to an empty payload"
        );

        let result = nimi_shell_tauri::runtime_bridge::RuntimeBridgeUnaryResult {
            response_bytes_base64: String::new(),
            response_metadata: None,
        };
        let decoded_response: nimi_shell_tauri::runtime_bridge::generated::GetAccountSessionStatusResponse =
            nimi_shell_tauri::runtime_bridge::decode_unary_result(
                nimi_shell_tauri::runtime_bridge::RUNTIME_ACCOUNT_GET_ACCOUNT_SESSION_STATUS_METHOD_ID,
                &result,
            )
            .expect("decode response");
        assert_eq!(
            decoded_response.state,
            nimi_shell_tauri::runtime_bridge::generated::AccountSessionState::Unspecified as i32
        );
    }

    #[test]
    fn tester_consumes_shared_nimi_data_directory_primitives() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time")
            .as_nanos();
        let data_root = std::env::temp_dir().join(format!("nimi-tester-data-root-{unique}"));
        nimi_shell_tauri::nimi_data_directory::enforce_data_root_layout(&data_root)
            .expect("enforce data root layout");

        for name in [
            "models",
            "dependencies",
            "environments",
            "apps",
            "cache",
            "tmp",
        ] {
            assert!(data_root.join(name).is_dir(), "{name} directory must exist");
        }

        std::fs::write(data_root.join("cache").join("probe.bin"), b"cache")
            .expect("write cache probe");
        let cache_plan =
            nimi_shell_tauri::nimi_data_directory::plan_directory_cleanup(&data_root, "cache")
                .expect("cache cleanup plan");
        assert!(!cache_plan.requires_confirmation);
        let cache_outcome = nimi_shell_tauri::nimi_data_directory::execute_directory_cleanup(
            &data_root, "cache", None,
        )
        .expect("cache cleanup");
        assert_eq!(cache_outcome.removed_files, 1);
        assert!(data_root.join("cache").is_dir());

        std::fs::write(data_root.join("models").join("model.bin"), b"model")
            .expect("write model probe");
        let error = nimi_shell_tauri::nimi_data_directory::execute_directory_cleanup(
            &data_root,
            "models",
            Some(nimi_shell_tauri::nimi_data_directory::DESTRUCTIVE_CLEANUP_CONFIRMATION),
        )
        .expect_err("runtime-owned cleanup must fail closed");
        assert!(error.contains("Runtime"));
        assert!(data_root.join("models").join("model.bin").exists());
    }

    #[test]
    fn tester_consumes_shared_runtime_local_asset_helpers() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time")
            .as_nanos();
        let data_root = std::env::temp_dir().join(format!("nimi-tester-model-root-{unique}"));
        let models_root = nimi_shell_tauri::runtime_local_assets::runtime_models_dir(&data_root);
        std::fs::create_dir_all(&models_root).expect("create models root");
        let manifest =
            models_root.join(nimi_shell_tauri::runtime_local_assets::ASSET_MANIFEST_FILE_NAME);
        std::fs::write(&manifest, "{}").expect("write manifest");

        let resolved = nimi_shell_tauri::runtime_local_assets::canonical_asset_manifest_path(
            &manifest,
            &models_root,
        )
        .expect("manifest under models root");
        assert_eq!(
            resolved,
            manifest.canonicalize().expect("canonical manifest")
        );

        let outside_dir = data_root.join("outside");
        std::fs::create_dir_all(&outside_dir).expect("create outside dir");
        let outside_manifest =
            outside_dir.join(nimi_shell_tauri::runtime_local_assets::ASSET_MANIFEST_FILE_NAME);
        std::fs::write(&outside_manifest, "{}").expect("write outside manifest");
        let error = nimi_shell_tauri::runtime_local_assets::canonical_asset_manifest_path(
            &outside_manifest,
            &models_root,
        )
        .expect_err("outside manifest must fail closed");
        assert!(error.starts_with("LOCAL_AI_IMPORT_PATH_OUTSIDE_RUNTIME_ROOT"));

        let asset_dir = models_root.join("asset-1");
        std::fs::create_dir_all(&asset_dir).expect("create asset dir");
        assert_eq!(
            nimi_shell_tauri::runtime_local_assets::reveal_target_for_asset(
                &models_root,
                "asset-1"
            ),
            asset_dir
        );
        assert_eq!(
            nimi_shell_tauri::runtime_local_assets::reveal_target_for_asset(
                &models_root,
                "../asset-1"
            ),
            models_root
        );
    }
}
