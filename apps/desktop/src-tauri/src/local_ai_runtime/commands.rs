use std::collections::BTreeMap;
use std::io::{Read as IoRead, Write as IoWrite};
use std::time::{SystemTime, UNIX_EPOCH};

use chrono::DateTime;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter};

use super::audit::{
    append_audit_event, EVENT_DEPENDENCY_APPLY_COMPLETED, EVENT_DEPENDENCY_APPLY_FAILED,
    EVENT_DEPENDENCY_APPLY_STARTED, EVENT_DEPENDENCY_RESOLVE_FAILED,
    EVENT_DEPENDENCY_RESOLVE_INVOKED, EVENT_FALLBACK_TO_TOKEN_API, EVENT_INFERENCE_FAILED,
    EVENT_INFERENCE_INVOKED, EVENT_MODEL_CATALOG_SEARCH_FAILED, EVENT_MODEL_CATALOG_SEARCH_INVOKED,
    EVENT_MODEL_DOWNLOAD_COMPLETED, EVENT_MODEL_DOWNLOAD_FAILED, EVENT_MODEL_DOWNLOAD_STARTED,
    EVENT_MODEL_FILE_IMPORT_STARTED, EVENT_MODEL_IMPORT_FAILED, EVENT_MODEL_IMPORT_VALIDATED,
    EVENT_NODE_CATALOG_LISTED, EVENT_RUNTIME_MODEL_READY_AFTER_INSTALL,
    EVENT_SERVICE_INSTALL_COMPLETED, EVENT_SERVICE_INSTALL_FAILED, EVENT_SERVICE_INSTALL_STARTED,
};
use super::capability_matrix::refresh_state_capability_matrix_with_probe_and_device;
use super::catalog::{
    resolve_install_plan as resolve_catalog_install_plan, search_catalog,
    LocalAiCatalogResolveInput,
};
use super::dependency_apply::{
    fail_progress, mark_capability_matrix_refresh, run_preflight_all, DependencyApplyProgress,
};
use super::dependency_resolver::{
    resolve_dependencies, DependencyAlternativeInput, DependencyDeclarationInput,
    DependencyOptionInput, DependencyResolveInput,
};
use super::device_profile::collect_device_profile;
use super::download_manager;
use super::hf_source::{install_from_hf, HfDownloadProgress};
use super::import_validator::{
    manifest_to_model_record, normalize_and_validate_capabilities, parse_and_validate_manifest,
    validate_import_manifest_path, validate_loopback_endpoint,
};
use super::model_registry::{list_models, remove_model, upsert_model};
use super::node_catalog::list_nodes_from_services;
use super::reason_codes::{
    extract_reason_code as extract_local_ai_reason_code, normalize_local_ai_reason_code,
    LOCAL_AI_PROVIDER_INTERNAL_ERROR,
};
use super::service_artifacts::find_service_artifact;
use super::service_lifecycle::{
    bootstrap_service_artifact, build_service_descriptor, is_managed_service,
    normalize_service_descriptor, preflight_dependency, preflight_service_artifact,
    probe_service_capability_models, probe_service_endpoint_health, resolve_node_host_service,
    start_managed_service, stop_managed_service,
};
use super::store::{load_state, runtime_models_dir, save_state};
use super::supervisor::{health, start_model, stop_model};
use super::types::{
    now_iso_timestamp, slugify_local_model_id, LocalAiAuditEvent, LocalAiCatalogItemDescriptor,
    LocalAiDependencyApplyResult, LocalAiDependencyKind, LocalAiDependencyResolutionPlan,
    LocalAiDeviceProfile, LocalAiDownloadControlPayload, LocalAiDownloadProgressEvent,
    LocalAiDownloadSessionSummary, LocalAiDownloadState, LocalAiInstallPlanDescriptor,
    LocalAiInstallRequest, LocalAiModelHealth, LocalAiModelRecord, LocalAiNodeDescriptor,
    LocalAiRuntimeState, LocalAiServiceArtifactType, LocalAiServiceDescriptor,
    LocalAiServiceStatus, LocalAiVerifiedModelDescriptor, DEFAULT_LOCAL_RUNTIME_ENDPOINT,
    LOCAL_AI_DOWNLOAD_PROGRESS_EVENT,
};
use super::verified_models::{find_verified_model, verified_model_list};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAiModelsInstallPayload {
    pub model_id: String,
    pub repo: String,
    pub revision: Option<String>,
    pub capabilities: Option<Vec<String>>,
    pub engine: Option<String>,
    pub entry: Option<String>,
    pub files: Option<Vec<String>>,
    pub license: Option<String>,
    pub hashes: Option<std::collections::HashMap<String, String>>,
    pub endpoint: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAiModelsInstallVerifiedPayload {
    pub template_id: String,
    pub endpoint: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAiModelsCatalogSearchPayload {
    pub query: Option<String>,
    pub capability: Option<String>,
    pub limit: Option<usize>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAiModelsCatalogResolveInstallPlanPayload {
    pub item_id: Option<String>,
    pub source: Option<String>,
    pub template_id: Option<String>,
    pub model_id: Option<String>,
    pub repo: Option<String>,
    pub revision: Option<String>,
    pub capabilities: Option<Vec<String>>,
    pub engine: Option<String>,
    pub entry: Option<String>,
    pub files: Option<Vec<String>>,
    pub license: Option<String>,
    pub hashes: Option<std::collections::HashMap<String, String>>,
    pub endpoint: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAiModelsImportPayload {
    pub manifest_path: String,
    pub endpoint: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAiModelsImportFilePayload {
    pub file_path: String,
    pub model_name: Option<String>,
    pub capabilities: Vec<String>,
    pub engine: Option<String>,
    pub endpoint: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAiModelIdPayload {
    pub local_model_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAiModelsHealthPayload {
    pub local_model_id: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAiModelsHealthResult {
    pub models: Vec<LocalAiModelHealth>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAiAuditTimeRangePayload {
    pub from: Option<String>,
    pub to: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAiAuditsListPayload {
    pub limit: Option<usize>,
    pub event_type: Option<String>,
    pub event_types: Option<Vec<String>>,
    pub source: Option<String>,
    pub modality: Option<String>,
    pub local_model_id: Option<String>,
    pub mod_id: Option<String>,
    pub reason_code: Option<String>,
    pub time_range: Option<LocalAiAuditTimeRangePayload>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAiInferenceAuditPayload {
    pub event_type: String,
    pub mod_id: String,
    pub source: String,
    pub provider: String,
    pub modality: String,
    pub adapter: Option<String>,
    pub model: Option<String>,
    pub local_model_id: Option<String>,
    pub endpoint: Option<String>,
    pub reason_code: Option<String>,
    pub detail: Option<String>,
    pub policy_gate: Option<serde_json::Value>,
    pub extra: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAiRuntimeAuditPayload {
    pub event_type: String,
    pub model_id: Option<String>,
    pub local_model_id: Option<String>,
    pub payload: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LocalAiDependencyOptionPayload {
    pub dependency_id: String,
    pub kind: String,
    pub capability: Option<String>,
    pub title: Option<String>,
    pub model_id: Option<String>,
    pub repo: Option<String>,
    pub service_id: Option<String>,
    pub node_id: Option<String>,
    pub workflow_id: Option<String>,
    pub engine: Option<String>,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LocalAiDependencyAlternativePayload {
    pub alternative_id: String,
    pub preferred_dependency_id: Option<String>,
    pub options: Vec<LocalAiDependencyOptionPayload>,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LocalAiDependenciesDeclarationPayload {
    pub required: Option<Vec<LocalAiDependencyOptionPayload>>,
    pub optional: Option<Vec<LocalAiDependencyOptionPayload>>,
    pub alternatives: Option<Vec<LocalAiDependencyAlternativePayload>>,
    pub preferred: Option<std::collections::HashMap<String, String>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAiDependenciesResolvePayload {
    pub mod_id: String,
    pub capability: Option<String>,
    pub dependencies: Option<LocalAiDependenciesDeclarationPayload>,
    pub device_profile: LocalAiDeviceProfile,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAiDependenciesApplyPayload {
    pub plan: LocalAiDependencyResolutionPlan,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAiServicesInstallPayload {
    pub service_id: String,
    pub title: Option<String>,
    pub engine: Option<String>,
    pub endpoint: Option<String>,
    pub capabilities: Option<Vec<String>>,
    pub local_model_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAiServiceIdPayload {
    pub service_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAiNodesCatalogListPayload {
    pub capability: Option<String>,
    pub service_id: Option<String>,
    pub provider: Option<String>,
}

fn normalize_optional(input: Option<String>) -> Option<String> {
    input
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn normalize_non_empty(value: &str) -> Option<String> {
    let normalized = value.trim();
    if normalized.is_empty() {
        return None;
    }
    Some(normalized.to_string())
}

fn json_fingerprint<T: serde::Serialize>(value: &T) -> String {
    serde_json::to_string(value).unwrap_or_default()
}

fn extract_reason_code(error: &str) -> String {
    extract_local_ai_reason_code(error, LOCAL_AI_PROVIDER_INTERNAL_ERROR)
}

#[derive(Debug, Clone)]
struct LocalAiDependencyApplyFailure {
    error: String,
    rollback_applied: bool,
}

impl LocalAiDependencyApplyFailure {
    fn without_rollback(error: String) -> Self {
        Self {
            error,
            rollback_applied: false,
        }
    }

    fn with_rollback(error: String) -> Self {
        Self {
            error,
            rollback_applied: true,
        }
    }
}

impl From<String> for LocalAiDependencyApplyFailure {
    fn from(value: String) -> Self {
        Self::without_rollback(value)
    }
}

fn service_artifact_preflight_port(service_identity: &str) -> Option<u16> {
    let artifact = find_service_artifact(service_identity)?;
    artifact.preflight.iter().find_map(|rule| {
        if !rule.check.trim().eq_ignore_ascii_case("port-available") {
            return None;
        }
        rule.params
            .as_ref()
            .and_then(|value| value.get("port"))
            .and_then(|value| value.as_u64())
            .and_then(|value| u16::try_from(value).ok())
            .filter(|value| *value > 0)
    })
}

fn default_runtime_endpoint_for(service_identity: Option<&str>) -> String {
    let port = service_identity.and_then(service_artifact_preflight_port);
    if let Some(port) = port {
        return format!("http://127.0.0.1:{port}/v1");
    }
    DEFAULT_LOCAL_RUNTIME_ENDPOINT.to_string()
}

fn extract_probe_model_ids(payload: &serde_json::Value) -> Vec<String> {
    let from_data = payload
        .get("data")
        .and_then(|value| value.as_array())
        .cloned()
        .unwrap_or_default();
    let rows = if from_data.is_empty() {
        payload.as_array().cloned().unwrap_or_default()
    } else {
        from_data
    };
    rows.into_iter()
        .filter_map(|item| item.get("id").cloned().or(Some(item)))
        .filter_map(|value| value.as_str().map(|item| item.trim().to_string()))
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>()
}

fn collect_probe_models_by_service(state: &LocalAiRuntimeState) -> BTreeMap<String, Vec<String>> {
    let mut output = BTreeMap::<String, Vec<String>>::new();
    for service in &state.services {
        if service.status == LocalAiServiceStatus::Removed {
            continue;
        }
        let endpoint = service
            .endpoint
            .as_deref()
            .map(|value| value.trim())
            .unwrap_or_default();
        if endpoint.is_empty() {
            continue;
        }
        if let Ok(payload) = probe_service_capability_models(service.service_id.as_str(), endpoint)
        {
            let ids = extract_probe_model_ids(&payload);
            if !ids.is_empty() {
                output.insert(service.service_id.clone(), ids);
            }
        }
    }
    output
}

fn refresh_state_capability_matrix_with_provider_probe(
    app: &AppHandle,
    state: &mut LocalAiRuntimeState,
) {
    let probe_models = collect_probe_models_by_service(state);
    let profile = collect_device_profile(app);
    refresh_state_capability_matrix_with_probe_and_device(state, &probe_models, Some(&profile));
}

fn derive_node_dependency_binding(
    dependency_service_id: Option<&str>,
    node_id: &str,
    declared_capability: Option<&str>,
) -> Result<(String, Option<String>), LocalAiDependencyApplyFailure> {
    let node_id = normalize_non_empty(node_id).ok_or_else(|| {
        LocalAiDependencyApplyFailure::without_rollback(
            "LOCAL_AI_DEPENDENCY_NODE_ID_MISSING: selected node dependency missing nodeId"
                .to_string(),
        )
    })?;
    let node_binding = resolve_node_host_service(node_id.as_str());
    let service_id = if let Some(explicit_service_id) =
        dependency_service_id.and_then(normalize_non_empty)
    {
        if let Some((artifact_service_id, _)) = node_binding.as_ref() {
            if !artifact_service_id.eq_ignore_ascii_case(explicit_service_id.as_str()) {
                return Err(LocalAiDependencyApplyFailure::without_rollback(format!(
                    "LOCAL_AI_NODE_SERVICE_MISMATCH: nodeId={} dependencyServiceId={} artifactServiceId={}",
                    node_id, explicit_service_id, artifact_service_id
                )));
            }
        }
        explicit_service_id
    } else if let Some((artifact_service_id, _)) = node_binding.as_ref() {
        artifact_service_id.clone()
    } else {
        return Err(LocalAiDependencyApplyFailure::without_rollback(format!(
            "LOCAL_AI_NODE_SERVICE_REQUIRED: nodeId={} requires serviceId or catalog mapping",
            node_id
        )));
    };

    let capability = declared_capability
        .and_then(normalize_non_empty)
        .or_else(|| {
            node_binding
                .as_ref()
                .map(|(_, capability)| capability.clone())
        });
    Ok((service_id, capability))
}

fn install_engine(request: &LocalAiInstallRequest) -> String {
    let candidate = request
        .engine
        .as_deref()
        .map(|value| value.trim())
        .unwrap_or_default();
    if candidate.is_empty() {
        "localai".to_string()
    } else {
        candidate.to_string()
    }
}

fn run_install_preflight_with<F>(
    request: &LocalAiInstallRequest,
    preflight: F,
) -> Result<(), String>
where
    F: FnOnce(&str) -> Result<(), String>,
{
    let engine = install_engine(request);
    preflight(engine.as_str())
}

fn run_install_preflight(app: &AppHandle, request: &LocalAiInstallRequest) -> Result<(), String> {
    let profile = collect_device_profile(app);
    run_install_preflight_with(request, |engine| {
        let decisions = preflight_dependency(
            None,
            &LocalAiDependencyKind::Model,
            None,
            Some(engine),
            None,
            None,
            &profile,
        )?;
        if let Some(failed) = decisions.iter().find(|item| !item.ok) {
            return Err(format!("{}: {}", failed.reason_code, failed.detail));
        }
        Ok(())
    })
}

fn normalize_optional_slice(
    values: &Option<Vec<String>>,
) -> Option<std::collections::HashSet<String>> {
    let normalized = values
        .as_ref()
        .map(|items| {
            items
                .iter()
                .filter_map(|item| normalize_non_empty(item.as_str()))
                .collect::<std::collections::HashSet<_>>()
        })
        .unwrap_or_default();
    if normalized.is_empty() {
        return None;
    }
    Some(normalized)
}

fn merge_event_type_filters(payload: Option<&LocalAiAuditsListPayload>) -> Option<Vec<String>> {
    let filters = payload?;
    let mut merged = Vec::<String>::new();
    if let Some(single) = normalize_optional(filters.event_type.clone()) {
        merged.push(single);
    }
    if let Some(items) = filters.event_types.as_ref() {
        merged.extend(items.iter().cloned());
    }
    if merged.is_empty() {
        return None;
    }
    Some(merged)
}

fn payload_field_as_string(payload: &Option<serde_json::Value>, key: &str) -> Option<String> {
    let root = payload.as_ref()?.as_object()?;
    let value = root.get(key)?;
    normalize_non_empty(value.as_str().unwrap_or_default())
}

fn parse_iso_timestamp_millis(value: &str) -> Option<i64> {
    DateTime::parse_from_rfc3339(value)
        .ok()
        .map(|datetime| datetime.timestamp_millis())
}

fn validate_inference_event_type(value: &str) -> Result<&str, String> {
    let normalized = value.trim();
    if normalized == EVENT_INFERENCE_INVOKED
        || normalized == EVENT_INFERENCE_FAILED
        || normalized == EVENT_FALLBACK_TO_TOKEN_API
    {
        return Ok(normalized);
    }
    Err(format!(
        "LOCAL_AI_AUDIT_EVENT_TYPE_INVALID: unsupported event type: {normalized}"
    ))
}

fn validate_inference_source(value: &str) -> Result<&str, String> {
    let normalized = value.trim();
    if normalized == "local-runtime" || normalized == "token-api" {
        return Ok(normalized);
    }
    Err(format!(
        "LOCAL_AI_AUDIT_SOURCE_INVALID: unsupported source: {normalized}"
    ))
}

fn validate_inference_modality(value: &str) -> Result<&str, String> {
    let normalized = value.trim();
    if normalized == "chat"
        || normalized == "image"
        || normalized == "video"
        || normalized == "tts"
        || normalized == "stt"
        || normalized == "embedding"
    {
        return Ok(normalized);
    }
    Err(format!(
        "LOCAL_AI_AUDIT_MODALITY_INVALID: unsupported modality: {normalized}"
    ))
}

fn validate_runtime_audit_event_type(value: &str) -> Result<&str, String> {
    let normalized = value.trim();
    if normalized == EVENT_RUNTIME_MODEL_READY_AFTER_INSTALL {
        return Ok(normalized);
    }
    Err(format!(
        "LOCAL_AI_AUDIT_EVENT_TYPE_INVALID: unsupported runtime event type: {normalized}"
    ))
}

fn require_audit_payload_keys(
    event_type: &str,
    payload: &Option<serde_json::Value>,
    required_keys: &[&str],
) -> Result<(), String> {
    let root = payload
        .as_ref()
        .and_then(|value| value.as_object())
        .ok_or_else(|| {
            format!(
                "LOCAL_AI_AUDIT_PAYLOAD_REQUIRED: eventType={} payload object is required",
                event_type
            )
        })?;

    let missing = required_keys
        .iter()
        .filter_map(|key| {
            let value = root.get(*key)?;
            if value.is_null() {
                return Some((*key).to_string());
            }
            Some(String::new())
        })
        .filter(|key| !key.is_empty())
        .collect::<Vec<_>>();
    let not_found = required_keys
        .iter()
        .filter(|key| !root.contains_key(**key))
        .map(|key| (*key).to_string())
        .collect::<Vec<_>>();
    let mut missing_all = Vec::<String>::new();
    missing_all.extend(not_found);
    missing_all.extend(missing);
    if !missing_all.is_empty() {
        return Err(format!(
            "LOCAL_AI_AUDIT_PAYLOAD_INVALID: eventType={} missingKeys={}",
            event_type,
            missing_all.join(",")
        ));
    }
    Ok(())
}

fn validate_audit_payload_contract(
    event_type: &str,
    payload: &Option<serde_json::Value>,
) -> Result<(), String> {
    if event_type == EVENT_DEPENDENCY_RESOLVE_INVOKED {
        return require_audit_payload_keys(
            event_type,
            payload,
            &[
                "modId",
                "hasDependencies",
                "hasDeviceProfile",
                "deviceProfile",
            ],
        );
    }
    if event_type == EVENT_DEPENDENCY_RESOLVE_FAILED {
        return require_audit_payload_keys(
            event_type,
            payload,
            &["modId", "deviceProfile", "reasonCode", "error"],
        );
    }
    if event_type == EVENT_DEPENDENCY_APPLY_STARTED {
        return require_audit_payload_keys(
            event_type,
            payload,
            &["modId", "planId", "dependencyCount"],
        );
    }
    if event_type == EVENT_DEPENDENCY_APPLY_COMPLETED {
        return require_audit_payload_keys(
            event_type,
            payload,
            &[
                "modId",
                "planId",
                "installedModelCount",
                "serviceCount",
                "capabilities",
                "stageResults",
                "preflightDecisionCount",
                "rollbackApplied",
                "warningCount",
            ],
        );
    }
    if event_type == EVENT_DEPENDENCY_APPLY_FAILED {
        return require_audit_payload_keys(
            event_type,
            payload,
            &["modId", "planId", "reasonCode", "rollbackApplied", "error"],
        );
    }
    if event_type == EVENT_SERVICE_INSTALL_STARTED {
        return require_audit_payload_keys(event_type, payload, &["serviceId"]);
    }
    if event_type == EVENT_SERVICE_INSTALL_COMPLETED {
        return require_audit_payload_keys(event_type, payload, &["serviceId"]);
    }
    if event_type == EVENT_SERVICE_INSTALL_FAILED {
        return require_audit_payload_keys(
            event_type,
            payload,
            &["serviceId", "reasonCode", "error"],
        );
    }
    if event_type == EVENT_NODE_CATALOG_LISTED {
        return require_audit_payload_keys(event_type, payload, &["count"]);
    }
    if event_type == EVENT_RUNTIME_MODEL_READY_AFTER_INSTALL {
        return require_audit_payload_keys(
            event_type,
            payload,
            &["source", "capabilities", "localModelId"],
        );
    }
    if event_type == EVENT_INFERENCE_INVOKED
        || event_type == EVENT_INFERENCE_FAILED
        || event_type == EVENT_FALLBACK_TO_TOKEN_API
    {
        require_audit_payload_keys(
            event_type,
            payload,
            &["modId", "source", "provider", "modality", "adapter"],
        )?;
        if event_type == EVENT_FALLBACK_TO_TOKEN_API {
            return require_audit_payload_keys(event_type, payload, &["reasonCode"]);
        }
        return Ok(());
    }
    Ok(())
}

fn append_app_audit_event(
    app: &AppHandle,
    event_type: &str,
    model_id: Option<&str>,
    local_model_id: Option<&str>,
    payload: Option<serde_json::Value>,
) -> Result<(), String> {
    validate_audit_payload_contract(event_type, &payload)?;
    let mut state = load_state(app)?;
    append_audit_event(&mut state, event_type, model_id, local_model_id, payload);
    save_state(app, &state)
}

fn append_app_audit_event_non_blocking(
    app: &AppHandle,
    event_type: &str,
    model_id: Option<&str>,
    local_model_id: Option<&str>,
    payload: Option<serde_json::Value>,
) {
    if let Err(error) = append_app_audit_event(app, event_type, model_id, local_model_id, payload) {
        eprintln!("LOCAL_AI_AUDIT_WRITE_FAILED: {error}");
    }
}

fn next_install_session_id(model_id: &str) -> String {
    let now_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    format!("install-{}-{now_ms}", slugify_local_model_id(model_id))
}

fn emit_download_progress_event(app: &AppHandle, event: LocalAiDownloadProgressEvent) {
    if let Err(error) = app.emit(LOCAL_AI_DOWNLOAD_PROGRESS_EVENT, &event) {
        eprintln!("LOCAL_AI_DOWNLOAD_PROGRESS_EMIT_FAILED: {error}");
    }
}

fn normalize_dependency_kind(value: &str) -> LocalAiDependencyKind {
    match value.trim().to_ascii_lowercase().as_str() {
        "service" => LocalAiDependencyKind::Service,
        "node" => LocalAiDependencyKind::Node,
        "workflow" => LocalAiDependencyKind::Workflow,
        _ => LocalAiDependencyKind::Model,
    }
}

fn normalize_capability_filter(value: Option<String>) -> Option<String> {
    normalize_optional(value).map(|item| item.to_ascii_lowercase())
}

fn to_dependency_option_input(option: &LocalAiDependencyOptionPayload) -> DependencyOptionInput {
    DependencyOptionInput {
        dependency_id: normalize_non_empty(option.dependency_id.as_str()).unwrap_or_default(),
        kind: normalize_dependency_kind(option.kind.as_str()),
        capability: normalize_optional(option.capability.clone())
            .map(|item| item.to_ascii_lowercase()),
        title: normalize_optional(option.title.clone()),
        model_id: normalize_optional(option.model_id.clone()),
        repo: normalize_optional(option.repo.clone()),
        engine: normalize_optional(option.engine.clone()),
        service_id: normalize_optional(option.service_id.clone()),
        node_id: normalize_optional(option.node_id.clone()),
        workflow_id: normalize_optional(option.workflow_id.clone()),
    }
}

fn to_dependency_declaration_input(
    payload: Option<LocalAiDependenciesDeclarationPayload>,
) -> DependencyDeclarationInput {
    let payload = payload.unwrap_or(LocalAiDependenciesDeclarationPayload {
        required: None,
        optional: None,
        alternatives: None,
        preferred: None,
    });
    let required = payload
        .required
        .unwrap_or_default()
        .iter()
        .map(to_dependency_option_input)
        .collect::<Vec<_>>();
    let optional = payload
        .optional
        .unwrap_or_default()
        .iter()
        .map(to_dependency_option_input)
        .collect::<Vec<_>>();
    let alternatives = payload
        .alternatives
        .unwrap_or_default()
        .iter()
        .map(|item| DependencyAlternativeInput {
            alternative_id: item.alternative_id.clone(),
            preferred_dependency_id: normalize_optional(item.preferred_dependency_id.clone()),
            options: item
                .options
                .iter()
                .map(to_dependency_option_input)
                .collect::<Vec<_>>(),
        })
        .collect::<Vec<_>>();
    let preferred = payload
        .preferred
        .unwrap_or_default()
        .into_iter()
        .map(|(key, value)| (key.trim().to_ascii_lowercase(), value.trim().to_string()))
        .filter(|(key, value)| !key.is_empty() && !value.is_empty())
        .collect::<std::collections::HashMap<_, _>>();
    DependencyDeclarationInput {
        required,
        optional,
        alternatives,
        preferred,
    }
}

fn next_dependency_plan_id(mod_id: &str) -> String {
    let now_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    format!("dep-plan-{}-{now_ms}", slugify_local_model_id(mod_id))
}

fn resolve_dependency_plan(
    app: &AppHandle,
    payload: &LocalAiDependenciesResolvePayload,
) -> Result<LocalAiDependencyResolutionPlan, String> {
    let mod_id = normalize_non_empty(payload.mod_id.as_str())
        .ok_or_else(|| "LOCAL_AI_DEPENDENCY_MOD_ID_REQUIRED: modId is required".to_string())?;
    let capability_filter = normalize_capability_filter(payload.capability.clone());
    let declaration = to_dependency_declaration_input(payload.dependencies.clone());
    let mut state = load_state(app)?;
    if state.capability_matrix.is_empty() {
        refresh_state_capability_matrix_with_provider_probe(app, &mut state);
        let _ = save_state(app, &state);
    }
    let resolved = resolve_dependencies(&DependencyResolveInput {
        capability_filter: capability_filter.clone(),
        device_profile: payload.device_profile.clone(),
        capability_matrix: state.capability_matrix.clone(),
        declaration,
    })?;

    Ok(LocalAiDependencyResolutionPlan {
        plan_id: next_dependency_plan_id(mod_id.as_str()),
        mod_id,
        capability: capability_filter,
        device_profile: payload.device_profile.clone(),
        dependencies: resolved.dependencies,
        selection_rationale: resolved.selection_rationale,
        preflight_decisions: resolved.preflight_decisions,
        warnings: resolved.warnings,
        reason_code: resolved.reason_code,
    })
}

fn normalize_service_id(value: &str) -> Option<String> {
    normalize_non_empty(value).map(|item| item.to_ascii_lowercase())
}

fn find_service_index(services: &[LocalAiServiceDescriptor], service_id: &str) -> Option<usize> {
    let normalized = normalize_service_id(service_id)?;
    services.iter().position(|item| {
        normalize_service_id(item.service_id.as_str()).as_deref() == Some(normalized.as_str())
    })
}

fn run_service_install_preflight(
    app: &AppHandle,
    dependency_id: Option<&str>,
    service_id: &str,
    endpoint: Option<&str>,
) -> Result<(), String> {
    let profile = collect_device_profile(app);
    let decisions = preflight_service_artifact(dependency_id, service_id, endpoint, &profile)?;
    if let Some(failed) = decisions.iter().find(|item| !item.ok) {
        return Err(format!("{}: {}", failed.reason_code, failed.detail));
    }
    Ok(())
}

fn run_service_runtime_preflight(
    app: &AppHandle,
    dependency_id: Option<&str>,
    service: &LocalAiServiceDescriptor,
) -> Result<(), String> {
    let profile = collect_device_profile(app);
    let decisions = preflight_service_artifact(
        dependency_id,
        service.service_id.as_str(),
        service.endpoint.as_deref(),
        &profile,
    )?;
    if let Some(failed) = decisions.iter().find(|item| !item.ok) {
        return Err(format!("{}: {}", failed.reason_code, failed.detail));
    }
    Ok(())
}

fn build_service_descriptor_from_install_payload(
    app: &AppHandle,
    payload: &LocalAiServicesInstallPayload,
) -> Result<LocalAiServiceDescriptor, String> {
    let service_id = normalize_non_empty(payload.service_id.as_str())
        .ok_or_else(|| "LOCAL_AI_SERVICE_ID_REQUIRED: serviceId is required".to_string())?;
    run_service_install_preflight(app, None, service_id.as_str(), payload.endpoint.as_deref())?;
    let capabilities = payload
        .capabilities
        .clone()
        .unwrap_or_default()
        .iter()
        .filter_map(|item| normalize_non_empty(item.as_str()))
        .collect::<Vec<_>>();
    build_service_descriptor(
        service_id.as_str(),
        payload.title.as_deref(),
        payload.endpoint.as_deref(),
        capabilities.as_slice(),
        payload.local_model_id.as_deref(),
    )
}

fn upsert_service_descriptor(
    app: &AppHandle,
    mut descriptor: LocalAiServiceDescriptor,
) -> Result<LocalAiServiceDescriptor, String> {
    let mut state = load_state(app)?;
    let now = now_iso_timestamp();
    descriptor.updated_at = now.clone();
    if descriptor.installed_at.trim().is_empty() {
        descriptor.installed_at = now.clone();
    }
    if let Some(index) = find_service_index(&state.services, descriptor.service_id.as_str()) {
        let existing = state.services[index].clone();
        if descriptor.installed_at.trim().is_empty() {
            descriptor.installed_at = existing.installed_at;
        }
        if descriptor
            .endpoint
            .as_deref()
            .unwrap_or_default()
            .trim()
            .is_empty()
        {
            descriptor.endpoint = existing.endpoint.clone();
        }
        if descriptor
            .local_model_id
            .as_deref()
            .unwrap_or_default()
            .trim()
            .is_empty()
        {
            descriptor.local_model_id = existing.local_model_id.clone();
        }
        if descriptor.capabilities.is_empty() {
            descriptor.capabilities = existing.capabilities.clone();
        }
        state.services[index] = descriptor.clone();
    } else {
        state.services.push(descriptor.clone());
    }
    save_state(app, &state)?;
    Ok(descriptor)
}

fn update_service_status(
    app: &AppHandle,
    service_id: &str,
    status: LocalAiServiceStatus,
    detail: Option<String>,
) -> Result<LocalAiServiceDescriptor, String> {
    let mut state = load_state(app)?;
    let index = find_service_index(&state.services, service_id)
        .ok_or_else(|| format!("LOCAL_AI_SERVICE_NOT_FOUND: serviceId={service_id}"))?;
    let service = &mut state.services[index];
    service.status = status;
    service.updated_at = now_iso_timestamp();
    service.detail = detail.filter(|value| !value.trim().is_empty());
    let snapshot = service.clone();
    save_state(app, &state)?;
    Ok(snapshot)
}

enum ServiceRuntimeStartTarget {
    Endpoint(String),
    Missing,
}

fn service_artifact_type_label(artifact_type: Option<&LocalAiServiceArtifactType>) -> &'static str {
    match artifact_type {
        Some(LocalAiServiceArtifactType::PythonEnv) => "python-env",
        Some(LocalAiServiceArtifactType::Binary) => "binary",
        Some(LocalAiServiceArtifactType::AttachedEndpoint) => "attached-endpoint",
        None => "unknown",
    }
}

fn resolve_service_runtime_start_target(
    service: &LocalAiServiceDescriptor,
) -> ServiceRuntimeStartTarget {
    if let Some(endpoint) = normalize_non_empty(service.endpoint.as_deref().unwrap_or_default()) {
        return ServiceRuntimeStartTarget::Endpoint(endpoint);
    }
    ServiceRuntimeStartTarget::Missing
}

fn service_target_missing_reason(service: &LocalAiServiceDescriptor) -> String {
    format!(
        "LOCAL_AI_SERVICE_TARGET_MISSING: serviceId={} artifactType={} requires endpoint",
        service.service_id,
        service_artifact_type_label(service.artifact_type.as_ref())
    )
}

fn start_service_runtime(
    app: &AppHandle,
    service: &LocalAiServiceDescriptor,
) -> Result<String, String> {
    run_service_runtime_preflight(app, None, service)?;
    let _ = bootstrap_service_artifact(service.service_id.as_str())?;
    match resolve_service_runtime_start_target(service) {
        ServiceRuntimeStartTarget::Endpoint(endpoint) => {
            if is_managed_service(service.service_id.as_str()) {
                if let Some(detail) =
                    start_managed_service(service.service_id.as_str(), endpoint.as_str())?
                {
                    return Ok(detail);
                }
            }
            probe_service_endpoint_health(service.service_id.as_str(), endpoint.as_str())
        }
        ServiceRuntimeStartTarget::Missing => Err(service_target_missing_reason(service)),
    }
}

fn ensure_dependency_service_descriptor(
    app: &AppHandle,
    service_id: &str,
    capability: Option<&str>,
    service_map: &mut std::collections::BTreeMap<String, LocalAiServiceDescriptor>,
    service_ids_to_start: &mut std::collections::BTreeSet<String>,
) -> Result<LocalAiServiceDescriptor, LocalAiDependencyApplyFailure> {
    let normalized_service_id = normalize_service_id(service_id).ok_or_else(|| {
        LocalAiDependencyApplyFailure::without_rollback(
            "LOCAL_AI_DEPENDENCY_SERVICE_ID_MISSING: node dependency missing serviceId".to_string(),
        )
    })?;
    if let Some(existing) = service_map.get(normalized_service_id.as_str()) {
        return Ok(existing.clone());
    }

    let state = load_state(app)?;
    if let Some(index) = find_service_index(&state.services, service_id) {
        let mut existing = state.services[index].clone();
        let before_endpoint = existing.endpoint.clone();
        let before_engine = existing.engine.clone();
        let before_artifact_type = existing.artifact_type.clone();
        normalize_service_descriptor(&mut existing);
        if existing.endpoint != before_endpoint
            || existing.engine != before_engine
            || existing.artifact_type != before_artifact_type
        {
            existing = upsert_service_descriptor(app, existing)
                .map_err(LocalAiDependencyApplyFailure::without_rollback)?;
        }
        if existing.status == LocalAiServiceStatus::Removed {
            return Err(LocalAiDependencyApplyFailure::without_rollback(format!(
                "LOCAL_AI_SERVICE_REMOVED: serviceId={service_id}"
            )));
        }
        if existing.status != LocalAiServiceStatus::Active {
            service_ids_to_start.insert(existing.service_id.clone());
        }
        service_map.insert(normalized_service_id, existing.clone());
        return Ok(existing);
    }

    let capability_values = capability
        .and_then(normalize_non_empty)
        .map(|value| vec![value]);
    let install_payload = LocalAiServicesInstallPayload {
        service_id: service_id.to_string(),
        title: None,
        engine: None,
        endpoint: None,
        capabilities: capability_values,
        local_model_id: None,
    };
    let installed = build_service_descriptor_from_install_payload(app, &install_payload)?;
    let installed = upsert_service_descriptor(app, installed)?;
    service_ids_to_start.insert(installed.service_id.clone());
    service_map.insert(normalized_service_id, installed.clone());
    Ok(installed)
}

fn rollback_dependency_apply_runtime(app: &AppHandle, started_service_ids: &[String]) -> bool {
    let mut rollback_applied = false;

    for service_id in started_service_ids.iter().rev() {
        if let Ok(Some(_)) = stop_managed_service(service_id.as_str()) {
            rollback_applied = true;
        }
        if update_service_status(
            app,
            service_id.as_str(),
            LocalAiServiceStatus::Installed,
            Some("service rolled back after dependency apply failure".to_string()),
        )
        .is_ok()
        {
            rollback_applied = true;
        }
    }

    rollback_applied
}

fn fail_progress_with_rollback(
    progress: &mut DependencyApplyProgress,
    stage: &str,
    error: String,
    rollback_applied: bool,
) -> LocalAiDependencyApplyFailure {
    let reason_code = extract_reason_code(error.as_str());
    progress.push_stage_failed(stage, reason_code, error.clone());
    if rollback_applied {
        progress.push_stage_ok(
            "rollback",
            Some("runtime rolled back to pre-apply status".to_string()),
        );
        return LocalAiDependencyApplyFailure::with_rollback(error);
    }
    LocalAiDependencyApplyFailure::without_rollback(error)
}

fn run_dependency_apply(
    app: &AppHandle,
    plan: &LocalAiDependencyResolutionPlan,
) -> Result<LocalAiDependencyApplyResult, LocalAiDependencyApplyFailure> {
    let mut warnings = plan.warnings.clone();
    let mut capabilities = std::collections::BTreeSet::<String>::new();
    let mut progress = DependencyApplyProgress::new();
    let mut installed_model_map = std::collections::BTreeMap::<String, LocalAiModelRecord>::new();
    let mut service_map = std::collections::BTreeMap::<String, LocalAiServiceDescriptor>::new();
    let mut service_ids_to_start = std::collections::BTreeSet::<String>::new();
    let mut started_service_ids = Vec::<String>::new();

    let selected_dependencies = plan
        .dependencies
        .iter()
        .filter(|item| item.selected)
        .cloned()
        .collect::<Vec<_>>();

    let missing_required_dependencies = plan
        .dependencies
        .iter()
        .filter(|item| item.required && !item.selected)
        .collect::<Vec<_>>();
    if !missing_required_dependencies.is_empty() {
        let detail = missing_required_dependencies
            .iter()
            .map(|item| {
                let reason = item
                    .reason_code
                    .clone()
                    .unwrap_or_else(|| "LOCAL_AI_REQUIRED_DEPENDENCY_NOT_SELECTED".to_string());
                format!("{}({reason})", item.dependency_id)
            })
            .collect::<Vec<_>>()
            .join(", ");
        let error = format!("LOCAL_AI_REQUIRED_DEPENDENCY_NOT_SELECTED: {detail}");
        return Err(LocalAiDependencyApplyFailure::without_rollback(
            fail_progress(&mut progress, "preflight", error),
        ));
    }

    let preflight_decisions =
        run_preflight_all(selected_dependencies.as_slice(), &plan.device_profile).map_err(
            |error| {
                LocalAiDependencyApplyFailure::without_rollback(fail_progress(
                    &mut progress,
                    "preflight",
                    error,
                ))
            },
        )?;
    progress.preflight_decisions = preflight_decisions.clone();
    progress.push_stage_ok(
        "preflight",
        Some(format!(
            "{} dependencies checked",
            selected_dependencies.len()
        )),
    );

    for dependency in &selected_dependencies {
        if let Some(capability) = dependency.capability.as_ref() {
            capabilities.insert(capability.clone());
        }

        match dependency.kind.clone() {
            LocalAiDependencyKind::Model => {
                let model_id = dependency.model_id.clone().ok_or_else(|| {
                    LocalAiDependencyApplyFailure::without_rollback(
                        "LOCAL_AI_DEPENDENCY_MODEL_ID_MISSING: selected model dependency missing modelId"
                            .to_string(),
                    )
                })?;
                let repo = dependency.repo.clone().unwrap_or_else(|| model_id.clone());
                let default_endpoint = default_runtime_endpoint_for(dependency.engine.as_deref());
                let endpoint = validate_loopback_endpoint(default_endpoint.as_str())?;
                let install_request = LocalAiInstallRequest {
                    model_id: model_id.clone(),
                    repo,
                    revision: Some("main".to_string()),
                    capabilities: dependency.capability.clone().map(|value| vec![value]),
                    engine: dependency.engine.clone(),
                    entry: None,
                    files: None,
                    license: Some("unknown".to_string()),
                    hashes: None,
                    endpoint: Some(endpoint),
                    provider_hints: None,
                };
                let installed = execute_hf_install_blocking(
                    app,
                    install_request,
                    Some(serde_json::json!({
                        "installKind": "dependency-plan",
                        "dependencyId": dependency.dependency_id.clone(),
                        "planId": plan.plan_id,
                    })),
                )?;
                installed_model_map.insert(installed.local_model_id.clone(), installed);
            }
            LocalAiDependencyKind::Service => {
                let service_id = dependency.service_id.clone().ok_or_else(|| {
                    LocalAiDependencyApplyFailure::without_rollback(
                        "LOCAL_AI_DEPENDENCY_SERVICE_ID_MISSING: selected service dependency missing serviceId"
                            .to_string(),
                    )
                })?;
                let mut local_model_id_for_service: Option<String> = None;
                if let Some(model_id) = dependency.model_id.clone() {
                    let repo = dependency.repo.clone().unwrap_or_else(|| model_id.clone());
                    let default_endpoint = default_runtime_endpoint_for(Some(service_id.as_str()));
                    let endpoint = validate_loopback_endpoint(default_endpoint.as_str())?;
                    let install_request = LocalAiInstallRequest {
                        model_id: model_id.clone(),
                        repo,
                        revision: Some("main".to_string()),
                        capabilities: dependency.capability.clone().map(|value| vec![value]),
                        engine: dependency.engine.clone(),
                        entry: None,
                        files: None,
                        license: Some("unknown".to_string()),
                        hashes: None,
                        endpoint: Some(endpoint),
                        provider_hints: None,
                    };
                    let installed = execute_hf_install_blocking(
                        app,
                        install_request,
                        Some(serde_json::json!({
                            "installKind": "dependency-plan-service-model",
                            "dependencyId": dependency.dependency_id.clone(),
                            "planId": plan.plan_id,
                            "serviceId": service_id.clone(),
                        })),
                    )?;
                    local_model_id_for_service = Some(installed.local_model_id.clone());
                    installed_model_map.insert(installed.local_model_id.clone(), installed);
                }
                let install_payload = LocalAiServicesInstallPayload {
                    service_id: service_id.clone(),
                    title: None,
                    engine: dependency.engine.clone(),
                    endpoint: None,
                    capabilities: dependency.capability.clone().map(|value| vec![value]),
                    local_model_id: local_model_id_for_service,
                };
                let installed =
                    build_service_descriptor_from_install_payload(app, &install_payload)?;
                let installed = upsert_service_descriptor(app, installed)?;
                service_ids_to_start.insert(installed.service_id.clone());
                let service_key = normalize_service_id(installed.service_id.as_str())
                    .unwrap_or_else(|| installed.service_id.to_ascii_lowercase());
                service_map.insert(service_key, installed.clone());
                if installed.status == LocalAiServiceStatus::Unhealthy {
                    warnings.push(format!(
                        "LOCAL_AI_SERVICE_UNHEALTHY: serviceId={}",
                        installed.service_id
                    ));
                }
            }
            LocalAiDependencyKind::Node => {
                let node_id = dependency
                    .node_id
                    .as_deref()
                    .unwrap_or_default()
                    .to_string();
                let (service_id, resolved_capability) = derive_node_dependency_binding(
                    dependency.service_id.as_deref(),
                    node_id.as_str(),
                    dependency.capability.as_deref(),
                )?;
                if let Some(capability) = resolved_capability.as_ref() {
                    capabilities.insert(capability.clone());
                }
                let service = ensure_dependency_service_descriptor(
                    app,
                    service_id.as_str(),
                    resolved_capability.as_deref(),
                    &mut service_map,
                    &mut service_ids_to_start,
                )?;
                if service.status == LocalAiServiceStatus::Unhealthy {
                    warnings.push(format!(
                        "LOCAL_AI_SERVICE_UNHEALTHY: serviceId={}",
                        service.service_id
                    ));
                }
            }
            LocalAiDependencyKind::Workflow => {
                let workflow_id = normalize_non_empty(
                    dependency.workflow_id.as_deref().unwrap_or_default(),
                )
                .ok_or_else(|| {
                    LocalAiDependencyApplyFailure::without_rollback(format!(
                        "LOCAL_AI_DEPENDENCY_WORKFLOW_ID_MISSING: dependencyId={} missing workflowId",
                        dependency.dependency_id
                    ))
                })?;
                warnings.push(format!(
                    "LOCAL_AI_WORKFLOW_DEPENDENCY_DECLARATIVE_ONLY: dependencyId={} workflowId={}",
                    dependency.dependency_id, workflow_id
                ));
            }
        }
    }

    let mut installed_models = installed_model_map.values().cloned().collect::<Vec<_>>();
    let mut services = service_map.values().cloned().collect::<Vec<_>>();
    progress.push_stage_ok(
        "install-artifacts",
        Some(format!(
            "installedModels={}, services={}",
            installed_models.len(),
            services.len()
        )),
    );

    let mut bootstrap_details = Vec::<String>::new();
    for service_id in &service_ids_to_start {
        match bootstrap_service_artifact(service_id.as_str()) {
            Ok(Some(detail)) => bootstrap_details.push(detail),
            Ok(None) => {}
            Err(error) => {
                return Err(LocalAiDependencyApplyFailure::without_rollback(
                    fail_progress(&mut progress, "bootstrap-services", error),
                ));
            }
        }
    }
    let bootstrap_summary = if bootstrap_details.is_empty() {
        format!("servicesPrepared={}", service_ids_to_start.len())
    } else {
        format!(
            "servicesPrepared={} details={}",
            service_ids_to_start.len(),
            bootstrap_details.join(" | ")
        )
    };
    progress.push_stage_ok("bootstrap-services", Some(bootstrap_summary));

    for service_id in &service_ids_to_start {
        let service_key = normalize_service_id(service_id.as_str())
            .unwrap_or_else(|| service_id.to_ascii_lowercase());
        let service_snapshot = service_map
            .get(service_key.as_str())
            .cloned()
            .or_else(|| {
                load_state(app).ok().and_then(|state| {
                    find_service_index(&state.services, service_id.as_str())
                        .map(|index| state.services[index].clone())
                })
            })
            .ok_or_else(|| {
                LocalAiDependencyApplyFailure::without_rollback(format!(
                    "LOCAL_AI_SERVICE_NOT_FOUND: serviceId={service_id}"
                ))
            })?;
        let detail = match start_service_runtime(app, &service_snapshot) {
            Ok(value) => value,
            Err(error) => {
                let rollback_applied = rollback_dependency_apply_runtime(app, &started_service_ids);
                return Err(fail_progress_with_rollback(
                    &mut progress,
                    "start",
                    error,
                    rollback_applied,
                ));
            }
        };
        let started_service = match update_service_status(
            app,
            service_id.as_str(),
            LocalAiServiceStatus::Active,
            Some(detail),
        ) {
            Ok(value) => value,
            Err(error) => {
                let rollback_applied = rollback_dependency_apply_runtime(app, &started_service_ids);
                return Err(fail_progress_with_rollback(
                    &mut progress,
                    "start",
                    error,
                    rollback_applied,
                ));
            }
        };
        started_service_ids.push(started_service.service_id.clone());
        service_map.insert(service_key, started_service);
    }

    progress.push_stage_ok(
        "start",
        Some(format!("servicesStarted={}", started_service_ids.len(),)),
    );

    for service_id in &started_service_ids {
        let service_key = normalize_service_id(service_id.as_str())
            .unwrap_or_else(|| service_id.to_ascii_lowercase());
        let service_snapshot = service_map
            .get(service_key.as_str())
            .cloned()
            .ok_or_else(|| {
                LocalAiDependencyApplyFailure::without_rollback(format!(
                    "LOCAL_AI_SERVICE_NOT_FOUND: serviceId={service_id}"
                ))
            })?;
        let health_detail = match resolve_service_runtime_start_target(&service_snapshot) {
            ServiceRuntimeStartTarget::Endpoint(endpoint) => probe_service_endpoint_health(
                service_snapshot.service_id.as_str(),
                endpoint.as_str(),
            ),
            ServiceRuntimeStartTarget::Missing => {
                Err(service_target_missing_reason(&service_snapshot))
            }
        };
        let health_detail = match health_detail {
            Ok(value) => value,
            Err(error) => {
                let rollback_applied = rollback_dependency_apply_runtime(app, &started_service_ids);
                return Err(fail_progress_with_rollback(
                    &mut progress,
                    "health",
                    error,
                    rollback_applied,
                ));
            }
        };
        if let Ok(updated_service) = update_service_status(
            app,
            service_id.as_str(),
            LocalAiServiceStatus::Active,
            Some(health_detail),
        ) {
            service_map.insert(service_key, updated_service);
        }
    }

    progress.push_stage_ok("health", Some("health checks passed".to_string()));

    installed_models = installed_model_map.values().cloned().collect::<Vec<_>>();
    services = service_map.values().cloned().collect::<Vec<_>>();
    installed_models.sort_by(|left, right| left.local_model_id.cmp(&right.local_model_id));
    services.sort_by(|left, right| left.service_id.cmp(&right.service_id));

    let refreshed_matrix_entries = {
        let mut state = load_state(app).map_err(LocalAiDependencyApplyFailure::without_rollback)?;
        refresh_state_capability_matrix_with_provider_probe(app, &mut state);
        let count = state.capability_matrix.len();
        save_state(app, &state).map_err(LocalAiDependencyApplyFailure::without_rollback)?;
        count
    };
    mark_capability_matrix_refresh(&mut progress, refreshed_matrix_entries);

    let capabilities = if capabilities.is_empty() {
        vec!["chat".to_string()]
    } else {
        capabilities.into_iter().collect::<Vec<_>>()
    };
    progress.push_stage_ok(
        "auto-bind",
        Some(format!("capabilities={}", capabilities.join(","))),
    );
    progress.push_stage_ok(
        "apply-all-capabilities",
        Some("renderer applies capability state".to_string()),
    );

    Ok(LocalAiDependencyApplyResult {
        plan_id: plan.plan_id.clone(),
        mod_id: plan.mod_id.clone(),
        dependencies: plan.dependencies.clone(),
        installed_models,
        services,
        capabilities,
        stage_results: progress.stage_results,
        preflight_decisions: progress.preflight_decisions,
        rollback_applied: false,
        warnings,
        reason_code: None,
    })
}

#[tauri::command]
pub fn local_ai_models_list(app: AppHandle) -> Result<Vec<LocalAiModelRecord>, String> {
    list_models(&app)
}

#[tauri::command]
pub fn local_ai_audits_list(
    app: AppHandle,
    payload: Option<LocalAiAuditsListPayload>,
) -> Result<Vec<LocalAiAuditEvent>, String> {
    let state = load_state(&app)?;
    let limit = payload
        .as_ref()
        .and_then(|item| item.limit)
        .unwrap_or(100)
        .clamp(1, 4000);
    let event_types = normalize_optional_slice(&merge_event_type_filters(payload.as_ref()));
    let source = payload
        .as_ref()
        .and_then(|item| normalize_optional(item.source.clone()));
    let modality = payload
        .as_ref()
        .and_then(|item| normalize_optional(item.modality.clone()));
    let local_model_id = payload
        .as_ref()
        .and_then(|item| normalize_optional(item.local_model_id.clone()));
    let mod_id = payload
        .as_ref()
        .and_then(|item| normalize_optional(item.mod_id.clone()));
    let reason_code = payload
        .as_ref()
        .and_then(|item| normalize_optional(item.reason_code.clone()));
    let from_timestamp_ms = payload
        .as_ref()
        .and_then(|item| item.time_range.as_ref())
        .and_then(|range| normalize_optional(range.from.clone()))
        .map(|value| {
            parse_iso_timestamp_millis(value.as_str()).ok_or(format!(
                "LOCAL_AI_AUDIT_TIME_RANGE_INVALID: from must be RFC3339 timestamp: {value}"
            ))
        })
        .transpose()?;
    let to_timestamp_ms = payload
        .as_ref()
        .and_then(|item| item.time_range.as_ref())
        .and_then(|range| normalize_optional(range.to.clone()))
        .map(|value| {
            parse_iso_timestamp_millis(value.as_str()).ok_or(format!(
                "LOCAL_AI_AUDIT_TIME_RANGE_INVALID: to must be RFC3339 timestamp: {value}"
            ))
        })
        .transpose()?;
    if let (Some(from_ms), Some(to_ms)) = (from_timestamp_ms, to_timestamp_ms) {
        if from_ms > to_ms {
            return Err("LOCAL_AI_AUDIT_TIME_RANGE_INVALID: from must be <= to".to_string());
        }
    }

    let mut filtered = state
        .audits
        .iter()
        .filter(|event| {
            if let Some(expected_types) = event_types.as_ref() {
                if !expected_types.contains(event.event_type.as_str()) {
                    return false;
                }
            }
            if let Some(expected_local_model_id) = local_model_id.as_ref() {
                if event.local_model_id.as_ref() != Some(expected_local_model_id) {
                    return false;
                }
            }
            if let Some(expected_mod_id) = mod_id.as_ref() {
                if payload_field_as_string(&event.payload, "modId").as_ref()
                    != Some(expected_mod_id)
                {
                    return false;
                }
            }
            if let Some(expected_source) = source.as_ref() {
                if payload_field_as_string(&event.payload, "source").as_ref()
                    != Some(expected_source)
                {
                    return false;
                }
            }
            if let Some(expected_modality) = modality.as_ref() {
                if payload_field_as_string(&event.payload, "modality").as_ref()
                    != Some(expected_modality)
                {
                    return false;
                }
            }
            if let Some(expected_reason_code) = reason_code.as_ref() {
                if payload_field_as_string(&event.payload, "reasonCode").as_ref()
                    != Some(expected_reason_code)
                {
                    return false;
                }
            }
            if from_timestamp_ms.is_some() || to_timestamp_ms.is_some() {
                let Some(event_timestamp_ms) =
                    parse_iso_timestamp_millis(event.occurred_at.as_str())
                else {
                    return false;
                };
                if let Some(from_ms) = from_timestamp_ms {
                    if event_timestamp_ms < from_ms {
                        return false;
                    }
                }
                if let Some(to_ms) = to_timestamp_ms {
                    if event_timestamp_ms > to_ms {
                        return false;
                    }
                }
            }
            true
        })
        .cloned()
        .collect::<Vec<_>>();

    // Keep the newest events first for diagnostics timeline.
    filtered.reverse();
    if filtered.len() > limit {
        filtered.truncate(limit);
    }
    Ok(filtered)
}

#[tauri::command]
pub fn local_ai_pick_manifest_path(app: AppHandle) -> Result<Option<String>, String> {
    let models_root = runtime_models_dir(&app)?;
    let selected = rfd::FileDialog::new()
        .set_directory(models_root)
        .set_title("Select model.manifest.json")
        .add_filter("Model Manifest", &["json"])
        .pick_file();
    let Some(path) = selected else {
        return Ok(None);
    };
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .trim()
        .to_string();
    if file_name != "model.manifest.json" {
        return Err(
            "LOCAL_AI_IMPORT_MANIFEST_FILE_NAME_INVALID: 仅支持导入 model.manifest.json 清单文件"
                .to_string(),
        );
    }
    Ok(Some(path.to_string_lossy().to_string()))
}

fn merge_json_object(
    base: serde_json::Value,
    extension: Option<serde_json::Value>,
) -> serde_json::Value {
    let mut output = match base {
        serde_json::Value::Object(object) => object,
        _ => serde_json::Map::<String, serde_json::Value>::new(),
    };
    if let Some(serde_json::Value::Object(extra)) = extension {
        for (key, value) in extra {
            output.insert(key, value);
        }
    }
    serde_json::Value::Object(output)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAiInstallAcceptedResponse {
    pub install_session_id: String,
    pub model_id: String,
    pub local_model_id: String,
}

/// Blocking version used by dependency-apply which needs synchronous install + upsert
/// to coordinate multi-dependency installs before starting services.
fn execute_hf_install_blocking(
    app: &AppHandle,
    install_request: LocalAiInstallRequest,
    install_metadata: Option<serde_json::Value>,
) -> Result<LocalAiModelRecord, String> {
    let install_session_id = next_install_session_id(install_request.model_id.as_str());
    let install_model_id = install_request.model_id.clone();
    let guessed_local_model_id =
        format!("hf:{}", slugify_local_model_id(install_model_id.as_str()));

    if let Err(error) = run_install_preflight(app, &install_request) {
        let reason_code = extract_reason_code(error.as_str());
        emit_download_progress_event(
            app,
            LocalAiDownloadProgressEvent {
                install_session_id: install_session_id.clone(),
                model_id: install_model_id.clone(),
                local_model_id: Some(guessed_local_model_id.clone()),
                phase: "preflight".to_string(),
                bytes_received: 0,
                bytes_total: Some(0),
                speed_bytes_per_sec: None,
                eta_seconds: Some(0.0),
                message: Some(error.clone()),
                state: LocalAiDownloadState::Failed,
                reason_code: Some(reason_code.clone()),
                retryable: Some(false),
                done: true,
                success: false,
            },
        );
        append_app_audit_event_non_blocking(
            app,
            EVENT_MODEL_DOWNLOAD_FAILED,
            Some(install_request.model_id.as_str()),
            None,
            Some(merge_json_object(
                serde_json::json!({
                    "phase": "preflight",
                    "reasonCode": reason_code,
                    "error": error,
                }),
                install_metadata.clone(),
            )),
        );
        return Err(error);
    }

    append_app_audit_event_non_blocking(
        app,
        EVENT_MODEL_DOWNLOAD_STARTED,
        Some(install_request.model_id.as_str()),
        None,
        Some(merge_json_object(
            serde_json::json!({
            "repo": install_request.repo,
            "revision": install_request.revision,
            "endpoint": install_request.endpoint,
            }),
            install_metadata.clone(),
        )),
    );

    let mut latest_phase = "download".to_string();
    let mut latest_bytes_received = 0_u64;
    let mut latest_bytes_total: Option<u64> = None;
    emit_download_progress_event(
        app,
        LocalAiDownloadProgressEvent {
            install_session_id: install_session_id.clone(),
            model_id: install_model_id.clone(),
            local_model_id: Some(guessed_local_model_id.clone()),
            phase: latest_phase.clone(),
            bytes_received: latest_bytes_received,
            bytes_total: latest_bytes_total,
            speed_bytes_per_sec: None,
            eta_seconds: None,
            message: Some("starting model install".to_string()),
            state: LocalAiDownloadState::Running,
            reason_code: None,
            retryable: Some(true),
            done: false,
            success: false,
        },
    );

    let mut on_progress = |progress: HfDownloadProgress| {
        latest_phase = progress.phase.clone();
        latest_bytes_received = progress.bytes_received;
        latest_bytes_total = progress.bytes_total;
        emit_download_progress_event(
            app,
            LocalAiDownloadProgressEvent {
                install_session_id: install_session_id.clone(),
                model_id: install_model_id.clone(),
                local_model_id: Some(guessed_local_model_id.clone()),
                phase: progress.phase,
                bytes_received: progress.bytes_received,
                bytes_total: progress.bytes_total,
                speed_bytes_per_sec: progress.speed_bytes_per_sec,
                eta_seconds: progress.eta_seconds,
                message: progress.message,
                state: LocalAiDownloadState::Running,
                reason_code: None,
                retryable: Some(true),
                done: false,
                success: false,
            },
        );
    };

    match install_from_hf(app, &install_request, &mut on_progress) {
        Ok(model) => {
            let saved = upsert_model(app, model)?;
            emit_download_progress_event(
                app,
                LocalAiDownloadProgressEvent {
                    install_session_id: install_session_id.clone(),
                    model_id: saved.model_id.clone(),
                    local_model_id: Some(saved.local_model_id.clone()),
                    phase: "verify".to_string(),
                    bytes_received: latest_bytes_received,
                    bytes_total: latest_bytes_total,
                    speed_bytes_per_sec: None,
                    eta_seconds: Some(0.0),
                    message: Some("installation completed".to_string()),
                    state: LocalAiDownloadState::Completed,
                    reason_code: None,
                    retryable: Some(false),
                    done: true,
                    success: true,
                },
            );
            append_app_audit_event_non_blocking(
                app,
                EVENT_MODEL_DOWNLOAD_COMPLETED,
                Some(saved.model_id.as_str()),
                Some(saved.local_model_id.as_str()),
                Some(merge_json_object(
                    serde_json::json!({
                        "engine": saved.engine,
                        "source": "huggingface",
                    }),
                    install_metadata.clone(),
                )),
            );
            append_app_audit_event_non_blocking(
                app,
                EVENT_MODEL_IMPORT_VALIDATED,
                Some(saved.model_id.as_str()),
                Some(saved.local_model_id.as_str()),
                None,
            );
            Ok(saved)
        }
        Err(error) => {
            let reason_code = extract_reason_code(error.as_str());
            let retryable = reason_code != "LOCAL_AI_HF_DOWNLOAD_HASH_MISMATCH";
            emit_download_progress_event(
                app,
                LocalAiDownloadProgressEvent {
                    install_session_id: install_session_id.clone(),
                    model_id: install_model_id.clone(),
                    local_model_id: Some(guessed_local_model_id.clone()),
                    phase: latest_phase.clone(),
                    bytes_received: latest_bytes_received,
                    bytes_total: latest_bytes_total,
                    speed_bytes_per_sec: None,
                    eta_seconds: None,
                    message: Some(error.clone()),
                    state: LocalAiDownloadState::Failed,
                    reason_code: Some(reason_code.clone()),
                    retryable: Some(retryable),
                    done: true,
                    success: false,
                },
            );
            append_app_audit_event_non_blocking(
                app,
                EVENT_MODEL_DOWNLOAD_FAILED,
                Some(install_request.model_id.as_str()),
                None,
                Some(merge_json_object(
                    serde_json::json!({
                        "error": error,
                    }),
                    install_metadata.clone(),
                )),
            );
            Err(error)
        }
    }
}

#[tauri::command]
pub fn local_ai_models_verified_list() -> Result<Vec<LocalAiVerifiedModelDescriptor>, String> {
    Ok(verified_model_list())
}

#[tauri::command]
pub fn local_ai_models_catalog_search(
    app: AppHandle,
    payload: Option<LocalAiModelsCatalogSearchPayload>,
) -> Result<Vec<LocalAiCatalogItemDescriptor>, String> {
    let query = payload
        .as_ref()
        .and_then(|item| normalize_optional(item.query.clone()));
    let capability = payload
        .as_ref()
        .and_then(|item| normalize_optional(item.capability.clone()));
    let limit = payload
        .as_ref()
        .and_then(|item| item.limit)
        .unwrap_or(20)
        .clamp(1, 80);

    append_app_audit_event_non_blocking(
        &app,
        EVENT_MODEL_CATALOG_SEARCH_INVOKED,
        None,
        None,
        Some(serde_json::json!({
            "query": query,
            "capability": capability,
            "limit": limit,
        })),
    );

    match search_catalog(query.as_deref(), capability.as_deref(), limit) {
        Ok(items) => Ok(items),
        Err(error) => {
            append_app_audit_event_non_blocking(
                &app,
                EVENT_MODEL_CATALOG_SEARCH_FAILED,
                None,
                None,
                Some(serde_json::json!({
                    "query": query,
                    "capability": capability,
                    "limit": limit,
                    "reasonCode": extract_reason_code(error.as_str()),
                    "error": error,
                })),
            );
            Err(error)
        }
    }
}

#[tauri::command]
pub fn local_ai_models_catalog_resolve_install_plan(
    payload: LocalAiModelsCatalogResolveInstallPlanPayload,
) -> Result<LocalAiInstallPlanDescriptor, String> {
    resolve_catalog_install_plan(LocalAiCatalogResolveInput {
        item_id: payload.item_id,
        source: payload.source,
        template_id: payload.template_id,
        model_id: payload.model_id,
        repo: payload.repo,
        revision: payload.revision,
        capabilities: payload.capabilities,
        engine: payload.engine,
        entry: payload.entry,
        files: payload.files,
        license: payload.license,
        hashes: payload.hashes,
        endpoint: payload.endpoint,
    })
}

#[tauri::command]
pub fn local_ai_dependencies_resolve(
    app: AppHandle,
    payload: LocalAiDependenciesResolvePayload,
) -> Result<LocalAiDependencyResolutionPlan, String> {
    append_app_audit_event_non_blocking(
        &app,
        EVENT_DEPENDENCY_RESOLVE_INVOKED,
        None,
        None,
        Some(serde_json::json!({
            "modId": payload.mod_id.clone(),
            "capability": payload.capability.clone(),
            "hasDependencies": payload.dependencies.is_some(),
            "hasDeviceProfile": true,
            "deviceProfile": payload.device_profile.clone(),
        })),
    );
    match resolve_dependency_plan(&app, &payload) {
        Ok(plan) => Ok(plan),
        Err(error) => {
            append_app_audit_event_non_blocking(
                &app,
                EVENT_DEPENDENCY_RESOLVE_FAILED,
                None,
                None,
                Some(serde_json::json!({
                    "modId": payload.mod_id,
                    "capability": payload.capability,
                    "deviceProfile": payload.device_profile,
                    "reasonCode": extract_reason_code(error.as_str()),
                    "error": error,
                })),
            );
            Err(error)
        }
    }
}

#[tauri::command]
pub fn local_ai_device_profile_collect(app: AppHandle) -> Result<LocalAiDeviceProfile, String> {
    Ok(collect_device_profile(&app))
}

#[tauri::command]
pub fn local_ai_dependencies_apply(
    app: AppHandle,
    payload: LocalAiDependenciesApplyPayload,
) -> Result<LocalAiDependencyApplyResult, String> {
    append_app_audit_event_non_blocking(
        &app,
        EVENT_DEPENDENCY_APPLY_STARTED,
        None,
        None,
        Some(serde_json::json!({
            "modId": payload.plan.mod_id.clone(),
            "planId": payload.plan.plan_id.clone(),
            "dependencyCount": payload.plan.dependencies.len(),
        })),
    );
    match run_dependency_apply(&app, &payload.plan) {
        Ok(result) => {
            append_app_audit_event_non_blocking(
                &app,
                EVENT_DEPENDENCY_APPLY_COMPLETED,
                None,
                None,
                Some(serde_json::json!({
                    "modId": result.mod_id.clone(),
                    "planId": result.plan_id.clone(),
                    "installedModelCount": result.installed_models.len(),
                    "serviceCount": result.services.len(),
                    "capabilities": result.capabilities.clone(),
                    "stageResults": result.stage_results.clone(),
                    "preflightDecisionCount": result.preflight_decisions.len(),
                    "rollbackApplied": result.rollback_applied,
                    "warningCount": result.warnings.len(),
                })),
            );
            Ok(result)
        }
        Err(failure) => {
            append_app_audit_event_non_blocking(
                &app,
                EVENT_DEPENDENCY_APPLY_FAILED,
                None,
                None,
                Some(serde_json::json!({
                    "modId": payload.plan.mod_id,
                    "planId": payload.plan.plan_id,
                    "reasonCode": extract_reason_code(failure.error.as_str()),
                    "rollbackApplied": failure.rollback_applied,
                    "error": failure.error.clone(),
                })),
            );
            Err(failure.error)
        }
    }
}

#[tauri::command]
pub fn local_ai_services_list(app: AppHandle) -> Result<Vec<LocalAiServiceDescriptor>, String> {
    let mut state = load_state(&app)?;
    let mut changed = false;
    for service in &mut state.services {
        let before_endpoint = service.endpoint.clone();
        let before_engine = service.engine.clone();
        let before_artifact_type = service.artifact_type.clone();
        normalize_service_descriptor(service);
        if service.endpoint != before_endpoint
            || service.engine != before_engine
            || service.artifact_type != before_artifact_type
        {
            changed = true;
        }
    }
    let previous_matrix_fingerprint = json_fingerprint(&state.capability_matrix);
    refresh_state_capability_matrix_with_provider_probe(&app, &mut state);
    if json_fingerprint(&state.capability_matrix) != previous_matrix_fingerprint {
        changed = true;
    }
    if changed {
        save_state(&app, &state)?;
    }
    Ok(state.services)
}

#[tauri::command]
pub fn local_ai_services_install(
    app: AppHandle,
    payload: LocalAiServicesInstallPayload,
) -> Result<LocalAiServiceDescriptor, String> {
    let artifact = find_service_artifact(payload.service_id.as_str());
    append_app_audit_event_non_blocking(
        &app,
        EVENT_SERVICE_INSTALL_STARTED,
        None,
        None,
        Some(serde_json::json!({
            "serviceId": payload.service_id.clone(),
            "engine": payload.engine.clone().or_else(|| artifact.as_ref().map(|item| item.engine.clone())),
            "artifactType": artifact.as_ref().map(|item| match item.artifact_type {
                super::types::LocalAiServiceArtifactType::PythonEnv => "python-env",
                super::types::LocalAiServiceArtifactType::Binary => "binary",
                super::types::LocalAiServiceArtifactType::AttachedEndpoint => "attached-endpoint",
            }),
            "localModelId": payload.local_model_id.clone(),
        })),
    );
    let descriptor = match build_service_descriptor_from_install_payload(&app, &payload) {
        Ok(value) => value,
        Err(error) => {
            append_app_audit_event_non_blocking(
                &app,
                EVENT_SERVICE_INSTALL_FAILED,
                None,
                None,
                Some(serde_json::json!({
                    "serviceId": payload.service_id,
                    "reasonCode": extract_reason_code(error.as_str()),
                    "artifactType": artifact.as_ref().map(|item| match item.artifact_type {
                        super::types::LocalAiServiceArtifactType::PythonEnv => "python-env",
                        super::types::LocalAiServiceArtifactType::Binary => "binary",
                        super::types::LocalAiServiceArtifactType::AttachedEndpoint => "attached-endpoint",
                    }),
                    "error": error,
                })),
            );
            return Err(error);
        }
    };
    let saved = upsert_service_descriptor(&app, descriptor)?;
    append_app_audit_event_non_blocking(
        &app,
        EVENT_SERVICE_INSTALL_COMPLETED,
        None,
        saved.local_model_id.as_deref(),
        Some(serde_json::json!({
            "serviceId": saved.service_id.clone(),
            "engine": saved.engine.clone(),
            "artifactType": saved.artifact_type.as_ref().map(|item| match item {
                super::types::LocalAiServiceArtifactType::PythonEnv => "python-env",
                super::types::LocalAiServiceArtifactType::Binary => "binary",
                super::types::LocalAiServiceArtifactType::AttachedEndpoint => "attached-endpoint",
            }),
            "capabilities": saved.capabilities.clone(),
        })),
    );
    Ok(saved)
}

#[tauri::command]
pub fn local_ai_services_start(
    app: AppHandle,
    payload: LocalAiServiceIdPayload,
) -> Result<LocalAiServiceDescriptor, String> {
    let service_id = normalize_non_empty(payload.service_id.as_str())
        .ok_or_else(|| "LOCAL_AI_SERVICE_ID_REQUIRED: serviceId is required".to_string())?;
    let state = load_state(&app)?;
    let index = find_service_index(&state.services, service_id.as_str())
        .ok_or_else(|| format!("LOCAL_AI_SERVICE_NOT_FOUND: serviceId={service_id}"))?;
    let mut service = state.services[index].clone();
    let before_endpoint = service.endpoint.clone();
    let before_engine = service.engine.clone();
    let before_artifact_type = service.artifact_type.clone();
    normalize_service_descriptor(&mut service);
    if service.endpoint != before_endpoint
        || service.engine != before_engine
        || service.artifact_type != before_artifact_type
    {
        service = upsert_service_descriptor(&app, service)?;
    }
    let detail = start_service_runtime(&app, &service)?;
    update_service_status(
        &app,
        service_id.as_str(),
        LocalAiServiceStatus::Active,
        Some(detail),
    )
}

#[tauri::command]
pub fn local_ai_services_stop(
    app: AppHandle,
    payload: LocalAiServiceIdPayload,
) -> Result<LocalAiServiceDescriptor, String> {
    let service_id = normalize_non_empty(payload.service_id.as_str())
        .ok_or_else(|| "LOCAL_AI_SERVICE_ID_REQUIRED: serviceId is required".to_string())?;
    let state = load_state(&app)?;
    let index = find_service_index(&state.services, service_id.as_str())
        .ok_or_else(|| format!("LOCAL_AI_SERVICE_NOT_FOUND: serviceId={service_id}"))?;
    let service = state.services[index].clone();
    if is_managed_service(service.service_id.as_str()) {
        let _ = stop_managed_service(service.service_id.as_str());
    }
    update_service_status(
        &app,
        service_id.as_str(),
        LocalAiServiceStatus::Installed,
        Some("service stopped".to_string()),
    )
}

#[tauri::command]
pub fn local_ai_services_health(
    app: AppHandle,
    payload: Option<LocalAiServiceIdPayload>,
) -> Result<Vec<LocalAiServiceDescriptor>, String> {
    let filter = payload
        .and_then(|item| normalize_non_empty(item.service_id.as_str()))
        .map(|item| item.to_ascii_lowercase());
    let mut state = load_state(&app)?;
    let mut output = Vec::<LocalAiServiceDescriptor>::new();

    for service in &mut state.services {
        if let Some(filter_value) = filter.as_ref() {
            let current = service.service_id.to_ascii_lowercase();
            if &current != filter_value {
                continue;
            }
        }
        normalize_service_descriptor(service);
        if let Err(error) = run_service_runtime_preflight(&app, None, service) {
            service.status = LocalAiServiceStatus::Unhealthy;
            service.detail = Some(error);
            service.updated_at = now_iso_timestamp();
            output.push(service.clone());
            continue;
        }
        match resolve_service_runtime_start_target(service) {
            ServiceRuntimeStartTarget::Endpoint(endpoint) => {
                match probe_service_endpoint_health(service.service_id.as_str(), endpoint.as_str())
                {
                    Ok(detail) => {
                        service.status = LocalAiServiceStatus::Active;
                        service.detail = Some(detail);
                    }
                    Err(error) => {
                        service.status = LocalAiServiceStatus::Unhealthy;
                        service.detail = Some(error);
                    }
                }
            }
            ServiceRuntimeStartTarget::Missing => {
                service.status = LocalAiServiceStatus::Unhealthy;
                service.detail = Some(service_target_missing_reason(service));
            }
        }
        service.updated_at = now_iso_timestamp();
        output.push(service.clone());
    }

    save_state(&app, &state)?;
    Ok(output)
}

#[tauri::command]
pub fn local_ai_services_remove(
    app: AppHandle,
    payload: LocalAiServiceIdPayload,
) -> Result<LocalAiServiceDescriptor, String> {
    let service_id = normalize_non_empty(payload.service_id.as_str())
        .ok_or_else(|| "LOCAL_AI_SERVICE_ID_REQUIRED: serviceId is required".to_string())?;
    update_service_status(
        &app,
        service_id.as_str(),
        LocalAiServiceStatus::Removed,
        Some("service removed".to_string()),
    )
}

#[tauri::command]
pub fn local_ai_nodes_catalog_list(
    app: AppHandle,
    payload: Option<LocalAiNodesCatalogListPayload>,
) -> Result<Vec<LocalAiNodeDescriptor>, String> {
    let mut state = load_state(&app)?;
    let capability = payload
        .as_ref()
        .and_then(|item| normalize_optional(item.capability.clone()))
        .map(|item| item.to_ascii_lowercase());
    let service_id = payload
        .as_ref()
        .and_then(|item| normalize_optional(item.service_id.clone()))
        .map(|item| item.to_ascii_lowercase());
    let provider = payload
        .as_ref()
        .and_then(|item| normalize_optional(item.provider.clone()))
        .map(|item| item.to_ascii_lowercase());

    let previous_matrix_fingerprint = json_fingerprint(&state.capability_matrix);
    refresh_state_capability_matrix_with_provider_probe(&app, &mut state);
    if json_fingerprint(&state.capability_matrix) != previous_matrix_fingerprint {
        save_state(&app, &state)?;
    }

    let nodes = list_nodes_from_services(
        state.services.as_slice(),
        state.capability_matrix.as_slice(),
        capability.as_deref(),
        service_id.as_deref(),
        provider.as_deref(),
    );

    append_app_audit_event_non_blocking(
        &app,
        EVENT_NODE_CATALOG_LISTED,
        None,
        None,
        Some(serde_json::json!({
            "capability": capability,
            "serviceId": service_id,
            "provider": provider,
            "count": nodes.len(),
        })),
    );
    Ok(nodes)
}

#[tauri::command]
pub fn local_ai_models_install(
    app: AppHandle,
    payload: LocalAiModelsInstallPayload,
) -> Result<LocalAiInstallAcceptedResponse, String> {
    let default_endpoint = default_runtime_endpoint_for(payload.engine.as_deref());
    let validated_endpoint = validate_loopback_endpoint(
        payload
            .endpoint
            .as_deref()
            .unwrap_or(default_endpoint.as_str()),
    )?;
    let install_request = LocalAiInstallRequest {
        model_id: payload.model_id,
        repo: payload.repo,
        revision: payload.revision,
        capabilities: payload.capabilities,
        engine: payload.engine,
        entry: payload.entry,
        files: payload.files,
        license: payload.license,
        hashes: payload.hashes,
        endpoint: Some(validated_endpoint),
        provider_hints: None,
    };
    run_install_preflight(&app, &install_request)?;
    let accepted = download_manager::enqueue_install(
        &app,
        install_request,
        Some(serde_json::json!({
            "installKind": "manual",
            "templateId": serde_json::Value::Null,
            "fileCount": serde_json::Value::Null,
            "engine": serde_json::Value::Null,
        })),
    )?;
    Ok(LocalAiInstallAcceptedResponse {
        install_session_id: accepted.install_session_id,
        model_id: accepted.model_id,
        local_model_id: accepted.local_model_id,
    })
}

#[tauri::command]
pub fn local_ai_models_install_verified(
    app: AppHandle,
    payload: LocalAiModelsInstallVerifiedPayload,
) -> Result<LocalAiInstallAcceptedResponse, String> {
    let template_id = payload.template_id.trim();
    if template_id.is_empty() {
        return Err("LOCAL_AI_VERIFIED_TEMPLATE_REQUIRED: templateId is required".to_string());
    }
    let descriptor = find_verified_model(template_id)
        .ok_or_else(|| format!("LOCAL_AI_VERIFIED_TEMPLATE_NOT_FOUND: templateId={template_id}"))?;
    let endpoint = validate_loopback_endpoint(
        payload
            .endpoint
            .as_deref()
            .unwrap_or(descriptor.endpoint.as_str()),
    )?;
    let install_request = LocalAiInstallRequest {
        model_id: descriptor.model_id.clone(),
        repo: descriptor.repo.clone(),
        revision: Some(descriptor.revision.clone()),
        capabilities: Some(descriptor.capabilities.clone()),
        engine: Some(descriptor.engine.clone()),
        entry: Some(descriptor.entry.clone()),
        files: Some(descriptor.files.clone()),
        license: Some(descriptor.license.clone()),
        hashes: Some(descriptor.hashes.clone()),
        endpoint: Some(endpoint),
        provider_hints: None,
    };
    run_install_preflight(&app, &install_request)?;
    let accepted = download_manager::enqueue_install(
        &app,
        install_request,
        Some(serde_json::json!({
            "templateId": descriptor.template_id,
            "installKind": descriptor.install_kind,
            "fileCount": descriptor.file_count,
            "engine": descriptor.engine,
        })),
    )?;
    Ok(LocalAiInstallAcceptedResponse {
        install_session_id: accepted.install_session_id,
        model_id: accepted.model_id,
        local_model_id: accepted.local_model_id,
    })
}

fn validated_install_session_id(payload: &LocalAiDownloadControlPayload) -> Result<String, String> {
    let value = payload.install_session_id.trim();
    if value.is_empty() {
        return Err(
            "LOCAL_AI_DOWNLOAD_SESSION_ID_REQUIRED: installSessionId is required".to_string(),
        );
    }
    Ok(value.to_string())
}

#[tauri::command]
pub fn local_ai_downloads_list(
    app: AppHandle,
) -> Result<Vec<LocalAiDownloadSessionSummary>, String> {
    download_manager::list_download_sessions(&app)
}

#[tauri::command]
pub fn local_ai_downloads_pause(
    app: AppHandle,
    payload: LocalAiDownloadControlPayload,
) -> Result<LocalAiDownloadSessionSummary, String> {
    let install_session_id = validated_install_session_id(&payload)?;
    download_manager::pause_download(&app, install_session_id.as_str())
}

#[tauri::command]
pub fn local_ai_downloads_resume(
    app: AppHandle,
    payload: LocalAiDownloadControlPayload,
) -> Result<LocalAiDownloadSessionSummary, String> {
    let install_session_id = validated_install_session_id(&payload)?;
    download_manager::resume_download(&app, install_session_id.as_str())
}

#[tauri::command]
pub fn local_ai_downloads_cancel(
    app: AppHandle,
    payload: LocalAiDownloadControlPayload,
) -> Result<LocalAiDownloadSessionSummary, String> {
    let install_session_id = validated_install_session_id(&payload)?;
    download_manager::cancel_download(&app, install_session_id.as_str())
}

#[tauri::command]
pub fn local_ai_models_import(
    app: AppHandle,
    payload: LocalAiModelsImportPayload,
) -> Result<LocalAiModelRecord, String> {
    let models_root = runtime_models_dir(&app)?;
    let path = validate_import_manifest_path(&payload.manifest_path, models_root.as_path())?;
    let endpoint_override = payload
        .endpoint
        .as_deref()
        .map(validate_loopback_endpoint)
        .transpose()?;

    match parse_and_validate_manifest(&path) {
        Ok(manifest) => {
            let saved = upsert_model(
                &app,
                manifest_to_model_record(&manifest, endpoint_override.as_deref())?,
            )?;
            append_app_audit_event_non_blocking(
                &app,
                EVENT_MODEL_IMPORT_VALIDATED,
                Some(saved.model_id.as_str()),
                Some(saved.local_model_id.as_str()),
                Some(serde_json::json!({
                    "manifestPath": payload.manifest_path,
                })),
            );
            Ok(saved)
        }
        Err(error) => {
            append_app_audit_event_non_blocking(
                &app,
                EVENT_MODEL_IMPORT_FAILED,
                None,
                None,
                Some(serde_json::json!({
                    "manifestPath": payload.manifest_path,
                    "error": error,
                })),
            );
            Err(error)
        }
    }
}

#[tauri::command]
pub fn local_ai_pick_model_file(app: AppHandle) -> Result<Option<String>, String> {
    let start_dir =
        dirs::home_dir().unwrap_or_else(|| runtime_models_dir(&app).unwrap_or_default());
    let selected = rfd::FileDialog::new()
        .set_directory(&start_dir)
        .set_title("Select model file to import")
        .add_filter(
            "Model Files",
            &["gguf", "safetensors", "bin", "pt", "onnx", "pth"],
        )
        .add_filter("All Files", &["*"])
        .pick_file();
    Ok(selected.map(|p| p.to_string_lossy().to_string()))
}

fn copy_and_hash_file<F>(
    source: &std::path::Path,
    dest: &std::path::Path,
    total_bytes: u64,
    mut on_progress: F,
) -> Result<String, String>
where
    F: FnMut(u64),
{
    let mut reader = std::fs::File::open(source)
        .map_err(|e| format!("LOCAL_AI_FILE_IMPORT_READ_FAILED: cannot open source file: {e}"))?;
    let mut writer = std::fs::File::create(dest).map_err(|e| {
        format!("LOCAL_AI_FILE_IMPORT_WRITE_FAILED: cannot create target file: {e}")
    })?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; 64 * 1024];
    let mut bytes_copied: u64 = 0;
    loop {
        let n = reader.read(&mut buffer).map_err(|e| {
            format!("LOCAL_AI_FILE_IMPORT_READ_FAILED: read error at byte {bytes_copied}: {e}")
        })?;
        if n == 0 {
            break;
        }
        writer.write_all(&buffer[..n]).map_err(|e| {
            format!("LOCAL_AI_FILE_IMPORT_WRITE_FAILED: write error at byte {bytes_copied}: {e}")
        })?;
        hasher.update(&buffer[..n]);
        bytes_copied += n as u64;
        on_progress(bytes_copied);
    }
    writer
        .flush()
        .map_err(|e| format!("LOCAL_AI_FILE_IMPORT_FLUSH_FAILED: {e}"))?;
    writer
        .sync_all()
        .map_err(|e| format!("LOCAL_AI_FILE_IMPORT_SYNC_FAILED: {e}"))?;
    let _ = total_bytes; // used by caller for progress ratio
    let digest = hasher.finalize();
    Ok(format!("sha256:{digest:x}"))
}

fn execute_file_import(
    app: &AppHandle,
    install_session_id: &str,
    model_id: &str,
    local_model_id: &str,
    slug: &str,
    source_path: &std::path::Path,
    file_name: &str,
    file_size: u64,
    capabilities: &[String],
    engine: &str,
    endpoint: &str,
) {
    let models_root = match runtime_models_dir(app) {
        Ok(dir) => dir,
        Err(error) => {
            emit_download_progress_event(
                app,
                LocalAiDownloadProgressEvent {
                    install_session_id: install_session_id.to_string(),
                    model_id: model_id.to_string(),
                    local_model_id: Some(local_model_id.to_string()),
                    phase: "copy".to_string(),
                    bytes_received: 0,
                    bytes_total: Some(file_size),
                    speed_bytes_per_sec: None,
                    eta_seconds: None,
                    message: Some(error.clone()),
                    state: LocalAiDownloadState::Failed,
                    reason_code: Some(extract_reason_code(error.as_str())),
                    retryable: Some(false),
                    done: true,
                    success: false,
                },
            );
            return;
        }
    };
    let dest_dir = models_root.join(slug);
    if let Err(error) = std::fs::create_dir_all(&dest_dir) {
        emit_download_progress_event(
            app,
            LocalAiDownloadProgressEvent {
                install_session_id: install_session_id.to_string(),
                model_id: model_id.to_string(),
                local_model_id: Some(local_model_id.to_string()),
                phase: "copy".to_string(),
                bytes_received: 0,
                bytes_total: Some(file_size),
                speed_bytes_per_sec: None,
                eta_seconds: None,
                message: Some(format!("LOCAL_AI_FILE_IMPORT_DIR_FAILED: {error}")),
                state: LocalAiDownloadState::Failed,
                reason_code: Some("LOCAL_AI_FILE_IMPORT_DIR_FAILED".to_string()),
                retryable: Some(false),
                done: true,
                success: false,
            },
        );
        return;
    }
    let dest_file = dest_dir.join(file_name);

    // Copy file with progress reporting (throttled to ~200ms intervals).
    let mut last_emit_ms: u64 = 0;
    let copy_start = std::time::Instant::now();
    let hash_result = copy_and_hash_file(source_path, &dest_file, file_size, |bytes_copied| {
        let elapsed = copy_start.elapsed();
        let elapsed_ms = elapsed.as_millis() as u64;
        if elapsed_ms.saturating_sub(last_emit_ms) < 200 && bytes_copied < file_size {
            return;
        }
        last_emit_ms = elapsed_ms;
        let speed = if elapsed.as_secs_f64() > 0.0 {
            Some(bytes_copied as f64 / elapsed.as_secs_f64())
        } else {
            None
        };
        let eta = speed.and_then(|s| {
            if s > 0.0 {
                Some((file_size.saturating_sub(bytes_copied)) as f64 / s)
            } else {
                None
            }
        });
        emit_download_progress_event(
            app,
            LocalAiDownloadProgressEvent {
                install_session_id: install_session_id.to_string(),
                model_id: model_id.to_string(),
                local_model_id: Some(local_model_id.to_string()),
                phase: "copy".to_string(),
                bytes_received: bytes_copied,
                bytes_total: Some(file_size),
                speed_bytes_per_sec: speed,
                eta_seconds: eta,
                message: None,
                state: LocalAiDownloadState::Running,
                reason_code: None,
                retryable: Some(true),
                done: false,
                success: false,
            },
        );
    });

    let hash = match hash_result {
        Ok(hash) => hash,
        Err(error) => {
            let _ = std::fs::remove_dir_all(&dest_dir);
            emit_download_progress_event(
                app,
                LocalAiDownloadProgressEvent {
                    install_session_id: install_session_id.to_string(),
                    model_id: model_id.to_string(),
                    local_model_id: Some(local_model_id.to_string()),
                    phase: "copy".to_string(),
                    bytes_received: 0,
                    bytes_total: Some(file_size),
                    speed_bytes_per_sec: None,
                    eta_seconds: None,
                    message: Some(error),
                    state: LocalAiDownloadState::Failed,
                    reason_code: Some("LOCAL_AI_FILE_IMPORT_COPY_FAILED".to_string()),
                    retryable: Some(false),
                    done: true,
                    success: false,
                },
            );
            return;
        }
    };

    // Write model.manifest.json
    let manifest = serde_json::json!({
        "model_id": model_id,
        "capabilities": capabilities,
        "engine": engine,
        "entry": file_name,
        "license": "unknown",
        "source": {
            "repo": format!("local-import/{}", slug),
            "revision": "local"
        },
        "hashes": {
            file_name: hash
        },
        "endpoint": endpoint
    });
    let manifest_path = dest_dir.join("model.manifest.json");
    let manifest_json = match serde_json::to_string_pretty(&manifest) {
        Ok(json) => json,
        Err(error) => {
            let _ = std::fs::remove_dir_all(&dest_dir);
            emit_download_progress_event(
                app,
                LocalAiDownloadProgressEvent {
                    install_session_id: install_session_id.to_string(),
                    model_id: model_id.to_string(),
                    local_model_id: Some(local_model_id.to_string()),
                    phase: "manifest".to_string(),
                    bytes_received: file_size,
                    bytes_total: Some(file_size),
                    speed_bytes_per_sec: None,
                    eta_seconds: None,
                    message: Some(format!(
                        "LOCAL_AI_FILE_IMPORT_MANIFEST_SERIALIZE_FAILED: {error}"
                    )),
                    state: LocalAiDownloadState::Failed,
                    reason_code: Some("LOCAL_AI_FILE_IMPORT_MANIFEST_SERIALIZE_FAILED".to_string()),
                    retryable: Some(false),
                    done: true,
                    success: false,
                },
            );
            return;
        }
    };
    if let Err(error) = std::fs::write(&manifest_path, manifest_json) {
        let _ = std::fs::remove_dir_all(&dest_dir);
        emit_download_progress_event(
            app,
            LocalAiDownloadProgressEvent {
                install_session_id: install_session_id.to_string(),
                model_id: model_id.to_string(),
                local_model_id: Some(local_model_id.to_string()),
                phase: "manifest".to_string(),
                bytes_received: file_size,
                bytes_total: Some(file_size),
                speed_bytes_per_sec: None,
                eta_seconds: None,
                message: Some(format!(
                    "LOCAL_AI_FILE_IMPORT_MANIFEST_WRITE_FAILED: {error}"
                )),
                state: LocalAiDownloadState::Failed,
                reason_code: Some("LOCAL_AI_FILE_IMPORT_MANIFEST_WRITE_FAILED".to_string()),
                retryable: Some(false),
                done: true,
                success: false,
            },
        );
        return;
    }

    // Register model via upsert
    let hashes = std::collections::HashMap::from([(file_name.to_string(), hash.clone())]);
    let record = LocalAiModelRecord {
        local_model_id: local_model_id.to_string(),
        model_id: model_id.to_string(),
        capabilities: capabilities.to_vec(),
        engine: engine.to_string(),
        entry: file_name.to_string(),
        license: "unknown".to_string(),
        source: super::types::LocalAiModelSource {
            repo: format!("local-import/{}", slug),
            revision: "local".to_string(),
        },
        hashes,
        endpoint: endpoint.to_string(),
        status: super::types::LocalAiModelStatus::Installed,
        installed_at: now_iso_timestamp(),
        updated_at: now_iso_timestamp(),
        health_detail: None,
    };
    match upsert_model(app, record) {
        Ok(saved) => {
            emit_download_progress_event(
                app,
                LocalAiDownloadProgressEvent {
                    install_session_id: install_session_id.to_string(),
                    model_id: saved.model_id.clone(),
                    local_model_id: Some(saved.local_model_id.clone()),
                    phase: "verify".to_string(),
                    bytes_received: file_size,
                    bytes_total: Some(file_size),
                    speed_bytes_per_sec: None,
                    eta_seconds: Some(0.0),
                    message: Some("file import completed".to_string()),
                    state: LocalAiDownloadState::Completed,
                    reason_code: None,
                    retryable: Some(false),
                    done: true,
                    success: true,
                },
            );
            append_app_audit_event_non_blocking(
                app,
                EVENT_MODEL_FILE_IMPORT_STARTED,
                Some(saved.model_id.as_str()),
                Some(saved.local_model_id.as_str()),
                Some(serde_json::json!({
                    "source": "local-file",
                    "engine": engine,
                    "capabilities": capabilities,
                    "hash": hash,
                })),
            );
            append_app_audit_event_non_blocking(
                app,
                EVENT_MODEL_IMPORT_VALIDATED,
                Some(saved.model_id.as_str()),
                Some(saved.local_model_id.as_str()),
                Some(serde_json::json!({
                    "manifestPath": manifest_path.to_string_lossy().to_string(),
                })),
            );
        }
        Err(error) => {
            let _ = std::fs::remove_dir_all(&dest_dir);
            emit_download_progress_event(
                app,
                LocalAiDownloadProgressEvent {
                    install_session_id: install_session_id.to_string(),
                    model_id: model_id.to_string(),
                    local_model_id: Some(local_model_id.to_string()),
                    phase: "upsert".to_string(),
                    bytes_received: file_size,
                    bytes_total: Some(file_size),
                    speed_bytes_per_sec: None,
                    eta_seconds: None,
                    message: Some(error),
                    state: LocalAiDownloadState::Failed,
                    reason_code: Some("LOCAL_AI_FILE_IMPORT_UPSERT_FAILED".to_string()),
                    retryable: Some(false),
                    done: true,
                    success: false,
                },
            );
        }
    }
}

#[tauri::command]
pub fn local_ai_models_import_file(
    app: AppHandle,
    payload: LocalAiModelsImportFilePayload,
) -> Result<LocalAiInstallAcceptedResponse, String> {
    // Validate source file exists
    let source_path = std::path::PathBuf::from(&payload.file_path);
    if !source_path.is_file() {
        return Err(format!(
            "LOCAL_AI_FILE_IMPORT_NOT_FOUND: file does not exist or is not a file: {}",
            payload.file_path
        ));
    }

    // Validate capabilities
    let capabilities = normalize_and_validate_capabilities(&payload.capabilities)?;
    if capabilities.is_empty() {
        return Err(
            "LOCAL_AI_FILE_IMPORT_CAPABILITIES_EMPTY: at least one capability is required"
                .to_string(),
        );
    }

    // Validate endpoint
    let engine = payload
        .engine
        .as_deref()
        .map(|v| v.trim())
        .filter(|v| !v.is_empty())
        .unwrap_or("localai");
    let default_endpoint = default_runtime_endpoint_for(Some(engine));
    let endpoint = validate_loopback_endpoint(
        payload
            .endpoint
            .as_deref()
            .unwrap_or(default_endpoint.as_str()),
    )?;

    // Derive model name from filename if not provided
    let file_name = source_path
        .file_name()
        .and_then(|v| v.to_str())
        .unwrap_or("model")
        .to_string();
    let model_name = payload
        .model_name
        .as_deref()
        .map(|v| v.trim())
        .filter(|v| !v.is_empty())
        .map(|v| v.to_string())
        .unwrap_or_else(|| {
            // Strip known extensions to derive a friendly name
            let stem = source_path
                .file_stem()
                .and_then(|v| v.to_str())
                .unwrap_or("model");
            stem.to_string()
        });

    let model_id = format!("local-import/{model_name}");
    let slug = slugify_local_model_id(&model_id);
    let local_model_id = format!("file:{slug}");
    let install_session_id = next_install_session_id(&model_id);

    // Get file size
    let file_size = std::fs::metadata(&source_path)
        .map(|m| m.len())
        .unwrap_or(0);

    // Emit initial progress
    emit_download_progress_event(
        &app,
        LocalAiDownloadProgressEvent {
            install_session_id: install_session_id.clone(),
            model_id: model_id.clone(),
            local_model_id: Some(local_model_id.clone()),
            phase: "copy".to_string(),
            bytes_received: 0,
            bytes_total: Some(file_size),
            speed_bytes_per_sec: None,
            eta_seconds: None,
            message: Some("starting file import".to_string()),
            state: LocalAiDownloadState::Running,
            reason_code: None,
            retryable: Some(true),
            done: false,
            success: false,
        },
    );

    let accepted = LocalAiInstallAcceptedResponse {
        install_session_id: install_session_id.clone(),
        model_id: model_id.clone(),
        local_model_id: local_model_id.clone(),
    };

    // Spawn copy on background thread
    let bg_app = app.clone();
    let bg_install_session_id = install_session_id;
    let bg_model_id = model_id;
    let bg_local_model_id = local_model_id;
    let bg_slug = slug;
    let bg_file_name = file_name;
    let bg_capabilities = capabilities;
    let bg_engine = engine.to_string();
    let bg_endpoint = endpoint;
    std::thread::spawn(move || {
        execute_file_import(
            &bg_app,
            &bg_install_session_id,
            &bg_model_id,
            &bg_local_model_id,
            &bg_slug,
            &source_path,
            &bg_file_name,
            file_size,
            &bg_capabilities,
            &bg_engine,
            &bg_endpoint,
        );
    });

    Ok(accepted)
}

#[tauri::command]
pub fn local_ai_models_remove(
    app: AppHandle,
    payload: LocalAiModelIdPayload,
) -> Result<LocalAiModelRecord, String> {
    remove_model(&app, &payload.local_model_id)
}

#[tauri::command]
pub fn local_ai_models_start(
    app: AppHandle,
    payload: LocalAiModelIdPayload,
) -> Result<LocalAiModelRecord, String> {
    start_model(&app, &payload.local_model_id)
}

#[tauri::command]
pub fn local_ai_models_stop(
    app: AppHandle,
    payload: LocalAiModelIdPayload,
) -> Result<LocalAiModelRecord, String> {
    stop_model(&app, &payload.local_model_id)
}

#[tauri::command]
pub fn local_ai_models_health(
    app: AppHandle,
    payload: Option<LocalAiModelsHealthPayload>,
) -> Result<LocalAiModelsHealthResult, String> {
    let local_model_id = payload
        .and_then(|item| item.local_model_id)
        .filter(|value| !value.trim().is_empty());
    let output = health(&app, local_model_id.as_deref())?;
    Ok(LocalAiModelsHealthResult { models: output })
}

#[tauri::command]
pub fn local_ai_append_inference_audit(
    app: AppHandle,
    payload: LocalAiInferenceAuditPayload,
) -> Result<(), String> {
    let event_type = validate_inference_event_type(payload.event_type.as_str())?;
    let source = validate_inference_source(payload.source.as_str())?;
    let modality = validate_inference_modality(payload.modality.as_str())?;
    let mod_id = payload.mod_id.trim();
    if mod_id.is_empty() {
        return Err("LOCAL_AI_AUDIT_MOD_ID_MISSING: modId is required".to_string());
    }
    let provider = payload.provider.trim();
    if provider.is_empty() {
        return Err("LOCAL_AI_AUDIT_PROVIDER_MISSING: provider is required".to_string());
    }

    let model = normalize_optional(payload.model);
    let local_model_id = normalize_optional(payload.local_model_id);
    let endpoint = normalize_optional(payload.endpoint);
    let reason_code = normalize_optional(payload.reason_code).map(|value| {
        normalize_local_ai_reason_code(value.as_str(), LOCAL_AI_PROVIDER_INTERNAL_ERROR)
    });
    let detail = normalize_optional(payload.detail);
    let adapter = normalize_optional(payload.adapter)
        .ok_or_else(|| "LOCAL_AI_AUDIT_ADAPTER_MISSING: adapter is required".to_string())?;

    let mut payload_object = serde_json::Map::<String, serde_json::Value>::new();
    payload_object.insert(
        "modId".to_string(),
        serde_json::Value::String(mod_id.to_string()),
    );
    payload_object.insert(
        "source".to_string(),
        serde_json::Value::String(source.to_string()),
    );
    payload_object.insert(
        "provider".to_string(),
        serde_json::Value::String(provider.to_string()),
    );
    payload_object.insert(
        "modality".to_string(),
        serde_json::Value::String(modality.to_string()),
    );
    payload_object.insert("adapter".to_string(), serde_json::Value::String(adapter));
    if let Some(value) = endpoint {
        payload_object.insert("endpoint".to_string(), serde_json::Value::String(value));
    }
    if let Some(value) = reason_code {
        payload_object.insert("reasonCode".to_string(), serde_json::Value::String(value));
    }
    if let Some(value) = detail {
        payload_object.insert("detail".to_string(), serde_json::Value::String(value));
    }
    if let Some(policy_gate) = payload.policy_gate {
        payload_object.insert("policyGate".to_string(), policy_gate);
    }
    if let Some(extra) = payload.extra {
        payload_object.insert("extra".to_string(), extra);
    }

    append_app_audit_event(
        &app,
        event_type,
        model.as_deref(),
        local_model_id.as_deref(),
        Some(serde_json::Value::Object(payload_object)),
    )
}

#[tauri::command]
pub fn local_ai_append_runtime_audit(
    app: AppHandle,
    payload: LocalAiRuntimeAuditPayload,
) -> Result<(), String> {
    let event_type = validate_runtime_audit_event_type(payload.event_type.as_str())?;
    append_app_audit_event(
        &app,
        event_type,
        normalize_optional(payload.model_id).as_deref(),
        normalize_optional(payload.local_model_id).as_deref(),
        payload.payload,
    )
}

#[tauri::command]
pub fn local_ai_models_reveal_in_folder(
    app: AppHandle,
    payload: LocalAiModelIdPayload,
) -> Result<(), String> {
    let local_model_id = normalize_non_empty(payload.local_model_id.as_str())
        .ok_or_else(|| "LOCAL_AI_MODEL_ID_REQUIRED".to_string())?;
    let slug = slugify_local_model_id(local_model_id.as_str());
    let models_root = runtime_models_dir(&app)?;
    let model_dir = models_root.join(&slug);
    let target = if model_dir.exists() {
        &model_dir
    } else {
        &models_root
    };
    reveal_path_in_os(target)
}

fn reveal_path_in_os(path: &std::path::Path) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(path)
            .spawn()
            .map_err(|e| format!("reveal failed: {e}"))?;
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(path)
            .spawn()
            .map_err(|e| format!("reveal failed: {e}"))?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(path.parent().unwrap_or(path))
            .spawn()
            .map_err(|e| format!("reveal failed: {e}"))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{copy_and_hash_file, extract_reason_code, run_install_preflight_with};
    use crate::local_ai_runtime::types::LocalAiInstallRequest;

    fn install_request_fixture(engine: Option<&str>) -> LocalAiInstallRequest {
        LocalAiInstallRequest {
            model_id: "Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign".to_string(),
            repo: "Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign".to_string(),
            revision: Some("main".to_string()),
            capabilities: Some(vec!["tts".to_string()]),
            engine: engine.map(|value| value.to_string()),
            entry: Some("model.safetensors".to_string()),
            files: None,
            license: Some("apache-2.0".to_string()),
            hashes: None,
            endpoint: Some("http://127.0.0.1:1234/v1".to_string()),
            provider_hints: None,
        }
    }

    #[test]
    fn install_preflight_runs_for_localai_engine() {
        let request = install_request_fixture(Some("localai"));
        let result = run_install_preflight_with(&request, |engine| {
            assert_eq!(engine, "localai");
            Err("LOCAL_AI_SERVICE_UNREACHABLE: service unreachable".to_string())
        });
        let error = result.expect_err("preflight error should bubble");
        assert!(error.contains("LOCAL_AI_SERVICE_UNREACHABLE"));
    }

    #[test]
    fn install_preflight_runs_for_explicit_engine() {
        let request = install_request_fixture(Some("localai"));
        let result = run_install_preflight_with(&request, |engine| {
            assert_eq!(engine, "localai");
            Ok(())
        });
        assert!(result.is_ok());
    }

    #[test]
    fn install_preflight_preserves_reason_code_prefix() {
        let reason = extract_reason_code("LOCAL_AI_PROVIDER_TIMEOUT: provider timeout");
        assert_eq!(reason, "LOCAL_AI_PROVIDER_TIMEOUT");
    }

    // --- copy_and_hash_file tests ---

    #[test]
    fn copy_and_hash_file_copies_content_and_produces_correct_sha256() {
        let tmp = tempfile::tempdir().expect("create temp dir");
        let src = tmp.path().join("source.gguf");
        let dst = tmp.path().join("dest.gguf");
        let content = b"hello world model data for sha256 test";
        std::fs::write(&src, content).expect("write source");

        let hash = copy_and_hash_file(&src, &dst, content.len() as u64, |_| {})
            .expect("copy should succeed");

        // Verify content was copied
        let copied = std::fs::read(&dst).expect("read dest");
        assert_eq!(copied, content);

        // Verify SHA256 hash
        use sha2::{Digest, Sha256};
        let expected = format!("sha256:{:x}", Sha256::digest(content));
        assert_eq!(hash, expected);
    }

    #[test]
    fn copy_and_hash_file_handles_empty_file() {
        let tmp = tempfile::tempdir().expect("create temp dir");
        let src = tmp.path().join("empty.bin");
        let dst = tmp.path().join("empty_copy.bin");
        std::fs::write(&src, b"").expect("write empty source");

        let hash =
            copy_and_hash_file(&src, &dst, 0, |_| {}).expect("copy should succeed for empty file");

        let copied = std::fs::read(&dst).expect("read dest");
        assert!(copied.is_empty());

        use sha2::{Digest, Sha256};
        let expected = format!("sha256:{:x}", Sha256::digest(b""));
        assert_eq!(hash, expected);
    }

    #[test]
    fn copy_and_hash_file_handles_large_content_across_multiple_chunks() {
        let tmp = tempfile::tempdir().expect("create temp dir");
        let src = tmp.path().join("large.bin");
        let dst = tmp.path().join("large_copy.bin");
        // 200KB = ~3 chunks of 64KB buffer
        let content = vec![0xABu8; 200 * 1024];
        std::fs::write(&src, &content).expect("write large source");

        let hash = copy_and_hash_file(&src, &dst, content.len() as u64, |_| {})
            .expect("copy should succeed");

        let copied = std::fs::read(&dst).expect("read dest");
        assert_eq!(copied.len(), content.len());
        assert_eq!(copied, content);

        use sha2::{Digest, Sha256};
        let expected = format!("sha256:{:x}", Sha256::digest(&content));
        assert_eq!(hash, expected);
    }

    #[test]
    fn copy_and_hash_file_progress_callback_invoked() {
        let tmp = tempfile::tempdir().expect("create temp dir");
        let src = tmp.path().join("progress.bin");
        let dst = tmp.path().join("progress_copy.bin");
        let content = vec![0x42u8; 128 * 1024]; // 128KB = 2 chunks
        std::fs::write(&src, &content).expect("write source");

        let mut progress_calls = Vec::new();
        let hash = copy_and_hash_file(&src, &dst, content.len() as u64, |bytes_copied| {
            progress_calls.push(bytes_copied);
        })
        .expect("copy should succeed");

        // Should have at least 2 progress callbacks (2 chunks)
        assert!(
            progress_calls.len() >= 2,
            "expected >= 2 progress calls, got {}",
            progress_calls.len()
        );
        // Progress should be monotonically increasing
        for window in progress_calls.windows(2) {
            assert!(
                window[1] >= window[0],
                "progress should be monotonically increasing"
            );
        }
        // Final progress should equal total bytes
        assert_eq!(
            *progress_calls.last().unwrap(),
            content.len() as u64,
            "last progress should equal total bytes"
        );
        assert!(hash.starts_with("sha256:"));
    }

    #[test]
    fn copy_and_hash_file_fails_on_missing_source() {
        let tmp = tempfile::tempdir().expect("create temp dir");
        let src = tmp.path().join("nonexistent.gguf");
        let dst = tmp.path().join("dest.gguf");

        let result = copy_and_hash_file(&src, &dst, 0, |_| {});
        let error = result.expect_err("should fail for missing source");
        assert!(
            error.contains("LOCAL_AI_FILE_IMPORT_READ_FAILED"),
            "error should contain reason code, got: {error}"
        );
    }

    #[test]
    fn copy_and_hash_file_fails_on_invalid_dest_path() {
        let tmp = tempfile::tempdir().expect("create temp dir");
        let src = tmp.path().join("source.bin");
        std::fs::write(&src, b"data").expect("write source");
        // Dest inside a non-existent directory
        let dst = tmp.path().join("no-such-dir").join("deep").join("dest.bin");

        let result = copy_and_hash_file(&src, &dst, 4, |_| {});
        let error = result.expect_err("should fail for invalid dest path");
        assert!(
            error.contains("LOCAL_AI_FILE_IMPORT_WRITE_FAILED"),
            "error should contain reason code, got: {error}"
        );
    }
}
