mod world_tour;

use nimi_shell_tauri::capabilities::data::{
    resolve_standard_app_storage_roots, StandardAppStorageRootSlot, StandardDataRootBinding,
};

const TESTER_APP_ID: &str = "nimi.tester";
const ACCEPTANCE_PROBE_PATH_ENV: &str = "NIMI_TESTER_TAURI_ACCEPTANCE_PROBE_PATH";
const ACCEPTANCE_SCENARIO_ID_ENV: &str = "NIMI_TESTER_TAURI_ACCEPTANCE_SCENARIO_ID";
const ACCEPTANCE_STORAGE_ROOT_ENV: &str = "NIMI_TESTER_TAURI_ACCEPTANCE_STORAGE_ROOT";

fn tester_renderer_entry_probe_script() -> Result<String, String> {
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

#[tauri::command]
fn tester_renderer_probe_ping(payload: serde_json::Value) -> Result<(), String> {
    write_acceptance_probe_event("ping", payload)
}

#[tauri::command]
fn tester_renderer_probe_report_write(payload: serde_json::Value) -> Result<(), String> {
    write_acceptance_probe_event("report", payload)
}

#[tauri::command]
fn tester_renderer_probe_context_get() -> serde_json::Value {
    let enabled = acceptance_probe_path().is_some();
    serde_json::json!({
        "enabled": enabled,
        "scenarioId": std::env::var(ACCEPTANCE_SCENARIO_ID_ENV)
            .ok()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| "tester.tauri.acceptance".to_string()),
        "commandChecks": if enabled {
            tester_tauri_acceptance_command_checks()
        } else {
            Vec::new()
        },
    })
}

fn acceptance_probe_path() -> Option<std::path::PathBuf> {
    std::env::var(ACCEPTANCE_PROBE_PATH_ENV)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .map(std::path::PathBuf::from)
}

fn tester_tauri_acceptance_command_checks() -> Vec<serde_json::Value> {
    vec![
        serde_json::json!({
            "id": "ai-config.set",
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
        }),
        serde_json::json!({
            "id": "ai-config.get",
            "command": "ai_config_get",
            "payload": {
                "payload": {
                    "scopeRef": "app:nimi.tester:app-lab",
                }
            },
        }),
        serde_json::json!({
            "id": "config.get.negative",
            "command": "runtime_bridge_config_get",
            "expectError": true,
        }),
        serde_json::json!({
            "id": "standard-storage.runHistory.write",
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
        }),
        serde_json::json!({
            "id": "standard-storage.runHistory.read",
            "command": "storage_read_json",
            "payload": {
                "payload": {
                    "relativePath": "tester-run-history.json",
                },
            },
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

fn write_acceptance_probe_event(kind: &str, payload: serde_json::Value) -> Result<(), String> {
    let Some(path) = acceptance_probe_path() else {
        return Ok(());
    };
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|error| format!("create Tauri acceptance probe directory: {error}"))?;
    }
    let record = serde_json::json!({
        "source": "tester-tauri-acceptance",
        "kind": kind,
        "payload": payload,
    });
    let raw = serde_json::to_string_pretty(&record)
        .map_err(|error| format!("serialize Tauri acceptance probe event: {error}"))?;
    std::fs::write(&path, raw)
        .map_err(|error| format!("write Tauri acceptance probe event: {error}"))
}

/// Resolves and manages the Runtime-attested standard app storage slot that
/// backs the kit standard storage/data commands and the app-owned world-tour
/// cache/temp roots. Under the Tauri acceptance harness the roots come from the
/// acceptance storage root as a Runtime launch projection; otherwise they are
/// resolved from Runtime `GetAppStorage` for the tester app id. If resolution
/// fails the slot stays unbound and dependent commands fail closed.
fn install_standard_app_storage_slot(app: &tauri::App<tauri::Wry>) {
    use tauri::Manager;
    let slot = StandardAppStorageRootSlot::empty();
    let binding = if let Some(root) = acceptance_storage_root_override() {
        let root = std::path::PathBuf::from(root);
        StandardDataRootBinding::RuntimeLaunchProjection {
            durable_data_root: root.clone(),
            cache_root: Some(root.clone()),
            temp_root: Some(root),
            projection_ref: "tester-tauri-acceptance-fixture".to_string(),
        }
    } else {
        StandardDataRootBinding::RuntimeGetAppStorage {
            app_id: TESTER_APP_ID.to_string(),
        }
    };
    match tauri::async_runtime::block_on(resolve_standard_app_storage_roots(binding)) {
        Ok(roots) => {
            if let Err(error) = slot.bind(roots) {
                eprintln!("[tester-tauri] standard app storage slot bind failed: {error}");
            }
        }
        Err(error) => {
            eprintln!(
                "[tester-tauri] standard app storage slot left unbound (fail-closed): {error}"
            );
        }
    }
    app.manage(slot);
}

fn acceptance_storage_root_override() -> Option<String> {
    std::env::var(ACCEPTANCE_STORAGE_ROOT_ENV)
        .ok()
        .map(|raw| raw.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            install_standard_app_storage_slot(app);
            Ok(())
        })
        .on_page_load(|webview, payload| {
            if !matches!(payload.event(), tauri::webview::PageLoadEvent::Finished) {
                return;
            }
            if let Ok(script) = tester_renderer_entry_probe_script() {
                let _ = webview.eval(script.as_str());
            }
        })
        .invoke_handler(
            nimi_shell_tauri::nimi_shell_tauri_installed_app_standard_shell_handler![
                tester_renderer_probe_ping,
                tester_renderer_probe_report_write,
                tester_renderer_probe_context_get,
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
    use std::sync::Mutex;
    use std::time::{SystemTime, UNIX_EPOCH};

    static ENV_LOCK: Mutex<()> = Mutex::new(());

    fn with_env_vars(vars: &[(&str, Option<&str>)], run: impl FnOnce()) {
        let _guard = ENV_LOCK.lock().expect("env lock");
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
    fn tester_renderer_probe_context_is_acceptance_opt_in() {
        with_env_vars(
            &[
                (super::ACCEPTANCE_PROBE_PATH_ENV, None),
                (super::ACCEPTANCE_SCENARIO_ID_ENV, None),
            ],
            || {
                let context = super::tester_renderer_probe_context_get();
                assert_eq!(
                    context.get("enabled").and_then(serde_json::Value::as_bool),
                    Some(false)
                );
                assert_eq!(
                    context
                        .get("scenarioId")
                        .and_then(serde_json::Value::as_str),
                    Some("tester.tauri.acceptance")
                );
                assert_eq!(
                    context
                        .get("commandChecks")
                        .and_then(serde_json::Value::as_array)
                        .map(Vec::len),
                    Some(0)
                );
            },
        );
    }

    #[test]
    fn tester_renderer_probe_ping_writes_acceptance_event_when_enabled() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("nimi-tester-tauri-acceptance-{unique}"));
        let probe_path = dir.join("probe.json");
        let probe_path_string = probe_path.to_string_lossy().into_owned();
        with_env_vars(
            &[
                (
                    super::ACCEPTANCE_PROBE_PATH_ENV,
                    Some(probe_path_string.as_str()),
                ),
                (
                    super::ACCEPTANCE_SCENARIO_ID_ENV,
                    Some("tester.tauri.acceptance.test"),
                ),
            ],
            || {
                let context = super::tester_renderer_probe_context_get();
                assert_eq!(
                    context.get("enabled").and_then(serde_json::Value::as_bool),
                    Some(true)
                );
                assert_eq!(
                    context
                        .get("scenarioId")
                        .and_then(serde_json::Value::as_str),
                    Some("tester.tauri.acceptance.test")
                );
                let command_checks = context
                    .get("commandChecks")
                    .and_then(serde_json::Value::as_array)
                    .expect("command checks");
                assert!(command_checks
                    .iter()
                    .any(|row| row.get("command").and_then(serde_json::Value::as_str)
                        == Some("ai_config_set")));
                assert!(command_checks
                    .iter()
                    .any(|row| row.get("command").and_then(serde_json::Value::as_str)
                        == Some("ai_config_get")));
                assert!(command_checks
                    .iter()
                    .any(|row| row.get("command").and_then(serde_json::Value::as_str)
                        == Some("storage_write_json")));
                assert!(command_checks
                    .iter()
                    .any(|row| row.get("command").and_then(serde_json::Value::as_str)
                        == Some("storage_read_json")));
                assert!(command_checks.iter().any(|row| {
                    row.get("command").and_then(serde_json::Value::as_str)
                        == Some("runtime_defaults")
                        && row.get("expectError").and_then(serde_json::Value::as_bool) == Some(true)
                }));
                assert!(command_checks.iter().any(|row| row
                    .get("expectError")
                    .and_then(serde_json::Value::as_bool)
                    == Some(true)));

                super::tester_renderer_probe_ping(serde_json::json!({
                    "stage": "window-dynamic-import-ok",
                }))
                .expect("write probe");

                let record: serde_json::Value = serde_json::from_str(
                    &std::fs::read_to_string(&probe_path).expect("read probe"),
                )
                .expect("probe json");
                assert_eq!(
                    record.get("source").and_then(serde_json::Value::as_str),
                    Some("tester-tauri-acceptance")
                );
                assert_eq!(
                    record.get("kind").and_then(serde_json::Value::as_str),
                    Some("ping")
                );
                assert_eq!(
                    record
                        .get("payload")
                        .and_then(|payload| payload.get("stage"))
                        .and_then(serde_json::Value::as_str),
                    Some("window-dynamic-import-ok")
                );
            },
        );
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn tester_consumes_shared_renderer_entry_probe_from_kit() {
        let script = super::tester_renderer_entry_probe_script().expect("probe script");

        assert!(script.contains("__NIMI_TESTER_RENDERER_PROBE_STARTED__"));
        assert!(script.contains("tester_renderer_probe_ping"));
        assert!(script.contains("tester_renderer_probe_report_write"));
        assert!(script.contains("tester_renderer_probe_context_get"));
        assert!(script.contains("import(scriptSrc);"));
        assert!(script.contains("command-checks-ok"));
        let forbidden_desktop_command = ["desktop", "macos", "smoke", "ping"].join("_");
        assert!(!script.contains(forbidden_desktop_command.as_str()));
    }

    #[test]
    fn tester_consumes_shared_platform_catalog_from_kit() {
        let first_run_profile =
            nimi_shell_tauri::capabilities::ai_profile::verify_first_run_factory_ai_profile(
                "local-speech-ready",
                "minimal",
            )
            .expect("first-run profile");
        assert_eq!(first_run_profile.alias, "local-speech-ready");

        let descriptor =
            nimi_shell_tauri::capabilities::platform_projection::nimi_app_registry::resolve_release_descriptor(
                "nimi.avatar.bundled-with-nimi",
            )
            .expect("avatar release descriptor");
        assert_eq!(descriptor.app_id, "nimi.avatar");

        let app_registry =
            nimi_shell_tauri::capabilities::platform_projection::apps_registry::build_apps_registry_record()
                .expect("apps registry projection");
        assert!(app_registry
            .apps
            .iter()
            .any(|row| row.app_id == "nimi.avatar"));
        let profile_index = nimi_shell_tauri::capabilities::platform_projection::factory_profile_index::build_factory_profile_index_record()
            .expect("factory profile index projection");
        assert!(profile_index
            .profiles
            .iter()
            .any(|row| row.alias == "local-speech-ready"));

        let bridge_projection =
            nimi_shell_tauri::capabilities::platform_projection::apps_bridge::build_apps_bridge_projection(
                "~/.nimi/apps/registry.json".to_string(),
                "~/.nimi/apps/packages.json".to_string(),
            )
            .expect("apps bridge projection");
        assert_eq!(
            bridge_projection.registry_rows.len(),
            nimi_shell_tauri::capabilities::platform_projection::nimi_app_registry::PLATFORM_NIMI_APP_REGISTRY_ROWS
                .len()
        );
    }

    #[test]
    fn tester_consumes_shared_platform_projection_materializers_from_kit() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("nimi-tester-platform-projection-{unique}"));
        let registry_path = dir.join("apps").join("registry.json");
        let factory_path = dir.join("profiles").join("factory-index.json");

        let registry_outcome =
            nimi_shell_tauri::capabilities::platform_projection::apps_registry::materialize_apps_registry_projection(
                &registry_path,
            )
            .expect("materialize registry");
        assert!(matches!(
            registry_outcome,
            nimi_shell_tauri::capabilities::config::ConfigReadOutcome::Ready(_)
        ));
        assert!(registry_path.exists());

        let factory_outcome = nimi_shell_tauri::capabilities::platform_projection::factory_profile_index::materialize_factory_profile_index_projection(
            &factory_path,
        )
        .expect("materialize factory index");
        assert!(matches!(
            factory_outcome,
            nimi_shell_tauri::capabilities::config::ConfigReadOutcome::Ready(_)
        ));
        assert!(factory_path.exists());

        let future_registry_path = dir.join("apps").join("future-registry.json");
        let mut future_registry =
            nimi_shell_tauri::capabilities::platform_projection::apps_registry::build_apps_registry_record()
                .expect("registry record");
        future_registry.schema_version = 9999;
        let future_registry_raw =
            serde_json::to_string_pretty(&future_registry).expect("registry json");
        std::fs::write(&future_registry_path, &future_registry_raw).expect("write registry");

        match nimi_shell_tauri::capabilities::platform_projection::apps_registry::materialize_apps_registry_projection(
            &future_registry_path,
        )
        .expect("future registry materialize")
        {
            nimi_shell_tauri::capabilities::config::ConfigReadOutcome::Repair { severity, reason } => {
                assert_eq!(
                    severity,
                    nimi_shell_tauri::capabilities::config::ConfigRepairSeverity::RepairRequired
                );
                assert!(reason.contains("newer than the supported version"));
            }
            other => panic!("expected registry repair state, got {other:?}"),
        }
        assert_eq!(
            std::fs::read_to_string(&future_registry_path).expect("read registry"),
            future_registry_raw
        );

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
    fn tester_consumes_shared_runtime_account_caller_projection() {
        let caller =
            nimi_shell_tauri::capabilities::local_agent::local_developer_runtime_account_caller(
                "nimi.tester",
            )
            .expect("caller");

        assert_eq!(caller.app_id, "nimi.tester");
        assert_eq!(caller.app_instance_id, "nimi.tester.local-developer");
        assert_eq!(caller.device_id, "local-developer-device");
        assert_eq!(
            caller.mode,
            nimi_shell_tauri::capabilities::runtime::generated::AccountCallerMode::LocalDeveloperApp
                as i32
        );
        assert!(caller.scopes.is_empty());
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
        assert_eq!(
            decoded_response.state,
            nimi_shell_tauri::capabilities::runtime::generated::AccountSessionState::Unspecified
                as i32
        );
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
            nimi_shell_tauri::capabilities::data::plan_directory_cleanup(&data_root, "cache")
                .expect("cache cleanup plan");
        assert!(!cache_plan.requires_confirmation);
        let cache_outcome = nimi_shell_tauri::capabilities::data::execute_directory_cleanup(
            &data_root, "cache", None,
        )
        .expect("cache cleanup");
        assert_eq!(cache_outcome.removed_files, 1);
        assert!(data_root.join("cache").is_dir());

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

    #[test]
    fn tester_consumes_shared_runtime_local_asset_helpers() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time")
            .as_nanos();
        let data_root = std::env::temp_dir().join(format!("nimi-tester-model-root-{unique}"));
        let models_root =
            nimi_shell_tauri::capabilities::local_assets::runtime_models_dir(&data_root);
        std::fs::create_dir_all(&models_root).expect("create models root");
        let manifest = models_root
            .join(nimi_shell_tauri::capabilities::local_assets::ASSET_MANIFEST_FILE_NAME);
        std::fs::write(&manifest, "{}").expect("write manifest");

        let resolved = nimi_shell_tauri::capabilities::local_assets::canonical_asset_manifest_path(
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
        let outside_manifest = outside_dir
            .join(nimi_shell_tauri::capabilities::local_assets::ASSET_MANIFEST_FILE_NAME);
        std::fs::write(&outside_manifest, "{}").expect("write outside manifest");
        let error = nimi_shell_tauri::capabilities::local_assets::canonical_asset_manifest_path(
            &outside_manifest,
            &models_root,
        )
        .expect_err("outside manifest must fail closed");
        assert!(error.starts_with("LOCAL_AI_IMPORT_PATH_OUTSIDE_RUNTIME_ROOT"));

        let asset_dir = models_root.join("asset-1");
        std::fs::create_dir_all(&asset_dir).expect("create asset dir");
        assert_eq!(
            nimi_shell_tauri::capabilities::local_assets::reveal_target_for_asset(
                &models_root,
                "asset-1"
            ),
            asset_dir
        );
        assert_eq!(
            nimi_shell_tauri::capabilities::local_assets::reveal_target_for_asset(
                &models_root,
                "../asset-1"
            ),
            models_root
        );
    }
}
