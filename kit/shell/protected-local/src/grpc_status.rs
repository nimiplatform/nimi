use crate::{LocalAppOperationError, LocalAppReasonCode, NimiHostError, NimiHostErrorReasonCode};
use prost::Message;
use std::collections::HashMap;
use tonic::{Code, Status};

const ERROR_INFO_TYPE_URL: &str = "type.googleapis.com/google.rpc.ErrorInfo";
const ERROR_INFO_DOMAIN: &str = "nimi.runtime.v1";

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

#[cfg(feature = "windows-e2e-fixture")]
fn report_windows_e2e_status(status: &Status) {
    let info = runtime_error_info(status);
    let reason = info
        .as_ref()
        .map(|value| value.reason.as_str())
        .unwrap_or("ABSENT");
    let stage = info
        .as_ref()
        .and_then(|value| value.metadata.get("diagnostic_stage"))
        .map(String::as_str)
        .unwrap_or("ABSENT");
    eprintln!(
		"[protected-local windows-e2e-fixture] grpc_code={:?} runtime_reason={} diagnostic_stage={}",
        status.code(),
		reason,
		stage
    );
}

#[cfg(not(feature = "windows-e2e-fixture"))]
fn report_windows_e2e_status(_: &Status) {}

pub(crate) fn host_error_from_status(status: Status) -> NimiHostError {
    report_windows_e2e_status(&status);
    let reason = runtime_reason(&status)
        .as_deref()
        .and_then(host_reason_from_runtime_reason);
    if let Some(reason) = reason {
        return NimiHostError::new(reason, status_is_retryable(status.code()));
    }
    let reason = match status.code() {
        Code::Unavailable | Code::DeadlineExceeded | Code::Cancelled => {
            NimiHostErrorReasonCode::RuntimeServiceUnavailable
        }
        _ => NimiHostErrorReasonCode::RuntimeServiceUntrusted,
    };
    NimiHostError::new(reason, status_is_retryable(status.code()))
}

pub(crate) fn local_app_error_from_status(status: Status) -> LocalAppOperationError {
    report_windows_e2e_status(&status);
    let reason = runtime_reason(&status)
        .as_deref()
        .and_then(local_app_reason_from_runtime_reason)
        .unwrap_or_else(|| match status.code() {
            Code::InvalidArgument => LocalAppReasonCode::InvalidPayload,
            Code::Unauthenticated => LocalAppReasonCode::RuntimeUnauthenticated,
            Code::PermissionDenied => LocalAppReasonCode::RuntimePermissionDenied,
            Code::NotFound => LocalAppReasonCode::NotFound,
            Code::ResourceExhausted => LocalAppReasonCode::ResourceExhausted,
            Code::Unavailable | Code::DeadlineExceeded | Code::Cancelled => {
                LocalAppReasonCode::RuntimeServiceUnavailable
            }
            _ => LocalAppReasonCode::RuntimeServiceUntrusted,
        });
    LocalAppOperationError::new(reason, status_is_retryable(status.code()))
}

pub(crate) fn local_app_reason_from_proto(value: i32) -> Option<LocalAppReasonCode> {
    Some(match value {
        1 => LocalAppReasonCode::ActionExecuted,
        642 | 643 | 644 | 645 | 655 | 656 | 658 | 659 | 660 => {
            LocalAppReasonCode::RuntimePermissionDenied
        }
        646 | 647 | 648 => LocalAppReasonCode::RuntimeUnauthenticated,
        649 => LocalAppReasonCode::ProcessReplaced,
        650 => LocalAppReasonCode::Revoked,
        651 => LocalAppReasonCode::PermissionRequired,
        652 => LocalAppReasonCode::PermissionDenied,
        653 => LocalAppReasonCode::PermissionRevoked,
        654 => LocalAppReasonCode::AccountChanged,
        657 => LocalAppReasonCode::PresenceExpired,
        566 => LocalAppReasonCode::InvalidPath,
        567 => LocalAppReasonCode::NotFound,
        568 => LocalAppReasonCode::ResourceExhausted,
        569 => LocalAppReasonCode::RuntimeServiceUnavailable,
        _ => return None,
    })
}

fn local_app_reason_from_runtime_reason(value: &str) -> Option<LocalAppReasonCode> {
    Some(match value {
        "ACTION_EXECUTED" => LocalAppReasonCode::ActionExecuted,
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
        "LOCAL_APP_RECORD_NOT_FOUND"
        | "LOCAL_APP_RECORD_TOMBSTONED"
        | "LOCAL_APP_PROVENANCE_UNAVAILABLE"
        | "LOCAL_APP_OPERATION_UNAVAILABLE"
        | "LOCAL_APP_PRESENCE_REQUIRED"
        | "LOCAL_APP_DEVELOPER_MODE_DISABLED"
        | "LOCAL_APP_REMEMBERED_PROJECT_DORMANT"
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
        "LOCAL_DEVELOPMENT_AUTHORIZATION_REQUIRED" => {
            NimiHostErrorReasonCode::LocalDevelopmentAuthorizationRequired
        }
        "LOCAL_DEVELOPMENT_REAPPROVAL_REQUIRED" => {
            NimiHostErrorReasonCode::LocalDevelopmentReapprovalRequired
        }
        "LOCAL_DEVELOPMENT_PROJECT_CHANGED" => {
            NimiHostErrorReasonCode::LocalDevelopmentProjectChanged
        }
        "LOCAL_DEVELOPMENT_SUPERVISOR_REQUIRED" => {
            NimiHostErrorReasonCode::LocalDevelopmentSupervisorRequired
        }
        "LOCAL_DEVELOPMENT_SESSION_REVOKED" => {
            NimiHostErrorReasonCode::LocalDevelopmentSessionRevoked
        }
        "LOCAL_DEVELOPMENT_PLATFORM_UNSUPPORTED" => {
            NimiHostErrorReasonCode::LocalDevelopmentPlatformUnsupported
        }
        "LOCAL_DEVELOPMENT_OPERATION_FORBIDDEN" => {
            NimiHostErrorReasonCode::LocalDevelopmentOperationForbidden
        }
        "LOCAL_DEVELOPMENT_DEV_SERVER_UNCONTROLLED" => {
            NimiHostErrorReasonCode::LocalDevelopmentDevServerUncontrolled
        }
        "LOCAL_DEVELOPMENT_APPROVAL_DENIED" => {
            NimiHostErrorReasonCode::LocalDevelopmentApprovalDenied
        }
        "LOCAL_APP_DEVELOPER_MODE_DISABLED" => {
            NimiHostErrorReasonCode::LocalAppDeveloperModeDisabled
        }
        "LOCAL_APP_OPERATION_UNAVAILABLE" => NimiHostErrorReasonCode::LocalAppOperationUnavailable,
        "LOCAL_APP_PROVENANCE_UNAVAILABLE" => {
            NimiHostErrorReasonCode::LocalDevelopmentProjectChanged
        }
        "PROTECTED_LOCAL_TRANSPORT_UNSUPPORTED" | "PROTECTED_LOCAL_LEDGER_UNAVAILABLE" => {
            NimiHostErrorReasonCode::RuntimeServiceUnavailable
        }
        _ => return None,
    })
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
    fn unknown_status_text_never_becomes_a_public_reason() {
        let error = host_error_from_status(Status::permission_denied("secret path and token"));
        assert_eq!(
            error.reason_code(),
            NimiHostErrorReasonCode::RuntimeServiceUntrusted
        );
        assert!(!error.to_string().contains("secret"));
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
        assert_eq!(
            host_reason_from_runtime_reason("LOCAL_APP_DEVELOPER_MODE_DISABLED"),
            Some(NimiHostErrorReasonCode::LocalAppDeveloperModeDisabled)
        );
        assert_eq!(
            host_reason_from_runtime_reason("LOCAL_APP_OPERATION_UNAVAILABLE"),
            Some(NimiHostErrorReasonCode::LocalAppOperationUnavailable)
        );
        assert_eq!(
            host_reason_from_runtime_reason("LOCAL_APP_PROVENANCE_UNAVAILABLE"),
            Some(NimiHostErrorReasonCode::LocalDevelopmentProjectChanged)
        );
    }

    #[test]
    fn structured_runtime_error_keeps_bounded_diagnostic_stage() {
        let info = GoogleRpcErrorInfo {
            reason: "LOCAL_DEVELOPMENT_PROJECT_CHANGED".to_string(),
            domain: ERROR_INFO_DOMAIN.to_string(),
            metadata: HashMap::from([("diagnostic_stage".to_string(), "launch-store".to_string())]),
        };
        let envelope = GoogleRpcStatus {
            code: Code::FailedPrecondition as i32,
            message: "LOCAL_DEVELOPMENT_PROJECT_CHANGED".to_string(),
            details: vec![Any {
                type_url: ERROR_INFO_TYPE_URL.to_string(),
                value: info.encode_to_vec(),
            }],
        };
        let status = Status::with_details(
            Code::FailedPrecondition,
            "LOCAL_DEVELOPMENT_PROJECT_CHANGED",
            envelope.encode_to_vec().into(),
        );
        let parsed = runtime_error_info(&status).expect("structured Runtime error");
        assert_eq!(parsed.reason, "LOCAL_DEVELOPMENT_PROJECT_CHANGED");
        assert_eq!(
            parsed.metadata.get("diagnostic_stage").map(String::as_str),
            Some("launch-store")
        );
    }
}
