use nimi_shell_protected_local::{
    LocalAppAIConfigLocalOptionsRequest, LocalAppAIConfigOverwriteRequest,
    LocalAppActivityListRequest, LocalAppActivityMarkReadRequest, LocalAppActivityOpenRequest,
    LocalAppActivityOpenRequestCompleteRequest, LocalAppActivityPutRequest,
    LocalAppActivitySubscribeRequest, LocalAppActivityTimestamp,
    LocalAppAgentCommitPresentationRequest, LocalAppAgentHandleRequest,
    LocalAppAgentManagerSnapshotRequest, LocalAppAgentMemoryCorrectRequest,
    LocalAppAgentMemoryDeleteRequest, LocalAppAgentMemoryForgetRequest,
    LocalAppAgentMemoryInspectRequest, LocalAppAgentMemorySwitchRequest,
    LocalAppAgentPresentationAssetInput, LocalAppAgentPresentationAssetReadRequest,
    LocalAppAgentUpdateAutonomyRequest, LocalAppAssetAdoptRequest, LocalAppAssetListRequest,
    LocalAppAssetMoveRequest, LocalAppAssetReadRequest, LocalAppAssetRecord,
    LocalAppAssetRemoveRequest, LocalAppAssetRevealRequest, LocalAppAssetStatRequest,
    LocalAppAssetWriteRequest, LocalAppEmbodimentSnapshotRequest,
    LocalAppEmbodimentSubscribeRequest, LocalAppOperationError,
    LocalAppPersonaCharacterCreateRequest, LocalAppPersonaCharacterDeleteRequest,
    LocalAppPersonaCharacterGetOwnedRequest, LocalAppPersonaCharacterListOwnedRequest,
    LocalAppPersonaCharacterReplaceRequest, LocalAppScenarioUploadArtifactRequest,
    LocalAppSessionStatus, LocalAppSharedAgentAIConfigLocalOptionsRequest,
    LocalAppSharedAgentAIConfigOverwriteRequest, LocalAppStorageReadRequest,
    LocalAppStorageRemoveRequest, LocalAppStorageWriteRequest, LocalAppTextCandidateMessage,
    LocalAppTextCandidateRequest, LocalAppWorldCharacterCreateRequest,
    LocalAppWorldCharacterGetRequest, LocalAppWorldCharacterListRequest,
    LocalAppWorldCharacterReplaceRequest, LocalAppWorldCoreCreateRequest,
    LocalAppWorldCoreGetRequest, LocalAppWorldCoreListRequest, LocalAppWorldCoreReplaceRequest,
    LocalAppWorldEntityCreateRequest, LocalAppWorldEntityGetRequest,
    LocalAppWorldEntityListRequest, LocalAppWorldRelationshipGetRequest,
    LocalAppWorldRelationshipListRequest,
};
use nimi_shell_protected_local::{LocalAppRealtimeSubscriptionReceiver, LocalAppReasonCode};
use serde::Deserialize;
use serde_json::{json, Value};
use std::future::Future;
use std::time::Duration;

use crate::runtime_bridge::RuntimeBridgeLocalAppHost;
use crate::standard_desktop_open::AppActivitySourceLaunch;

const ACTIVITY_PUT_COMMAND: &str = "local_app_activity_put";
const ACTIVITY_LIST_COMMAND: &str = "local_app_activity_list";
const ACTIVITY_SUBSCRIBE_COMMAND: &str = "local_app_activity_subscribe";
const ACTIVITY_MARK_READ_COMMAND: &str = "local_app_activity_mark_read";
const ACTIVITY_OPEN_COMMAND: &str = "local_app_activity_open";
const ACTIVITY_OPEN_REQUESTS_SUBSCRIBE_COMMAND: &str = "local_app_activity_open_requests_subscribe";
const ACTIVITY_OPEN_REQUEST_COMPLETE_COMMAND: &str = "local_app_activity_open_request_complete";
/// Largest revision the renderer JSON number carries exactly.
const MAX_ACTIVITY_REVISION: u64 = (1 << 53) - 1;
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
    #[serde(default)]
    bytes: Vec<u8>,
    mime_type: String,
    source: Option<nimi_shell_protected_local::LocalAppArtifactUploadSource>,
    audio_preparation: Option<nimi_shell_protected_local::LocalAppCanonicalAudioPreparation>,
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
pub struct LocalAppAgentMemoryInspectPayload {
    agent_handle: String,
    limit: Option<u32>,
    page_token: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LocalAppAgentManagerSnapshotPayload {
    agent_handle: String,
    conversation_anchor_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LocalAppEmbodimentSnapshotPayload {
    agent_handle: String,
    conversation_anchor_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LocalAppEmbodimentSubscribeOpenPayload {
    agent_handle: String,
    conversation_anchor_id: String,
    after_sequence: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LocalAppEmbodimentSubscribeControlPayload {
    action: String,
    subscription_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
pub enum LocalAppEmbodimentSubscribePayload {
    Open(LocalAppEmbodimentSubscribeOpenPayload),
    Control(LocalAppEmbodimentSubscribeControlPayload),
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LocalAppActivityPutPayload {
    key: String,
    revision: u64,
    kind: String,
    todo_state: Option<String>,
    attention: bool,
    title: String,
    summary: Option<String>,
    object_ref: Option<String>,
    r#type: String,
    data_json: Option<String>,
    occurred_at: String,
    agent_handle: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LocalAppActivityFilterPayload {
    source_ref: Option<String>,
    kind: Option<String>,
    todo_states: Vec<String>,
    agent_ref: Option<String>,
    occurred_after: Option<String>,
    occurred_before: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LocalAppActivityListPayload {
    filter: LocalAppActivityFilterPayload,
    page_size: u32,
    page_token: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LocalAppActivitySubscribeOpenPayload {
    after_change_seq: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LocalAppActivityStreamControlPayload {
    action: String,
    subscription_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
pub enum LocalAppActivitySubscribePayload {
    Open(LocalAppActivitySubscribeOpenPayload),
    Control(LocalAppActivityStreamControlPayload),
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LocalAppActivityOpenRequestsSubscribeOpenPayload {}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
pub enum LocalAppActivityOpenRequestsSubscribePayload {
    Open(LocalAppActivityOpenRequestsSubscribeOpenPayload),
    Control(LocalAppActivityStreamControlPayload),
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LocalAppActivityMarkReadPayload {
    activity_id: String,
    displayed_revision: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LocalAppActivityOpenPayload {
    activity_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LocalAppActivityOpenRequestCompletePayload {
    delivery_id: String,
    completion: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LocalAppAgentMemoryCorrectPayload {
    agent_handle: String,
    memory_id: String,
    corrected_content: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LocalAppAgentMemoryForgetPayload {
    agent_handle: String,
    memory_ids: Vec<String>,
    confirmed: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LocalAppAgentMemorySwitchPayload {
    agent_handle: String,
    enabled: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LocalAppAgentMemoryDeletePayload {
    agent_handle: String,
    confirmed: bool,
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
pub struct LocalAppAgentPresentationAssetPayload {
    role: String,
    file_name: String,
    media_type: String,
    content: Vec<u8>,
    sha256: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LocalAppAgentCommitPresentationPayload {
    agent_handle: String,
    expected_presentation_revision: String,
    intent: Value,
    imported_assets: Vec<LocalAppAgentPresentationAssetPayload>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LocalAppAgentPresentationAssetReadPayload {
    agent_handle: String,
    asset_ref: String,
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
    host.upload_scenario_artifact(artifact_upload_request(payload)?)
        .await
        .map_err(map_local_app_error)
}

// @nimi-authority: rule.nimi.runtime.ai-provider.r109
fn artifact_upload_request(
    payload: Value,
) -> Result<LocalAppScenarioUploadArtifactRequest, String> {
    let payload: LocalAppArtifactUploadPayload =
        parse_payload(payload, "local_app_artifact_upload")?;
    if payload.bytes.is_empty() == payload.source.is_none()
        || payload.bytes.len() > nimi_shell_protected_local::RUNTIME_MAX_INLINE_PAYLOAD_BYTES
        || !matches!(
            payload.mime_type.as_str(),
            "image/png"
                | "image/jpeg"
                | "image/webp"
                | "image/gif"
                | "audio/wav"
                | "audio/mpeg"
                | "audio/flac"
                | "video/mp4"
        )
    {
        return Err(invalid_payload("local_app_artifact_upload"));
    }
    Ok(LocalAppScenarioUploadArtifactRequest {
        bytes: payload.bytes,
        mime_type: payload.mime_type,
        source: payload.source,
        audio_preparation: payload.audio_preparation,
    })
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
    validate_app_ai_config_options_payload(&payload)?;
    host.app_ai_config_local_options(LocalAppAIConfigLocalOptionsRequest {
        kind: payload.kind,
        capability_contract: payload.capability_contract,
        connector_ref: payload.connector_ref.unwrap_or_default(),
        search: payload.search,
    })
    .await
    .map_err(map_local_app_error)
}

fn validate_app_ai_config_options_payload(
    payload: &LocalAppAIConfigLocalOptionsPayload,
) -> Result<(), String> {
    if payload.kind == "preset-voices"
        && (!payload.capability_contract.is_empty()
            || payload.connector_ref.is_some()
            || !payload.search.is_empty())
    {
        return Err(invalid_payload("local_app_ai_config_local_options"));
    }
    Ok(())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LocalAppWorldCoreGetPayload {
    world_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LocalAppWorldCoreReplacePayload {
    world_id: String,
    body: Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LocalAppWorldCharacterListPayload {
    world_id: String,
    visibility: Option<String>,
    after_id: Option<String>,
    take: Option<u32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LocalAppWorldCharacterGetPayload {
    character_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LocalAppWorldCharacterCreatePayload {
    world_id: String,
    body: Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LocalAppWorldCharacterReplacePayload {
    character_id: String,
    body: Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LocalAppWorldEntityListPayload {
    world_id: String,
    kind: Option<String>,
    after_id: Option<String>,
    take: Option<u32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LocalAppWorldEntityGetPayload {
    entity_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LocalAppWorldEntityCreatePayload {
    world_id: String,
    body: Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LocalAppWorldRelationshipListPayload {
    world_id: String,
    entity_id: Option<String>,
    source_entity_id: Option<String>,
    target_entity_id: Option<String>,
    r#type: Option<String>,
    after_id: Option<String>,
    take: Option<u32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LocalAppWorldRelationshipGetPayload {
    relationship_id: String,
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
    if (payload.kind == "preset-voices" || payload.kind == "voice-assets")
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

pub async fn agent_manager_snapshot_for_host(
    host: &RuntimeBridgeLocalAppHost,
    payload: Value,
) -> Result<Value, String> {
    let payload: LocalAppAgentManagerSnapshotPayload =
        parse_payload(payload, "local_app_agent_manager_snapshot")?;
    host.agent_manager_snapshot(LocalAppAgentManagerSnapshotRequest {
        agent_handle: payload.agent_handle,
        conversation_anchor_id: payload.conversation_anchor_id,
    })
    .await
    .map_err(map_local_app_error)
}

pub async fn embodiment_snapshot_for_host(
    host: &RuntimeBridgeLocalAppHost,
    payload: Value,
) -> Result<Value, String> {
    let payload: LocalAppEmbodimentSnapshotPayload =
        parse_payload(payload, "local_app_embodiment_snapshot")?;
    host.embodiment_snapshot(LocalAppEmbodimentSnapshotRequest {
        agent_handle: payload.agent_handle,
        conversation_anchor_id: payload.conversation_anchor_id,
    })
    .await
    .map_err(map_local_app_error)
}

pub async fn embodiment_subscribe_for_host(
    host: &RuntimeBridgeLocalAppHost,
    payload: Value,
) -> Result<Value, String> {
    let payload: LocalAppEmbodimentSubscribePayload =
        parse_payload(payload, "local_app_embodiment_subscribe")?;
    match payload {
        LocalAppEmbodimentSubscribePayload::Open(payload) => {
            let after_sequence = decimal_revision(
                &payload.after_sequence,
                true,
                "local_app_embodiment_subscribe",
            )?;
            let subscription_id = host
                .embodiment_subscribe(LocalAppEmbodimentSubscribeRequest {
                    agent_handle: payload.agent_handle,
                    conversation_anchor_id: payload.conversation_anchor_id,
                    after_sequence,
                })
                .await
                .map_err(map_local_app_error)?;
            Ok(json!({ "subscriptionId": subscription_id }))
        }
        LocalAppEmbodimentSubscribePayload::Control(payload) => match payload.action.as_str() {
            "next" => {
                let next = host
                    .embodiment_stream_next(&payload.subscription_id)
                    .await
                    .map_err(map_local_app_error)?;
                if next.completed {
                    Ok(json!({ "subscriptionId": payload.subscription_id, "completed": true }))
                } else {
                    Ok(json!({
                        "subscriptionId": payload.subscription_id,
                        "completed": false,
                        "event": next.event.ok_or_else(|| invalid_payload("local_app_embodiment_subscribe"))?,
                    }))
                }
            }
            "cancel" => Ok(json!({
                "subscriptionId": payload.subscription_id,
                "closed": host.embodiment_stream_close(&payload.subscription_id).await,
            })),
            _ => Err(invalid_payload("local_app_embodiment_subscribe")),
        },
    }
}

pub async fn activity_put_for_host(
    host: &RuntimeBridgeLocalAppHost,
    payload: Value,
) -> Result<Value, String> {
    let payload: LocalAppActivityPutPayload = parse_payload(payload, ACTIVITY_PUT_COMMAND)?;
    host.activity_put(activity_put_request(payload)?)
        .await
        .map_err(map_local_app_error)
}

fn activity_put_request(
    payload: LocalAppActivityPutPayload,
) -> Result<LocalAppActivityPutRequest, String> {
    let command = ACTIVITY_PUT_COMMAND;
    let occurred_at = activity_instant(&payload.occurred_at, command)?;
    Ok(LocalAppActivityPutRequest {
        key: payload.key,
        revision: activity_revision(payload.revision, command)?,
        kind: activity_kind(payload.kind, command)?,
        todo_state: payload
            .todo_state
            .map(|state| activity_todo_state(state, command))
            .transpose()?,
        attention: payload.attention,
        title: payload.title,
        summary: payload.summary,
        object_ref: payload.object_ref,
        activity_type: payload.r#type,
        data_json: payload.data_json,
        occurred_at_seconds: occurred_at.seconds,
        occurred_at_nanos: occurred_at.nanos,
        agent_handle: payload.agent_handle,
    })
}

pub async fn activity_list_for_host(
    host: &RuntimeBridgeLocalAppHost,
    payload: Value,
) -> Result<Value, String> {
    let payload: LocalAppActivityListPayload = parse_payload(payload, ACTIVITY_LIST_COMMAND)?;
    host.activity_list(activity_list_request(payload)?)
        .await
        .map_err(map_local_app_error)
}

fn activity_list_request(
    payload: LocalAppActivityListPayload,
) -> Result<LocalAppActivityListRequest, String> {
    let command = ACTIVITY_LIST_COMMAND;
    let filter = payload.filter;
    Ok(LocalAppActivityListRequest {
        source_ref: filter.source_ref,
        kind: filter
            .kind
            .map(|kind| activity_kind(kind, command))
            .transpose()?,
        todo_states: filter
            .todo_states
            .into_iter()
            .map(|state| activity_todo_state(state, command))
            .collect::<Result<Vec<_>, _>>()?,
        agent_ref: filter.agent_ref,
        occurred_after: filter
            .occurred_after
            .map(|value| activity_instant(&value, command))
            .transpose()?,
        occurred_before: filter
            .occurred_before
            .map(|value| activity_instant(&value, command))
            .transpose()?,
        page_size: payload.page_size,
        page_token: payload.page_token,
    })
}

pub async fn activity_subscribe_for_host(
    host: &RuntimeBridgeLocalAppHost,
    payload: Value,
) -> Result<Value, String> {
    let command = ACTIVITY_SUBSCRIBE_COMMAND;
    match parse_payload::<LocalAppActivitySubscribePayload>(payload, command)? {
        LocalAppActivitySubscribePayload::Open(payload) => {
            let after_change_seq = decimal_revision(&payload.after_change_seq, true, command)?;
            let subscription_id = host
                .activity_subscribe(LocalAppActivitySubscribeRequest { after_change_seq })
                .await
                .map_err(map_local_app_error)?;
            Ok(json!({ "subscriptionId": subscription_id }))
        }
        LocalAppActivitySubscribePayload::Control(payload) => match payload.action.as_str() {
            "next" => {
                let next = host
                    .activity_stream_next(&payload.subscription_id)
                    .await
                    .map_err(map_local_app_error)?;
                activity_pull_result(payload.subscription_id, next.completed, next.event, command)
            }
            "cancel" => Ok(json!({
                "subscriptionId": payload.subscription_id,
                "closed": host.activity_stream_close(&payload.subscription_id).await,
            })),
            _ => Err(invalid_payload(command)),
        },
    }
}

pub async fn activity_mark_read_for_host(
    host: &RuntimeBridgeLocalAppHost,
    payload: Value,
) -> Result<Value, String> {
    let command = ACTIVITY_MARK_READ_COMMAND;
    let payload: LocalAppActivityMarkReadPayload = parse_payload(payload, command)?;
    host.activity_mark_read(LocalAppActivityMarkReadRequest {
        activity_id: payload.activity_id,
        displayed_revision: activity_revision(payload.displayed_revision, command)?,
    })
    .await
    .map_err(map_local_app_error)
}

// @nimi-authority: rule.nimi.platform.core-protocol.p-actv-005
/// Consumer-side source open. The Runtime stream's Host-private open request
/// id is consumed here for the Desktop launch and never returned; only the
/// Runtime's typed result, or the typed Desktop launch refusal, reaches the
/// renderer.
pub async fn activity_open_for_host(
    host: &RuntimeBridgeLocalAppHost,
    payload: Value,
) -> Result<Value, String> {
    let payload: LocalAppActivityOpenPayload = parse_payload(payload, ACTIVITY_OPEN_COMMAND)?;
    let events = host
        .activity_open(LocalAppActivityOpenRequest {
            activity_id: payload.activity_id,
        })
        .await
        .map_err(map_local_app_error)?;
    drive_activity_open(events, |open_request_id| async move {
        crate::standard_desktop_open::request_app_activity_source_launch(&open_request_id).await
    })
    .await
    .map_err(map_local_app_error)
}

/// After a refused or failed Desktop launch, a source App that is already
/// running may still confirm the object; the Host waits this long for the
/// Runtime result before reporting the launch refusal.
const APP_ACTIVITY_LAUNCH_FAILURE_GRACE: Duration = Duration::from_secs(5);

/// Launch alone never yields opened: a requested launch waits for the
/// Runtime result. A refused launch waits a bounded grace for the Runtime
/// result and otherwise drops the stream, which cancels the pending Runtime
/// open request.
async fn drive_activity_open<L, F>(
    events: LocalAppRealtimeSubscriptionReceiver,
    launch: L,
) -> Result<Value, LocalAppOperationError>
where
    L: FnOnce(String) -> F,
    F: Future<Output = AppActivitySourceLaunch>,
{
    drive_activity_open_with_grace(events, launch, APP_ACTIVITY_LAUNCH_FAILURE_GRACE).await
}

async fn drive_activity_open_with_grace<L, F>(
    mut events: LocalAppRealtimeSubscriptionReceiver,
    launch: L,
    grace: Duration,
) -> Result<Value, LocalAppOperationError>
where
    L: FnOnce(String) -> F,
    F: Future<Output = AppActivitySourceLaunch>,
{
    let untrusted =
        || LocalAppOperationError::new(LocalAppReasonCode::RuntimeServiceUntrusted, false);
    let mut pending_launch = Some(launch);
    let mut launch_refusal: Option<(Value, tokio::time::Instant)> = None;
    loop {
        let next = match &launch_refusal {
            None => events.recv().await,
            Some((refusal, deadline)) => {
                match tokio::time::timeout_at(*deadline, events.recv()).await {
                    Ok(next) => next,
                    Err(_) => {
                        drop(events);
                        return Ok(refusal.clone());
                    }
                }
            }
        };
        let event = match next {
            Some(Ok(event)) => event,
            Some(Err(error)) => {
                return match launch_refusal {
                    Some((refusal, _)) => Ok(refusal),
                    None => Err(error),
                }
            }
            None => {
                return match launch_refusal {
                    Some((refusal, _)) => Ok(refusal),
                    None => Err(untrusted()),
                }
            }
        };
        if let Some(result) = event.get("result") {
            return Ok(result.clone());
        }
        // At most one open request precedes the result.
        let (Some(open_request_id), Some(request_launch)) = (
            event.get("openRequestId").and_then(Value::as_str),
            pending_launch.take(),
        ) else {
            return Err(untrusted());
        };
        match request_launch(open_request_id.to_string()).await {
            AppActivitySourceLaunch::Requested => continue,
            AppActivitySourceLaunch::Declined { outcome, reason } => {
                // Only the source App's confirmation yields opened; a
                // running source may still confirm although launch failed.
                launch_refusal = Some((
                    json!({ "outcome": outcome, "reason": reason }),
                    tokio::time::Instant::now() + grace,
                ));
            }
        }
    }
}

pub async fn activity_open_requests_subscribe_for_host(
    host: &RuntimeBridgeLocalAppHost,
    payload: Value,
) -> Result<Value, String> {
    let command = ACTIVITY_OPEN_REQUESTS_SUBSCRIBE_COMMAND;
    match parse_payload::<LocalAppActivityOpenRequestsSubscribePayload>(payload, command)? {
        LocalAppActivityOpenRequestsSubscribePayload::Open(_) => {
            let subscription_id = host
                .activity_open_requests_subscribe()
                .await
                .map_err(map_local_app_error)?;
            Ok(json!({ "subscriptionId": subscription_id }))
        }
        LocalAppActivityOpenRequestsSubscribePayload::Control(payload) => {
            match payload.action.as_str() {
                "next" => {
                    let next = host
                        .activity_open_requests_stream_next(&payload.subscription_id)
                        .await
                        .map_err(map_local_app_error)?;
                    activity_pull_result(
                        payload.subscription_id,
                        next.completed,
                        next.event,
                        command,
                    )
                }
                "cancel" => Ok(json!({
                    "subscriptionId": payload.subscription_id,
                    "closed": host
                        .activity_open_requests_stream_close(&payload.subscription_id)
                        .await,
                })),
                _ => Err(invalid_payload(command)),
            }
        }
    }
}

pub async fn activity_open_request_complete_for_host(
    host: &RuntimeBridgeLocalAppHost,
    payload: Value,
) -> Result<Value, String> {
    let command = ACTIVITY_OPEN_REQUEST_COMPLETE_COMMAND;
    let payload: LocalAppActivityOpenRequestCompletePayload = parse_payload(payload, command)?;
    if !matches!(payload.completion.as_str(), "opened" | "object-unavailable") {
        return Err(invalid_payload(command));
    }
    host.activity_open_request_complete(LocalAppActivityOpenRequestCompleteRequest {
        delivery_id: payload.delivery_id,
        completion: payload.completion,
    })
    .await
    .map_err(map_local_app_error)
}

fn activity_pull_result(
    subscription_id: String,
    completed: bool,
    event: Option<Value>,
    command: &str,
) -> Result<Value, String> {
    if completed {
        return Ok(json!({ "subscriptionId": subscription_id, "completed": true }));
    }
    Ok(json!({
        "subscriptionId": subscription_id,
        "completed": false,
        "event": event.ok_or_else(|| invalid_payload(command))?,
    }))
}

fn activity_revision(value: u64, command: &str) -> Result<u64, String> {
    if value == 0 || value > MAX_ACTIVITY_REVISION {
        return Err(invalid_payload(command));
    }
    Ok(value)
}

fn activity_kind(value: String, command: &str) -> Result<String, String> {
    if !matches!(value.as_str(), "activity" | "todo") {
        return Err(invalid_payload(command));
    }
    Ok(value)
}

fn activity_todo_state(value: String, command: &str) -> Result<String, String> {
    if !matches!(value.as_str(), "open" | "completed" | "cancelled") {
        return Err(invalid_payload(command));
    }
    Ok(value)
}

/// Strict RFC 3339 UTC instant as produced by `Date.prototype.toISOString`:
/// `YYYY-MM-DDTHH:MM:SS[.fraction]Z` with at most nine fraction digits.
fn activity_instant(value: &str, command: &str) -> Result<LocalAppActivityTimestamp, String> {
    let bytes = value.as_bytes();
    let digits = |range: std::ops::Range<usize>| bytes[range].iter().all(u8::is_ascii_digit);
    let shaped = (20..=30).contains(&bytes.len())
        && digits(0..4)
        && bytes[4] == b'-'
        && digits(5..7)
        && bytes[7] == b'-'
        && digits(8..10)
        && bytes[10] == b'T'
        && digits(11..13)
        && bytes[13] == b':'
        && digits(14..16)
        && bytes[16] == b':'
        && digits(17..19)
        && match &bytes[19..] {
            [b'Z'] => true,
            [b'.', fraction @ .., b'Z'] => {
                !fraction.is_empty() && fraction.len() <= 9 && fraction.iter().all(u8::is_ascii_digit)
            }
            _ => false,
        };
    if !shaped {
        return Err(invalid_payload(command));
    }
    let parsed =
        chrono::DateTime::parse_from_rfc3339(value).map_err(|_| invalid_payload(command))?;
    let nanos = parsed.timestamp_subsec_nanos();
    if nanos >= 1_000_000_000 {
        return Err(invalid_payload(command));
    }
    Ok(LocalAppActivityTimestamp {
        seconds: parsed.timestamp(),
        nanos: nanos as i32,
    })
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

pub async fn agent_presentation_read_asset_for_host(
    host: &RuntimeBridgeLocalAppHost,
    payload: Value,
) -> Result<Value, String> {
    let payload: LocalAppAgentPresentationAssetReadPayload =
        parse_payload(payload, "local_app_agent_presentation_read_asset")?;
    host.agent_presentation_read_asset(LocalAppAgentPresentationAssetReadRequest {
        agent_handle: payload.agent_handle,
        asset_ref: payload.asset_ref,
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
        imported_assets: payload
            .imported_assets
            .into_iter()
            .map(|asset| LocalAppAgentPresentationAssetInput {
                role: asset.role,
                file_name: asset.file_name,
                media_type: asset.media_type,
                content: asset.content,
                sha256: asset.sha256,
            })
            .collect(),
    })
    .await
    .map_err(map_local_app_error)
}

pub async fn agent_memory_inspect_for_host(
    host: &RuntimeBridgeLocalAppHost,
    payload: Value,
) -> Result<Value, String> {
    let payload: LocalAppAgentMemoryInspectPayload =
        parse_payload(payload, "local_app_agent_memory_inspect")?;
    host.agent_memory_inspect(memory_inspect_request(payload)?)
        .await
        .map_err(map_local_app_error)
}

fn memory_inspect_request(
    payload: LocalAppAgentMemoryInspectPayload,
) -> Result<LocalAppAgentMemoryInspectRequest, String> {
    let command = "local_app_agent_memory_inspect";
    let limit = payload.limit.unwrap_or(100);
    let page_token = payload.page_token.unwrap_or_default();
    if !(1..=100).contains(&limit)
        || page_token.trim() != page_token
        || page_token.len() > 1024
        || page_token.chars().any(|character| {
            ('\u{0000}'..='\u{001f}').contains(&character) || character == '\u{007f}'
        })
    {
        return Err(invalid_payload(command));
    }
    Ok(LocalAppAgentMemoryInspectRequest {
        agent_handle: payload.agent_handle,
        limit,
        page_token,
    })
}

pub async fn agent_memory_correct_for_host(
    host: &RuntimeBridgeLocalAppHost,
    payload: Value,
) -> Result<Value, String> {
    let payload: LocalAppAgentMemoryCorrectPayload =
        parse_payload(payload, "local_app_agent_memory_correct")?;
    host.agent_memory_correct(LocalAppAgentMemoryCorrectRequest {
        agent_handle: payload.agent_handle,
        memory_id: payload.memory_id,
        corrected_content: payload.corrected_content,
    })
    .await
    .map_err(map_local_app_error)
}

pub async fn agent_memory_forget_for_host(
    host: &RuntimeBridgeLocalAppHost,
    payload: Value,
) -> Result<Value, String> {
    let payload: LocalAppAgentMemoryForgetPayload =
        parse_payload(payload, "local_app_agent_memory_forget")?;
    if !payload.confirmed || payload.memory_ids.is_empty() || payload.memory_ids.len() > 100 {
        return Err(invalid_payload("local_app_agent_memory_forget"));
    }
    host.agent_memory_forget(LocalAppAgentMemoryForgetRequest {
        agent_handle: payload.agent_handle,
        memory_ids: payload.memory_ids,
        confirmed: payload.confirmed,
    })
    .await
    .map_err(map_local_app_error)
}

pub async fn agent_memory_switch_for_host(
    host: &RuntimeBridgeLocalAppHost,
    payload: Value,
) -> Result<Value, String> {
    let payload: LocalAppAgentMemorySwitchPayload =
        parse_payload(payload, "local_app_agent_memory_switch")?;
    host.agent_memory_switch(LocalAppAgentMemorySwitchRequest {
        agent_handle: payload.agent_handle,
        enabled: payload.enabled,
    })
    .await
    .map_err(map_local_app_error)
}

pub async fn agent_memory_delete_for_host(
    host: &RuntimeBridgeLocalAppHost,
    payload: Value,
) -> Result<Value, String> {
    let payload: LocalAppAgentMemoryDeletePayload =
        parse_payload(payload, "local_app_agent_memory_delete")?;
    if !payload.confirmed {
        return Err(invalid_payload("local_app_agent_memory_delete"));
    }
    host.agent_memory_delete(LocalAppAgentMemoryDeleteRequest {
        agent_handle: payload.agent_handle,
        confirmed: payload.confirmed,
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
        "runtime-service-unavailable"
        | "local-app-owner-unavailable"
        | "ai-config-persistence-unavailable" => "runtime-service-unavailable",
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
    fn artifact_upload_preserves_audio_and_video_inputs() {
        for mime_type in ["audio/wav", "audio/mpeg", "video/mp4"] {
            let request = artifact_upload_request(json!({"bytes":[1,2],"mimeType":mime_type}))
                .expect("supported artifact MIME reaches the host request");
            assert_eq!(request.mime_type, mime_type);
            assert_eq!(request.bytes, vec![1, 2]);
        }
        for payload in [
            json!({"bytes":[1],"mimeType":"audio/ogg"}),
            json!({"bytes":[],"mimeType":"audio/wav"}),
            json!({"bytes":[1],"mimeType":"audio/wav","accountId":"other"}),
        ] {
            assert!(artifact_upload_request(payload)
                .unwrap_err()
                .contains("invalid-payload"));
        }
    }

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
                "temperature": 0, "topP": 0, "maxTokens": 0
            }),
            "text_candidate",
        )
        .expect("explicit zero sampling");
        assert_eq!(payload.temperature, Some(0.0));
        assert_eq!(payload.max_tokens, Some(0));
        assert!(parse_payload::<LocalAppTextCandidatePayload>(
            json!({
                "messages": [{"role": "user", "text": "Create one persona."}],
                "topK": 0
            }),
            "text_candidate"
        )
        .is_err());
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
        let presentation = parse_payload::<LocalAppAgentCommitPresentationPayload>(
            json!({
                "agentHandle": "agent_ref_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
                "expectedPresentationRevision": "0",
                "intent": {},
                "importedAssets": [{
                    "role": "avatar",
                    "fileName": "avatar.vrm",
                    "mediaType": "model/gltf-binary",
                    "content": [1, 2, 255],
                    "sha256": "abc123"
                }]
            }),
            "presentation_commit",
        )
        .expect("typed presentation asset payload");
        assert_eq!(presentation.imported_assets.len(), 1);
        assert_eq!(presentation.imported_assets[0].content, vec![1, 2, 255]);

        let default_page = memory_inspect_request(
            parse_payload::<LocalAppAgentMemoryInspectPayload>(
                json!({"agentHandle": "agent_ref_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"}),
                "memory_inspect",
            )
            .expect("default Memory page"),
        )
        .expect("bounded default Memory page");
        assert_eq!(default_page.limit, 100);
        assert!(default_page.page_token.is_empty());
        let explicit_page = memory_inspect_request(
            parse_payload::<LocalAppAgentMemoryInspectPayload>(
                json!({
                    "agentHandle": "agent_ref_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
                    "limit": 2,
                    "pageToken": "opaque-page-2"
                }),
                "memory_inspect",
            )
            .expect("explicit Memory page"),
        )
        .expect("bounded explicit Memory page");
        assert_eq!(explicit_page.limit, 2);
        assert_eq!(explicit_page.page_token, "opaque-page-2");
        for invalid in [
            json!({"agentHandle": "agent_ref_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", "limit": 0}),
            json!({"agentHandle": "agent_ref_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", "limit": 101}),
            json!({"agentHandle": "agent_ref_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", "pageToken": " bad "}),
            json!({"agentHandle": "agent_ref_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", "ownerUserId": "forbidden"}),
        ] {
            let parsed =
                parse_payload::<LocalAppAgentMemoryInspectPayload>(invalid, "memory_inspect");
            assert!(parsed.and_then(memory_inspect_request).is_err());
        }
    }

    #[test]
    fn shared_voice_options_require_empty_transport_sentinels() {
        for kind in ["preset-voices", "voice-assets"] {
            let valid = parse_payload::<LocalAppAIConfigLocalOptionsPayload>(
                json!({"kind": kind, "capabilityContract": "", "search": ""}),
                "shared_voice_options",
            )
            .expect("shared voice payload");
            assert!(validate_shared_agent_ai_config_options_payload(&valid).is_ok());
        }
        for invalid in [
            json!({"kind": "preset-voices", "capabilityContract": "audio.synthesize", "search": ""}),
            json!({"kind": "preset-voices", "capabilityContract": "", "connectorRef": "connector", "search": ""}),
            json!({"kind": "preset-voices", "capabilityContract": "", "search": "serena"}),
            json!({"kind": "voice-assets", "capabilityContract": "audio.synthesize", "search": ""}),
            json!({"kind": "voice-assets", "capabilityContract": "", "search": "voice"}),
        ] {
            let payload = parse_payload::<LocalAppAIConfigLocalOptionsPayload>(
                invalid,
                "shared_voice_options",
            )
            .expect("structurally valid shared voice payload");
            assert!(validate_shared_agent_ai_config_options_payload(&payload).is_err());
        }
    }

    #[test]
    fn app_preset_voice_options_require_empty_transport_sentinels() {
        let valid = parse_payload::<LocalAppAIConfigLocalOptionsPayload>(
            json!({"kind": "preset-voices", "capabilityContract": "", "search": ""}),
            "app_preset_voice_options",
        )
        .expect("App preset voice payload");
        assert!(validate_app_ai_config_options_payload(&valid).is_ok());
        for invalid in [
            json!({"kind": "preset-voices", "capabilityContract": "audio.synthesize", "search": ""}),
            json!({"kind": "preset-voices", "capabilityContract": "", "connectorRef": "connector", "search": ""}),
            json!({"kind": "preset-voices", "capabilityContract": "", "search": "serena"}),
        ] {
            let payload = parse_payload::<LocalAppAIConfigLocalOptionsPayload>(
                invalid,
                "app_preset_voice_options",
            )
            .expect("structurally valid App preset voice payload");
            assert!(validate_app_ai_config_options_payload(&payload).is_err());
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
    fn unavailable_manager_owner_uses_the_standard_runtime_unavailable_code() {
        let envelope: Value = serde_json::from_str(&map_local_app_error(
            LocalAppOperationError::new(LocalAppReasonCode::OwnerUnavailable, true),
        ))
        .expect("standard Manager error JSON");
        assert_eq!(envelope["code"], "runtime-service-unavailable");
        assert_eq!(envelope["reasonCode"], "local-app-owner-unavailable");
        assert_eq!(envelope["details"]["retryable"], true);
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

    fn activity_put_payload() -> Value {
        json!({
            "key": "review:42",
            "revision": 3,
            "kind": "todo",
            "todoState": "open",
            "attention": true,
            "title": "Review chapter 4",
            "summary": null,
            "objectRef": "doc:42",
            "type": "com.example.editor.review-requested.v1",
            "dataJson": "{\"b\":1,\"a\":2}",
            "occurredAt": "2026-09-20T09:00:00.125Z",
            "agentHandle": null,
        })
    }

    fn assert_invalid_payload(result: Result<impl std::fmt::Debug, String>, command: &str) {
        let raw = result.expect_err("malformed renderer payload");
        let envelope: Value = serde_json::from_str(&raw).expect("standard envelope");
        assert_eq!(envelope["code"], "invalid-payload");
        assert_eq!(envelope["source"], "tauri");
        assert_eq!(envelope["details"]["command"], command);
    }

    #[test]
    fn activity_put_payload_maps_exact_renderer_fields() {
        let payload: LocalAppActivityPutPayload =
            parse_payload(activity_put_payload(), ACTIVITY_PUT_COMMAND).expect("put payload");
        let request = activity_put_request(payload).expect("put request");
        assert_eq!(request.revision, 3);
        assert_eq!(request.kind, "todo");
        assert_eq!(request.todo_state.as_deref(), Some("open"));
        assert_eq!(request.summary, None);
        assert_eq!(request.activity_type, "com.example.editor.review-requested.v1");
        // Publisher data stays opaque text.
        assert_eq!(request.data_json.as_deref(), Some("{\"b\":1,\"a\":2}"));
        assert_eq!(request.occurred_at_seconds, 1_789_894_800);
        assert_eq!(request.occurred_at_nanos, 125_000_000);
        assert_eq!(request.agent_handle, None);
    }

    #[test]
    fn activity_put_payload_rejects_authority_fields_and_unknown_vocabulary() {
        let mut extra = activity_put_payload();
        extra["sourceRef"] = json!("src_forged");
        assert_invalid_payload(
            parse_payload::<LocalAppActivityPutPayload>(extra, ACTIVITY_PUT_COMMAND),
            ACTIVITY_PUT_COMMAND,
        );
        for (field, value) in [
            ("revision", json!(0)),
            ("revision", json!(9_007_199_254_740_992_u64)),
            ("revision", json!(1.5)),
            ("kind", json!("task")),
            ("todoState", json!("done")),
            ("occurredAt", json!("2026-09-20T09:00:00+08:00")),
            ("occurredAt", json!("2026-09-20 09:00:00Z")),
            ("occurredAt", json!("2026-09-20T09:00:00.1234567890Z")),
            ("occurredAt", json!("2026-13-20T09:00:00Z")),
            ("occurredAt", json!("2026-09-20T09:00:60Z")),
        ] {
            let mut payload = activity_put_payload();
            payload[field] = value;
            let result = parse_payload::<LocalAppActivityPutPayload>(payload, ACTIVITY_PUT_COMMAND)
                .and_then(activity_put_request);
            assert_invalid_payload(result, ACTIVITY_PUT_COMMAND);
        }
    }

    #[test]
    fn activity_instant_accepts_only_utc_iso_strings() {
        let exact = activity_instant("2026-09-20T09:00:00.000Z", ACTIVITY_PUT_COMMAND)
            .expect("renderer ISO instant");
        assert_eq!(
            exact,
            LocalAppActivityTimestamp {
                seconds: 1_789_894_800,
                nanos: 0
            }
        );
        let whole = activity_instant("1999-12-31T23:59:59Z", ACTIVITY_PUT_COMMAND)
            .expect("fractionless instant");
        assert_eq!(whole.seconds, 946_684_799);
        let fine = activity_instant("2026-09-20T09:00:00.000000001Z", ACTIVITY_PUT_COMMAND)
            .expect("nanosecond instant");
        assert_eq!(fine.nanos, 1);
        for value in ["", "2026-09-20", "2026-09-20T09:00:00.Z", "2026-09-20t09:00:00Z", "+2026-09-20T09:00:00Z"] {
            assert!(activity_instant(value, ACTIVITY_PUT_COMMAND).is_err(), "{value}");
        }
    }

    #[test]
    fn activity_list_payload_is_exact_and_converts_bounds() {
        let payload: LocalAppActivityListPayload = parse_payload(
            json!({
                "filter": {
                    "sourceRef": null,
                    "kind": "todo",
                    "todoStates": ["open", "cancelled"],
                    "agentRef": "agr_writer",
                    "occurredAfter": "2026-09-20T09:00:00.000Z",
                    "occurredBefore": null,
                },
                "pageSize": 50,
                "pageToken": null,
            }),
            ACTIVITY_LIST_COMMAND,
        )
        .expect("list payload");
        let request = activity_list_request(payload).expect("list request");
        assert_eq!(request.kind.as_deref(), Some("todo"));
        assert_eq!(request.todo_states, vec!["open", "cancelled"]);
        assert_eq!(request.agent_ref.as_deref(), Some("agr_writer"));
        assert_eq!(
            request.occurred_after,
            Some(LocalAppActivityTimestamp {
                seconds: 1_789_894_800,
                nanos: 0
            })
        );
        assert_eq!(request.occurred_before, None);
        assert_eq!(request.page_size, 50);

        assert_invalid_payload(
            parse_payload::<LocalAppActivityListPayload>(
                json!({ "filter": { "todoStates": ["done"] }, "pageSize": 1 }),
                ACTIVITY_LIST_COMMAND,
            )
            .and_then(activity_list_request),
            ACTIVITY_LIST_COMMAND,
        );
        assert_invalid_payload(
            parse_payload::<LocalAppActivityListPayload>(
                json!({ "filter": { "todoStates": [], "accountId": "forged" }, "pageSize": 1 }),
                ACTIVITY_LIST_COMMAND,
            ),
            ACTIVITY_LIST_COMMAND,
        );
    }

    #[test]
    fn activity_pull_payloads_separate_open_and_control_shapes() {
        assert!(matches!(
            parse_payload::<LocalAppActivitySubscribePayload>(
                json!({ "afterChangeSeq": "0" }),
                ACTIVITY_SUBSCRIBE_COMMAND,
            ),
            Ok(LocalAppActivitySubscribePayload::Open(_))
        ));
        assert!(matches!(
            parse_payload::<LocalAppActivitySubscribePayload>(
                json!({ "action": "next", "subscriptionId": "activity-1" }),
                ACTIVITY_SUBSCRIBE_COMMAND,
            ),
            Ok(LocalAppActivitySubscribePayload::Control(_))
        ));
        assert!(parse_payload::<LocalAppActivitySubscribePayload>(
            json!({ "afterChangeSeq": "0", "action": "next", "subscriptionId": "activity-1" }),
            ACTIVITY_SUBSCRIBE_COMMAND,
        )
        .is_err());
        assert!(matches!(
            parse_payload::<LocalAppActivityOpenRequestsSubscribePayload>(
                json!({}),
                ACTIVITY_OPEN_REQUESTS_SUBSCRIBE_COMMAND,
            ),
            Ok(LocalAppActivityOpenRequestsSubscribePayload::Open(_))
        ));
        assert!(matches!(
            parse_payload::<LocalAppActivityOpenRequestsSubscribePayload>(
                json!({ "action": "cancel", "subscriptionId": "activity-open-requests-1" }),
                ACTIVITY_OPEN_REQUESTS_SUBSCRIBE_COMMAND,
            ),
            Ok(LocalAppActivityOpenRequestsSubscribePayload::Control(_))
        ));
        assert!(parse_payload::<LocalAppActivityOpenRequestsSubscribePayload>(
            json!({ "afterChangeSeq": "0" }),
            ACTIVITY_OPEN_REQUESTS_SUBSCRIBE_COMMAND,
        )
        .is_err());
        assert_eq!(
            activity_pull_result(
                "activity-1".to_string(),
                false,
                Some(json!({ "kind": "remove" })),
                ACTIVITY_SUBSCRIBE_COMMAND,
            )
            .expect("event"),
            json!({ "subscriptionId": "activity-1", "completed": false, "event": { "kind": "remove" } })
        );
        assert_eq!(
            activity_pull_result("activity-1".to_string(), true, None, ACTIVITY_SUBSCRIBE_COMMAND)
                .expect("completion"),
            json!({ "subscriptionId": "activity-1", "completed": true })
        );
    }

    const OPEN_REQUEST_ID: &str = "aor_Q2l0eUxpZ2h0c0FyZUJyaWdodFRvbmln";

    #[tokio::test]
    async fn activity_open_waits_for_the_runtime_result_after_a_requested_launch() {
        let (sender, receiver) = tokio::sync::mpsc::channel(4);
        sender
            .send(Ok(json!({ "openRequestId": OPEN_REQUEST_ID })))
            .await
            .expect("pending event");
        let result_sender = sender.clone();
        let launched = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
        let observed = launched.clone();
        let result = drive_activity_open(receiver, move |open_request_id| async move {
            observed.lock().expect("launch log").push(open_request_id);
            // Runtime confirms only after the source App completes the request.
            result_sender
                .send(Ok(json!({ "result": { "outcome": "opened", "reason": "opened" } })))
                .await
                .expect("result event");
            AppActivitySourceLaunch::Requested
        })
        .await
        .expect("typed result");
        assert_eq!(result, json!({ "outcome": "opened", "reason": "opened" }));
        assert!(!result.to_string().contains(OPEN_REQUEST_ID));
        assert_eq!(*launched.lock().expect("launch log"), vec![OPEN_REQUEST_ID]);
    }

    #[tokio::test]
    async fn activity_open_never_reports_opened_from_launch_alone() {
        let (sender, receiver) = tokio::sync::mpsc::channel(4);
        sender
            .send(Ok(json!({ "openRequestId": OPEN_REQUEST_ID })))
            .await
            .expect("pending event");
        drop(sender);
        let error = drive_activity_open(receiver, |_| async { AppActivitySourceLaunch::Requested })
            .await
            .expect_err("a stream without a Runtime result fails closed");
        assert_eq!(error.reason_code(), LocalAppReasonCode::RuntimeServiceUntrusted);
    }

    #[tokio::test]
    async fn activity_open_refused_launch_returns_typed_result_and_cancels_the_stream() {
        for (declined, expected) in [
            (
                AppActivitySourceLaunch::Declined {
                    outcome: "unavailable",
                    reason: "host-unavailable",
                },
                json!({ "outcome": "unavailable", "reason": "host-unavailable" }),
            ),
            (
                AppActivitySourceLaunch::Declined {
                    outcome: "failed",
                    reason: "launch-failed",
                },
                json!({ "outcome": "failed", "reason": "launch-failed" }),
            ),
        ] {
            let (sender, receiver) = tokio::sync::mpsc::channel(4);
            sender
                .send(Ok(json!({ "openRequestId": OPEN_REQUEST_ID })))
                .await
                .expect("pending event");
            let result = drive_activity_open_with_grace(
                receiver,
                move |_| async move { declined },
                Duration::from_millis(20),
            )
            .await
            .expect("typed refusal");
            assert_eq!(result, expected);
            // The dropped receiver is the carrier's cancellation signal.
            assert!(sender.is_closed());
        }
    }

    #[tokio::test]
    async fn activity_open_reports_a_running_source_confirmation_after_a_refused_launch() {
        let (sender, receiver) = tokio::sync::mpsc::channel(4);
        sender
            .send(Ok(json!({ "openRequestId": OPEN_REQUEST_ID })))
            .await
            .expect("pending event");
        let confirming = sender.clone();
        let result = drive_activity_open_with_grace(
            receiver,
            move |_| async move {
                confirming
                    .send(Ok(json!({ "result": { "outcome": "opened", "reason": "opened" } })))
                    .await
                    .expect("runtime result");
                AppActivitySourceLaunch::Declined {
                    outcome: "failed",
                    reason: "launch-failed",
                }
            },
            Duration::from_secs(5),
        )
        .await
        .expect("source confirmation");
        assert_eq!(result, json!({ "outcome": "opened", "reason": "opened" }));
    }

    #[tokio::test]
    async fn activity_open_returns_an_immediate_runtime_result_without_launch() {
        let (sender, receiver) = tokio::sync::mpsc::channel(4);
        sender
            .send(Ok(json!({ "result": { "outcome": "unavailable", "reason": "not-openable" } })))
            .await
            .expect("result event");
        let result = drive_activity_open(receiver, |_| async {
            panic!("an unopenable record never reaches Desktop");
        })
        .await
        .expect("typed result");
        assert_eq!(result, json!({ "outcome": "unavailable", "reason": "not-openable" }));
    }

    #[tokio::test]
    async fn activity_open_rejects_a_second_open_request_and_runtime_failures() {
        let (sender, receiver) = tokio::sync::mpsc::channel(4);
        for _ in 0..2 {
            sender
                .send(Ok(json!({ "openRequestId": OPEN_REQUEST_ID })))
                .await
                .expect("pending event");
        }
        let error = drive_activity_open(receiver, |_| async { AppActivitySourceLaunch::Requested })
            .await
            .expect_err("second open request");
        assert_eq!(error.reason_code(), LocalAppReasonCode::RuntimeServiceUntrusted);

        let (sender, receiver) = tokio::sync::mpsc::channel(4);
        sender
            .send(Err(LocalAppOperationError::new(LocalAppReasonCode::NotFound, false)))
            .await
            .expect("typed failure");
        let error = drive_activity_open(receiver, |_| async { AppActivitySourceLaunch::Requested })
            .await
            .expect_err("typed Runtime failure");
        assert_eq!(error.reason_code(), LocalAppReasonCode::NotFound);
    }

    #[test]
    fn activity_mark_read_and_completion_payloads_are_exact() {
        let payload: LocalAppActivityMarkReadPayload = parse_payload(
            json!({ "activityId": "act_01J8ZQ6J3F5T7W9X1Y2Z3A4B5C", "displayedRevision": 3 }),
            ACTIVITY_MARK_READ_COMMAND,
        )
        .expect("mark-read payload");
        assert_eq!(payload.displayed_revision, 3);
        assert_invalid_payload(
            activity_revision(0, ACTIVITY_MARK_READ_COMMAND),
            ACTIVITY_MARK_READ_COMMAND,
        );
        assert_invalid_payload(
            parse_payload::<LocalAppActivityOpenPayload>(
                json!({ "activityId": "act_x", "openRequestId": OPEN_REQUEST_ID }),
                ACTIVITY_OPEN_COMMAND,
            ),
            ACTIVITY_OPEN_COMMAND,
        );
        assert!(parse_payload::<LocalAppActivityOpenRequestCompletePayload>(
            json!({ "deliveryId": "aod_x", "completion": "opened" }),
            ACTIVITY_OPEN_REQUEST_COMPLETE_COMMAND,
        )
        .is_ok());
    }
}

pub async fn world_core_get_for_host(
    host: &RuntimeBridgeLocalAppHost,
    payload: Value,
) -> Result<Value, String> {
    let payload: LocalAppWorldCoreGetPayload =
        parse_payload(payload, "local_app_realm_world_core_get")?;
    if invalid_identifier(&payload.world_id) {
        return Err(invalid_payload("local_app_realm_world_core_get"));
    }
    host.world_core_get(LocalAppWorldCoreGetRequest {
        world_id: payload.world_id,
    })
    .await
    .map_err(map_local_app_error)
}

pub async fn world_core_replace_for_host(
    host: &RuntimeBridgeLocalAppHost,
    payload: Value,
) -> Result<Value, String> {
    let payload: LocalAppWorldCoreReplacePayload =
        parse_payload(payload, "local_app_realm_world_core_replace")?;
    if invalid_identifier(&payload.world_id) || !payload.body.is_object() {
        return Err(invalid_payload("local_app_realm_world_core_replace"));
    }
    host.world_core_replace(LocalAppWorldCoreReplaceRequest {
        world_id: payload.world_id,
        body: payload.body,
    })
    .await
    .map_err(map_local_app_error)
}

pub async fn world_character_list_for_host(
    host: &RuntimeBridgeLocalAppHost,
    payload: Value,
) -> Result<Value, String> {
    let payload: LocalAppWorldCharacterListPayload =
        parse_payload(payload, "local_app_realm_world_character_list")?;
    if invalid_identifier(&payload.world_id)
        || payload.take.is_some_and(|take| take == 0 || take > 500)
    {
        return Err(invalid_payload("local_app_realm_world_character_list"));
    }
    host.world_character_list(LocalAppWorldCharacterListRequest {
        world_id: payload.world_id,
        visibility: payload.visibility,
        after_id: payload.after_id,
        take: payload.take,
    })
    .await
    .map_err(map_local_app_error)
}

pub async fn world_character_get_for_host(
    host: &RuntimeBridgeLocalAppHost,
    payload: Value,
) -> Result<Value, String> {
    let payload: LocalAppWorldCharacterGetPayload =
        parse_payload(payload, "local_app_realm_world_character_get")?;
    if invalid_identifier(&payload.character_id) {
        return Err(invalid_payload("local_app_realm_world_character_get"));
    }
    host.world_character_get(LocalAppWorldCharacterGetRequest {
        character_id: payload.character_id,
    })
    .await
    .map_err(map_local_app_error)
}

pub async fn world_character_create_for_host(
    host: &RuntimeBridgeLocalAppHost,
    payload: Value,
) -> Result<Value, String> {
    let payload: LocalAppWorldCharacterCreatePayload =
        parse_payload(payload, "local_app_realm_world_character_create")?;
    if invalid_identifier(&payload.world_id) || !payload.body.is_object() {
        return Err(invalid_payload("local_app_realm_world_character_create"));
    }
    host.world_character_create(LocalAppWorldCharacterCreateRequest {
        world_id: payload.world_id,
        body: payload.body,
    })
    .await
    .map_err(map_local_app_error)
}

pub async fn world_character_replace_for_host(
    host: &RuntimeBridgeLocalAppHost,
    payload: Value,
) -> Result<Value, String> {
    let payload: LocalAppWorldCharacterReplacePayload =
        parse_payload(payload, "local_app_realm_world_character_replace")?;
    if invalid_identifier(&payload.character_id) || !payload.body.is_object() {
        return Err(invalid_payload("local_app_realm_world_character_replace"));
    }
    host.world_character_replace(LocalAppWorldCharacterReplaceRequest {
        character_id: payload.character_id,
        body: payload.body,
    })
    .await
    .map_err(map_local_app_error)
}

pub async fn world_entity_list_for_host(
    host: &RuntimeBridgeLocalAppHost,
    payload: Value,
) -> Result<Value, String> {
    let payload: LocalAppWorldEntityListPayload =
        parse_payload(payload, "local_app_realm_world_entity_list")?;
    if invalid_identifier(&payload.world_id)
        || payload.take.is_some_and(|take| take == 0 || take > 500)
    {
        return Err(invalid_payload("local_app_realm_world_entity_list"));
    }
    host.world_entity_list(LocalAppWorldEntityListRequest {
        world_id: payload.world_id,
        kind: payload.kind,
        after_id: payload.after_id,
        take: payload.take,
    })
    .await
    .map_err(map_local_app_error)
}

pub async fn world_entity_get_for_host(
    host: &RuntimeBridgeLocalAppHost,
    payload: Value,
) -> Result<Value, String> {
    let payload: LocalAppWorldEntityGetPayload =
        parse_payload(payload, "local_app_realm_world_entity_get")?;
    if invalid_identifier(&payload.entity_id) {
        return Err(invalid_payload("local_app_realm_world_entity_get"));
    }
    host.world_entity_get(LocalAppWorldEntityGetRequest {
        entity_id: payload.entity_id,
    })
    .await
    .map_err(map_local_app_error)
}

pub async fn world_entity_create_for_host(
    host: &RuntimeBridgeLocalAppHost,
    payload: Value,
) -> Result<Value, String> {
    let payload: LocalAppWorldEntityCreatePayload =
        parse_payload(payload, "local_app_realm_world_entity_create")?;
    if invalid_identifier(&payload.world_id) || !payload.body.is_object() {
        return Err(invalid_payload("local_app_realm_world_entity_create"));
    }
    host.world_entity_create(LocalAppWorldEntityCreateRequest {
        world_id: payload.world_id,
        body: payload.body,
    })
    .await
    .map_err(map_local_app_error)
}

pub async fn world_relationship_list_for_host(
    host: &RuntimeBridgeLocalAppHost,
    payload: Value,
) -> Result<Value, String> {
    let payload: LocalAppWorldRelationshipListPayload =
        parse_payload(payload, "local_app_realm_world_relationship_list")?;
    if invalid_identifier(&payload.world_id)
        || payload.take.is_some_and(|take| take == 0 || take > 500)
    {
        return Err(invalid_payload("local_app_realm_world_relationship_list"));
    }
    host.world_relationship_list(LocalAppWorldRelationshipListRequest {
        world_id: payload.world_id,
        entity_id: payload.entity_id,
        source_entity_id: payload.source_entity_id,
        target_entity_id: payload.target_entity_id,
        r#type: payload.r#type,
        after_id: payload.after_id,
        take: payload.take,
    })
    .await
    .map_err(map_local_app_error)
}

pub async fn world_relationship_get_for_host(
    host: &RuntimeBridgeLocalAppHost,
    payload: Value,
) -> Result<Value, String> {
    let payload: LocalAppWorldRelationshipGetPayload =
        parse_payload(payload, "local_app_realm_world_relationship_get")?;
    if invalid_identifier(&payload.relationship_id) {
        return Err(invalid_payload("local_app_realm_world_relationship_get"));
    }
    host.world_relationship_get(LocalAppWorldRelationshipGetRequest {
        relationship_id: payload.relationship_id,
    })
    .await
    .map_err(map_local_app_error)
}

pub async fn world_creation_eligibility_get_for_host(
    host: &RuntimeBridgeLocalAppHost,
    payload: Value,
) -> Result<Value, String> {
    if !payload.as_object().is_some_and(|value| value.is_empty()) {
        return Err(invalid_payload(
            "local_app_realm_world_creation_eligibility_get",
        ));
    }
    host.world_creation_eligibility_get()
        .await
        .map_err(map_local_app_error)
}
