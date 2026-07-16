use std::collections::HashMap;
use std::sync::Arc;

use serde_json::{json, Value as JsonValue};
use tokio::sync::Mutex;
use tonic::transport::Channel;
use tonic::Streaming;

use crate::generated::runtime_agent_service_client::RuntimeAgentServiceClient;
use crate::generated::runtime_app_service_client::RuntimeAppServiceClient;
use crate::generated::{
    AppMessageEvent, GetPublicChatSessionSnapshotRequest, ListLocalAppAgentInventoryRequest,
    ListLocalAppAgentInventoryResponse, OpenConversationAnchorRequest, SendAppMessageRequest,
    SubscribeAppMessagesRequest,
};
use crate::grpc_status::{local_app_error_from_status, local_app_reason_from_proto};
use crate::{
    LocalAppAgentConversationSnapshotRequest, LocalAppAgentInventoryRequest,
    LocalAppAgentOpenConversationRequest, LocalAppAgentProjection, LocalAppAgentSendTurnRequest,
    LocalAppAgentSubscribeTurnRequest, LocalAppOperationError, LocalAppReasonCode,
};

use super::projection::{
    proto_struct, proto_struct_text, proto_struct_to_json, timestamp_projection,
    validate_safe_projection,
};
use super::{invalid_payload, require_text, untrusted};

const RUNTIME_AGENT_TARGET: &str = "runtime.agent";
const RUNTIME_AGENT_TURN_REQUEST: &str = "runtime.agent.turn.request";

pub(super) async fn list_local_app_agent_inventory(
    channel: Channel,
    _request: LocalAppAgentInventoryRequest,
) -> Result<LocalAppAgentProjection, LocalAppOperationError> {
    let response = RuntimeAgentServiceClient::new(channel)
        .list_local_app_agent_inventory(ListLocalAppAgentInventoryRequest {})
        .await
        .map_err(local_app_error_from_status)?
        .into_inner();
    project_local_app_agent_inventory(response)
}

fn project_local_app_agent_inventory(
    response: ListLocalAppAgentInventoryResponse,
) -> Result<LocalAppAgentProjection, LocalAppOperationError> {
    require_text(&response.owner_user_id)?;
    if response.count as usize != response.local_agents.len() || response.local_agents.len() > 200 {
        return Err(untrusted());
    }
    let mut agents = Vec::with_capacity(response.local_agents.len());
    for item in response.local_agents {
        for value in [
            item.local_agent_ref.as_str(),
            item.display_name.as_str(),
            item.owner_user_id.as_str(),
            item.runtime_source_ref.as_str(),
        ] {
            require_text(value)?;
        }
        if item.owner_user_id != response.owner_user_id {
            return Err(untrusted());
        }
        agents.push(json!({
            "localAgentRef": item.local_agent_ref,
            "displayName": item.display_name,
            "ownerUserId": item.owner_user_id,
            "runtimeSourceRef": item.runtime_source_ref,
            "sourceReady": item.source_ready,
        }));
    }
    let value = json!({
        "ownerUserId": response.owner_user_id,
        "count": response.count,
        "localAgents": agents,
    });
    validate_safe_projection(&value)?;
    Ok(LocalAppAgentProjection { value })
}

pub(super) struct TurnStreamState {
    stream: Streaming<AppMessageEvent>,
    last_sequence: u64,
}

pub(super) type TurnStreams = Mutex<HashMap<String, Arc<Mutex<TurnStreamState>>>>;

pub(super) async fn subscribe_local_app_turn(
    channel: Channel,
    turn_streams: &TurnStreams,
    request: LocalAppAgentSubscribeTurnRequest,
) -> Result<LocalAppAgentProjection, LocalAppOperationError> {
    require_text(&request.agent_id)?;
    require_text(&request.conversation_anchor_id)?;
    let expected_cursor = if request.cursor.is_empty() {
        None
    } else {
        Some(
            request
                .cursor
                .parse::<u64>()
                .map_err(|_| invalid_payload())?,
        )
    };
    let key = format!(
        "{}\u{0}{}",
        request.agent_id, request.conversation_anchor_id
    );
    let state = {
        let mut streams = turn_streams.lock().await;
        if let Some(state) = streams.get(&key) {
            state.clone()
        } else {
            if expected_cursor.is_some() {
                return Err(invalid_payload());
            }
            let stream = RuntimeAppServiceClient::new(channel)
                .subscribe_app_messages(SubscribeAppMessagesRequest {
                    app_id: String::new(),
                    subject_user_id: String::new(),
                    cursor: String::new(),
                    from_app_ids: vec![RUNTIME_AGENT_TARGET.to_string()],
                    scoped_binding: None,
                    local_agent_ref: request.agent_id.clone(),
                    conversation_anchor_id: request.conversation_anchor_id.clone(),
                })
                .await
                .map_err(local_app_error_from_status)?
                .into_inner();
            let state = Arc::new(Mutex::new(TurnStreamState {
                stream,
                last_sequence: 0,
            }));
            streams.insert(key, state.clone());
            state
        }
    };
    let mut state = state.lock().await;
    if expected_cursor.is_some_and(|cursor| cursor != state.last_sequence) {
        return Err(invalid_payload());
    }
    let event = state
        .stream
        .message()
        .await
        .map_err(local_app_error_from_status)?
        .ok_or_else(|| {
            LocalAppOperationError::new(LocalAppReasonCode::RuntimeServiceUnavailable, true)
        })?;
    if event.sequence == 0 || event.sequence <= state.last_sequence {
        return Err(untrusted());
    }
    validate_turn_event_correlation(&event, &request)?;
    state.last_sequence = event.sequence;
    let projected = project_app_message_event(event)?;
    Ok(LocalAppAgentProjection {
        value: json!({
            "cursor": state.last_sequence.to_string(),
            "events": [projected],
        }),
    })
}

pub(super) async fn open_local_app_conversation(
    channel: Channel,
    request: LocalAppAgentOpenConversationRequest,
) -> Result<LocalAppAgentProjection, LocalAppOperationError> {
    require_text(&request.agent_id)?;
    if request.requested_anchor_disposition != "create-or-resume"
        && request.requested_anchor_disposition != "create-new"
    {
        return Err(invalid_payload());
    }
    let response = RuntimeAgentServiceClient::new(channel)
        .open_conversation_anchor(OpenConversationAnchorRequest {
            context: None,
            agent_id: request.agent_id.clone(),
            subject_user_id: String::new(),
            metadata: Some(proto_struct(json!({
                "local_app_anchor_disposition": request.requested_anchor_disposition,
            }))?),
            local_agent_ref: String::new(),
            owner_user_id: String::new(),
            runtime_source_ref: String::new(),
        })
        .await
        .map_err(local_app_error_from_status)?
        .into_inner();
    let value = project_conversation_anchor_snapshot(
        response.snapshot.ok_or_else(untrusted)?,
        &request.agent_id,
        None,
    )?;
    Ok(LocalAppAgentProjection { value })
}

pub(super) async fn send_local_app_turn(
    channel: Channel,
    request: LocalAppAgentSendTurnRequest,
) -> Result<LocalAppAgentProjection, LocalAppOperationError> {
    for value in [
        request.agent_id.as_str(),
        request.conversation_anchor_id.as_str(),
        request.client_turn_id.as_str(),
        request.user_text.as_str(),
    ] {
        require_text(value)?;
    }
    let payload = proto_struct(json!({
        "local_agent_ref": request.agent_id,
        "conversation_anchor_id": request.conversation_anchor_id,
        "request_id": request.client_turn_id,
        "messages": [{"role": "user", "content": request.user_text}],
    }))?;
    let response = RuntimeAppServiceClient::new(channel)
        .send_app_message(SendAppMessageRequest {
            from_app_id: String::new(),
            to_app_id: RUNTIME_AGENT_TARGET.to_string(),
            subject_user_id: String::new(),
            message_type: RUNTIME_AGENT_TURN_REQUEST.to_string(),
            payload: Some(payload),
            require_ack: true,
            scoped_binding: None,
        })
        .await
        .map_err(local_app_error_from_status)?
        .into_inner();
    if !response.accepted || response.message_id.trim().is_empty() {
        return Err(local_app_reason_from_proto(response.reason_code)
            .map(|reason| LocalAppOperationError::new(reason, false))
            .unwrap_or_else(untrusted));
    }
    Ok(LocalAppAgentProjection {
        value: json!({
            "messageId": response.message_id,
            "accepted": true,
            "reasonCode": response.reason_code,
        }),
    })
}

pub(super) async fn get_local_app_conversation_snapshot(
    channel: Channel,
    request: LocalAppAgentConversationSnapshotRequest,
) -> Result<LocalAppAgentProjection, LocalAppOperationError> {
    require_text(&request.agent_id)?;
    require_text(&request.conversation_anchor_id)?;
    let response = RuntimeAgentServiceClient::new(channel)
        .get_public_chat_session_snapshot(GetPublicChatSessionSnapshotRequest {
            context: None,
            agent_id: request.agent_id.clone(),
            conversation_anchor_id: request.conversation_anchor_id.clone(),
            request_id: String::new(),
            world_id: String::new(),
        })
        .await
        .map_err(local_app_error_from_status)?
        .into_inner();
    let value = proto_struct_to_json(response.snapshot.ok_or_else(untrusted)?)?;
    validate_safe_projection(&value)?;
    Ok(LocalAppAgentProjection { value })
}

fn project_conversation_anchor_snapshot(
    snapshot: crate::generated::ConversationAnchorSnapshot,
    expected_agent_id: &str,
    expected_anchor_id: Option<&str>,
) -> Result<JsonValue, LocalAppOperationError> {
    let anchor = snapshot.anchor.ok_or_else(untrusted)?;
    require_text(&anchor.conversation_anchor_id)?;
    if anchor.agent_id != expected_agent_id
        || expected_anchor_id.is_some_and(|expected| expected != anchor.conversation_anchor_id)
    {
        return Err(untrusted());
    }
    let metadata = anchor
        .metadata
        .map(proto_struct_to_json)
        .transpose()?
        .unwrap_or_else(|| json!({}));
    validate_safe_projection(&metadata)?;
    let value = json!({
        "anchor": {
            "conversationAnchorId": anchor.conversation_anchor_id,
            "agentId": anchor.agent_id,
            "status": anchor.status,
            "lastTurnId": anchor.last_turn_id,
            "lastMessageId": anchor.last_message_id,
            "createdAt": timestamp_projection(anchor.created_at),
            "updatedAt": timestamp_projection(anchor.updated_at),
            "metadata": metadata,
            "localAgentRef": anchor.local_agent_ref,
        },
        "activeTurnId": snapshot.active_turn_id,
        "activeStreamId": snapshot.active_stream_id,
    });
    validate_safe_projection(&value)?;
    Ok(value)
}

fn validate_turn_event_correlation(
    event: &AppMessageEvent,
    request: &LocalAppAgentSubscribeTurnRequest,
) -> Result<(), LocalAppOperationError> {
    if !event.message_type.starts_with("runtime.agent.turn.") {
        return Err(untrusted());
    }
    let payload = event.payload.as_ref().ok_or_else(untrusted)?;
    let anchor = proto_struct_text(payload, "conversation_anchor_id")
        .or_else(|| proto_struct_text(payload, "conversationAnchorId"))
        .ok_or_else(untrusted)?;
    let agent = proto_struct_text(payload, "local_agent_ref")
        .or_else(|| proto_struct_text(payload, "localAgentRef"))
        .ok_or_else(untrusted)?;
    if anchor != request.conversation_anchor_id || agent != request.agent_id {
        return Err(untrusted());
    }
    Ok(())
}

fn project_app_message_event(event: AppMessageEvent) -> Result<JsonValue, LocalAppOperationError> {
    let payload = event
        .payload
        .map(proto_struct_to_json)
        .transpose()?
        .unwrap_or_else(|| json!({}));
    validate_safe_projection(&payload)?;
    let value = json!({
        "eventType": event.event_type,
        "sequence": event.sequence.to_string(),
        "messageId": event.message_id,
        "messageType": event.message_type,
        "payload": payload,
        "reasonCode": event.reason_code,
        "traceId": event.trace_id,
        "timestamp": timestamp_projection(event.timestamp),
    });
    validate_safe_projection(&value)?;
    Ok(value)
}
