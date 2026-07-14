use tonic::transport::Channel;

use crate::generated::runtime_account_service_client::RuntimeAccountServiceClient;
use crate::generated::{
    AccountCaller, AccountCallerMode, AccountProjection, AccountSessionState, BeginLoginRequest,
    BeginLoginResponse, CompleteLoginRequest, CompleteLoginResponse,
    GetAccountSessionStatusRequest, GetAccountSessionStatusResponse, InvokeRealmUnaryRequest,
    InvokeRealmUnaryResponse, LogoutRequest, LogoutResponse, SwitchAccountRequest,
    SwitchAccountResponse,
};
use crate::grpc_status::host_error_from_status;
use crate::{
    DesktopAccountActionRequest, DesktopAccountBeginLoginRequest, DesktopAccountBeginLoginResponse,
    DesktopAccountCompleteLoginRequest, DesktopAccountMutationResponse, DesktopAccountProjection,
    DesktopAccountRealmUnaryRequest, DesktopAccountRealmUnaryResponse, DesktopAccountSessionState,
    DesktopAccountSessionStatus, DesktopAccountSessionStatusRequest, NimiHostError,
    NimiHostErrorReasonCode,
};

const DESKTOP_ACCOUNT_SOURCE_HOST: &str = "protected-local-desktop-account-host";
const DESKTOP_ACCOUNT_CALLER_KIND: &str = "desktop-shell";
const DESKTOP_ACCOUNT_APP_ID: &str = "nimi.desktop";
const DESKTOP_ACCOUNT_APP_INSTANCE_ID: &str = "nimi.desktop.local-first-party";
const DESKTOP_ACCOUNT_DEVICE_ID: &str = "desktop-shell";
const MAX_REALM_REQUEST_JSON_BYTES: usize = 2 * 1024 * 1024;
const MAX_ACCOUNT_CALL_TIMEOUT_MS: i32 = 300_000;

const ACTION_EXECUTED: i32 = 1;
const PRINCIPAL_UNAUTHORIZED: i32 = 8;

pub(crate) async fn get_account_session_status(
    channel: Channel,
    request: DesktopAccountSessionStatusRequest,
) -> Result<DesktopAccountSessionStatus, NimiHostError> {
    let request = build_request(request)?;
    let response = RuntimeAccountServiceClient::new(channel)
        .get_account_session_status(request)
        .await
        .map_err(host_error_from_status)?
        .into_inner();
    project_response(response)
}

pub(crate) async fn begin_login(
    channel: Channel,
    input: DesktopAccountBeginLoginRequest,
) -> Result<DesktopAccountBeginLoginResponse, NimiHostError> {
    if !(10..=600).contains(&input.ttl_seconds) {
        return Err(untrusted());
    }
    let mut request = protected_request(BeginLoginRequest {
        caller: Some(desktop_account_caller()?),
        redirect_uri: required_bounded_text(input.redirect_uri, 2048)?,
        callback_origin: required_bounded_text(input.callback_origin, 2048)?,
        requested_scopes: normalized_scopes(input.requested_scopes)?,
        ttl_seconds: input.ttl_seconds,
    })?;
    request.set_timeout(std::time::Duration::from_secs(30));
    let response: BeginLoginResponse = RuntimeAccountServiceClient::new(channel)
        .begin_login(request)
        .await
        .map_err(host_error_from_status)?
        .into_inner();
    Ok(DesktopAccountBeginLoginResponse {
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

pub(crate) async fn complete_login(
    channel: Channel,
    input: DesktopAccountCompleteLoginRequest,
) -> Result<DesktopAccountMutationResponse, NimiHostError> {
    let mut request = protected_request(CompleteLoginRequest {
        caller: Some(desktop_account_caller()?),
        login_attempt_id: required_bounded_text(input.login_attempt_id, 256)?,
        code: required_bounded_text(input.code, 4096)?,
        state: required_bounded_text(input.state, 512)?,
        nonce: required_bounded_text(input.nonce, 512)?,
        redirect_uri: required_bounded_text(input.redirect_uri, 2048)?,
        callback_origin: required_bounded_text(input.callback_origin, 2048)?,
        ux_trace_id: String::new(),
        sealed_completion_ticket: String::new(),
        refresh_token: String::new(),
    })?;
    request.set_timeout(std::time::Duration::from_secs(30));
    let response: CompleteLoginResponse = RuntimeAccountServiceClient::new(channel)
        .complete_login(request)
        .await
        .map_err(host_error_from_status)?
        .into_inner();
    Ok(project_mutation(
        response.accepted,
        response.state,
        response.account_projection,
        response.reason_code,
        response.account_reason_code,
        response.production_inert,
    )?)
}

pub(crate) async fn invoke_realm_unary(
    channel: Channel,
    input: DesktopAccountRealmUnaryRequest,
) -> Result<DesktopAccountRealmUnaryResponse, NimiHostError> {
    if !(1..=MAX_ACCOUNT_CALL_TIMEOUT_MS).contains(&input.timeout_ms) {
        return Err(untrusted());
    }
    let mut request = protected_request(InvokeRealmUnaryRequest {
        caller: Some(desktop_account_caller()?),
        method_id: required_bounded_text(input.method_id, 512)?,
        realm_base_url: String::new(),
        request_json: required_bounded_text(input.request_json, MAX_REALM_REQUEST_JSON_BYTES)?,
        timeout_ms: input.timeout_ms,
    })?;
    if let Some(idempotency_key) = input.idempotency_key {
        insert_metadata(
            &mut request,
            "x-nimi-idempotency-key",
            required_bounded_text(idempotency_key, 256)?.as_str(),
        )?;
    }
    request.set_timeout(std::time::Duration::from_millis(input.timeout_ms as u64));
    let response: InvokeRealmUnaryResponse = RuntimeAccountServiceClient::new(channel)
        .invoke_realm_unary(request)
        .await
        .map_err(host_error_from_status)?
        .into_inner();
    Ok(DesktopAccountRealmUnaryResponse {
        accepted: response.accepted,
        response_json: response.response_json,
        reason_code: response.reason_code,
        account_reason_code: response.account_reason_code,
        production_inert: response.production_inert,
        http_status: response.http_status,
        error_message: response.error_message,
    })
}

pub(crate) async fn logout(
    channel: Channel,
    input: DesktopAccountActionRequest,
) -> Result<DesktopAccountMutationResponse, NimiHostError> {
    let mut request = protected_request(LogoutRequest {
        caller: Some(desktop_account_caller()?),
        reason: required_bounded_text(input.reason, 256)?,
    })?;
    request.set_timeout(std::time::Duration::from_secs(30));
    let response: LogoutResponse = RuntimeAccountServiceClient::new(channel)
        .logout(request)
        .await
        .map_err(host_error_from_status)?
        .into_inner();
    project_mutation(
        response.accepted,
        response.state,
        None,
        response.reason_code,
        response.account_reason_code,
        response.production_inert,
    )
}

pub(crate) async fn switch_account(
    channel: Channel,
    input: DesktopAccountActionRequest,
) -> Result<DesktopAccountMutationResponse, NimiHostError> {
    let mut request = protected_request(SwitchAccountRequest {
        caller: Some(desktop_account_caller()?),
        reason: required_bounded_text(input.reason, 256)?,
    })?;
    request.set_timeout(std::time::Duration::from_secs(30));
    let response: SwitchAccountResponse = RuntimeAccountServiceClient::new(channel)
        .switch_account(request)
        .await
        .map_err(host_error_from_status)?
        .into_inner();
    project_mutation(
        response.accepted,
        response.state,
        response.account_projection,
        response.reason_code,
        response.account_reason_code,
        response.production_inert,
    )
}

fn desktop_account_caller() -> Result<AccountCaller, NimiHostError> {
    Ok(AccountCaller {
        app_id: required_text(DESKTOP_ACCOUNT_APP_ID.to_string())?,
        app_instance_id: required_text(DESKTOP_ACCOUNT_APP_INSTANCE_ID.to_string())?,
        device_id: required_text(DESKTOP_ACCOUNT_DEVICE_ID.to_string())?,
        mode: AccountCallerMode::DesktopShell as i32,
        scopes: Vec::new(),
        launch_host_id: String::new(),
        launch_nonce: String::new(),
        release_descriptor_ref: String::new(),
    })
}

fn protected_request<T>(message: T) -> Result<tonic::Request<T>, NimiHostError> {
    let mut request = tonic::Request::new(message);
    insert_metadata(
        &mut request,
        "x-nimi-source-host",
        DESKTOP_ACCOUNT_SOURCE_HOST,
    )?;
    insert_metadata(
        &mut request,
        "x-nimi-caller-kind",
        DESKTOP_ACCOUNT_CALLER_KIND,
    )?;
    insert_metadata(&mut request, "x-nimi-app-id", DESKTOP_ACCOUNT_APP_ID)?;
    insert_metadata(
        &mut request,
        "x-nimi-app-instance-id",
        DESKTOP_ACCOUNT_APP_INSTANCE_ID,
    )?;
    insert_metadata(&mut request, "x-nimi-device-id", DESKTOP_ACCOUNT_DEVICE_ID)?;
    Ok(request)
}

fn required_bounded_text(value: String, max_bytes: usize) -> Result<String, NimiHostError> {
    let value = required_text(value)?;
    if value.len() > max_bytes {
        return Err(untrusted());
    }
    Ok(value)
}

fn normalized_scopes(values: Vec<String>) -> Result<Vec<String>, NimiHostError> {
    if values.len() > 32 {
        return Err(untrusted());
    }
    let mut values = values
        .into_iter()
        .map(|value| required_bounded_text(value, 128))
        .collect::<Result<Vec<_>, _>>()?;
    values.sort();
    values.dedup();
    Ok(values)
}

fn project_mutation(
    accepted: bool,
    state: i32,
    projection: Option<AccountProjection>,
    reason_code: i32,
    account_reason_code: i32,
    production_inert: bool,
) -> Result<DesktopAccountMutationResponse, NimiHostError> {
    Ok(DesktopAccountMutationResponse {
        accepted,
        state,
        account_projection: projection.map(project_account).transpose()?,
        reason_code,
        account_reason_code,
        production_inert,
    })
}

fn build_request(
    request: DesktopAccountSessionStatusRequest,
) -> Result<tonic::Request<GetAccountSessionStatusRequest>, NimiHostError> {
    let app_id = required_text(request.app_id)?;
    let app_instance_id = required_text(request.app_instance_id)?;
    let device_id = required_text(request.device_id)?;
    let caller = AccountCaller {
        app_id: app_id.clone(),
        app_instance_id: app_instance_id.clone(),
        device_id: device_id.clone(),
        mode: AccountCallerMode::DesktopShell as i32,
        scopes: Vec::new(),
        launch_host_id: String::new(),
        launch_nonce: String::new(),
        release_descriptor_ref: String::new(),
    };
    let mut request = tonic::Request::new(GetAccountSessionStatusRequest {
        caller: Some(caller),
    });
    insert_metadata(
        &mut request,
        "x-nimi-source-host",
        DESKTOP_ACCOUNT_SOURCE_HOST,
    )?;
    insert_metadata(
        &mut request,
        "x-nimi-caller-kind",
        DESKTOP_ACCOUNT_CALLER_KIND,
    )?;
    insert_metadata(&mut request, "x-nimi-app-id", app_id.as_str())?;
    insert_metadata(
        &mut request,
        "x-nimi-app-instance-id",
        app_instance_id.as_str(),
    )?;
    insert_metadata(&mut request, "x-nimi-device-id", device_id.as_str())?;
    Ok(request)
}

fn insert_metadata<T>(
    request: &mut tonic::Request<T>,
    key: &'static str,
    value: &str,
) -> Result<(), NimiHostError> {
    let value = tonic::metadata::MetadataValue::try_from(value).map_err(|_| untrusted())?;
    request.metadata_mut().insert(key, value);
    Ok(())
}

fn project_response(
    response: GetAccountSessionStatusResponse,
) -> Result<DesktopAccountSessionStatus, NimiHostError> {
    if response.production_inert
        || response.reason_code != ACTION_EXECUTED
        || response.account_reason_code != ACTION_EXECUTED
    {
        let reason = if response.reason_code == PRINCIPAL_UNAUTHORIZED {
            NimiHostErrorReasonCode::PrincipalUnauthorized
        } else {
            NimiHostErrorReasonCode::RuntimeServiceUntrusted
        };
        return Err(NimiHostError::new(reason, false));
    }
    let state = match AccountSessionState::try_from(response.state).map_err(|_| untrusted())? {
        AccountSessionState::Anonymous => DesktopAccountSessionState::Anonymous,
        AccountSessionState::LoginPending => DesktopAccountSessionState::LoginPending,
        AccountSessionState::Authenticated => DesktopAccountSessionState::Authenticated,
        AccountSessionState::RefreshPending => DesktopAccountSessionState::RefreshPending,
        AccountSessionState::Expired => DesktopAccountSessionState::Expired,
        AccountSessionState::ReauthRequired => DesktopAccountSessionState::ReauthRequired,
        AccountSessionState::Switching => DesktopAccountSessionState::Switching,
        AccountSessionState::LoggingOut => DesktopAccountSessionState::LoggingOut,
        AccountSessionState::Unavailable => DesktopAccountSessionState::Unavailable,
        AccountSessionState::Unspecified => return Err(untrusted()),
    };
    let account_projection = response
        .account_projection
        .map(project_account)
        .transpose()?;
    if state == DesktopAccountSessionState::Authenticated && account_projection.is_none() {
        return Err(untrusted());
    }
    Ok(DesktopAccountSessionStatus {
        state,
        account_projection,
    })
}

fn project_account(
    projection: AccountProjection,
) -> Result<DesktopAccountProjection, NimiHostError> {
    Ok(DesktopAccountProjection {
        account_id: required_text(projection.account_id)?,
        display_name: projection.display_name.trim().to_string(),
        realm_environment_id: projection.realm_environment_id.trim().to_string(),
    })
}

fn required_text(value: String) -> Result<String, NimiHostError> {
    let value = value.trim();
    if value.is_empty() || value.contains('\0') {
        return Err(untrusted());
    }
    Ok(value.to_string())
}

fn untrusted() -> NimiHostError {
    NimiHostError::new(NimiHostErrorReasonCode::RuntimeServiceUntrusted, false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn account_status_request_binds_host_owned_caller_and_metadata() {
        let request = build_request(DesktopAccountSessionStatusRequest {
            app_id: " nimi.desktop ".to_string(),
            app_instance_id: " nimi.desktop.local-first-party ".to_string(),
            device_id: " desktop-shell ".to_string(),
        })
        .expect("host-owned account request");
        let caller = request.get_ref().caller.as_ref().expect("account caller");
        assert_eq!(caller.app_id, "nimi.desktop");
        assert_eq!(caller.app_instance_id, "nimi.desktop.local-first-party");
        assert_eq!(caller.device_id, "desktop-shell");
        assert_eq!(caller.mode, AccountCallerMode::DesktopShell as i32);
        for (key, expected) in [
            ("x-nimi-source-host", DESKTOP_ACCOUNT_SOURCE_HOST),
            ("x-nimi-caller-kind", DESKTOP_ACCOUNT_CALLER_KIND),
            ("x-nimi-app-id", caller.app_id.as_str()),
            ("x-nimi-app-instance-id", caller.app_instance_id.as_str()),
            ("x-nimi-device-id", caller.device_id.as_str()),
        ] {
            assert_eq!(
                request
                    .metadata()
                    .get(key)
                    .and_then(|value| value.to_str().ok()),
                Some(expected),
                "metadata {key}",
            );
        }
    }

    #[test]
    fn account_status_request_rejects_non_metadata_safe_host_identity() {
        assert!(build_request(DesktopAccountSessionStatusRequest {
            app_id: "nimi.desktop".to_string(),
            app_instance_id: "desktop\ninstance".to_string(),
            device_id: "desktop-shell".to_string(),
        })
        .is_err());
    }

    #[test]
    fn projects_only_renderer_safe_account_fields() {
        let status = project_response(GetAccountSessionStatusResponse {
            state: AccountSessionState::Authenticated as i32,
            account_projection: Some(AccountProjection {
                account_id: "account-1".to_string(),
                display_name: "Nimi User".to_string(),
                realm_environment_id: "realm-1".to_string(),
                workspace_memberships: Vec::new(),
            }),
            reason_code: ACTION_EXECUTED,
            account_reason_code: ACTION_EXECUTED,
            production_inert: false,
        })
        .expect("account projection");

        assert_eq!(status.state, DesktopAccountSessionState::Authenticated);
        assert_eq!(
            status.account_projection,
            Some(DesktopAccountProjection {
                account_id: "account-1".to_string(),
                display_name: "Nimi User".to_string(),
                realm_environment_id: "realm-1".to_string(),
            })
        );
    }

    #[test]
    fn rejects_inert_or_incomplete_account_responses() {
        for response in [
            GetAccountSessionStatusResponse {
                state: AccountSessionState::Unavailable as i32,
                reason_code: PRINCIPAL_UNAUTHORIZED,
                account_reason_code: 10,
                production_inert: true,
                ..Default::default()
            },
            GetAccountSessionStatusResponse {
                state: AccountSessionState::Authenticated as i32,
                reason_code: ACTION_EXECUTED,
                account_reason_code: ACTION_EXECUTED,
                ..Default::default()
            },
            GetAccountSessionStatusResponse {
                state: AccountSessionState::Unspecified as i32,
                reason_code: ACTION_EXECUTED,
                account_reason_code: ACTION_EXECUTED,
                ..Default::default()
            },
        ] {
            assert!(project_response(response).is_err());
        }
    }
}
