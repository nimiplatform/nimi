use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine as _;
use nimi_shell_protected_local::{
    LocalAppAgentConversationSnapshotRequest, LocalAppAgentInventoryRequest,
    LocalAppAgentOpenConversationRequest, LocalAppAgentSendTurnRequest,
    LocalAppAgentSubscribeTurnRequest, LocalAppAgentSubscribeVoiceStreamRequest,
    LocalAppAgentTranscribeVoiceRequest, LocalAppAgentVoiceStreamPage, LocalAppArtifactReadRequest,
    LocalAppOperationError, LocalAppPermissionPostureRequest, LocalAppPermissionRequest,
    LocalAppStorageReadRequest, LocalAppStorageRemoveRequest, LocalAppStorageWriteRequest,
};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::runtime_bridge::RuntimeBridgeLocalAppHost;

const MAX_IDENTIFIER_LENGTH: usize = 512;
const MAX_USER_TEXT_LENGTH: usize = 256 * 1024;
const MAX_VOICE_AUDIO_BYTES: usize = 8 * 1024 * 1024;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LocalAppPermissionPosturePayload {
    operation_id: String,
    resource_ref: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LocalAppPermissionRequestPayload {
    operation_id: String,
    resource_ref: String,
    purpose: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LocalAppArtifactReadPayload {
    artifact_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LocalAppStorageReadPayload {
    relative_path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LocalAppStorageWritePayload {
    relative_path: String,
    value: Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LocalAppStorageRemovePayload {
    relative_path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LocalAppAgentOpenConversationPayload {
    agent_id: String,
    requested_anchor_disposition: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LocalAppAgentSendTurnPayload {
    agent_id: String,
    conversation_anchor_id: String,
    client_turn_id: String,
    user_text: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LocalAppAgentSubscribeTurnPayload {
    agent_id: String,
    conversation_anchor_id: String,
    #[serde(default)]
    cursor: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LocalAppAgentConversationSnapshotPayload {
    agent_id: String,
    conversation_anchor_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LocalAppAgentTranscribeVoicePayload {
    agent_id: String,
    client_request_id: String,
    audio_base64: String,
    mime_type: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LocalAppAgentSubscribeVoiceStreamPayload {
    agent_id: String,
    conversation_anchor_id: String,
    turn_id: String,
    voice_stream_id: String,
    #[serde(default)]
    cursor: String,
}

pub async fn session_status_for_host(host: &RuntimeBridgeLocalAppHost) -> Result<Value, String> {
    let status = host.session_status().await.map_err(map_local_app_error)?;
    Ok(json!({
        "state": status.state.as_str(),
        "reasonCode": status.reason_code.as_str(),
        "retryable": status.retryable,
    }))
}

pub async fn permission_posture_for_host(
    host: &RuntimeBridgeLocalAppHost,
    payload: Value,
) -> Result<Value, String> {
    let payload: LocalAppPermissionPosturePayload =
        parse_payload(payload, "local_app_permission_posture")?;
    let operation_id = required_text(
        payload.operation_id,
        MAX_IDENTIFIER_LENGTH,
        "local_app_permission_posture",
    )?;
    let resource_ref = required_text(
        payload.resource_ref,
        MAX_IDENTIFIER_LENGTH,
        "local_app_permission_posture",
    )?;
    let posture = host
        .permission_posture(LocalAppPermissionPostureRequest {
            operation_id,
            resource_ref,
        })
        .await
        .map_err(map_local_app_error)?;
    Ok(json!({
        "state": posture.state.as_str(),
        "operationId": posture.operation_id,
        "resourceRef": posture.resource_ref,
        "reasonCode": posture.reason_code.as_str(),
        "actionHint": posture.action_hint,
        "retryable": posture.retryable,
    }))
}

pub async fn permission_request_for_host(
    host: &RuntimeBridgeLocalAppHost,
    payload: Value,
) -> Result<Value, String> {
    let payload: LocalAppPermissionRequestPayload =
        parse_payload(payload, "local_app_permission_request")?;
    let request = LocalAppPermissionRequest {
        operation_id: required_text(
            payload.operation_id,
            MAX_IDENTIFIER_LENGTH,
            "local_app_permission_request",
        )?,
        resource_ref: required_text(
            payload.resource_ref,
            MAX_IDENTIFIER_LENGTH,
            "local_app_permission_request",
        )?,
        purpose: required_text(
            payload.purpose,
            MAX_USER_TEXT_LENGTH,
            "local_app_permission_request",
        )?,
    };
    let posture = host
        .permission_request(request)
        .await
        .map_err(map_local_app_error)?;
    Ok(json!({
        "state": posture.state.as_str(),
        "operationId": posture.operation_id,
        "resourceRef": posture.resource_ref,
        "reasonCode": posture.reason_code.as_str(),
        "actionHint": posture.action_hint,
        "retryable": posture.retryable,
    }))
}

pub async fn artifacts_read_runtime_bytes_for_host(
    host: &RuntimeBridgeLocalAppHost,
    payload: Value,
) -> Result<Value, String> {
    let payload: LocalAppArtifactReadPayload =
        parse_payload(payload, "local_app_artifacts_read_runtime_bytes")?;
    let artifact_id = required_text(
        payload.artifact_id,
        MAX_IDENTIFIER_LENGTH,
        "local_app_artifacts_read_runtime_bytes",
    )?;
    let artifact = host
        .artifacts_read_runtime_bytes(LocalAppArtifactReadRequest { artifact_id })
        .await
        .map_err(map_local_app_error)?;
    Ok(json!({
        "dataBase64": BASE64_STANDARD.encode(artifact.bytes),
        "mimeType": artifact.mime_type,
        "sizeBytes": artifact.size_bytes,
        "mimeInferred": artifact.mime_inferred,
    }))
}

pub async fn storage_read_json_for_host(
    host: &RuntimeBridgeLocalAppHost,
    payload: Value,
) -> Result<Value, String> {
    let payload: LocalAppStorageReadPayload = parse_payload(payload, "storage_read_json")?;
    let document = host
        .storage_read_json(LocalAppStorageReadRequest {
            relative_path: payload.relative_path,
        })
        .await
        .map_err(map_local_app_error)?;
    Ok(json!({"value": document.value, "sizeBytes": document.size_bytes}))
}

pub async fn storage_write_json_for_host(
    host: &RuntimeBridgeLocalAppHost,
    payload: Value,
) -> Result<Value, String> {
    let payload: LocalAppStorageWritePayload = parse_payload(payload, "storage_write_json")?;
    let document = host
        .storage_write_json(LocalAppStorageWriteRequest {
            relative_path: payload.relative_path,
            value: payload.value,
        })
        .await
        .map_err(map_local_app_error)?;
    Ok(json!({"value": document.value, "sizeBytes": document.size_bytes}))
}

pub async fn storage_remove_json_for_host(
    host: &RuntimeBridgeLocalAppHost,
    payload: Value,
) -> Result<Value, String> {
    let payload: LocalAppStorageRemovePayload = parse_payload(payload, "storage_remove_json")?;
    let result = host
        .storage_remove_json(LocalAppStorageRemoveRequest {
            relative_path: payload.relative_path,
        })
        .await
        .map_err(map_local_app_error)?;
    Ok(json!({"removed": result.removed}))
}

pub async fn agent_open_conversation_for_host(
    host: &RuntimeBridgeLocalAppHost,
    payload: Value,
) -> Result<Value, String> {
    let payload: LocalAppAgentOpenConversationPayload =
        parse_payload(payload, "local_app_agent_open_conversation")?;
    let request = LocalAppAgentOpenConversationRequest {
        agent_id: required_text(
            payload.agent_id,
            MAX_IDENTIFIER_LENGTH,
            "local_app_agent_open_conversation",
        )?,
        requested_anchor_disposition: required_text(
            payload.requested_anchor_disposition,
            MAX_IDENTIFIER_LENGTH,
            "local_app_agent_open_conversation",
        )?,
    };
    host.agent_open_conversation(request)
        .await
        .map(|projection| projection.value)
        .map_err(map_local_app_error)
}

pub async fn agent_inventory_for_host(host: &RuntimeBridgeLocalAppHost) -> Result<Value, String> {
    host.agent_inventory(LocalAppAgentInventoryRequest)
        .await
        .map(|projection| projection.value)
        .map_err(map_local_app_error)
}

pub async fn agent_send_turn_for_host(
    host: &RuntimeBridgeLocalAppHost,
    payload: Value,
) -> Result<Value, String> {
    let payload: LocalAppAgentSendTurnPayload =
        parse_payload(payload, "local_app_agent_send_turn")?;
    let request = LocalAppAgentSendTurnRequest {
        agent_id: required_text(
            payload.agent_id,
            MAX_IDENTIFIER_LENGTH,
            "local_app_agent_send_turn",
        )?,
        conversation_anchor_id: required_text(
            payload.conversation_anchor_id,
            MAX_IDENTIFIER_LENGTH,
            "local_app_agent_send_turn",
        )?,
        client_turn_id: required_text(
            payload.client_turn_id,
            MAX_IDENTIFIER_LENGTH,
            "local_app_agent_send_turn",
        )?,
        user_text: required_text(
            payload.user_text,
            MAX_USER_TEXT_LENGTH,
            "local_app_agent_send_turn",
        )?,
    };
    host.agent_send_turn(request)
        .await
        .map(|projection| projection.value)
        .map_err(map_local_app_error)
}

pub async fn agent_subscribe_turn_for_host(
    host: &RuntimeBridgeLocalAppHost,
    payload: Value,
) -> Result<Value, String> {
    let payload: LocalAppAgentSubscribeTurnPayload =
        parse_payload(payload, "local_app_agent_subscribe_turn")?;
    let request = LocalAppAgentSubscribeTurnRequest {
        agent_id: required_text(
            payload.agent_id,
            MAX_IDENTIFIER_LENGTH,
            "local_app_agent_subscribe_turn",
        )?,
        conversation_anchor_id: required_text(
            payload.conversation_anchor_id,
            MAX_IDENTIFIER_LENGTH,
            "local_app_agent_subscribe_turn",
        )?,
        cursor: optional_text(
            payload.cursor,
            MAX_IDENTIFIER_LENGTH,
            "local_app_agent_subscribe_turn",
        )?,
    };
    host.agent_subscribe_turn(request)
        .await
        .map(|projection| projection.value)
        .map_err(map_local_app_error)
}

pub async fn agent_get_conversation_snapshot_for_host(
    host: &RuntimeBridgeLocalAppHost,
    payload: Value,
) -> Result<Value, String> {
    let payload: LocalAppAgentConversationSnapshotPayload =
        parse_payload(payload, "local_app_agent_get_conversation_snapshot")?;
    let request = LocalAppAgentConversationSnapshotRequest {
        agent_id: required_text(
            payload.agent_id,
            MAX_IDENTIFIER_LENGTH,
            "local_app_agent_get_conversation_snapshot",
        )?,
        conversation_anchor_id: required_text(
            payload.conversation_anchor_id,
            MAX_IDENTIFIER_LENGTH,
            "local_app_agent_get_conversation_snapshot",
        )?,
    };
    host.agent_get_conversation_snapshot(request)
        .await
        .map(|projection| projection.value)
        .map_err(map_local_app_error)
}

pub async fn agent_transcribe_voice_for_host(
    host: &RuntimeBridgeLocalAppHost,
    payload: Value,
) -> Result<Value, String> {
    let payload: LocalAppAgentTranscribeVoicePayload =
        parse_payload(payload, "local_app_agent_transcribe_voice")?;
    let audio = decode_canonical_base64(
        &payload.audio_base64,
        MAX_VOICE_AUDIO_BYTES,
        "local_app_agent_transcribe_voice",
    )?;
    let request = LocalAppAgentTranscribeVoiceRequest {
        agent_id: required_text(
            payload.agent_id,
            MAX_IDENTIFIER_LENGTH,
            "local_app_agent_transcribe_voice",
        )?,
        client_request_id: required_text(
            payload.client_request_id,
            MAX_IDENTIFIER_LENGTH,
            "local_app_agent_transcribe_voice",
        )?,
        audio,
        mime_type: admitted_audio_mime(payload.mime_type, "local_app_agent_transcribe_voice")?,
    };
    host.agent_transcribe_voice(request)
        .await
        .map(|result| {
            json!({
                "clientRequestId": result.client_request_id,
                "text": result.text,
            })
        })
        .map_err(map_local_app_error)
}

pub async fn agent_subscribe_voice_stream_for_host(
    host: &RuntimeBridgeLocalAppHost,
    payload: Value,
) -> Result<Value, String> {
    let payload: LocalAppAgentSubscribeVoiceStreamPayload =
        parse_payload(payload, "local_app_agent_subscribe_voice_stream")?;
    let request = LocalAppAgentSubscribeVoiceStreamRequest {
        agent_id: required_text(
            payload.agent_id,
            MAX_IDENTIFIER_LENGTH,
            "local_app_agent_subscribe_voice_stream",
        )?,
        conversation_anchor_id: required_text(
            payload.conversation_anchor_id,
            MAX_IDENTIFIER_LENGTH,
            "local_app_agent_subscribe_voice_stream",
        )?,
        turn_id: required_text(
            payload.turn_id,
            MAX_IDENTIFIER_LENGTH,
            "local_app_agent_subscribe_voice_stream",
        )?,
        voice_stream_id: required_text(
            payload.voice_stream_id,
            MAX_IDENTIFIER_LENGTH,
            "local_app_agent_subscribe_voice_stream",
        )?,
        cursor: optional_text(
            payload.cursor,
            MAX_IDENTIFIER_LENGTH,
            "local_app_agent_subscribe_voice_stream",
        )?,
    };
    host.agent_subscribe_voice_stream(request)
        .await
        .map(project_voice_stream_page)
        .map_err(map_local_app_error)
}

fn project_voice_stream_page(page: LocalAppAgentVoiceStreamPage) -> Value {
    let events = page
        .events
        .into_iter()
        .map(|event| {
            json!({
                "voiceStreamId": event.voice_stream_id,
                "conversationAnchorId": event.conversation_anchor_id,
                "turnId": event.turn_id,
                "streamId": event.stream_id,
                "messageId": event.message_id,
                "chunkSequence": event.chunk_sequence.to_string(),
                "chunkBase64": BASE64_STANDARD.encode(event.chunk),
                "mimeType": event.mime_type,
                "voiceOutputMode": event.voice_output_mode,
                "playbackTarget": event.playback_target,
                "terminal": event.terminal,
                "voicePlaybackState": event.voice_playback_state,
                "terminalReason": event.terminal_reason,
                "replayTruncated": event.replay_truncated,
            })
        })
        .collect::<Vec<_>>();
    json!({"cursor": page.cursor, "events": events})
}

fn decode_canonical_base64(
    value: &str,
    max_bytes: usize,
    command: &str,
) -> Result<Vec<u8>, String> {
    if value.is_empty() || value.len() % 4 != 0 {
        return Err(invalid_payload(command));
    }
    let decoded = BASE64_STANDARD
        .decode(value.as_bytes())
        .map_err(|_| invalid_payload(command))?;
    if decoded.is_empty() || decoded.len() > max_bytes || BASE64_STANDARD.encode(&decoded) != value
    {
        return Err(invalid_payload(command));
    }
    Ok(decoded)
}

fn admitted_audio_mime(value: String, command: &str) -> Result<String, String> {
    let value = required_text(value, 128, command)?;
    let base = value
        .split(';')
        .next()
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase();
    if !matches!(
        base.as_str(),
        "audio/webm" | "audio/ogg" | "audio/wav" | "audio/mpeg" | "audio/mp4" | "audio/flac"
    ) {
        return Err(invalid_payload(command));
    }
    Ok(base)
}

fn parse_payload<T: for<'de> Deserialize<'de>>(payload: Value, command: &str) -> Result<T, String> {
    serde_json::from_value(payload).map_err(|_| invalid_payload(command))
}

fn required_text(value: String, max_length: usize, command: &str) -> Result<String, String> {
    if value.is_empty() || value.trim() != value || value.len() > max_length {
        return Err(invalid_payload(command));
    }
    Ok(value)
}

fn optional_text(value: String, max_length: usize, command: &str) -> Result<String, String> {
    if value.is_empty() {
        return Ok(value);
    }
    required_text(value, max_length, command)
}

fn invalid_payload(command: &str) -> String {
    crate::capabilities::standard_shell_error(
        "invalid-payload",
        "invalid-payload",
        "send_only_declared_local_app_operation_fields",
        "tauri",
        Some(json!({ "command": command })),
    )
}

fn map_local_app_error(error: LocalAppOperationError) -> String {
    let reason = error.reason_code().as_str();
    crate::capabilities::standard_shell_error(
        standard_code(reason),
        reason,
        action_hint(reason),
        if reason == "protected-carrier-required" {
            "tauri"
        } else {
            "runtime"
        },
        Some(json!({ "retryable": error.retryable() })),
    )
}

fn standard_code(reason: &str) -> &'static str {
    match reason {
        "protected-carrier-required" => "protected-carrier-required",
        "runtime-service-unavailable" => "runtime-service-unavailable",
        "runtime-service-untrusted" => "runtime-service-untrusted",
        "runtime-service-repair-required" => "runtime-service-repair-required",
        "runtime-unauthenticated" => "runtime-unauthenticated",
        "invalid-payload" => "invalid-payload",
        "not-found" => "not-found",
        "resource-exhausted" => "resource-exhausted",
        _ => "runtime-permission-denied",
    }
}

fn action_hint(reason: &str) -> &'static str {
    match reason {
        "protected-carrier-required" => "install_verified_tauri_protected_carrier",
        "runtime-service-unavailable" => "start_fixed_runtime_service",
        "runtime-unauthenticated" => "open_request_empty_local_app_session",
        "no-grant" => "request_local_app_operation_grant",
        _ => "refresh_local_app_runtime_projection",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn payloads_reject_extra_authority_fields() {
        for payload in [
            json!({"artifactId": "artifact-a", "sessionProof": "forged"}),
            json!({"agentId": "agent-a", "conversationAnchorId": "anchor-a", "token": "forged"}),
        ] {
            let error = if payload.get("artifactId").is_some() {
                parse_payload::<LocalAppArtifactReadPayload>(payload, "artifact").unwrap_err()
            } else {
                parse_payload::<LocalAppAgentConversationSnapshotPayload>(payload, "snapshot")
                    .unwrap_err()
            };
            assert!(error.contains("invalid-payload"));
        }
    }

    #[test]
    fn user_turn_text_uses_large_text_limit_without_accepting_whitespace_aliases() {
        assert!(required_text("你好".to_string(), MAX_USER_TEXT_LENGTH, "turn").is_ok());
        assert!(required_text(" 你好".to_string(), MAX_USER_TEXT_LENGTH, "turn").is_err());
    }
}
