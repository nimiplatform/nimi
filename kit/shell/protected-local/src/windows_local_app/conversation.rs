use tokio::sync::mpsc;
use tonic::transport::Channel;

use crate::generated::local_app_conversation_event::Event as ProtoConversationEvent;
use crate::generated::runtime_agent_service_client::RuntimeAgentServiceClient;
use crate::generated::{
    GetLocalAppConversationSnapshotRequest, InterruptLocalAppConversationTurnRequest,
    LocalAppConversationEvent as ProtoLocalAppConversationEvent,
    LocalAppConversationMessageRole as ProtoConversationMessageRole,
    OpenLocalAppConversationRequest, SendLocalAppConversationTurnRequest,
    SubscribeLocalAppConversationEventsRequest,
};
use crate::grpc_status::local_app_error_from_status;
use crate::{
    LocalAppConversationEvent, LocalAppConversationEventKind, LocalAppConversationInterruptRequest,
    LocalAppConversationInterruptResult, LocalAppConversationMessage,
    LocalAppConversationMessageRole, LocalAppConversationOpenRequest,
    LocalAppConversationOpenResult, LocalAppConversationSendRequest,
    LocalAppConversationSendResult, LocalAppConversationSnapshot,
    LocalAppConversationSnapshotRequest, LocalAppConversationSubscribeRequest,
    LocalAppConversationSubscriptionReceiver, LocalAppOperationError,
};

use super::{invalid_payload, untrusted};

const AGENT_HANDLE_PREFIX: &str = "agent_ref_";
const AGENT_HANDLE_SUFFIX_BYTES: usize = 43;
const MAX_SELECTOR_BYTES: usize = 256;
const MAX_REQUEST_ID_BYTES: usize = 256;
const MAX_TEXT_BYTES: usize = 64 * 1024;
const MAX_SNAPSHOT_MESSAGES: usize = 200;
const MAX_SNAPSHOT_TEXT_BYTES: usize = 1024 * 1024;

pub(super) async fn open_conversation(
    channel: Channel,
    request: LocalAppConversationOpenRequest,
) -> Result<LocalAppConversationOpenResult, LocalAppOperationError> {
    require_agent_handle(&request.agent_handle)?;
    let response = RuntimeAgentServiceClient::new(channel)
        .open_local_app_conversation(OpenLocalAppConversationRequest {
            agent_handle: request.agent_handle,
        })
        .await
        .map_err(local_app_error_from_status)?
        .into_inner();
    require_runtime_selector(&response.conversation_anchor_id)?;
    if let Some(turn_id) = response.active_turn_id.as_deref() {
        require_runtime_selector(turn_id)?;
    }
    Ok(LocalAppConversationOpenResult {
        conversation_anchor_id: response.conversation_anchor_id,
        active_turn_id: response.active_turn_id,
    })
}

pub(super) async fn send_turn(
    channel: Channel,
    request: LocalAppConversationSendRequest,
) -> Result<LocalAppConversationSendResult, LocalAppOperationError> {
    require_agent_handle(&request.agent_handle)?;
    require_selector(&request.conversation_anchor_id)?;
    require_bounded_text(&request.request_id, MAX_REQUEST_ID_BYTES, false)?;
    require_bounded_text(&request.text, MAX_TEXT_BYTES, true)?;
    let response = RuntimeAgentServiceClient::new(channel)
        .send_local_app_conversation_turn(SendLocalAppConversationTurnRequest {
            agent_handle: request.agent_handle,
            conversation_anchor_id: request.conversation_anchor_id,
            request_id: request.request_id,
            text: request.text,
        })
        .await
        .map_err(local_app_error_from_status)?
        .into_inner();
    require_runtime_selector(&response.turn_id)?;
    Ok(LocalAppConversationSendResult {
        turn_id: response.turn_id,
    })
}

pub(super) async fn interrupt_turn(
    channel: Channel,
    request: LocalAppConversationInterruptRequest,
) -> Result<LocalAppConversationInterruptResult, LocalAppOperationError> {
    require_agent_handle(&request.agent_handle)?;
    require_selector(&request.conversation_anchor_id)?;
    let response = RuntimeAgentServiceClient::new(channel)
        .interrupt_local_app_conversation_turn(InterruptLocalAppConversationTurnRequest {
            agent_handle: request.agent_handle,
            conversation_anchor_id: request.conversation_anchor_id,
        })
        .await
        .map_err(local_app_error_from_status)?
        .into_inner();
    require_runtime_selector(&response.turn_id)?;
    Ok(LocalAppConversationInterruptResult {
        turn_id: response.turn_id,
    })
}

pub(super) async fn conversation_snapshot(
    channel: Channel,
    request: LocalAppConversationSnapshotRequest,
) -> Result<LocalAppConversationSnapshot, LocalAppOperationError> {
    require_agent_handle(&request.agent_handle)?;
    require_selector(&request.conversation_anchor_id)?;
    let response = RuntimeAgentServiceClient::new(channel)
        .get_local_app_conversation_snapshot(GetLocalAppConversationSnapshotRequest {
            agent_handle: request.agent_handle,
            conversation_anchor_id: request.conversation_anchor_id,
        })
        .await
        .map_err(local_app_error_from_status)?
        .into_inner();
    let snapshot = response.snapshot.ok_or_else(untrusted)?;
    require_runtime_selector(&snapshot.conversation_anchor_id)?;
    if let Some(turn_id) = snapshot.active_turn_id.as_deref() {
        require_runtime_selector(turn_id)?;
    }
    if snapshot.messages.len() > MAX_SNAPSHOT_MESSAGES {
        return Err(untrusted());
    }
    let mut text_bytes = 0usize;
    let messages = snapshot
        .messages
        .into_iter()
        .map(|message| {
            require_runtime_selector(&message.turn_id)?;
            require_bounded_runtime_text(&message.text, MAX_TEXT_BYTES)?;
            text_bytes = text_bytes
                .checked_add(message.text.len())
                .filter(|value| *value <= MAX_SNAPSHOT_TEXT_BYTES)
                .ok_or_else(untrusted)?;
            let role = match ProtoConversationMessageRole::try_from(message.role)
                .map_err(|_| untrusted())?
            {
                ProtoConversationMessageRole::User => LocalAppConversationMessageRole::User,
                ProtoConversationMessageRole::Assistant => {
                    LocalAppConversationMessageRole::Assistant
                }
                ProtoConversationMessageRole::Unspecified => return Err(untrusted()),
            };
            Ok(LocalAppConversationMessage {
                turn_id: message.turn_id,
                role,
                text: message.text,
            })
        })
        .collect::<Result<Vec<_>, _>>()?;
    Ok(LocalAppConversationSnapshot {
        conversation_anchor_id: snapshot.conversation_anchor_id,
        active_turn_id: snapshot.active_turn_id,
        messages,
        truncated_before: snapshot.truncated_before,
    })
}

pub(super) async fn subscribe(
    channel: Channel,
    request: LocalAppConversationSubscribeRequest,
) -> Result<LocalAppConversationSubscriptionReceiver, LocalAppOperationError> {
    require_agent_handle(&request.agent_handle)?;
    require_selector(&request.conversation_anchor_id)?;
    let mut stream = RuntimeAgentServiceClient::new(channel)
        .subscribe_local_app_conversation_events(SubscribeLocalAppConversationEventsRequest {
            agent_handle: request.agent_handle,
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
                    if sender.send(project_event(event)).await.is_err() {
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
    event: ProtoLocalAppConversationEvent,
) -> Result<LocalAppConversationEvent, LocalAppOperationError> {
    require_runtime_selector(&event.conversation_anchor_id)?;
    if event.sequence == 0 {
        return Err(untrusted());
    }
    let projected = match event.event.ok_or_else(untrusted)? {
        ProtoConversationEvent::TurnAccepted(value) => {
            require_runtime_selector(&value.turn_id)?;
            require_bounded_runtime_text(&value.request_id, MAX_REQUEST_ID_BYTES)?;
            LocalAppConversationEventKind::TurnAccepted {
                turn_id: value.turn_id,
                request_id: value.request_id,
            }
        }
        ProtoConversationEvent::TurnStarted(value) => {
            require_runtime_selector(&value.turn_id)?;
            LocalAppConversationEventKind::TurnStarted {
                turn_id: value.turn_id,
            }
        }
        ProtoConversationEvent::TextDelta(value) => {
            require_runtime_selector(&value.turn_id)?;
            require_bounded_runtime_text(&value.text, MAX_TEXT_BYTES)?;
            LocalAppConversationEventKind::TextDelta {
                turn_id: value.turn_id,
                text: value.text,
            }
        }
        ProtoConversationEvent::MessageCommitted(value) => {
            require_runtime_selector(&value.turn_id)?;
            require_runtime_selector(&value.message_id)?;
            require_bounded_runtime_text(&value.text, MAX_TEXT_BYTES)?;
            LocalAppConversationEventKind::MessageCommitted {
                turn_id: value.turn_id,
                message_id: value.message_id,
                text: value.text,
            }
        }
        ProtoConversationEvent::TurnCompleted(value) => {
            require_runtime_selector(&value.turn_id)?;
            if !valid_terminal_reason(&value.terminal_reason) {
                return Err(untrusted());
            }
            LocalAppConversationEventKind::TurnCompleted {
                turn_id: value.turn_id,
                terminal_reason: value.terminal_reason,
            }
        }
        ProtoConversationEvent::TurnFailed(value) => {
            require_runtime_selector(&value.turn_id)?;
            if !valid_reason_code(&value.reason_code)
                || value
                    .message
                    .as_deref()
                    .is_some_and(|message| require_bounded_runtime_text(message, 1024).is_err())
            {
                return Err(untrusted());
            }
            LocalAppConversationEventKind::TurnFailed {
                turn_id: value.turn_id,
                reason_code: value.reason_code,
                message: value.message,
            }
        }
        ProtoConversationEvent::TurnInterrupted(value) => {
            require_runtime_selector(&value.turn_id)?;
            if !valid_interrupt_reason(&value.reason) {
                return Err(untrusted());
            }
            LocalAppConversationEventKind::TurnInterrupted {
                turn_id: value.turn_id,
                reason: value.reason,
            }
        }
    };
    Ok(LocalAppConversationEvent {
        conversation_anchor_id: event.conversation_anchor_id,
        sequence: event.sequence,
        event: projected,
    })
}

fn require_agent_handle(value: &str) -> Result<(), LocalAppOperationError> {
    if value.len() != AGENT_HANDLE_PREFIX.len() + AGENT_HANDLE_SUFFIX_BYTES
        || !value.starts_with(AGENT_HANDLE_PREFIX)
        || !value
            .bytes()
            .skip(AGENT_HANDLE_PREFIX.len())
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
    {
        return Err(invalid_payload());
    }
    Ok(())
}

fn require_selector(value: &str) -> Result<(), LocalAppOperationError> {
    if value.is_empty()
        || value.trim() != value
        || value.len() > MAX_SELECTOR_BYTES
        || value.chars().any(char::is_control)
    {
        return Err(invalid_payload());
    }
    Ok(())
}

fn require_runtime_selector(value: &str) -> Result<(), LocalAppOperationError> {
    require_selector(value).map_err(|_| untrusted())
}

fn require_bounded_text(
    value: &str,
    max_bytes: usize,
    allow_outer_whitespace: bool,
) -> Result<(), LocalAppOperationError> {
    if value.is_empty()
        || value.len() > max_bytes
        || value.contains('\0')
        || value.trim().is_empty()
        || (!allow_outer_whitespace && value.trim() != value)
    {
        return Err(invalid_payload());
    }
    Ok(())
}

fn require_bounded_runtime_text(
    value: &str,
    max_bytes: usize,
) -> Result<(), LocalAppOperationError> {
    if value.is_empty()
        || value.len() > max_bytes
        || value.contains('\0')
        || value.trim().is_empty()
    {
        return Err(untrusted());
    }
    Ok(())
}

fn valid_terminal_reason(value: &str) -> bool {
    matches!(
        value,
        "" | "stop" | "length" | "tool_call" | "content_filter" | "error" | "unspecified"
    )
}

fn valid_interrupt_reason(value: &str) -> bool {
    matches!(
        value,
        "user_cancel"
            | "room_closed"
            | "superseded_turn"
            | "budget_exhausted"
            | "timeout"
            | "gateway_revoked"
            | "policy_refusal"
    )
}

fn valid_reason_code(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value.trim() == value
        && value.bytes().all(|byte| {
            byte.is_ascii_uppercase() || byte.is_ascii_digit() || byte == b'_' || byte == b'-'
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::generated::{
        local_app_conversation_event, LocalAppConversationTextDelta,
        LocalAppConversationTurnCompleted,
    };

    #[test]
    fn typed_event_projection_has_no_generic_payload_or_message_type() {
        let projected = project_event(ProtoLocalAppConversationEvent {
            conversation_anchor_id: "agent_anchor_01J".to_string(),
            sequence: 3,
            event: Some(local_app_conversation_event::Event::TextDelta(
                LocalAppConversationTextDelta {
                    turn_id: "agent_turn_01J".to_string(),
                    text: "hello".to_string(),
                },
            )),
        })
        .expect("typed event");
        assert_eq!(
            projected.event,
            LocalAppConversationEventKind::TextDelta {
                turn_id: "agent_turn_01J".to_string(),
                text: "hello".to_string(),
            }
        );
    }

    #[test]
    fn event_projection_rejects_unknown_terminal_reason_and_missing_union() {
        assert!(project_event(ProtoLocalAppConversationEvent {
            conversation_anchor_id: "agent_anchor_01J".to_string(),
            sequence: 1,
            event: Some(local_app_conversation_event::Event::TurnCompleted(
                LocalAppConversationTurnCompleted {
                    turn_id: "agent_turn_01J".to_string(),
                    terminal_reason: "provider_private".to_string(),
                },
            )),
        })
        .is_err());
        assert!(project_event(ProtoLocalAppConversationEvent {
            conversation_anchor_id: "agent_anchor_01J".to_string(),
            sequence: 1,
            event: None,
        })
        .is_err());
    }
}
