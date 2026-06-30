use super::*;
use std::collections::HashSet;
use std::sync::{Mutex, OnceLock};

pub(super) const RUNTIME_AGENT_GET_AGENT_STATE_METHOD_ID: &str =
    "/nimi.runtime.v1.RuntimeAgentService/GetAgentState";
pub(super) const RUNTIME_AGENT_GET_CANONICAL_MEMORY_BANK_STATUS_METHOD_ID: &str =
    "/nimi.runtime.v1.RuntimeAgentService/GetAgentCanonicalMemoryBankStatus";
pub(super) const RUNTIME_AGENT_REQUEST_CANONICAL_MEMORY_BANK_BIND_METHOD_ID: &str =
    "/nimi.runtime.v1.RuntimeAgentService/RequestAgentCanonicalMemoryBankBind";
pub(super) const RUNTIME_AGENT_LIST_PENDING_HOOKS_METHOD_ID: &str =
    "/nimi.runtime.v1.RuntimeAgentService/ListPendingHooks";
pub(super) const RUNTIME_AGENT_GET_PUBLIC_CHAT_SESSION_SNAPSHOT_METHOD_ID: &str =
    "/nimi.runtime.v1.RuntimeAgentService/GetPublicChatSessionSnapshot";

pub(super) fn fixture_timestamp() -> prost_types::Timestamp {
    prost_types::Timestamp {
        seconds: 1_786_752_000,
        nanos: 0,
    }
}

pub(super) fn normalize_fixture_text(value: &str) -> String {
    value.trim().to_string()
}

pub(super) fn request_identity(
    context: Option<&runtime_bridge_generated::AgentRequestContext>,
    local_agent_ref: &str,
    owner_user_id: &str,
    runtime_source_ref: &str,
) -> (String, String, String) {
    let normalized_local_agent_ref = normalize_fixture_text(local_agent_ref);
    let normalized_owner_user_id = normalize_fixture_text(owner_user_id);
    let normalized_runtime_source_ref = normalize_fixture_text(runtime_source_ref);
    let context_local_agent_ref = context
        .map(|value| normalize_fixture_text(value.local_agent_ref.as_str()))
        .unwrap_or_default();
    let context_owner_user_id = context
        .map(|value| normalize_fixture_text(value.owner_user_id.as_str()))
        .unwrap_or_default();
    let context_runtime_source_ref = context
        .map(|value| normalize_fixture_text(value.runtime_source_ref.as_str()))
        .unwrap_or_default();
    (
        if normalized_local_agent_ref.is_empty() {
            context_local_agent_ref
        } else {
            normalized_local_agent_ref
        },
        if normalized_owner_user_id.is_empty() {
            context_owner_user_id
        } else {
            normalized_owner_user_id
        },
        if normalized_runtime_source_ref.is_empty() {
            context_runtime_source_ref
        } else {
            normalized_runtime_source_ref
        },
    )
}

pub(super) fn runtime_agent_record(
    local_agent_ref: String,
    owner_user_id: String,
    runtime_source_ref: String,
    display_name: String,
) -> runtime_bridge_generated::AgentRecord {
    runtime_bridge_generated::AgentRecord {
        agent_id: local_agent_ref.clone(),
        display_name: if display_name.trim().is_empty() {
            local_agent_ref.clone()
        } else {
            display_name
        },
        lifecycle_status: runtime_bridge_generated::AgentLifecycleStatus::Active as i32,
        autonomy: None,
        metadata: None,
        created_at: Some(fixture_timestamp()),
        updated_at: Some(fixture_timestamp()),
        local_agent_ref,
        owner_user_id,
        runtime_source_ref,
    }
}

pub(super) fn runtime_agent_idle_state(
    owner_user_id: String,
    active_world_id: String,
) -> runtime_bridge_generated::AgentStateProjection {
    runtime_bridge_generated::AgentStateProjection {
        execution_state: runtime_bridge_generated::AgentExecutionState::Idle as i32,
        status_text: "ready".to_string(),
        active_world_id,
        active_user_id: owner_user_id,
        attributes: Default::default(),
        updated_at: Some(fixture_timestamp()),
        current_emotion: String::new(),
    }
}

pub(super) fn runtime_agent_get_response(
    payload: &RuntimeBridgeUnaryPayload,
) -> Result<RuntimeBridgeUnaryResult, String> {
    let request: runtime_bridge_generated::GetAgentRequest = decode_unary_request(payload)?;
    let (local_agent_ref, owner_user_id, runtime_source_ref) =
        request_identity(request.context.as_ref(), request.agent_id.as_str(), "", "");
    Ok(encode_unary_response(
        runtime_bridge_generated::GetAgentResponse {
            agent: Some(runtime_agent_record(
                local_agent_ref,
                owner_user_id,
                runtime_source_ref,
                String::new(),
            )),
        },
    ))
}

pub(super) fn runtime_agent_initialize_response(
    payload: &RuntimeBridgeUnaryPayload,
) -> Result<RuntimeBridgeUnaryResult, String> {
    let request: runtime_bridge_generated::InitializeAgentRequest = decode_unary_request(payload)?;
    let (local_agent_ref, owner_user_id, runtime_source_ref) = request_identity(
        request.context.as_ref(),
        request.local_agent_ref.as_str(),
        request.owner_user_id.as_str(),
        request.runtime_source_ref.as_str(),
    );
    Ok(encode_unary_response(
        runtime_bridge_generated::InitializeAgentResponse {
            agent: Some(runtime_agent_record(
                local_agent_ref,
                owner_user_id.clone(),
                runtime_source_ref,
                request.display_name,
            )),
            state: Some(runtime_agent_idle_state(owner_user_id, request.world_id)),
        },
    ))
}

pub(super) fn runtime_agent_get_state_response(
    payload: &RuntimeBridgeUnaryPayload,
) -> Result<RuntimeBridgeUnaryResult, String> {
    let request: runtime_bridge_generated::GetAgentStateRequest = decode_unary_request(payload)?;
    let (_, owner_user_id, _) =
        request_identity(request.context.as_ref(), request.agent_id.as_str(), "", "");
    Ok(encode_unary_response(
        runtime_bridge_generated::GetAgentStateResponse {
            state: Some(runtime_agent_idle_state(owner_user_id, String::new())),
        },
    ))
}

pub(super) fn runtime_agent_set_presentation_profile_response(
    payload: &RuntimeBridgeUnaryPayload,
) -> Result<RuntimeBridgeUnaryResult, String> {
    let request: runtime_bridge_generated::SetAgentPresentationProfileRequest =
        decode_unary_request(payload)?;
    let profile = match request.mutation {
        Some(
            runtime_bridge_generated::set_agent_presentation_profile_request::Mutation::Profile(
                profile,
            ),
        ) => Some(profile),
        Some(
            runtime_bridge_generated::set_agent_presentation_profile_request::Mutation::Clear(_),
        )
        | None => None,
    };
    Ok(encode_unary_response(
        runtime_bridge_generated::SetAgentPresentationProfileResponse { profile },
    ))
}

pub(super) fn runtime_agent_anchor_snapshot(
    local_agent_ref: String,
    owner_user_id: String,
    runtime_source_ref: String,
    subject_user_id: String,
    conversation_anchor_id: String,
    metadata: Option<prost_types::Struct>,
) -> runtime_bridge_generated::ConversationAnchorSnapshot {
    runtime_bridge_generated::ConversationAnchorSnapshot {
        anchor: Some(runtime_bridge_generated::ConversationAnchor {
            conversation_anchor_id,
            agent_id: local_agent_ref.clone(),
            subject_user_id,
            status: runtime_bridge_generated::ConversationAnchorStatus::Active as i32,
            last_turn_id: String::new(),
            last_message_id: String::new(),
            created_at: Some(fixture_timestamp()),
            updated_at: Some(fixture_timestamp()),
            metadata,
            local_agent_ref,
            owner_user_id,
            runtime_source_ref,
        }),
        active_turn_id: String::new(),
        active_stream_id: String::new(),
    }
}

pub(super) fn runtime_agent_open_anchor_response(
    payload: &RuntimeBridgeUnaryPayload,
) -> Result<RuntimeBridgeUnaryResult, String> {
    let request: runtime_bridge_generated::OpenConversationAnchorRequest =
        decode_unary_request(payload)?;
    let (local_agent_ref, owner_user_id, runtime_source_ref) = request_identity(
        request.context.as_ref(),
        request.local_agent_ref.as_str(),
        request.owner_user_id.as_str(),
        request.runtime_source_ref.as_str(),
    );
    let subject_user_id = normalize_fixture_text(request.subject_user_id.as_str())
        .if_empty_then(owner_user_id.as_str());
    let anchor_id = format!("e2e-anchor:{}", local_agent_ref);
    Ok(encode_unary_response(
        runtime_bridge_generated::OpenConversationAnchorResponse {
            snapshot: Some(runtime_agent_anchor_snapshot(
                local_agent_ref,
                owner_user_id,
                runtime_source_ref,
                subject_user_id,
                anchor_id,
                request.metadata,
            )),
        },
    ))
}

pub(super) fn runtime_agent_get_anchor_snapshot_response(
    payload: &RuntimeBridgeUnaryPayload,
) -> Result<RuntimeBridgeUnaryResult, String> {
    let request: runtime_bridge_generated::GetConversationAnchorSnapshotRequest =
        decode_unary_request(payload)?;
    let (local_agent_ref, owner_user_id, runtime_source_ref) =
        request_identity(request.context.as_ref(), request.agent_id.as_str(), "", "");
    let subject_user_id = request
        .context
        .as_ref()
        .map(|value| normalize_fixture_text(value.subject_user_id.as_str()))
        .unwrap_or_default()
        .if_empty_then(owner_user_id.as_str());
    Ok(encode_unary_response(
        runtime_bridge_generated::GetConversationAnchorSnapshotResponse {
            snapshot: Some(runtime_agent_anchor_snapshot(
                local_agent_ref,
                owner_user_id,
                runtime_source_ref,
                subject_user_id,
                request.conversation_anchor_id,
                None,
            )),
        },
    ))
}

fn fixture_struct(fields: Vec<(&str, prost_types::Value)>) -> prost_types::Struct {
    let mut output = prost_types::Struct::default();
    for (key, value) in fields {
        output.fields.insert(key.to_string(), value);
    }
    output
}

fn fixture_string_value(value: impl Into<String>) -> prost_types::Value {
    prost_types::Value {
        kind: Some(prost_types::value::Kind::StringValue(value.into())),
    }
}

fn fixture_number_value(value: f64) -> prost_types::Value {
    prost_types::Value {
        kind: Some(prost_types::value::Kind::NumberValue(value)),
    }
}

fn fixture_list_value(values: Vec<prost_types::Value>) -> prost_types::Value {
    prost_types::Value {
        kind: Some(prost_types::value::Kind::ListValue(
            prost_types::ListValue { values },
        )),
    }
}

fn fixture_struct_value(value: prost_types::Struct) -> prost_types::Value {
    prost_types::Value {
        kind: Some(prost_types::value::Kind::StructValue(value)),
    }
}

pub(super) fn runtime_agent_public_chat_session_snapshot_response(
    payload: &RuntimeBridgeUnaryPayload,
) -> Result<RuntimeBridgeUnaryResult, String> {
    let request: runtime_bridge_generated::GetPublicChatSessionSnapshotRequest =
        decode_unary_request(payload)?;
    let (local_agent_ref, owner_user_id, runtime_source_ref) =
        request_identity(request.context.as_ref(), request.agent_id.as_str(), "", "");
    let conversation_anchor_id = normalize_fixture_text(request.conversation_anchor_id.as_str())
        .if_empty_then(format!("e2e-anchor:{local_agent_ref}").as_str());
    let request_id = normalize_fixture_text(request.request_id.as_str())
        .if_empty_then(format!("e2e-session-snapshot:{conversation_anchor_id}").as_str());
    let snapshot = fixture_struct(vec![
        ("request_id", fixture_string_value(request_id)),
        (
            "thread_id",
            fixture_string_value(format!("e2e-thread:{conversation_anchor_id}")),
        ),
        (
            "subject_user_id",
            fixture_string_value(owner_user_id.clone()),
        ),
        ("session_status", fixture_string_value("ready")),
        ("transcript_message_count", fixture_number_value(0.0)),
        ("transcript", fixture_list_value(Vec::new())),
        (
            "execution_bindings",
            fixture_struct_value(fixture_struct(vec![
                ("local_agent_ref", fixture_string_value(local_agent_ref)),
                ("owner_user_id", fixture_string_value(owner_user_id)),
                (
                    "runtime_source_ref",
                    fixture_string_value(runtime_source_ref),
                ),
                (
                    "conversation_anchor_id",
                    fixture_string_value(conversation_anchor_id),
                ),
            ])),
        ),
    ]);
    Ok(encode_unary_response(
        runtime_bridge_generated::GetPublicChatSessionSnapshotResponse {
            snapshot: Some(snapshot),
        },
    ))
}

pub(super) fn runtime_agent_list_pending_hooks_response(
    payload: &RuntimeBridgeUnaryPayload,
) -> Result<RuntimeBridgeUnaryResult, String> {
    let _: runtime_bridge_generated::ListPendingHooksRequest = decode_unary_request(payload)?;
    Ok(encode_unary_response(
        runtime_bridge_generated::ListPendingHooksResponse {
            hooks: Vec::new(),
            next_page_token: String::new(),
        },
    ))
}

pub(super) fn runtime_agent_list_conversation_summaries_response(
    payload: &RuntimeBridgeUnaryPayload,
) -> Result<RuntimeBridgeUnaryResult, String> {
    let request: runtime_bridge_generated::ListAgentConversationSummariesRequest =
        decode_unary_request(payload)?;
    let (local_agent_ref, owner_user_id, runtime_source_ref) =
        request_identity(request.context.as_ref(), request.agent_id.as_str(), "", "");
    let subject_user_id = request
        .context
        .as_ref()
        .map(|value| normalize_fixture_text(value.subject_user_id.as_str()))
        .unwrap_or_default()
        .if_empty_then(owner_user_id.as_str());
    let anchor = runtime_agent_anchor_snapshot(
        local_agent_ref.clone(),
        owner_user_id,
        runtime_source_ref,
        subject_user_id,
        format!("e2e-anchor:{}", local_agent_ref),
        None,
    )
    .anchor;
    Ok(encode_unary_response(
        runtime_bridge_generated::ListAgentConversationSummariesResponse {
            summaries: vec![runtime_bridge_generated::AgentConversationSummary {
                anchor,
                title: "CBDB Su Zhe".to_string(),
                last_message_role: String::new(),
                last_message_text: String::new(),
                last_message_id: String::new(),
                transcript_message_count: 0,
                updated_at: Some(fixture_timestamp()),
            }],
            next_page_token: String::new(),
        },
    ))
}

fn canonical_memory_bind_store() -> &'static Mutex<HashSet<String>> {
    static STORE: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
    STORE.get_or_init(|| Mutex::new(HashSet::new()))
}

fn canonical_memory_embedding_profile() -> runtime_bridge_generated::MemoryEmbeddingProfile {
    runtime_bridge_generated::MemoryEmbeddingProfile {
        provider: "local".to_string(),
        model_id: "e2e-memory-embedding".to_string(),
        dimension: 4,
        distance_metric: runtime_bridge_generated::MemoryDistanceMetric::Cosine as i32,
        version: "v1".to_string(),
        migration_policy: runtime_bridge_generated::MemoryMigrationPolicy::Reindex as i32,
        cloud_binding: None,
        local_binding: Some(runtime_bridge_generated::MemoryEmbeddingLocalBindingRef {
            r#ref: Some(
                runtime_bridge_generated::memory_embedding_local_binding_ref::Ref::ReadinessRef(
                    "e2e-memory-embedding".to_string(),
                ),
            ),
        }),
    }
}

fn canonical_memory_status(
    local_agent_ref: &str,
    standard_bound: bool,
) -> runtime_bridge_generated::AgentCanonicalMemoryBankStatus {
    runtime_bridge_generated::AgentCanonicalMemoryBankStatus {
        mode: if standard_bound {
            runtime_bridge_generated::AgentCanonicalMemoryBankMode::Standard as i32
        } else {
            runtime_bridge_generated::AgentCanonicalMemoryBankMode::Baseline as i32
        },
        bank_id: if standard_bound {
            format!("e2e-bank:{local_agent_ref}")
        } else {
            String::new()
        },
        embedding_profile: Some(canonical_memory_embedding_profile()),
        binding_source_kind: "local".to_string(),
        blocked_reason_code: 0,
        pending_cutover: false,
        canonical_bank_status: if standard_bound {
            "bound_equivalent".to_string()
        } else {
            String::new()
        },
        bind_allowed: !standard_bound,
        cutover_allowed: false,
    }
}

pub(super) fn runtime_agent_get_canonical_memory_bank_status_response(
    payload: &RuntimeBridgeUnaryPayload,
) -> Result<RuntimeBridgeUnaryResult, String> {
    let request: runtime_bridge_generated::GetAgentCanonicalMemoryBankStatusRequest =
        decode_unary_request(payload)?;
    let (local_agent_ref, _, _) =
        request_identity(request.context.as_ref(), request.agent_id.as_str(), "", "");
    if local_agent_ref.trim().is_empty() {
        return Err("DESKTOP_E2E_RUNTIME_AGENT_MEMORY_AGENT_ID_REQUIRED".to_string());
    }
    let bound = canonical_memory_bind_store()
        .lock()
        .map_err(|_| "DESKTOP_E2E_RUNTIME_AGENT_MEMORY_BIND_STORE_LOCK_FAILED".to_string())?
        .contains(local_agent_ref.as_str());
    Ok(encode_unary_response(
        runtime_bridge_generated::GetAgentCanonicalMemoryBankStatusResponse {
            status: Some(canonical_memory_status(local_agent_ref.as_str(), bound)),
        },
    ))
}

pub(super) fn runtime_agent_request_canonical_memory_bank_bind_response(
    payload: &RuntimeBridgeUnaryPayload,
) -> Result<RuntimeBridgeUnaryResult, String> {
    let request: runtime_bridge_generated::RequestAgentCanonicalMemoryBankBindRequest =
        decode_unary_request(payload)?;
    let (local_agent_ref, _, _) =
        request_identity(request.context.as_ref(), request.agent_id.as_str(), "", "");
    if local_agent_ref.trim().is_empty() {
        return Err("DESKTOP_E2E_RUNTIME_AGENT_MEMORY_AGENT_ID_REQUIRED".to_string());
    }
    canonical_memory_bind_store()
        .lock()
        .map_err(|_| "DESKTOP_E2E_RUNTIME_AGENT_MEMORY_BIND_STORE_LOCK_FAILED".to_string())?
        .insert(local_agent_ref.clone());
    Ok(encode_unary_response(
        runtime_bridge_generated::RequestAgentCanonicalMemoryBankBindResponse {
            status: Some(canonical_memory_status(local_agent_ref.as_str(), true)),
            outcome: "bound".to_string(),
            blocked_reason_code: 0,
        },
    ))
}

trait EmptyStringFallback {
    fn if_empty_then(self, fallback: &str) -> String;
}

impl EmptyStringFallback for String {
    fn if_empty_then(self, fallback: &str) -> String {
        if self.trim().is_empty() {
            fallback.to_string()
        } else {
            self
        }
    }
}
