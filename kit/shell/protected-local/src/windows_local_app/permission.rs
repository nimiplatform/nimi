use tonic::transport::Channel;

use crate::generated::runtime_account_service_client::RuntimeAccountServiceClient;
use crate::generated::{
    GetLocalAppPermissionStatusRequest, LocalAppPermissionPosture as ProtoPermissionPosture,
    LocalAppPermissionProjection, ReasonCode, RequestLocalAppPermissionRequest,
};
use crate::grpc_status::{local_app_error_from_status, local_app_reason_from_proto};
use crate::{
    LocalAppOperationError, LocalAppPermissionRequest, LocalAppPermissionState,
    LocalAppPermissionStatus, LocalAppPermissionStatusRequest,
};

use super::{require_text, untrusted};

pub(super) async fn local_app_permission_status(
    channel: Channel,
    request: LocalAppPermissionStatusRequest,
) -> Result<LocalAppPermissionStatus, LocalAppOperationError> {
    require_text(&request.permission_id)?;
    let response = RuntimeAccountServiceClient::new(channel)
        .get_local_app_permission_status(GetLocalAppPermissionStatusRequest {
            permission_id: request.permission_id.clone(),
        })
        .await
        .map_err(local_app_error_from_status)?
        .into_inner();
    project_permission_status(
        response.projection.ok_or_else(untrusted)?,
        request.permission_id,
    )
}

pub(super) async fn request_local_app_permission(
    channel: Channel,
    request: LocalAppPermissionRequest,
) -> Result<LocalAppPermissionStatus, LocalAppOperationError> {
    require_text(&request.permission_id)?;
    require_text(&request.reason)?;
    let response = RuntimeAccountServiceClient::new(channel)
        .request_local_app_permission(RequestLocalAppPermissionRequest {
            permission_id: request.permission_id.clone(),
            reason: request.reason,
        })
        .await
        .map_err(local_app_error_from_status)?
        .into_inner();
    project_permission_status(
        response.projection.ok_or_else(untrusted)?,
        request.permission_id,
    )
}

fn project_permission_status(
    projection: LocalAppPermissionProjection,
    permission_id: String,
) -> Result<LocalAppPermissionStatus, LocalAppOperationError> {
    if projection.permission_id != permission_id {
        return Err(untrusted());
    }
    let posture = ProtoPermissionPosture::try_from(projection.posture).map_err(|_| untrusted())?;
    let state = match posture {
        ProtoPermissionPosture::Prompt => LocalAppPermissionState::Prompt,
        ProtoPermissionPosture::Pending => LocalAppPermissionState::Pending,
        ProtoPermissionPosture::Granted => LocalAppPermissionState::Granted,
        ProtoPermissionPosture::Denied => LocalAppPermissionState::Denied,
        ProtoPermissionPosture::Unavailable => LocalAppPermissionState::Unavailable,
        ProtoPermissionPosture::Unspecified => return Err(untrusted()),
    };
    if projection.can_request != matches!(state, LocalAppPermissionState::Prompt) {
        return Err(untrusted());
    }
    let runtime_reason = ReasonCode::try_from(projection.reason_code).map_err(|_| untrusted())?;
    let reason_code = local_app_reason_from_proto(runtime_reason as i32).ok_or_else(untrusted)?;
    Ok(LocalAppPermissionStatus {
        state,
        permission_id,
        can_request: projection.can_request,
        reason_code,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reserved_permission_projects_as_unavailable_without_internal_selector() {
        let projection = LocalAppPermissionProjection {
            permission_id: "agents.interact".to_string(),
            posture: ProtoPermissionPosture::Unavailable as i32,
            can_request: false,
            reason_code: ReasonCode::LocalAppOperationUnavailable as i32,
        };
        let status = project_permission_status(projection, "agents.interact".to_string())
            .expect("reserved posture");
        assert_eq!(status.state, LocalAppPermissionState::Unavailable);
        assert!(!status.can_request);
    }

    #[test]
    fn permission_projection_rejects_mismatched_product_id() {
        let projection = LocalAppPermissionProjection {
            permission_id: "artifacts.open".to_string(),
            posture: ProtoPermissionPosture::Unavailable as i32,
            can_request: false,
            reason_code: ReasonCode::LocalAppOperationUnavailable as i32,
        };
        assert!(project_permission_status(projection, "agents.interact".to_string()).is_err());
    }
}
