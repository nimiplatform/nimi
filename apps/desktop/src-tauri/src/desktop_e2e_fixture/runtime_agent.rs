use super::*;

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
    realm_agent_id: &str,
) -> (String, String, String) {
    let normalized_local_agent_ref = normalize_fixture_text(local_agent_ref);
    let normalized_owner_user_id = normalize_fixture_text(owner_user_id);
    let normalized_realm_agent_id = normalize_fixture_text(realm_agent_id);
    let context_local_agent_ref = context
        .map(|value| normalize_fixture_text(value.local_agent_ref.as_str()))
        .unwrap_or_default();
    let context_owner_user_id = context
        .map(|value| normalize_fixture_text(value.owner_user_id.as_str()))
        .unwrap_or_default();
    let context_realm_agent_id = context
        .map(|value| normalize_fixture_text(value.realm_agent_id.as_str()))
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
        if normalized_realm_agent_id.is_empty() {
            context_realm_agent_id
        } else {
            normalized_realm_agent_id
        },
    )
}

pub(super) fn runtime_agent_record(
    local_agent_ref: String,
    owner_user_id: String,
    realm_agent_id: String,
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
        realm_agent_id,
    }
}

pub(super) fn runtime_agent_get_response(
    payload: &RuntimeBridgeUnaryPayload,
) -> Result<RuntimeBridgeUnaryResult, String> {
    let request: runtime_bridge_generated::GetAgentRequest = decode_unary_request(payload)?;
    let (local_agent_ref, owner_user_id, realm_agent_id) =
        request_identity(request.context.as_ref(), request.agent_id.as_str(), "", "");
    Ok(encode_unary_response(
        runtime_bridge_generated::GetAgentResponse {
            agent: Some(runtime_agent_record(
                local_agent_ref,
                owner_user_id,
                realm_agent_id,
                String::new(),
            )),
        },
    ))
}

pub(super) fn runtime_agent_initialize_response(
    payload: &RuntimeBridgeUnaryPayload,
) -> Result<RuntimeBridgeUnaryResult, String> {
    let request: runtime_bridge_generated::InitializeAgentRequest = decode_unary_request(payload)?;
    let (local_agent_ref, owner_user_id, realm_agent_id) = request_identity(
        request.context.as_ref(),
        request.local_agent_ref.as_str(),
        request.owner_user_id.as_str(),
        request.realm_agent_id.as_str(),
    );
    Ok(encode_unary_response(
        runtime_bridge_generated::InitializeAgentResponse {
            agent: Some(runtime_agent_record(
                local_agent_ref,
                owner_user_id,
                realm_agent_id,
                request.display_name,
            )),
            state: Some(runtime_bridge_generated::AgentStateProjection {
                execution_state: runtime_bridge_generated::AgentExecutionState::Idle as i32,
                status_text: "ready".to_string(),
                active_world_id: request.world_id,
                active_user_id: String::new(),
                attributes: Default::default(),
                updated_at: Some(fixture_timestamp()),
                current_emotion: String::new(),
            }),
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
    realm_agent_id: String,
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
            realm_agent_id,
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
    let (local_agent_ref, owner_user_id, realm_agent_id) = request_identity(
        request.context.as_ref(),
        request.local_agent_ref.as_str(),
        request.owner_user_id.as_str(),
        request.realm_agent_id.as_str(),
    );
    let subject_user_id = normalize_fixture_text(request.subject_user_id.as_str())
        .if_empty_then(owner_user_id.as_str());
    let anchor_id = format!("e2e-anchor:{}", local_agent_ref);
    Ok(encode_unary_response(
        runtime_bridge_generated::OpenConversationAnchorResponse {
            snapshot: Some(runtime_agent_anchor_snapshot(
                local_agent_ref,
                owner_user_id,
                realm_agent_id,
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
    let (local_agent_ref, owner_user_id, realm_agent_id) =
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
                realm_agent_id,
                subject_user_id,
                request.conversation_anchor_id,
                None,
            )),
        },
    ))
}

pub(super) fn runtime_agent_list_conversation_summaries_response(
    payload: &RuntimeBridgeUnaryPayload,
) -> Result<RuntimeBridgeUnaryResult, String> {
    let request: runtime_bridge_generated::ListAgentConversationSummariesRequest =
        decode_unary_request(payload)?;
    let (local_agent_ref, owner_user_id, realm_agent_id) =
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
        realm_agent_id,
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
