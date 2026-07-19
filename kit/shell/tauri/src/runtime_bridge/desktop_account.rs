use nimi_shell_protected_local::{
    DesktopAccountActionRequest, DesktopAccountBeginLoginRequest,
    DesktopAccountCompleteLoginRequest, DesktopAccountProjection, DesktopAccountRealmUnaryRequest,
};
use serde::{Deserialize, Serialize};

use super::{error_map::bridge_error, service_control};

const MAX_ACCOUNT_CALL_TIMEOUT_MS: u64 = 300_000;
const MAX_REALM_REQUEST_JSON_BYTES: usize = 2 * 1024 * 1024;

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct RuntimeBridgeDesktopAccountBeginLoginRequest {
    pub redirect_uri: String,
    pub callback_origin: String,
    #[serde(default)]
    pub requested_scopes: Vec<String>,
    pub ttl_seconds: i32,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeBridgeDesktopAccountBeginLoginResponse {
    pub accepted: bool,
    pub login_attempt_id: String,
    pub oauth_authorization_url: String,
    pub callback_origin: String,
    pub state: String,
    pub nonce: String,
    pub reason_code: i32,
    pub account_reason_code: i32,
    pub production_inert: bool,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct RuntimeBridgeDesktopAccountCompleteLoginRequest {
    pub login_attempt_id: String,
    pub code: String,
    pub state: String,
    pub nonce: String,
    pub redirect_uri: String,
    pub callback_origin: String,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeBridgeDesktopAccountMutationResponse {
    pub accepted: bool,
    pub state: i32,
    pub account_projection: Option<super::RuntimeBridgeDesktopAccountProjection>,
    pub reason_code: i32,
    pub account_reason_code: i32,
    pub production_inert: bool,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct RuntimeBridgeDesktopAccountRealmUnaryRequest {
    pub method_id: String,
    pub request_json: String,
    pub timeout_ms: i32,
    pub idempotency_key: Option<String>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeBridgeDesktopAccountRealmUnaryResponse {
    pub accepted: bool,
    pub response_json: String,
    pub reason_code: i32,
    pub account_reason_code: i32,
    pub production_inert: bool,
    pub http_status: i32,
    pub error_message: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct RuntimeBridgeDesktopAccountActionRequest {
    pub reason: String,
}

fn required_text(value: String, field: &str, max_bytes: usize) -> Result<String, String> {
    let value = value.trim();
    if value.is_empty() || value.contains('\0') || value.len() > max_bytes {
        return Err(format!("protected Desktop account {field} is invalid"));
    }
    Ok(value.to_string())
}

fn optional_text(
    value: Option<String>,
    field: &str,
    max_bytes: usize,
) -> Result<Option<String>, String> {
    value
        .map(|value| required_text(value, field, max_bytes))
        .transpose()
}

fn normalized_scopes(values: Vec<String>) -> Result<Vec<String>, String> {
    if values.len() > 32 {
        return Err("protected Desktop account requestedScopes exceeds 32 entries".to_string());
    }
    let mut values = values
        .into_iter()
        .map(|value| required_text(value, "requestedScopes", 128))
        .collect::<Result<Vec<_>, _>>()?;
    values.sort();
    values.dedup();
    Ok(values)
}

fn project_account(
    projection: Option<DesktopAccountProjection>,
) -> Option<super::RuntimeBridgeDesktopAccountProjection> {
    projection.map(|projection| super::RuntimeBridgeDesktopAccountProjection {
        account_id: projection.account_id,
        display_name: projection.display_name,
        realm_environment_id: projection.realm_environment_id,
    })
}

fn account_transport_error(error: nimi_shell_protected_local::NimiHostError) -> String {
    bridge_error(
        "RUNTIME_ACCOUNT_PROTECTED_CARRIER_UNAVAILABLE",
        error.reason_code().as_str(),
    )
}

pub async fn begin_login(
    input: RuntimeBridgeDesktopAccountBeginLoginRequest,
) -> Result<RuntimeBridgeDesktopAccountBeginLoginResponse, String> {
    if !(10..=600).contains(&input.ttl_seconds) {
        return Err("protected Desktop account ttlSeconds must be between 10 and 600".to_string());
    }
    let response = service_control::begin_account_login(DesktopAccountBeginLoginRequest {
        redirect_uri: required_text(input.redirect_uri, "redirectUri", 2048)?,
        callback_origin: required_text(input.callback_origin, "callbackOrigin", 2048)?,
        requested_scopes: normalized_scopes(input.requested_scopes)?,
        ttl_seconds: input.ttl_seconds,
    })
    .await
    .map_err(account_transport_error)?;
    Ok(RuntimeBridgeDesktopAccountBeginLoginResponse {
        accepted: response.accepted,
        login_attempt_id: response.login_attempt_id,
        oauth_authorization_url: response.oauth_authorization_url,
        callback_origin: response.callback_origin,
        state: response.state,
        nonce: response.nonce,
        reason_code: response.reason_code,
        account_reason_code: response.account_reason_code,
        production_inert: response.production_inert,
    })
}

pub async fn complete_login(
    input: RuntimeBridgeDesktopAccountCompleteLoginRequest,
) -> Result<RuntimeBridgeDesktopAccountMutationResponse, String> {
    let response = service_control::complete_account_login(DesktopAccountCompleteLoginRequest {
        login_attempt_id: required_text(input.login_attempt_id, "loginAttemptId", 256)?,
        code: required_text(input.code, "code", 4096)?,
        state: required_text(input.state, "state", 512)?,
        nonce: required_text(input.nonce, "nonce", 512)?,
        redirect_uri: required_text(input.redirect_uri, "redirectUri", 2048)?,
        callback_origin: required_text(input.callback_origin, "callbackOrigin", 2048)?,
    })
    .await
    .map_err(account_transport_error)?;
    Ok(RuntimeBridgeDesktopAccountMutationResponse {
        accepted: response.accepted,
        state: response.state,
        account_projection: project_account(response.account_projection),
        reason_code: response.reason_code,
        account_reason_code: response.account_reason_code,
        production_inert: response.production_inert,
    })
}

pub async fn invoke_realm_unary(
    input: RuntimeBridgeDesktopAccountRealmUnaryRequest,
) -> Result<RuntimeBridgeDesktopAccountRealmUnaryResponse, String> {
    let request_json = required_text(
        input.request_json,
        "requestJson",
        MAX_REALM_REQUEST_JSON_BYTES,
    )?;
    let timeout_ms = u64::try_from(input.timeout_ms)
        .ok()
        .filter(|value| *value > 0 && *value <= MAX_ACCOUNT_CALL_TIMEOUT_MS)
        .ok_or_else(|| {
            "protected Desktop account timeoutMs must be between 1 and 300000".to_string()
        })?;
    let idempotency_key = optional_text(input.idempotency_key, "idempotencyKey", 256)?;
    let response = service_control::invoke_account_realm_unary(DesktopAccountRealmUnaryRequest {
        method_id: required_text(input.method_id, "methodId", 512)?,
        request_json,
        timeout_ms: i32::try_from(timeout_ms)
            .map_err(|_| "protected Desktop account timeoutMs exceeds int32".to_string())?,
        idempotency_key,
    })
    .await
    .map_err(account_transport_error)?;
    Ok(RuntimeBridgeDesktopAccountRealmUnaryResponse {
        accepted: response.accepted,
        response_json: response.response_json,
        reason_code: response.reason_code,
        account_reason_code: response.account_reason_code,
        production_inert: response.production_inert,
        http_status: response.http_status,
        error_message: response.error_message,
    })
}

pub async fn logout(
    input: RuntimeBridgeDesktopAccountActionRequest,
) -> Result<RuntimeBridgeDesktopAccountMutationResponse, String> {
    let response = service_control::logout_account(DesktopAccountActionRequest {
        reason: required_text(input.reason, "reason", 256)?,
    })
    .await
    .map_err(account_transport_error)?;
    Ok(RuntimeBridgeDesktopAccountMutationResponse {
        accepted: response.accepted,
        state: response.state,
        account_projection: None,
        reason_code: response.reason_code,
        account_reason_code: response.account_reason_code,
        production_inert: response.production_inert,
    })
}

pub async fn switch_account(
    input: RuntimeBridgeDesktopAccountActionRequest,
) -> Result<RuntimeBridgeDesktopAccountMutationResponse, String> {
    let response = service_control::switch_account(DesktopAccountActionRequest {
        reason: required_text(input.reason, "reason", 256)?,
    })
    .await
    .map_err(account_transport_error)?;
    Ok(RuntimeBridgeDesktopAccountMutationResponse {
        accepted: response.accepted,
        state: response.state,
        account_projection: project_account(response.account_projection),
        reason_code: response.reason_code,
        account_reason_code: response.account_reason_code,
        production_inert: response.production_inert,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scopes_are_bounded_sorted_and_deduplicated() {
        assert_eq!(
            normalized_scopes(vec![
                " profile.read ".to_string(),
                "profile.read".to_string(),
                "chat.read".to_string(),
            ])
            .expect("normalized scopes"),
            vec!["chat.read", "profile.read"],
        );
        assert!(normalized_scopes(vec!["x".to_string(); 33]).is_err());
    }

    #[test]
    fn account_projection_drops_workspace_and_credential_adjacent_fields() {
        let projection = project_account(Some(DesktopAccountProjection {
            account_id: "account-1".to_string(),
            display_name: "Nimi User".to_string(),
            realm_environment_id: "realm-1".to_string(),
        }))
        .expect("safe account projection");
        assert_eq!(projection.account_id, "account-1");
        assert_eq!(projection.display_name, "Nimi User");
        assert_eq!(projection.realm_environment_id, "realm-1");
    }
}
