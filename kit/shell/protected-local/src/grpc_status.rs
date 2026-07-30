use crate::{LocalAppOperationError, LocalAppReasonCode, NimiHostError, NimiHostErrorReasonCode};
use prost::Message;
use std::collections::{BTreeMap, HashMap};
use tonic::{Code, Status};

const ERROR_INFO_TYPE_URL: &str = "type.googleapis.com/google.rpc.ErrorInfo";
const ERROR_INFO_DOMAIN: &str = "nimi.runtime.v1";
pub(crate) const RUNTIME_SERVICE_ERROR_UNCLASSIFIED: &str = "runtime-service-error-unclassified";

#[derive(Clone, PartialEq, Message)]
struct GoogleRpcStatus {
    #[prost(int32, tag = "1")]
    code: i32,
    #[prost(string, tag = "2")]
    message: String,
    #[prost(message, repeated, tag = "3")]
    details: Vec<prost_types::Any>,
}

#[derive(Clone, PartialEq, Message)]
struct GoogleRpcErrorInfo {
    #[prost(string, tag = "1")]
    reason: String,
    #[prost(string, tag = "2")]
    domain: String,
    #[prost(map = "string, string", tag = "3")]
    metadata: HashMap<String, String>,
}

pub(crate) fn runtime_reason(status: &Status) -> Option<String> {
    runtime_error_info(status).map(|info| info.reason)
}

pub(crate) fn bundled_avatar_runtime_reason(status: &Status) -> Option<String> {
    runtime_reason(status).or_else(|| match status.code() {
        Code::NotFound => Some("RUNTIME_GRPC_NOT_FOUND".to_string()),
        _ => None,
    })
}

pub(crate) fn unclassified_status_metadata(status: &Status) -> BTreeMap<String, String> {
    BTreeMap::from([(
        "grpc_status_code".to_string(),
        (status.code() as i32).to_string(),
    )])
}

fn runtime_error_info(status: &Status) -> Option<GoogleRpcErrorInfo> {
    let details = GoogleRpcStatus::decode(status.details()).ok()?;
    details.details.iter().find_map(|detail| {
        if detail.type_url != ERROR_INFO_TYPE_URL {
            return None;
        }
        let info = GoogleRpcErrorInfo::decode(detail.value.as_slice()).ok()?;
        (info.domain == ERROR_INFO_DOMAIN && !info.reason.is_empty()).then_some(info)
    })
}

pub(crate) fn host_error_from_status(status: Status) -> NimiHostError {
    let info = runtime_error_info(&status);
    let mapped_reason = info
        .as_ref()
        .and_then(|value| host_reason_from_runtime_reason(&value.reason));
    let unclassified = mapped_reason.is_none()
        && !matches!(
            status.code(),
            Code::Unavailable | Code::DeadlineExceeded | Code::Cancelled
        );
    let reason = mapped_reason.unwrap_or_else(|| match status.code() {
        Code::Unavailable | Code::DeadlineExceeded | Code::Cancelled => {
            NimiHostErrorReasonCode::RuntimeServiceUnavailable
        }
        _ => NimiHostErrorReasonCode::RuntimeServiceErrorUnclassified,
    });
    let (permission_id, mut metadata) = public_reason_metadata(info.as_ref());
    if unclassified {
        metadata.extend(unclassified_status_metadata(&status));
    }
    NimiHostError::new(reason, status_is_retryable(status.code()))
        .with_reason_metadata(permission_id, metadata)
}

pub(crate) fn local_app_error_from_status(status: Status) -> LocalAppOperationError {
    let info = runtime_error_info(&status);
    let mapped_reason = info
        .as_ref()
        .and_then(|value| local_app_reason_from_runtime_reason(&value.reason));
    let fallback_reason = match status.code() {
        Code::InvalidArgument => LocalAppReasonCode::InvalidPayload,
        Code::Unauthenticated => LocalAppReasonCode::RuntimeUnauthenticated,
        Code::PermissionDenied => LocalAppReasonCode::RuntimePermissionDenied,
        Code::NotFound => LocalAppReasonCode::NotFound,
        Code::ResourceExhausted => LocalAppReasonCode::ResourceExhausted,
        Code::Unavailable | Code::DeadlineExceeded | Code::Cancelled => {
            LocalAppReasonCode::RuntimeServiceUnavailable
        }
        _ => LocalAppReasonCode::RuntimeServiceErrorUnclassified,
    };
    let unclassified = mapped_reason.is_none()
        && fallback_reason == LocalAppReasonCode::RuntimeServiceErrorUnclassified;
    let reason = mapped_reason.unwrap_or(fallback_reason);
    let (permission_id, mut metadata) = public_reason_metadata(info.as_ref());
    if unclassified {
        metadata.extend(unclassified_status_metadata(&status));
    }
    LocalAppOperationError::new(reason, status_is_retryable(status.code()))
        .with_reason_metadata(permission_id, metadata)
}

pub(crate) fn local_app_reason_from_proto(value: i32) -> Option<LocalAppReasonCode> {
    Some(match value {
        1 => LocalAppReasonCode::ActionExecuted,
        633 => LocalAppReasonCode::RuntimeRestarted,
        642 | 643 | 644 | 645 | 656 | 658 | 659 | 660 => {
            LocalAppReasonCode::RuntimePermissionDenied
        }
        655 => LocalAppReasonCode::OperationUnavailable,
        646..=648 => LocalAppReasonCode::RuntimeUnauthenticated,
        649 => LocalAppReasonCode::ProcessReplaced,
        650 => LocalAppReasonCode::Revoked,
        651 => LocalAppReasonCode::PermissionRequired,
        652 => LocalAppReasonCode::PermissionDenied,
        653 => LocalAppReasonCode::PermissionRevoked,
        654 => LocalAppReasonCode::AccountChanged,
        657 => LocalAppReasonCode::PresenceExpired,
        668 => LocalAppReasonCode::PermissionReservedNotAdmitted,
        669 => LocalAppReasonCode::PermissionUnknown,
        670 => LocalAppReasonCode::AgentAiConfigRevisionConflict,
        671 => LocalAppReasonCode::AgentAutonomyRevisionConflict,
        614 => LocalAppReasonCode::AgentPresentationRevisionConflict,
        566 => LocalAppReasonCode::InvalidPath,
        567 => LocalAppReasonCode::NotFound,
        568 => LocalAppReasonCode::ResourceExhausted,
        569 => LocalAppReasonCode::RuntimeServiceUnavailable,
        300 => LocalAppReasonCode::RuntimeUnauthenticated,
        503 => LocalAppReasonCode::RuntimePermissionDenied,
        661 => LocalAppReasonCode::RuntimeServiceUnavailable,
        662 => LocalAppReasonCode::NotFound,
        663 | 665 => LocalAppReasonCode::InvalidPayload,
        664 => LocalAppReasonCode::ResourceExhausted,
        666 => LocalAppReasonCode::RuntimeServiceUntrusted,
        667 => LocalAppReasonCode::RuntimeServiceUnavailable,
        _ => return None,
    })
}

fn local_app_reason_from_runtime_reason(value: &str) -> Option<LocalAppReasonCode> {
    Some(match value {
        "ACTION_EXECUTED" => LocalAppReasonCode::ActionExecuted,
        "PROTECTED_LOCAL_BOOT_EPOCH_MISMATCH" => LocalAppReasonCode::RuntimeRestarted,
        "PROTECTED_LOCAL_RUNTIME_PRINCIPAL_REQUIRED"
        | "PROTECTED_ORIGIN_ROLE_MISMATCH"
        | "LOCAL_APP_LAUNCH_LEASE_REQUIRED"
        | "LOCAL_APP_LAUNCH_LEASE_MISMATCH"
        | "LOCAL_APP_LAUNCH_LEASE_REPLAY" => LocalAppReasonCode::RuntimeUnauthenticated,
        "LOCAL_APP_PROCESS_MISMATCH" => LocalAppReasonCode::ProcessReplaced,
        "LOCAL_APP_ACCOUNT_CHANGED" => LocalAppReasonCode::AccountChanged,
        "LOCAL_APP_SESSION_REVOKED" => LocalAppReasonCode::Revoked,
        "LOCAL_APP_PERMISSION_REQUIRED" => LocalAppReasonCode::PermissionRequired,
        "LOCAL_APP_PERMISSION_DENIED" => LocalAppReasonCode::PermissionDenied,
        "LOCAL_APP_PERMISSION_REVOKED" => LocalAppReasonCode::PermissionRevoked,
        "LOCAL_APP_PERMISSION_RESERVED_NOT_ADMITTED" => {
            LocalAppReasonCode::PermissionReservedNotAdmitted
        }
        "LOCAL_APP_PERMISSION_UNKNOWN" => LocalAppReasonCode::PermissionUnknown,
        "AGENT_AI_CONFIG_REVISION_CONFLICT" => LocalAppReasonCode::AgentAiConfigRevisionConflict,
        "AGENT_AUTONOMY_REVISION_CONFLICT" => LocalAppReasonCode::AgentAutonomyRevisionConflict,
        "AGENT_PRESENTATION_REVISION_CONFLICT" => {
            LocalAppReasonCode::AgentPresentationRevisionConflict
        }
        "LOCAL_APP_PRESENCE_EXPIRED" => LocalAppReasonCode::PresenceExpired,
        "PROTOCOL_ENVELOPE_INVALID" => LocalAppReasonCode::InvalidPayload,
        "APP_STORAGE_PATH_INVALID" => LocalAppReasonCode::InvalidPath,
        "APP_STORAGE_ENTRY_NOT_FOUND" => LocalAppReasonCode::NotFound,
        "APP_STORAGE_QUOTA_EXCEEDED" => LocalAppReasonCode::ResourceExhausted,
        "APP_STORAGE_UNAVAILABLE" => LocalAppReasonCode::RuntimeServiceUnavailable,
        "ARTIFACT_NOT_FOUND" => LocalAppReasonCode::NotFound,
        "RESOURCE_EXHAUSTED" | "ARTIFACT_TOO_LARGE" => LocalAppReasonCode::ResourceExhausted,
        "PROTECTED_LOCAL_TRANSPORT_UNSUPPORTED" | "PROTECTED_LOCAL_LEDGER_UNAVAILABLE" => {
            LocalAppReasonCode::RuntimeServiceUnavailable
        }
        "LOCAL_APP_OPERATION_UNAVAILABLE" => LocalAppReasonCode::OperationUnavailable,
        "LOCAL_APP_RECORD_NOT_FOUND"
        | "LOCAL_APP_RECORD_TOMBSTONED"
        | "LOCAL_APP_PROVENANCE_UNAVAILABLE"
        | "LOCAL_APP_PRESENCE_REQUIRED"
        | "LOCAL_APP_DEVELOPER_MODE_DISABLED"
        | "LOCAL_APP_RISK_DISCLOSURE_REQUIRED"
        | "PRINCIPAL_UNAUTHORIZED" => LocalAppReasonCode::RuntimePermissionDenied,
        _ => return None,
    })
}

fn host_reason_from_runtime_reason(value: &str) -> Option<NimiHostErrorReasonCode> {
    Some(match value {
        "PRINCIPAL_UNAUTHORIZED" | "AUTH_TOKEN_INVALID" => {
            NimiHostErrorReasonCode::PrincipalUnauthorized
        }
        "PROTECTED_LOCAL_BOOT_EPOCH_MISMATCH" => NimiHostErrorReasonCode::RuntimeRestarted,
        "LOCAL_APP_PRINCIPAL_REQUIRED"
        | "LOCAL_APP_RECORD_NOT_FOUND"
        | "LOCAL_APP_RECORD_TOMBSTONED"
        | "LOCAL_APP_RISK_DISCLOSURE_REQUIRED" => {
            NimiHostErrorReasonCode::LocalDevelopmentAuthorizationRequired
        }
        "LOCAL_APP_ACCOUNT_CHANGED" => NimiHostErrorReasonCode::LocalDevelopmentReapprovalRequired,
        "LOCAL_APP_PROVENANCE_UNAVAILABLE" => {
            NimiHostErrorReasonCode::LocalDevelopmentProjectChanged
        }
        "LOCAL_APP_LAUNCH_LEASE_REQUIRED"
        | "LOCAL_APP_LAUNCH_LEASE_MISMATCH"
        | "LOCAL_APP_LAUNCH_LEASE_REPLAY"
        | "LOCAL_APP_PROCESS_MISMATCH" => {
            NimiHostErrorReasonCode::LocalDevelopmentSupervisorRequired
        }
        "LOCAL_APP_SESSION_REVOKED" => NimiHostErrorReasonCode::LocalDevelopmentSessionRevoked,
        "LOCAL_APP_PERMISSION_REQUIRED" => NimiHostErrorReasonCode::LocalAppPermissionRequired,
        "LOCAL_APP_PERMISSION_DENIED" => NimiHostErrorReasonCode::LocalAppPermissionDenied,
        "LOCAL_APP_PERMISSION_REVOKED" => NimiHostErrorReasonCode::LocalAppPermissionRevoked,
        "LOCAL_APP_PERMISSION_RESERVED_NOT_ADMITTED" => {
            NimiHostErrorReasonCode::LocalAppPermissionReservedNotAdmitted
        }
        "LOCAL_APP_PERMISSION_UNKNOWN" => NimiHostErrorReasonCode::LocalAppPermissionUnknown,
        "AGENT_AI_CONFIG_REVISION_CONFLICT" => {
            NimiHostErrorReasonCode::AgentAiConfigRevisionConflict
        }
        "AGENT_AUTONOMY_REVISION_CONFLICT" => {
            NimiHostErrorReasonCode::AgentAutonomyRevisionConflict
        }
        "AGENT_PRESENTATION_REVISION_CONFLICT" => {
            NimiHostErrorReasonCode::AgentPresentationRevisionConflict
        }
        "LOCAL_APP_PRESENCE_REQUIRED" => NimiHostErrorReasonCode::LocalAppPresenceRequired,
        "LOCAL_APP_PRESENCE_EXPIRED" => NimiHostErrorReasonCode::LocalAppPresenceExpired,
        "LOCAL_APP_DEVELOPER_MODE_DISABLED" => {
            NimiHostErrorReasonCode::LocalAppDeveloperModeDisabled
        }
        "LOCAL_APP_OPERATION_UNAVAILABLE" => NimiHostErrorReasonCode::LocalAppOperationUnavailable,
        "PROTECTED_LOCAL_TRANSPORT_UNSUPPORTED" | "PROTECTED_LOCAL_LEDGER_UNAVAILABLE" => {
            NimiHostErrorReasonCode::RuntimeServiceUnavailable
        }
        _ => return None,
    })
}

fn public_reason_metadata(
    info: Option<&GoogleRpcErrorInfo>,
) -> (Option<String>, BTreeMap<String, String>) {
    const PUBLIC_KEYS: [&str; 5] = [
        "permission_id",
        "permission_reason",
        "permission_admission",
        "diagnostic_stage",
        "local_development_reason_code",
    ];
    let mut metadata = BTreeMap::new();
    if let Some(info) = info {
        for key in PUBLIC_KEYS {
            if let Some(value) = info.metadata.get(key) {
                let normalized = value.trim();
                if !normalized.is_empty()
                    && normalized == value
                    && normalized.len() <= 2048
                    && !normalized.chars().any(char::is_control)
                {
                    metadata.insert(key.to_string(), normalized.to_string());
                }
            }
        }
    }
    let permission_id = metadata.get("permission_id").cloned();
    (permission_id, metadata)
}

fn status_is_retryable(code: Code) -> bool {
    matches!(
        code,
        Code::Unavailable | Code::DeadlineExceeded | Code::Cancelled | Code::ResourceExhausted
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use prost_types::Any;

    #[test]
    fn bare_host_status_is_unclassified_and_keeps_only_the_raw_grpc_code() {
        let error = host_error_from_status(Status::internal("secret path and token"));
        assert_eq!(
            error.reason_code(),
            NimiHostErrorReasonCode::RuntimeServiceErrorUnclassified
        );
        assert_eq!(
            error
                .reason_metadata()
                .get("grpc_status_code")
                .map(String::as_str),
            Some("13")
        );
        assert!(!error.to_string().contains("secret"));
        assert!(!error
            .reason_metadata()
            .values()
            .any(|value| value.contains("secret")));
    }

    #[test]
    fn bare_local_app_internal_status_is_not_a_trust_failure() {
        let error = local_app_error_from_status(Status::internal("private runtime detail"));
        assert_eq!(
            error.reason_code(),
            LocalAppReasonCode::RuntimeServiceErrorUnclassified
        );
        assert_eq!(
            error
                .reason_metadata()
                .get("grpc_status_code")
                .map(String::as_str),
            Some("13")
        );
        assert_ne!(
            error.reason_code(),
            LocalAppReasonCode::RuntimeServiceUntrusted
        );
    }

    #[test]
    fn bundled_avatar_projects_not_found_without_exposing_status_text() {
        let status = Status::not_found("sensitive runtime record detail");
        assert_eq!(
            bundled_avatar_runtime_reason(&status).as_deref(),
            Some("RUNTIME_GRPC_NOT_FOUND")
        );
        assert_eq!(
            bundled_avatar_runtime_reason(&Status::permission_denied("sensitive")),
            None
        );
    }

    #[test]
    fn local_app_preflight_stale_process_projects_process_replaced() {
        assert_eq!(
            local_app_reason_from_runtime_reason("LOCAL_APP_PROCESS_MISMATCH"),
            Some(LocalAppReasonCode::ProcessReplaced)
        );
        assert_ne!(
            local_app_reason_from_runtime_reason("PROTECTED_ORIGIN_ROLE_MISMATCH"),
            Some(LocalAppReasonCode::ProcessReplaced)
        );
    }

    #[test]
    fn local_development_runtime_failures_keep_actionable_host_reasons() {
        for (runtime_reason, host_reason) in [
            (
                "LOCAL_APP_RECORD_NOT_FOUND",
                NimiHostErrorReasonCode::LocalDevelopmentAuthorizationRequired,
            ),
            (
                "LOCAL_APP_ACCOUNT_CHANGED",
                NimiHostErrorReasonCode::LocalDevelopmentReapprovalRequired,
            ),
            (
                "LOCAL_APP_PROVENANCE_UNAVAILABLE",
                NimiHostErrorReasonCode::LocalDevelopmentProjectChanged,
            ),
            (
                "LOCAL_APP_PROCESS_MISMATCH",
                NimiHostErrorReasonCode::LocalDevelopmentSupervisorRequired,
            ),
            (
                "LOCAL_APP_SESSION_REVOKED",
                NimiHostErrorReasonCode::LocalDevelopmentSessionRevoked,
            ),
            (
                "LOCAL_APP_DEVELOPER_MODE_DISABLED",
                NimiHostErrorReasonCode::LocalAppDeveloperModeDisabled,
            ),
            (
                "LOCAL_APP_OPERATION_UNAVAILABLE",
                NimiHostErrorReasonCode::LocalAppOperationUnavailable,
            ),
        ] {
            assert_eq!(
                host_reason_from_runtime_reason(runtime_reason),
                Some(host_reason),
                "{runtime_reason}"
            );
        }
    }

    #[test]
    fn retired_local_development_runtime_reasons_are_not_compatibility_truth() {
        for retired in [
            "LOCAL_DEVELOPMENT_AUTHORIZATION_REQUIRED",
            "LOCAL_DEVELOPMENT_REAPPROVAL_REQUIRED",
            "LOCAL_DEVELOPMENT_PROJECT_CHANGED",
            "LOCAL_DEVELOPMENT_SUPERVISOR_REQUIRED",
            "LOCAL_DEVELOPMENT_SESSION_REVOKED",
            "LOCAL_DEVELOPMENT_PLATFORM_UNSUPPORTED",
            "LOCAL_DEVELOPMENT_OPERATION_FORBIDDEN",
            "LOCAL_DEVELOPMENT_DEV_SERVER_UNCONTROLLED",
            "LOCAL_DEVELOPMENT_APPROVAL_DENIED",
        ] {
            assert_eq!(host_reason_from_runtime_reason(retired), None, "{retired}");
        }
    }

    #[test]
    fn boot_epoch_mismatch_is_never_collapsed_into_unavailable() {
        assert_eq!(
            host_reason_from_runtime_reason("PROTECTED_LOCAL_BOOT_EPOCH_MISMATCH"),
            Some(NimiHostErrorReasonCode::RuntimeRestarted)
        );
        assert_eq!(
            local_app_reason_from_runtime_reason("PROTECTED_LOCAL_BOOT_EPOCH_MISMATCH"),
            Some(LocalAppReasonCode::RuntimeRestarted)
        );
        assert_eq!(
            local_app_reason_from_proto(633),
            Some(LocalAppReasonCode::RuntimeRestarted)
        );
    }

    #[test]
    fn configure_reason_codes_are_distinct_in_proto_and_string_mappings() {
        for (number, runtime_reason, local_reason, host_reason) in [
            (
                668,
                "LOCAL_APP_PERMISSION_RESERVED_NOT_ADMITTED",
                LocalAppReasonCode::PermissionReservedNotAdmitted,
                NimiHostErrorReasonCode::LocalAppPermissionReservedNotAdmitted,
            ),
            (
                669,
                "LOCAL_APP_PERMISSION_UNKNOWN",
                LocalAppReasonCode::PermissionUnknown,
                NimiHostErrorReasonCode::LocalAppPermissionUnknown,
            ),
            (
                670,
                "AGENT_AI_CONFIG_REVISION_CONFLICT",
                LocalAppReasonCode::AgentAiConfigRevisionConflict,
                NimiHostErrorReasonCode::AgentAiConfigRevisionConflict,
            ),
            (
                671,
                "AGENT_AUTONOMY_REVISION_CONFLICT",
                LocalAppReasonCode::AgentAutonomyRevisionConflict,
                NimiHostErrorReasonCode::AgentAutonomyRevisionConflict,
            ),
        ] {
            assert_eq!(local_app_reason_from_proto(number), Some(local_reason));
            assert_eq!(
                local_app_reason_from_runtime_reason(runtime_reason),
                Some(local_reason)
            );
            assert_eq!(
                host_reason_from_runtime_reason(runtime_reason),
                Some(host_reason)
            );
        }
    }

    #[test]
    fn configure_permission_error_preserves_public_permission_metadata() {
        let info = GoogleRpcErrorInfo {
            reason: "LOCAL_APP_PERMISSION_RESERVED_NOT_ADMITTED".to_string(),
            domain: ERROR_INFO_DOMAIN.to_string(),
            metadata: HashMap::from([
                ("permission_id".to_string(), "agents.configure".to_string()),
                (
                    "permission_reason".to_string(),
                    "reserved_not_admitted".to_string(),
                ),
                (
                    "diagnostic_stage".to_string(),
                    "operation-coordinator".to_string(),
                ),
                (
                    "owner_selector_digest".to_string(),
                    "must-not-cross".to_string(),
                ),
            ]),
        };
        let envelope = GoogleRpcStatus {
            code: Code::PermissionDenied as i32,
            message: "LOCAL_APP_PERMISSION_RESERVED_NOT_ADMITTED".to_string(),
            details: vec![Any {
                type_url: ERROR_INFO_TYPE_URL.to_string(),
                value: info.encode_to_vec(),
            }],
        };
        let status = || {
            Status::with_details(
                Code::PermissionDenied,
                "LOCAL_APP_PERMISSION_RESERVED_NOT_ADMITTED",
                envelope.encode_to_vec().into(),
            )
        };
        let local = local_app_error_from_status(status());
        assert_eq!(
            local.reason_code(),
            LocalAppReasonCode::PermissionReservedNotAdmitted
        );
        assert_eq!(local.permission_id(), Some("agents.configure"));
        assert_eq!(
            local
                .reason_metadata()
                .get("permission_reason")
                .map(String::as_str),
            Some("reserved_not_admitted")
        );
        assert!(!local
            .reason_metadata()
            .contains_key("owner_selector_digest"));

        let host = host_error_from_status(status());
        assert_eq!(
            host.reason_code(),
            NimiHostErrorReasonCode::LocalAppPermissionReservedNotAdmitted
        );
        assert_eq!(host.permission_id(), Some("agents.configure"));
        assert_eq!(host.reason_metadata(), local.reason_metadata());
    }

    #[test]
    fn structured_runtime_error_keeps_bounded_diagnostic_stage() {
        let info = GoogleRpcErrorInfo {
            reason: "LOCAL_APP_PROVENANCE_UNAVAILABLE".to_string(),
            domain: ERROR_INFO_DOMAIN.to_string(),
            metadata: HashMap::from([("diagnostic_stage".to_string(), "launch-store".to_string())]),
        };
        let envelope = GoogleRpcStatus {
            code: Code::FailedPrecondition as i32,
            message: "LOCAL_APP_PROVENANCE_UNAVAILABLE".to_string(),
            details: vec![Any {
                type_url: ERROR_INFO_TYPE_URL.to_string(),
                value: info.encode_to_vec(),
            }],
        };
        let status = Status::with_details(
            Code::FailedPrecondition,
            "LOCAL_APP_PROVENANCE_UNAVAILABLE",
            envelope.encode_to_vec().into(),
        );
        let parsed = runtime_error_info(&status).expect("structured Runtime error");
        assert_eq!(parsed.reason, "LOCAL_APP_PROVENANCE_UNAVAILABLE");
        assert_eq!(
            parsed.metadata.get("diagnostic_stage").map(String::as_str),
            Some("launch-store")
        );
    }
}
