use std::collections::HashSet;

use tonic::transport::Channel;

use crate::generated::runtime_account_service_client::RuntimeAccountServiceClient;
use crate::generated::{
    GetLocalAppPermissionStatusRequest, LocalAppPermissionPosture as ProtoPermissionPosture,
    LocalAppPermissionProjection, ReasonCode, RequestLocalAppPermissionRequest,
};
use crate::grpc_status::{local_app_error_from_status, local_app_reason_from_proto};
use crate::{
    LocalAppAgentHandle, LocalAppOperationError, LocalAppPermissionRequest,
    LocalAppPermissionState, LocalAppPermissionStatus, LocalAppPermissionStatusRequest,
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
        ProtoPermissionPosture::Revoked => LocalAppPermissionState::Revoked,
        ProtoPermissionPosture::Unavailable => LocalAppPermissionState::Unavailable,
        ProtoPermissionPosture::Unspecified => return Err(untrusted()),
    };
    let mut seen_agent_handles = HashSet::with_capacity(projection.agents.len());
    if projection.can_request != matches!(state, LocalAppPermissionState::Prompt)
        || (!matches!(state, LocalAppPermissionState::Granted) && !projection.agents.is_empty())
        || projection.agents.iter().any(|agent| {
            agent.agent_handle.trim() != agent.agent_handle
                || agent.agent_handle.is_empty()
                || agent.agent_handle.len() > 240
                || !seen_agent_handles.insert(agent.agent_handle.as_str())
                || agent.display_name.trim() != agent.display_name
                || agent.display_name.is_empty()
                || agent.display_name.len() > 240
        })
    {
        return Err(untrusted());
    }
    let runtime_reason = ReasonCode::try_from(projection.reason_code).map_err(|_| untrusted())?;
    let reason_code = local_app_reason_from_proto(runtime_reason as i32).ok_or_else(untrusted)?;
    Ok(LocalAppPermissionStatus {
        state,
        permission_id,
        can_request: projection.can_request,
        reason_code,
        agents: projection
            .agents
            .into_iter()
            .map(|agent| LocalAppAgentHandle {
                agent_handle: agent.agent_handle,
                display_name: agent.display_name,
            })
            .collect(),
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
            agents: Vec::new(),
        };
        let status = project_permission_status(projection, "agents.interact".to_string())
            .expect("reserved posture");
        assert_eq!(status.state, LocalAppPermissionState::Unavailable);
        assert!(!status.can_request);
    }

    #[test]
    fn revoked_permission_projects_as_a_distinct_public_state() {
        let projection = LocalAppPermissionProjection {
            permission_id: "agents.interact".to_string(),
            posture: ProtoPermissionPosture::Revoked as i32,
            can_request: false,
            reason_code: ReasonCode::LocalAppPermissionRevoked as i32,
            agents: Vec::new(),
        };
        let status = project_permission_status(projection, "agents.interact".to_string())
            .expect("revoked posture");
        assert_eq!(status.state, LocalAppPermissionState::Revoked);
        assert_eq!(
            status.reason_code,
            crate::LocalAppReasonCode::PermissionRevoked
        );
    }

    #[test]
    fn permission_projection_rejects_mismatched_product_id() {
        let projection = LocalAppPermissionProjection {
            permission_id: "artifacts.open".to_string(),
            posture: ProtoPermissionPosture::Unavailable as i32,
            can_request: false,
            reason_code: ReasonCode::LocalAppOperationUnavailable as i32,
            agents: Vec::new(),
        };
        assert!(project_permission_status(projection, "agents.interact".to_string()).is_err());
    }

    #[test]
    fn granted_permission_allows_an_empty_current_agent_scope() {
        let projection = LocalAppPermissionProjection {
            permission_id: "agents.interact".to_string(),
            posture: ProtoPermissionPosture::Granted as i32,
            can_request: false,
            reason_code: ReasonCode::ActionExecuted as i32,
            agents: Vec::new(),
        };
        let status = project_permission_status(projection, "agents.interact".to_string())
            .expect("granted account scope");
        assert_eq!(status.state, LocalAppPermissionState::Granted);
        assert!(status.agents.is_empty());
    }

    #[test]
    fn permission_projection_rejects_duplicate_agent_handles() {
        let agent = crate::generated::LocalAppPermissionAgentHandle {
            agent_handle: "lah_v1_opaque".to_string(),
            display_name: "Owned Agent".to_string(),
        };
        let projection = LocalAppPermissionProjection {
            permission_id: "agents.interact".to_string(),
            posture: ProtoPermissionPosture::Granted as i32,
            can_request: false,
            reason_code: ReasonCode::ActionExecuted as i32,
            agents: vec![agent.clone(), agent],
        };
        assert!(project_permission_status(projection, "agents.interact".to_string()).is_err());
    }
}
