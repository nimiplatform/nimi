use std::collections::HashSet;

use tonic::{transport::Channel, Request};
use url::Url;

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
    require_text(&request.request_id)?;
    let mut runtime_request = Request::new(RequestLocalAppPermissionRequest {
        permission_id: request.permission_id.clone(),
        reason: request.reason,
    });
    runtime_request.metadata_mut().insert(
        "x-nimi-trace-id",
        request.request_id.parse().map_err(|_| untrusted())?,
    );
    let response = RuntimeAccountServiceClient::new(channel)
        .request_local_app_permission(runtime_request)
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
                || !stable_avatar_url_or_empty(&agent.avatar_url)
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
                avatar_url: if agent.avatar_url.is_empty() {
                    None
                } else {
                    Some(agent.avatar_url)
                },
            })
            .collect(),
    })
}

fn stable_avatar_url_or_empty(value: &str) -> bool {
    if value.is_empty() {
        return true;
    }
    if value.trim() != value || value.len() > 4096 {
        return false;
    }
    let Ok(parsed) = Url::parse(value) else {
        return false;
    };
    parsed.scheme() == "https"
        && parsed.host_str().is_some()
        && parsed.username().is_empty()
        && parsed.password().is_none()
        && parsed.fragment().is_none()
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
    fn reserved_revoked_wire_value_is_rejected() {
        let projection = LocalAppPermissionProjection {
            permission_id: "agents.interact".to_string(),
            posture: 6,
            can_request: false,
            reason_code: ReasonCode::LocalAppPermissionRevoked as i32,
            agents: Vec::new(),
        };
        assert!(project_permission_status(projection, "agents.interact".to_string()).is_err());
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
            avatar_url: String::new(),
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

    #[test]
    fn permission_projection_projects_only_stable_https_avatar_urls() {
        let projection = LocalAppPermissionProjection {
            permission_id: "agents.interact".to_string(),
            posture: ProtoPermissionPosture::Granted as i32,
            can_request: false,
            reason_code: ReasonCode::ActionExecuted as i32,
            agents: vec![crate::generated::LocalAppPermissionAgentHandle {
                agent_handle: "lah_v1_opaque".to_string(),
                display_name: "Owned Agent".to_string(),
                avatar_url: "https://assets.example.test/owned-agent.png".to_string(),
            }],
        };
        let status = project_permission_status(projection, "agents.interact".to_string())
            .expect("stable HTTPS avatar URL");
        assert_eq!(
            status.agents[0].avatar_url.as_deref(),
            Some("https://assets.example.test/owned-agent.png")
        );

        let projection = LocalAppPermissionProjection {
            permission_id: "agents.interact".to_string(),
            posture: ProtoPermissionPosture::Granted as i32,
            can_request: false,
            reason_code: ReasonCode::ActionExecuted as i32,
            agents: vec![crate::generated::LocalAppPermissionAgentHandle {
                agent_handle: "lah_v1_opaque".to_string(),
                display_name: "Owned Agent".to_string(),
                avatar_url: "http://assets.example.test/owned-agent.png".to_string(),
            }],
        };
        assert!(project_permission_status(projection, "agents.interact".to_string()).is_err());
    }
}
