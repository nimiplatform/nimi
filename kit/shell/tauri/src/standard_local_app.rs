use nimi_shell_protected_local::{
    LocalAppAIConfigOverwriteRequest, LocalAppOperationError, LocalAppPermissionRequest,
    LocalAppPermissionStatusRequest, LocalAppSharedAgentAIConfigOverwriteRequest,
    LocalAppSharedAgentAIProfileRequest, LocalAppStorageReadRequest, LocalAppStorageRemoveRequest,
    LocalAppStorageWriteRequest, LocalAppTextCandidateMessage, LocalAppTextCandidateRequest,
};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::runtime_bridge::RuntimeBridgeLocalAppHost;

const MAX_IDENTIFIER_LENGTH: usize = 512;
const MAX_PERMISSION_REASON_BYTES: usize = 240;
const MAX_TEXT_CANDIDATE_MESSAGES: usize = 8;
const MAX_TEXT_CANDIDATE_MESSAGE_BYTES: usize = 32 * 1024;
const MAX_TEXT_CANDIDATE_PROMPT_BYTES: usize = 64 * 1024;
const MAX_TEXT_CANDIDATE_TOKENS: i32 = 4096;
const MAX_AI_PROFILE_JSON_BYTES: usize = 4 * 1024 * 1024;
const MAX_JSON_DEPTH: usize = 32;
const MAX_JSON_NODES: usize = 100_000;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LocalAppPermissionStatusPayload {
    permission_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LocalAppPermissionRequestPayload {
    permission_id: String,
    reason: String,
    request_id: String,
}

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
    temperature: f32,
    top_p: f32,
    max_tokens: i32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LocalAppAIConfigOverwritePayload {
    capabilities: Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LocalAppSharedAgentAIProfilePayload {
    profile_json: String,
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

pub async fn session_status_for_host(host: &RuntimeBridgeLocalAppHost) -> Result<Value, String> {
    let status = host.session_status().await.map_err(map_local_app_error)?;
    Ok(json!({
        "state": status.state.as_str(),
        "reasonCode": status.reason_code.as_str(),
        "retryable": status.retryable,
    }))
}

pub async fn permission_status_for_host(
    host: &RuntimeBridgeLocalAppHost,
    payload: Value,
) -> Result<Value, String> {
    let payload: LocalAppPermissionStatusPayload =
        parse_payload(payload, "local_app_permission_status")?;
    let permission_id = required_text(
        payload.permission_id,
        MAX_IDENTIFIER_LENGTH,
        "local_app_permission_status",
    )?;
    let posture = host
        .permission_status(LocalAppPermissionStatusRequest { permission_id })
        .await
        .map_err(map_local_app_error)?;
    Ok(json!({
        "state": posture.state.as_str(),
        "permissionId": posture.permission_id,
        "canRequest": posture.can_request,
        "reasonCode": posture.reason_code.as_str(),
        "agents": posture.agents.into_iter().map(|agent| json!({
            "agentHandle": agent.agent_handle,
            "displayName": agent.display_name,
        })).collect::<Vec<_>>(),
    }))
}

pub async fn permission_request_for_host(
    host: &RuntimeBridgeLocalAppHost,
    payload: Value,
) -> Result<Value, String> {
    let payload: LocalAppPermissionRequestPayload =
        parse_payload(payload, "local_app_permission_request")?;
    let request = LocalAppPermissionRequest {
        permission_id: required_text(
            payload.permission_id,
            MAX_IDENTIFIER_LENGTH,
            "local_app_permission_request",
        )?,
        reason: required_text(
            payload.reason,
            MAX_PERMISSION_REASON_BYTES,
            "local_app_permission_request",
        )?,
        request_id: required_text(
            payload.request_id,
            MAX_IDENTIFIER_LENGTH,
            "local_app_permission_request",
        )?,
    };
    let posture = host
        .permission_request(request)
        .await
        .map_err(map_local_app_error)?;
    Ok(json!({
        "state": posture.state.as_str(),
        "permissionId": posture.permission_id,
        "canRequest": posture.can_request,
        "reasonCode": posture.reason_code.as_str(),
        "agents": posture.agents.into_iter().map(|agent| json!({
            "agentHandle": agent.agent_handle,
            "displayName": agent.display_name,
        })).collect::<Vec<_>>(),
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
        || !payload.temperature.is_finite()
        || !(0.0..=2.0).contains(&payload.temperature)
        || !payload.top_p.is_finite()
        || !(0.0..=1.0).contains(&payload.top_p)
        || !(1..=MAX_TEXT_CANDIDATE_TOKENS).contains(&payload.max_tokens)
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

pub async fn ai_config_get_for_host(host: &RuntimeBridgeLocalAppHost) -> Result<Value, String> {
    host.app_ai_config_get().await.map_err(map_local_app_error)
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
    assert_no_ai_config_owner(
        &payload.capabilities,
        "local_app_shared_agent_ai_config_overwrite",
    )?;
    validate_json_bounds(
        &payload.capabilities,
        "local_app_shared_agent_ai_config_overwrite",
    )?;
    host.shared_agent_ai_config_overwrite(LocalAppSharedAgentAIConfigOverwriteRequest {
        capabilities: payload.capabilities,
    })
    .await
    .map_err(map_local_app_error)
}

pub async fn shared_agent_ai_profile_preview_for_host(
    host: &RuntimeBridgeLocalAppHost,
    payload: Value,
) -> Result<Value, String> {
    let payload: LocalAppSharedAgentAIProfilePayload =
        parse_payload(payload, "local_app_shared_agent_ai_profile_preview")?;
    validate_profile_json(
        &payload.profile_json,
        "local_app_shared_agent_ai_profile_preview",
    )?;
    host.shared_agent_ai_profile_preview(LocalAppSharedAgentAIProfileRequest {
        profile_json: payload.profile_json,
    })
    .await
    .map_err(map_local_app_error)
}

pub async fn shared_agent_ai_profile_apply_for_host(
    host: &RuntimeBridgeLocalAppHost,
    payload: Value,
) -> Result<Value, String> {
    let payload: LocalAppSharedAgentAIProfilePayload =
        parse_payload(payload, "local_app_shared_agent_ai_profile_apply")?;
    validate_profile_json(
        &payload.profile_json,
        "local_app_shared_agent_ai_profile_apply",
    )?;
    host.shared_agent_ai_profile_apply(LocalAppSharedAgentAIProfileRequest {
        profile_json: payload.profile_json,
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

fn validate_profile_json(value: &str, command: &str) -> Result<(), String> {
    if value.trim().is_empty() || value.len() > MAX_AI_PROFILE_JSON_BYTES {
        return Err(invalid_payload(command));
    }
    let parsed: Value = serde_json::from_str(value).map_err(|_| invalid_payload(command))?;
    validate_json_bounds(&parsed, command)
}

fn validate_json_bounds(value: &Value, command: &str) -> Result<(), String> {
    if serde_json::to_vec(value)
        .map_err(|_| invalid_payload(command))?
        .len()
        > MAX_AI_PROFILE_JSON_BYTES
    {
        return Err(invalid_payload(command));
    }
    let mut nodes = 0usize;
    validate_json_structure(value, 0, &mut nodes, command)
}

fn validate_json_structure(
    value: &Value,
    depth: usize,
    nodes: &mut usize,
    command: &str,
) -> Result<(), String> {
    *nodes = nodes.saturating_add(1);
    if depth > MAX_JSON_DEPTH || *nodes > MAX_JSON_NODES {
        return Err(invalid_payload(command));
    }
    match value {
        Value::Array(values) => {
            for value in values {
                validate_json_structure(value, depth + 1, nodes, command)?;
            }
        }
        Value::Object(values) => {
            for value in values.values() {
                validate_json_structure(value, depth + 1, nodes, command)?;
            }
        }
        _ => {}
    }
    Ok(())
}

fn assert_no_ai_config_owner(value: &Value, command: &str) -> Result<(), String> {
    match value {
        Value::Array(values) => {
            for value in values {
                assert_no_ai_config_owner(value, command)?;
            }
        }
        Value::Object(values) => {
            for (key, value) in values {
                let normalized = key
                    .chars()
                    .filter(|character| character.is_ascii_alphanumeric())
                    .flat_map(char::to_lowercase)
                    .collect::<String>();
                if normalized == "owner" || normalized == "appid" {
                    return Err(invalid_payload(command));
                }
                assert_no_ai_config_owner(value, command)?;
            }
        }
        _ => {}
    }
    Ok(())
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
        "permission-unavailable" => "continue_without_optional_permission",
        _ => "refresh_local_app_runtime_projection",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn payloads_reject_extra_authority_fields() {
        for payload in [
            json!({"relativePath": "state.json", "sessionProof": "forged"}),
            json!({"permissionId": "agents.interact", "token": "forged"}),
        ] {
            let error = if payload.get("relativePath").is_some() {
                parse_payload::<LocalAppStorageReadPayload>(payload, "storage").unwrap_err()
            } else {
                parse_payload::<LocalAppPermissionStatusPayload>(payload, "permission").unwrap_err()
            };
            assert!(error.contains("invalid-payload"));
        }
    }

    #[test]
    fn permission_reason_uses_utf8_byte_limit_without_whitespace_aliases() {
        assert!(required_text("需".repeat(80), MAX_PERMISSION_REASON_BYTES, "permission").is_ok());
        assert!(required_text("需".repeat(81), MAX_PERMISSION_REASON_BYTES, "permission").is_err());
        assert!(required_text(
            " needs permission".to_string(),
            MAX_PERMISSION_REASON_BYTES,
            "permission"
        )
        .is_err());
    }

    #[test]
    fn text_candidate_payload_rejects_authority_and_role_expansion() {
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
    }

    #[test]
    fn shared_agent_inputs_reject_owner_injection_and_malformed_profile_json() {
        assert!(assert_no_ai_config_owner(
            &json!([{"owner": {"appId": "forged"}}]),
            "shared_config"
        )
        .is_err());
        assert!(validate_profile_json("{", "shared_profile").is_err());
        assert!(validate_profile_json("{\"portable\":true}", "shared_profile").is_ok());
    }
}
