use tonic::transport::Channel;
use url::Url;

use crate::generated::runtime_account_service_client::RuntimeAccountServiceClient;
use crate::generated::{
    AccountCaller, AccountCallerMode, AccountEventType, AccountProjection, AccountReasonCode,
    AccountSessionDeliveryKind, AccountSessionEvent, AccountSessionSnapshot, AccountSessionState,
    BeginLoginRequest, BeginLoginResponse, CompleteLoginRequest, CompleteLoginResponse,
    GetAccountSessionStatusRequest, GetAccountSessionStatusResponse, InvokeRealmUnaryRequest,
    InvokeRealmUnaryResponse, LogoutRequest, LogoutResponse, ReasonCode,
    SubscribeAccountSessionEventsRequest, SwitchAccountRequest, SwitchAccountResponse,
};
use crate::grpc_status::host_error_from_status;
use crate::{
    DesktopAccountActionRequest, DesktopAccountBeginLoginRequest, DesktopAccountBeginLoginResponse,
    DesktopAccountCompleteLoginRequest, DesktopAccountMutationResponse, DesktopAccountProjection,
    DesktopAccountRealmUnaryRequest, DesktopAccountRealmUnaryResponse,
    DesktopAccountSessionDeliveryKind, DesktopAccountSessionEvent,
    DesktopAccountSessionEventReceiver, DesktopAccountSessionEventsRequest,
    DesktopAccountSessionState, DesktopAccountSessionStatus, DesktopAccountSessionStatusRequest,
    NimiHostError, NimiHostErrorReasonCode,
};

const DESKTOP_ACCOUNT_SOURCE_HOST: &str = "protected-local-desktop-account-host";
const DESKTOP_ACCOUNT_CALLER_KIND: &str = "desktop-shell";
const DESKTOP_ACCOUNT_APP_ID: &str = "nimi.desktop";
const DESKTOP_ACCOUNT_APP_INSTANCE_ID: &str = "nimi.desktop.local-first-party";
const DESKTOP_ACCOUNT_DEVICE_ID: &str = "desktop-shell";
const MAX_REALM_REQUEST_JSON_BYTES: usize = 2 * 1024 * 1024;
const MAX_ACCOUNT_CALL_TIMEOUT_MS: i32 = 300_000;
const ACCOUNT_EVENT_SUBSCRIBE_OPEN_TIMEOUT: std::time::Duration =
    std::time::Duration::from_secs(30);
const REALM_UNARY_CARRIER_COMPLETION_MARGIN_MS: u64 = 5_000;
const DESKTOP_ACCOUNT_CALLBACK_PATH: &str = "/oauth/callback";
const DESKTOP_ACCOUNT_CALLBACK_PORT_MIN: u16 = 1_024;
const DESKTOP_ACCOUNT_CALLBACK_PORT_MAX: u16 = 49_151;

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

pub(crate) async fn open_account_session_events(
    channel: Channel,
    request: DesktopAccountSessionEventsRequest,
) -> Result<DesktopAccountSessionEventReceiver, NimiHostError> {
    let request = protected_request(SubscribeAccountSessionEventsRequest {
        caller: Some(desktop_account_caller()?),
        after_sequence: request.after_sequence,
    })?;
    // Bound only the subscription handshake. A gRPC request deadline also
    // governs the established server stream and would force every healthy
    // account watcher offline after the same fixed interval.
    let response = tokio::time::timeout(
        ACCOUNT_EVENT_SUBSCRIBE_OPEN_TIMEOUT,
        RuntimeAccountServiceClient::new(channel).subscribe_account_session_events(request),
    )
    .await
    .map_err(|_| unavailable())?
    .map_err(host_error_from_status)?
    .into_inner();
    let mut stream = response;
    let (sender, receiver) = tokio::sync::mpsc::channel(32);
    tokio::spawn(async move {
        loop {
            // Dropping the host-side receiver must drop the tonic stream now,
            // rather than leave a detached reader until another account event.
            let message = tokio::select! {
                biased;
                _ = sender.closed() => break,
                message = stream.message() => message,
            };
            let item = match message {
                Ok(Some(event)) => project_event(event),
                Ok(None) => break,
                Err(status) => Err(host_error_from_status(status)),
            };
            let terminal = item.is_err();
            if sender.send(item).await.is_err() || terminal {
                break;
            }
        }
    });
    Ok(receiver)
}

pub(crate) async fn begin_login(
    channel: Channel,
    input: DesktopAccountBeginLoginRequest,
) -> Result<DesktopAccountBeginLoginResponse, NimiHostError> {
    if !(10..=600).contains(&input.ttl_seconds) {
        return Err(untrusted());
    }
    let (redirect_uri, callback_origin) =
        validate_callback_pair(input.redirect_uri, input.callback_origin)?;
    let mut request = protected_request(BeginLoginRequest {
        caller: Some(desktop_account_caller()?),
        redirect_uri: redirect_uri.clone(),
        callback_origin: callback_origin.clone(),
        requested_scopes: normalized_scopes(input.requested_scopes)?,
        ttl_seconds: input.ttl_seconds,
    })?;
    request.set_timeout(std::time::Duration::from_secs(30));
    let response: BeginLoginResponse = RuntimeAccountServiceClient::new(channel)
        .begin_login(request)
        .await
        .map_err(host_error_from_status)?
        .into_inner();
    validate_reason_codes(response.reason_code, response.account_reason_code)?;
    if response.accepted {
        required_bounded_text(response.login_attempt_id.clone(), 256)?;
        required_bounded_text(response.state.clone(), 512)?;
        required_bounded_text(response.nonce.clone(), 512)?;
        if response.reason_code != ACTION_EXECUTED
            || response.account_reason_code != ACTION_EXECUTED
            || response.production_inert
            || response.callback_origin != callback_origin
            || !authorization_url_matches_attempt(
                response.oauth_authorization_url.as_str(),
                redirect_uri.as_str(),
                response.state.as_str(),
            )
        {
            return Err(untrusted());
        }
    }
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
    let (redirect_uri, callback_origin) =
        validate_callback_pair(input.redirect_uri, input.callback_origin)?;
    let mut request = protected_request(CompleteLoginRequest {
        caller: Some(desktop_account_caller()?),
        login_attempt_id: required_bounded_text(input.login_attempt_id, 256)?,
        code: required_bounded_text(input.code, 4096)?,
        state: required_bounded_text(input.state, 512)?,
        nonce: required_bounded_text(input.nonce, 512)?,
        redirect_uri,
        callback_origin,
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
    let projected = project_mutation(
        response.accepted,
        response.state,
        response.account_projection,
        response.reason_code,
        response.account_reason_code,
        response.production_inert,
    )?;
    if projected.accepted
        && (projected.state != AccountSessionState::Authenticated as i32
            || projected.account_projection.is_none())
    {
        return Err(untrusted());
    }
    Ok(projected)
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
    request.set_timeout(realm_unary_carrier_timeout(input.timeout_ms));
    let response: InvokeRealmUnaryResponse = RuntimeAccountServiceClient::new(channel)
        .invoke_realm_unary(request)
        .await
        .map_err(host_error_from_status)?
        .into_inner();
    validate_reason_codes(response.reason_code, response.account_reason_code)?;
    if response.accepted {
        if response.reason_code != ACTION_EXECUTED
            || response.account_reason_code != ACTION_EXECUTED
            || response.production_inert
            || !(200..300).contains(&response.http_status)
            || serde_json::from_str::<serde_json::Value>(response.response_json.as_str()).is_err()
            || !response.error_message.is_empty()
        {
            return Err(untrusted());
        }
    } else if !response.response_json.is_empty() {
        return Err(untrusted());
    }
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
    let projected = project_mutation(
        response.accepted,
        response.state,
        None,
        response.reason_code,
        response.account_reason_code,
        response.production_inert,
    )?;
    if projected.accepted && projected.state != AccountSessionState::Anonymous as i32 {
        return Err(untrusted());
    }
    Ok(projected)
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
    let projected = project_mutation(
        response.accepted,
        response.state,
        response.account_projection,
        response.reason_code,
        response.account_reason_code,
        response.production_inert,
    )?;
    if projected.accepted
        && (projected.state != AccountSessionState::Anonymous as i32
            || projected.account_projection.is_some())
    {
        return Err(untrusted());
    }
    Ok(projected)
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

fn realm_unary_carrier_timeout(operation_timeout_ms: i32) -> std::time::Duration {
    std::time::Duration::from_millis(
        (operation_timeout_ms as u64).saturating_add(REALM_UNARY_CARRIER_COMPLETION_MARGIN_MS),
    )
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
    validate_reason_codes(reason_code, account_reason_code)?;
    let state = validate_account_session_state(state)?;
    let account_projection = projection.map(project_account).transpose()?;
    if accepted {
        if reason_code != ACTION_EXECUTED
            || account_reason_code != ACTION_EXECUTED
            || production_inert
            || (state == AccountSessionState::Authenticated && account_projection.is_none())
        {
            return Err(untrusted());
        }
    }
    Ok(DesktopAccountMutationResponse {
        accepted,
        state: state as i32,
        account_projection,
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
    if !response.accepted
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
    project_snapshot(response.snapshot.ok_or_else(untrusted)?)
}

fn project_snapshot(
    snapshot: AccountSessionSnapshot,
) -> Result<DesktopAccountSessionStatus, NimiHostError> {
    validate_reason_codes(snapshot.reason_code, snapshot.account_reason_code)?;
    let state = match validate_account_session_state(snapshot.state)? {
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
    let account_projection = snapshot
        .account_projection
        .map(project_account)
        .transpose()?;
    if state == DesktopAccountSessionState::Authenticated && account_projection.is_none() {
        return Err(untrusted());
    }
    Ok(DesktopAccountSessionStatus {
        sequence: snapshot.sequence,
        state,
        reason_code: snapshot.reason_code,
        account_reason_code: snapshot.account_reason_code,
        account_projection,
    })
}

fn project_event(event: AccountSessionEvent) -> Result<DesktopAccountSessionEvent, NimiHostError> {
    let event_type = AccountEventType::try_from(event.event_type).map_err(|_| untrusted())?;
    if event_type == AccountEventType::Unspecified {
        return Err(untrusted());
    }
    let delivery_kind =
        match AccountSessionDeliveryKind::try_from(event.delivery_kind).map_err(|_| untrusted())? {
            AccountSessionDeliveryKind::Snapshot => DesktopAccountSessionDeliveryKind::Snapshot,
            AccountSessionDeliveryKind::Replay => DesktopAccountSessionDeliveryKind::Replay,
            AccountSessionDeliveryKind::Live => DesktopAccountSessionDeliveryKind::Live,
            AccountSessionDeliveryKind::Unspecified => return Err(untrusted()),
        };
    let status = project_snapshot(event.snapshot.ok_or_else(untrusted)?)?;
    if event.sequence != status.sequence {
        return Err(untrusted());
    }
    if (delivery_kind == DesktopAccountSessionDeliveryKind::Snapshot
        && event_type != AccountEventType::AccountStatus)
        || (event.replay_truncated && delivery_kind != DesktopAccountSessionDeliveryKind::Snapshot)
    {
        return Err(untrusted());
    }
    Ok(DesktopAccountSessionEvent {
        sequence: status.sequence,
        delivery_kind,
        state: status.state,
        reason_code: status.reason_code,
        account_reason_code: status.account_reason_code,
        account_projection: status.account_projection,
        replay_truncated: event.replay_truncated,
    })
}

fn project_account(
    projection: AccountProjection,
) -> Result<DesktopAccountProjection, NimiHostError> {
    Ok(DesktopAccountProjection {
        account_id: required_text(projection.account_id)?,
        display_name: projection.display_name.trim().to_string(),
        realm_environment_id: required_text(projection.realm_environment_id)?,
    })
}

fn validate_reason_codes(reason_code: i32, account_reason_code: i32) -> Result<(), NimiHostError> {
    let reason = ReasonCode::try_from(reason_code).map_err(|_| untrusted())?;
    let account_reason =
        AccountReasonCode::try_from(account_reason_code).map_err(|_| untrusted())?;
    if reason == ReasonCode::Unspecified || account_reason == AccountReasonCode::Unspecified {
        return Err(untrusted());
    }
    Ok(())
}

fn validate_account_session_state(value: i32) -> Result<AccountSessionState, NimiHostError> {
    let state = AccountSessionState::try_from(value).map_err(|_| untrusted())?;
    if state == AccountSessionState::Unspecified {
        return Err(untrusted());
    }
    Ok(state)
}

fn validate_callback_pair(
    redirect_uri: String,
    callback_origin: String,
) -> Result<(String, String), NimiHostError> {
    if redirect_uri != redirect_uri.trim() || callback_origin != callback_origin.trim() {
        return Err(untrusted());
    }
    let redirect =
        Url::parse(required_bounded_text(redirect_uri, 2048)?.as_str()).map_err(|_| untrusted())?;
    let origin = Url::parse(required_bounded_text(callback_origin, 2048)?.as_str())
        .map_err(|_| untrusted())?;
    let host_admitted = |url: &Url| {
        matches!(
            url.host_str().map(str::to_ascii_lowercase).as_deref(),
            Some("localhost" | "127.0.0.1" | "::1")
        )
    };
    let redirect_port = redirect.port().ok_or_else(untrusted)?;
    if redirect.scheme() != "http"
        || !host_admitted(&redirect)
        || !redirect.username().is_empty()
        || redirect.password().is_some()
        || !(DESKTOP_ACCOUNT_CALLBACK_PORT_MIN..=DESKTOP_ACCOUNT_CALLBACK_PORT_MAX)
            .contains(&redirect_port)
        || redirect.path() != DESKTOP_ACCOUNT_CALLBACK_PATH
        || redirect.query().is_some()
        || redirect.fragment().is_some()
        || origin.scheme() != "http"
        || !host_admitted(&origin)
        || !origin.username().is_empty()
        || origin.password().is_some()
        || origin.port() != Some(redirect_port)
        || origin.path() != "/"
        || origin.query().is_some()
        || origin.fragment().is_some()
        || origin.origin() != redirect.origin()
    {
        return Err(untrusted());
    }
    Ok((redirect.to_string(), origin.origin().ascii_serialization()))
}

fn authorization_url_matches_attempt(value: &str, redirect_uri: &str, state: &str) -> bool {
    let Ok(url) = Url::parse(value) else {
        return false;
    };
    let redirect_values = url
        .query_pairs()
        .filter(|(key, _)| key == "redirect_uri")
        .map(|(_, value)| value.into_owned())
        .collect::<Vec<_>>();
    let state_values = url
        .query_pairs()
        .filter(|(key, _)| key == "state")
        .map(|(_, value)| value.into_owned())
        .collect::<Vec<_>>();
    (url.scheme() == "https" || url.scheme() == "http")
        && url.username().is_empty()
        && url.password().is_none()
        && url.host_str().is_some()
        && url.fragment().is_none()
        && redirect_values == [redirect_uri]
        && state_values == [state]
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

fn unavailable() -> NimiHostError {
    NimiHostError::new(NimiHostErrorReasonCode::RuntimeServiceUnavailable, true)
}

#[cfg(test)]
#[path = "windows_desktop_account_tests.rs"]
mod tests;
