use crate::generated::{AccountReasonCode, ReasonCode};
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
    let mapped = info
        .as_ref()
        .and_then(|value| host_reason_from_runtime_reason(&value.reason));
    let unclassified = mapped.is_none()
        && !matches!(
            status.code(),
            Code::Unavailable | Code::DeadlineExceeded | Code::Cancelled
        );
    let reason = mapped.unwrap_or_else(|| match status.code() {
        Code::Unavailable | Code::DeadlineExceeded | Code::Cancelled => {
            NimiHostErrorReasonCode::RuntimeServiceUnavailable
        }
        _ => NimiHostErrorReasonCode::RuntimeServiceErrorUnclassified,
    });
    let mut metadata = public_reason_metadata(info.as_ref());
    if unclassified {
        metadata.extend(unclassified_status_metadata(&status));
    }
    NimiHostError::new(reason, status_is_retryable(status.code())).with_reason_metadata(metadata)
}

pub(crate) fn local_app_error_from_status(status: Status) -> LocalAppOperationError {
    let info = runtime_error_info(&status);
    let mapped = info
        .as_ref()
        .and_then(|value| local_app_reason_from_runtime_reason(&value.reason));
    let fallback = match status.code() {
        Code::InvalidArgument => LocalAppReasonCode::InvalidPayload,
        Code::Unauthenticated => LocalAppReasonCode::RuntimeUnauthenticated,
        Code::PermissionDenied => LocalAppReasonCode::RuntimeAccessDenied,
        Code::NotFound => LocalAppReasonCode::NotFound,
        Code::ResourceExhausted => LocalAppReasonCode::ResourceExhausted,
        Code::Cancelled => LocalAppReasonCode::Canceled,
        Code::Unavailable | Code::DeadlineExceeded => LocalAppReasonCode::RuntimeServiceUnavailable,
        _ => LocalAppReasonCode::RuntimeServiceErrorUnclassified,
    };
    let unclassified =
        mapped.is_none() && fallback == LocalAppReasonCode::RuntimeServiceErrorUnclassified;
    let reason = mapped.unwrap_or(fallback);
    let mut metadata = public_reason_metadata(info.as_ref());
    if unclassified {
        metadata.extend(unclassified_status_metadata(&status));
    }
    LocalAppOperationError::new(reason, status_is_retryable(status.code()))
        .with_reason_metadata(metadata)
}

pub(crate) fn local_app_reason_from_proto(value: i32) -> Option<LocalAppReasonCode> {
    Some(match value {
        1 => LocalAppReasonCode::ActionExecuted,
        633 => LocalAppReasonCode::RuntimeRestarted,
        642 | 643 | 644 | 645 | 656 | 658 | 660 => LocalAppReasonCode::RuntimeAccessDenied,
        655 => LocalAppReasonCode::OperationUnavailable,
        646..=648 => LocalAppReasonCode::RuntimeUnauthenticated,
        649 => LocalAppReasonCode::ProcessReplaced,
        650 => LocalAppReasonCode::Revoked,
        654 => LocalAppReasonCode::AccountChanged,
        657 => LocalAppReasonCode::PresenceExpired,
        200 => LocalAppReasonCode::AiModelNotFound,
        201 => LocalAppReasonCode::AiModelNotReady,
        202 => LocalAppReasonCode::AiProviderUnavailable,
        204 => LocalAppReasonCode::AiRouteUnsupported,
        205 => LocalAppReasonCode::AiRouteFallbackDenied,
        206 => LocalAppReasonCode::AiInputInvalid,
        207 => LocalAppReasonCode::AiOutputInvalid,
        209 => LocalAppReasonCode::AiContentFilterBlocked,
        352 => LocalAppReasonCode::AiLocalModelUnavailable,
        353 => LocalAppReasonCode::AiLocalModelProfileMissing,
        364 => LocalAppReasonCode::AiLocalServiceUnavailable,
        688 => LocalAppReasonCode::AiLocalDriverUnavailable,
        692 => LocalAppReasonCode::AiLocalAssetIncompatible,
        697 => LocalAppReasonCode::AiLocalSelectionNotFound,
        698 => LocalAppReasonCode::AiLocalCapabilityMismatch,
        699 => LocalAppReasonCode::AiLocalConfigurationNotConfigured,
        391 => LocalAppReasonCode::AiProviderAuthFailed,
        392 => LocalAppReasonCode::AiProviderInternal,
        393 => LocalAppReasonCode::AiProviderRateLimited,
        394 => LocalAppReasonCode::AiProviderTimeout,
        417 => LocalAppReasonCode::AiRealtimeSessionNotFound,
        418 => LocalAppReasonCode::AiRealtimeSessionClosed,
        410 => LocalAppReasonCode::AiMediaSpecInvalid,
        411 => LocalAppReasonCode::AiMediaOptionUnsupported,
        420 => LocalAppReasonCode::AiVoiceInputInvalid,
        421 => LocalAppReasonCode::AiVoiceWorkflowUnsupported,
        422 => LocalAppReasonCode::AiVoiceAssetNotFound,
        423 => LocalAppReasonCode::AiVoiceAssetExpired,
        424 => LocalAppReasonCode::AiVoiceAssetScopeForbidden,
        425 => LocalAppReasonCode::AiVoiceTargetModelMismatch,
        694 => LocalAppReasonCode::AiConfigInvalid,
        695 => LocalAppReasonCode::AiConfigNotFound,
        696 => LocalAppReasonCode::AiConfigPersistenceUnavailable,
        706 => LocalAppReasonCode::SnapshotUnavailable,
        707 => LocalAppReasonCode::AccessDenied,
        708 => LocalAppReasonCode::OperationUnsupported,
        709 => LocalAppReasonCode::OwnerUnavailable,
        710 => LocalAppReasonCode::CurrentUserDisplayUnavailable,
        566 => LocalAppReasonCode::InvalidPath,
        567 | 662 => LocalAppReasonCode::NotFound,
        568 | 664 => LocalAppReasonCode::ResourceExhausted,
        581 => LocalAppReasonCode::AlreadyExists,
        582 => LocalAppReasonCode::ObjectTooLarge,
        583 => LocalAppReasonCode::InvalidRange,
        584 => LocalAppReasonCode::InvalidCursor,
        585 => LocalAppReasonCode::IntegrityFailure,
        586 => LocalAppReasonCode::ArtifactUnavailable,
        569 | 661 | 667 => LocalAppReasonCode::RuntimeServiceUnavailable,
        663 | 665 => LocalAppReasonCode::InvalidPayload,
        666 => LocalAppReasonCode::RuntimeServiceUntrusted,
        300 => LocalAppReasonCode::RuntimeUnauthenticated,
        503 => LocalAppReasonCode::RuntimeAccessDenied,
        _ => return None,
    })
}

pub(crate) fn local_app_persona_reason_from_realm_response(
    reason_code: i32,
    account_reason_code: i32,
) -> Option<LocalAppReasonCode> {
    let reason = ReasonCode::try_from(reason_code).ok()?;
    let account_reason = AccountReasonCode::try_from(account_reason_code).ok()?;
    Some(match reason {
        ReasonCode::LocalAppOperationUnavailable | ReasonCode::LocalAppOperationUnsupported => {
            LocalAppReasonCode::CapabilityUnavailable
        }
        ReasonCode::ProtocolEnvelopeInvalid | ReasonCode::RealmRequestRejected => {
            LocalAppReasonCode::InvalidInput
        }
        ReasonCode::AppMessagePayloadTooLarge => LocalAppReasonCode::RequestTooLarge,
        ReasonCode::AuthTokenInvalid
        | ReasonCode::ProtectedLocalBootEpochMismatch
        | ReasonCode::LocalAppProcessMismatch
        | ReasonCode::LocalAppSessionRevoked
        | ReasonCode::LocalAppAccountChanged
        | ReasonCode::LocalAppSnapshotUnavailable => LocalAppReasonCode::SessionInvalid,
        ReasonCode::PrincipalUnauthorized
        | ReasonCode::AppScopeForbidden
        | ReasonCode::LocalAppAccessDenied => LocalAppReasonCode::PersonaAccessDenied,
        ReasonCode::LocalAppOwnerUnavailable => LocalAppReasonCode::OwnerAuthorityMissing,
        ReasonCode::RealmNotFound => LocalAppReasonCode::NotFound,
        ReasonCode::RealmConflict => LocalAppReasonCode::ContentConflict,
        ReasonCode::RealmRateLimited => LocalAppReasonCode::RateLimited,
        ReasonCode::RealmContractInvalid
            if account_reason == AccountReasonCode::BrokerResponseTooLarge =>
        {
            LocalAppReasonCode::ResponseTooLarge
        }
        ReasonCode::RealmContractInvalid => LocalAppReasonCode::ContractInvalid,
        ReasonCode::RealmUnavailable => LocalAppReasonCode::RealmUnavailable,
        ReasonCode::RealmOperationFailed => LocalAppReasonCode::UpstreamFailed,
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
        "LOCAL_APP_OPERATION_UNAVAILABLE" => LocalAppReasonCode::OperationUnavailable,
        "LOCAL_APP_SNAPSHOT_UNAVAILABLE" => LocalAppReasonCode::SnapshotUnavailable,
        "LOCAL_APP_ACCESS_DENIED" => LocalAppReasonCode::AccessDenied,
        "LOCAL_APP_OPERATION_UNSUPPORTED" => LocalAppReasonCode::OperationUnsupported,
        "LOCAL_APP_OWNER_UNAVAILABLE" => LocalAppReasonCode::OwnerUnavailable,
        "CURRENT_USER_DISPLAY_UNAVAILABLE" => LocalAppReasonCode::CurrentUserDisplayUnavailable,
        "LOCAL_APP_PRESENCE_EXPIRED" => LocalAppReasonCode::PresenceExpired,
        "AI_MODEL_NOT_FOUND" => LocalAppReasonCode::AiModelNotFound,
        "AI_MODEL_NOT_READY" => LocalAppReasonCode::AiModelNotReady,
        "AI_PROVIDER_UNAVAILABLE" => LocalAppReasonCode::AiProviderUnavailable,
        "AI_ROUTE_UNSUPPORTED" => LocalAppReasonCode::AiRouteUnsupported,
        "AI_ROUTE_FALLBACK_DENIED" => LocalAppReasonCode::AiRouteFallbackDenied,
        "AI_INPUT_INVALID" => LocalAppReasonCode::AiInputInvalid,
        "AI_OUTPUT_INVALID" => LocalAppReasonCode::AiOutputInvalid,
        "AI_CONTENT_FILTER_BLOCKED" => LocalAppReasonCode::AiContentFilterBlocked,
        "AI_LOCAL_MODEL_UNAVAILABLE" => LocalAppReasonCode::AiLocalModelUnavailable,
        "AI_LOCAL_MODEL_PROFILE_MISSING" => LocalAppReasonCode::AiLocalModelProfileMissing,
        "AI_LOCAL_SERVICE_UNAVAILABLE" => LocalAppReasonCode::AiLocalServiceUnavailable,
        "AI_LOCAL_DRIVER_UNAVAILABLE" => LocalAppReasonCode::AiLocalDriverUnavailable,
        "AI_LOCAL_ASSET_INCOMPATIBLE" => LocalAppReasonCode::AiLocalAssetIncompatible,
        "AI_LOCAL_SELECTION_NOT_FOUND" => LocalAppReasonCode::AiLocalSelectionNotFound,
        "AI_LOCAL_CAPABILITY_MISMATCH" => LocalAppReasonCode::AiLocalCapabilityMismatch,
        "AI_LOCAL_CONFIGURATION_NOT_CONFIGURED" => {
            LocalAppReasonCode::AiLocalConfigurationNotConfigured
        }
        "AI_PROVIDER_AUTH_FAILED" => LocalAppReasonCode::AiProviderAuthFailed,
        "AI_PROVIDER_INTERNAL" => LocalAppReasonCode::AiProviderInternal,
        "AI_PROVIDER_RATE_LIMITED" => LocalAppReasonCode::AiProviderRateLimited,
        "AI_PROVIDER_TIMEOUT" => LocalAppReasonCode::AiProviderTimeout,
        "AI_REALTIME_SESSION_NOT_FOUND" => LocalAppReasonCode::AiRealtimeSessionNotFound,
        "AI_REALTIME_SESSION_CLOSED" => LocalAppReasonCode::AiRealtimeSessionClosed,
        "AI_MEDIA_SPEC_INVALID" => LocalAppReasonCode::AiMediaSpecInvalid,
        "AI_MEDIA_OPTION_UNSUPPORTED" => LocalAppReasonCode::AiMediaOptionUnsupported,
        "AI_VOICE_INPUT_INVALID" => LocalAppReasonCode::AiVoiceInputInvalid,
        "AI_VOICE_WORKFLOW_UNSUPPORTED" => LocalAppReasonCode::AiVoiceWorkflowUnsupported,
        "AI_VOICE_ASSET_NOT_FOUND" => LocalAppReasonCode::AiVoiceAssetNotFound,
        "AI_VOICE_ASSET_EXPIRED" => LocalAppReasonCode::AiVoiceAssetExpired,
        "AI_VOICE_ASSET_SCOPE_FORBIDDEN" => LocalAppReasonCode::AiVoiceAssetScopeForbidden,
        "AI_VOICE_TARGET_MODEL_MISMATCH" => LocalAppReasonCode::AiVoiceTargetModelMismatch,
        "AI_CONFIG_INVALID" => LocalAppReasonCode::AiConfigInvalid,
        "AI_CONFIG_NOT_FOUND" => LocalAppReasonCode::AiConfigNotFound,
        "AI_CONFIG_PERSISTENCE_UNAVAILABLE" => LocalAppReasonCode::AiConfigPersistenceUnavailable,
        "PROTOCOL_ENVELOPE_INVALID" => LocalAppReasonCode::InvalidPayload,
        "APP_STORAGE_PATH_INVALID" => LocalAppReasonCode::InvalidPath,
        "APP_STORAGE_ENTRY_ALREADY_EXISTS" => LocalAppReasonCode::AlreadyExists,
        "APP_STORAGE_OBJECT_TOO_LARGE" => LocalAppReasonCode::ObjectTooLarge,
        "APP_STORAGE_RANGE_INVALID" => LocalAppReasonCode::InvalidRange,
        "APP_STORAGE_CURSOR_INVALID" => LocalAppReasonCode::InvalidCursor,
        "APP_STORAGE_INTEGRITY_FAILURE" => LocalAppReasonCode::IntegrityFailure,
        "APP_STORAGE_ARTIFACT_UNAVAILABLE" => LocalAppReasonCode::ArtifactUnavailable,
        "OPERATION_CANCELED" | "CANCELED" => LocalAppReasonCode::Canceled,
        "APP_STORAGE_ENTRY_NOT_FOUND" | "ARTIFACT_NOT_FOUND" => LocalAppReasonCode::NotFound,
        "APP_STORAGE_QUOTA_EXCEEDED" | "RESOURCE_EXHAUSTED" | "ARTIFACT_TOO_LARGE" => {
            LocalAppReasonCode::ResourceExhausted
        }
        "APP_STORAGE_UNAVAILABLE"
        | "PROTECTED_LOCAL_TRANSPORT_UNSUPPORTED"
        | "PROTECTED_LOCAL_LEDGER_UNAVAILABLE" => LocalAppReasonCode::RuntimeServiceUnavailable,
        "LOCAL_APP_RECORD_NOT_FOUND"
        | "LOCAL_APP_RECORD_TOMBSTONED"
        | "LOCAL_APP_PROVENANCE_UNAVAILABLE"
        | "LOCAL_APP_PRESENCE_REQUIRED"
        | "LOCAL_APP_DEVELOPER_MODE_DISABLED"
        | "PRINCIPAL_UNAUTHORIZED" => LocalAppReasonCode::RuntimeAccessDenied,
        _ => return None,
    })
}

fn host_reason_from_runtime_reason(value: &str) -> Option<NimiHostErrorReasonCode> {
    Some(match value {
        "PRINCIPAL_UNAUTHORIZED" | "AUTH_TOKEN_INVALID" => {
            NimiHostErrorReasonCode::PrincipalUnauthorized
        }
        "PROTECTED_LOCAL_BOOT_EPOCH_MISMATCH" => NimiHostErrorReasonCode::RuntimeRestarted,
        "LOCAL_APP_RECORD_NOT_FOUND"
        | "LOCAL_APP_RECORD_TOMBSTONED"
        | "LOCAL_APP_PROVENANCE_UNAVAILABLE" => {
            NimiHostErrorReasonCode::LocalDevelopmentProjectChanged
        }
        "LOCAL_APP_ACCOUNT_CHANGED" => NimiHostErrorReasonCode::AccountChanged,
        "LOCAL_APP_LAUNCH_LEASE_REQUIRED"
        | "LOCAL_APP_LAUNCH_LEASE_MISMATCH"
        | "LOCAL_APP_LAUNCH_LEASE_REPLAY"
        | "LOCAL_APP_PROCESS_MISMATCH" => {
            NimiHostErrorReasonCode::LocalDevelopmentSupervisorRequired
        }
        "LOCAL_APP_SESSION_REVOKED" => NimiHostErrorReasonCode::LocalDevelopmentSessionRevoked,
        "LOCAL_APP_PRESENCE_REQUIRED" => NimiHostErrorReasonCode::LocalAppPresenceRequired,
        "LOCAL_APP_PRESENCE_EXPIRED" => NimiHostErrorReasonCode::LocalAppPresenceExpired,
        "LOCAL_APP_DEVELOPER_MODE_DISABLED" => {
            NimiHostErrorReasonCode::LocalAppDeveloperModeDisabled
        }
        "LOCAL_APP_OPERATION_UNAVAILABLE" => NimiHostErrorReasonCode::LocalAppOperationUnavailable,
        "AI_VOICE_TARGET_MODEL_MISMATCH" => NimiHostErrorReasonCode::AiVoiceTargetModelMismatch,
        "AGENT_AI_CONFIG_REVISION_CONFLICT" => {
            NimiHostErrorReasonCode::AgentAiConfigRevisionConflict
        }
        "AGENT_AI_CONFIG_INVALID" => NimiHostErrorReasonCode::AgentAiConfigInvalid,
        "AGENT_AI_CONFIG_TARGET_REQUIRED" => NimiHostErrorReasonCode::AgentAiConfigTargetRequired,
        "AGENT_AI_CONFIG_TARGET_INVALID" => NimiHostErrorReasonCode::AgentAiConfigTargetInvalid,
        "AGENT_AI_CONFIG_TARGET_UNAVAILABLE" => {
            NimiHostErrorReasonCode::AgentAiConfigTargetUnavailable
        }
        "AGENT_AI_CONFIG_CAPABILITY_MISMATCH" => {
            NimiHostErrorReasonCode::AgentAiConfigCapabilityMismatch
        }
        "AGENT_AI_CONFIG_MODEL_TARGET_MISMATCH" => {
            NimiHostErrorReasonCode::AgentAiConfigModelTargetMismatch
        }
        "AGENT_AUTONOMY_REVISION_CONFLICT" => {
            NimiHostErrorReasonCode::AgentAutonomyRevisionConflict
        }
        "AGENT_PRESENTATION_REVISION_CONFLICT" => {
            NimiHostErrorReasonCode::AgentPresentationRevisionConflict
        }
        "PROTECTED_LOCAL_TRANSPORT_UNSUPPORTED" | "PROTECTED_LOCAL_LEDGER_UNAVAILABLE" => {
            NimiHostErrorReasonCode::RuntimeServiceUnavailable
        }
        _ => return None,
    })
}

fn public_reason_metadata(info: Option<&GoogleRpcErrorInfo>) -> BTreeMap<String, String> {
    const PUBLIC_KEYS: [&str; 3] = [
        "diagnostic_stage",
        "local_development_reason_code",
        "capability",
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
    metadata
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
    fn protected_access_unavailable_stays_typed() {
        assert_eq!(
            local_app_reason_from_runtime_reason("LOCAL_APP_OPERATION_UNAVAILABLE"),
            Some(LocalAppReasonCode::OperationUnavailable)
        );
        assert_eq!(
            host_reason_from_runtime_reason("LOCAL_APP_OPERATION_UNAVAILABLE"),
            Some(NimiHostErrorReasonCode::LocalAppOperationUnavailable)
        );
        assert_eq!(
            local_app_reason_from_runtime_reason("LOCAL_APP_OWNER_UNAVAILABLE"),
            Some(LocalAppReasonCode::OwnerUnavailable)
        );
        assert_ne!(
            local_app_reason_from_runtime_reason("LOCAL_APP_ACCESS_DENIED"),
            local_app_reason_from_runtime_reason("LOCAL_APP_OWNER_UNAVAILABLE")
        );
        for (runtime_reason, proto_reason, expected) in [
            (
                "AI_LOCAL_DRIVER_UNAVAILABLE",
                688,
                LocalAppReasonCode::AiLocalDriverUnavailable,
            ),
            (
                "AI_LOCAL_SELECTION_NOT_FOUND",
                697,
                LocalAppReasonCode::AiLocalSelectionNotFound,
            ),
            (
                "AI_LOCAL_CAPABILITY_MISMATCH",
                698,
                LocalAppReasonCode::AiLocalCapabilityMismatch,
            ),
            (
                "AI_LOCAL_CONFIGURATION_NOT_CONFIGURED",
                699,
                LocalAppReasonCode::AiLocalConfigurationNotConfigured,
            ),
            (
                "AI_LOCAL_ASSET_INCOMPATIBLE",
                692,
                LocalAppReasonCode::AiLocalAssetIncompatible,
            ),
        ] {
            assert_eq!(
                local_app_reason_from_runtime_reason(runtime_reason),
                Some(expected)
            );
            assert_eq!(local_app_reason_from_proto(proto_reason), Some(expected));
        }
    }

    #[test]
    fn persona_realm_failures_use_generated_reason_enums() {
        assert_eq!(
            local_app_persona_reason_from_realm_response(
                ReasonCode::RealmConflict as i32,
                AccountReasonCode::BrokerConflict as i32,
            ),
            Some(LocalAppReasonCode::ContentConflict)
        );
        assert_eq!(
            local_app_persona_reason_from_realm_response(
                ReasonCode::RealmContractInvalid as i32,
                AccountReasonCode::BrokerResponseTooLarge as i32,
            ),
            Some(LocalAppReasonCode::ResponseTooLarge)
        );
        assert_eq!(
            local_app_persona_reason_from_realm_response(
                ReasonCode::AppMessagePayloadTooLarge as i32,
                AccountReasonCode::BrokerRequestInvalid as i32,
            ),
            Some(LocalAppReasonCode::RequestTooLarge)
        );
    }

    #[test]
    fn media_validation_failures_stay_typed_for_local_apps() {
        for (runtime_reason, proto_reason, expected) in [
            ("AI_MEDIA_SPEC_INVALID", 410, "ai-media-spec-invalid"),
            (
                "AI_MEDIA_OPTION_UNSUPPORTED",
                411,
                "ai-media-option-unsupported",
            ),
        ] {
            assert_eq!(
                local_app_reason_from_runtime_reason(runtime_reason)
                    .map(LocalAppReasonCode::as_str),
                Some(expected)
            );
            assert_eq!(
                local_app_reason_from_proto(proto_reason).map(LocalAppReasonCode::as_str),
                Some(expected)
            );
        }
    }

    #[test]
    fn voice_failures_stay_typed_for_local_apps() {
        for (runtime_reason, proto_reason, expected) in [
            ("AI_VOICE_INPUT_INVALID", 420, "ai-voice-input-invalid"),
            (
                "AI_VOICE_WORKFLOW_UNSUPPORTED",
                421,
                "ai-voice-workflow-unsupported",
            ),
            ("AI_VOICE_ASSET_NOT_FOUND", 422, "ai-voice-asset-not-found"),
            ("AI_VOICE_ASSET_EXPIRED", 423, "ai-voice-asset-expired"),
            (
                "AI_VOICE_ASSET_SCOPE_FORBIDDEN",
                424,
                "ai-voice-asset-scope-forbidden",
            ),
            (
                "AI_VOICE_TARGET_MODEL_MISMATCH",
                425,
                "ai-voice-target-model-mismatch",
            ),
        ] {
            assert_eq!(
                local_app_reason_from_runtime_reason(runtime_reason)
                    .map(LocalAppReasonCode::as_str),
                Some(expected)
            );
            assert_eq!(
                local_app_reason_from_proto(proto_reason).map(LocalAppReasonCode::as_str),
                Some(expected)
            );
        }
    }

    #[test]
    fn invalid_argument_voice_status_keeps_exact_reason_without_private_detail() {
        let info = GoogleRpcErrorInfo {
            reason: "AI_VOICE_TARGET_MODEL_MISMATCH".to_string(),
            domain: ERROR_INFO_DOMAIN.to_string(),
            metadata: HashMap::from([(
                "provider_message".to_string(),
                "private-provider-detail".to_string(),
            )]),
        };
        let details = GoogleRpcStatus {
            code: Code::InvalidArgument as i32,
            message: "private-provider-message".to_string(),
            details: vec![prost_types::Any {
                type_url: ERROR_INFO_TYPE_URL.to_string(),
                value: info.encode_to_vec(),
            }],
        };
        let error = local_app_error_from_status(Status::with_details(
            Code::InvalidArgument,
            "private-provider-message",
            details.encode_to_vec().into(),
        ));

        assert_eq!(
            error.reason_code(),
            LocalAppReasonCode::AiVoiceTargetModelMismatch
        );
        assert!(error.reason_metadata().is_empty());
        assert!(!error.to_string().contains("private-provider"));
    }

    #[test]
    fn arbitrary_status_detail_is_not_projected() {
        let error = host_error_from_status(Status::internal("secret token"));
        assert_eq!(
            error.reason_code(),
            NimiHostErrorReasonCode::RuntimeServiceErrorUnclassified
        );
        assert!(!error.to_string().contains("secret"));
    }
}
