use super::*;

pub(super) fn runtime_register_app_response(
    payload: &RuntimeBridgeUnaryPayload,
) -> Result<RuntimeBridgeUnaryResult, String> {
    let request: runtime_bridge_generated::RegisterAppRequest = decode_unary_request(payload)?;
    Ok(encode_unary_response(
        runtime_bridge_generated::RegisterAppResponse {
            app_instance_id: request.app_instance_id,
            accepted: true,
            reason_code: runtime_bridge_generated::ReasonCode::ActionExecuted as i32,
        },
    ))
}

pub(super) fn runtime_open_session_response(
    payload: &RuntimeBridgeUnaryPayload,
) -> Result<RuntimeBridgeUnaryResult, String> {
    let request: runtime_bridge_generated::OpenSessionRequest = decode_unary_request(payload)?;
    let app_id = request.app_id.trim();
    let app_instance_id = request.app_instance_id.trim();
    let device_id = request.device_id.trim();
    if app_id.is_empty() || app_instance_id.is_empty() || device_id.is_empty() {
        return Err("DESKTOP_E2E_RUNTIME_AUTH_OPEN_SESSION_IDENTITY_REQUIRED".to_string());
    }
    Ok(encode_unary_response(
        runtime_bridge_generated::OpenSessionResponse {
            session_id: format!("e2e-session:{app_instance_id}:{device_id}"),
            issued_at: Some(prost_types::Timestamp {
                seconds: 1_767_225_600,
                nanos: 0,
            }),
            expires_at: Some(prost_types::Timestamp {
                seconds: 1_787_011_200,
                nanos: 0,
            }),
            session_token: format!("e2e-session-token:{app_id}:{app_instance_id}"),
            reason_code: runtime_bridge_generated::ReasonCode::ActionExecuted as i32,
        },
    ))
}

pub(super) fn account_projection_from_fixture(
    fixture: Option<&DesktopE2ERealmFixture>,
) -> Option<runtime_bridge_generated::AccountProjection> {
    let user = fixture.and_then(|realm| realm.current_user.as_ref())?;
    let account_id = user.id.trim();
    if account_id.is_empty() {
        return None;
    }
    Some(runtime_bridge_generated::AccountProjection {
        account_id: account_id.to_string(),
        display_name: user
            .display_name
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or(account_id)
            .to_string(),
        realm_environment_id: "e2e-fixture".to_string(),
        workspace_memberships: Vec::new(),
    })
}

pub(super) fn runtime_account_status_response(
    projection: Option<runtime_bridge_generated::AccountProjection>,
) -> runtime_bridge_generated::GetAccountSessionStatusResponse {
    if let Some(account_projection) = projection {
        return runtime_bridge_generated::GetAccountSessionStatusResponse {
            state: runtime_bridge_generated::AccountSessionState::Authenticated as i32,
            account_projection: Some(account_projection),
            reason_code: runtime_bridge_generated::ReasonCode::ActionExecuted as i32,
            account_reason_code: runtime_bridge_generated::AccountReasonCode::ActionExecuted as i32,
            production_inert: false,
        };
    }
    runtime_bridge_generated::GetAccountSessionStatusResponse {
        state: runtime_bridge_generated::AccountSessionState::Anonymous as i32,
        account_projection: None,
        reason_code: runtime_bridge_generated::ReasonCode::ActionExecuted as i32,
        account_reason_code: runtime_bridge_generated::AccountReasonCode::ActionExecuted as i32,
        production_inert: false,
    }
}

pub(super) fn runtime_app_storage_response(
    payload: &RuntimeBridgeUnaryPayload,
) -> Result<RuntimeBridgeUnaryResult, String> {
    let request: runtime_bridge_generated::GetAppStorageRequest = decode_unary_request(payload)?;
    let app_id = request.app_id.trim();
    if app_id.is_empty() {
        return Err(crate::runtime_bridge::bridge_error(
            "APP_ID_REQUIRED",
            "fixture GetAppStorage requires app_id",
        ));
    }
    Ok(encode_unary_response(
        runtime_bridge_generated::GetAppStorageResponse {
            projection: Some(runtime_bridge_generated::AppStorageProjection {
                app_id: app_id.to_string(),
                state: runtime_bridge_generated::AppStorageState::StorageUnavailable as i32,
                reason_code: runtime_bridge_generated::ReasonCode::LocalAppOperationUnavailable
                    as i32,
                detail: "immutable_profile_unavailable".to_string(),
                ..Default::default()
            }),
        },
    ))
}

pub(super) fn runtime_app_package_readiness_response(
    payload: &RuntimeBridgeUnaryPayload,
) -> Result<RuntimeBridgeUnaryResult, String> {
    let request: runtime_bridge_generated::GetAppPackageReadinessRequest =
        decode_unary_request(payload)?;
    let app_id = request.app_id.trim();
    if app_id.is_empty() {
        return Err(crate::runtime_bridge::bridge_error(
            "APP_ID_REQUIRED",
            "fixture GetAppPackageReadiness requires app_id",
        ));
    }
    Ok(encode_unary_response(
        runtime_bridge_generated::GetAppPackageReadinessResponse {
            projection: Some(runtime_bridge_generated::AppPackageReadinessProjection {
                app_id: app_id.to_string(),
                state: runtime_bridge_generated::AppPackageReadinessState::Blocked as i32,
                reason_code: runtime_bridge_generated::ReasonCode::LocalAppOperationUnavailable
                    as i32,
                detail: "immutable_profile_unavailable".to_string(),
                ..Default::default()
            }),
        },
    ))
}

pub(super) fn runtime_account_app_inventory_response(
    projection: Option<runtime_bridge_generated::AccountProjection>,
) -> Result<RuntimeBridgeUnaryResult, String> {
    let Some(projection) = projection else {
        return Err(crate::runtime_bridge::bridge_error(
            "PRINCIPAL_UNAUTHORIZED",
            "fixture account projection is missing",
        ));
    };
    Ok(encode_unary_response(
        runtime_bridge_generated::GetAccountAppInventoryResponse {
            exists: true,
            record: Some(runtime_bridge_generated::AccountAppInventoryRecord {
                schema_version: 2,
                account_id: projection.account_id,
                updated_at: "2026-01-01T00:00:00.000Z".to_string(),
                apps: Vec::new(),
            }),
            reason_code: runtime_bridge_generated::ReasonCode::ActionExecuted as i32,
            detail: String::new(),
        },
    ))
}
