use super::{
    built_in_ai_config_path, compute_config_content_hash, config_record_temp_path, data_root_ref,
    ensure_built_in_ai_config, ensure_built_in_ai_config_evidence_set,
    runtime_capability_bindings_from_execution_evidence_ref,
    verify_built_in_ai_config_evidence_set, verify_built_in_ai_config_ref, BuiltInAiConfigRecord,
};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Barrier};
use std::thread;
use std::time::{SystemTime, UNIX_EPOCH};

const ALIAS: &str = "local-speech-ready";
const LEVEL: &str = "minimal";

fn text_binding() -> serde_json::Value {
    serde_json::json!({
        "kind": "local-runtime",
        "version": "v2",
        "readinessRef": "execution_evidence_test",
        "runtime": {
            "runtimeBaselineRef": "runtime-baseline:test",
            "runtimeConsumerId": "llama.cpp.cpu",
            "boundAssetId": "asset-id:gemma-test",
            "runtimeLocalRouteTarget": "local",
            "modelResolved": "asset-id:gemma-test",
            "runtimeExecutionTraceId": "trace:llama.cpp.cpu",
        },
    })
}

fn stt_binding() -> serde_json::Value {
    serde_json::json!({
        "kind": "local-runtime",
        "version": "v2",
        "readinessRef": "execution_evidence_test",
        "runtime": {
            "runtimeBaselineRef": "runtime-baseline:test",
            "runtimeConsumerId": "speech.qwen3-asr.python",
            "boundAssetId": "asset-id:asr-test",
            "runtimeLocalRouteTarget": "speech",
            "modelResolved": "asset-id:asr-test",
            "runtimeExecutionTraceId": "trace:speech.qwen3-asr.python",
        },
    })
}

fn tts_binding() -> serde_json::Value {
    serde_json::json!({
        "kind": "local-runtime",
        "version": "v2",
        "readinessRef": "execution_evidence_test",
        "runtime": {
            "runtimeBaselineRef": "runtime-baseline:test",
            "runtimeConsumerId": "speech.qwen3-tts.python",
            "boundAssetId": "asset-id:tts-test",
            "runtimeLocalRouteTarget": "speech",
            "modelResolved": "asset-id:tts-test",
            "runtimeExecutionTraceId": "trace:speech.qwen3-tts.python",
        },
    })
}

fn baseline_bindings() -> Vec<super::BuiltInAiConfigCapability> {
    vec![
        super::BuiltInAiConfigCapability {
            capability: "audio.synthesize".to_string(),
            binding: tts_binding(),
        },
        super::BuiltInAiConfigCapability {
            capability: "audio.transcribe".to_string(),
            binding: stt_binding(),
        },
        super::BuiltInAiConfigCapability {
            capability: "text.generate".to_string(),
            binding: text_binding(),
        },
    ]
}

fn runtime_execution_proof(
    capability: &str,
    scenario_type: crate::runtime_bridge::generated::ScenarioType,
    consumer_id: &str,
    bound_asset_id: &str,
    local_route_target: &str,
) -> crate::runtime_bridge::generated::ExecutionBaselineCapabilityProof {
    crate::runtime_bridge::generated::ExecutionBaselineCapabilityProof {
        capability: capability.to_string(),
        scenario_type: scenario_type as i32,
        bound_consumer_id: consumer_id.to_string(),
        bound_asset_id: bound_asset_id.to_string(),
        local_route_target: local_route_target.to_string(),
        route_policy: crate::runtime_bridge::generated::RoutePolicy::Local as i32,
        model_resolved: bound_asset_id.to_string(),
        terminal_result: "local_executed".to_string(),
        reason_code: "FIRST_RUN_EXECUTION_EVIDENCE_READY".to_string(),
        trace_id: format!("trace:{consumer_id}"),
        executed_at: "2026-01-01T00:00:00Z".to_string(),
    }
}

fn runtime_execution_evidence_ref(
    proofs: Vec<crate::runtime_bridge::generated::ExecutionBaselineCapabilityProof>,
) -> crate::runtime_bridge::generated::ExecutionEvidenceRef {
    crate::runtime_bridge::generated::ExecutionEvidenceRef {
        execution_evidence_ref: "execution_evidence_test".to_string(),
        selected_local_factory_ai_profile_ref: format!("factory:{ALIAS}"),
        install_level: LEVEL.to_string(),
        runtime_baseline_ref: "runtime-baseline:test".to_string(),
        data_root_ref: "data-root:test".to_string(),
        local_execution_target_evidence: Vec::new(),
        selected_baseline_capability_proof: proofs,
        submit_specific_scheduling_judgement: None,
        terminal_result: "local_ai_ready".to_string(),
        observed_at: "2026-01-01T00:00:00Z".to_string(),
        runtime_audit_sequence: Vec::new(),
        runtime_verifier_identity: "runtime-local-service".to_string(),
    }
}

fn ready_runtime_execution_evidence_ref() -> crate::runtime_bridge::generated::ExecutionEvidenceRef
{
    runtime_execution_evidence_ref(vec![
        runtime_execution_proof(
            "local_text_chat_execution",
            crate::runtime_bridge::generated::ScenarioType::TextGenerate,
            "llama.cpp.cpu",
            "asset-id:gemma-test",
            "local",
        ),
        runtime_execution_proof(
            "local_basic_stt_execution",
            crate::runtime_bridge::generated::ScenarioType::SpeechTranscribe,
            "speech.qwen3-asr.python",
            "asset-id:asr-test",
            "speech",
        ),
        runtime_execution_proof(
            "local_basic_tts_execution",
            crate::runtime_bridge::generated::ScenarioType::SpeechSynthesize,
            "speech.qwen3-tts.python",
            "asset-id:tts-test",
            "speech",
        ),
    ])
}

fn temp_data_root(prefix: &str) -> PathBuf {
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("time")
        .as_nanos();
    let dir = std::env::temp_dir().join(format!("nimi-built-in-aiconfig-{prefix}-{unique}"));
    std::fs::create_dir_all(&dir).expect("create temp data root");
    dir
}

fn temp_home(prefix: &str) -> PathBuf {
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("time")
        .as_nanos();
    let dir = std::env::temp_dir().join(format!("nimi-built-in-aiconfig-home-{prefix}-{unique}"));
    std::fs::create_dir_all(&dir).expect("create temp home");
    dir
}

fn read_record(path: &Path) -> BuiltInAiConfigRecord {
    serde_json::from_str(&std::fs::read_to_string(path).expect("read built-in ai config"))
        .expect("parse built-in ai config")
}

fn write_record(path: &Path, record: &BuiltInAiConfigRecord) {
    std::fs::write(path, serde_json::to_string_pretty(record).expect("json")).expect("write");
}

fn write_json(path: &Path, value: serde_json::Value) {
    std::fs::write(path, serde_json::to_string_pretty(&value).expect("json")).expect("write json");
}

fn refresh_content_hash(record: &mut BuiltInAiConfigRecord) {
    record.ai_config_content_hash = compute_config_content_hash(record).expect("content hash");
}

// ---- Positive ---------------------------------------------------------

#[test]
fn first_run_materializes_both_canonical_feature_scopes_with_five_projection_fields() {
    let root = temp_data_root("positive");
    let set = ensure_built_in_ai_config_evidence_set(
        &root,
        "account:abc.def+1",
        ALIAS,
        LEVEL,
        &baseline_bindings(),
    )
    .expect("ensure evidence set");

    for (surface, evidence) in [("nimi", &set.nimi), ("agent", &set.agent)] {
        // required_projection[0]: canonical feature-shape scopeRef.
        assert_eq!(evidence.scope_ref.kind, "feature");
        assert_eq!(evidence.scope_ref.owner_id, "desktop.chat");
        assert_eq!(evidence.scope_ref.surface_id, surface);
        // required_projection[1]: applied AIProfile ref + payload hash.
        assert_eq!(evidence.ai_profile_ref.ai_profile_alias, ALIAS);
        assert!(evidence
            .ai_profile_ref
            .profile_payload_hash
            .starts_with("sha256:"));
        // required_projection[2]: committed version + content hash.
        assert_eq!(evidence.ai_config_version, 1);
        assert!(evidence.ai_config_content_hash.starts_with("sha256:"));
        // required_projection[3]: Desktop host writer identity.
        assert_eq!(evidence.writer_identity, "desktop_host_ai_config_service");
        // required_projection[4]: committedAt.
        assert!(!evidence.committed_at.trim().is_empty());
        assert!(built_in_ai_config_path(&root, "account:abc.def+1", surface)
            .expect("path")
            .exists());
    }
    // Both refs resolve back through the host AIConfig service.
    let resolved = verify_built_in_ai_config_evidence_set(
        &root,
        "account:abc.def+1",
        &set.refs(),
        Some(&baseline_bindings()),
    )
    .expect("resolve evidence set");
    assert_eq!(resolved.refs(), set.refs());
    assert_ne!(
        set.nimi.built_in_ai_config_ref,
        set.agent.built_in_ai_config_ref
    );
}

#[test]
fn committed_built_in_config_is_full_materialized_for_factory_capability_set() {
    let root = temp_data_root("materialized");
    let set = ensure_built_in_ai_config_evidence_set(
        &root,
        "account_1",
        ALIAS,
        LEVEL,
        &baseline_bindings(),
    )
    .expect("ensure evidence set");
    let record = read_record(&built_in_ai_config_path(&root, "account_1", "nimi").expect("path"));
    assert!(record
        .config_payload
        .capabilities
        .iter()
        .any(|cap| cap.capability == "text.generate"));
    let text = record
        .config_payload
        .capabilities
        .iter()
        .find(|cap| cap.capability == "text.generate")
        .expect("text.generate");
    assert_eq!(text.binding, text_binding());
    let stt = record
        .config_payload
        .capabilities
        .iter()
        .find(|cap| cap.capability == "audio.transcribe")
        .expect("audio.transcribe");
    assert_eq!(stt.binding, stt_binding());
    let tts = record
        .config_payload
        .capabilities
        .iter()
        .find(|cap| cap.capability == "audio.synthesize")
        .expect("audio.synthesize");
    assert_eq!(tts.binding, tts_binding());
    assert_eq!(set.nimi.ai_profile_ref.install_level, LEVEL);
}

#[test]
fn runtime_execution_proofs_are_required_binding_projection_inputs() {
    let bindings = runtime_capability_bindings_from_execution_evidence_ref(
        &ready_runtime_execution_evidence_ref(),
    )
    .expect("complete Runtime execution proof projects Desktop built-in bindings");
    assert_eq!(bindings, baseline_bindings());

    for (missing_capability, expected) in [
        ("local_text_chat_execution", "text.generate"),
        ("local_basic_stt_execution", "audio.transcribe"),
        ("local_basic_tts_execution", "audio.synthesize"),
    ] {
        let evidence = runtime_execution_evidence_ref(
            ready_runtime_execution_evidence_ref()
                .selected_baseline_capability_proof
                .into_iter()
                .filter(|proof| proof.capability != missing_capability)
                .collect(),
        );
        let error = runtime_capability_bindings_from_execution_evidence_ref(&evidence)
            .expect_err("missing required Runtime execution proof must fail closed");
        assert!(error.contains(expected), "{error}");
    }
}

#[test]
fn existing_valid_records_are_reused_without_rewrite() {
    let root = temp_data_root("idempotent");
    let first = ensure_built_in_ai_config_evidence_set(
        &root,
        "account_1",
        ALIAS,
        LEVEL,
        &baseline_bindings(),
    )
    .expect("first ensure");
    let nimi_path = built_in_ai_config_path(&root, "account_1", "nimi").expect("path");
    let raw_before = std::fs::read_to_string(&nimi_path).expect("read before");
    let second = ensure_built_in_ai_config_evidence_set(
        &root,
        "account_1",
        "local-gpu",
        "recommended",
        &baseline_bindings(),
    )
    .expect("second ensure");
    let raw_after = std::fs::read_to_string(&nimi_path).expect("read after");
    assert_eq!(raw_after, raw_before);
    assert_eq!(first.refs(), second.refs());
}

#[test]
fn config_record_temp_paths_are_unique_for_same_target() {
    let root = temp_data_root("temp-paths");
    let target = built_in_ai_config_path(&root, "account_1", "nimi").expect("path");
    let first = config_record_temp_path(&target);
    let second = config_record_temp_path(&target);

    assert_eq!(first.parent(), target.parent());
    assert_eq!(second.parent(), target.parent());
    assert_ne!(first, target);
    assert_ne!(second, target);
    assert_ne!(first, second);
}

#[test]
fn concurrent_evidence_set_materialization_reuses_single_committed_refs() {
    let root = temp_data_root("concurrent-evidence-set");
    let root = Arc::new(root);
    let bindings = Arc::new(baseline_bindings());
    let barrier = Arc::new(Barrier::new(8));
    let handles = (0..8)
        .map(|_| {
            let root = Arc::clone(&root);
            let bindings = Arc::clone(&bindings);
            let barrier = Arc::clone(&barrier);
            thread::spawn(move || {
                barrier.wait();
                ensure_built_in_ai_config_evidence_set(
                    root.as_ref(),
                    "account_1",
                    ALIAS,
                    LEVEL,
                    bindings.as_ref(),
                )
            })
        })
        .collect::<Vec<_>>();

    let sets = handles
        .into_iter()
        .map(|handle| handle.join().expect("thread joined").expect("ensure set"))
        .collect::<Vec<_>>();
    let refs = sets.first().expect("at least one result").refs();
    for set in &sets {
        assert_eq!(set.refs(), refs);
    }
    verify_built_in_ai_config_evidence_set(
        root.as_ref(),
        "account_1",
        &refs,
        Some(bindings.as_ref()),
    )
    .expect("shared committed refs still verify");
}

// ---- Negative ---------------------------------------------------------

#[test]
fn generic_app_chat_scope_is_rejected_as_built_in_evidence() {
    let root = temp_data_root("generic-scope");
    let set = ensure_built_in_ai_config_evidence_set(
        &root,
        "account_1",
        ALIAS,
        LEVEL,
        &baseline_bindings(),
    )
    .expect("ensure evidence set");
    let path = built_in_ai_config_path(&root, "account_1", "nimi").expect("path");
    let mut record = read_record(&path);
    record.scope_ref.kind = "app".to_string();
    record.scope_ref.owner_id = "desktop".to_string();
    record.scope_ref.surface_id = "chat".to_string();
    record.config_payload.scope_ref = record.scope_ref.clone();
    refresh_content_hash(&mut record);
    write_record(&path, &record);
    let error = verify_built_in_ai_config_ref(
        &root,
        "account_1",
        "nimi",
        &set.nimi.built_in_ai_config_ref,
        Some(&baseline_bindings()),
    )
    .expect_err("generic app scope must fail");
    assert!(error.contains("feature shape") || error.contains("surfaceId"));
}

#[test]
fn omitted_or_empty_scope_surface_id_is_rejected() {
    let root = temp_data_root("omitted-scope");
    let set = ensure_built_in_ai_config_evidence_set(
        &root,
        "account_1",
        ALIAS,
        LEVEL,
        &baseline_bindings(),
    )
    .expect("ensure evidence set");
    let path = built_in_ai_config_path(&root, "account_1", "nimi").expect("path");
    let mut record = serde_json::to_value(read_record(&path)).expect("record json");
    record
        .get_mut("scopeRef")
        .and_then(|value| value.as_object_mut())
        .expect("scopeRef object")
        .insert(
            "surfaceId".to_string(),
            serde_json::Value::String(String::new()),
        );
    write_json(&path, record);
    let error = verify_built_in_ai_config_ref(
        &root,
        "account_1",
        "nimi",
        &set.nimi.built_in_ai_config_ref,
        Some(&baseline_bindings()),
    )
    .expect_err("omitted surfaceId must fail");
    assert!(error.contains("surfaceId") || error.contains("cannot be parsed"));
}

#[test]
fn string_only_and_missing_refs_fail_closed() {
    let root = temp_data_root("string-only");
    let missing = verify_built_in_ai_config_ref(
        &root,
        "account_1",
        "nimi",
        "built-in-ai-config:v1:string-only",
        None,
    )
    .expect_err("missing config must fail");
    assert!(missing.contains("missing or unreadable"));

    let set = ensure_built_in_ai_config_evidence_set(
        &root,
        "account_1",
        ALIAS,
        LEVEL,
        &baseline_bindings(),
    )
    .expect("ensure evidence set");
    let string_only = verify_built_in_ai_config_ref(
        &root,
        "account_1",
        "nimi",
        "built-in-ai-config:v1:string-only",
        None,
    )
    .expect_err("string-only ref must fail");
    assert!(string_only.contains("string-only"));
    // Sanity: the real ref still resolves.
    verify_built_in_ai_config_ref(
        &root,
        "account_1",
        "nimi",
        &set.nimi.built_in_ai_config_ref,
        Some(&baseline_bindings()),
    )
    .expect("real ref resolves");
}

#[test]
fn wrong_account_and_wrong_data_root_fail_closed() {
    let root = temp_data_root("wrong-identity");
    let set = ensure_built_in_ai_config_evidence_set(
        &root,
        "account_1",
        ALIAS,
        LEVEL,
        &baseline_bindings(),
    )
    .expect("ensure evidence set");
    let wrong_account = verify_built_in_ai_config_ref(
        &root,
        "account_2",
        "nimi",
        &set.nimi.built_in_ai_config_ref,
        Some(&baseline_bindings()),
    )
    .expect_err("wrong account must fail");
    assert!(wrong_account.contains("missing or unreadable"));

    let other_root = temp_data_root("wrong-identity-other");
    let wrong_root = verify_built_in_ai_config_ref(
        &other_root,
        "account_1",
        "nimi",
        &set.nimi.built_in_ai_config_ref,
        Some(&baseline_bindings()),
    )
    .expect_err("wrong data root must fail");
    assert!(wrong_root.contains("missing or unreadable"));
}

#[test]
fn content_hash_and_writer_identity_tampering_fail_closed() {
    let root = temp_data_root("tamper");
    let set = ensure_built_in_ai_config_evidence_set(
        &root,
        "account_1",
        ALIAS,
        LEVEL,
        &baseline_bindings(),
    )
    .expect("ensure evidence set");
    let path = built_in_ai_config_path(&root, "account_1", "agent").expect("path");

    let mut record = read_record(&path);
    record.ai_config_content_hash = "sha256:bad".to_string();
    write_record(&path, &record);
    let hash_error = verify_built_in_ai_config_ref(
        &root,
        "account_1",
        "agent",
        &set.agent.built_in_ai_config_ref,
        Some(&baseline_bindings()),
    )
    .expect_err("content hash tampering must fail");
    assert!(hash_error.contains("content hash"));

    let mut record = read_record(&path);
    record.writer_identity = "renderer".to_string();
    refresh_content_hash(&mut record);
    write_record(&path, &record);
    let writer_error = verify_built_in_ai_config_ref(
        &root,
        "account_1",
        "agent",
        &set.agent.built_in_ai_config_ref,
        Some(&baseline_bindings()),
    )
    .expect_err("writer identity tampering must fail");
    assert!(writer_error.contains("writer identity"));
}

#[test]
fn partial_one_of_two_built_in_set_fails_closed() {
    let root = temp_data_root("partial");
    let set = ensure_built_in_ai_config_evidence_set(
        &root,
        "account_1",
        ALIAS,
        LEVEL,
        &baseline_bindings(),
    )
    .expect("ensure evidence set");
    // Only the nimi ref present — not a complete built-in chat set.
    let partial = verify_built_in_ai_config_evidence_set(
        &root,
        "account_1",
        std::slice::from_ref(&set.nimi.built_in_ai_config_ref),
        Some(&baseline_bindings()),
    )
    .expect_err("partial set must fail");
    assert!(partial.contains("exactly 2"));

    // Both refs are the nimi ref — agent scope is missing.
    let duplicate = verify_built_in_ai_config_evidence_set(
        &root,
        "account_1",
        &[
            set.nimi.built_in_ai_config_ref.clone(),
            set.nimi.built_in_ai_config_ref.clone(),
        ],
        Some(&baseline_bindings()),
    )
    .expect_err("duplicate scope must fail");
    assert!(duplicate.contains("duplicate") || duplicate.contains("missing"));
}

#[test]
fn string_only_set_member_fails_closed() {
    let root = temp_data_root("set-string-only");
    let set = ensure_built_in_ai_config_evidence_set(
        &root,
        "account_1",
        ALIAS,
        LEVEL,
        &baseline_bindings(),
    )
    .expect("ensure evidence set");
    let error = verify_built_in_ai_config_evidence_set(
        &root,
        "account_1",
        &[
            set.nimi.built_in_ai_config_ref.clone(),
            "built-in-ai-config:v1:string-only".to_string(),
        ],
        Some(&baseline_bindings()),
    )
    .expect_err("string-only set member must fail");
    assert!(error.contains("does not resolve"));
}

#[test]
fn applying_account_default_profile_does_not_mutate_committed_built_in_evidence() {
    // Wave-10 invariant: replacing the Account Default Profile must not
    // mutate committed built-in AIConfig evidence.
    let root = temp_data_root("aiconfig-isolation");
    let home = temp_home("aiconfig-isolation");
    let set = ensure_built_in_ai_config_evidence_set(
        &root,
        "account_1",
        ALIAS,
        LEVEL,
        &baseline_bindings(),
    )
    .expect("ensure evidence set");
    let nimi_path = built_in_ai_config_path(&root, "account_1", "nimi").expect("path");
    let raw_before = std::fs::read_to_string(&nimi_path).expect("read before");

    let home_str = home.to_str().expect("home path").to_string();
    crate::test_support::with_env(&[("HOME", Some(home_str.as_str()))], || {
        let _ = crate::account_profile_library::ensure_account_default_profile(
            &root,
            "account_1",
            ALIAS,
            LEVEL,
        )
        .expect("ensure account default profile");
    });

    let raw_after = std::fs::read_to_string(&nimi_path).expect("read after");
    assert_eq!(raw_after, raw_before);
    // Built-in evidence still resolves unchanged.
    let resolved = verify_built_in_ai_config_evidence_set(
        &root,
        "account_1",
        &set.refs(),
        Some(&baseline_bindings()),
    )
    .expect("resolve after account profile");
    assert_eq!(resolved.refs(), set.refs());
}

#[test]
fn data_root_ref_requires_absolute_path() {
    let error = data_root_ref(Path::new("relative/path")).expect_err("relative must fail");
    assert!(error.contains("absolute"));
}

#[test]
fn ensure_single_scope_rejects_non_canonical_surface_id() {
    let root = temp_data_root("bad-surface");
    let error = ensure_built_in_ai_config(
        &root,
        "account_1",
        "chat",
        ALIAS,
        LEVEL,
        &baseline_bindings(),
    )
    .expect_err("non-canonical surface must fail");
    assert!(error.contains("surfaceId"));
}
