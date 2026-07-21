use super::*;
use crate::runtime_bridge::{
    generated as runtime_bridge_generated, RuntimeBridgeUnaryPayload, RuntimeBridgeUnaryResult,
};
use crate::test_support::with_env;
use base64::Engine;
use prost::Message;
use serde_json::json;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

#[test]
fn protected_account_status_fixture_projects_anonymous_without_a_realm_user() {
    let temp = temp_fixture_dir("protected-account-anonymous");
    let manifest_path = temp.join("scenario-manifest.json");
    write_fixture_manifest(
        &manifest_path,
        json!({
            "tauriFixture": {},
            "realmFixture": {}
        }),
    );

    with_env(&[("NIMI_E2E_FIXTURE_PATH", manifest_path.to_str())], || {
        let status = runtime_account_session_status_override()
            .expect("protected account status fixture")
            .expect("protected account status override");
        assert_eq!(status.sequence, "1");
        assert_eq!(status.state, "anonymous");
        assert!(status.account_projection.is_none());
        assert_eq!(
            status.reason_code,
            runtime_bridge_generated::ReasonCode::ActionExecuted as i32
        );
    });
    let _ = fs::remove_dir_all(temp);
}

#[test]
fn protected_account_event_stream_fixture_keeps_the_snapshot_open() {
    let temp = temp_fixture_dir("protected-account-events");
    let manifest_path = temp.join("scenario-manifest.json");
    write_fixture_manifest(&manifest_path, json!({ "tauriFixture": {} }));

    with_env(&[("NIMI_E2E_FIXTURE_PATH", manifest_path.to_str())], || {
        let result = runtime_account_session_events_open_override(
            &crate::runtime_bridge::RuntimeBridgeAccountEventsOpenPayload {
                after_sequence: "1".to_string(),
            },
        )
        .expect("protected account event stream fixture")
        .expect("protected account event stream override");
        assert_eq!(result.stream_id, "e2e-account-session-1");
        assert!(runtime_account_session_events_open_override(
            &crate::runtime_bridge::RuntimeBridgeAccountEventsOpenPayload {
                after_sequence: "01".to_string(),
            },
        )
        .is_err());
    });
    let _ = fs::remove_dir_all(temp);
}

#[test]
fn runtime_register_app_fixture_accepts_local_first_party_registration() {
    let request = runtime_bridge_generated::RegisterAppRequest {
        app_id: "nimi.desktop".to_string(),
        app_instance_id: "nimi.desktop.local-first-party".to_string(),
        device_id: "desktop-shell".to_string(),
        app_version: "1".to_string(),
        capabilities: Vec::new(),
        mode_manifest: None,
    };
    let payload = RuntimeBridgeUnaryPayload {
        method_id: nimi_shell_tauri::capabilities::runtime::RUNTIME_AUTH_REGISTER_APP_METHOD_ID
            .to_string(),
        request_bytes_base64: base64::engine::general_purpose::STANDARD
            .encode(request.encode_to_vec()),
        metadata: None,
        authorization: None,
        protected_access_token: None,
        app_session: None,
        timeout_ms: None,
    };

    let result = runtime_register_app_response(&payload).expect("register app response");
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(result.response_bytes_base64)
        .expect("decode response");
    let response = runtime_bridge_generated::RegisterAppResponse::decode(bytes.as_slice())
        .expect("decode register response");
    assert!(response.accepted);
    assert_eq!(response.app_instance_id, "nimi.desktop.local-first-party");
    assert_eq!(
        response.reason_code,
        runtime_bridge_generated::ReasonCode::ActionExecuted as i32
    );
}

#[test]
fn runtime_open_session_fixture_issues_app_session_metadata() {
    let result = runtime_open_session_response(&fixture_payload(
        "/nimi.runtime.v1.RuntimeAuthService/OpenSession",
        runtime_bridge_generated::OpenSessionRequest {
            app_id: "nimi.desktop".to_string(),
            app_instance_id: "nimi.desktop.platform-runtime-session".to_string(),
            device_id: "platform-runtime-session".to_string(),
            subject_user_id: String::new(),
            ttl_seconds: 3600,
        },
    ))
    .expect("open session response");

    let response: runtime_bridge_generated::OpenSessionResponse = decode_fixture_response(result);
    assert_eq!(
        response.session_id,
        "e2e-session:nimi.desktop.platform-runtime-session:platform-runtime-session"
    );
    assert_eq!(
        response.session_token,
        "e2e-session-token:nimi.desktop:nimi.desktop.platform-runtime-session"
    );
    assert_eq!(
        response.reason_code,
        runtime_bridge_generated::ReasonCode::ActionExecuted as i32
    );
    assert!(response.expires_at.is_some());
}

#[test]
fn runtime_package_readiness_fixture_is_opaque_and_unavailable_before_0p() {
    let result = runtime_app_package_readiness_response(&fixture_payload(
        nimi_shell_tauri::capabilities::runtime::RUNTIME_APP_GET_APP_PACKAGE_READINESS_METHOD_ID,
        runtime_bridge_generated::GetAppPackageReadinessRequest {
            app_id: "community.nimi.fixture.immutable".to_string(),
        },
    ))
    .expect("typed unavailable package readiness response");

    let response: runtime_bridge_generated::GetAppPackageReadinessResponse =
        decode_fixture_response(result);
    let projection = response.projection.expect("readiness projection");
    assert_eq!(
        projection.state,
        runtime_bridge_generated::AppPackageReadinessState::Blocked as i32
    );
    assert_eq!(
        projection.reason_code,
        runtime_bridge_generated::ReasonCode::LocalAppOperationUnavailable as i32
    );
    assert_eq!(projection.detail, "immutable_profile_unavailable");
    assert!(projection.release_descriptor_ref.is_empty());
    assert!(projection.expected_version.is_empty());
    assert!(projection.active_version.is_empty());
    assert!(projection.installed_version.is_empty());
    assert!(projection.sha256.is_empty());
    assert!(projection.verification_state.is_empty());
}

fn fixture_payload<Request>(method_id: &str, request: Request) -> RuntimeBridgeUnaryPayload
where
    Request: Message,
{
    RuntimeBridgeUnaryPayload {
        method_id: method_id.to_string(),
        request_bytes_base64: base64::engine::general_purpose::STANDARD
            .encode(request.encode_to_vec()),
        metadata: None,
        authorization: None,
        protected_access_token: None,
        app_session: None,
        timeout_ms: None,
    }
}

fn decode_fixture_response<Response>(result: RuntimeBridgeUnaryResult) -> Response
where
    Response: Message + Default,
{
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(result.response_bytes_base64)
        .expect("decode response");
    Response::decode(bytes.as_slice()).expect("decode fixture response")
}

fn temp_fixture_dir(prefix: &str) -> PathBuf {
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("time")
        .as_nanos();
    let dir = std::env::temp_dir().join(format!(
        "nimi-desktop-e2e-fixture-{prefix}-{}-{unique}",
        std::process::id()
    ));
    fs::create_dir_all(&dir).expect("create temp fixture dir");
    dir
}

fn write_fixture_manifest(path: &Path, value: serde_json::Value) {
    fs::write(
        path,
        format!(
            "{}\n",
            serde_json::to_string_pretty(&value).expect("serialize fixture")
        ),
    )
    .expect("write fixture manifest");
}

fn decode_product_control_projection(result: RuntimeBridgeUnaryResult) -> serde_json::Value {
    let envelope: runtime_bridge_generated::ProductControlProjectionJson =
        decode_fixture_response(result);
    serde_json::from_str(&envelope.json).expect("parse product-control projection json")
}

fn struct_string_field<'a>(value: &'a prost_types::Struct, key: &str) -> Option<&'a str> {
    match value.fields.get(key).and_then(|field| field.kind.as_ref()) {
        Some(prost_types::value::Kind::StringValue(value)) => Some(value.as_str()),
        _ => None,
    }
}

fn struct_number_field(value: &prost_types::Struct, key: &str) -> Option<f64> {
    match value.fields.get(key).and_then(|field| field.kind.as_ref()) {
        Some(prost_types::value::Kind::NumberValue(value)) => Some(*value),
        _ => None,
    }
}

fn struct_value_field<'a>(
    value: &'a prost_types::Struct,
    key: &str,
) -> Option<&'a prost_types::Struct> {
    match value.fields.get(key).and_then(|field| field.kind.as_ref()) {
        Some(prost_types::value::Kind::StructValue(value)) => Some(value),
        _ => None,
    }
}

#[test]
fn runtime_fixture_returns_config_missing_product_control_projection_when_record_absent() {
    let temp = temp_fixture_dir("product-control-missing");
    let manifest_path = temp.join("scenario-manifest.json");
    write_fixture_manifest(
        &manifest_path,
        json!({
            "tauriFixture": {},
            "realmFixture": {}
        }),
    );

    with_env(&[("NIMI_E2E_FIXTURE_PATH", manifest_path.to_str())], || {
        let result = runtime_bridge_unary_override(&fixture_payload(
                nimi_shell_tauri::capabilities::runtime::RUNTIME_LOCAL_GET_PRODUCT_CONTROL_SELECTED_DATA_ROOT_METHOD_ID,
                runtime_bridge_generated::GetProductControlSelectedDataRootRequest {},
            ))
            .expect("fixture override")
            .expect("product-control selected data root override");
        let projection = decode_product_control_projection(result);

        assert_eq!(projection["exists"], false);
        assert_eq!(projection["state"], "config_missing");
        assert_eq!(projection["dataRoot"], serde_json::Value::Null);
        assert!(projection["error"]
            .as_str()
            .unwrap_or_default()
            .contains("selected nimi_data is not ready"));
    });
    let _ = fs::remove_dir_all(temp);
}

#[test]
fn runtime_fixture_returns_selected_data_root_product_control_projection_from_record() {
    let temp = temp_fixture_dir("product-control-ready");
    let data_root = temp.join("nimi-data");
    let manifest_path = temp.join("scenario-manifest.json");
    write_fixture_manifest(
        &manifest_path,
        json!({
            "tauriFixture": {
                "productControlRecord": {
                    "schemaVersion": 1,
                    "installId": "e2e-ready-install",
                    "productVersion": "0.1.0",
                    "state": "ready_for_use",
                    "dataRoot": {
                        "path": data_root.display().to_string(),
                        "status": "ready",
                        "selectedAt": "2026-03-15T00:00:00.000Z",
                        "verifiedAt": "2026-03-15T00:00:00.000Z",
                        "selectedAtUnixMs": 1773532800000_u64,
                        "verifiedAtUnixMs": 1773532800000_u64
                    },
                    "firstRun": {
                        "installLevel": "minimal",
                        "aiProfileAlias": "local-speech-ready",
                        "completed": true,
                        "completedAt": "2026-03-15T00:00:00.000Z",
                        "initializationPlanId": "e2e-first-run-plan",
                        "baselineProfileRef": "aiprofile/nimi.first-run.local-factory.minimal@1",
                        "baselineCommitId": "e2e-fixture",
                        "accountDefaultProfileRef": "account-default:e2e",
                        "builtInAiConfigRefs": ["ai-config:nimi-chat:e2e"],
                        "runtimeBaselineRef": "runtime-baseline:e2e",
                        "executionEvidenceRef": "e2e-ready-entry"
                    },
                    "pointers": {
                        "runtimeConfigPath": data_root.join("runtime").join("config.json").display().to_string()
                    },
                    "repair": {
                        "required": false,
                        "reason": null
                    }
                }
            },
            "realmFixture": {}
        }),
    );

    with_env(&[("NIMI_E2E_FIXTURE_PATH", manifest_path.to_str())], || {
        let result = runtime_bridge_unary_override(&fixture_payload(
                nimi_shell_tauri::capabilities::runtime::RUNTIME_LOCAL_GET_PRODUCT_CONTROL_SELECTED_DATA_ROOT_METHOD_ID,
                runtime_bridge_generated::GetProductControlSelectedDataRootRequest {},
            ))
            .expect("fixture override")
            .expect("product-control selected data root override");
        let projection = decode_product_control_projection(result);

        assert_eq!(projection["exists"], true);
        assert_eq!(projection["state"], "ready_for_use");
        assert_eq!(
            projection["dataRoot"]["path"].as_str(),
            Some(data_root.display().to_string().as_str())
        );
        assert_eq!(projection["error"], serde_json::Value::Null);
    });
    let _ = fs::remove_dir_all(temp);
}

#[test]
fn runtime_fixture_resolves_first_run_execution_evidence_from_product_control_record() {
    let temp = temp_fixture_dir("execution-evidence-ready");
    let data_root = temp.join("nimi-data");
    let manifest_path = temp.join("scenario-manifest.json");
    write_fixture_manifest(
        &manifest_path,
        json!({
            "tauriFixture": {
                "productControlRecord": {
                    "schemaVersion": 1,
                    "installId": "e2e-ready-install",
                    "productVersion": "0.1.0",
                    "state": "ready_for_use",
                    "dataRoot": {
                        "path": data_root.display().to_string(),
                        "status": "ready",
                        "selectedAt": "2026-03-15T00:00:00.000Z",
                        "verifiedAt": "2026-03-15T00:00:00.000Z",
                        "selectedAtUnixMs": 1773532800000_u64,
                        "verifiedAtUnixMs": 1773532800000_u64
                    },
                    "firstRun": {
                        "installLevel": "minimal",
                        "aiProfileAlias": "local-speech-ready",
                        "completed": true,
                        "completedAt": "2026-03-15T00:00:00.000Z",
                        "initializationPlanId": "e2e-first-run-plan",
                        "baselineProfileRef": "aiprofile/nimi.first-run.local-factory.minimal@1",
                        "baselineCommitId": "e2e-fixture",
                        "accountDefaultProfileRef": "account-default:e2e",
                        "builtInAiConfigRefs": [
                            "ai-config:nimi-chat:e2e",
                            "ai-config:character-chat:e2e"
                        ],
                        "runtimeBaselineRef": "runtime-baseline:e2e",
                        "executionEvidenceRef": "e2e-ready-entry"
                    },
                    "pointers": {
                        "runtimeConfigPath": data_root.join("runtime").join("config.json").display().to_string()
                    },
                    "repair": {
                        "required": false,
                        "reason": null
                    }
                }
            },
            "realmFixture": {}
        }),
    );

    with_env(&[("NIMI_E2E_FIXTURE_PATH", manifest_path.to_str())], || {
        let result = runtime_bridge_unary_override(&fixture_payload(
                nimi_shell_tauri::capabilities::runtime::RUNTIME_LOCAL_RESOLVE_FIRST_RUN_EXECUTION_EVIDENCE_METHOD_ID,
                runtime_bridge_generated::ResolveFirstRunExecutionEvidenceRequest {
                    execution_evidence_ref: "e2e-ready-entry".to_string(),
                    expected_runtime_baseline_ref: "runtime-baseline:e2e".to_string(),
                    expected_data_root_ref: data_root.display().to_string(),
                    expected_install_level: "minimal".to_string(),
                    host_profile: None,
                },
            ))
            .expect("fixture override")
            .expect("execution evidence override");
        let response: runtime_bridge_generated::ResolveFirstRunExecutionEvidenceResponse =
            decode_fixture_response(result);
        let evidence = response.r#ref.expect("execution evidence ref");

        assert_eq!(response.state, "local_ai_ready");
        assert_eq!(response.reason_code, "FIRST_RUN_EXECUTION_EVIDENCE_READY");
        assert_eq!(evidence.execution_evidence_ref, "e2e-ready-entry");
        assert_eq!(evidence.runtime_baseline_ref, "runtime-baseline:e2e");
        assert_eq!(evidence.data_root_ref, data_root.display().to_string());
        assert_eq!(evidence.install_level, "minimal");
        assert_eq!(evidence.selected_baseline_capability_proof.len(), 3);

        let mismatch: runtime_bridge_generated::ResolveFirstRunExecutionEvidenceResponse =
            decode_fixture_response(
                runtime_bridge_unary_override(&fixture_payload(
                    nimi_shell_tauri::capabilities::runtime::RUNTIME_LOCAL_RESOLVE_FIRST_RUN_EXECUTION_EVIDENCE_METHOD_ID,
                    runtime_bridge_generated::ResolveFirstRunExecutionEvidenceRequest {
                        execution_evidence_ref: "wrong-evidence".to_string(),
                        expected_runtime_baseline_ref: "runtime-baseline:e2e".to_string(),
                        expected_data_root_ref: data_root.display().to_string(),
                        expected_install_level: "minimal".to_string(),
                        host_profile: None,
                    },
                ))
                .expect("fixture override")
                .expect("execution evidence override"),
            );
        assert_eq!(mismatch.state, "local_ai_blocked");
        assert!(mismatch.r#ref.is_none());
    });
    let _ = fs::remove_dir_all(temp);
}

#[test]
fn runtime_agent_fixture_projects_cbdb_chat_open_chain() {
    let local_agent_ref =
        "local-agent:user-e2e-primary:cbdb-song-slice-real-20260614-agent-8af2c5ca8a".to_string();
    let owner_user_id = "user-e2e-primary".to_string();
    let runtime_source_ref = "cbdb-song-slice-real-20260614-agent-8af2c5ca8a".to_string();
    let context = runtime_bridge_generated::AgentRequestContext {
        app_id: "nimi.desktop".to_string(),
        subject_user_id: owner_user_id.clone(),
        scoped_binding: None,
        owner_user_id: owner_user_id.clone(),
        runtime_source_ref: runtime_source_ref.clone(),
        local_agent_ref: local_agent_ref.clone(),
    };

    let get_agent = runtime_agent_get_response(&fixture_payload(
        nimi_shell_tauri::capabilities::runtime::RUNTIME_AGENT_GET_AGENT_METHOD_ID,
        runtime_bridge_generated::GetAgentRequest {
            context: Some(context.clone()),
            agent_id: local_agent_ref.clone(),
        },
    ))
    .expect("get agent fixture");
    let get_agent_response: runtime_bridge_generated::GetAgentResponse =
        decode_fixture_response(get_agent);
    let agent = get_agent_response.agent.expect("agent projection");
    assert_eq!(agent.local_agent_ref, local_agent_ref);
    assert_eq!(agent.owner_user_id, owner_user_id);
    assert_eq!(agent.runtime_source_ref, runtime_source_ref);
    assert_eq!(
        agent.lifecycle_status,
        runtime_bridge_generated::AgentLifecycleStatus::Active as i32
    );

    let open_anchor = runtime_agent_open_anchor_response(&fixture_payload(
        nimi_shell_tauri::capabilities::runtime::RUNTIME_AGENT_OPEN_CONVERSATION_ANCHOR_METHOD_ID,
        runtime_bridge_generated::OpenConversationAnchorRequest {
            context: Some(context.clone()),
            agent_id: String::new(),
            subject_user_id: owner_user_id.clone(),
            metadata: None,
            local_agent_ref: local_agent_ref.clone(),
            owner_user_id: owner_user_id.clone(),
            runtime_source_ref: runtime_source_ref.clone(),
        },
    ))
    .expect("open anchor fixture");
    let open_anchor_response: runtime_bridge_generated::OpenConversationAnchorResponse =
        decode_fixture_response(open_anchor);
    let anchor = open_anchor_response
        .snapshot
        .and_then(|snapshot| snapshot.anchor)
        .expect("conversation anchor");
    assert_eq!(
        anchor.conversation_anchor_id,
        format!("e2e-anchor:{local_agent_ref}")
    );
    assert_eq!(
        anchor.status,
        runtime_bridge_generated::ConversationAnchorStatus::Active as i32
    );
    assert_eq!(anchor.local_agent_ref, local_agent_ref);

    let summaries = runtime_agent_list_conversation_summaries_response(&fixture_payload(
        nimi_shell_tauri::capabilities::runtime::RUNTIME_AGENT_LIST_AGENT_CONVERSATION_SUMMARIES_METHOD_ID,
        runtime_bridge_generated::ListAgentConversationSummariesRequest {
            context: Some(context),
            agent_id: local_agent_ref.clone(),
            status_filter: vec![runtime_bridge_generated::ConversationAnchorStatus::Active as i32],
            page_size: 1,
            page_token: String::new(),
        },
    ))
    .expect("conversation summaries fixture");
    let summaries_response: runtime_bridge_generated::ListAgentConversationSummariesResponse =
        decode_fixture_response(summaries);
    assert_eq!(summaries_response.summaries.len(), 1);
    assert_eq!(summaries_response.summaries[0].title, "CBDB Su Zhe");
    assert_eq!(
        summaries_response.summaries[0]
            .anchor
            .as_ref()
            .map(|anchor| anchor.local_agent_ref.as_str()),
        Some(local_agent_ref.as_str())
    );
}

#[test]
fn runtime_agent_fixture_projects_session_snapshot_state_and_empty_hooks() {
    let local_agent_ref =
        "local-agent:user-e2e-primary:agent-memory-standard-bind-test".to_string();
    let owner_user_id = "user-e2e-primary".to_string();
    let runtime_source_ref = "agent-memory-standard-bind-test".to_string();
    let context = runtime_bridge_generated::AgentRequestContext {
        app_id: "nimi.desktop".to_string(),
        subject_user_id: owner_user_id.clone(),
        scoped_binding: None,
        owner_user_id: owner_user_id.clone(),
        runtime_source_ref: runtime_source_ref.clone(),
        local_agent_ref: local_agent_ref.clone(),
    };
    let conversation_anchor_id = format!("e2e-anchor:{local_agent_ref}");

    let session_snapshot = runtime_agent_public_chat_session_snapshot_response(&fixture_payload(
        RUNTIME_AGENT_GET_PUBLIC_CHAT_SESSION_SNAPSHOT_METHOD_ID,
        runtime_bridge_generated::GetPublicChatSessionSnapshotRequest {
            context: Some(context.clone()),
            agent_id: local_agent_ref.clone(),
            conversation_anchor_id: conversation_anchor_id.clone(),
            request_id: "fixture-request-1".to_string(),
            world_id: "world-e2e-1".to_string(),
        },
    ))
    .expect("public chat session snapshot fixture");
    let session_snapshot_response: runtime_bridge_generated::GetPublicChatSessionSnapshotResponse =
        decode_fixture_response(session_snapshot);
    let snapshot = session_snapshot_response.snapshot.expect("snapshot struct");
    assert_eq!(
        struct_string_field(&snapshot, "request_id"),
        Some("fixture-request-1")
    );
    assert_eq!(
        struct_string_field(&snapshot, "subject_user_id"),
        Some(owner_user_id.as_str())
    );
    assert_eq!(
        struct_string_field(&snapshot, "session_status"),
        Some("ready")
    );
    assert_eq!(
        struct_number_field(&snapshot, "transcript_message_count"),
        Some(0.0)
    );
    let bindings = struct_value_field(&snapshot, "execution_bindings").expect("execution bindings");
    assert_eq!(
        struct_string_field(bindings, "local_agent_ref"),
        Some(local_agent_ref.as_str())
    );
    assert_eq!(
        struct_string_field(bindings, "conversation_anchor_id"),
        Some(conversation_anchor_id.as_str())
    );

    let state = runtime_agent_get_state_response(&fixture_payload(
        RUNTIME_AGENT_GET_AGENT_STATE_METHOD_ID,
        runtime_bridge_generated::GetAgentStateRequest {
            context: Some(context.clone()),
            agent_id: local_agent_ref.clone(),
        },
    ))
    .expect("agent state fixture");
    let state_response: runtime_bridge_generated::GetAgentStateResponse =
        decode_fixture_response(state);
    let state_projection = state_response.state.expect("state projection");
    assert_eq!(
        state_projection.execution_state,
        runtime_bridge_generated::AgentExecutionState::Idle as i32
    );
    assert_eq!(state_projection.status_text, "ready");
    assert_eq!(state_projection.active_user_id, owner_user_id);

    let hooks = runtime_agent_list_pending_hooks_response(&fixture_payload(
        RUNTIME_AGENT_LIST_PENDING_HOOKS_METHOD_ID,
        runtime_bridge_generated::ListPendingHooksRequest {
            context: Some(context),
            agent_id: local_agent_ref,
            trigger_family_filter: 0,
            admission_state_filter: 0,
            page_size: 50,
            page_token: String::new(),
        },
    ))
    .expect("pending hooks fixture");
    let hooks_response: runtime_bridge_generated::ListPendingHooksResponse =
        decode_fixture_response(hooks);
    assert!(hooks_response.hooks.is_empty());
    assert!(hooks_response.next_page_token.is_empty());
}

#[test]
fn runtime_agent_fixture_projects_canonical_memory_baseline_then_standard_bind() {
    let local_agent_ref =
        "local-agent:user-e2e-primary:agent-memory-standard-bind-test".to_string();
    let owner_user_id = "user-e2e-primary".to_string();
    let runtime_source_ref = "agent-memory-standard-bind-test".to_string();
    let context = runtime_bridge_generated::AgentRequestContext {
        app_id: "nimi.desktop".to_string(),
        subject_user_id: owner_user_id.clone(),
        scoped_binding: None,
        owner_user_id,
        runtime_source_ref,
        local_agent_ref: local_agent_ref.clone(),
    };

    let initial = runtime_agent_get_canonical_memory_bank_status_response(&fixture_payload(
        RUNTIME_AGENT_GET_CANONICAL_MEMORY_BANK_STATUS_METHOD_ID,
        runtime_bridge_generated::GetAgentCanonicalMemoryBankStatusRequest {
            context: Some(context.clone()),
            agent_id: local_agent_ref.clone(),
        },
    ))
    .expect("canonical memory status fixture");
    let initial_response: runtime_bridge_generated::GetAgentCanonicalMemoryBankStatusResponse =
        decode_fixture_response(initial);
    let initial_status = initial_response.status.expect("initial memory status");
    assert_eq!(
        initial_status.mode,
        runtime_bridge_generated::AgentCanonicalMemoryBankMode::Baseline as i32
    );
    assert!(initial_status.bind_allowed);
    assert_eq!(
        initial_status
            .embedding_profile
            .as_ref()
            .map(|profile| profile.model_id.as_str()),
        Some("e2e-memory-embedding")
    );

    let bind = runtime_agent_request_canonical_memory_bank_bind_response(&fixture_payload(
        RUNTIME_AGENT_REQUEST_CANONICAL_MEMORY_BANK_BIND_METHOD_ID,
        runtime_bridge_generated::RequestAgentCanonicalMemoryBankBindRequest {
            context: Some(context),
            agent_id: local_agent_ref.clone(),
        },
    ))
    .expect("canonical memory bind fixture");
    let bind_response: runtime_bridge_generated::RequestAgentCanonicalMemoryBankBindResponse =
        decode_fixture_response(bind);
    assert_eq!(bind_response.outcome, "bound");
    let bind_status = bind_response.status.expect("bound memory status");
    assert_eq!(
        bind_status.mode,
        runtime_bridge_generated::AgentCanonicalMemoryBankMode::Standard as i32
    );
    assert!(!bind_status.bind_allowed);
    assert_eq!(bind_status.bank_id, format!("e2e-bank:{local_agent_ref}"));
    assert_eq!(bind_status.canonical_bank_status, "bound_equivalent");
}
