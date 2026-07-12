use tonic::transport::Channel;

use crate::generated::runtime_account_service_client::RuntimeAccountServiceClient;
use crate::generated::{
    AccountCaller, AccountCallerMode, AccountProjection, AccountSessionState,
    GetAccountSessionStatusRequest, GetAccountSessionStatusResponse,
};
use crate::grpc_status::host_error_from_status;
use crate::{
    DesktopAccountProjection, DesktopAccountSessionState, DesktopAccountSessionStatus,
    DesktopAccountSessionStatusRequest, NimiHostError, NimiHostErrorReasonCode,
};

const ACTION_EXECUTED: i32 = 1;
const PRINCIPAL_UNAUTHORIZED: i32 = 8;

pub(crate) async fn get_account_session_status(
    channel: Channel,
    request: DesktopAccountSessionStatusRequest,
) -> Result<DesktopAccountSessionStatus, NimiHostError> {
    let caller = AccountCaller {
        app_id: required_text(request.app_id)?,
        app_instance_id: required_text(request.app_instance_id)?,
        device_id: required_text(request.device_id)?,
        mode: AccountCallerMode::DesktopShell as i32,
        scopes: Vec::new(),
        launch_host_id: String::new(),
        launch_nonce: String::new(),
        release_descriptor_ref: String::new(),
    };
    let response = RuntimeAccountServiceClient::new(channel)
        .get_account_session_status(GetAccountSessionStatusRequest {
            caller: Some(caller),
        })
        .await
        .map_err(host_error_from_status)?
        .into_inner();
    project_response(response)
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
