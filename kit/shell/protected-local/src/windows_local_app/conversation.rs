use serde_json::{json, Value as JsonValue};
use tokio::sync::mpsc;
use tonic::transport::Channel;

use crate::generated::local_app_conversation_event::Event as ProtoConversationEvent;
use crate::generated::local_app_conversation_input_part::Part as ProtoConversationInputPartValue;
use crate::generated::local_app_conversation_message_part::Part as ProtoMessagePart;
use crate::generated::{
    GetLocalAppConversationSnapshotRequest, InterruptLocalAppConversationTurnRequest,
    LocalAppConversationAction as ProtoConversationAction,
    LocalAppConversationActionStatus as ProtoConversationActionStatus,
    LocalAppConversationArtifactPart as ProtoConversationArtifactPart,
    LocalAppConversationEvent as ProtoLocalAppConversationEvent,
    LocalAppConversationInputArtifactRef as ProtoConversationInputArtifactRef,
    LocalAppConversationInputPart as ProtoConversationInputPart,
    LocalAppConversationLiveChildLifecycle as ProtoConversationLiveChildLifecycle,
    LocalAppConversationMediaKind as ProtoConversationMediaKind,
    LocalAppConversationMessage as ProtoConversationMessage,
    LocalAppConversationMessageRole as ProtoConversationMessageRole,
    LocalAppConversationReasoningState as ProtoConversationReasoningState,
    LocalAppConversationTurn as ProtoConversationTurn,
    LocalAppConversationTurnPhase as ProtoConversationTurnPhase,
    LocalAppConversationTurnStatus as ProtoConversationTurnStatus,
    LocalAppConversationVoice as ProtoConversationVoice,
    LocalAppConversationVoiceState as ProtoConversationVoiceState, OpenLocalAppConversationRequest,
    ReadLocalAppConversationArtifactRequest as ProtoConversationArtifactReadRequest,
    ReasonCode as ProtoReasonCode, SendLocalAppConversationTurnRequest,
    SubscribeLocalAppConversationEventsRequest,
    TranscribeLocalAppConversationVoiceRequest as ProtoConversationVoiceTranscriptionRequest,
    UploadLocalAppConversationAttachmentRequest as ProtoConversationAttachmentUploadRequest,
};
use crate::grpc_status::local_app_error_from_status;
use crate::{
    LocalAppConversationArtifactReadRequest, LocalAppConversationArtifactReadResult,
    LocalAppConversationAttachmentUploadRequest, LocalAppConversationAttachmentUploadResult,
    LocalAppConversationEvent, LocalAppConversationEventKind, LocalAppConversationInputPart,
    LocalAppConversationInterruptRequest, LocalAppConversationInterruptResult,
    LocalAppConversationMessage, LocalAppConversationMessageRole, LocalAppConversationOpenRequest,
    LocalAppConversationOpenResult, LocalAppConversationSendRequest,
    LocalAppConversationSendResult, LocalAppConversationSnapshot,
    LocalAppConversationSnapshotRequest, LocalAppConversationSubscribeRequest,
    LocalAppConversationSubscriptionReceiver, LocalAppConversationVoiceTranscriptionRequest,
    LocalAppConversationVoiceTranscriptionResult, LocalAppOperationError,
};

use super::{invalid_payload, untrusted};

const AGENT_HANDLE_PREFIX: &str = "agent_ref_";
const AGENT_HANDLE_SUFFIX_BYTES: usize = 43;
const MAX_SELECTOR_BYTES: usize = 256;
const MAX_REQUEST_ID_BYTES: usize = 256;
const MAX_TEXT_BYTES: usize = 64 * 1024;
const MAX_UPLOAD_BYTES: usize = 4 * 1024 * 1024;
const MAX_INLINE_BYTES: usize = crate::RUNTIME_MAX_INLINE_PAYLOAD_BYTES;
const MAX_VOICE_INPUT_BYTES: usize = 6 * 1024 * 1024;
const MAX_SNAPSHOT_MESSAGES: usize = 203;
const MAX_SNAPSHOT_TEXT_BYTES: usize = 1024 * 1024 + 128 * 1024;

pub(super) async fn open_conversation(
    channel: Channel,
    request: LocalAppConversationOpenRequest,
) -> Result<LocalAppConversationOpenResult, LocalAppOperationError> {
    require_agent_handle(&request.agent_handle)?;
    let response = crate::grpc_limits::runtime_agent_client(channel)
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
    if request.parts.is_empty() || request.parts.len() > 2 {
        return Err(invalid_payload());
    }
    let mut text_seen = false;
    let mut artifact_seen = false;
    let mut parts = Vec::with_capacity(request.parts.len());
    for (index, part) in request.parts.into_iter().enumerate() {
        let part = match part {
            LocalAppConversationInputPart::Text(text) => {
                if text_seen || artifact_seen || index != 0 {
                    return Err(invalid_payload());
                }
                require_bounded_text(&text, MAX_TEXT_BYTES, true)?;
                text_seen = true;
                ProtoConversationInputPart {
                    part: Some(ProtoConversationInputPartValue::Text(
                        crate::generated::LocalAppConversationTextPart { text },
                    )),
                }
            }
            LocalAppConversationInputPart::ArtifactRef(artifact_id) => {
                if artifact_seen {
                    return Err(invalid_payload());
                }
                require_selector(&artifact_id)?;
                artifact_seen = true;
                ProtoConversationInputPart {
                    part: Some(ProtoConversationInputPartValue::ArtifactRef(
                        ProtoConversationInputArtifactRef { artifact_id },
                    )),
                }
            }
        };
        parts.push(part);
    }
    let response = crate::grpc_limits::runtime_agent_client(channel)
        .send_local_app_conversation_turn(SendLocalAppConversationTurnRequest {
            agent_handle: request.agent_handle,
            conversation_anchor_id: request.conversation_anchor_id,
            request_id: request.request_id,
            parts,
        })
        .await
        .map_err(local_app_error_from_status)?
        .into_inner();
    require_runtime_selector(&response.turn_id)?;
    Ok(LocalAppConversationSendResult {
        turn_id: response.turn_id,
    })
}

pub(super) async fn upload_attachment(
    channel: Channel,
    request: LocalAppConversationAttachmentUploadRequest,
) -> Result<LocalAppConversationAttachmentUploadResult, LocalAppOperationError> {
    require_agent_handle(&request.agent_handle)?;
    require_selector(&request.conversation_anchor_id)?;
    if request.bytes.is_empty()
        || request.bytes.len() > MAX_UPLOAD_BYTES
        || !matches!(
            request.mime_type.as_str(),
            "image/png" | "image/jpeg" | "image/webp" | "image/gif"
        )
        || request.display_name.as_deref().is_some_and(|value| {
            value.len() > 255 || value.contains('\0') || value.trim() != value || value.is_empty()
        })
    {
        return Err(invalid_payload());
    }
    let response = crate::grpc_limits::runtime_agent_client(channel)
        .upload_local_app_conversation_attachment(ProtoConversationAttachmentUploadRequest {
            agent_handle: request.agent_handle,
            conversation_anchor_id: request.conversation_anchor_id,
            mime_type: request.mime_type,
            display_name: request.display_name,
            data: request.bytes,
        })
        .await
        .map_err(local_app_error_from_status)?
        .into_inner();
    require_runtime_selector(&response.artifact_id)?;
    require_bounded_runtime_text(&response.expires_at, 64)?;
    Ok(LocalAppConversationAttachmentUploadResult {
        artifact_id: response.artifact_id,
        expires_at: response.expires_at,
    })
}

pub(super) async fn read_artifact(
    channel: Channel,
    request: LocalAppConversationArtifactReadRequest,
) -> Result<LocalAppConversationArtifactReadResult, LocalAppOperationError> {
    require_agent_handle(&request.agent_handle)?;
    require_selector(&request.conversation_anchor_id)?;
    require_selector(&request.artifact_id)?;
    let response = crate::grpc_limits::runtime_agent_client(channel)
        .read_local_app_conversation_artifact(ProtoConversationArtifactReadRequest {
            agent_handle: request.agent_handle,
            conversation_anchor_id: request.conversation_anchor_id,
            artifact_id: request.artifact_id,
        })
        .await
        .map_err(local_app_error_from_status)?
        .into_inner();
    require_runtime_selector(&response.artifact_id)?;
    if response.data.is_empty()
        || response.data.len() > MAX_INLINE_BYTES
        || response.byte_length != response.data.len() as i64
        || !(matches!(
            response.mime_type.as_str(),
            "image/png" | "image/jpeg" | "image/webp" | "image/gif"
        ) || response.mime_type.starts_with("audio/"))
    {
        return Err(untrusted());
    }
    Ok(LocalAppConversationArtifactReadResult {
        artifact_id: response.artifact_id,
        bytes: response.data,
        mime_type: response.mime_type,
        byte_length: response.byte_length,
    })
}

pub(super) async fn transcribe_voice(
    channel: Channel,
    request: LocalAppConversationVoiceTranscriptionRequest,
) -> Result<LocalAppConversationVoiceTranscriptionResult, LocalAppOperationError> {
    require_agent_handle(&request.agent_handle)?;
    require_selector(&request.conversation_anchor_id)?;
    require_bounded_text(&request.request_id, MAX_REQUEST_ID_BYTES, false)?;
    if request.audio_bytes.is_empty()
        || request.audio_bytes.len() > MAX_VOICE_INPUT_BYTES
        || !request.mime_type.starts_with("audio/")
        || request.mime_type.trim() != request.mime_type
        || request.mime_type.chars().any(char::is_control)
    {
        return Err(invalid_payload());
    }
    let response = crate::grpc_limits::runtime_agent_client(channel)
        .transcribe_local_app_conversation_voice(ProtoConversationVoiceTranscriptionRequest {
            agent_handle: request.agent_handle,
            conversation_anchor_id: request.conversation_anchor_id,
            request_id: request.request_id,
            mime_type: request.mime_type,
            audio_bytes: request.audio_bytes,
        })
        .await
        .map_err(local_app_error_from_status)?
        .into_inner();
    require_bounded_runtime_text(&response.text, MAX_TEXT_BYTES)?;
    Ok(LocalAppConversationVoiceTranscriptionResult {
        text: response.text,
    })
}

pub(super) async fn interrupt_turn(
    channel: Channel,
    request: LocalAppConversationInterruptRequest,
) -> Result<LocalAppConversationInterruptResult, LocalAppOperationError> {
    require_agent_handle(&request.agent_handle)?;
    require_selector(&request.conversation_anchor_id)?;
    let response = crate::grpc_limits::runtime_agent_client(channel)
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
    let response = crate::grpc_limits::runtime_agent_client(channel)
        .get_local_app_conversation_snapshot(GetLocalAppConversationSnapshotRequest {
            agent_handle: request.agent_handle,
            conversation_anchor_id: request.conversation_anchor_id,
        })
        .await
        .map_err(local_app_error_from_status)?
        .into_inner();
    let snapshot = response.snapshot.ok_or_else(untrusted)?;
    require_runtime_selector(&snapshot.conversation_anchor_id)?;
    if snapshot.messages.len() > MAX_SNAPSHOT_MESSAGES
        || snapshot.turns.len() > 201
        || snapshot.actions.len() > 201
        || snapshot.voices.len() > 201
    {
        return Err(untrusted());
    }
    let mut text_bytes = 0usize;
    let messages = snapshot
        .messages
        .into_iter()
        .map(|message| project_message(message, &mut text_bytes))
        .collect::<Result<Vec<_>, _>>()?;
    let turns = snapshot
        .turns
        .into_iter()
        .map(project_turn)
        .collect::<Result<Vec<_>, _>>()?;
    let actions = snapshot
        .actions
        .into_iter()
        .map(project_action)
        .collect::<Result<Vec<_>, _>>()?;
    let voices = snapshot
        .voices
        .into_iter()
        .map(project_voice)
        .collect::<Result<Vec<_>, _>>()?;
    Ok(LocalAppConversationSnapshot {
        conversation_anchor_id: snapshot.conversation_anchor_id,
        through_sequence: snapshot.through_sequence,
        turns,
        messages,
        actions,
        voices,
        truncated_before: snapshot.truncated_before,
    })
}

pub(super) async fn subscribe(
    channel: Channel,
    request: LocalAppConversationSubscribeRequest,
) -> Result<LocalAppConversationSubscriptionReceiver, LocalAppOperationError> {
    require_agent_handle(&request.agent_handle)?;
    require_selector(&request.conversation_anchor_id)?;
    let mut stream = crate::grpc_limits::runtime_agent_client(channel)
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
            LocalAppConversationEventKind::TurnAccepted {
                turn_id: value.turn_id,
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
            require_bounded_runtime_text(&value.delta, MAX_TEXT_BYTES)?;
            LocalAppConversationEventKind::TextDelta {
                turn_id: value.turn_id,
                delta: value.delta,
            }
        }
        ProtoConversationEvent::ReasoningStatus(value) => {
            require_runtime_selector(&value.turn_id)?;
            let state = match ProtoConversationReasoningState::try_from(value.state)
                .map_err(|_| untrusted())?
            {
                ProtoConversationReasoningState::Started => "started",
                ProtoConversationReasoningState::Active => "active",
                ProtoConversationReasoningState::Completed => "completed",
                ProtoConversationReasoningState::Unspecified => return Err(untrusted()),
            };
            LocalAppConversationEventKind::ReasoningStatus {
                turn_id: value.turn_id,
                state: state.to_string(),
            }
        }
        ProtoConversationEvent::LiveAction(value) => {
            let turn_id = value.turn_id.clone();
            LocalAppConversationEventKind::LiveAction {
                turn_id,
                action: project_live_child(
                    value.turn_id,
                    "actionId",
                    value.action_id,
                    value.name,
                    value.lifecycle,
                    value.progress,
                    value.result,
                    value.reason_code,
                )?,
            }
        }
        ProtoConversationEvent::LiveTool(value) => {
            let turn_id = value.turn_id.clone();
            LocalAppConversationEventKind::LiveTool {
                turn_id,
                tool: project_live_child(
                    value.turn_id,
                    "toolId",
                    value.tool_id,
                    value.name,
                    value.lifecycle,
                    value.progress,
                    value.result,
                    value.reason_code,
                )?,
            }
        }
        ProtoConversationEvent::MessageCommitted(value) => {
            let mut text_bytes = 0usize;
            let message = project_message(value.message.ok_or_else(untrusted)?, &mut text_bytes)?;
            LocalAppConversationEventKind::MessageCommitted {
                turn_id: message.turn_id.clone(),
                message: json!({
                    "messageId": message.message_id,
                    "turnId": message.turn_id,
                    "role": match message.role {
                        LocalAppConversationMessageRole::User => "user",
                        LocalAppConversationMessageRole::Assistant => "assistant",
                    },
                    "parts": message.parts,
                }),
            }
        }
        ProtoConversationEvent::ActionPlanned(value) => {
            let action = project_action(value.action.ok_or_else(untrusted)?)?;
            let turn_id = json_selector(&action, "turnId")?;
            LocalAppConversationEventKind::ActionPlanned { turn_id, action }
        }
        ProtoConversationEvent::ActionStarted(value) => {
            let action = project_action(value.action.ok_or_else(untrusted)?)?;
            let turn_id = json_selector(&action, "turnId")?;
            LocalAppConversationEventKind::ActionStarted { turn_id, action }
        }
        ProtoConversationEvent::ArtifactReady(value) => {
            require_runtime_selector(&value.turn_id)?;
            require_runtime_selector(&value.action_id)?;
            require_runtime_selector(&value.projection_message_id)?;
            require_runtime_selector(&value.artifact_id)?;
            if value.capability_contract != "image.generate" {
                return Err(untrusted());
            }
            LocalAppConversationEventKind::ArtifactReady {
                turn_id: value.turn_id,
                action_id: value.action_id,
                capability_contract: value.capability_contract,
                projection_message_id: value.projection_message_id,
                artifact_id: value.artifact_id,
            }
        }
        ProtoConversationEvent::ActionCompleted(value) => {
            let action = project_action(value.action.ok_or_else(untrusted)?)?;
            let turn_id = json_selector(&action, "turnId")?;
            LocalAppConversationEventKind::ActionCompleted { turn_id, action }
        }
        ProtoConversationEvent::ActionFailed(value) => {
            let action = project_action(value.action.ok_or_else(untrusted)?)?;
            let turn_id = json_selector(&action, "turnId")?;
            LocalAppConversationEventKind::ActionFailed { turn_id, action }
        }
        ProtoConversationEvent::VoiceReady(value) => {
            let voice = project_voice(value.voice.ok_or_else(untrusted)?)?;
            let turn_id = json_selector(&voice, "turnId")?;
            LocalAppConversationEventKind::VoiceReady { turn_id, voice }
        }
        ProtoConversationEvent::VoiceFailed(value) => {
            let voice = project_voice(value.voice.ok_or_else(untrusted)?)?;
            let turn_id = json_selector(&voice, "turnId")?;
            LocalAppConversationEventKind::VoiceFailed { turn_id, voice }
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

fn project_message(
    message: ProtoConversationMessage,
    text_bytes: &mut usize,
) -> Result<LocalAppConversationMessage, LocalAppOperationError> {
    require_runtime_selector(&message.turn_id)?;
    require_runtime_selector(&message.message_id)?;
    if message.parts.is_empty() || message.parts.len() > 2 {
        return Err(untrusted());
    }
    let role =
        match ProtoConversationMessageRole::try_from(message.role).map_err(|_| untrusted())? {
            ProtoConversationMessageRole::User => LocalAppConversationMessageRole::User,
            ProtoConversationMessageRole::Assistant => LocalAppConversationMessageRole::Assistant,
            ProtoConversationMessageRole::Unspecified => return Err(untrusted()),
        };
    let mut text_count = 0usize;
    let mut artifact_count = 0usize;
    let mut parts = Vec::with_capacity(message.parts.len());
    for part in message.parts {
        match part.part.ok_or_else(untrusted)? {
            ProtoMessagePart::Text(text) => {
                require_bounded_runtime_text(&text.text, MAX_TEXT_BYTES)?;
                *text_bytes = text_bytes
                    .checked_add(text.text.len())
                    .filter(|value| *value <= MAX_SNAPSHOT_TEXT_BYTES)
                    .ok_or_else(untrusted)?;
                text_count += 1;
                parts.push(json!({ "kind": "text", "text": text.text }));
            }
            ProtoMessagePart::Artifact(artifact) => {
                parts.push(project_artifact_part(artifact)?);
                artifact_count += 1;
            }
        }
    }
    if text_count > 1
        || artifact_count > 1
        || (role == LocalAppConversationMessageRole::Assistant
            && text_count == 1
            && artifact_count == 1)
    {
        return Err(untrusted());
    }
    Ok(LocalAppConversationMessage {
        message_id: message.message_id,
        turn_id: message.turn_id,
        role,
        parts: JsonValue::Array(parts),
    })
}

fn project_artifact_part(
    artifact: ProtoConversationArtifactPart,
) -> Result<JsonValue, LocalAppOperationError> {
    require_runtime_selector(&artifact.artifact_id)?;
    let media_kind =
        ProtoConversationMediaKind::try_from(artifact.media_kind).map_err(|_| untrusted())?;
    if media_kind != ProtoConversationMediaKind::Image
        || !matches!(
            artifact.mime_type.as_str(),
            "image/png" | "image/jpeg" | "image/webp" | "image/gif"
        )
        || artifact
            .display_name
            .as_deref()
            .is_some_and(|value| require_bounded_runtime_text(value, 255).is_err())
    {
        return Err(untrusted());
    }
    Ok(json!({
        "kind": "artifact-ref",
        "artifactId": artifact.artifact_id,
        "mediaKind": "image",
        "mimeType": artifact.mime_type,
        "displayName": artifact.display_name,
    }))
}

fn project_turn(turn: ProtoConversationTurn) -> Result<JsonValue, LocalAppOperationError> {
    require_runtime_selector(&turn.turn_id)?;
    let status =
        match ProtoConversationTurnStatus::try_from(turn.status).map_err(|_| untrusted())? {
            ProtoConversationTurnStatus::Active => "active",
            ProtoConversationTurnStatus::Completed => "completed",
            ProtoConversationTurnStatus::Failed => "failed",
            ProtoConversationTurnStatus::Interrupted => "interrupted",
            ProtoConversationTurnStatus::Unspecified => return Err(untrusted()),
        };
    let phase = match ProtoConversationTurnPhase::try_from(turn.phase).map_err(|_| untrusted())? {
        ProtoConversationTurnPhase::Unspecified => None,
        ProtoConversationTurnPhase::Accepted => Some("accepted"),
        ProtoConversationTurnPhase::Started => Some("started"),
    };
    if (status == "active") != phase.is_some()
        || turn
            .terminal_reason
            .as_deref()
            .is_some_and(|value| require_bounded_runtime_text(value, 128).is_err())
        || turn
            .message
            .as_deref()
            .is_some_and(|value| require_bounded_runtime_text(value, 1024).is_err())
    {
        return Err(untrusted());
    }
    Ok(json!({
        "turnId": turn.turn_id,
        "status": status,
        "phase": phase,
        "terminalReason": turn.terminal_reason,
        "reasonCode": project_reason_code(turn.reason_code)?,
        "message": turn.message,
    }))
}

fn project_action(action: ProtoConversationAction) -> Result<JsonValue, LocalAppOperationError> {
    require_runtime_selector(&action.action_id)?;
    require_runtime_selector(&action.turn_id)?;
    if action.capability_contract != "image.generate"
        || action
            .projection_message_id
            .as_deref()
            .is_some_and(|value| require_runtime_selector(value).is_err())
        || action
            .artifact_id
            .as_deref()
            .is_some_and(|value| require_runtime_selector(value).is_err())
        || action
            .message
            .as_deref()
            .is_some_and(|value| require_bounded_runtime_text(value, 1024).is_err())
    {
        return Err(untrusted());
    }
    let status =
        match ProtoConversationActionStatus::try_from(action.status).map_err(|_| untrusted())? {
            ProtoConversationActionStatus::Planned => "planned",
            ProtoConversationActionStatus::Started => "started",
            ProtoConversationActionStatus::Completed => "completed",
            ProtoConversationActionStatus::Failed => "failed",
            ProtoConversationActionStatus::Unspecified => return Err(untrusted()),
        };
    let reason_code = project_reason_code(action.reason_code)?;
    if (status == "completed")
        != (action.projection_message_id.is_some() && action.artifact_id.is_some())
        || (status == "failed") != reason_code.is_some()
        || (status != "failed" && action.message.is_some())
    {
        return Err(untrusted());
    }
    Ok(json!({
        "actionId": action.action_id,
        "turnId": action.turn_id,
        "capabilityContract": "image.generate",
        "status": status,
        "projectionMessageId": action.projection_message_id,
        "artifactId": action.artifact_id,
        "reasonCode": reason_code,
        "message": action.message,
    }))
}

fn project_voice(voice: ProtoConversationVoice) -> Result<JsonValue, LocalAppOperationError> {
    require_runtime_selector(&voice.voice_id)?;
    require_runtime_selector(&voice.turn_id)?;
    require_runtime_selector(&voice.message_id)?;
    if voice
        .artifact_id
        .as_deref()
        .is_some_and(|value| require_runtime_selector(value).is_err())
        || voice
            .message
            .as_deref()
            .is_some_and(|value| require_bounded_runtime_text(value, 1024).is_err())
    {
        return Err(untrusted());
    }
    let state = match ProtoConversationVoiceState::try_from(voice.state).map_err(|_| untrusted())? {
        ProtoConversationVoiceState::Ready => "ready",
        ProtoConversationVoiceState::Failed => "failed",
        ProtoConversationVoiceState::Unspecified => return Err(untrusted()),
    };
    let reason_code = project_reason_code(voice.reason_code)?;
    if (state == "ready") != voice.artifact_id.is_some()
        || (state == "failed") != reason_code.is_some()
    {
        return Err(untrusted());
    }
    Ok(json!({
        "voiceId": voice.voice_id,
        "turnId": voice.turn_id,
        "messageId": voice.message_id,
        "state": state,
        "artifactId": voice.artifact_id,
        "reasonCode": reason_code,
        "message": voice.message,
    }))
}

fn project_reason_code(value: i32) -> Result<Option<String>, LocalAppOperationError> {
    let reason = ProtoReasonCode::try_from(value).map_err(|_| untrusted())?;
    if reason == ProtoReasonCode::Unspecified {
        return Ok(None);
    }
    Ok(Some(reason.as_str_name().to_string()))
}

fn project_live_child(
    turn_id: String,
    id_field: &'static str,
    child_id: String,
    name: String,
    lifecycle: i32,
    progress: Option<String>,
    result: Option<String>,
    reason_code: i32,
) -> Result<JsonValue, LocalAppOperationError> {
    require_runtime_selector(&turn_id)?;
    require_runtime_selector(&child_id)?;
    require_bounded_runtime_text(&name, 256)?;
    if progress
        .as_deref()
        .is_some_and(|value| require_bounded_runtime_text(value, 16 * 1024).is_err())
        || result
            .as_deref()
            .is_some_and(|value| require_bounded_runtime_text(value, 16 * 1024).is_err())
    {
        return Err(untrusted());
    }
    let lifecycle =
        match ProtoConversationLiveChildLifecycle::try_from(lifecycle).map_err(|_| untrusted())? {
            ProtoConversationLiveChildLifecycle::Started => "started",
            ProtoConversationLiveChildLifecycle::Updated => "updated",
            ProtoConversationLiveChildLifecycle::Completed => "completed",
            ProtoConversationLiveChildLifecycle::Failed => "failed",
            ProtoConversationLiveChildLifecycle::Unspecified => return Err(untrusted()),
        };
    let reason_code = project_reason_code(reason_code)?;
    let valid = match lifecycle {
        "started" => progress.is_none() && result.is_none() && reason_code.is_none(),
        "updated" => (progress.is_none() != result.is_none()) && reason_code.is_none(),
        "completed" => progress.is_none() && reason_code.is_none(),
        "failed" => result.is_none() && reason_code.is_some(),
        _ => false,
    };
    if !valid {
        return Err(untrusted());
    }
    let mut value = json!({
        "turnId": turn_id,
        "name": name,
        "lifecycle": lifecycle,
        "progress": progress,
        "result": result,
        "reasonCode": reason_code,
    });
    value
        .as_object_mut()
        .ok_or_else(untrusted)?
        .insert(id_field.to_string(), JsonValue::String(child_id));
    Ok(value)
}

fn json_selector(value: &JsonValue, key: &str) -> Result<String, LocalAppOperationError> {
    let value = value
        .get(key)
        .and_then(JsonValue::as_str)
        .ok_or_else(untrusted)?;
    require_runtime_selector(value)?;
    Ok(value.to_string())
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
        local_app_conversation_event, LocalAppConversationTurnCompleted,
        LocalAppConversationTurnStarted,
    };

    #[test]
    fn typed_event_projection_has_no_generic_payload_or_message_type() {
        let projected = project_event(ProtoLocalAppConversationEvent {
            conversation_anchor_id: "agent_anchor_01J".to_string(),
            sequence: 3,
            event: Some(local_app_conversation_event::Event::TurnStarted(
                LocalAppConversationTurnStarted {
                    turn_id: "agent_turn_01J".to_string(),
                },
            )),
        })
        .expect("typed event");
        assert_eq!(
            projected.event,
            LocalAppConversationEventKind::TurnStarted {
                turn_id: "agent_turn_01J".to_string(),
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
