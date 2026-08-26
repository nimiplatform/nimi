use nimi_shell_protected_local::{
    LocalAppAIConfigLocalOptionsRequest, LocalAppAIConfigOverwriteRequest,
    LocalAppAgentCommitPresentationRequest, LocalAppAgentHandleRequest,
    LocalAppAgentUpdateAutonomyRequest, LocalAppAssetAdoptRequest, LocalAppAssetListRequest,
    LocalAppAssetMoveRequest, LocalAppAssetReadRequest, LocalAppAssetRecord,
    LocalAppAssetRemoveRequest, LocalAppAssetRevealRequest, LocalAppAssetStatRequest,
    LocalAppAssetWriteRequest, LocalAppOperationError, LocalAppPersonaCharacterCreateRequest,
    LocalAppPersonaCharacterDeleteRequest, LocalAppPersonaCharacterGetOwnedRequest,
    LocalAppPersonaCharacterListOwnedRequest, LocalAppPersonaCharacterReplaceRequest,
    LocalAppScenarioUploadArtifactRequest, LocalAppSessionStatus,
    LocalAppSharedAgentAIConfigLocalOptionsRequest, LocalAppSharedAgentAIConfigOverwriteRequest,
    LocalAppStorageReadRequest, LocalAppStorageRemoveRequest, LocalAppStorageWriteRequest,
    LocalAppTextCandidateMessage, LocalAppTextCandidateRequest, LocalAppWorldCoreCreateRequest,
    LocalAppWorldCoreListRequest,
};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::runtime_bridge::RuntimeBridgeLocalAppHost;

const MAX_TEXT_CANDIDATE_MESSAGES: usize = 8;
const MAX_TEXT_CANDIDATE_MESSAGE_BYTES: usize = 32 * 1024;
const MAX_TEXT_CANDIDATE_PROMPT_BYTES: usize = 64 * 1024;
const MAX_TEXT_CANDIDATE_TOKENS: i32 = 4096;
const MAX_ASSET_CHUNK_BYTES: usize = 1024 * 1024;
const MAX_PERSONA_REQUEST_BYTES: usize = 2 * 1024 * 1024;

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
pub struct LocalAppSharedAgentAIConfigOverwritePayload {
    expected_revision: String,
    capabilities: Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LocalAppAIConfigOverwritePayload {
    expected_revision: String,
    capabilities: Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LocalAppAIConfigLocalOptionsPayload {
    kind: String,
    capability_contract: String,
    connector_ref: Option<String>,
    search: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LocalAppArtifactUploadPayload {
    bytes: Vec<u8>,
    mime_type: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LocalAppWorldCoreListPayload {
    take: Option<u32>,
    visibility: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LocalAppWorldCoreCreatePayload {
    core: Value,
    id: Option<String>,
    lorebook_declaration: Value,
    origin: Value,
    visibility: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LocalAppPersonaCharacterListOwnedPayload {
    world_id: Option<String>,
    visibility: Option<String>,
    after_id: Option<String>,
    take: Option<u32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LocalAppPersonaCharacterGetOwnedPayload {
    persona_character_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LocalAppPersonaCharacterCreatePayload {
    world_id: String,
    visibility: String,
    origin: Value,
    lorebook_declaration: Value,
    profile: Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LocalAppPersonaCharacterReplacePayload {
    persona_character_id: String,
    base_content_hash: String,
    world_id: String,
    visibility: String,
    origin: Value,
    lorebook_declaration: Value,
    profile: Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LocalAppPersonaCharacterDeletePayload {
    persona_character_id: String,
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
    Ok(project_session_status(status))
}

fn project_session_status(status: LocalAppSessionStatus) -> Value {
    let current_user_reason = status.current_user.reason_code.as_str();
    let current_user_retryable = status.current_user.retryable;
    let current_user = match status.current_user.value {
        Some(value) => json!({
            "state": "ready",
            "value": {
                "handle": value.handle,
                "displayName": value.display_name,
                "avatarUrl": value.avatar_url,
            },
            "reasonCode": current_user_reason,
            "retryable": current_user_retryable,
        }),
        None => json!({
            "state": "unavailable",
            "value": null,
            "reasonCode": current_user_reason,
            "retryable": current_user_retryable,
        }),
    };
    json!({
        "state": status.state.as_str(),
        "reasonCode": status.reason_code.as_str(),
        "retryable": status.retryable,
        "currentUser": current_user,
    })
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
        || payload.bytes.len() > nimi_shell_protected_local::RUNTIME_MAX_INLINE_PAYLOAD_BYTES
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

pub async fn ai_config_overwrite_for_host(
    host: &RuntimeBridgeLocalAppHost,
    payload: Value,
) -> Result<Value, String> {
    let payload: LocalAppAIConfigOverwritePayload =
        parse_payload(payload, "local_app_ai_config_overwrite")?;
    host.app_ai_config_overwrite(LocalAppAIConfigOverwriteRequest {
        expected_revision: payload.expected_revision,
        capabilities: payload.capabilities,
    })
    .await
    .map_err(map_local_app_error)
}

pub async fn ai_config_local_options_for_host(
    host: &RuntimeBridgeLocalAppHost,
    payload: Value,
) -> Result<Value, String> {
    let payload: LocalAppAIConfigLocalOptionsPayload =
        parse_payload(payload, "local_app_ai_config_local_options")?;
    host.app_ai_config_local_options(LocalAppAIConfigLocalOptionsRequest {
        kind: payload.kind,
        capability_contract: payload.capability_contract,
        connector_ref: payload.connector_ref.unwrap_or_default(),
        search: payload.search,
    })
    .await
    .map_err(map_local_app_error)
}

pub async fn world_core_list_for_host(
    host: &RuntimeBridgeLocalAppHost,
    payload: Value,
) -> Result<Value, String> {
    let payload: LocalAppWorldCoreListPayload =
        parse_payload(payload, "local_app_realm_world_core_list")?;
    if payload
        .visibility
        .as_ref()
        .is_some_and(|value| !valid_world_visibility(value))
    {
        return Err(invalid_payload("local_app_realm_world_core_list"));
    }
    host.world_core_list(LocalAppWorldCoreListRequest {
        take: payload.take,
        visibility: payload.visibility,
    })
    .await
    .map_err(map_local_app_error)
}

pub async fn world_core_create_for_host(
    host: &RuntimeBridgeLocalAppHost,
    payload: Value,
) -> Result<Value, String> {
    let payload: LocalAppWorldCoreCreatePayload =
        parse_payload(payload, "local_app_realm_world_core_create")?;
    if !payload.core.is_object()
        || !payload.lorebook_declaration.is_object()
        || !payload.origin.is_object()
        || payload
            .id
            .as_ref()
            .is_some_and(|value| invalid_identifier(value))
        || payload
            .visibility
            .as_ref()
            .is_some_and(|value| !valid_world_visibility(value))
    {
        return Err(invalid_payload("local_app_realm_world_core_create"));
    }
    let mut body = json!({
        "core": payload.core,
        "lorebookDeclaration": payload.lorebook_declaration,
        "origin": payload.origin
    });
    let Some(object) = body.as_object_mut() else {
        return Err(invalid_payload("local_app_realm_world_core_create"));
    };
    if let Some(id) = payload.id {
        object.insert("id".to_string(), Value::String(id));
    }
    if let Some(visibility) = payload.visibility {
        object.insert("visibility".to_string(), Value::String(visibility));
    }
    host.world_core_create(LocalAppWorldCoreCreateRequest { body })
        .await
        .map_err(map_local_app_error)
}

pub async fn persona_character_list_owned_for_host(
    host: &RuntimeBridgeLocalAppHost,
    payload: Value,
) -> Result<Value, String> {
    let payload: LocalAppPersonaCharacterListOwnedPayload =
        parse_payload(payload, "local_app_persona_character_list_owned")?;
    if payload
        .world_id
        .as_ref()
        .is_some_and(|value| invalid_identifier(value))
        || payload
            .visibility
            .as_ref()
            .is_some_and(|value| !valid_visibility(value))
        || payload
            .after_id
            .as_ref()
            .is_some_and(|value| invalid_identifier(value))
        || payload
            .take
            .is_some_and(|value| !(1..=500).contains(&value))
    {
        return Err(invalid_payload("local_app_persona_character_list_owned"));
    }
    let result = host
        .persona_character_list_owned(LocalAppPersonaCharacterListOwnedRequest {
            world_id: payload.world_id,
            visibility: payload.visibility,
            after_id: payload.after_id,
            take: payload.take,
        })
        .await
        .map_err(map_local_app_error)?;
    Ok(result)
}

pub async fn persona_character_get_owned_for_host(
    host: &RuntimeBridgeLocalAppHost,
    payload: Value,
) -> Result<Value, String> {
    let payload: LocalAppPersonaCharacterGetOwnedPayload =
        parse_payload(payload, "local_app_persona_character_get_owned")?;
    if invalid_identifier(&payload.persona_character_id) {
        return Err(invalid_payload("local_app_persona_character_get_owned"));
    }
    let result = host
        .persona_character_get_owned(LocalAppPersonaCharacterGetOwnedRequest {
            persona_character_id: payload.persona_character_id,
        })
        .await
        .map_err(map_local_app_error)?;
    Ok(result)
}

pub async fn persona_character_create_for_host(
    host: &RuntimeBridgeLocalAppHost,
    payload: Value,
) -> Result<Value, String> {
    let payload: LocalAppPersonaCharacterCreatePayload =
        parse_payload(payload, "local_app_persona_character_create")?;
    if invalid_identifier(&payload.world_id)
        || !valid_visibility(&payload.visibility)
        || !payload.origin.is_object()
        || !payload.lorebook_declaration.is_object()
        || !payload.profile.is_object()
    {
        return Err(invalid_payload("local_app_persona_character_create"));
    }
    let body = json!({
        "worldId": payload.world_id,
        "visibility": payload.visibility,
        "origin": payload.origin,
        "lorebookDeclaration": payload.lorebook_declaration,
        "profile": payload.profile,
    });
    if serde_json::to_vec(&body)
        .map_err(|_| invalid_payload("local_app_persona_character_create"))?
        .len()
        > MAX_PERSONA_REQUEST_BYTES
    {
        return Err(request_too_large("local_app_persona_character_create"));
    }
    let result = host
        .persona_character_create(LocalAppPersonaCharacterCreateRequest { body })
        .await
        .map_err(map_local_app_error)?;
    Ok(result)
}

pub async fn persona_character_replace_for_host(
    host: &RuntimeBridgeLocalAppHost,
    payload: Value,
) -> Result<Value, String> {
    let payload: LocalAppPersonaCharacterReplacePayload =
        parse_payload(payload, "local_app_persona_character_replace")?;
    if invalid_identifier(&payload.persona_character_id)
        || invalid_identifier(&payload.world_id)
        || !valid_visibility(&payload.visibility)
        || !is_hash(&payload.base_content_hash)
        || !payload.origin.is_object()
        || !payload.lorebook_declaration.is_object()
        || !payload.profile.is_object()
    {
        return Err(invalid_payload("local_app_persona_character_replace"));
    }
    let body = json!({
        "baseContentHash": payload.base_content_hash,
        "worldId": payload.world_id,
        "visibility": payload.visibility,
        "origin": payload.origin,
        "lorebookDeclaration": payload.lorebook_declaration,
        "profile": payload.profile,
    });
    if serde_json::to_vec(&body)
        .map_err(|_| invalid_payload("local_app_persona_character_replace"))?
        .len()
        > MAX_PERSONA_REQUEST_BYTES
    {
        return Err(request_too_large("local_app_persona_character_replace"));
    }
    let result = host
        .persona_character_replace(LocalAppPersonaCharacterReplaceRequest {
            persona_character_id: payload.persona_character_id,
            body,
        })
        .await
        .map_err(map_local_app_error)?;
    Ok(result)
}

pub async fn persona_character_delete_for_host(
    host: &RuntimeBridgeLocalAppHost,
    payload: Value,
) -> Result<Value, String> {
    let payload: LocalAppPersonaCharacterDeletePayload =
        parse_payload(payload, "local_app_persona_character_delete")?;
    if invalid_identifier(&payload.persona_character_id) {
        return Err(invalid_payload("local_app_persona_character_delete"));
    }
    host.persona_character_delete(LocalAppPersonaCharacterDeleteRequest {
        persona_character_id: payload.persona_character_id,
    })
    .await
    .map_err(map_local_app_error)
}

fn invalid_identifier(value: &str) -> bool {
    value.is_empty()
        || value.trim() != value
        || value.len() > 512
        || value.chars().any(char::is_control)
}

fn valid_visibility(value: &str) -> bool {
    matches!(value, "private" | "unlisted" | "public")
}

fn valid_world_visibility(value: &str) -> bool {
    matches!(value, "private" | "unlisted" | "public" | "system")
}

fn is_hash(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
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
    let payload: LocalAppSharedAgentAIConfigOverwritePayload =
        parse_payload(payload, "local_app_shared_agent_ai_config_overwrite")?;
    if !payload.capabilities.is_array() {
        return Err(invalid_payload(
            "local_app_shared_agent_ai_config_overwrite",
        ));
    }
    host.shared_agent_ai_config_overwrite(LocalAppSharedAgentAIConfigOverwriteRequest {
        expected_revision: payload.expected_revision,
        capabilities: payload.capabilities,
    })
    .await
    .map_err(map_local_app_error)
}

pub async fn shared_agent_ai_config_local_options_for_host(
    host: &RuntimeBridgeLocalAppHost,
    payload: Value,
) -> Result<Value, String> {
    let payload: LocalAppAIConfigLocalOptionsPayload =
        parse_payload(payload, "local_app_shared_agent_ai_config_local_options")?;
    validate_shared_agent_ai_config_options_payload(&payload)?;
    host.shared_agent_ai_config_local_options(LocalAppSharedAgentAIConfigLocalOptionsRequest {
        kind: payload.kind,
        capability_contract: payload.capability_contract,
        connector_ref: payload.connector_ref.unwrap_or_default(),
        search: payload.search,
    })
    .await
    .map_err(map_local_app_error)
}

fn validate_shared_agent_ai_config_options_payload(
    payload: &LocalAppAIConfigLocalOptionsPayload,
) -> Result<(), String> {
    if payload.kind == "preset-voices"
        && (!payload.capability_contract.is_empty()
            || payload.connector_ref.is_some()
            || !payload.search.is_empty())
    {
        return Err(invalid_payload(
            "local_app_shared_agent_ai_config_local_options",
        ));
    }
    Ok(())
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

pub async fn asset_reveal_for_host(
    host: &RuntimeBridgeLocalAppHost,
    payload: Value,
) -> Result<Value, String> {
    let payload: LocalAppStorageReadPayload = parse_payload(payload, "local_app_asset_reveal")?;
    let target = host
        .storage_asset_reveal(LocalAppAssetRevealRequest {
            relative_path: payload.relative_path,
        })
        .await
        .map_err(map_local_app_error)?;
    tokio::task::spawn_blocking(move || {
        nimi_shell_protected_local::reveal_local_app_asset_target(target)
    })
    .await
    .map_err(|_| "host-internal-error".to_string())?
    .map_err(map_local_app_error)?;
    Ok(json!({ "revealed": true }))
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

fn request_too_large(command: &str) -> String {
    crate::capabilities::standard_shell_error(
        "request-too-large",
        "request-too-large",
        "reduce_persona_character_request_size",
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
        "capability-unavailable" => "capability-unavailable",
        "invalid-input" => "invalid-input",
        "session-invalid" => "session-invalid",
        "access-denied" => "access-denied",
        "owner-authority-missing" => "owner-authority-missing",
        "content-conflict" => "content-conflict",
        "realm-unavailable" => "realm-unavailable",
        "rate-limited" => "rate-limited",
        "upstream-failed" => "upstream-failed",
        "contract-invalid" => "contract-invalid",
        "request-too-large" => "request-too-large",
        "response-too-large" => "response-too-large",
        "runtime-service-unavailable" | "ai-config-persistence-unavailable" => {
            "runtime-service-unavailable"
        }
        "runtime-service-untrusted" => "runtime-service-untrusted",
        "runtime-service-error-unclassified" => "runtime-service-error-unclassified",
        "runtime-service-repair-required" => "runtime-service-repair-required",
        "runtime-unauthenticated" => "runtime-unauthenticated",
        "invalid-payload"
        | "ai-config-invalid"
        | "ai-voice-input-invalid"
        | "ai-voice-workflow-unsupported"
        | "ai-voice-asset-expired"
        | "ai-voice-target-model-mismatch"
        | "ai-voice-job-not-cancellable" => "invalid-payload",
        "not-found"
        | "ai-config-not-found"
        | "ai-voice-asset-not-found"
        | "ai-voice-job-not-found" => "not-found",
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
    use nimi_shell_protected_local::{
        LocalAppCurrentUserDisplay, LocalAppCurrentUserStatus, LocalAppReasonCode,
        LocalAppSessionState,
    };

    #[test]
    fn session_projection_matches_renderer_current_user_contract() {
        let ready = project_session_status(LocalAppSessionStatus {
            state: LocalAppSessionState::Ready,
            reason_code: LocalAppReasonCode::ActionExecuted,
            retryable: false,
            current_user: LocalAppCurrentUserStatus {
                value: Some(LocalAppCurrentUserDisplay {
                    handle: "halliday".to_string(),
                    display_name: "Halliday".to_string(),
                    avatar_url: None,
                }),
                reason_code: LocalAppReasonCode::ActionExecuted,
                retryable: false,
            },
        });
        assert_eq!(
            ready,
            json!({
                "state":"ready","reasonCode":"action-executed","retryable":false,
                "currentUser":{
                    "state":"ready","value":{"handle":"halliday","displayName":"Halliday","avatarUrl":null},
                    "reasonCode":"action-executed","retryable":false
                }
            })
        );

        let unavailable = project_session_status(LocalAppSessionStatus {
            state: LocalAppSessionState::Ready,
            reason_code: LocalAppReasonCode::ActionExecuted,
            retryable: false,
            current_user: LocalAppCurrentUserStatus {
                value: None,
                reason_code: LocalAppReasonCode::CurrentUserDisplayUnavailable,
                retryable: true,
            },
        });
        assert_eq!(unavailable["currentUser"]["state"], "unavailable");
        assert!(unavailable["currentUser"]["value"].is_null());
    }

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
    fn persona_list_payload_admits_only_bounded_owner_pagination_fields() {
        let payload = parse_payload::<LocalAppPersonaCharacterListOwnedPayload>(
            json!({"worldId":"world-1","visibility":"private","afterId":"persona-050","take":500}),
            "local_app_persona_character_list_owned",
        )
        .expect("bounded PersonaCharacter page");
        assert_eq!(payload.after_id.as_deref(), Some("persona-050"));
        assert_eq!(payload.take, Some(500));
        assert!(parse_payload::<LocalAppPersonaCharacterListOwnedPayload>(
            json!({"scope":"owned"}),
            "local_app_persona_character_list_owned",
        )
        .is_err());
        assert!(!valid_visibility("system"));
    }

    #[test]
    fn world_core_payloads_are_exact_and_purpose_specific() {
        let list = parse_payload::<LocalAppWorldCoreListPayload>(
            json!({"take":20,"visibility":"private"}),
            "local_app_realm_world_core_list",
        )
        .expect("WorldCore list payload");
        assert_eq!(list.take, Some(20));
        assert_eq!(list.visibility.as_deref(), Some("private"));
        assert!(parse_payload::<LocalAppWorldCoreListPayload>(
            json!({"methodId":"WorldCoreController_listWorldCores"}),
            "local_app_realm_world_core_list",
        )
        .is_err());

        let create = parse_payload::<LocalAppWorldCoreCreatePayload>(
            json!({
                "core":{},
                "lorebookDeclaration":{
                    "identityBaseSetting":"A test world.",
                    "rolePlacements":[],
                    "worldRules":[]
                },
                "origin":{"kind":"manual"},
                "visibility":"private"
            }),
            "local_app_realm_world_core_create",
        )
        .expect("WorldCore create payload");
        assert!(create.core.is_object());
        assert!(create.lorebook_declaration.is_object());
        assert!(create.origin.is_object());
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

    #[test]
    fn shared_preset_voice_options_require_empty_transport_sentinels() {
        let valid = parse_payload::<LocalAppAIConfigLocalOptionsPayload>(
            json!({"kind": "preset-voices", "capabilityContract": "", "search": ""}),
            "shared_preset_options",
        )
        .expect("shared preset payload");
        assert!(validate_shared_agent_ai_config_options_payload(&valid).is_ok());
        for invalid in [
            json!({"kind": "preset-voices", "capabilityContract": "audio.synthesize", "search": ""}),
            json!({"kind": "preset-voices", "capabilityContract": "", "connectorRef": "connector", "search": ""}),
            json!({"kind": "preset-voices", "capabilityContract": "", "search": "serena"}),
        ] {
            let payload = parse_payload::<LocalAppAIConfigLocalOptionsPayload>(
                invalid,
                "shared_preset_options",
            )
            .expect("structurally valid shared preset payload");
            assert!(validate_shared_agent_ai_config_options_payload(&payload).is_err());
        }
    }

    #[test]
    fn voice_failures_keep_exact_reason_in_standard_shell_envelopes() {
        for (reason, expected_code) in [
            (LocalAppReasonCode::AiVoiceInputInvalid, "invalid-payload"),
            (
                LocalAppReasonCode::AiVoiceTargetModelMismatch,
                "invalid-payload",
            ),
            (LocalAppReasonCode::AiVoiceAssetNotFound, "not-found"),
            (LocalAppReasonCode::AiVoiceAssetExpired, "invalid-payload"),
            (
                LocalAppReasonCode::AiVoiceAssetScopeForbidden,
                "runtime-permission-denied",
            ),
        ] {
            let envelope: Value = serde_json::from_str(&map_local_app_error(
                LocalAppOperationError::new(reason, false),
            ))
            .expect("standard shell error JSON");
            assert_eq!(envelope["code"], expected_code);
            assert_eq!(envelope["reasonCode"], reason.as_str());
            assert_eq!(envelope["source"], "runtime");
        }
    }

    #[test]
    fn persona_size_and_projection_failures_use_standard_envelopes() {
        for (raw, code, source) in [
            (
                request_too_large("local_app_persona_character_create"),
                "request-too-large",
                "tauri",
            ),
            (
                map_local_app_error(LocalAppOperationError::new(
                    LocalAppReasonCode::ContractInvalid,
                    false,
                )),
                "contract-invalid",
                "runtime",
            ),
        ] {
            let envelope: Value =
                serde_json::from_str(&raw).expect("standard PersonaCharacter envelope");
            assert_eq!(envelope["code"], code);
            assert_eq!(envelope["reasonCode"], code);
            assert_eq!(envelope["source"], source);
        }
    }
}
