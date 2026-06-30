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
    if let Some(app) = fixture_app(manifest, app_id) {
        let storage = app_storage_projection(manifest, app_id, app);
        return Ok(encode_unary_response(
            runtime_bridge_generated::GetAppStorageResponse {
                projection: Some(runtime_bridge_generated::AppStorageProjection {
                    app_id: app_id.to_string(),
                    state: runtime_bridge_generated::AppStorageState::Ready as i32,
                    app_root: storage.app_root,
                    active_release_root: storage.release_root,
                    durable_data_root: storage.durable_data_root,
                    cache_root: storage.cache_root,
                    temp_root: storage.temp_root,
                    active_version: app.version.clone(),
                    storage_policy_ref: app.storage_policy_ref.clone(),
                    reason_code: runtime_bridge_generated::ReasonCode::ActionExecuted as i32,
                    detail: app.detail.clone().unwrap_or_default(),
                }),
            },
        ));
    }
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
    manifest: &DesktopE2EFixtureManifest,
) -> Result<RuntimeBridgeUnaryResult, String> {
    let request: runtime_bridge_generated::GetAppPackageReadinessRequest =
        decode_unary_request(payload)?;
    let app_id = request.app_id.trim();
    if let Some(app) = fixture_app(manifest, app_id) {
        let state = fixture_package_state(app);
        let installed = state == runtime_bridge_generated::AppPackageReadinessState::Ready as i32;
        return Ok(encode_unary_response(
            runtime_bridge_generated::GetAppPackageReadinessResponse {
                projection: Some(runtime_bridge_generated::AppPackageReadinessProjection {
                    app_id: app_id.to_string(),
                    release_descriptor_ref: app.release_descriptor_ref.clone(),
                    storage_policy_ref: app.storage_policy_ref.clone(),
                    expected_version: app.version.clone(),
                    active_version: if installed {
                        app.version.clone()
                    } else {
                        String::new()
                    },
                    installed_version: if installed {
                        app.version.clone()
                    } else {
                        String::new()
                    },
                    sha256: if installed {
                        app.sha256.clone()
                    } else {
                        String::new()
                    },
                    verification_state: app.verification_state.clone().unwrap_or_else(|| {
                        if installed {
                            "digest-verified"
                        } else {
                            "not-installed"
                        }
                        .to_string()
                    }),
                    state,
                    reason_code: runtime_bridge_generated::ReasonCode::ActionExecuted as i32,
                    detail: app.detail.clone().unwrap_or_default(),
                }),
            },
        ));
    }
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
    manifest: &DesktopE2EFixtureManifest,
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
                apps: fixture_apps(manifest)
                    .map(|apps| apps.iter().map(fixture_account_inventory_row).collect())
                    .unwrap_or_else(|| {
                        vec![runtime_bridge_generated::AccountAppInventoryRow {
                            app_id: "nimi.example-app".to_string(),
                            account_state:
                                runtime_bridge_generated::AccountAppInventoryState::Verified as i32,
                            install_state:
                                runtime_bridge_generated::AccountAppInstallState::NotInstalled
                                    as i32,
                            last_opened_at: String::new(),
                            data_policy: "keep_on_uninstall".to_string(),
                            verified_at: "2026-01-01T00:00:00.000Z".to_string(),
                            source: "fixture-account".to_string(),
                            detail: String::new(),
                        }]
                    }),
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
    manifest: &DesktopE2EFixtureManifest,
) -> Result<RuntimeBridgeUnaryResult, String> {
    let request: runtime_bridge_generated::ListAppInstallJobsRequest =
        decode_unary_request(payload)?;
    if request.app_id.trim().is_empty() {
        return Err(crate::runtime_bridge::bridge_error(
            "APP_ID_REQUIRED",
            "fixture ListAppInstallJobs requires app_id",
        ));
    }
    if let Some(app) = fixture_app(manifest, request.app_id.trim()) {
        return Ok(encode_unary_response(
            runtime_bridge_generated::ListAppInstallJobsResponse {
                jobs: fixture_job_for_app(manifest, app).into_iter().collect(),
            },
        ));
    }
    Ok(encode_unary_response(
        runtime_bridge_generated::ListAppInstallJobsResponse { jobs: Vec::new() },
    ))
}

pub(super) fn runtime_install_app_response(
    payload: &RuntimeBridgeUnaryPayload,
    manifest: &DesktopE2EFixtureManifest,
) -> Result<RuntimeBridgeUnaryResult, String> {
    let request: runtime_bridge_generated::InstallAppRequest = decode_unary_request(payload)?;
    if !request.confirmed {
        return Err(crate::runtime_bridge::bridge_error(
            "APP_INSTALL_CONFIRMATION_REQUIRED",
            "fixture InstallApp requires confirmed=true",
        ));
    }
    let app = fixture_app(manifest, request.app_id.trim()).ok_or_else(|| {
        crate::runtime_bridge::bridge_error(
            "APP_NOT_REGISTERED",
            &format!("fixture app {} is not configured", request.app_id.trim()),
        )
    })?;
    mark_fixture_app_installed(app.app_id.trim())?;
    Ok(encode_unary_response(
        runtime_bridge_generated::InstallAppResponse {
            job: Some(fixture_installed_job(manifest, app)),
        },
    ))
}

pub(super) fn runtime_get_app_install_job_response(
    payload: &RuntimeBridgeUnaryPayload,
    manifest: &DesktopE2EFixtureManifest,
) -> Result<RuntimeBridgeUnaryResult, String> {
    let request: runtime_bridge_generated::GetAppInstallJobRequest = decode_unary_request(payload)?;
    let job_id = request.job_id.trim();
    let app = fixture_apps(manifest)
        .and_then(|apps| apps.iter().find(|app| fixture_job_id(app) == job_id))
        .ok_or_else(|| {
            crate::runtime_bridge::bridge_error(
                "APP_INSTALL_JOB_NOT_FOUND",
                &format!("fixture job {job_id} is not configured"),
            )
        })?;
    Ok(encode_unary_response(
        runtime_bridge_generated::GetAppInstallJobResponse {
            job: Some(fixture_installed_job(manifest, app)),
        },
    ))
}

pub(super) fn runtime_open_app_response(
    payload: &RuntimeBridgeUnaryPayload,
    manifest: &DesktopE2EFixtureManifest,
) -> Result<RuntimeBridgeUnaryResult, String> {
    let request: runtime_bridge_generated::OpenAppRequest = decode_unary_request(payload)?;
    let app_id = request.app_id.trim();
    let app = fixture_app(manifest, app_id).ok_or_else(|| {
        crate::runtime_bridge::bridge_error(
            "APP_NOT_REGISTERED",
            &format!("fixture app {app_id} is not configured"),
        )
    })?;
    let Some(scope) = request.scope else {
        return Ok(encode_open_app_response(blocked_open_projection(
            manifest,
            app,
            runtime_bridge_generated::AppOpenFlowStep::ResolveRegistry,
            runtime_bridge_generated::ReasonCode::AppOpenScopeRefRequired,
            "OpenApp fixture requires explicit app scope",
        )));
    };
    if scope.kind.trim() != "app" || scope.owner_id.trim() != app_id {
        return Ok(encode_open_app_response(blocked_open_projection(
            manifest,
            app,
            runtime_bridge_generated::AppOpenFlowStep::ResolveRegistry,
            runtime_bridge_generated::ReasonCode::AppOpenScopeRefInvalid,
            "OpenApp fixture scope must match app id",
        )));
    }
    if !matches!(
        fixture_account_install_state(app),
        state if state == runtime_bridge_generated::AccountAppInstallState::Installed as i32
    ) {
        return Ok(encode_open_app_response(blocked_open_projection(
            manifest,
            app,
            runtime_bridge_generated::AppOpenFlowStep::VerifyLibrary,
            runtime_bridge_generated::ReasonCode::AppOpenLibraryStateInvalid,
            "fixture account inventory is not installed",
        )));
    }
    if fixture_package_state(app)
        != runtime_bridge_generated::AppPackageReadinessState::Ready as i32
    {
        return Ok(encode_open_app_response(blocked_open_projection(
            manifest,
            app,
            runtime_bridge_generated::AppOpenFlowStep::VerifyPackage,
            runtime_bridge_generated::ReasonCode::AppOpenPackageNotVerified,
            "fixture package readiness is not ready",
        )));
    }
    match app.open_block_reason.as_deref().unwrap_or("").trim() {
        "" => {}
        "permission_pending" => {
            return Ok(encode_open_app_response(blocked_open_projection(
                manifest,
                app,
                runtime_bridge_generated::AppOpenFlowStep::VerifyPermissions,
                runtime_bridge_generated::ReasonCode::AppOpenPermissionNotGranted,
                "fixture permission review is pending",
            )));
        }
        other => {
            return Err(crate::runtime_bridge::bridge_error(
                "APP_OPEN_FIXTURE_BLOCK_REASON_INVALID",
                &format!("unsupported fixture openBlockReason {other}"),
            ));
        }
    }
    let storage = app_storage_projection(manifest, app_id, app);
    Ok(encode_open_app_response(
        runtime_bridge_generated::AppOpenProjection {
            app_id: app_id.to_string(),
            state: runtime_bridge_generated::AppOpenState::Launched as i32,
            reached_step: runtime_bridge_generated::AppOpenFlowStep::Launch as i32,
            launched: true,
            active_version: app.version.clone(),
            scope: Some(scope),
            reason_code: runtime_bridge_generated::ReasonCode::ActionExecuted as i32,
            detail: app.detail.clone().unwrap_or_default(),
            release_descriptor_ref: app.release_descriptor_ref.clone(),
            descriptor_class: app.descriptor_class.clone(),
            admission_track: app.admission_track.clone(),
            source_kind: app.source_kind.clone(),
            ordinary_visibility: app.ordinary_visibility.clone(),
            digest_verification_state: app
                .verification_state
                .clone()
                .unwrap_or_else(|| "digest-verified".to_string()),
            runtime_entry_ref: app.runtime_entry_ref.clone(),
            active_release_root: storage.release_root.clone(),
            storage: Some(storage),
            shell_capability_set_ref: app.shell_capability_set_ref.clone(),
            caller_mode: app.caller_mode.clone(),
            launch_nonce: app.launch_nonce.clone(),
            product_readiness_claim_allowed: app.product_readiness_claim_allowed,
        },
    ))
}

fn encode_open_app_response(
    projection: runtime_bridge_generated::AppOpenProjection,
) -> RuntimeBridgeUnaryResult {
    log_open_app_projection(&projection);
    encode_unary_response(runtime_bridge_generated::OpenAppResponse {
        projection: Some(projection),
    })
}

fn log_open_app_projection(projection: &runtime_bridge_generated::AppOpenProjection) {
    let state = runtime_bridge_generated::AppOpenState::try_from(projection.state)
        .map(|value| value.as_str_name())
        .unwrap_or("APP_OPEN_STATE_UNKNOWN");
    let reached_step = runtime_bridge_generated::AppOpenFlowStep::try_from(projection.reached_step)
        .map(|value| value.as_str_name())
        .unwrap_or("APP_OPEN_FLOW_STEP_UNKNOWN");
    let reason_code = runtime_bridge_generated::ReasonCode::try_from(projection.reason_code)
        .map(|value| value.as_str_name())
        .unwrap_or("REASON_CODE_UNKNOWN");
    super::append_backend_log_message(&format!(
        "runtime_app_fixture openAppProjection app_id={} state={} reached_step={} launched={} reason_code={}",
        projection.app_id, state, reached_step, projection.launched, reason_code
    ));
}

fn fixture_apps(manifest: &DesktopE2EFixtureManifest) -> Option<&Vec<DesktopE2EAppPlatformApp>> {
    manifest
        .tauri_fixture
        .as_ref()
        .and_then(|fixture| fixture.app_platform.as_ref())
        .and_then(|fixture| fixture.apps.as_ref())
}

fn fixture_app<'a>(
    manifest: &'a DesktopE2EFixtureManifest,
    app_id: &str,
) -> Option<&'a DesktopE2EAppPlatformApp> {
    fixture_apps(manifest)?
        .iter()
        .find(|app| app.app_id.trim() == app_id)
}

fn selected_data_root(manifest: &DesktopE2EFixtureManifest) -> String {
    manifest
        .tauri_fixture
        .as_ref()
        .and_then(|fixture| fixture.product_control_record.as_ref())
        .and_then(|record| record.data_root.as_ref())
        .map(|record| record.path.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| {
            std::env::temp_dir()
                .join("nimi-e2e-data")
                .display()
                .to_string()
        })
}

fn app_storage_projection(
    manifest: &DesktopE2EFixtureManifest,
    app_id: &str,
    app: &DesktopE2EAppPlatformApp,
) -> runtime_bridge_generated::AppInstallStorageProjection {
    let app_root = PathBuf::from(selected_data_root(manifest))
        .join("apps")
        .join(app_id);
    let release_root = app_root.join("releases").join(app.version.trim());
    runtime_bridge_generated::AppInstallStorageProjection {
        app_root: app_root.display().to_string(),
        release_root: release_root.display().to_string(),
        durable_data_root: app_root.join("data").display().to_string(),
        cache_root: app_root.join("cache").display().to_string(),
        temp_root: app_root.join("tmp").display().to_string(),
    }
}

fn fixture_job_id(app: &DesktopE2EAppPlatformApp) -> String {
    format!("e2e-install:{}", app.app_id.trim())
}

fn fixture_job_for_app(
    manifest: &DesktopE2EFixtureManifest,
    app: &DesktopE2EAppPlatformApp,
) -> Option<runtime_bridge_generated::AppInstallJob> {
    if fixture_account_install_state(app)
        == runtime_bridge_generated::AccountAppInstallState::Installed as i32
    {
        Some(fixture_installed_job(manifest, app))
    } else {
        None
    }
}

fn fixture_installed_job(
    manifest: &DesktopE2EFixtureManifest,
    app: &DesktopE2EAppPlatformApp,
) -> runtime_bridge_generated::AppInstallJob {
    runtime_bridge_generated::AppInstallJob {
        job_id: fixture_job_id(app),
        app_id: app.app_id.clone(),
        release_descriptor_ref: app.release_descriptor_ref.clone(),
        installed_version: app.version.clone(),
        state: runtime_bridge_generated::AppInstallJobState::Installed as i32,
        phase: runtime_bridge_generated::AppInstallJobPhase::Installed as i32,
        source_kind: runtime_bridge_generated::AppInstallSourceKind::ExternalArtifact as i32,
        sha256: app.sha256.clone(),
        artifact_bytes: app.artifact_bytes.unwrap_or_default(),
        storage: Some(app_storage_projection(manifest, app.app_id.trim(), app)),
        reason_code: runtime_bridge_generated::ReasonCode::ActionExecuted as i32,
        failure_detail: String::new(),
        retryable: false,
        created_at: "2026-06-30T00:00:00.000Z".to_string(),
        updated_at: "2026-06-30T00:00:00.000Z".to_string(),
        kind: runtime_bridge_generated::AppLifecycleJobKind::Install as i32,
        previous_version: String::new(),
    }
}

fn fixture_account_inventory_row(
    app: &DesktopE2EAppPlatformApp,
) -> runtime_bridge_generated::AccountAppInventoryRow {
    runtime_bridge_generated::AccountAppInventoryRow {
        app_id: app.app_id.clone(),
        account_state: fixture_account_state(app),
        install_state: fixture_account_install_state(app),
        last_opened_at: String::new(),
        data_policy: "keep_on_uninstall".to_string(),
        verified_at: "2026-06-30T00:00:00.000Z".to_string(),
        source: app
            .admission_track
            .trim()
            .is_empty()
            .then(|| "fixture-account".to_string())
            .unwrap_or_else(|| app.admission_track.clone()),
        detail: app.detail.clone().unwrap_or_default(),
    }
}

fn fixture_account_state(app: &DesktopE2EAppPlatformApp) -> i32 {
    match app.account_state.as_deref().unwrap_or("verified").trim() {
        "entitled" => runtime_bridge_generated::AccountAppInventoryState::Entitled as i32,
        "disabled" => runtime_bridge_generated::AccountAppInventoryState::Disabled as i32,
        "removed" => runtime_bridge_generated::AccountAppInventoryState::Removed as i32,
        "revoked" => runtime_bridge_generated::AccountAppInventoryState::Revoked as i32,
        _ => runtime_bridge_generated::AccountAppInventoryState::Verified as i32,
    }
}

fn fixture_account_install_state(app: &DesktopE2EAppPlatformApp) -> i32 {
    if is_fixture_app_installed(app.app_id.trim()) {
        return runtime_bridge_generated::AccountAppInstallState::Installed as i32;
    }
    match app
        .install_state
        .as_deref()
        .unwrap_or("not-installed")
        .trim()
    {
        "installed" => runtime_bridge_generated::AccountAppInstallState::Installed as i32,
        "adopted-local" => runtime_bridge_generated::AccountAppInstallState::AdoptedLocal as i32,
        "removed" => runtime_bridge_generated::AccountAppInstallState::Removed as i32,
        _ => runtime_bridge_generated::AccountAppInstallState::NotInstalled as i32,
    }
}

fn fixture_package_state(app: &DesktopE2EAppPlatformApp) -> i32 {
    if is_fixture_app_installed(app.app_id.trim()) {
        return runtime_bridge_generated::AppPackageReadinessState::Ready as i32;
    }
    match app
        .package_state
        .as_deref()
        .unwrap_or("install_required")
        .trim()
    {
        "ready" => runtime_bridge_generated::AppPackageReadinessState::Ready as i32,
        "update_required" => {
            runtime_bridge_generated::AppPackageReadinessState::UpdateRequired as i32
        }
        "repair_required" => {
            runtime_bridge_generated::AppPackageReadinessState::RepairRequired as i32
        }
        "blocked" => runtime_bridge_generated::AppPackageReadinessState::Blocked as i32,
        _ => runtime_bridge_generated::AppPackageReadinessState::InstallRequired as i32,
    }
}

fn installed_fixture_store() -> &'static std::sync::Mutex<std::collections::HashSet<String>> {
    static STORE: std::sync::OnceLock<std::sync::Mutex<std::collections::HashSet<String>>> =
        std::sync::OnceLock::new();
    STORE.get_or_init(|| std::sync::Mutex::new(std::collections::HashSet::new()))
}

fn installed_fixture_key(app_id: &str) -> String {
    format!(
        "{}:{}",
        fixture_path().unwrap_or_else(|| "no-fixture-path".to_string()),
        app_id.trim()
    )
}

fn mark_fixture_app_installed(app_id: &str) -> Result<(), String> {
    installed_fixture_store()
        .lock()
        .map_err(|_| "DESKTOP_E2E_APP_PLATFORM_INSTALL_STORE_LOCK_FAILED".to_string())?
        .insert(installed_fixture_key(app_id));
    Ok(())
}

fn is_fixture_app_installed(app_id: &str) -> bool {
    installed_fixture_store()
        .lock()
        .map(|store| store.contains(&installed_fixture_key(app_id)))
        .unwrap_or(false)
}

fn blocked_open_projection(
    manifest: &DesktopE2EFixtureManifest,
    app: &DesktopE2EAppPlatformApp,
    step: runtime_bridge_generated::AppOpenFlowStep,
    reason: runtime_bridge_generated::ReasonCode,
    detail: &str,
) -> runtime_bridge_generated::AppOpenProjection {
    runtime_bridge_generated::AppOpenProjection {
        app_id: app.app_id.clone(),
        state: runtime_bridge_generated::AppOpenState::Blocked as i32,
        reached_step: step as i32,
        launched: false,
        active_version: String::new(),
        scope: None,
        reason_code: reason as i32,
        detail: detail.to_string(),
        release_descriptor_ref: app.release_descriptor_ref.clone(),
        descriptor_class: app.descriptor_class.clone(),
        admission_track: app.admission_track.clone(),
        source_kind: app.source_kind.clone(),
        ordinary_visibility: app.ordinary_visibility.clone(),
        digest_verification_state: app
            .verification_state
            .clone()
            .unwrap_or_else(|| "blocked".to_string()),
        runtime_entry_ref: app.runtime_entry_ref.clone(),
        active_release_root: app_storage_projection(manifest, app.app_id.trim(), app).release_root,
        storage: None,
        shell_capability_set_ref: app.shell_capability_set_ref.clone(),
        caller_mode: app.caller_mode.clone(),
        launch_nonce: app.launch_nonce.clone(),
        product_readiness_claim_allowed: false,
    }
}
