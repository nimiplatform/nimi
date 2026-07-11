use crate::{NimiHostError, NimiHostErrorReasonCode};
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
    let details = GoogleRpcStatus::decode(status.details()).ok()?;
    details.details.iter().find_map(|detail| {
        if detail.type_url != ERROR_INFO_TYPE_URL {
            return None;
        }
        let info = GoogleRpcErrorInfo::decode(detail.value.as_slice()).ok()?;
        (info.domain == ERROR_INFO_DOMAIN && !info.reason.is_empty()).then_some(info.reason)
    })
}

pub(crate) fn production_open_not_applicable(status: &Status) -> bool {
    matches!(
        runtime_reason(status).as_deref(),
        Some("PRINCIPAL_UNAUTHORIZED" | "PROTECTED_ORIGIN_ROLE_MISMATCH")
    )
}

pub(crate) fn host_error_from_status(status: Status) -> NimiHostError {
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

    #[test]
    fn unknown_status_text_never_becomes_a_public_reason() {
        let error = host_error_from_status(Status::permission_denied("secret path and token"));
        assert_eq!(
            error.reason_code(),
            NimiHostErrorReasonCode::RuntimeServiceUntrusted
        );
        assert!(!error.to_string().contains("secret"));
    }
}
