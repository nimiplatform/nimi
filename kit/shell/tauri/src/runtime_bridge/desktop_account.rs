use prost::Message;
use serde::{Deserialize, Serialize};

use super::generated::{
    AccountCaller, AccountCallerMode, AccountProjection, BeginLoginRequest, BeginLoginResponse,
    CompleteLoginRequest, CompleteLoginResponse, InvokeRealmUnaryRequest, InvokeRealmUnaryResponse,
    LogoutRequest, LogoutResponse, SwitchAccountRequest, SwitchAccountResponse,
};
use super::{
    build_unary_payload, decode_unary_result, desktop_account_status_request,
    runtime_bridge_desktop_account_unary, RuntimeBridgeMetadata,
};

const BEGIN_LOGIN_METHOD_ID: &str = "/nimi.runtime.v1.RuntimeAccountService/BeginLogin";
const COMPLETE_LOGIN_METHOD_ID: &str = "/nimi.runtime.v1.RuntimeAccountService/CompleteLogin";
const INVOKE_REALM_UNARY_METHOD_ID: &str =
    "/nimi.runtime.v1.RuntimeAccountService/InvokeRealmUnary";
const LOGOUT_METHOD_ID: &str = "/nimi.runtime.v1.RuntimeAccountService/Logout";
const SWITCH_ACCOUNT_METHOD_ID: &str = "/nimi.runtime.v1.RuntimeAccountService/SwitchAccount";
const DEFAULT_ACCOUNT_CALL_TIMEOUT_MS: u64 = 30_000;
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

fn desktop_account_caller() -> Result<AccountCaller, String> {
    let identity = desktop_account_status_request()?;
    Ok(AccountCaller {
        app_id: required_text(identity.app_id, "appId", 256)?,
        app_instance_id: required_text(identity.app_instance_id, "appInstanceId", 256)?,
        device_id: required_text(identity.device_id, "deviceId", 256)?,
        mode: AccountCallerMode::DesktopShell as i32,
        scopes: Vec::new(),
        launch_host_id: String::new(),
        launch_nonce: String::new(),
        release_descriptor_ref: String::new(),
    })
}

async fn invoke_account_unary<Request, Response>(
    method_id: &str,
    request: Request,
    timeout_ms: u64,
    idempotency_key: Option<String>,
) -> Result<Response, String>
where
    Request: Message,
    Response: Message + Default,
{
    let mut payload = build_unary_payload(method_id, request, Some(timeout_ms));
    payload.metadata = Some(RuntimeBridgeMetadata {
        idempotency_key,
        ..RuntimeBridgeMetadata::default()
    });
    let response = runtime_bridge_desktop_account_unary(payload).await?;
    decode_unary_result(method_id, &response)
}

fn project_account(
    projection: Option<AccountProjection>,
) -> Option<super::RuntimeBridgeDesktopAccountProjection> {
    projection.map(|projection| super::RuntimeBridgeDesktopAccountProjection {
        account_id: projection.account_id,
        display_name: projection.display_name,
        realm_environment_id: projection.realm_environment_id,
    })
}

pub async fn begin_login(
    input: RuntimeBridgeDesktopAccountBeginLoginRequest,
) -> Result<RuntimeBridgeDesktopAccountBeginLoginResponse, String> {
    if !(10..=600).contains(&input.ttl_seconds) {
        return Err("protected Desktop account ttlSeconds must be between 10 and 600".to_string());
    }
    let response: BeginLoginResponse = invoke_account_unary(
        BEGIN_LOGIN_METHOD_ID,
        BeginLoginRequest {
            caller: Some(desktop_account_caller()?),
            redirect_uri: required_text(input.redirect_uri, "redirectUri", 2048)?,
            callback_origin: required_text(input.callback_origin, "callbackOrigin", 2048)?,
            requested_scopes: normalized_scopes(input.requested_scopes)?,
            ttl_seconds: input.ttl_seconds,
        },
        DEFAULT_ACCOUNT_CALL_TIMEOUT_MS,
        None,
    )
    .await?;
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
    let response: CompleteLoginResponse = invoke_account_unary(
        COMPLETE_LOGIN_METHOD_ID,
        CompleteLoginRequest {
            caller: Some(desktop_account_caller()?),
            login_attempt_id: required_text(input.login_attempt_id, "loginAttemptId", 256)?,
            code: required_text(input.code, "code", 4096)?,
            state: required_text(input.state, "state", 512)?,
            nonce: required_text(input.nonce, "nonce", 512)?,
            redirect_uri: required_text(input.redirect_uri, "redirectUri", 2048)?,
            callback_origin: required_text(input.callback_origin, "callbackOrigin", 2048)?,
            ux_trace_id: String::new(),
            sealed_completion_ticket: String::new(),
            refresh_token: String::new(),
        },
        DEFAULT_ACCOUNT_CALL_TIMEOUT_MS,
        None,
    )
    .await?;
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
    let response: InvokeRealmUnaryResponse = invoke_account_unary(
        INVOKE_REALM_UNARY_METHOD_ID,
        InvokeRealmUnaryRequest {
            caller: Some(desktop_account_caller()?),
            method_id: required_text(input.method_id, "methodId", 512)?,
            realm_base_url: String::new(),
            request_json,
            timeout_ms: input.timeout_ms,
        },
        timeout_ms,
        idempotency_key,
    )
    .await?;
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
    let response: LogoutResponse = invoke_account_unary(
        LOGOUT_METHOD_ID,
        LogoutRequest {
            caller: Some(desktop_account_caller()?),
            reason: required_text(input.reason, "reason", 256)?,
        },
        DEFAULT_ACCOUNT_CALL_TIMEOUT_MS,
        None,
    )
    .await?;
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
    let response: SwitchAccountResponse = invoke_account_unary(
        SWITCH_ACCOUNT_METHOD_ID,
        SwitchAccountRequest {
            caller: Some(desktop_account_caller()?),
            reason: required_text(input.reason, "reason", 256)?,
        },
        DEFAULT_ACCOUNT_CALL_TIMEOUT_MS,
        None,
    )
    .await?;
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
        let projection = project_account(Some(AccountProjection {
            account_id: "account-1".to_string(),
            display_name: "Nimi User".to_string(),
            realm_environment_id: "realm-1".to_string(),
            workspace_memberships: Vec::new(),
        }))
        .expect("safe account projection");
        assert_eq!(projection.account_id, "account-1");
        assert_eq!(projection.display_name, "Nimi User");
        assert_eq!(projection.realm_environment_id, "realm-1");
    }
}
