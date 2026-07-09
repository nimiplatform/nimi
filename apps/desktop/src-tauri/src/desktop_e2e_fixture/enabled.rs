use crate::desktop_product_control::{
    ProductControlRecord, ProductControlRecordProjection, ProductControlSelectedDataRootProjection,
    ProductControlState,
};
use crate::desktop_release::DesktopReleaseInfo;
use crate::runtime_bridge::{
    generated as runtime_bridge_generated, RuntimeBridgeDaemonStatus, RuntimeBridgeUnaryPayload,
    RuntimeBridgeUnaryResult,
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
    app_platform: Option<DesktopE2EAppPlatformFixture>,
    confirm_dialog: Option<DesktopE2EConfirmDialogOverride>,
    macos_smoke: Option<DesktopE2EMacosSmokeOverride>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DesktopE2EAppPlatformFixture {
    apps: Option<Vec<DesktopE2EAppPlatformApp>>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DesktopE2EAppPlatformApp {
    app_id: String,
    release_descriptor_ref: String,
    version: String,
    sha256: String,
    artifact_bytes: Option<i64>,
    runtime_entry_ref: String,
    storage_policy_ref: String,
    descriptor_class: String,
    admission_track: String,
    source_kind: String,
    ordinary_visibility: String,
    shell_capability_set_ref: String,
    caller_mode: String,
    launch_nonce: String,
    product_readiness_claim_allowed: bool,
    account_state: Option<String>,
    install_state: Option<String>,
    package_state: Option<String>,
    verification_state: Option<String>,
    open_block_reason: Option<String>,
    detail: Option<String>,
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
        let message = format!("DESKTOP_E2E_FIXTURE_READ_FAILED: failed to read {path}: {error}");
        append_backend_log(&message);
        message
    })?;
    let parsed =
        serde_json::from_str::<DesktopE2EFixtureManifest>(raw.as_str()).map_err(|error| {
            let message =
                format!("DESKTOP_E2E_FIXTURE_PARSE_FAILED: failed to parse {path}: {error}");
            append_backend_log(&message);
            message
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

fn product_control_projection_path() -> Result<String, String> {
    Ok(crate::desktop_paths::resolve_nimi_dir()?
        .join("nimi.json")
        .display()
        .to_string())
}

fn product_control_record_from_fixture(
    manifest: &DesktopE2EFixtureManifest,
) -> Option<ProductControlRecord> {
    manifest
        .tauri_fixture
        .as_ref()
        .and_then(|fixture| fixture.product_control_record.clone())
}

fn encode_product_control_projection<Projection>(
    projection: Projection,
) -> Result<RuntimeBridgeUnaryResult, String>
where
    Projection: Serialize,
{
    let json = serde_json::to_string(&projection)
        .map_err(|error| format!("DESKTOP_E2E_PRODUCT_CONTROL_FIXTURE_JSON_FAILED: {error}"))?;
    Ok(encode_unary_response(
        runtime_bridge_generated::ProductControlProjectionJson { json },
    ))
}

fn runtime_product_control_record_response(
    manifest: &DesktopE2EFixtureManifest,
) -> Result<RuntimeBridgeUnaryResult, String> {
    let path = product_control_projection_path()?;
    let projection = if let Some(record) = product_control_record_from_fixture(manifest) {
        ProductControlRecordProjection {
            path,
            exists: true,
            state: record.state.clone(),
            record: Some(record),
            error: None,
        }
    } else {
        ProductControlRecordProjection {
            path,
            exists: false,
            state: ProductControlState::ConfigMissing,
            record: None,
            error: Some(
                "~/.nimi/nimi.json is missing; first-run data-root selection has not initialized product control"
                    .to_string(),
            ),
        }
    };
    encode_product_control_projection(projection)
}

fn runtime_product_control_selected_data_root_response(
    manifest: &DesktopE2EFixtureManifest,
) -> Result<RuntimeBridgeUnaryResult, String> {
    let path = product_control_projection_path()?;
    let projection = if let Some(record) = product_control_record_from_fixture(manifest) {
        let data_root = crate::desktop_product_control::selected_data_root_path(&record)
            .map(|_| record.data_root.clone())
            .unwrap_or(None);
        let error = if data_root.is_some() {
            None
        } else {
            Some("~/.nimi/nimi.json has no selected absolute dataRoot.path".to_string())
        };
        ProductControlSelectedDataRootProjection {
            path,
            exists: true,
            state: record.state,
            data_root,
            error,
        }
    } else {
        ProductControlSelectedDataRootProjection {
            path,
            exists: false,
            state: ProductControlState::ConfigMissing,
            data_root: None,
            error: Some(
                "~/.nimi/nimi.json is missing; selected nimi_data is not ready".to_string(),
            ),
        }
    };
    encode_product_control_projection(projection)
}

fn execution_evidence_blocked_response(
    reason_code: &str,
    detail: impl Into<String>,
) -> RuntimeBridgeUnaryResult {
    encode_unary_response(
        runtime_bridge_generated::ResolveFirstRunExecutionEvidenceResponse {
            r#ref: None,
            state: "local_ai_blocked".to_string(),
            reason_code: reason_code.to_string(),
            detail: detail.into(),
        },
    )
}

fn expected_field_matches(expected: &str, actual: &str) -> bool {
    let expected = expected.trim();
    expected.is_empty() || expected == actual.trim()
}

fn execution_evidence_proof(
    capability: &str,
    scenario_type: runtime_bridge_generated::ScenarioType,
    consumer_id: &str,
    bound_asset_id: &str,
    local_route_target: &str,
) -> runtime_bridge_generated::ExecutionBaselineCapabilityProof {
    runtime_bridge_generated::ExecutionBaselineCapabilityProof {
        capability: capability.to_string(),
        scenario_type: scenario_type as i32,
        bound_consumer_id: consumer_id.to_string(),
        bound_asset_id: bound_asset_id.to_string(),
        local_route_target: local_route_target.to_string(),
        route_policy: runtime_bridge_generated::RoutePolicy::Local as i32,
        model_resolved: bound_asset_id.to_string(),
        terminal_result: "local_executed".to_string(),
        reason_code: "FIRST_RUN_EXECUTION_PROOF_READY".to_string(),
        trace_id: format!("e2e-trace:{consumer_id}"),
        executed_at: "2026-03-15T00:00:00.000Z".to_string(),
    }
}

fn execution_evidence_ref_from_record(
    record: &ProductControlRecord,
    execution_evidence_ref: &str,
    runtime_baseline_ref: &str,
    data_root_ref: &str,
    install_level: &str,
) -> runtime_bridge_generated::ExecutionEvidenceRef {
    runtime_bridge_generated::ExecutionEvidenceRef {
        execution_evidence_ref: execution_evidence_ref.to_string(),
        selected_local_factory_ai_profile_ref: record
            .first_run
            .baseline_profile_ref
            .clone()
            .unwrap_or_else(|| format!("factory:{}", install_level.trim())),
        install_level: install_level.to_string(),
        runtime_baseline_ref: runtime_baseline_ref.to_string(),
        data_root_ref: data_root_ref.to_string(),
        local_execution_target_evidence: vec!["local".to_string(), "speech".to_string()],
        selected_baseline_capability_proof: vec![
            execution_evidence_proof(
                "local_text_chat_execution",
                runtime_bridge_generated::ScenarioType::TextGenerate,
                "llama.cpp.cpu",
                "e2e-local-text-model",
                "local",
            ),
            execution_evidence_proof(
                "local_basic_stt_execution",
                runtime_bridge_generated::ScenarioType::SpeechTranscribe,
                "speech.qwen3-asr.python",
                "e2e-local-asr-model",
                "speech",
            ),
            execution_evidence_proof(
                "local_basic_tts_execution",
                runtime_bridge_generated::ScenarioType::SpeechSynthesize,
                "speech.qwen3-tts.python",
                "e2e-local-tts-model",
                "speech",
            ),
        ],
        submit_specific_scheduling_judgement: None,
        terminal_result: "local_ai_ready".to_string(),
        observed_at: "2026-03-15T00:00:00.000Z".to_string(),
        runtime_audit_sequence: vec!["desktop-e2e-fixture:first-run-execution".to_string()],
        runtime_verifier_identity: "desktop-e2e-fixture-runtime".to_string(),
    }
}

fn runtime_first_run_execution_evidence_response(
    payload: &RuntimeBridgeUnaryPayload,
    manifest: &DesktopE2EFixtureManifest,
) -> Result<RuntimeBridgeUnaryResult, String> {
    let request: runtime_bridge_generated::ResolveFirstRunExecutionEvidenceRequest =
        decode_unary_request(payload)?;
    let Some(record) = product_control_record_from_fixture(manifest) else {
        return Ok(execution_evidence_blocked_response(
            "PRODUCT_CONTROL_RECORD_MISSING",
            "~/.nimi/nimi.json fixture is missing",
        ));
    };
    if !matches!(
        record.state,
        ProductControlState::LocalAiReady | ProductControlState::ReadyForUse
    ) {
        return Ok(execution_evidence_blocked_response(
            "PRODUCT_CONTROL_NOT_LOCAL_AI_READY",
            format!("product-control state is {:?}", record.state),
        ));
    }
    let execution_evidence_ref = record
        .first_run
        .execution_evidence_ref
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            "DESKTOP_E2E_EXECUTION_EVIDENCE_FIXTURE_MISSING_EXECUTION_REF".to_string()
        })?;
    let runtime_baseline_ref = record
        .first_run
        .runtime_baseline_ref
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "DESKTOP_E2E_EXECUTION_EVIDENCE_FIXTURE_MISSING_BASELINE_REF".to_string())?;
    let install_level = record
        .first_run
        .install_level
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            "DESKTOP_E2E_EXECUTION_EVIDENCE_FIXTURE_MISSING_INSTALL_LEVEL".to_string()
        })?;
    let data_root_ref = crate::desktop_product_control::selected_data_root_path(&record)
        .map(|path| path.display().to_string())
        .ok_or_else(|| "DESKTOP_E2E_EXECUTION_EVIDENCE_FIXTURE_MISSING_DATA_ROOT".to_string())?;

    if request.execution_evidence_ref.trim() != execution_evidence_ref {
        return Ok(execution_evidence_blocked_response(
            "EXECUTION_EVIDENCE_REF_MISMATCH",
            "requested executionEvidenceRef does not match product-control record",
        ));
    }
    if !expected_field_matches(&request.expected_runtime_baseline_ref, runtime_baseline_ref) {
        return Ok(execution_evidence_blocked_response(
            "RUNTIME_BASELINE_REF_MISMATCH",
            "expected runtimeBaselineRef does not match product-control record",
        ));
    }
    if !expected_field_matches(&request.expected_data_root_ref, &data_root_ref) {
        return Ok(execution_evidence_blocked_response(
            "DATA_ROOT_REF_MISMATCH",
            "expected dataRootRef does not match selected product data root",
        ));
    }
    if !expected_field_matches(&request.expected_install_level, install_level) {
        return Ok(execution_evidence_blocked_response(
            "INSTALL_LEVEL_MISMATCH",
            "expected install level does not match product-control record",
        ));
    }

    Ok(encode_unary_response(
        runtime_bridge_generated::ResolveFirstRunExecutionEvidenceResponse {
            r#ref: Some(execution_evidence_ref_from_record(
                &record,
                execution_evidence_ref,
                runtime_baseline_ref,
                &data_root_ref,
                install_level,
            )),
            state: "local_ai_ready".to_string(),
            reason_code: "FIRST_RUN_EXECUTION_EVIDENCE_READY".to_string(),
            detail: "desktop e2e fixture execution evidence matched product-control record"
                .to_string(),
        },
    ))
}

fn runtime_authorize_external_principal_response(
    payload: &RuntimeBridgeUnaryPayload,
) -> Result<RuntimeBridgeUnaryResult, String> {
    let request: runtime_bridge_generated::AuthorizeExternalPrincipalRequest =
        decode_unary_request(payload)?;
    let subject_user_id = request.subject_user_id.trim();
    let app_id = request.app_id.trim();
    if subject_user_id.is_empty() || app_id.is_empty() {
        return Err("DESKTOP_E2E_RUNTIME_GRANT_PRINCIPAL_REQUIRED".to_string());
    }
    Ok(encode_unary_response(
        runtime_bridge_generated::AuthorizeExternalPrincipalResponse {
            token_id: format!("e2e-protected-access:{app_id}:{subject_user_id}"),
            app_id: app_id.to_string(),
            subject_user_id: subject_user_id.to_string(),
            external_principal_id: request.external_principal_id,
            effective_scopes: request.scopes,
            resource_selectors: request.resource_selectors,
            consent_ref: None,
            policy_version: request.policy_version,
            issued_scope_catalog_version: request.scope_catalog_version,
            can_delegate: request.can_delegate,
            expires_at: Some(prost_types::Timestamp {
                seconds: 1_787_011_200,
                nanos: 0,
            }),
            secret: "e2e-protected-access-secret".to_string(),
        },
    ))
}

pub(super) fn encode_unary_response<Response>(response: Response) -> RuntimeBridgeUnaryResult
where
    Response: Message,
{
    RuntimeBridgeUnaryResult {
        response_bytes_base64: base64::engine::general_purpose::STANDARD
            .encode(response.encode_to_vec()),
        response_metadata: None,
    }
}

pub(super) fn decode_unary_request<Request>(
    payload: &RuntimeBridgeUnaryPayload,
) -> Result<Request, String>
where
    Request: Message + Default,
{
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(payload.request_bytes_base64.trim())
        .map_err(|_| "DESKTOP_E2E_RUNTIME_BRIDGE_REQUEST_DECODE_FAILED".to_string())?;
    Request::decode(bytes.as_slice())
        .map_err(|error| format!("DESKTOP_E2E_RUNTIME_BRIDGE_REQUEST_INVALID: {error}"))
}

#[path = "runtime_agent.rs"]
mod runtime_agent;
#[path = "runtime_app.rs"]
mod runtime_app;

use runtime_agent::*;
use runtime_app::*;

pub fn runtime_bridge_unary_override(
    payload: &RuntimeBridgeUnaryPayload,
) -> Result<Option<RuntimeBridgeUnaryResult>, String> {
    let Some(manifest) = load_fixture_manifest()? else {
        return Ok(None);
    };
    let method_id = payload.method_id.trim();
    if method_id.contains("/nimi.runtime.v1.RuntimeAgentService/") {
        append_backend_log(&format!(
            "runtime_agent_fixture method=received method_id={method_id}"
        ));
    }
    let projection = account_projection_from_fixture(manifest.realm_fixture.as_ref());
    match method_id {
    nimi_shell_tauri::capabilities::runtime::RUNTIME_AUTH_REGISTER_APP_METHOD_ID => {
        append_backend_log("runtime_auth_fixture method=registerApp accepted=true");
        runtime_register_app_response(payload).map(Some)
    }
    "/nimi.runtime.v1.RuntimeAuthService/OpenSession" => {
        append_backend_log("runtime_auth_fixture method=openSession accepted=true");
        runtime_open_session_response(payload).map(Some)
    }
    nimi_shell_tauri::capabilities::runtime::RUNTIME_ACCOUNT_GET_ACCOUNT_SESSION_STATUS_METHOD_ID => {
        append_backend_log(&format!(
            "runtime_account_fixture method=getAccountSessionStatus authenticated={}",
            projection.is_some()
        ));
        Ok(Some(encode_unary_response(
            runtime_account_status_response(projection),
        )))
    }
    nimi_shell_tauri::capabilities::runtime::RUNTIME_ACCOUNT_GET_ACCESS_TOKEN_METHOD_ID => {
        append_backend_log(&format!(
            "runtime_account_fixture method=getAccessToken accepted={}",
            projection.is_some()
        ));
        Ok(Some(encode_unary_response(runtime_account_token_response(
            projection,
        ))))
    }
    "/nimi.runtime.v1.RuntimeGrantService/AuthorizeExternalPrincipal" => {
        append_backend_log("runtime_grant_fixture method=authorizeExternalPrincipal accepted=true");
        runtime_authorize_external_principal_response(payload).map(Some)
    }
    nimi_shell_tauri::capabilities::runtime::RUNTIME_APP_GET_APP_STORAGE_METHOD_ID => {
        append_backend_log("runtime_app_fixture method=getAppStorage accepted=true");
        runtime_app_storage_response(payload, &manifest).map(Some)
    }
    nimi_shell_tauri::capabilities::runtime::RUNTIME_APP_GET_ACCOUNT_APP_INVENTORY_METHOD_ID => {
        append_backend_log(&format!(
            "runtime_app_fixture method=getAccountAppInventory authenticated={}",
            projection.is_some()
        ));
        runtime_account_app_inventory_response(&manifest, projection).map(Some)
    }
    nimi_shell_tauri::capabilities::runtime::RUNTIME_APP_LIST_LOCAL_APP_ADOPTIONS_METHOD_ID => {
        append_backend_log("runtime_app_fixture method=listLocalAppAdoptions accepted=true");
        Ok(Some(runtime_list_local_app_adoptions_response()))
    }
    "/nimi.runtime.v1.RuntimeAppService/InstallApp" => {
        append_backend_log("runtime_app_fixture method=installApp accepted=true");
        runtime_install_app_response(payload, &manifest).map(Some)
    }
    "/nimi.runtime.v1.RuntimeAppService/GetAppInstallJob" => {
        append_backend_log("runtime_app_fixture method=getAppInstallJob accepted=true");
        runtime_get_app_install_job_response(payload, &manifest).map(Some)
    }
    nimi_shell_tauri::capabilities::runtime::RUNTIME_APP_LIST_APP_INSTALL_JOBS_METHOD_ID => {
        append_backend_log("runtime_app_fixture method=listAppInstallJobs accepted=true");
        runtime_list_app_install_jobs_response(payload, &manifest).map(Some)
    }
    "/nimi.runtime.v1.RuntimeAppService/OpenApp" => {
        append_backend_log("runtime_app_fixture method=openApp accepted=true");
        runtime_open_app_response(payload, &manifest).map(Some)
    }
    nimi_shell_tauri::capabilities::runtime::RUNTIME_LOCAL_GET_PRODUCT_CONTROL_RECORD_METHOD_ID => {
        append_backend_log("runtime_product_control_fixture method=getProductControlRecord accepted=true");
        runtime_product_control_record_response(&manifest).map(Some)
    }
    nimi_shell_tauri::capabilities::runtime::RUNTIME_LOCAL_GET_PRODUCT_CONTROL_SELECTED_DATA_ROOT_METHOD_ID => {
        append_backend_log("runtime_product_control_fixture method=getProductControlSelectedDataRoot accepted=true");
        runtime_product_control_selected_data_root_response(&manifest).map(Some)
    }
    nimi_shell_tauri::capabilities::runtime::RUNTIME_LOCAL_RESOLVE_FIRST_RUN_EXECUTION_EVIDENCE_METHOD_ID => {
        append_backend_log("runtime_product_control_fixture method=resolveFirstRunExecutionEvidence accepted=true");
        runtime_first_run_execution_evidence_response(payload, &manifest).map(Some)
    }
    nimi_shell_tauri::capabilities::runtime::RUNTIME_APP_GET_APP_PACKAGE_READINESS_METHOD_ID => {
        append_backend_log("runtime_app_fixture method=getAppPackageReadiness accepted=true");
        runtime_app_package_readiness_response(payload, &manifest).map(Some)
    }
    nimi_shell_tauri::capabilities::runtime::RUNTIME_AGENT_GET_AGENT_METHOD_ID => {
        append_backend_log("runtime_agent_fixture method=getAgent accepted=true");
        runtime_agent_get_response(payload).map(Some)
    }
    nimi_shell_tauri::capabilities::runtime::RUNTIME_AGENT_INITIALIZE_AGENT_METHOD_ID => {
        append_backend_log("runtime_agent_fixture method=initializeAgent accepted=true");
        runtime_agent_initialize_response(payload).map(Some)
    }
    RUNTIME_AGENT_GET_AGENT_STATE_METHOD_ID => {
        append_backend_log("runtime_agent_fixture method=getAgentState accepted=true");
        runtime_agent_get_state_response(payload).map(Some)
    }
    nimi_shell_tauri::capabilities::runtime::RUNTIME_AGENT_SET_AGENT_PRESENTATION_PROFILE_METHOD_ID => {
        append_backend_log("runtime_agent_fixture method=setAgentPresentationProfile accepted=true");
        runtime_agent_set_presentation_profile_response(payload).map(Some)
    }
    nimi_shell_tauri::capabilities::runtime::RUNTIME_AGENT_OPEN_CONVERSATION_ANCHOR_METHOD_ID => {
        append_backend_log("runtime_agent_fixture method=openConversationAnchor accepted=true");
        runtime_agent_open_anchor_response(payload).map(Some)
    }
    nimi_shell_tauri::capabilities::runtime::RUNTIME_AGENT_GET_CONVERSATION_ANCHOR_SNAPSHOT_METHOD_ID => {
        append_backend_log("runtime_agent_fixture method=getConversationAnchorSnapshot accepted=true");
        runtime_agent_get_anchor_snapshot_response(payload).map(Some)
    }
    nimi_shell_tauri::capabilities::runtime::RUNTIME_AGENT_LIST_AGENT_CONVERSATION_SUMMARIES_METHOD_ID => {
        append_backend_log("runtime_agent_fixture method=listAgentConversationSummaries accepted=true");
        runtime_agent_list_conversation_summaries_response(payload).map(Some)
    }
    RUNTIME_AGENT_GET_PUBLIC_CHAT_SESSION_SNAPSHOT_METHOD_ID => {
        append_backend_log("runtime_agent_fixture method=getPublicChatSessionSnapshot accepted=true");
        runtime_agent_public_chat_session_snapshot_response(payload).map(Some)
    }
    RUNTIME_AGENT_LIST_PENDING_HOOKS_METHOD_ID => {
        append_backend_log("runtime_agent_fixture method=listPendingHooks accepted=true");
        runtime_agent_list_pending_hooks_response(payload).map(Some)
    }
    RUNTIME_AGENT_GET_CANONICAL_MEMORY_BANK_STATUS_METHOD_ID => {
        append_backend_log("runtime_agent_fixture method=getAgentCanonicalMemoryBankStatus accepted=true");
        runtime_agent_get_canonical_memory_bank_status_response(payload).map(Some)
    }
    RUNTIME_AGENT_REQUEST_CANONICAL_MEMORY_BANK_BIND_METHOD_ID => {
        append_backend_log("runtime_agent_fixture method=requestAgentCanonicalMemoryBankBind accepted=true");
        runtime_agent_request_canonical_memory_bank_bind_response(payload).map(Some)
    }
    _ => {
        if payload
            .method_id
            .contains("/nimi.runtime.v1.RuntimeAgentService/")
        {
            append_backend_log(&format!(
                "runtime_agent_fixture method=unhandled method_id={}",
                payload.method_id.trim()
            ));
        }
        Ok(None)
    }
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
#[path = "fixture_tests.rs"]
mod fixture_tests;
