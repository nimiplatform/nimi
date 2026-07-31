use std::collections::BTreeMap;

use prost_types::{value::Kind, ListValue, Struct, Value};
use serde_json::{Map as JsonMap, Number as JsonNumber, Value as JsonValue};
use tokio::sync::mpsc;
use tonic::transport::Channel;

use crate::generated::runtime_agent_service_client::RuntimeAgentServiceClient;
use crate::generated::runtime_app_service_client::RuntimeAppServiceClient;
use crate::generated::{
    AppMessageEvent, GetPublicChatSessionSnapshotRequest, OpenConversationAnchorRequest,
    SendAppMessageRequest, SubscribeAppMessagesRequest,
};
use crate::grpc_status::{local_app_error_from_status, local_app_reason_from_proto};
use crate::{
    LocalAppConversationEvent, LocalAppConversationInterruptRequest,
    LocalAppConversationInterruptResult, LocalAppConversationOpenRequest,
    LocalAppConversationOpenResult, LocalAppConversationSendRequest,
    LocalAppConversationSendResult, LocalAppConversationSnapshotRequest,
    LocalAppConversationSubscribeRequest, LocalAppConversationSubscriptionReceiver,
    LocalAppOperationError, LocalAppReasonCode,
};

use super::{require_text, untrusted};

const ACTION_EXECUTED: i32 = 1;
const MAX_TEXT_BYTES: usize = 64 * 1024;

pub(super) async fn open_conversation(
    channel: Channel,
    request: LocalAppConversationOpenRequest,
) -> Result<LocalAppConversationOpenResult, LocalAppOperationError> {
    require_text(&request.agent_handle)?;
    let response = RuntimeAgentServiceClient::new(channel)
        .open_conversation_anchor(OpenConversationAnchorRequest {
            context: None,
            agent_id: request.agent_handle,
            subject_user_id: String::new(),
            metadata: None,
            local_agent_ref: String::new(),
            owner_user_id: String::new(),
            runtime_source_ref: String::new(),
        })
        .await
        .map_err(local_app_error_from_status)?
        .into_inner();
    let snapshot = response.snapshot.ok_or_else(untrusted)?;
    let anchor = snapshot.anchor.ok_or_else(untrusted)?;
    require_runtime_text(&anchor.conversation_anchor_id)?;
    Ok(LocalAppConversationOpenResult {
        conversation_anchor_id: anchor.conversation_anchor_id,
        active_turn_id: empty_to_none(snapshot.active_turn_id),
        active_stream_id: empty_to_none(snapshot.active_stream_id),
    })
}

pub(super) async fn send_turn(
    channel: Channel,
    request: LocalAppConversationSendRequest,
) -> Result<LocalAppConversationSendResult, LocalAppOperationError> {
    require_text(&request.agent_handle)?;
    require_text(&request.conversation_anchor_id)?;
    require_text(&request.request_id)?;
    require_text(&request.text)?;
    if request.text.len() > MAX_TEXT_BYTES {
        return Err(LocalAppOperationError::new(
            LocalAppReasonCode::ResourceExhausted,
            false,
        ));
    }
    let payload = Struct {
        fields: BTreeMap::from([
            (
                "local_agent_ref".to_string(),
                string_value(request.agent_handle),
            ),
            (
                "conversation_anchor_id".to_string(),
                string_value(request.conversation_anchor_id),
            ),
            ("request_id".to_string(), string_value(request.request_id)),
            (
                "messages".to_string(),
                Value {
                    kind: Some(Kind::ListValue(ListValue {
                        values: vec![Value {
                            kind: Some(Kind::StructValue(Struct {
                                fields: BTreeMap::from([
                                    ("role".to_string(), string_value("user".to_string())),
                                    ("content".to_string(), string_value(request.text)),
                                ]),
                            })),
                        }],
                    })),
                },
            ),
        ]),
    };
    let response = RuntimeAppServiceClient::new(channel)
        .send_app_message(SendAppMessageRequest {
            from_app_id: String::new(),
            to_app_id: "runtime.agent".to_string(),
            subject_user_id: String::new(),
            message_type: "runtime.agent.turn.request".to_string(),
            payload: Some(payload),
            require_ack: true,
        })
        .await
        .map_err(local_app_error_from_status)?
        .into_inner();
    if !response.accepted || response.reason_code != ACTION_EXECUTED {
        return Err(untrusted());
    }
    require_runtime_text(&response.message_id)?;
    Ok(LocalAppConversationSendResult {
        message_id: response.message_id,
    })
}

pub(super) async fn interrupt_turn(
    channel: Channel,
    request: LocalAppConversationInterruptRequest,
) -> Result<LocalAppConversationInterruptResult, LocalAppOperationError> {
    require_text(&request.agent_handle)?;
    require_text(&request.conversation_anchor_id)?;
    let payload = Struct {
        fields: BTreeMap::from([
            (
                "local_agent_ref".to_string(),
                string_value(request.agent_handle),
            ),
            (
                "conversation_anchor_id".to_string(),
                string_value(request.conversation_anchor_id),
            ),
            (
                "reason".to_string(),
                string_value("user_cancel".to_string()),
            ),
        ]),
    };
    let response = RuntimeAppServiceClient::new(channel)
        .send_app_message(SendAppMessageRequest {
            from_app_id: String::new(),
            to_app_id: "runtime.agent".to_string(),
            subject_user_id: String::new(),
            message_type: "runtime.agent.turn.interrupt".to_string(),
            payload: Some(payload),
            require_ack: true,
        })
        .await
        .map_err(local_app_error_from_status)?
        .into_inner();
    if !response.accepted || response.reason_code != ACTION_EXECUTED {
        return Err(untrusted());
    }
    require_runtime_text(&response.message_id)?;
    Ok(LocalAppConversationInterruptResult {
        message_id: response.message_id,
    })
}

pub(super) async fn conversation_snapshot(
    channel: Channel,
    request: LocalAppConversationSnapshotRequest,
) -> Result<JsonValue, LocalAppOperationError> {
    require_text(&request.agent_handle)?;
    require_text(&request.conversation_anchor_id)?;
    let response = RuntimeAgentServiceClient::new(channel)
        .get_public_chat_session_snapshot(GetPublicChatSessionSnapshotRequest {
            context: None,
            agent_id: request.agent_handle,
            conversation_anchor_id: request.conversation_anchor_id,
            request_id: String::new(),
            world_id: String::new(),
        })
        .await
        .map_err(local_app_error_from_status)?
        .into_inner();
    struct_to_json(response.snapshot.ok_or_else(untrusted)?)
}

pub(super) async fn subscribe(
    channel: Channel,
    request: LocalAppConversationSubscribeRequest,
) -> Result<LocalAppConversationSubscriptionReceiver, LocalAppOperationError> {
    require_text(&request.agent_handle)?;
    require_text(&request.conversation_anchor_id)?;
    let mut stream = RuntimeAppServiceClient::new(channel)
        .subscribe_app_messages(SubscribeAppMessagesRequest {
            app_id: String::new(),
            subject_user_id: String::new(),
            cursor: String::new(),
            from_app_ids: vec!["runtime.agent".to_string()],
            local_agent_ref: request.agent_handle,
            conversation_anchor_id: request.conversation_anchor_id,
        })
        .await
        .map_err(local_app_error_from_status)?
        .into_inner();
    let (sender, receiver) = mpsc::channel(32);
    tokio::spawn(async move {
        loop {
            match stream.message().await {
                Ok(Some(event)) => {
                    let projected = project_event(event);
                    if sender.send(projected).await.is_err() {
                        break;
                    }
                }
                Ok(None) => break,
                Err(status) => {
                    let _ = sender.send(Err(local_app_error_from_status(status))).await;
                    break;
                }
            }
        }
    });
    Ok(receiver)
}

fn project_event(
    event: AppMessageEvent,
) -> Result<LocalAppConversationEvent, LocalAppOperationError> {
    let reason_code = local_app_reason_from_proto(event.reason_code).ok_or_else(untrusted)?;
    Ok(LocalAppConversationEvent {
        event_type: event.event_type,
        sequence: event.sequence,
        message_id: event.message_id,
        message_type: event.message_type,
        payload: event
            .payload
            .map(struct_to_json)
            .transpose()?
            .unwrap_or(JsonValue::Null),
        reason_code,
        trace_id: event.trace_id,
        timestamp_unix_ms: event
            .timestamp
            .map(|value| value.seconds.saturating_mul(1000) + i64::from(value.nanos) / 1_000_000),
    })
}

fn string_value(value: String) -> Value {
    Value {
        kind: Some(Kind::StringValue(value)),
    }
}
fn empty_to_none(value: String) -> Option<String> {
    (!value.is_empty()).then_some(value)
}
fn require_runtime_text(value: &str) -> Result<(), LocalAppOperationError> {
    if value.is_empty() || value.trim() != value {
        Err(untrusted())
    } else {
        Ok(())
    }
}

fn struct_to_json(value: Struct) -> Result<JsonValue, LocalAppOperationError> {
    let mut fields = JsonMap::new();
    for (key, value) in value.fields {
        fields.insert(key, proto_value_to_json(value)?);
    }
    Ok(JsonValue::Object(fields))
}

fn proto_value_to_json(value: Value) -> Result<JsonValue, LocalAppOperationError> {
    Ok(match value.kind.ok_or_else(untrusted)? {
        Kind::NullValue(_) => JsonValue::Null,
        Kind::NumberValue(value) => JsonNumber::from_f64(value)
            .map(JsonValue::Number)
            .ok_or_else(untrusted)?,
        Kind::StringValue(value) => JsonValue::String(value),
        Kind::BoolValue(value) => JsonValue::Bool(value),
        Kind::StructValue(value) => struct_to_json(value)?,
        Kind::ListValue(value) => JsonValue::Array(
            value
                .values
                .into_iter()
                .map(proto_value_to_json)
                .collect::<Result<_, _>>()?,
        ),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn struct_projection_is_closed_and_lossless() {
        let value = Struct {
            fields: BTreeMap::from([("text".to_string(), string_value("hello".to_string()))]),
        };
        assert_eq!(
            struct_to_json(value).unwrap(),
            serde_json::json!({"text": "hello"})
        );
    }
}
