use std::time::{SystemTime, UNIX_EPOCH};

use prost_types::Timestamp;
use tonic::transport::Channel;

use crate::generated::runtime_account_service_client::RuntimeAccountServiceClient;
use crate::generated::{
    DecideLocalAppGrantRequest, GetLocalAppGrantStatusRequest, LocalAppGrantProjection, ReasonCode,
    RevokeLocalAppGrantRequest,
};
use crate::grpc_status::host_error_from_status;
use crate::windows_presence_browser_broker::PresenceBrowserBroker;
use crate::{
    LocalAppGrantControlDecisionRequest, LocalAppGrantControlPending,
    LocalAppGrantControlProjection, LocalAppGrantControlState, NimiHostError,
    NimiHostErrorReasonCode,
};

pub(crate) async fn pending_grant(
    channel: Channel,
) -> Result<Option<LocalAppGrantControlPending>, NimiHostError> {
    let response = RuntimeAccountServiceClient::new(channel)
        .get_local_app_grant_status(GetLocalAppGrantStatusRequest {
            operation_id: String::new(),
            resource_ref: String::new(),
        })
        .await
        .map_err(host_error_from_status)?
        .into_inner();
    project_pending_grant(response.projection.ok_or_else(untrusted)?)
}

pub(crate) async fn decide_grant(
    channel: Channel,
    request: LocalAppGrantControlDecisionRequest,
) -> Result<LocalAppGrantControlProjection, NimiHostError> {
    validate_identifier(request.request_id)?;
    validate_identifier(request.presence_challenge_id)?;
    let mut rpc = tonic::Request::new(DecideLocalAppGrantRequest {
        request_id: request.request_id.to_vec(),
        approved: request.approved,
        presence_challenge_id: request.presence_challenge_id.to_vec(),
    });
    let broker = bind_grant_presence_broker(request.approved, &mut rpc).await?;
    let response = RuntimeAccountServiceClient::new(channel)
        .decide_local_app_grant(rpc)
        .await;
    if let Some(broker) = broker {
        broker.finish().await;
    }
    let response = response.map_err(host_error_from_status)?.into_inner();
    project_decided_grant(response.projection.ok_or_else(untrusted)?, request.approved)
}

async fn bind_grant_presence_broker<T>(
    approved: bool,
    request: &mut tonic::Request<T>,
) -> Result<Option<PresenceBrowserBroker>, NimiHostError> {
    if !approved {
        return Ok(None);
    }
    let broker = PresenceBrowserBroker::start().await?;
    broker.bind(request)?;
    Ok(Some(broker))
}

pub(crate) async fn revoke_grant(
    channel: Channel,
    grant_id: [u8; 32],
) -> Result<LocalAppGrantControlProjection, NimiHostError> {
    validate_identifier(grant_id)?;
    let response = RuntimeAccountServiceClient::new(channel)
        .revoke_local_app_grant(RevokeLocalAppGrantRequest {
            grant_id: grant_id.to_vec(),
        })
        .await
        .map_err(host_error_from_status)?
        .into_inner();
    project_revoked_grant(response.projection.ok_or_else(untrusted)?, grant_id)
}

fn project_pending_grant(
    projection: LocalAppGrantProjection,
) -> Result<Option<LocalAppGrantControlPending>, NimiHostError> {
    if projection.state == 1 {
        if reason(projection.reason_code)? == ReasonCode::LocalAppGrantRequired
            && projection.operation_id.is_empty()
            && projection.resource_ref.is_empty()
            && projection.request_id.is_empty()
            && projection.presence_challenge_id.is_empty()
            && projection.grant_id.is_empty()
            && projection.grant_generation == 0
            && projection.grant_revision == 0
            && projection.expires_at.is_none()
        {
            return Ok(None);
        }
        return Err(untrusted());
    }
    if projection.state != 2
        || reason(projection.reason_code)? != ReasonCode::LocalAppPresenceRequired
        || projection.grant_generation == 0
        || projection.grant_revision == 0
    {
        return Err(reason_error(projection.reason_code));
    }
    let expires_at_unix_ms = required_future_timestamp(projection.expires_at)?;
    Ok(Some(LocalAppGrantControlPending {
        request_id: identifier(projection.request_id)?,
        presence_challenge_id: identifier(projection.presence_challenge_id)?,
        pending_grant_id: identifier(projection.grant_id)?,
        operation_id: required_text(projection.operation_id)?,
        resource_ref: required_text(projection.resource_ref)?,
        expires_at_unix_ms,
    }))
}

fn project_decided_grant(
    projection: LocalAppGrantProjection,
    approved: bool,
) -> Result<LocalAppGrantControlProjection, NimiHostError> {
    let expected_state = if approved { 3 } else { 4 };
    let expected_reason = if approved {
        ReasonCode::ActionExecuted
    } else {
        ReasonCode::LocalAppGrantRequired
    };
    if projection.state != expected_state
        || reason(projection.reason_code)? != expected_reason
        || projection.grant_generation == 0
        || projection.grant_revision == 0
        || !projection.request_id.is_empty()
        || !projection.presence_challenge_id.is_empty()
    {
        return Err(reason_error(projection.reason_code));
    }
    Ok(LocalAppGrantControlProjection {
        state: if approved {
            LocalAppGrantControlState::Granted
        } else {
            LocalAppGrantControlState::Denied
        },
        grant_id: identifier(projection.grant_id)?,
        operation_id: required_text(projection.operation_id)?,
        resource_ref: required_text(projection.resource_ref)?,
    })
}

fn project_revoked_grant(
    projection: LocalAppGrantProjection,
    expected_grant_id: [u8; 32],
) -> Result<LocalAppGrantControlProjection, NimiHostError> {
    if projection.state != 6
        || reason(projection.reason_code)? != ReasonCode::LocalAppGrantRevoked
        || projection.grant_generation == 0
        || projection.grant_revision == 0
        || !projection.operation_id.is_empty()
        || !projection.request_id.is_empty()
        || !projection.presence_challenge_id.is_empty()
        || identifier(projection.grant_id.clone())? != expected_grant_id
    {
        return Err(reason_error(projection.reason_code));
    }
    Ok(LocalAppGrantControlProjection {
        state: LocalAppGrantControlState::Revoked,
        grant_id: expected_grant_id,
        operation_id: projection.operation_id,
        resource_ref: required_text(projection.resource_ref)?,
    })
}

fn identifier(value: Vec<u8>) -> Result<[u8; 32], NimiHostError> {
    let value: [u8; 32] = value.try_into().map_err(|_| untrusted())?;
    validate_identifier(value)?;
    Ok(value)
}

fn validate_identifier(value: [u8; 32]) -> Result<(), NimiHostError> {
    if value == [0u8; 32] {
        return Err(untrusted());
    }
    Ok(())
}

fn required_text(value: String) -> Result<String, NimiHostError> {
    if value.is_empty() || value.trim() != value || value.len() > 512 {
        return Err(untrusted());
    }
    Ok(value)
}

fn required_future_timestamp(value: Option<Timestamp>) -> Result<i64, NimiHostError> {
    let value = value.ok_or_else(untrusted)?;
    if value.seconds < 0 || !(0..1_000_000_000).contains(&value.nanos) {
        return Err(untrusted());
    }
    let millis = value
        .seconds
        .checked_mul(1_000)
        .and_then(|seconds| seconds.checked_add(i64::from(value.nanos / 1_000_000)))
        .ok_or_else(untrusted)?;
    let now: i64 = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| untrusted())?
        .as_millis()
        .try_into()
        .map_err(|_| untrusted())?;
    if millis <= now {
        return Err(NimiHostError::new(
            NimiHostErrorReasonCode::LocalAppPresenceExpired,
            false,
        ));
    }
    Ok(millis)
}

fn reason(value: i32) -> Result<ReasonCode, NimiHostError> {
    ReasonCode::try_from(value).map_err(|_| untrusted())
}

fn reason_error(value: i32) -> NimiHostError {
    let code = match ReasonCode::try_from(value).ok() {
        Some(ReasonCode::LocalAppGrantRequired) => NimiHostErrorReasonCode::LocalAppGrantRequired,
        Some(ReasonCode::LocalAppGrantRevoked) => NimiHostErrorReasonCode::LocalAppGrantRevoked,
        Some(ReasonCode::LocalAppGrantSuperseded) => {
            NimiHostErrorReasonCode::LocalAppGrantSuperseded
        }
        Some(ReasonCode::LocalAppPresenceRequired) => {
            NimiHostErrorReasonCode::LocalAppPresenceRequired
        }
        Some(ReasonCode::LocalAppPresenceExpired) => {
            NimiHostErrorReasonCode::LocalAppPresenceExpired
        }
        Some(ReasonCode::LocalAppOperationUnavailable) => {
            NimiHostErrorReasonCode::LocalAppOperationUnavailable
        }
        Some(ReasonCode::PrincipalUnauthorized) => NimiHostErrorReasonCode::PrincipalUnauthorized,
        _ => NimiHostErrorReasonCode::RuntimeServiceUntrusted,
    };
    NimiHostError::new(code, false)
}

fn untrusted() -> NimiHostError {
    NimiHostError::new(NimiHostErrorReasonCode::RuntimeServiceUntrusted, false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn approved_grant_binds_fresh_presence_browser_broker() {
        let mut request = tonic::Request::new(());
        let broker = bind_grant_presence_broker(true, &mut request)
            .await
            .expect("approved presence broker")
            .expect("approved decision must bind a broker");
        assert!(request
            .metadata()
            .get("x-nimi-presence-browser-launcher")
            .is_some());
        broker.finish().await;
    }

    #[test]
    fn grant_control_projection_rejects_malformed_state_and_identity_combinations() {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time")
            .as_secs() as i64;
        let pending = LocalAppGrantProjection {
            state: 2,
            operation_id: "runtime_agent.conversation.open".to_string(),
            resource_ref: "agent:agent-a".to_string(),
            request_id: vec![0x11; 32],
            grant_id: vec![0x22; 32],
            grant_generation: 1,
            grant_revision: 1,
            expires_at: Some(Timestamp {
                seconds: now + 60,
                nanos: 0,
            }),
            reason_code: ReasonCode::LocalAppPresenceRequired as i32,
            presence_challenge_id: vec![0x33; 32],
        };
        assert!(project_pending_grant(pending.clone())
            .expect("valid pending projection")
            .is_some());
        for malformed in [
            LocalAppGrantProjection {
                reason_code: ReasonCode::ActionExecuted as i32,
                ..pending.clone()
            },
            LocalAppGrantProjection {
                request_id: vec![0x11; 31],
                ..pending.clone()
            },
            LocalAppGrantProjection {
                grant_generation: 0,
                ..pending.clone()
            },
            LocalAppGrantProjection {
                expires_at: None,
                ..pending.clone()
            },
        ] {
            assert!(project_pending_grant(malformed).is_err());
        }

        let no_grant = LocalAppGrantProjection {
            state: 1,
            reason_code: ReasonCode::LocalAppGrantRequired as i32,
            ..Default::default()
        };
        assert!(project_pending_grant(no_grant.clone())
            .expect("valid zero grant")
            .is_none());
        assert!(project_pending_grant(LocalAppGrantProjection {
            reason_code: ReasonCode::ActionExecuted as i32,
            ..no_grant
        })
        .is_err());

        let granted = LocalAppGrantProjection {
            state: 3,
            operation_id: "runtime_agent.conversation.open".to_string(),
            resource_ref: "agent:agent-a".to_string(),
            grant_id: vec![0x22; 32],
            grant_generation: 1,
            grant_revision: 2,
            reason_code: ReasonCode::ActionExecuted as i32,
            ..Default::default()
        };
        assert!(project_decided_grant(granted.clone(), true).is_ok());
        assert!(project_decided_grant(
            LocalAppGrantProjection {
                request_id: vec![0x11; 32],
                ..granted
            },
            true
        )
        .is_err());

        let revoked = LocalAppGrantProjection {
            state: 6,
            operation_id: String::new(),
            resource_ref: "agent:agent-a".to_string(),
            grant_id: vec![0x22; 32],
            grant_generation: 1,
            grant_revision: 3,
            reason_code: ReasonCode::LocalAppGrantRevoked as i32,
            ..Default::default()
        };
        assert!(project_revoked_grant(revoked.clone(), [0x22; 32]).is_ok());
        assert!(project_revoked_grant(revoked.clone(), [0x44; 32]).is_err());
        assert!(project_revoked_grant(
            LocalAppGrantProjection {
                operation_id: "runtime_agent.conversation.open".to_string(),
                ..revoked
            },
            [0x22; 32]
        )
        .is_err());
    }

    #[tokio::test]
    async fn denied_grant_does_not_open_presence_browser_broker() {
        let mut request = tonic::Request::new(());
        assert!(bind_grant_presence_broker(false, &mut request)
            .await
            .expect("denied decision")
            .is_none());
        assert!(request
            .metadata()
            .get("x-nimi-presence-browser-launcher")
            .is_none());
    }
}
