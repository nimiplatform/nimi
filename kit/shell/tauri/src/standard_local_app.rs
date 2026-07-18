use nimi_shell_protected_local::{
    LocalAppOperationError, LocalAppPermissionRequest, LocalAppPermissionStatusRequest,
    LocalAppStorageReadRequest, LocalAppStorageRemoveRequest, LocalAppStorageWriteRequest,
};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::runtime_bridge::RuntimeBridgeLocalAppHost;

const MAX_IDENTIFIER_LENGTH: usize = 512;
const MAX_PERMISSION_REASON_BYTES: usize = 240;

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
}
