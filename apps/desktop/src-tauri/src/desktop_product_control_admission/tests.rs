use super::*;
use crate::desktop_product_control::{
    product_control_record_path, read_product_control_projection, select_product_data_root,
    set_first_run_install_level,
};
use crate::test_support::with_env;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

const TEST_ACCOUNT_ID: &str = "account-admission-test";
const TEST_ALIAS: &str = "local-speech-ready";
const TEST_INSTALL_LEVEL: &str = "minimal";
const RECOMMENDED_INSTALL_LEVEL: &str = "recommended";
const VALID_RUNTIME_BASELINE_REF: &str = "runtime-baseline:test-valid";
const VALID_EXECUTION_EVIDENCE_REF: &str = "execution-evidence:test-valid";

fn temp_home(prefix: &str) -> PathBuf {
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("time")
        .as_nanos();
    let dir = std::env::temp_dir().join(format!("nimi-admission-{prefix}-{unique}"));
    std::fs::create_dir_all(&dir).expect("create temp home");
    dir
}

/// Drive an async admission body to completion on a fresh current-thread
/// runtime. `with_env` holds the process-global env mutex, so each test
/// runs its async work in isolation without a shared runtime.
fn run_async<F: std::future::Future<Output = ()>>(future: F) {
    tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("build test runtime")
        .block_on(future);
}

/// Configurable fake [`AdmissionRuntimeResolvers`] — every Runtime owner
/// resolution is a pure in-memory result, so the 8-step composition runs
/// without a live runtime daemon.
struct FakeResolvers {
    account_id: Result<String, String>,
    baseline: Result<RuntimeBaselineResolution, RuntimeOwnerFailure>,
    execution: Result<ExecutionEvidenceResolution, RuntimeOwnerFailure>,
}

impl FakeResolvers {
    /// All four Runtime owner resolutions valid.
    fn all_valid_for_data_root(data_root: &Path) -> Self {
        Self::all_valid_for_data_root_and_level(data_root, TEST_INSTALL_LEVEL)
    }

    fn all_valid_for_data_root_and_level(data_root: &Path, install_level: &str) -> Self {
        FakeResolvers {
            account_id: Ok(TEST_ACCOUNT_ID.to_string()),
            baseline: Ok(RuntimeBaselineResolution {
                runtime_baseline_ref: VALID_RUNTIME_BASELINE_REF.to_string(),
                selected_local_factory_ai_profile_ref: first_run_factory_profile_ref(install_level),
                install_level: install_level.to_string(),
                runtime_data_root_or_data_root_ref: data_root.display().to_string(),
                capability_bindings: fake_baseline_bindings(),
            }),
            execution: Ok(ExecutionEvidenceResolution {
                execution_evidence_ref: VALID_EXECUTION_EVIDENCE_REF.to_string(),
                selected_local_factory_ai_profile_ref: first_run_factory_profile_ref(install_level),
                install_level: install_level.to_string(),
                runtime_baseline_ref: VALID_RUNTIME_BASELINE_REF.to_string(),
                data_root_ref: data_root.display().to_string(),
            }),
        }
    }
}

fn fake_text_generate_binding() -> serde_json::Value {
    serde_json::json!({
        "source": "local",
        "connectorId": "",
        "model": "asset-id:gemma-test",
        "modelId": "asset-id:gemma-test",
        "localModelId": "asset-id:gemma-test",
        "provider": "local",
        "engine": "llama.cpp.cpu",
        "goRuntimeLocalModelId": "asset-id:gemma-test",
        "runtimeBaselineRef": VALID_RUNTIME_BASELINE_REF,
        "runtimeConsumerId": "llama.cpp.cpu",
    })
}

fn fake_stt_binding() -> serde_json::Value {
    serde_json::json!({
        "source": "local",
        "connectorId": "",
        "model": "asset-id:asr-test",
        "modelId": "asset-id:asr-test",
        "localModelId": "asset-id:asr-test",
        "provider": "speech",
        "engine": "speech",
        "goRuntimeLocalModelId": "asset-id:asr-test",
        "runtimeBaselineRef": VALID_RUNTIME_BASELINE_REF,
        "runtimeConsumerId": "speech.qwen3-asr.python",
    })
}

fn fake_tts_binding() -> serde_json::Value {
    serde_json::json!({
        "source": "local",
        "connectorId": "",
        "model": "asset-id:tts-test",
        "modelId": "asset-id:tts-test",
        "localModelId": "asset-id:tts-test",
        "provider": "speech",
        "engine": "speech",
        "goRuntimeLocalModelId": "asset-id:tts-test",
        "runtimeBaselineRef": VALID_RUNTIME_BASELINE_REF,
        "runtimeConsumerId": "speech.qwen3-tts.python",
    })
}

fn fake_baseline_bindings() -> Vec<crate::desktop_ai_config_library::BuiltInAiConfigCapability> {
    vec![
        crate::desktop_ai_config_library::BuiltInAiConfigCapability {
            capability: "audio.synthesize".to_string(),
            binding: fake_tts_binding(),
        },
        crate::desktop_ai_config_library::BuiltInAiConfigCapability {
            capability: "audio.transcribe".to_string(),
            binding: fake_stt_binding(),
        },
        crate::desktop_ai_config_library::BuiltInAiConfigCapability {
            capability: "text.generate".to_string(),
            binding: fake_text_generate_binding(),
        },
    ]
}

impl AdmissionRuntimeResolvers for FakeResolvers {
    async fn resolve_authenticated_account_id(&self) -> Result<String, String> {
        self.account_id.clone()
    }
    async fn resolve_runtime_baseline(
        &self,
        _runtime_baseline_ref: &str,
    ) -> Result<RuntimeBaselineResolution, RuntimeOwnerFailure> {
        self.baseline.clone()
    }
    async fn resolve_execution_evidence(
        &self,
        _execution_evidence_ref: &str,
        _expected_runtime_baseline_ref: &str,
        _expected_data_root_ref: &str,
        _expected_install_level: &str,
    ) -> Result<ExecutionEvidenceResolution, RuntimeOwnerFailure> {
        self.execution.clone()
    }
}

/// Bring the on-disk product-control record to the pre-admission
/// pre-admission `LocalAiReady` state with every locally-owned evidence file seeded and
/// every recorded first-run ref populated. Returns the data root path.
///
/// `account_ref_override` / `aiconfig_refs_override` /
/// `runtime_baseline_ref` / `execution_evidence_ref` let a negative test
/// inject an invalid recorded ref while keeping the rest valid.
fn seed_pre_admission_record(
    home: &Path,
    account_ref_override: Option<String>,
    aiconfig_refs_override: Option<Vec<String>>,
    runtime_baseline_ref: &str,
    execution_evidence_ref: &str,
) -> PathBuf {
    seed_pre_admission_record_at_level(
        home,
        TEST_INSTALL_LEVEL,
        account_ref_override,
        aiconfig_refs_override,
        runtime_baseline_ref,
        execution_evidence_ref,
    )
}

/// Install-level-parameterized variant of [`seed_pre_admission_record`].
/// Every owner evidence file is seeded for `install_level`, so the
/// composed 8-step admission can be exercised for both Minimal and
/// Recommended local install levels.
fn seed_pre_admission_record_at_level(
    home: &Path,
    install_level: &str,
    account_ref_override: Option<String>,
    aiconfig_refs_override: Option<Vec<String>>,
    runtime_baseline_ref: &str,
    execution_evidence_ref: &str,
) -> PathBuf {
    let data_root = home.join("chosen-nimi-data");
    select_product_data_root(data_root.to_str().expect("root")).expect("select root");
    set_first_run_install_level(install_level, Some(TEST_ALIAS.to_string()))
        .expect("install level");

    let account_evidence = crate::account_profile_library::ensure_account_default_profile(
        &data_root,
        TEST_ACCOUNT_ID,
        TEST_ALIAS,
        install_level,
    )
    .expect("seed account default profile");
    let aiconfig_set = crate::desktop_ai_config_library::ensure_built_in_ai_config_evidence_set(
        &data_root,
        TEST_ACCOUNT_ID,
        TEST_ALIAS,
        install_level,
        &fake_baseline_bindings(),
    )
    .expect("seed built-in aiconfig set");

    let control_path = product_control_record_path().expect("path");
    let mut record = crate::desktop_product_control::read_existing_record(&control_path)
        .expect("read")
        .expect("record");
    record.state = ProductControlState::LocalAiReady;
    if let Some(root) = record.data_root.as_mut() {
        root.status = ProductDataRootStatus::Ready;
    }
    record.first_run.account_default_profile_ref = Some(
        account_ref_override
            .unwrap_or_else(|| account_evidence.account_default_profile_ref.clone()),
    );
    record.first_run.built_in_ai_config_refs =
        aiconfig_refs_override.unwrap_or_else(|| aiconfig_set.refs());
    record.first_run.runtime_baseline_ref = Some(runtime_baseline_ref.to_string());
    record.first_run.execution_evidence_ref = Some(execution_evidence_ref.to_string());
    crate::desktop_product_control::write_record(&control_path, &record).expect("write record");
    data_root
}

/// Positive: every owner ref valid -> atomic ready_for_use write with
/// firstRun.completed=true + completedAt.
#[test]
fn admission_with_all_owners_valid_writes_ready_for_use() {
    let home = temp_home("positive");
    with_env(&[("HOME", home.to_str())], || {
        run_async(async {
            let data_root = seed_pre_admission_record(
                &home,
                None,
                None,
                VALID_RUNTIME_BASELINE_REF,
                VALID_EXECUTION_EVIDENCE_REF,
            );
            let projection =
                admit_product_ready_for_use(&FakeResolvers::all_valid_for_data_root(&data_root))
                    .await
                    .expect("admission");
            assert_eq!(projection.state, ProductControlState::ReadyForUse);
            let record = projection.record.expect("record");
            assert!(record.first_run.completed);
            assert!(record
                .first_run
                .completed_at
                .as_deref()
                .is_some_and(|value| !value.trim().is_empty()));
            assert!(record
                .first_run
                .initialization_plan_id
                .as_deref()
                .is_some_and(|value| value.contains(VALID_RUNTIME_BASELINE_REF)));
            assert!(record
                .first_run
                .baseline_profile_ref
                .as_deref()
                .is_some_and(|value| !value.trim().is_empty()));
            assert!(record
                .first_run
                .baseline_commit_id
                .as_deref()
                .is_some_and(|value| !value.trim().is_empty()));
            assert_eq!(
                record.data_root.expect("data root").status,
                ProductDataRootStatus::Ready
            );
        });
    });
}

/// Negative: invalid accountDefaultProfileRef -> account-failure state.
#[test]
fn admission_with_invalid_account_ref_routes_local_ai_ready() {
    let home = temp_home("bad-account");
    with_env(&[("HOME", home.to_str())], || {
        run_async(async {
            let data_root = seed_pre_admission_record(
                &home,
                Some("account-default-profile:fabricated".to_string()),
                None,
                VALID_RUNTIME_BASELINE_REF,
                VALID_EXECUTION_EVIDENCE_REF,
            );
            let projection =
                admit_product_ready_for_use(&FakeResolvers::all_valid_for_data_root(&data_root))
                    .await
                    .expect("admission");
            assert_eq!(projection.state, ProductControlState::LocalAiReady);
            assert!(projection
                .error
                .unwrap_or_default()
                .contains("Account Default Profile owner verification failed"));
        });
    });
}

/// Negative: no authenticated account session -> not_logged_in.
#[test]
fn admission_without_account_session_routes_not_logged_in() {
    let home = temp_home("no-session");
    with_env(&[("HOME", home.to_str())], || {
        run_async(async {
            let data_root = seed_pre_admission_record(
                &home,
                None,
                None,
                VALID_RUNTIME_BASELINE_REF,
                VALID_EXECUTION_EVIDENCE_REF,
            );
            let mut resolvers = FakeResolvers::all_valid_for_data_root(&data_root);
            resolvers.account_id = Err("no authenticated Runtime account session".to_string());
            let projection = admit_product_ready_for_use(&resolvers)
                .await
                .expect("admission");
            assert_eq!(projection.state, ProductControlState::NotLoggedIn);
        });
    });
}

/// Negative: runtime baseline resolver reports state != ready ->
/// LocalAiProfileSelectedEnvironmentNotReady.
#[test]
fn admission_with_runtime_baseline_not_ready_routes_environment_not_ready() {
    let home = temp_home("baseline-not-ready");
    with_env(&[("HOME", home.to_str())], || {
        run_async(async {
            let data_root = seed_pre_admission_record(
                &home,
                None,
                None,
                VALID_RUNTIME_BASELINE_REF,
                VALID_EXECUTION_EVIDENCE_REF,
            );
            let mut resolvers = FakeResolvers::all_valid_for_data_root(&data_root);
            resolvers.baseline = Err(RuntimeOwnerFailure {
                projection_state: concat!("local_", "ai_profile_selected_environment_not_ready")
                    .to_string(),
                detail: "baseline activation evidence missing".to_string(),
            });
            let projection = admit_product_ready_for_use(&resolvers)
                .await
                .expect("admission");
            assert_eq!(
                projection.state,
                ProductControlState::LocalAiProfileSelectedEnvironmentNotReady
            );
        });
    });
}

/// Negative: runtime baseline resolver reports repair_required ->
/// repair_required.
#[test]
fn admission_with_runtime_baseline_repair_required_routes_repair() {
    let home = temp_home("baseline-repair");
    with_env(&[("HOME", home.to_str())], || {
        run_async(async {
            let data_root = seed_pre_admission_record(
                &home,
                None,
                None,
                VALID_RUNTIME_BASELINE_REF,
                VALID_EXECUTION_EVIDENCE_REF,
            );
            let mut resolvers = FakeResolvers::all_valid_for_data_root(&data_root);
            resolvers.baseline = Err(RuntimeOwnerFailure {
                projection_state: "repair_required".to_string(),
                detail: "baseline ref binding mismatch".to_string(),
            });
            let projection = admit_product_ready_for_use(&resolvers)
                .await
                .expect("admission");
            assert_eq!(projection.state, ProductControlState::RepairRequired);
        });
    });
}

/// Negative: partial / string-only builtInAiConfigRefs -> LocalAiReady.
#[test]
fn admission_with_partial_aiconfig_refs_routes_local_ai_ready() {
    let home = temp_home("partial-aiconfig");
    with_env(&[("HOME", home.to_str())], || {
        run_async(async {
            let data_root = seed_pre_admission_record(
                &home,
                None,
                Some(vec!["aiconfig:string-only".to_string()]),
                VALID_RUNTIME_BASELINE_REF,
                VALID_EXECUTION_EVIDENCE_REF,
            );
            let projection =
                admit_product_ready_for_use(&FakeResolvers::all_valid_for_data_root(&data_root))
                    .await
                    .expect("admission");
            assert_eq!(projection.state, ProductControlState::LocalAiReady);
            assert!(projection
                .error
                .unwrap_or_default()
                .contains("built-in AIConfig owner verification failed"));
        });
    });
}

/// Negative: execution evidence resolver reports a non-ready state ->
/// LocalAiReady.
#[test]
fn admission_with_execution_evidence_invalid_routes_local_ai_ready() {
    let home = temp_home("bad-execution");
    with_env(&[("HOME", home.to_str())], || {
        run_async(async {
            let data_root = seed_pre_admission_record(
                &home,
                None,
                None,
                VALID_RUNTIME_BASELINE_REF,
                VALID_EXECUTION_EVIDENCE_REF,
            );
            let mut resolvers = FakeResolvers::all_valid_for_data_root(&data_root);
            resolvers.execution = Err(RuntimeOwnerFailure {
                projection_state: concat!("local_", "ai_ready").to_string(),
                detail: "execution route was not local".to_string(),
            });
            let projection = admit_product_ready_for_use(&resolvers)
                .await
                .expect("admission");
            assert_eq!(projection.state, ProductControlState::LocalAiReady);
        });
    });
}

/// Negative: execution evidence resolver reports blocked -> blocked.
#[test]
fn admission_with_execution_evidence_blocked_routes_blocked() {
    let home = temp_home("execution-blocked");
    with_env(&[("HOME", home.to_str())], || {
        run_async(async {
            let data_root = seed_pre_admission_record(
                &home,
                None,
                None,
                VALID_RUNTIME_BASELINE_REF,
                VALID_EXECUTION_EVIDENCE_REF,
            );
            let mut resolvers = FakeResolvers::all_valid_for_data_root(&data_root);
            resolvers.execution = Err(RuntimeOwnerFailure {
                projection_state: concat!("local_", "ai_blocked").to_string(),
                detail: "execution failed non-recoverably".to_string(),
            });
            let projection = admit_product_ready_for_use(&resolvers)
                .await
                .expect("admission");
            assert_eq!(projection.state, ProductControlState::Blocked);
        });
    });
}

/// Idempotent retry: re-admitting an already-ready record with every owner
/// still valid is a no-op success that stays ready_for_use.
#[test]
fn re_admission_with_owners_still_valid_is_noop_success() {
    let home = temp_home("idempotent");
    with_env(&[("HOME", home.to_str())], || {
        run_async(async {
            let data_root = seed_pre_admission_record(
                &home,
                None,
                None,
                VALID_RUNTIME_BASELINE_REF,
                VALID_EXECUTION_EVIDENCE_REF,
            );
            let first =
                admit_product_ready_for_use(&FakeResolvers::all_valid_for_data_root(&data_root))
                    .await
                    .expect("first admission");
            assert_eq!(first.state, ProductControlState::ReadyForUse);
            let second =
                admit_product_ready_for_use(&FakeResolvers::all_valid_for_data_root(&data_root))
                    .await
                    .expect("re-admission");
            assert_eq!(second.state, ProductControlState::ReadyForUse);
            assert!(second.record.expect("record").first_run.completed);
        });
    });
}

/// Evidence invalidation after ready_for_use: re-admitting once a Runtime
/// owner ref no longer resolves routes the record to the failed state.
#[test]
fn re_admission_after_owner_invalidation_routes_failed_state() {
    let home = temp_home("invalidated");
    with_env(&[("HOME", home.to_str())], || {
        run_async(async {
            let data_root = seed_pre_admission_record(
                &home,
                None,
                None,
                VALID_RUNTIME_BASELINE_REF,
                VALID_EXECUTION_EVIDENCE_REF,
            );
            let first =
                admit_product_ready_for_use(&FakeResolvers::all_valid_for_data_root(&data_root))
                    .await
                    .expect("first admission");
            assert_eq!(first.state, ProductControlState::ReadyForUse);
            let mut resolvers = FakeResolvers::all_valid_for_data_root(&data_root);
            resolvers.baseline = Err(RuntimeOwnerFailure {
                projection_state: "repair_required".to_string(),
                detail: "baseline evidence invalidated after ready".to_string(),
            });
            let routed = admit_product_ready_for_use(&resolvers)
                .await
                .expect("re-admission");
            assert_eq!(routed.state, ProductControlState::RepairRequired);
            // The persisted record must no longer be ready_for_use.
            let reread = read_product_control_projection().expect("reread");
            assert_ne!(reread.state, ProductControlState::ReadyForUse);
        });
    });
}

/// Cross-layer acceptance (manual scenario 3): the 8-step admission
/// composition writes `ready_for_use` for a Recommended local install
/// level, not only the Minimal alias. The Runtime baseline resolution must
/// be bound to `recommended` (admission step 5 rejects an install-level
/// mismatch), and every locally-owned owner record is seeded at the
/// Recommended level.
#[test]
fn admission_for_recommended_install_level_writes_ready_for_use() {
    let home = temp_home("recommended");
    with_env(&[("HOME", home.to_str())], || {
        run_async(async {
            let data_root = seed_pre_admission_record_at_level(
                &home,
                RECOMMENDED_INSTALL_LEVEL,
                None,
                None,
                VALID_RUNTIME_BASELINE_REF,
                VALID_EXECUTION_EVIDENCE_REF,
            );
            let mut resolvers = FakeResolvers::all_valid_for_data_root_and_level(
                &data_root,
                RECOMMENDED_INSTALL_LEVEL,
            );
            // Step 5 binds the Runtime baseline readiness to the recorded
            // install level; a Recommended record requires a Recommended
            // baseline resolution.
            resolvers.baseline = Ok(RuntimeBaselineResolution {
                runtime_baseline_ref: VALID_RUNTIME_BASELINE_REF.to_string(),
                selected_local_factory_ai_profile_ref: first_run_factory_profile_ref(
                    RECOMMENDED_INSTALL_LEVEL,
                ),
                install_level: RECOMMENDED_INSTALL_LEVEL.to_string(),
                runtime_data_root_or_data_root_ref: data_root.display().to_string(),
                capability_bindings: fake_baseline_bindings(),
            });
            let projection = admit_product_ready_for_use(&resolvers)
                .await
                .expect("admission");
            assert_eq!(projection.state, ProductControlState::ReadyForUse);
            let record = projection.record.expect("record");
            assert!(record.first_run.completed);
            assert_eq!(
                record.first_run.install_level.as_deref(),
                Some(RECOMMENDED_INSTALL_LEVEL)
            );
            assert!(record
                .first_run
                .completed_at
                .as_deref()
                .is_some_and(|value| !value.trim().is_empty()));
        });
    });
}

/// Cross-layer acceptance: a Recommended record whose Runtime baseline
/// readiness resolves bound to the Minimal install level is rejected by
/// admission step 5 (install-level binding mismatch) and never reaches
/// `ready_for_use`.
#[test]
fn admission_rejects_install_level_mismatch_between_record_and_runtime_baseline() {
    let home = temp_home("level-mismatch");
    with_env(&[("HOME", home.to_str())], || {
        run_async(async {
            let data_root = seed_pre_admission_record_at_level(
                &home,
                RECOMMENDED_INSTALL_LEVEL,
                None,
                None,
                VALID_RUNTIME_BASELINE_REF,
                VALID_EXECUTION_EVIDENCE_REF,
            );
            // FakeResolvers::all_valid reports the Minimal install level.
            let projection =
                admit_product_ready_for_use(&FakeResolvers::all_valid_for_data_root(&data_root))
                    .await
                    .expect("admission");
            assert_ne!(projection.state, ProductControlState::ReadyForUse);
            assert_eq!(
                projection.state,
                ProductControlState::LocalAiProfileSelectedEnvironmentNotReady
            );
            assert!(projection
                .error
                .unwrap_or_default()
                .contains("different install level"));
        });
    });
}

/// Cross-layer negative (distinct from the per-owner Go negatives): a
/// record whose only first-run "evidence" is a transfer/probe/liveness
/// signal — a `transfer_completion`, an `endpoint_probe`, or a
/// `process_liveness` value placed in the recorded evidence refs — is
/// rejected by the admission op itself. None of these are owner-minted
/// evidence; admission re-resolves each ref through its owner/verifier and
/// fails closed without ever writing `ready_for_use`.
#[test]
fn admission_rejects_transfer_probe_liveness_signals_as_first_run_evidence() {
    let signals = [
        ("transfer_completion", "transfer_completion:bytes-copied-ok"),
        ("endpoint_probe", "endpoint_probe:127.0.0.1:health-200"),
        ("process_liveness", "process_liveness:runtime-daemon-up"),
    ];
    for (label, signal_value) in signals {
        let home = temp_home(&format!("signal-{label}"));
        with_env(&[("HOME", home.to_str())], || {
            run_async(async {
                // The recorded accountDefaultProfileRef is a transfer /
                // probe / liveness signal instead of an owner-minted
                // Account Default Profile library ref.
                let data_root = seed_pre_admission_record(
                    &home,
                    Some(signal_value.to_string()),
                    None,
                    VALID_RUNTIME_BASELINE_REF,
                    VALID_EXECUTION_EVIDENCE_REF,
                );
                let projection = admit_product_ready_for_use(
                    &FakeResolvers::all_valid_for_data_root(&data_root),
                )
                .await
                .expect("admission");
                assert_ne!(
                    projection.state,
                    ProductControlState::ReadyForUse,
                    "{label} signal must not admit ready_for_use"
                );
                assert!(projection
                    .error
                    .unwrap_or_default()
                    .contains("Account Default Profile owner verification failed"));
            });
        });
    }
}

/// Renderer-bypass-rejected: a direct file edit of a ready_for_use record
/// whose locally-owned refs do not resolve reads back as a non-ready state.
#[test]
fn directly_edited_ready_record_with_unverified_refs_reads_failed_state() {
    let home = temp_home("file-edit");
    with_env(&[("HOME", home.to_str())], || {
        run_async(async {
            let data_root = seed_pre_admission_record(
                &home,
                None,
                None,
                VALID_RUNTIME_BASELINE_REF,
                VALID_EXECUTION_EVIDENCE_REF,
            );
            let _ = data_root;
            let control_path = product_control_record_path().expect("path");
            let mut record = crate::desktop_product_control::read_existing_record(&control_path)
                .expect("read")
                .expect("record");
            // Fabricate a ready_for_use record by direct file edit: the
            // shape is complete but the refs were never owner-admitted.
            record.state = ProductControlState::ReadyForUse;
            record.first_run.completed = true;
            record.first_run.completed_at = Some("2026-05-20T00:00:00.000Z".to_string());
            record.first_run.initialization_plan_id = Some("fabricated-plan".to_string());
            record.first_run.baseline_profile_ref = Some("profile:fabricated".to_string());
            record.first_run.baseline_commit_id = Some("commit:fabricated".to_string());
            record.first_run.account_default_profile_ref =
                Some("account-default-profile:fabricated".to_string());
            record.first_run.built_in_ai_config_refs =
                vec!["aiconfig:a".to_string(), "aiconfig:b".to_string()];
            record.first_run.runtime_baseline_ref = Some("runtime-baseline:fabricated".to_string());
            record.first_run.execution_evidence_ref =
                Some("execution-evidence:fabricated".to_string());
            std::fs::write(
                &control_path,
                serde_json::to_string_pretty(&record).expect("json"),
            )
            .expect("write fabricated ready record");
            let projection = read_product_control_projection().expect("projection");
            assert_ne!(projection.state, ProductControlState::ReadyForUse);
            assert!(projection
                .error
                .unwrap_or_default()
                .contains("owner admission verification"));
        });
    });
}
