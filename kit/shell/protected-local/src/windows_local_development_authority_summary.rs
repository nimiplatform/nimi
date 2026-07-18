use tonic::transport::Channel;

use crate::generated::runtime_development_service_client::RuntimeDevelopmentServiceClient;
use crate::generated::{
    GetLocalDevelopmentAuthoritySummaryRequest, GetLocalDevelopmentAuthoritySummaryResponse,
    LocalDevelopmentDeveloperModeSummary as ProtoDeveloperModeSummary,
    LocalDevelopmentProjectAuthorizationSummary as ProtoProjectAuthorizationSummary, ReasonCode,
};
use crate::grpc_status::host_error_from_status;
use crate::{
    DeveloperModeState, LocalDevelopmentAuthoritySummary, LocalDevelopmentDeveloperModeSummary,
    LocalDevelopmentProjectAuthorizationSummary, LocalDevelopmentSummaryAvailability,
    NimiHostError, NimiHostErrorReasonCode,
};

const ACTION_EXECUTED: i32 = 1;

pub(crate) async fn get_authority_summary(
    channel: Channel,
) -> Result<LocalDevelopmentAuthoritySummary, NimiHostError> {
    let response = RuntimeDevelopmentServiceClient::new(channel)
        .get_local_development_authority_summary(GetLocalDevelopmentAuthoritySummaryRequest {})
        .await
        .map_err(host_error_from_status)?
        .into_inner();
    authority_summary_projection(response)
}

fn authority_summary_projection(
    response: GetLocalDevelopmentAuthoritySummaryResponse,
) -> Result<LocalDevelopmentAuthoritySummary, NimiHostError> {
    require_success_reason(response.reason_code)?;
    Ok(LocalDevelopmentAuthoritySummary {
        developer_mode: developer_mode_summary_projection(
            response.developer_mode.ok_or_else(untrusted)?,
        )?,
        project_authorization: project_authorization_summary_projection(
            response.project_authorization.ok_or_else(untrusted)?,
        )?,
    })
}

fn developer_mode_summary_projection(
    summary: ProtoDeveloperModeSummary,
) -> Result<LocalDevelopmentDeveloperModeSummary, NimiHostError> {
    match summary.availability {
        1 if summary.reason_code == ACTION_EXECUTED && matches!(summary.state, 1 | 2) => {
            Ok(LocalDevelopmentDeveloperModeSummary {
                availability: LocalDevelopmentSummaryAvailability::Available,
                state: if summary.state == 1 {
                    DeveloperModeState::Disabled
                } else {
                    DeveloperModeState::Enabled
                },
                unavailable_reason: None,
            })
        }
        2 if summary.state == 3 && summary.reason_code != ACTION_EXECUTED => {
            Ok(LocalDevelopmentDeveloperModeSummary {
                availability: LocalDevelopmentSummaryAvailability::Unavailable,
                state: DeveloperModeState::Unavailable,
                unavailable_reason: Some(summary_unavailable_reason(summary.reason_code)?),
            })
        }
        _ => Err(untrusted()),
    }
}

fn project_authorization_summary_projection(
    summary: ProtoProjectAuthorizationSummary,
) -> Result<LocalDevelopmentProjectAuthorizationSummary, NimiHostError> {
    let counts = [
        summary.active_count,
        summary.dormant_count,
        summary.denied_count,
        summary.revoked_count,
    ];
    let (availability, unavailable_reason) = summary_availability(
        summary.availability,
        summary.reason_code,
        counts.iter().all(|count| *count == 0),
    )?;
    Ok(LocalDevelopmentProjectAuthorizationSummary {
        availability,
        active_count: summary.active_count,
        dormant_count: summary.dormant_count,
        denied_count: summary.denied_count,
        revoked_count: summary.revoked_count,
        unavailable_reason,
    })
}

fn summary_availability(
    availability: i32,
    reason_code: i32,
    counts_empty: bool,
) -> Result<
    (
        LocalDevelopmentSummaryAvailability,
        Option<NimiHostErrorReasonCode>,
    ),
    NimiHostError,
> {
    match availability {
        1 if reason_code == ACTION_EXECUTED => {
            Ok((LocalDevelopmentSummaryAvailability::Available, None))
        }
        2 if reason_code != ACTION_EXECUTED && counts_empty => Ok((
            LocalDevelopmentSummaryAvailability::Unavailable,
            Some(summary_unavailable_reason(reason_code)?),
        )),
        _ => Err(untrusted()),
    }
}

fn summary_unavailable_reason(reason_code: i32) -> Result<NimiHostErrorReasonCode, NimiHostError> {
    match ReasonCode::try_from(reason_code).map_err(|_| untrusted())? {
        ReasonCode::PrincipalUnauthorized => Ok(NimiHostErrorReasonCode::PrincipalUnauthorized),
        ReasonCode::LocalAppOperationUnavailable => {
            Ok(NimiHostErrorReasonCode::LocalAppOperationUnavailable)
        }
        _ => Err(untrusted()),
    }
}

fn require_success_reason(reason_code: i32) -> Result<(), NimiHostError> {
    (reason_code == ACTION_EXECUTED)
        .then_some(())
        .ok_or_else(untrusted)
}

fn untrusted() -> NimiHostError {
    NimiHostError::new(NimiHostErrorReasonCode::RuntimeServiceUntrusted, false)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn valid_response() -> GetLocalDevelopmentAuthoritySummaryResponse {
        GetLocalDevelopmentAuthoritySummaryResponse {
            developer_mode: Some(ProtoDeveloperModeSummary {
                availability: 1,
                state: 2,
                reason_code: ACTION_EXECUTED,
            }),
            project_authorization: Some(ProtoProjectAuthorizationSummary {
                availability: 1,
                active_count: 2,
                dormant_count: 1,
                denied_count: 0,
                revoked_count: 3,
                reason_code: ACTION_EXECUTED,
            }),
            reason_code: ACTION_EXECUTED,
        }
    }

    #[test]
    fn accepts_only_closed_identifier_free_summary_sections() {
        let projection = authority_summary_projection(valid_response()).expect("valid summary");
        assert_eq!(
            projection.developer_mode.availability,
            LocalDevelopmentSummaryAvailability::Available
        );
        assert_eq!(projection.project_authorization.active_count, 2);
    }

    #[test]
    fn unavailable_sections_require_zero_counts_and_a_known_failure_reason() {
        let mut response = valid_response();
        response.project_authorization = Some(ProtoProjectAuthorizationSummary {
            availability: 2,
            reason_code: ReasonCode::PrincipalUnauthorized as i32,
            ..Default::default()
        });
        let projection =
            authority_summary_projection(response.clone()).expect("unavailable section");
        assert_eq!(
            projection.project_authorization.unavailable_reason,
            Some(NimiHostErrorReasonCode::PrincipalUnauthorized)
        );

        response
            .project_authorization
            .as_mut()
            .expect("section")
            .active_count = 1;
        assert!(authority_summary_projection(response).is_err());
    }

    #[test]
    fn rejects_missing_sections_and_action_reason_on_unavailable_state() {
        let mut malformed = valid_response();
        malformed.developer_mode = Some(ProtoDeveloperModeSummary {
            availability: 2,
            state: 3,
            reason_code: ACTION_EXECUTED,
        });
        assert!(authority_summary_projection(malformed).is_err());
    }
}
