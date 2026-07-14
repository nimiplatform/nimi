use std::time::{SystemTime, UNIX_EPOCH};

use prost_types::Timestamp;
use tonic::transport::Channel;

use crate::generated::runtime_account_service_client::RuntimeAccountServiceClient;
use crate::generated::{
    DecideLocalAppGrantRequest, GetLocalAppGrantStatusRequest, ReasonCode,
    RevokeLocalAppGrantRequest,
};
use crate::grpc_status::host_error_from_status;
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
    let projection = response.projection.ok_or_else(untrusted)?;
    if projection.state == 1 {
        if projection.operation_id.is_empty()
            && projection.resource_ref.is_empty()
            && projection.request_id.is_empty()
            && projection.presence_challenge_id.is_empty()
            && projection.grant_id.is_empty()
        {
            return Ok(None);
        }
        return Err(untrusted());
    }
    if projection.state != 2
        || reason(projection.reason_code)? != ReasonCode::LocalAppPresenceRequired
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

pub(crate) async fn decide_grant(
    channel: Channel,
    request: LocalAppGrantControlDecisionRequest,
) -> Result<LocalAppGrantControlProjection, NimiHostError> {
    validate_identifier(request.request_id)?;
    validate_identifier(request.presence_challenge_id)?;
    let response = RuntimeAccountServiceClient::new(channel)
        .decide_local_app_grant(DecideLocalAppGrantRequest {
            request_id: request.request_id.to_vec(),
            approved: request.approved,
            presence_challenge_id: request.presence_challenge_id.to_vec(),
        })
        .await
        .map_err(host_error_from_status)?
        .into_inner();
    let projection = response.projection.ok_or_else(untrusted)?;
    let expected_state = if request.approved { 3 } else { 4 };
    let expected_reason = if request.approved {
        ReasonCode::ActionExecuted
    } else {
        ReasonCode::LocalAppGrantRequired
    };
    if projection.state != expected_state || reason(projection.reason_code)? != expected_reason {
        return Err(reason_error(projection.reason_code));
    }
    Ok(LocalAppGrantControlProjection {
        state: if request.approved {
            LocalAppGrantControlState::Granted
        } else {
            LocalAppGrantControlState::Denied
        },
        grant_id: identifier(projection.grant_id)?,
        operation_id: required_text(projection.operation_id)?,
        resource_ref: required_text(projection.resource_ref)?,
    })
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
    let projection = response.projection.ok_or_else(untrusted)?;
    if projection.state != 6
        || reason(projection.reason_code)? != ReasonCode::LocalAppGrantRevoked
        || identifier(projection.grant_id.clone())? != grant_id
    {
        return Err(reason_error(projection.reason_code));
    }
    Ok(LocalAppGrantControlProjection {
        state: LocalAppGrantControlState::Revoked,
        grant_id,
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
