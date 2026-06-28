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

pub(super) fn uses_real_runtime_account_projection(manifest: &DesktopE2EFixtureManifest) -> bool {
    manifest
        .tauri_fixture
        .as_ref()
        .and_then(|fixture| fixture.macos_smoke.as_ref())
        .and_then(|smoke| smoke.scenario_id.as_deref())
        .map(str::trim)
        .is_some_and(is_live2d_avatar_product_smoke_scenario)
}

pub(super) fn is_live2d_avatar_product_smoke_scenario(scenario_id: &str) -> bool {
    matches!(
        scenario_id,
        "chat.live2d-avatar-product-smoke" | "chat.live2d-avatar-local-asset-missing-smoke"
    )
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

pub(super) fn runtime_account_token_response(
    projection: Option<runtime_bridge_generated::AccountProjection>,
) -> runtime_bridge_generated::GetAccessTokenResponse {
    if projection.is_some() {
        return runtime_bridge_generated::GetAccessTokenResponse {
            accepted: true,
            access_token: "e2e-runtime-account-access-token".to_string(),
            expires_at: None,
            reason_code: runtime_bridge_generated::ReasonCode::ActionExecuted as i32,
            account_reason_code: runtime_bridge_generated::AccountReasonCode::ActionExecuted as i32,
            production_inert: false,
        };
    }
    runtime_bridge_generated::GetAccessTokenResponse {
        accepted: false,
        access_token: String::new(),
        expires_at: None,
        reason_code: runtime_bridge_generated::ReasonCode::PrincipalUnauthorized as i32,
        account_reason_code: runtime_bridge_generated::AccountReasonCode::AccountUnavailable as i32,
        production_inert: false,
    }
}

pub(super) fn runtime_app_storage_response(
    payload: &RuntimeBridgeUnaryPayload,
    manifest: &DesktopE2EFixtureManifest,
) -> Result<RuntimeBridgeUnaryResult, String> {
    let request: runtime_bridge_generated::GetAppStorageRequest = decode_unary_request(payload)?;
    let app_id = request.app_id.trim();
    let data_root = manifest
        .tauri_fixture
        .as_ref()
        .and_then(|fixture| fixture.product_control_record.as_ref())
        .and_then(|record| record.data_root.as_ref())
        .map(|record| record.path.trim().to_string())
        .filter(|value| !value.is_empty());
    let Some(data_root) = data_root else {
        return Ok(encode_unary_response(
            runtime_bridge_generated::GetAppStorageResponse {
                projection: Some(runtime_bridge_generated::AppStorageProjection {
                    app_id: app_id.to_string(),
                    state: runtime_bridge_generated::AppStorageState::StorageUnavailable as i32,
                    reason_code: runtime_bridge_generated::ReasonCode::AppInstallStorageViolation
                        as i32,
                    detail: "fixture product control dataRoot is missing".to_string(),
                    ..Default::default()
                }),
            },
        ));
    };
    let app_root = PathBuf::from(data_root).join("apps").join(app_id);
    let release_root = app_root.join("releases").join("1.0.0");
    Ok(encode_unary_response(
        runtime_bridge_generated::GetAppStorageResponse {
            projection: Some(runtime_bridge_generated::AppStorageProjection {
                app_id: app_id.to_string(),
                state: runtime_bridge_generated::AppStorageState::Ready as i32,
                app_root: app_root.display().to_string(),
                active_release_root: release_root.display().to_string(),
                durable_data_root: app_root.join("data").display().to_string(),
                cache_root: app_root.join("cache").display().to_string(),
                temp_root: app_root.join("tmp").display().to_string(),
                active_version: "1.0.0".to_string(),
                storage_policy_ref: "nimi-data-app-roots".to_string(),
                reason_code: runtime_bridge_generated::ReasonCode::ActionExecuted as i32,
                detail: String::new(),
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
    Ok(encode_unary_response(
        runtime_bridge_generated::GetAppPackageReadinessResponse {
            projection: Some(runtime_bridge_generated::AppPackageReadinessProjection {
                app_id: app_id.to_string(),
                release_descriptor_ref: format!("{app_id}.bundled-with-nimi"),
                storage_policy_ref: "nimi-data-app-roots".to_string(),
                expected_version: "1.0.0".to_string(),
                active_version: "1.0.0".to_string(),
                installed_version: "1.0.0".to_string(),
                sha256: "fixture-sha256".to_string(),
                verification_state: "digest-verified".to_string(),
                state: runtime_bridge_generated::AppPackageReadinessState::Ready as i32,
                reason_code: runtime_bridge_generated::ReasonCode::ActionExecuted as i32,
                detail: String::new(),
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
                account_id: projection.account_id.clone(),
                updated_at: "2026-01-01T00:00:00.000Z".to_string(),
                apps: vec![runtime_bridge_generated::AccountAppInventoryRow {
                    app_id: "nimi.example-app".to_string(),
                    account_state: runtime_bridge_generated::AccountAppInventoryState::Verified
                        as i32,
                    install_state: runtime_bridge_generated::AccountAppInstallState::NotInstalled
                        as i32,
                    last_opened_at: String::new(),
                    data_policy: "keep_on_uninstall".to_string(),
                    verified_at: "2026-01-01T00:00:00.000Z".to_string(),
                    source: "fixture-account".to_string(),
                    detail: String::new(),
                }],
            }),
            reason_code: runtime_bridge_generated::ReasonCode::ActionExecuted as i32,
            detail: String::new(),
        },
    ))
}

pub(super) fn runtime_list_local_app_adoptions_response() -> RuntimeBridgeUnaryResult {
    encode_unary_response(runtime_bridge_generated::ListLocalAppAdoptionsResponse {
        adoptions: Vec::new(),
        reason_code: runtime_bridge_generated::ReasonCode::ActionExecuted as i32,
        detail: String::new(),
    })
}

pub(super) fn runtime_list_app_install_jobs_response(
    payload: &RuntimeBridgeUnaryPayload,
) -> Result<RuntimeBridgeUnaryResult, String> {
    let request: runtime_bridge_generated::ListAppInstallJobsRequest =
        decode_unary_request(payload)?;
    if request.app_id.trim().is_empty() {
        return Err(crate::runtime_bridge::bridge_error(
            "APP_ID_REQUIRED",
            "fixture ListAppInstallJobs requires app_id",
        ));
    }
    Ok(encode_unary_response(
        runtime_bridge_generated::ListAppInstallJobsResponse { jobs: Vec::new() },
    ))
}
