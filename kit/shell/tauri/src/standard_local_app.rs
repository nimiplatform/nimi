use nimi_shell_protected_local::{
    LocalAppAIConfigOverwriteRequest, LocalAppAgentCommitPresentationRequest,
    LocalAppAgentHandleRequest, LocalAppAgentUpdateAutonomyRequest, LocalAppAssetAdoptRequest,
    LocalAppAssetListRequest, LocalAppAssetMoveRequest, LocalAppAssetReadRequest,
    LocalAppAssetRecord, LocalAppAssetRemoveRequest, LocalAppAssetStatRequest,
    LocalAppAssetWriteRequest, LocalAppOperationError, LocalAppScenarioUploadArtifactRequest,
    LocalAppSharedAgentAIConfigOverwriteRequest, LocalAppStorageReadRequest,
    LocalAppStorageRemoveRequest, LocalAppStorageWriteRequest, LocalAppTextCandidateMessage,
    LocalAppTextCandidateRequest,
};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::runtime_bridge::RuntimeBridgeLocalAppHost;

const MAX_TEXT_CANDIDATE_MESSAGES: usize = 8;
const MAX_TEXT_CANDIDATE_MESSAGE_BYTES: usize = 32 * 1024;
const MAX_TEXT_CANDIDATE_PROMPT_BYTES: usize = 64 * 1024;
const MAX_TEXT_CANDIDATE_TOKENS: i32 = 4096;
const MAX_ASSET_CHUNK_BYTES: usize = 1024 * 1024;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LocalAppTextCandidateMessagePayload {
    role: String,
    text: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LocalAppTextCandidatePayload {
    messages: Vec<LocalAppTextCandidateMessagePayload>,
    temperature: Option<f32>,
    top_p: Option<f32>,
    max_tokens: Option<i32>,
    top_k: Option<i32>,
    presence_penalty: Option<f32>,
    frequency_penalty: Option<f32>,
    #[serde(default)]
    stop: Vec<String>,
    seed: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LocalAppAIConfigOverwritePayload {
    capabilities: Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LocalAppArtifactUploadPayload {
    bytes: Vec<u8>,
    mime_type: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LocalAppAgentHandlePayload {
    agent_handle: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LocalAppAgentUpdateAutonomyPayload {
    agent_handle: String,
    expected_autonomy_revision: String,
    intent: Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LocalAppAgentCommitPresentationPayload {
    agent_handle: String,
    expected_presentation_revision: String,
    intent: Value,
    imported_assets: Value,
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
pub struct LocalAppAssetListPayload {
    prefix: String,
    cursor: String,
    page_size: i32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LocalAppAssetWriteOpenPayload {
    relative_path: String,
    media_type: String,
    overwrite: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LocalAppAssetWriteChunkPayload {
    stream_id: String,
    body_chunk: Vec<u8>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LocalAppAssetStreamPayload {
    stream_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LocalAppAssetReadPayload {
    relative_path: String,
    offset: Option<i64>,
    length: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LocalAppAssetMovePayload {
    from_relative_path: String,
    to_relative_path: String,
    overwrite: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LocalAppAssetAdoptPayload {
    artifact_id: String,
    relative_path: String,
    overwrite: bool,
}

pub async fn session_status_for_host(host: &RuntimeBridgeLocalAppHost) -> Result<Value, String> {
    let status = host.session_status().await.map_err(map_local_app_error)?;
    Ok(json!({
        "state": status.state.as_str(),
        "reasonCode": status.reason_code.as_str(),
        "retryable": status.retryable,
    }))
}

pub async fn text_generate_candidate_for_host(
    host: &RuntimeBridgeLocalAppHost,
    payload: Value,
) -> Result<Value, String> {
    let payload: LocalAppTextCandidatePayload =
        parse_payload(payload, "local_app_text_generate_candidate")?;
    if payload.messages.is_empty()
        || payload.messages.len() > MAX_TEXT_CANDIDATE_MESSAGES
        || payload
            .temperature
            .is_some_and(|value| !value.is_finite() || !(0.0..=2.0).contains(&value))
        || payload
            .top_p
            .is_some_and(|value| !value.is_finite() || !(0.0..=1.0).contains(&value))
        || payload
            .max_tokens
            .is_some_and(|value| !(0..=MAX_TEXT_CANDIDATE_TOKENS).contains(&value))
        || payload.top_k.is_some_and(|value| value < 0)
        || payload
            .presence_penalty
            .is_some_and(|value| !value.is_finite() || !(-2.0..=2.0).contains(&value))
        || payload
            .frequency_penalty
            .is_some_and(|value| !value.is_finite() || !(-2.0..=2.0).contains(&value))
        || payload.stop.iter().any(|value| value.trim().is_empty())
    {
        return Err(invalid_payload("local_app_text_generate_candidate"));
    }
    let mut saw_system = false;
    let mut saw_user = false;
    let mut prompt_bytes = 0usize;
    let mut messages = Vec::with_capacity(payload.messages.len());
    for message in payload.messages {
        let role = message.role;
        match role.as_str() {
            "system" if !saw_system && !saw_user => saw_system = true,
            "user" => saw_user = true,
            _ => return Err(invalid_payload("local_app_text_generate_candidate")),
        }
        let text = required_text(
            message.text,
            MAX_TEXT_CANDIDATE_MESSAGE_BYTES,
            "local_app_text_generate_candidate",
        )?;
        prompt_bytes = prompt_bytes
            .checked_add(role.len() + text.len())
            .ok_or_else(|| invalid_payload("local_app_text_generate_candidate"))?;
        if prompt_bytes > MAX_TEXT_CANDIDATE_PROMPT_BYTES {
            return Err(invalid_payload("local_app_text_generate_candidate"));
        }
        messages.push(LocalAppTextCandidateMessage { role, text });
    }
    if !saw_user {
        return Err(invalid_payload("local_app_text_generate_candidate"));
    }
    let result = host
        .generate_text_candidate(LocalAppTextCandidateRequest {
            messages,
            temperature: payload.temperature,
            top_p: payload.top_p,
            max_tokens: payload.max_tokens,
            top_k: payload.top_k,
            presence_penalty: payload.presence_penalty,
            frequency_penalty: payload.frequency_penalty,
            stop: payload.stop,
            seed: payload.seed,
        })
        .await
        .map_err(map_local_app_error)?;
    Ok(json!({
        "text": result.text,
        "finishReason": result.finish_reason,
        "traceId": result.trace_id,
    }))
}

pub async fn artifact_upload_for_host(
    host: &RuntimeBridgeLocalAppHost,
    payload: Value,
) -> Result<Value, String> {
    let payload: LocalAppArtifactUploadPayload =
        parse_payload(payload, "local_app_artifact_upload")?;
    if payload.bytes.is_empty()
        || payload.bytes.len() > 32 * 1024 * 1024
        || !matches!(
            payload.mime_type.as_str(),
            "image/png" | "image/jpeg" | "image/webp" | "image/gif"
        )
    {
        return Err(invalid_payload("local_app_artifact_upload"));
    }
    host.upload_scenario_artifact(LocalAppScenarioUploadArtifactRequest {
        bytes: payload.bytes,
        mime_type: payload.mime_type,
    })
    .await
    .map_err(map_local_app_error)
}

pub async fn ai_config_get_for_host(host: &RuntimeBridgeLocalAppHost) -> Result<Value, String> {
    host.app_ai_config_get().await.map_err(map_local_app_error)
}

pub async fn model_config_local_selections_get_for_host(
    host: &RuntimeBridgeLocalAppHost,
) -> Result<Value, String> {
    host.model_config_local_selections_get()
        .await
        .map_err(map_local_app_error)
}

pub async fn ai_config_overwrite_for_host(
    host: &RuntimeBridgeLocalAppHost,
    payload: Value,
) -> Result<Value, String> {
    let payload: LocalAppAIConfigOverwritePayload =
        parse_payload(payload, "local_app_ai_config_overwrite")?;
    if !payload.capabilities.is_array() {
        return Err(invalid_payload("local_app_ai_config_overwrite"));
    }
    host.app_ai_config_overwrite(LocalAppAIConfigOverwriteRequest {
        capabilities: payload.capabilities,
    })
    .await
    .map_err(map_local_app_error)
}

pub async fn shared_agent_ai_config_get_for_host(
    host: &RuntimeBridgeLocalAppHost,
) -> Result<Value, String> {
    host.shared_agent_ai_config_get()
        .await
        .map_err(map_local_app_error)
}

pub async fn shared_agent_ai_config_overwrite_for_host(
    host: &RuntimeBridgeLocalAppHost,
    payload: Value,
) -> Result<Value, String> {
    let payload: LocalAppAIConfigOverwritePayload =
        parse_payload(payload, "local_app_shared_agent_ai_config_overwrite")?;
    if !payload.capabilities.is_array() {
        return Err(invalid_payload(
            "local_app_shared_agent_ai_config_overwrite",
        ));
    }
    host.shared_agent_ai_config_overwrite(LocalAppSharedAgentAIConfigOverwriteRequest {
        capabilities: payload.capabilities,
    })
    .await
    .map_err(map_local_app_error)
}

pub async fn agent_autonomy_snapshot_for_host(
    host: &RuntimeBridgeLocalAppHost,
    payload: Value,
) -> Result<Value, String> {
    let payload: LocalAppAgentHandlePayload =
        parse_payload(payload, "local_app_agent_autonomy_snapshot")?;
    host.agent_autonomy_snapshot(LocalAppAgentHandleRequest {
        agent_handle: payload.agent_handle,
    })
    .await
    .map_err(map_local_app_error)
}

pub async fn agent_update_autonomy_for_host(
    host: &RuntimeBridgeLocalAppHost,
    payload: Value,
) -> Result<Value, String> {
    let payload: LocalAppAgentUpdateAutonomyPayload =
        parse_payload(payload, "local_app_agent_update_autonomy")?;
    let expected_autonomy_revision = decimal_revision(
        &payload.expected_autonomy_revision,
        false,
        "local_app_agent_update_autonomy",
    )?;
    host.agent_update_autonomy(LocalAppAgentUpdateAutonomyRequest {
        agent_handle: payload.agent_handle,
        expected_autonomy_revision,
        intent: payload.intent,
    })
    .await
    .map_err(map_local_app_error)
}

pub async fn agent_presentation_snapshot_for_host(
    host: &RuntimeBridgeLocalAppHost,
    payload: Value,
) -> Result<Value, String> {
    let payload: LocalAppAgentHandlePayload =
        parse_payload(payload, "local_app_agent_presentation_snapshot")?;
    host.agent_presentation_snapshot(LocalAppAgentHandleRequest {
        agent_handle: payload.agent_handle,
    })
    .await
    .map_err(map_local_app_error)
}

pub async fn agent_commit_presentation_for_host(
    host: &RuntimeBridgeLocalAppHost,
    payload: Value,
) -> Result<Value, String> {
    let payload: LocalAppAgentCommitPresentationPayload =
        parse_payload(payload, "local_app_agent_commit_presentation")?;
    let expected_presentation_revision = decimal_revision(
        &payload.expected_presentation_revision,
        true,
        "local_app_agent_commit_presentation",
    )?;
    host.agent_commit_presentation(LocalAppAgentCommitPresentationRequest {
        agent_handle: payload.agent_handle,
        expected_presentation_revision,
        intent: payload.intent,
        imported_assets: payload.imported_assets,
    })
    .await
    .map_err(map_local_app_error)
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

pub async fn asset_stat_for_host(
    host: &RuntimeBridgeLocalAppHost,
    payload: Value,
) -> Result<Value, String> {
    let payload: LocalAppStorageReadPayload = parse_payload(payload, "local_app_asset_stat")?;
    let asset = host
        .storage_asset_stat(LocalAppAssetStatRequest {
            relative_path: payload.relative_path,
        })
        .await
        .map_err(map_local_app_error)?;
    Ok(project_asset_record(asset))
}

pub async fn asset_list_for_host(
    host: &RuntimeBridgeLocalAppHost,
    payload: Value,
) -> Result<Value, String> {
    let payload: LocalAppAssetListPayload = parse_payload(payload, "local_app_asset_list")?;
    if !(1..=200).contains(&payload.page_size) {
        return Err(invalid_payload("local_app_asset_list"));
    }
    let result = host
        .storage_asset_list(LocalAppAssetListRequest {
            prefix: payload.prefix,
            cursor: payload.cursor,
            page_size: payload.page_size,
        })
        .await
        .map_err(map_local_app_error)?;
    Ok(json!({
        "assets": result.assets.into_iter().map(project_asset_record).collect::<Vec<_>>(),
        "nextCursor": result.next_cursor,
    }))
}

pub async fn asset_write_open_for_host(
    host: &RuntimeBridgeLocalAppHost,
    payload: Value,
) -> Result<Value, String> {
    let payload: LocalAppAssetWriteOpenPayload =
        parse_payload(payload, "local_app_asset_write_open")?;
    if payload.media_type.is_empty()
        || payload.media_type.trim() != payload.media_type
        || payload.media_type.len() > 512
    {
        return Err(invalid_payload("local_app_asset_write_open"));
    }
    let stream_id = host
        .storage_asset_write_open(LocalAppAssetWriteRequest {
            relative_path: payload.relative_path,
            media_type: payload.media_type,
            overwrite: payload.overwrite,
        })
        .await
        .map_err(map_local_app_error)?;
    Ok(json!({ "streamId": stream_id }))
}

pub async fn asset_write_chunk_for_host(
    host: &RuntimeBridgeLocalAppHost,
    payload: Value,
) -> Result<Value, String> {
    let payload: LocalAppAssetWriteChunkPayload =
        parse_payload(payload, "local_app_asset_write_chunk")?;
    if payload.body_chunk.is_empty() || payload.body_chunk.len() > MAX_ASSET_CHUNK_BYTES {
        return Err(invalid_payload("local_app_asset_write_chunk"));
    }
    host.storage_asset_write_chunk(&payload.stream_id, payload.body_chunk)
        .await
        .map_err(map_local_app_error)?;
    Ok(json!({ "accepted": true }))
}

pub async fn asset_write_commit_for_host(
    host: &RuntimeBridgeLocalAppHost,
    payload: Value,
) -> Result<Value, String> {
    let payload: LocalAppAssetStreamPayload =
        parse_payload(payload, "local_app_asset_write_commit")?;
    let asset = host
        .storage_asset_write_commit(&payload.stream_id)
        .await
        .map_err(map_local_app_error)?;
    Ok(project_asset_record(asset))
}

pub async fn asset_write_abort_for_host(
    host: &RuntimeBridgeLocalAppHost,
    payload: Value,
) -> Result<Value, String> {
    let payload: LocalAppAssetStreamPayload =
        parse_payload(payload, "local_app_asset_write_abort")?;
    Ok(json!({
        "closed": host.storage_asset_write_abort(&payload.stream_id).await,
    }))
}

pub async fn asset_read_open_for_host(
    host: &RuntimeBridgeLocalAppHost,
    payload: Value,
) -> Result<Value, String> {
    let payload: LocalAppAssetReadPayload = parse_payload(payload, "local_app_asset_read_open")?;
    if payload.offset.is_some_and(|value| value < 0)
        || payload.length.is_some_and(|value| value <= 0)
    {
        return Err(invalid_payload("local_app_asset_read_open"));
    }
    let result = host
        .storage_asset_read_open(LocalAppAssetReadRequest {
            relative_path: payload.relative_path,
            offset: payload.offset,
            length: payload.length,
        })
        .await
        .map_err(map_local_app_error)?;
    Ok(json!({
        "streamId": result.stream_id,
        "asset": project_asset_record(result.asset),
        "range": {
            "offset": result.range.offset,
            "length": result.range.length,
            "totalSize": result.range.total_size,
        },
    }))
}

pub async fn asset_read_next_for_host(
    host: &RuntimeBridgeLocalAppHost,
    payload: Value,
) -> Result<Value, String> {
    let payload: LocalAppAssetStreamPayload = parse_payload(payload, "local_app_asset_read_next")?;
    let result = host
        .storage_asset_read_next(&payload.stream_id)
        .await
        .map_err(map_local_app_error)?;
    if result.completed {
        Ok(json!({ "completed": true }))
    } else {
        Ok(json!({
            "completed": false,
            "bodyChunk": result.body_chunk.unwrap_or_default(),
        }))
    }
}

pub async fn asset_read_close_for_host(
    host: &RuntimeBridgeLocalAppHost,
    payload: Value,
) -> Result<Value, String> {
    let payload: LocalAppAssetStreamPayload = parse_payload(payload, "local_app_asset_read_close")?;
    Ok(json!({
        "closed": host.storage_asset_read_close(&payload.stream_id).await,
    }))
}

pub async fn asset_remove_for_host(
    host: &RuntimeBridgeLocalAppHost,
    payload: Value,
) -> Result<Value, String> {
    let payload: LocalAppStorageRemovePayload = parse_payload(payload, "local_app_asset_remove")?;
    let result = host
        .storage_asset_remove(LocalAppAssetRemoveRequest {
            relative_path: payload.relative_path,
        })
        .await
        .map_err(map_local_app_error)?;
    Ok(json!({ "removed": result.removed }))
}

pub async fn asset_move_for_host(
    host: &RuntimeBridgeLocalAppHost,
    payload: Value,
) -> Result<Value, String> {
    let payload: LocalAppAssetMovePayload = parse_payload(payload, "local_app_asset_move")?;
    let asset = host
        .storage_asset_move(LocalAppAssetMoveRequest {
            from_relative_path: payload.from_relative_path,
            to_relative_path: payload.to_relative_path,
            overwrite: payload.overwrite,
        })
        .await
        .map_err(map_local_app_error)?;
    Ok(project_asset_record(asset))
}

pub async fn asset_adopt_for_host(
    host: &RuntimeBridgeLocalAppHost,
    payload: Value,
) -> Result<Value, String> {
    let payload: LocalAppAssetAdoptPayload = parse_payload(payload, "local_app_asset_adopt")?;
    let asset = host
        .storage_asset_adopt(LocalAppAssetAdoptRequest {
            artifact_id: payload.artifact_id,
            relative_path: payload.relative_path,
            overwrite: payload.overwrite,
        })
        .await
        .map_err(map_local_app_error)?;
    Ok(project_asset_record(asset))
}

fn project_asset_record(asset: LocalAppAssetRecord) -> Value {
    json!({
        "relativePath": asset.relative_path,
        "mediaType": if asset.media_type.is_empty() { None } else { Some(asset.media_type) },
        "sizeBytes": asset.size_bytes,
        "sha256": asset.sha256,
        "createdAt": asset.created_at,
        "updatedAt": asset.updated_at,
    })
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

fn decimal_revision(value: &str, allow_zero: bool, command: &str) -> Result<u64, String> {
    if value.is_empty()
        || (value.len() > 1 && value.starts_with('0'))
        || (!allow_zero && value == "0")
        || !value.bytes().all(|byte| byte.is_ascii_digit())
    {
        return Err(invalid_payload(command));
    }
    value.parse::<u64>().map_err(|_| invalid_payload(command))
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
        Some(json!({
            "retryable": error.retryable(),
            "reasonMetadata": error.reason_metadata(),
        })),
    )
}

fn standard_code(reason: &str) -> &'static str {
    match reason {
        "protected-carrier-required" => "protected-carrier-required",
        "runtime-service-unavailable" | "ai-config-persistence-unavailable" => {
            "runtime-service-unavailable"
        }
        "runtime-service-untrusted" => "runtime-service-untrusted",
        "runtime-service-error-unclassified" => "runtime-service-error-unclassified",
        "runtime-service-repair-required" => "runtime-service-repair-required",
        "runtime-unauthenticated" => "runtime-unauthenticated",
        "invalid-payload" | "ai-config-invalid" => "invalid-payload",
        "not-found" | "ai-config-not-found" => "not-found",
        "resource-exhausted" => "resource-exhausted",
        _ => "runtime-permission-denied",
    }
}

fn action_hint(reason: &str) -> &'static str {
    match reason {
        "protected-carrier-required" => "install_verified_tauri_protected_carrier",
        "runtime-service-unavailable" => "start_fixed_runtime_service",
        "runtime-service-error-unclassified" => "inspect_runtime_service_error",
        "runtime-unauthenticated" => "open_request_empty_local_app_session",
        _ => "refresh_local_app_runtime_projection",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn payloads_reject_extra_authority_fields() {
        let error = parse_payload::<LocalAppStorageReadPayload>(
            json!({"relativePath": "state.json", "sessionProof": "forged"}),
            "storage",
        )
        .unwrap_err();
        assert!(error.contains("invalid-payload"));
    }

    #[test]
    fn text_candidate_payload_rejects_authority_and_preserves_optional_zero() {
        assert!(parse_payload::<LocalAppTextCandidatePayload>(
            json!({
                "messages": [{"role": "user", "text": "Create one persona."}],
                "temperature": 0.7,
                "topP": 0.9,
                "maxTokens": 512,
                "modelId": "forbidden"
            }),
            "text_candidate"
        )
        .is_err());
        let payload = parse_payload::<LocalAppTextCandidatePayload>(
            json!({
                "messages": [{"role": "user", "text": "Create one persona."}],
                "temperature": 0, "topP": 0, "maxTokens": 0, "topK": 0,
                "presencePenalty": -2, "frequencyPenalty": 2, "stop": ["END"], "seed": 0
            }),
            "text_candidate",
        )
        .expect("explicit zero sampling");
        assert_eq!(payload.temperature, Some(0.0));
        assert_eq!(payload.max_tokens, Some(0));
        assert_eq!(payload.seed, Some(0));
    }

    #[test]
    fn configure_payloads_reject_extra_fields_and_noncanonical_revisions() {
        assert!(parse_payload::<LocalAppAgentHandlePayload>(
            json!({"agentHandle": "agent_ref_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", "sessionProof": "forged"}),
            "autonomy_snapshot",
        )
        .is_err());
        assert!(decimal_revision("0", false, "autonomy_update").is_err());
        assert!(decimal_revision("01", true, "presentation_commit").is_err());
        assert_eq!(
            decimal_revision("0", true, "presentation_commit").expect("fresh presentation"),
            0,
        );
    }
}
