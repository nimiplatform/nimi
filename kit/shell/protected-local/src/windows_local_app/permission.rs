use tonic::transport::Channel;

use crate::generated::runtime_account_service_client::RuntimeAccountServiceClient;
use crate::generated::{
    GetLocalAppGrantStatusRequest, LocalAppGrantProjection, ReasonCode, RequestLocalAppGrantRequest,
};
use crate::grpc_status::{local_app_error_from_status, local_app_reason_from_proto};
use crate::{
    LocalAppOperationError, LocalAppPermissionPosture, LocalAppPermissionPostureRequest,
    LocalAppPermissionRequest, LocalAppPermissionState, LocalAppReasonCode,
};

use super::{require_text, untrusted};

pub(super) async fn local_app_permission_posture(
    channel: Channel,
    request: LocalAppPermissionPostureRequest,
) -> Result<LocalAppPermissionPosture, LocalAppOperationError> {
    require_text(&request.operation_id)?;
    if !request.resource_ref.is_empty() {
        require_text(&request.resource_ref)?;
    }
    let response = RuntimeAccountServiceClient::new(channel)
        .get_local_app_grant_status(GetLocalAppGrantStatusRequest {
            operation_id: request.operation_id.clone(),
            resource_ref: request.resource_ref.clone(),
        })
        .await
        .map_err(local_app_error_from_status)?
        .into_inner();
    project_permission_posture(
        response.projection.ok_or_else(untrusted)?,
        request.operation_id,
        request.resource_ref,
    )
}

pub(super) async fn request_local_app_permission(
    channel: Channel,
    request: LocalAppPermissionRequest,
) -> Result<LocalAppPermissionPosture, LocalAppOperationError> {
    require_text(&request.operation_id)?;
    require_text(&request.resource_ref)?;
    require_text(&request.purpose)?;
    let response = RuntimeAccountServiceClient::new(channel)
        .request_local_app_grant(RequestLocalAppGrantRequest {
            operation_id: request.operation_id.clone(),
            resource_ref: request.resource_ref.clone(),
            purpose: request.purpose,
        })
        .await
        .map_err(local_app_error_from_status)?
        .into_inner();
    let projection = project_permission_posture(
        response.projection.ok_or_else(untrusted)?,
        request.operation_id,
        request.resource_ref,
    )?;
    require_pending_permission(projection)
}

fn require_pending_permission(
    projection: LocalAppPermissionPosture,
) -> Result<LocalAppPermissionPosture, LocalAppOperationError> {
    if projection.state != LocalAppPermissionState::Pending {
        return Err(LocalAppOperationError::new(
            projection.reason_code,
            projection.retryable,
        ));
    }
    Ok(projection)
}

fn project_permission_posture(
    projection: LocalAppGrantProjection,
    operation_id: String,
    resource_ref: String,
) -> Result<LocalAppPermissionPosture, LocalAppOperationError> {
    if projection.operation_id != operation_id || projection.resource_ref != resource_ref {
        return Err(untrusted());
    }
    let runtime_reason = ReasonCode::try_from(projection.reason_code).map_err(|_| untrusted())?;
    let (state, reason_code, action_hint, retryable) = match (projection.state, runtime_reason) {
        (1, ReasonCode::LocalAppGrantRequired) => (
            LocalAppPermissionState::ZeroGrant,
            LocalAppReasonCode::NoGrant,
            "request_local_app_operation_grant",
            false,
        ),
        (2, ReasonCode::LocalAppPresenceRequired) => (
            LocalAppPermissionState::Pending,
            LocalAppReasonCode::NoGrant,
            "await_local_app_grant_decision",
            true,
        ),
        (3, ReasonCode::ActionExecuted) => (
            LocalAppPermissionState::Granted,
            LocalAppReasonCode::ActionExecuted,
            "continue_local_app_operation",
            false,
        ),
        (4, _) => {
            let reason =
                local_app_reason_from_proto(projection.reason_code).ok_or_else(untrusted)?;
            if !matches!(
                reason,
                LocalAppReasonCode::RuntimePermissionDenied
                    | LocalAppReasonCode::RuntimeUnauthenticated
                    | LocalAppReasonCode::ProcessReplaced
                    | LocalAppReasonCode::AccountChanged
                    | LocalAppReasonCode::Revoked
                    | LocalAppReasonCode::NoGrant
            ) {
                return Err(untrusted());
            }
            (
                LocalAppPermissionState::Denied,
                reason,
                "request_local_app_operation_grant",
                false,
            )
        }
        (5, ReasonCode::LocalAppPresenceExpired) => (
            LocalAppPermissionState::Revoked,
            LocalAppReasonCode::PresenceExpired,
            "request_local_app_operation_grant",
            false,
        ),
        (6, ReasonCode::LocalAppGrantRevoked) => (
            LocalAppPermissionState::Revoked,
            LocalAppReasonCode::GrantRevoked,
            "request_local_app_operation_grant",
            false,
        ),
        (7, ReasonCode::LocalAppGrantSuperseded) => (
            LocalAppPermissionState::Superseded,
            LocalAppReasonCode::GrantSuperseded,
            "refresh_local_app_permission_posture",
            false,
        ),
        _ => return Err(untrusted()),
    };
    Ok(LocalAppPermissionPosture {
        state,
        operation_id,
        resource_ref,
        reason_code,
        action_hint: action_hint.to_string(),
        retryable,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn projection(state: i32, reason_code: i32) -> LocalAppGrantProjection {
        LocalAppGrantProjection {
            state,
            operation_id: "runtime_agent.conversation.open".to_string(),
            resource_ref: "agent-a".to_string(),
            request_id: Vec::new(),
            grant_id: Vec::new(),
            presence_challenge_id: Vec::new(),
            grant_generation: 1,
            grant_revision: 1,
            expires_at: None,
            reason_code,
        }
    }

    fn project(
        state: i32,
        reason_code: i32,
    ) -> Result<LocalAppPermissionPosture, LocalAppOperationError> {
        project_permission_posture(
            projection(state, reason_code),
            "runtime_agent.conversation.open".to_string(),
            "agent-a".to_string(),
        )
    }

    #[test]
    fn denied_permission_request_preserves_the_runtime_projection_reason() {
        let denied = project(4, 655).expect("denied projection");
        let error = require_pending_permission(denied).expect_err("request must stay denied");
        assert_eq!(
            error.reason_code(),
            LocalAppReasonCode::RuntimePermissionDenied
        );
    }

    #[test]
    fn permission_projection_preserves_terminal_reason_matrix() {
        for (state, runtime_reason, expected) in [
            (4, 651, LocalAppReasonCode::NoGrant),
            (5, 657, LocalAppReasonCode::PresenceExpired),
            (6, 652, LocalAppReasonCode::GrantRevoked),
            (7, 653, LocalAppReasonCode::GrantSuperseded),
        ] {
            assert_eq!(
                project(state, runtime_reason)
                    .expect("terminal projection")
                    .reason_code,
                expected
            );
        }
        assert!(project(4, 652).is_err());
        assert!(project(6, 651).is_err());
    }

    #[test]
    fn permission_projection_preserves_exact_operation_binding() {
        let projection = project(1, 651).expect("zero-grant projection");
        assert_eq!(projection.state, LocalAppPermissionState::ZeroGrant);
        assert_eq!(projection.reason_code, LocalAppReasonCode::NoGrant);
    }
}
