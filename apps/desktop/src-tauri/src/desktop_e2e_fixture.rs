#[cfg(any(test, feature = "desktop-e2e-fixture"))]
mod enabled {
    use crate::desktop_product_control::ProductControlRecord;
    use crate::desktop_release::DesktopReleaseInfo;
    use crate::runtime_bridge::{
        generated as runtime_bridge_generated, RuntimeBridgeDaemonStatus,
        RuntimeBridgeUnaryPayload, RuntimeBridgeUnaryResult,
    };
    use crate::RuntimeDefaults;
    use base64::Engine;
    use prost::Message;
    use serde::{Deserialize, Serialize};
    use std::fs;
    use std::io::Write;
    use std::path::PathBuf;
    use std::sync::{Mutex, OnceLock};

    const E2E_FIXTURE_PATH_ENV: &str = "NIMI_E2E_FIXTURE_PATH";
    const E2E_BACKEND_LOG_PATH_ENV: &str = "NIMI_E2E_BACKEND_LOG_PATH";

    #[derive(Debug, Clone, Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct DesktopE2EFixtureManifest {
        tauri_fixture: Option<DesktopE2ETauriFixture>,
        realm_fixture: Option<DesktopE2ERealmFixture>,
    }

    #[derive(Debug, Clone, Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct DesktopE2ETauriFixture {
        bootstrap_error: Option<String>,
        runtime_defaults: Option<RuntimeDefaults>,
        runtime_bridge_status: Option<RuntimeBridgeDaemonStatus>,
        desktop_release_info: Option<DesktopReleaseInfo>,
        product_control_record: Option<ProductControlRecord>,
        confirm_dialog: Option<DesktopE2EConfirmDialogOverride>,
        macos_smoke: Option<DesktopE2EMacosSmokeOverride>,
    }

    #[derive(Debug, Clone, Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct DesktopE2ERealmFixture {
        current_user: Option<DesktopE2ECurrentUser>,
    }

    #[derive(Debug, Clone, Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct DesktopE2ECurrentUser {
        id: String,
        display_name: Option<String>,
    }

    #[derive(Debug, Clone, Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct DesktopE2EConfirmDialogOverride {
        responses: Option<Vec<DesktopE2EConfirmDialogResponse>>,
    }

    #[derive(Debug, Clone, Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct DesktopE2EConfirmDialogResponse {
        confirmed: bool,
    }

    #[derive(Debug, Clone, Deserialize, Serialize)]
    #[serde(rename_all = "camelCase")]
    pub struct DesktopE2EMacosSmokeOverride {
        pub enabled: bool,
        pub scenario_id: Option<String>,
        pub report_path: Option<String>,
        pub artifacts_dir: Option<String>,
        pub disable_runtime_bootstrap: Option<bool>,
        pub bootstrap_timeout_ms: Option<u64>,
        pub avatar_product_local_asset_fault:
            Option<DesktopE2EMacosSmokeAvatarProductLocalAssetFault>,
    }

    #[derive(Debug, Clone, Deserialize, Serialize)]
    #[serde(rename_all = "camelCase")]
    pub struct DesktopE2EMacosSmokeAvatarProductLocalAssetFault {
        pub fault_kind: String,
        pub package_dir: String,
    }

    fn confirm_dialog_override_index_store() -> &'static Mutex<usize> {
        static STORE: OnceLock<Mutex<usize>> = OnceLock::new();
        STORE.get_or_init(|| Mutex::new(0))
    }

    fn fixture_path() -> Option<String> {
        std::env::var(E2E_FIXTURE_PATH_ENV)
            .ok()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
    }

    fn load_fixture_manifest() -> Result<Option<DesktopE2EFixtureManifest>, String> {
        let Some(path) = fixture_path() else {
            return Ok(None);
        };
        append_backend_log(&format!("load_fixture_manifest path={path}"));
        let raw = fs::read_to_string(path.as_str()).map_err(|error| {
            format!("DESKTOP_E2E_FIXTURE_READ_FAILED: failed to read {path}: {error}")
        })?;
        let parsed =
            serde_json::from_str::<DesktopE2EFixtureManifest>(raw.as_str()).map_err(|error| {
                format!("DESKTOP_E2E_FIXTURE_PARSE_FAILED: failed to parse {path}: {error}")
            })?;
        Ok(Some(parsed))
    }

    pub fn fixture_manifest_path() -> Option<String> {
        fixture_path()
    }

    pub fn append_backend_log_message(message: &str) {
        let Some(path) = std::env::var(E2E_BACKEND_LOG_PATH_ENV)
            .ok()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
        else {
            return;
        };
        if let Ok(mut file) = fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(path.as_str())
        {
            let _ = writeln!(file, "{message}");
        }
    }
    fn append_backend_log(message: &str) {
        append_backend_log_message(message);
    }

    fn encode_unary_response<Response>(response: Response) -> RuntimeBridgeUnaryResult
    where
        Response: Message,
    {
        RuntimeBridgeUnaryResult {
            response_bytes_base64: base64::engine::general_purpose::STANDARD
                .encode(response.encode_to_vec()),
            response_metadata: None,
        }
    }

    fn decode_unary_request<Request>(payload: &RuntimeBridgeUnaryPayload) -> Result<Request, String>
    where
        Request: Message + Default,
    {
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(payload.request_bytes_base64.trim())
            .map_err(|_| "DESKTOP_E2E_RUNTIME_BRIDGE_REQUEST_DECODE_FAILED".to_string())?;
        Request::decode(bytes.as_slice())
            .map_err(|error| format!("DESKTOP_E2E_RUNTIME_BRIDGE_REQUEST_INVALID: {error}"))
    }

    fn runtime_register_app_response(
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

    fn account_projection_from_fixture(
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

    fn uses_real_runtime_account_projection(manifest: &DesktopE2EFixtureManifest) -> bool {
        manifest
            .tauri_fixture
            .as_ref()
            .and_then(|fixture| fixture.macos_smoke.as_ref())
            .and_then(|smoke| smoke.scenario_id.as_deref())
            .map(str::trim)
            .is_some_and(is_live2d_avatar_product_smoke_scenario)
    }

    fn is_live2d_avatar_product_smoke_scenario(scenario_id: &str) -> bool {
        matches!(
            scenario_id,
            "chat.live2d-avatar-product-smoke" | "chat.live2d-avatar-local-asset-missing-smoke"
        )
    }

    fn runtime_account_status_response(
        projection: Option<runtime_bridge_generated::AccountProjection>,
    ) -> runtime_bridge_generated::GetAccountSessionStatusResponse {
        if let Some(account_projection) = projection {
            return runtime_bridge_generated::GetAccountSessionStatusResponse {
                state: runtime_bridge_generated::AccountSessionState::Authenticated as i32,
                account_projection: Some(account_projection),
                reason_code: runtime_bridge_generated::ReasonCode::ActionExecuted as i32,
                account_reason_code: runtime_bridge_generated::AccountReasonCode::ActionExecuted
                    as i32,
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

    fn runtime_account_token_response(
        projection: Option<runtime_bridge_generated::AccountProjection>,
    ) -> runtime_bridge_generated::GetAccessTokenResponse {
        if projection.is_some() {
            return runtime_bridge_generated::GetAccessTokenResponse {
                accepted: true,
                access_token: "e2e-runtime-account-access-token".to_string(),
                expires_at: None,
                reason_code: runtime_bridge_generated::ReasonCode::ActionExecuted as i32,
                account_reason_code: runtime_bridge_generated::AccountReasonCode::ActionExecuted
                    as i32,
                production_inert: false,
            };
        }
        runtime_bridge_generated::GetAccessTokenResponse {
            accepted: false,
            access_token: String::new(),
            expires_at: None,
            reason_code: runtime_bridge_generated::ReasonCode::PrincipalUnauthorized as i32,
            account_reason_code: runtime_bridge_generated::AccountReasonCode::AccountUnavailable
                as i32,
            production_inert: false,
        }
    }

    fn runtime_app_storage_response(
        payload: &RuntimeBridgeUnaryPayload,
        manifest: &DesktopE2EFixtureManifest,
    ) -> Result<RuntimeBridgeUnaryResult, String> {
        let request: runtime_bridge_generated::GetAppStorageRequest =
            decode_unary_request(payload)?;
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
                        reason_code:
                            runtime_bridge_generated::ReasonCode::AppInstallStorageViolation as i32,
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

    fn runtime_app_package_readiness_response(
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

    fn runtime_account_app_inventory_response(
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
                        install_state:
                            runtime_bridge_generated::AccountAppInstallState::NotInstalled as i32,
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

    fn runtime_list_local_app_adoptions_response() -> RuntimeBridgeUnaryResult {
        encode_unary_response(runtime_bridge_generated::ListLocalAppAdoptionsResponse {
            adoptions: Vec::new(),
            reason_code: runtime_bridge_generated::ReasonCode::ActionExecuted as i32,
            detail: String::new(),
        })
    }

    fn runtime_list_app_install_jobs_response(
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

    fn fixture_timestamp() -> prost_types::Timestamp {
        prost_types::Timestamp {
            seconds: 1_786_752_000,
            nanos: 0,
        }
    }

    fn normalize_fixture_text(value: &str) -> String {
        value.trim().to_string()
    }

    fn request_identity(
        context: Option<&runtime_bridge_generated::AgentRequestContext>,
        local_agent_ref: &str,
        owner_user_id: &str,
        realm_agent_id: &str,
    ) -> (String, String, String) {
        let normalized_local_agent_ref = normalize_fixture_text(local_agent_ref);
        let normalized_owner_user_id = normalize_fixture_text(owner_user_id);
        let normalized_realm_agent_id = normalize_fixture_text(realm_agent_id);
        let context_local_agent_ref = context
            .map(|value| normalize_fixture_text(value.local_agent_ref.as_str()))
            .unwrap_or_default();
        let context_owner_user_id = context
            .map(|value| normalize_fixture_text(value.owner_user_id.as_str()))
            .unwrap_or_default();
        let context_realm_agent_id = context
            .map(|value| normalize_fixture_text(value.realm_agent_id.as_str()))
            .unwrap_or_default();
        (
            if normalized_local_agent_ref.is_empty() {
                context_local_agent_ref
            } else {
                normalized_local_agent_ref
            },
            if normalized_owner_user_id.is_empty() {
                context_owner_user_id
            } else {
                normalized_owner_user_id
            },
            if normalized_realm_agent_id.is_empty() {
                context_realm_agent_id
            } else {
                normalized_realm_agent_id
            },
        )
    }

    fn runtime_agent_record(
        local_agent_ref: String,
        owner_user_id: String,
        realm_agent_id: String,
        display_name: String,
    ) -> runtime_bridge_generated::AgentRecord {
        runtime_bridge_generated::AgentRecord {
            agent_id: local_agent_ref.clone(),
            display_name: if display_name.trim().is_empty() {
                local_agent_ref.clone()
            } else {
                display_name
            },
            lifecycle_status: runtime_bridge_generated::AgentLifecycleStatus::Active as i32,
            autonomy: None,
            metadata: None,
            created_at: Some(fixture_timestamp()),
            updated_at: Some(fixture_timestamp()),
            local_agent_ref,
            owner_user_id,
            realm_agent_id,
        }
    }

    fn runtime_agent_get_response(
        payload: &RuntimeBridgeUnaryPayload,
    ) -> Result<RuntimeBridgeUnaryResult, String> {
        let request: runtime_bridge_generated::GetAgentRequest = decode_unary_request(payload)?;
        let (local_agent_ref, owner_user_id, realm_agent_id) =
            request_identity(request.context.as_ref(), request.agent_id.as_str(), "", "");
        Ok(encode_unary_response(
            runtime_bridge_generated::GetAgentResponse {
                agent: Some(runtime_agent_record(
                    local_agent_ref,
                    owner_user_id,
                    realm_agent_id,
                    String::new(),
                )),
            },
        ))
    }

    fn runtime_agent_initialize_response(
        payload: &RuntimeBridgeUnaryPayload,
    ) -> Result<RuntimeBridgeUnaryResult, String> {
        let request: runtime_bridge_generated::InitializeAgentRequest =
            decode_unary_request(payload)?;
        let (local_agent_ref, owner_user_id, realm_agent_id) = request_identity(
            request.context.as_ref(),
            request.local_agent_ref.as_str(),
            request.owner_user_id.as_str(),
            request.realm_agent_id.as_str(),
        );
        Ok(encode_unary_response(
            runtime_bridge_generated::InitializeAgentResponse {
                agent: Some(runtime_agent_record(
                    local_agent_ref,
                    owner_user_id,
                    realm_agent_id,
                    request.display_name,
                )),
                state: Some(runtime_bridge_generated::AgentStateProjection {
                    execution_state: runtime_bridge_generated::AgentExecutionState::Idle as i32,
                    status_text: "ready".to_string(),
                    active_world_id: request.world_id,
                    active_user_id: String::new(),
                    attributes: Default::default(),
                    updated_at: Some(fixture_timestamp()),
                    current_emotion: String::new(),
                }),
            },
        ))
    }

    fn runtime_agent_set_presentation_profile_response(
        payload: &RuntimeBridgeUnaryPayload,
    ) -> Result<RuntimeBridgeUnaryResult, String> {
        let request: runtime_bridge_generated::SetAgentPresentationProfileRequest =
            decode_unary_request(payload)?;
        let profile = match request.mutation {
            Some(
                runtime_bridge_generated::set_agent_presentation_profile_request::Mutation::Profile(
                    profile,
                ),
            ) => Some(profile),
            Some(
                runtime_bridge_generated::set_agent_presentation_profile_request::Mutation::Clear(
                    _,
                ),
            )
            | None => None,
        };
        Ok(encode_unary_response(
            runtime_bridge_generated::SetAgentPresentationProfileResponse { profile },
        ))
    }

    fn runtime_agent_anchor_snapshot(
        local_agent_ref: String,
        owner_user_id: String,
        realm_agent_id: String,
        subject_user_id: String,
        conversation_anchor_id: String,
        metadata: Option<prost_types::Struct>,
    ) -> runtime_bridge_generated::ConversationAnchorSnapshot {
        runtime_bridge_generated::ConversationAnchorSnapshot {
            anchor: Some(runtime_bridge_generated::ConversationAnchor {
                conversation_anchor_id,
                agent_id: local_agent_ref.clone(),
                subject_user_id,
                status: runtime_bridge_generated::ConversationAnchorStatus::Active as i32,
                last_turn_id: String::new(),
                last_message_id: String::new(),
                created_at: Some(fixture_timestamp()),
                updated_at: Some(fixture_timestamp()),
                metadata,
                local_agent_ref,
                owner_user_id,
                realm_agent_id,
            }),
            active_turn_id: String::new(),
            active_stream_id: String::new(),
        }
    }

    fn runtime_agent_open_anchor_response(
        payload: &RuntimeBridgeUnaryPayload,
    ) -> Result<RuntimeBridgeUnaryResult, String> {
        let request: runtime_bridge_generated::OpenConversationAnchorRequest =
            decode_unary_request(payload)?;
        let (local_agent_ref, owner_user_id, realm_agent_id) = request_identity(
            request.context.as_ref(),
            request.local_agent_ref.as_str(),
            request.owner_user_id.as_str(),
            request.realm_agent_id.as_str(),
        );
        let subject_user_id = normalize_fixture_text(request.subject_user_id.as_str())
            .if_empty_then(owner_user_id.as_str());
        let anchor_id = format!("e2e-anchor:{}", local_agent_ref);
        Ok(encode_unary_response(
            runtime_bridge_generated::OpenConversationAnchorResponse {
                snapshot: Some(runtime_agent_anchor_snapshot(
                    local_agent_ref,
                    owner_user_id,
                    realm_agent_id,
                    subject_user_id,
                    anchor_id,
                    request.metadata,
                )),
            },
        ))
    }

    fn runtime_agent_get_anchor_snapshot_response(
        payload: &RuntimeBridgeUnaryPayload,
    ) -> Result<RuntimeBridgeUnaryResult, String> {
        let request: runtime_bridge_generated::GetConversationAnchorSnapshotRequest =
            decode_unary_request(payload)?;
        let (local_agent_ref, owner_user_id, realm_agent_id) =
            request_identity(request.context.as_ref(), request.agent_id.as_str(), "", "");
        let subject_user_id = request
            .context
            .as_ref()
            .map(|value| normalize_fixture_text(value.subject_user_id.as_str()))
            .unwrap_or_default()
            .if_empty_then(owner_user_id.as_str());
        Ok(encode_unary_response(
            runtime_bridge_generated::GetConversationAnchorSnapshotResponse {
                snapshot: Some(runtime_agent_anchor_snapshot(
                    local_agent_ref,
                    owner_user_id,
                    realm_agent_id,
                    subject_user_id,
                    request.conversation_anchor_id,
                    None,
                )),
            },
        ))
    }

    fn runtime_agent_list_conversation_summaries_response(
        payload: &RuntimeBridgeUnaryPayload,
    ) -> Result<RuntimeBridgeUnaryResult, String> {
        let request: runtime_bridge_generated::ListAgentConversationSummariesRequest =
            decode_unary_request(payload)?;
        let (local_agent_ref, owner_user_id, realm_agent_id) =
            request_identity(request.context.as_ref(), request.agent_id.as_str(), "", "");
        let subject_user_id = request
            .context
            .as_ref()
            .map(|value| normalize_fixture_text(value.subject_user_id.as_str()))
            .unwrap_or_default()
            .if_empty_then(owner_user_id.as_str());
        let anchor = runtime_agent_anchor_snapshot(
            local_agent_ref.clone(),
            owner_user_id,
            realm_agent_id,
            subject_user_id,
            format!("e2e-anchor:{}", local_agent_ref),
            None,
        )
        .anchor;
        Ok(encode_unary_response(
            runtime_bridge_generated::ListAgentConversationSummariesResponse {
                summaries: vec![runtime_bridge_generated::AgentConversationSummary {
                    anchor,
                    title: "CBDB Su Zhe".to_string(),
                    last_message_role: String::new(),
                    last_message_text: String::new(),
                    last_message_id: String::new(),
                    transcript_message_count: 0,
                    updated_at: Some(fixture_timestamp()),
                }],
                next_page_token: String::new(),
            },
        ))
    }

    trait EmptyStringFallback {
        fn if_empty_then(self, fallback: &str) -> String;
    }

    impl EmptyStringFallback for String {
        fn if_empty_then(self, fallback: &str) -> String {
            if self.trim().is_empty() {
                fallback.to_string()
            } else {
                self
            }
        }
    }

    pub fn runtime_bridge_unary_override(
        payload: &RuntimeBridgeUnaryPayload,
    ) -> Result<Option<RuntimeBridgeUnaryResult>, String> {
        let Some(manifest) = load_fixture_manifest()? else {
            return Ok(None);
        };
        if uses_real_runtime_account_projection(&manifest) {
            return Ok(None);
        }
        let projection = account_projection_from_fixture(manifest.realm_fixture.as_ref());
        match payload.method_id.trim() {
        nimi_shell_tauri::runtime_bridge::RUNTIME_AUTH_REGISTER_APP_METHOD_ID => {
            append_backend_log("runtime_auth_fixture method=registerApp accepted=true");
            runtime_register_app_response(payload).map(Some)
        }
        nimi_shell_tauri::runtime_bridge::RUNTIME_ACCOUNT_GET_ACCOUNT_SESSION_STATUS_METHOD_ID => {
            append_backend_log(&format!(
                "runtime_account_fixture method=getAccountSessionStatus authenticated={}",
                projection.is_some()
            ));
            Ok(Some(encode_unary_response(
                runtime_account_status_response(projection),
            )))
        }
        nimi_shell_tauri::runtime_bridge::RUNTIME_ACCOUNT_GET_ACCESS_TOKEN_METHOD_ID => {
            append_backend_log(&format!(
                "runtime_account_fixture method=getAccessToken accepted={}",
                projection.is_some()
            ));
            Ok(Some(encode_unary_response(runtime_account_token_response(
                projection,
            ))))
        }
        nimi_shell_tauri::runtime_bridge::RUNTIME_APP_GET_APP_STORAGE_METHOD_ID => {
            append_backend_log("runtime_app_fixture method=getAppStorage accepted=true");
            runtime_app_storage_response(payload, &manifest).map(Some)
        }
        nimi_shell_tauri::runtime_bridge::RUNTIME_APP_GET_ACCOUNT_APP_INVENTORY_METHOD_ID => {
            append_backend_log(&format!(
                "runtime_app_fixture method=getAccountAppInventory authenticated={}",
                projection.is_some()
            ));
            runtime_account_app_inventory_response(projection).map(Some)
        }
        nimi_shell_tauri::runtime_bridge::RUNTIME_APP_LIST_LOCAL_APP_ADOPTIONS_METHOD_ID => {
            append_backend_log("runtime_app_fixture method=listLocalAppAdoptions accepted=true");
            Ok(Some(runtime_list_local_app_adoptions_response()))
        }
        nimi_shell_tauri::runtime_bridge::RUNTIME_APP_LIST_APP_INSTALL_JOBS_METHOD_ID => {
            append_backend_log("runtime_app_fixture method=listAppInstallJobs accepted=true");
            runtime_list_app_install_jobs_response(payload).map(Some)
        }
        nimi_shell_tauri::runtime_bridge::RUNTIME_APP_GET_APP_PACKAGE_READINESS_METHOD_ID => {
            append_backend_log("runtime_app_fixture method=getAppPackageReadiness accepted=true");
            runtime_app_package_readiness_response(payload).map(Some)
        }
        nimi_shell_tauri::runtime_bridge::RUNTIME_AGENT_GET_AGENT_METHOD_ID => {
            append_backend_log("runtime_agent_fixture method=getAgent accepted=true");
            runtime_agent_get_response(payload).map(Some)
        }
        nimi_shell_tauri::runtime_bridge::RUNTIME_AGENT_INITIALIZE_AGENT_METHOD_ID => {
            append_backend_log("runtime_agent_fixture method=initializeAgent accepted=true");
            runtime_agent_initialize_response(payload).map(Some)
        }
        nimi_shell_tauri::runtime_bridge::RUNTIME_AGENT_SET_AGENT_PRESENTATION_PROFILE_METHOD_ID => {
            append_backend_log("runtime_agent_fixture method=setAgentPresentationProfile accepted=true");
            runtime_agent_set_presentation_profile_response(payload).map(Some)
        }
        nimi_shell_tauri::runtime_bridge::RUNTIME_AGENT_OPEN_CONVERSATION_ANCHOR_METHOD_ID => {
            append_backend_log("runtime_agent_fixture method=openConversationAnchor accepted=true");
            runtime_agent_open_anchor_response(payload).map(Some)
        }
        nimi_shell_tauri::runtime_bridge::RUNTIME_AGENT_GET_CONVERSATION_ANCHOR_SNAPSHOT_METHOD_ID => {
            append_backend_log("runtime_agent_fixture method=getConversationAnchorSnapshot accepted=true");
            runtime_agent_get_anchor_snapshot_response(payload).map(Some)
        }
        nimi_shell_tauri::runtime_bridge::RUNTIME_AGENT_LIST_AGENT_CONVERSATION_SUMMARIES_METHOD_ID => {
            append_backend_log("runtime_agent_fixture method=listAgentConversationSummaries accepted=true");
            runtime_agent_list_conversation_summaries_response(payload).map(Some)
        }
        _ => Ok(None),
    }
    }

    pub fn runtime_defaults_override() -> Result<Option<RuntimeDefaults>, String> {
        let Some(manifest) = load_fixture_manifest()? else {
            return Ok(None);
        };
        if let Some(message) = manifest
            .tauri_fixture
            .as_ref()
            .and_then(|fixture| fixture.bootstrap_error.as_ref())
            .map(|value| value.trim())
            .filter(|value| !value.is_empty())
        {
            append_backend_log(&format!(
                "runtime_defaults_override bootstrap_error={message}"
            ));
            return Err(format!("DESKTOP_E2E_BOOTSTRAP_ERROR: {message}"));
        }
        let override_present = manifest
            .tauri_fixture
            .as_ref()
            .and_then(|fixture| fixture.runtime_defaults.as_ref())
            .is_some();
        append_backend_log(&format!(
            "runtime_defaults_override override_present={override_present}"
        ));
        Ok(manifest
            .tauri_fixture
            .and_then(|fixture| fixture.runtime_defaults))
    }

    pub fn runtime_bridge_status_override() -> Result<Option<RuntimeBridgeDaemonStatus>, String> {
        let status = load_fixture_manifest()?
            .and_then(|manifest| manifest.tauri_fixture)
            .and_then(|fixture| fixture.runtime_bridge_status);
        append_backend_log(&format!(
            "runtime_bridge_status_override override_present={}",
            status.is_some()
        ));
        Ok(status)
    }

    pub fn desktop_release_info_override() -> Result<Option<DesktopReleaseInfo>, String> {
        let info = load_fixture_manifest()?
            .and_then(|manifest| manifest.tauri_fixture)
            .and_then(|fixture| fixture.desktop_release_info);
        append_backend_log(&format!(
            "desktop_release_info_override override_present={}",
            info.is_some()
        ));
        Ok(info)
    }

    pub fn product_control_record_override() -> Result<Option<ProductControlRecord>, String> {
        let record = load_fixture_manifest()?
            .and_then(|manifest| manifest.tauri_fixture)
            .and_then(|fixture| fixture.product_control_record);
        append_backend_log(&format!(
            "product_control_record_override override_present={}",
            record.is_some()
        ));
        Ok(record)
    }

    pub fn next_confirm_dialog_override() -> Result<Option<bool>, String> {
        let responses = load_fixture_manifest()?
            .and_then(|manifest| manifest.tauri_fixture)
            .and_then(|fixture| fixture.confirm_dialog)
            .and_then(|fixture| fixture.responses);
        let Some(responses) = responses else {
            append_backend_log("confirm_dialog_override override_present=false");
            if let Ok(mut index) = confirm_dialog_override_index_store().lock() {
                *index = 0;
            }
            return Ok(None);
        };

        let mut index = confirm_dialog_override_index_store()
            .lock()
            .map_err(|_| "DESKTOP_E2E_CONFIRM_DIALOG_OVERRIDE_LOCK_FAILED".to_string())?;
        let selected = responses
            .get(*index)
            .or_else(|| responses.last())
            .map(|item| item.confirmed);
        if *index < responses.len() {
            *index += 1;
        }
        append_backend_log(&format!(
            "confirm_dialog_override override_present=true index={} selected={}",
            index.saturating_sub(1),
            selected.unwrap_or(false)
        ));
        Ok(selected)
    }

    pub fn macos_smoke_override() -> Result<Option<DesktopE2EMacosSmokeOverride>, String> {
        let override_payload = load_fixture_manifest()?
            .and_then(|manifest| manifest.tauri_fixture)
            .and_then(|fixture| fixture.macos_smoke);
        append_backend_log(&format!(
            "macos_smoke_override override_present={}",
            override_payload.is_some()
        ));
        Ok(override_payload)
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        fn manifest_for_scenario(scenario_id: &str) -> DesktopE2EFixtureManifest {
            DesktopE2EFixtureManifest {
                tauri_fixture: Some(DesktopE2ETauriFixture {
                    bootstrap_error: None,
                    runtime_defaults: None,
                    runtime_bridge_status: None,
                    desktop_release_info: None,
                    product_control_record: None,
                    confirm_dialog: None,
                    macos_smoke: Some(DesktopE2EMacosSmokeOverride {
                        enabled: true,
                        scenario_id: Some(scenario_id.to_string()),
                        report_path: None,
                        artifacts_dir: None,
                        disable_runtime_bootstrap: None,
                        bootstrap_timeout_ms: None,
                        avatar_product_local_asset_fault: None,
                    }),
                }),
                realm_fixture: None,
            }
        }

        #[test]
        fn real_runtime_account_projection_covers_avatar_product_smoke_matrix() {
            assert!(uses_real_runtime_account_projection(
                &manifest_for_scenario("chat.live2d-avatar-product-smoke",)
            ));
            assert!(uses_real_runtime_account_projection(
                &manifest_for_scenario("chat.live2d-avatar-local-asset-missing-smoke",)
            ));
            assert!(!uses_real_runtime_account_projection(
                &manifest_for_scenario("chat.live2d-render-smoke",)
            ));
        }

        #[test]
        fn runtime_register_app_fixture_accepts_local_first_party_registration() {
            let request = runtime_bridge_generated::RegisterAppRequest {
                app_id: "nimi.desktop".to_string(),
                app_instance_id: "nimi.desktop.local-first-party".to_string(),
                device_id: "desktop-shell".to_string(),
                app_version: "1".to_string(),
                capabilities: Vec::new(),
                mode_manifest: None,
                developer_registration: false,
            };
            let payload = RuntimeBridgeUnaryPayload {
                method_id: nimi_shell_tauri::runtime_bridge::RUNTIME_AUTH_REGISTER_APP_METHOD_ID
                    .to_string(),
                request_bytes_base64: base64::engine::general_purpose::STANDARD
                    .encode(request.encode_to_vec()),
                metadata: None,
                authorization: None,
                protected_access_token: None,
                app_session: None,
                timeout_ms: None,
            };

            let result = runtime_register_app_response(&payload).expect("register app response");
            let bytes = base64::engine::general_purpose::STANDARD
                .decode(result.response_bytes_base64)
                .expect("decode response");
            let response = runtime_bridge_generated::RegisterAppResponse::decode(bytes.as_slice())
                .expect("decode register response");
            assert!(response.accepted);
            assert_eq!(response.app_instance_id, "nimi.desktop.local-first-party");
            assert_eq!(
                response.reason_code,
                runtime_bridge_generated::ReasonCode::ActionExecuted as i32
            );
        }

        fn fixture_payload<Request>(method_id: &str, request: Request) -> RuntimeBridgeUnaryPayload
        where
            Request: Message,
        {
            RuntimeBridgeUnaryPayload {
                method_id: method_id.to_string(),
                request_bytes_base64: base64::engine::general_purpose::STANDARD
                    .encode(request.encode_to_vec()),
                metadata: None,
                authorization: None,
                protected_access_token: None,
                app_session: None,
                timeout_ms: None,
            }
        }

        fn decode_fixture_response<Response>(result: RuntimeBridgeUnaryResult) -> Response
        where
            Response: Message + Default,
        {
            let bytes = base64::engine::general_purpose::STANDARD
                .decode(result.response_bytes_base64)
                .expect("decode response");
            Response::decode(bytes.as_slice()).expect("decode fixture response")
        }

        #[test]
        fn runtime_agent_fixture_projects_cbdb_chat_open_chain() {
            let local_agent_ref =
                "local-agent:user-e2e-primary:cbdb-song-slice-real-20260614-agent-8af2c5ca8a"
                    .to_string();
            let owner_user_id = "user-e2e-primary".to_string();
            let realm_agent_id = "cbdb-song-slice-real-20260614-agent-8af2c5ca8a".to_string();
            let context = runtime_bridge_generated::AgentRequestContext {
                app_id: "nimi.desktop".to_string(),
                subject_user_id: owner_user_id.clone(),
                scoped_binding: None,
                owner_user_id: owner_user_id.clone(),
                realm_agent_id: realm_agent_id.clone(),
                local_agent_ref: local_agent_ref.clone(),
            };

            let get_agent = runtime_agent_get_response(&fixture_payload(
                nimi_shell_tauri::runtime_bridge::RUNTIME_AGENT_GET_AGENT_METHOD_ID,
                runtime_bridge_generated::GetAgentRequest {
                    context: Some(context.clone()),
                    agent_id: local_agent_ref.clone(),
                },
            ))
            .expect("get agent fixture");
            let get_agent_response: runtime_bridge_generated::GetAgentResponse =
                decode_fixture_response(get_agent);
            let agent = get_agent_response.agent.expect("agent projection");
            assert_eq!(agent.local_agent_ref, local_agent_ref);
            assert_eq!(agent.owner_user_id, owner_user_id);
            assert_eq!(agent.realm_agent_id, realm_agent_id);
            assert_eq!(
                agent.lifecycle_status,
                runtime_bridge_generated::AgentLifecycleStatus::Active as i32
            );

            let open_anchor = runtime_agent_open_anchor_response(&fixture_payload(
                nimi_shell_tauri::runtime_bridge::RUNTIME_AGENT_OPEN_CONVERSATION_ANCHOR_METHOD_ID,
                runtime_bridge_generated::OpenConversationAnchorRequest {
                    context: Some(context.clone()),
                    agent_id: String::new(),
                    subject_user_id: owner_user_id.clone(),
                    metadata: None,
                    local_agent_ref: local_agent_ref.clone(),
                    owner_user_id: owner_user_id.clone(),
                    realm_agent_id: realm_agent_id.clone(),
                },
            ))
            .expect("open anchor fixture");
            let open_anchor_response: runtime_bridge_generated::OpenConversationAnchorResponse =
                decode_fixture_response(open_anchor);
            let anchor = open_anchor_response
                .snapshot
                .and_then(|snapshot| snapshot.anchor)
                .expect("conversation anchor");
            assert_eq!(
                anchor.conversation_anchor_id,
                format!("e2e-anchor:{local_agent_ref}")
            );
            assert_eq!(
                anchor.status,
                runtime_bridge_generated::ConversationAnchorStatus::Active as i32
            );
            assert_eq!(anchor.local_agent_ref, local_agent_ref);

            let summaries = runtime_agent_list_conversation_summaries_response(&fixture_payload(
                nimi_shell_tauri::runtime_bridge::RUNTIME_AGENT_LIST_AGENT_CONVERSATION_SUMMARIES_METHOD_ID,
                runtime_bridge_generated::ListAgentConversationSummariesRequest {
                    context: Some(context),
                    agent_id: local_agent_ref.clone(),
                    status_filter: vec![runtime_bridge_generated::ConversationAnchorStatus::Active as i32],
                    page_size: 1,
                    page_token: String::new(),
                },
            ))
            .expect("conversation summaries fixture");
            let summaries_response: runtime_bridge_generated::ListAgentConversationSummariesResponse =
                decode_fixture_response(summaries);
            assert_eq!(summaries_response.summaries.len(), 1);
            assert_eq!(summaries_response.summaries[0].title, "CBDB Su Zhe");
            assert_eq!(
                summaries_response.summaries[0]
                    .anchor
                    .as_ref()
                    .map(|anchor| anchor.local_agent_ref.as_str()),
                Some(local_agent_ref.as_str())
            );
        }
    }
}

#[cfg(any(test, feature = "desktop-e2e-fixture"))]
pub use enabled::*;

#[cfg(not(any(test, feature = "desktop-e2e-fixture")))]
#[allow(dead_code)]
mod disabled {
    use crate::desktop_product_control::ProductControlRecord;
    use crate::desktop_release::DesktopReleaseInfo;
    use crate::runtime_bridge::{
        RuntimeBridgeDaemonStatus, RuntimeBridgeUnaryPayload, RuntimeBridgeUnaryResult,
    };
    use crate::RuntimeDefaults;

    #[derive(Debug, Clone)]
    pub struct DesktopE2EMacosSmokeOverride {
        pub enabled: bool,
        pub scenario_id: Option<String>,
        pub report_path: Option<String>,
        pub artifacts_dir: Option<String>,
        pub disable_runtime_bootstrap: Option<bool>,
        pub bootstrap_timeout_ms: Option<u64>,
        pub avatar_product_local_asset_fault:
            Option<DesktopE2EMacosSmokeAvatarProductLocalAssetFault>,
    }

    #[derive(Debug, Clone)]
    pub struct DesktopE2EMacosSmokeAvatarProductLocalAssetFault {
        pub fault_kind: String,
        pub package_dir: String,
    }

    pub fn fixture_manifest_path() -> Option<String> {
        None
    }

    pub fn append_backend_log_message(_message: &str) {}

    pub fn runtime_bridge_unary_override(
        _payload: &RuntimeBridgeUnaryPayload,
    ) -> Result<Option<RuntimeBridgeUnaryResult>, String> {
        Ok(None)
    }

    pub fn runtime_defaults_override() -> Result<Option<RuntimeDefaults>, String> {
        Ok(None)
    }

    pub fn runtime_bridge_status_override() -> Result<Option<RuntimeBridgeDaemonStatus>, String> {
        Ok(None)
    }

    pub fn desktop_release_info_override() -> Result<Option<DesktopReleaseInfo>, String> {
        Ok(None)
    }

    pub fn product_control_record_override() -> Result<Option<ProductControlRecord>, String> {
        Ok(None)
    }

    pub fn next_confirm_dialog_override() -> Result<Option<bool>, String> {
        Ok(None)
    }

    pub fn macos_smoke_override() -> Result<Option<DesktopE2EMacosSmokeOverride>, String> {
        Ok(None)
    }
}

#[cfg(not(any(test, feature = "desktop-e2e-fixture")))]
pub use disabled::*;
