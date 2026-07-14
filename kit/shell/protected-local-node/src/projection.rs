use super::*;

pub(super) fn project_session_status(status: LocalAppSessionStatus) -> JsonValue {
    json!({
        "state": status.state.as_str(),
        "reasonCode": status.reason_code.as_str(),
        "retryable": status.retryable,
    })
}

pub(super) fn project_permission_posture(posture: LocalAppPermissionPosture) -> JsonValue {
    json!({
        "state": posture.state.as_str(),
        "operationId": posture.operation_id,
        "resourceRef": posture.resource_ref,
        "reasonCode": posture.reason_code.as_str(),
        "actionHint": posture.action_hint,
        "retryable": posture.retryable,
    })
}

pub(super) fn project_account_projection(projection: DesktopAccountProjection) -> JsonValue {
    json!({
        "accountId": projection.account_id,
        "displayName": projection.display_name,
        "realmEnvironmentId": projection.realm_environment_id,
    })
}

pub(super) fn project_account_begin_login(response: DesktopAccountBeginLoginResponse) -> JsonValue {
    json!({
        "accepted": response.accepted,
        "loginAttemptId": response.login_attempt_id,
        "oauthAuthorizationUrl": response.oauth_authorization_url,
        "callbackOrigin": response.callback_origin,
        "state": response.state,
        "nonce": response.nonce,
        "reasonCode": response.reason_code,
        "accountReasonCode": response.account_reason_code,
        "productionInert": response.production_inert,
    })
}

pub(super) fn project_account_mutation(response: DesktopAccountMutationResponse) -> JsonValue {
    json!({
        "accepted": response.accepted,
        "state": response.state,
        "accountProjection": response.account_projection.map(project_account_projection),
        "reasonCode": response.reason_code,
        "accountReasonCode": response.account_reason_code,
        "productionInert": response.production_inert,
    })
}

pub(super) fn project_account_realm_unary(response: DesktopAccountRealmUnaryResponse) -> JsonValue {
    json!({
        "accepted": response.accepted,
        "responseJson": response.response_json,
        "reasonCode": response.reason_code,
        "accountReasonCode": response.account_reason_code,
        "productionInert": response.production_inert,
        "httpStatus": response.http_status,
        "errorMessage": response.error_message,
    })
}

pub(super) fn project_runtime_service_action(outcome: RuntimeServiceActionOutcome) -> JsonValue {
    json!({
        "running": outcome.state == nimi_shell_protected_local::RuntimeServiceState::Running,
        "managed": true,
        "state": outcome.state.as_str(),
        "releaseVersion": outcome.release_id,
        "releasePosture": "non_release",
        "reasonCode": outcome.reason_code.map(|reason| reason.as_str()),
        "retryable": outcome.retryable,
    })
}

pub(super) fn project_verified_runtime_service_running() -> JsonValue {
    json!({
        "running": true,
        "managed": true,
        "state": "running",
        "releaseVersion": JsonValue::Null,
        "releasePosture": "non_release",
        "reasonCode": JsonValue::Null,
        "retryable": false,
    })
}

pub(super) fn project_developer_mode_status(
    status: nimi_shell_protected_local::DeveloperModeStatus,
) -> JsonValue {
    json!({
        "state": status.state.as_str(),
        "enabled": status.state == nimi_shell_protected_local::DeveloperModeState::Enabled,
        "revision": status.revision,
        "accountGeneration": status.account_generation,
        "reasonCode": "action-executed",
        "retryable": false,
    })
}

pub(super) fn project_pending_local_app_grant(pending: LocalAppGrantControlPending) -> JsonValue {
    json!({
        "requestId": encode_identifier(&pending.request_id),
        "presenceChallengeId": encode_identifier(&pending.presence_challenge_id),
        "pendingGrantId": encode_identifier(&pending.pending_grant_id),
        "operationId": pending.operation_id,
        "resourceRef": pending.resource_ref,
        "expiresAtUnixMs": pending.expires_at_unix_ms,
    })
}

pub(super) fn project_local_app_grant(projection: LocalAppGrantControlProjection) -> JsonValue {
    let state = match projection.state {
        LocalAppGrantControlState::Pending => "pending",
        LocalAppGrantControlState::Granted => "granted",
        LocalAppGrantControlState::Denied => "denied",
        LocalAppGrantControlState::Revoked => "revoked",
    };
    json!({
        "state": state,
        "grantId": encode_identifier(&projection.grant_id),
        "operationId": projection.operation_id,
        "resourceRef": projection.resource_ref,
    })
}

pub(super) fn project_local_development_evaluation(
    evaluation: LocalDevelopmentEvaluation,
) -> JsonValue {
    json!({
        "evaluationId": evaluation.evaluation_id.map(|value| encode_identifier(&value)),
        "project": project_local_development_project(evaluation.project),
        "state": evaluation.state.as_str(),
        "confirmationRequired": evaluation.confirmation_required,
        "authorization": evaluation.authorization.map(project_local_development_authorization),
        "evaluationExpiresAtUnixMs": evaluation.evaluation_expires_at_unix_ms,
    })
}

pub(super) fn project_local_development_authorization(
    authorization: LocalDevelopmentAuthorization,
) -> JsonValue {
    json!({
        "authorizationId": encode_identifier(&authorization.authorization_id),
        "project": project_local_development_project(authorization.project),
        "state": authorization.state.as_str(),
        "persistence": authorization.persistence.as_str(),
        "authorizationGeneration": authorization.authorization_generation,
        "approvedAtUnixMs": authorization.approved_at_unix_ms,
        "updatedAtUnixMs": authorization.updated_at_unix_ms,
    })
}

pub(super) fn project_local_development_project(
    project: nimi_shell_protected_local::LocalDevelopmentProject,
) -> JsonValue {
    json!({
        "appId": project.app_id,
        "displayName": project.display_name,
        "canonicalProjectRoot": project.canonical_project_root.to_string_lossy(),
        "canonicalManifestPath": project.canonical_manifest_path.to_string_lossy(),
        "shell": project.shell_kind.as_str(),
        "accountId": project.account_id,
        "requestedCapabilities": project.requested_capabilities,
        "capabilityFingerprint": encode_identifier(&project.capability_fingerprint),
    })
}

pub(super) fn local_development_shell(value: &str) -> Option<LocalDevelopmentShellKind> {
    match value {
        "electron" => Some(LocalDevelopmentShellKind::Electron),
        "tauri" => Some(LocalDevelopmentShellKind::Tauri),
        _ => None,
    }
}

pub(super) fn local_development_decision(value: &str) -> Option<LocalDevelopmentDecision> {
    match value {
        "deny" => Some(LocalDevelopmentDecision::Deny),
        "allow-run-once" => Some(LocalDevelopmentDecision::AllowRunOnce),
        "allow-remember-project" => Some(LocalDevelopmentDecision::AllowRememberProject),
        _ => None,
    }
}

pub(super) fn encode_identifier(value: &[u8; 32]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut encoded = String::with_capacity(64);
    for byte in value {
        encoded.push(HEX[(byte >> 4) as usize] as char);
        encoded.push(HEX[(byte & 0x0f) as usize] as char);
    }
    encoded
}

pub(super) fn decode_identifier(value: &str) -> Option<[u8; 32]> {
    if value.len() != 64
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return None;
    }
    let mut decoded = [0u8; 32];
    for (index, pair) in value.as_bytes().chunks_exact(2).enumerate() {
        let high = decode_hex_nibble(pair[0])?;
        let low = decode_hex_nibble(pair[1])?;
        decoded[index] = (high << 4) | low;
    }
    Some(decoded)
}

pub(super) fn decode_hex_nibble(value: u8) -> Option<u8> {
    match value {
        b'0'..=b'9' => Some(value - b'0'),
        b'a'..=b'f' => Some(value - b'a' + 10),
        _ => None,
    }
}

impl NativeJsonOutcome {
    pub(super) fn success(value: JsonValue) -> Self {
        Self {
            status: "ok".to_string(),
            value: Some(value),
            reason_code: None,
            retryable: None,
        }
    }

    pub(super) fn error(error: LocalAppOperationError) -> Self {
        Self {
            status: "error".to_string(),
            value: None,
            reason_code: Some(error.reason_code().as_str().to_string()),
            retryable: Some(error.retryable()),
        }
    }

    pub(super) fn host_error(error: NimiHostError) -> Self {
        Self {
            status: "error".to_string(),
            value: None,
            reason_code: Some(error.reason_code().as_str().to_string()),
            retryable: Some(error.retryable()),
        }
    }

    pub(super) fn host_reason(reason_code: &str, retryable: bool) -> Self {
        Self {
            status: "error".to_string(),
            value: None,
            reason_code: Some(reason_code.to_string()),
            retryable: Some(retryable),
        }
    }

    pub(super) fn protected_error(error: ProtectedCarrierError) -> Self {
        Self {
            status: "error".to_string(),
            value: None,
            reason_code: Some(error.reason_code().as_str().to_string()),
            retryable: Some(error.retryable()),
        }
    }
}

impl NativeArtifactOutcome {
    pub(super) fn success(artifact: LocalAppArtifactBytes) -> Self {
        let Ok(size_bytes) = u32::try_from(artifact.size_bytes) else {
            return Self::error(LocalAppOperationError::new(
                LocalAppReasonCode::RuntimeServiceUntrusted,
                false,
            ));
        };
        if usize::try_from(size_bytes).ok() != Some(artifact.bytes.len()) {
            return Self::error(LocalAppOperationError::new(
                LocalAppReasonCode::RuntimeServiceUntrusted,
                false,
            ));
        }
        Self {
            status: "ok".to_string(),
            value: Some(NativeArtifactValue {
                bytes: artifact.bytes.into(),
                mime_type: artifact.mime_type,
                size_bytes,
                mime_inferred: artifact.mime_inferred,
            }),
            reason_code: None,
            retryable: None,
        }
    }

    pub(super) fn error(error: LocalAppOperationError) -> Self {
        Self {
            status: "error".to_string(),
            value: None,
            reason_code: Some(error.reason_code().as_str().to_string()),
            retryable: Some(error.retryable()),
        }
    }
}

impl NativeBytesOutcome {
    pub(super) fn success(value: Vec<u8>) -> Self {
        Self {
            status: "ok".to_string(),
            value: Some(value.into()),
            reason_code: None,
            retryable: None,
        }
    }

    pub(super) fn host_error(error: NimiHostError) -> Self {
        Self::error(error.reason_code().as_str(), error.retryable())
    }

    pub(super) fn product_control_error(error: DesktopProductControlError) -> Self {
        Self::error(error.reason_code(), error.retryable())
    }

    pub(super) fn error(reason_code: &str, retryable: bool) -> Self {
        Self {
            status: "error".to_string(),
            value: None,
            reason_code: Some(reason_code.to_string()),
            retryable: Some(retryable),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use nimi_shell_protected_local::{LocalAppPermissionState, LocalAppSessionState};

    #[test]
    pub(super) fn errors_project_only_admitted_reason_and_retryability() {
        let outcome = NativeJsonOutcome::error(LocalAppOperationError::new(
            LocalAppReasonCode::RuntimeServiceUnavailable,
            true,
        ));
        assert_eq!(outcome.status, "error");
        assert_eq!(
            outcome.reason_code.as_deref(),
            Some("runtime-service-unavailable")
        );
        assert_eq!(outcome.retryable, Some(true));
        assert!(outcome.value.is_none());
    }

    #[test]
    pub(super) fn session_status_is_zero_grant_without_authority_material() {
        let value = project_session_status(LocalAppSessionStatus {
            state: LocalAppSessionState::ZeroGrant,
            reason_code: LocalAppReasonCode::NoGrant,
            retryable: false,
        });
        assert_eq!(
            value,
            json!({
                "state": "zero-grant",
                "reasonCode": "no-grant",
                "retryable": false,
            })
        );
    }

    #[test]
    pub(super) fn permission_projection_keeps_exact_operation_and_resource() {
        let value = project_permission_posture(LocalAppPermissionPosture {
            state: LocalAppPermissionState::Granted,
            operation_id: "runtime_agent.conversation.open".to_string(),
            resource_ref: "agent-a".to_string(),
            reason_code: LocalAppReasonCode::ActionExecuted,
            action_hint: "continue_local_app_operation".to_string(),
            retryable: false,
        });
        assert_eq!(value["operationId"], "runtime_agent.conversation.open");
        assert_eq!(value["resourceRef"], "agent-a");
        assert_eq!(value["state"], "granted");
    }

    #[test]
    pub(super) fn artifact_projection_fails_closed_on_impossible_size() {
        let outcome = NativeArtifactOutcome::success(LocalAppArtifactBytes {
            bytes: b"artifact".to_vec(),
            mime_type: "text/plain".to_string(),
            size_bytes: 7,
            mime_inferred: false,
        });
        assert_eq!(outcome.status, "error");
        assert_eq!(
            outcome.reason_code.as_deref(),
            Some("runtime-service-untrusted")
        );
    }

    #[test]
    pub(super) fn desktop_product_control_bytes_outcome_exposes_no_authority_material() {
        let outcome = NativeBytesOutcome::success(vec![1, 2, 3]);
        assert_eq!(outcome.status, "ok");
        assert_eq!(outcome.value.as_ref().map(|value| value.len()), Some(3));
        assert!(outcome.reason_code.is_none());
        assert!(outcome.retryable.is_none());
    }

    #[test]
    pub(super) fn local_app_grant_identifiers_round_trip_only_inside_the_native_binding() {
        let identifier = [0xabu8; 32];
        let encoded = encode_identifier(&identifier);
        assert_eq!(encoded, "ab".repeat(32));
        assert_eq!(decode_identifier(&encoded), Some(identifier));
        assert_eq!(decode_identifier(&"AB".repeat(32)), None);
        assert_eq!(decode_identifier("short"), None);
    }

    #[test]
    pub(super) fn local_app_grant_native_projection_retains_private_selector_material() {
        let value = project_pending_local_app_grant(LocalAppGrantControlPending {
            request_id: [1; 32],
            presence_challenge_id: [2; 32],
            pending_grant_id: [3; 32],
            operation_id: "runtime_agent.conversation.open".to_string(),
            resource_ref: "agent:zhiyu".to_string(),
            expires_at_unix_ms: 1_800_000_000_000,
        });
        assert_eq!(value["requestId"].as_str().map(str::len), Some(64));
        assert_eq!(
            value["presenceChallengeId"].as_str().map(str::len),
            Some(64)
        );
        assert_eq!(value["pendingGrantId"].as_str().map(str::len), Some(64));
        assert!(value.get("token").is_none());
        assert!(value.get("sessionId").is_none());
    }
}
