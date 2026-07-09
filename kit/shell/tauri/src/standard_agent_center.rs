use chrono::{Duration, Utc};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs::{self, OpenOptions};
use std::io::{ErrorKind, Write};
use std::path::{Component, Path, PathBuf};
use tauri::Manager;

const VALIDATION_SCHEMA_VERSION: u8 = 1;
const MAX_LIVE2D_ADAPTER_MANIFEST_BYTES: u64 = 262_144;
const MAX_AVATAR_ASSET_MANIFEST_BYTES: u64 = 262_144;
const MAX_AVATAR_ASSET_BYTES: u64 = 524_288_000;
const MAX_AVATAR_ASSET_FILE_BYTES: u64 = 104_857_600;
const MAX_AVATAR_ASSET_FILE_COUNT: usize = 2_048;
const MAX_BACKGROUND_BYTES: u64 = 20_971_520;
const MAX_BACKGROUND_PIXELS: u32 = 8_192;
const VALIDATION_FILE_NAME: &str = "validation.json";
const MANIFEST_FILE_NAME: &str = "manifest.json";
const LIVE2D_ADAPTER_FILE_NAME: &str = "live2d-adapter.json";
const LIVE2D_ADAPTER_CUSTODY_FILE_NAME: &str = "custody.json";
const OPERATIONS_FILE_NAME: &str = "agent-center-local-resources.jsonl";
const OPERATION_RETENTION_DAYS: i64 = 30;
const QUARANTINE_RETENTION_DAYS: i64 = 7;
const LOCAL_AGENT_REF_PREFIX: &str = "local-agent:";

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StandardAgentCenterLive2dAdapterManifestImportPayload {
    pub host_scope: String,
    pub account_id: String,
    pub owner_user_id: String,
    pub runtime_source_ref: String,
    pub local_agent_ref: String,
    pub avatar_asset_ref: String,
    pub source_path: String,
    pub select: Option<bool>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StandardAgentCenterAvatarAssetImportPayload {
    pub host_scope: String,
    pub account_id: String,
    pub owner_user_id: String,
    pub runtime_source_ref: String,
    pub local_agent_ref: String,
    pub backend_kind: StandardAgentCenterAvatarBackendKind,
    pub source_path: String,
    pub display_name: Option<String>,
    pub select: Option<bool>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StandardAgentCenterAvatarAssetValidatePayload {
    pub host_scope: String,
    pub account_id: String,
    pub owner_user_id: String,
    pub runtime_source_ref: String,
    pub local_agent_ref: String,
    pub avatar_asset_ref: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StandardAgentCenterAgentLocalResourcesRemovePayload {
    pub host_scope: String,
    pub account_id: String,
    pub owner_user_id: String,
    pub runtime_source_ref: String,
    pub local_agent_ref: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StandardAgentCenterAccountLocalResourcesRemovePayload {
    pub account_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StandardAgentCenterBackgroundValidatePayload {
    pub host_scope: String,
    pub account_id: String,
    pub owner_user_id: String,
    pub runtime_source_ref: String,
    pub local_agent_ref: String,
    pub background_asset_ref: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StandardAgentCenterBackgroundRemovePayload {
    pub host_scope: String,
    pub account_id: String,
    pub owner_user_id: String,
    pub runtime_source_ref: String,
    pub local_agent_ref: String,
    pub background_asset_ref: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StandardAgentCenterBackgroundImportPayload {
    pub host_scope: String,
    pub account_id: String,
    pub owner_user_id: String,
    pub runtime_source_ref: String,
    pub local_agent_ref: String,
    pub source_path: String,
    pub display_name: Option<String>,
    pub select: Option<bool>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StandardAgentCenterAvatarPreviewResolvePayload {
    pub host_scope: String,
    pub account_id: String,
    pub owner_user_id: String,
    pub runtime_source_ref: String,
    pub local_agent_ref: String,
    pub avatar_asset_ref: String,
    pub backend_kind: Option<StandardAgentCenterAvatarBackendKind>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StandardAgentCenterLive2dAdapterManifestImportResult {
    pub manifest_ref: String,
    pub local_asset_id: String,
    pub selected: bool,
    pub sha256: String,
    pub bytes: u64,
    pub imported_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StandardAgentCenterAvatarAssetImportResult {
    pub local_asset_id: String,
    pub backend_kind: StandardAgentCenterAvatarBackendKind,
    pub selected: bool,
    pub materialization_ref: String,
    pub backend_capability_profile_ref: String,
    pub validation: StandardAgentCenterAvatarAssetValidationResult,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StandardAgentCenterLocalResourceRemoveResult {
    pub resource_kind: String,
    pub resource_id: String,
    pub quarantined: bool,
    pub operation_id: String,
    pub status: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StandardAgentCenterBackgroundImportResult {
    pub background_asset_id: String,
    pub selected: bool,
    pub validation: StandardAgentCenterBackgroundValidationResult,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StandardAgentCenterBackgroundAssetResult {
    pub background_asset_id: String,
    pub file_url: String,
    pub validation: StandardAgentCenterBackgroundValidationResult,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StandardAgentCenterAvatarBackendKind {
    Live2d,
    Vrm,
    Future,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StandardAgentCenterValidationIssueSeverity {
    Error,
    Warning,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StandardAgentCenterValidationIssue {
    pub code: String,
    pub message: String,
    pub path: Option<String>,
    pub severity: StandardAgentCenterValidationIssueSeverity,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StandardAgentCenterBackgroundValidationStatus {
    Valid,
    InvalidManifest,
    MissingImage,
    PermissionDenied,
    PathRejected,
    UnsupportedMime,
    AssetMissing,
    DigestMismatch,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StandardAgentCenterAvatarAssetValidationStatus {
    Valid,
    InvalidManifest,
    MissingEntry,
    PermissionDenied,
    PathRejected,
    UnsupportedKind,
    AssetMissing,
    DigestMismatch,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StandardAgentCenterBackgroundValidationResult {
    pub schema_version: u8,
    pub background_asset_id: String,
    pub checked_at: String,
    pub status: StandardAgentCenterBackgroundValidationStatus,
    pub errors: Vec<StandardAgentCenterValidationIssue>,
    pub warnings: Vec<StandardAgentCenterValidationIssue>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StandardAgentCenterAvatarAssetValidationResult {
    pub schema_version: u8,
    pub local_asset_id: String,
    pub checked_at: String,
    pub status: StandardAgentCenterAvatarAssetValidationStatus,
    pub errors: Vec<StandardAgentCenterValidationIssue>,
    pub warnings: Vec<StandardAgentCenterValidationIssue>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct LocalAgentScope {
    pub owner_user_id: String,
    pub runtime_source_ref: String,
    pub local_agent_ref: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct BackgroundManifest {
    manifest_version: u8,
    background_asset_id: String,
    display_name: String,
    image_file: String,
    mime: String,
    bytes: u64,
    pixel_width: u32,
    pixel_height: u32,
    limits: BackgroundManifestLimits,
    sha256: String,
    imported_at: String,
    source_label: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct BackgroundManifestLimits {
    max_bytes: u64,
    max_pixel_width: u32,
    max_pixel_height: u32,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Live2dAdapterManifestCustody {
    custody_version: u8,
    manifest_ref: String,
    local_asset_id: String,
    manifest_kind: String,
    schema_version: u8,
    sha256: String,
    bytes: u64,
    imported_at: String,
    source_label: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct AvatarAssetManifest {
    manifest_version: u8,
    asset_version: String,
    local_asset_id: String,
    kind: String,
    loader_min_version: String,
    display_name: String,
    #[serde(default)]
    display_name_i18n: serde_json::Map<String, serde_json::Value>,
    entry_file: String,
    required_files: Vec<String>,
    content_digest: String,
    files: Vec<AvatarAssetManifestFile>,
    limits: AvatarAssetManifestLimits,
    capabilities: serde_json::Value,
    import: AvatarAssetManifestImport,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct AvatarAssetManifestFile {
    path: String,
    sha256: String,
    bytes: u64,
    mime: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct AvatarAssetManifestLimits {
    max_manifest_bytes: u64,
    max_asset_bytes: u64,
    max_file_bytes: u64,
    max_file_count: usize,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct AvatarAssetManifestImport {
    imported_at: String,
    source_label: String,
    source_fingerprint: String,
}

#[derive(Debug, Serialize)]
#[serde(deny_unknown_fields)]
struct StandardAgentCenterResourceOperationRecord {
    schema_version: u8,
    event_id: String,
    transaction_id: String,
    occurred_at: String,
    operation_type: String,
    resource_kind: String,
    resource_id: String,
    status: String,
    reason_code: String,
}

#[path = "standard_agent_center/resources_avatar_import.rs"]
mod resources_avatar_import;
#[path = "standard_agent_center/resources_background_import.rs"]
mod resources_background_import;
#[path = "standard_agent_center/resources_live2d_adapter_import.rs"]
mod resources_live2d_adapter_import;
#[path = "standard_agent_center/resources_live2d_validation.rs"]
mod resources_live2d_validation;
#[path = "standard_agent_center/resources_manifest_validation.rs"]
mod resources_manifest_validation;
#[path = "standard_agent_center/resources_operations.rs"]
mod resources_operations;
#[path = "standard_agent_center/resources_remove_commands.rs"]
mod resources_remove_commands;
#[path = "standard_agent_center/resources_validation.rs"]
mod resources_validation;

use resources_avatar_import::*;
use resources_background_import::*;
use resources_live2d_adapter_import::*;
use resources_live2d_validation::*;
use resources_manifest_validation::*;
use resources_operations::*;
use resources_validation::*;

pub(crate) use resources_manifest_validation::{
    standard_agent_center_avatar_asset_validate_blocking,
    standard_agent_center_background_asset_get_blocking,
    standard_agent_center_background_validate_blocking,
};
pub(crate) use resources_remove_commands::{
    standard_agent_center_account_local_resources_remove_blocking,
    standard_agent_center_agent_local_resources_remove_blocking,
    standard_agent_center_background_remove_blocking,
};

pub(crate) fn validate_normalized_id(value: &str, field_name: &str) -> Result<String, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(format!("{field_name} is required"));
    }
    if trimmed.len() > 256 {
        return Err(format!("{field_name} must be 256 characters or shorter"));
    }
    if trimmed == "." || trimmed == ".." || trimmed.contains("://") {
        return Err(format!("{field_name} contains unsupported characters"));
    }
    if !trimmed.chars().any(|ch| ch.is_ascii_alphanumeric()) {
        return Err(format!("{field_name} contains unsupported characters"));
    }
    for ch in trimmed.chars() {
        let allowed =
            ch.is_ascii_alphanumeric() || matches!(ch, '_' | '-' | '.' | '~' | ':' | '@' | '+');
        if !allowed {
            return Err(format!(
                "{field_name} contains unsupported characters: {:?}",
                trimmed
            ));
        }
    }
    Ok(trimmed.to_string())
}

pub(crate) fn validate_local_agent_scope(
    owner_user_id: &str,
    runtime_source_ref: &str,
    local_agent_ref: &str,
) -> Result<LocalAgentScope, String> {
    let owner_user_id = validate_normalized_id(owner_user_id, "ownerUserId")?;
    let runtime_source_ref = validate_normalized_id(runtime_source_ref, "runtimeSourceRef")?;
    let local_agent_ref = validate_normalized_id(local_agent_ref, "localAgentRef")?;
    if local_agent_ref == runtime_source_ref {
        return Err("localAgentRef must not be a bare runtimeSourceRef".to_string());
    }
    if !local_agent_ref.starts_with(LOCAL_AGENT_REF_PREFIX) {
        return Err("localAgentRef must start with local-agent:".to_string());
    }
    Ok(LocalAgentScope {
        owner_user_id,
        runtime_source_ref,
        local_agent_ref,
    })
}

pub(crate) fn validate_local_agent_host_scope(value: &str) -> Result<(), String> {
    let host_scope = validate_normalized_id(value, "hostScope")?;
    if host_scope != "local-agent" {
        return Err(
            "hostScope must be local-agent for agent-scoped Agent Center custody".to_string(),
        );
    }
    Ok(())
}

fn can_use_raw_scope_path_segment(value: &str) -> bool {
    let body = value.strip_prefix('~').unwrap_or(value);
    if body.is_empty() || value.len() > 128 {
        return false;
    }
    let mut chars = body.chars();
    matches!(chars.next(), Some(first) if first.is_ascii_lowercase() || first.is_ascii_digit())
        && body
            .chars()
            .all(|ch| ch.is_ascii_lowercase() || ch.is_ascii_digit() || ch == '_' || ch == '-')
}

pub(crate) fn local_scope_path_segment(value: &str) -> String {
    if can_use_raw_scope_path_segment(value) {
        return value.to_string();
    }
    let mut hasher = Sha256::new();
    hasher.update(value.as_bytes());
    let digest = format!("{:x}", hasher.finalize());
    format!("id_{}", &digest[..24])
}

pub(crate) fn validate_hex_suffix(
    value: &str,
    prefix: &str,
    field_name: &str,
) -> Result<(), String> {
    let Some(suffix) = value.strip_prefix(prefix) else {
        return Err(format!("{field_name} must start with {prefix}"));
    };
    if suffix.len() != 12
        || !suffix
            .chars()
            .all(|ch| ch.is_ascii_hexdigit() && !ch.is_ascii_uppercase())
    {
        return Err(format!(
            "{field_name} must end with 12 lowercase hex characters"
        ));
    }
    Ok(())
}

pub(crate) fn validate_background_id(value: &str, field_name: &str) -> Result<(), String> {
    validate_hex_suffix(value, "bg_", field_name)
}

pub(crate) fn validate_local_asset_id(value: &str, field_name: &str) -> Result<(), String> {
    if value.starts_with("live2d_") {
        return validate_hex_suffix(value, "live2d_", field_name);
    }
    if value.starts_with("vrm_") {
        return validate_hex_suffix(value, "vrm_", field_name);
    }
    Err(format!("{field_name} must start with live2d_ or vrm_"))
}

pub(crate) fn avatar_backend_kind_label(
    kind: StandardAgentCenterAvatarBackendKind,
) -> &'static str {
    match kind {
        StandardAgentCenterAvatarBackendKind::Live2d => "live2d",
        StandardAgentCenterAvatarBackendKind::Vrm => "vrm",
        StandardAgentCenterAvatarBackendKind::Future => "future",
    }
}

pub(crate) fn avatar_backend_kind_for_asset_ref(
    value: &str,
) -> Result<StandardAgentCenterAvatarBackendKind, String> {
    validate_local_asset_id(value, "avatarAssetRef")?;
    if value.starts_with("live2d_") {
        return Ok(StandardAgentCenterAvatarBackendKind::Live2d);
    }
    Ok(StandardAgentCenterAvatarBackendKind::Vrm)
}

pub(crate) fn validate_live2d_adapter_manifest_ref(
    value: &str,
    field_name: &str,
) -> Result<(), String> {
    validate_hex_suffix(value, "live2d_adapter_", field_name)
}

pub(crate) fn validate_utc_timestamp(value: &str, field_name: &str) -> Result<(), String> {
    if !value.ends_with('Z') {
        return Err(format!("{field_name} must use UTC Z timestamp form"));
    }
    chrono::DateTime::parse_from_rfc3339(value)
        .map(|_| ())
        .map_err(|error| format!("{field_name} is not a valid timestamp: {error}"))
}

pub(crate) fn agent_center_dir(
    roots: &crate::runtime_app_storage::StandardAppStorageRoots,
    account_id: &str,
    local_agent_ref: &str,
) -> Result<PathBuf, String> {
    Ok(roots
        .data_root()
        .join("agent-center")
        .join("accounts")
        .join(local_scope_path_segment(account_id))
        .join("agents")
        .join(local_scope_path_segment(local_agent_ref))
        .join("agent-center"))
}

pub(crate) fn account_dir(
    roots: &crate::runtime_app_storage::StandardAppStorageRoots,
    account_id: &str,
) -> Result<PathBuf, String> {
    Ok(roots
        .data_root()
        .join("agent-center")
        .join("accounts")
        .join(local_scope_path_segment(account_id)))
}

pub(crate) fn require_file_dialog_selected_source(
    path: &Path,
    command: &str,
) -> Result<(), String> {
    if crate::standard_file_dialog::is_registered_file_dialog_selected_path(path) {
        return Ok(());
    }
    Err(crate::capabilities::standard_shell_error(
        "permission-denied",
        "tauri-agent-center-source-not-from-file-dialog",
        "select_agent_center_import_source_with_standard_file_dialog",
        "tauri",
        Some(serde_json::json!({
            "command": command,
            "path": path.display().to_string(),
        })),
    ))
}

pub(crate) async fn run_agent_center_resource_blocking<T, F>(
    operation: &'static str,
    task: F,
) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(task)
        .await
        .map_err(|error| format!("{operation} background worker failed: {error}"))?
}

pub async fn avatar_asset_import(
    roots: crate::runtime_app_storage::StandardAppStorageRoots,
    payload: StandardAgentCenterAvatarAssetImportPayload,
) -> Result<StandardAgentCenterAvatarAssetImportResult, String> {
    run_agent_center_resource_blocking("agent_center_avatar_asset_import", move || {
        standard_agent_center_avatar_asset_import_blocking(&roots, payload)
    })
    .await
}

pub async fn avatar_asset_validate(
    roots: crate::runtime_app_storage::StandardAppStorageRoots,
    payload: StandardAgentCenterAvatarAssetValidatePayload,
) -> Result<StandardAgentCenterAvatarAssetValidationResult, String> {
    run_agent_center_resource_blocking("agent_center_avatar_asset_validate", move || {
        standard_agent_center_avatar_asset_validate_blocking(&roots, payload)
    })
    .await
}

pub async fn avatar_asset_resolve_preview(
    roots: crate::runtime_app_storage::StandardAppStorageRoots,
    payload: StandardAgentCenterAvatarPreviewResolvePayload,
) -> Result<serde_json::Value, String> {
    let backend_kind = payload
        .backend_kind
        .unwrap_or(avatar_backend_kind_for_asset_ref(
            &payload.avatar_asset_ref,
        )?);
    let avatar_asset_ref = payload.avatar_asset_ref.clone();
    let validation_payload = StandardAgentCenterAvatarAssetValidatePayload {
        host_scope: payload.host_scope,
        account_id: payload.account_id,
        owner_user_id: payload.owner_user_id,
        runtime_source_ref: payload.runtime_source_ref,
        local_agent_ref: payload.local_agent_ref,
        avatar_asset_ref: avatar_asset_ref.clone(),
    };
    let validation = avatar_asset_validate(roots, validation_payload).await?;
    Ok(shell_avatar_preview_result(
        avatar_asset_ref,
        backend_kind,
        validation,
    ))
}

pub async fn live2d_adapter_manifest_import(
    roots: crate::runtime_app_storage::StandardAppStorageRoots,
    payload: StandardAgentCenterLive2dAdapterManifestImportPayload,
) -> Result<StandardAgentCenterLive2dAdapterManifestImportResult, String> {
    run_agent_center_resource_blocking("agent_center_live2d_adapter_import", move || {
        standard_agent_center_live2d_adapter_manifest_import_blocking(&roots, payload)
    })
    .await
}

pub async fn background_import(
    roots: crate::runtime_app_storage::StandardAppStorageRoots,
    payload: StandardAgentCenterBackgroundImportPayload,
) -> Result<StandardAgentCenterBackgroundImportResult, String> {
    run_agent_center_resource_blocking("agent_center_background_import", move || {
        standard_agent_center_background_import_blocking(&roots, payload)
    })
    .await
}

pub async fn background_validate(
    roots: crate::runtime_app_storage::StandardAppStorageRoots,
    payload: StandardAgentCenterBackgroundValidatePayload,
) -> Result<StandardAgentCenterBackgroundValidationResult, String> {
    run_agent_center_resource_blocking("agent_center_background_validate", move || {
        standard_agent_center_background_validate_blocking(&roots, payload)
    })
    .await
}

pub async fn background_get(
    roots: crate::runtime_app_storage::StandardAppStorageRoots,
    app: tauri::AppHandle,
    payload: StandardAgentCenterBackgroundValidatePayload,
) -> Result<StandardAgentCenterBackgroundAssetResult, String> {
    run_agent_center_resource_blocking("agent_center_background_get", move || {
        standard_agent_center_background_asset_get_blocking(&roots, payload)
    })
    .await
    .and_then(|mut result| {
        if result.file_url.is_empty() {
            return Ok(result);
        }
        let path = PathBuf::from(result.file_url.trim_start_matches("file://"));
        app.state::<tauri::scope::Scopes>()
            .allow_file(&path)
            .map_err(|error| {
                crate::capabilities::standard_shell_error(
                    "host-internal-error",
                    "tauri-agent-center-background-scope-allow-file-failed",
                    "inspect_tauri_asset_protocol_scope",
                    "tauri",
                    Some(serde_json::json!({
                        "command": "agent_center_background_get",
                        "cause": error.to_string(),
                    })),
                )
            })?;
        result.file_url = crate::standard_local_assets::tauri_asset_url_for_file_path(&path);
        Ok(result)
    })
}

pub async fn background_remove(
    roots: crate::runtime_app_storage::StandardAppStorageRoots,
    payload: StandardAgentCenterBackgroundRemovePayload,
) -> Result<StandardAgentCenterLocalResourceRemoveResult, String> {
    run_agent_center_resource_blocking("agent_center_background_remove", move || {
        standard_agent_center_background_remove_blocking(&roots, payload)
    })
    .await
}

pub async fn agent_resources_remove(
    roots: crate::runtime_app_storage::StandardAppStorageRoots,
    payload: StandardAgentCenterAgentLocalResourcesRemovePayload,
) -> Result<StandardAgentCenterLocalResourceRemoveResult, String> {
    run_agent_center_resource_blocking("agent_center_agent_resources_remove", move || {
        standard_agent_center_agent_local_resources_remove_blocking(&roots, payload)
    })
    .await
}

pub async fn account_resources_remove(
    roots: crate::runtime_app_storage::StandardAppStorageRoots,
    payload: StandardAgentCenterAccountLocalResourcesRemovePayload,
) -> Result<StandardAgentCenterLocalResourceRemoveResult, String> {
    run_agent_center_resource_blocking("agent_center_account_resources_remove", move || {
        standard_agent_center_account_local_resources_remove_blocking(&roots, payload)
    })
    .await
}

fn avatar_validation_status_for_shell(
    status: StandardAgentCenterAvatarAssetValidationStatus,
) -> &'static str {
    match status {
        StandardAgentCenterAvatarAssetValidationStatus::Valid => "valid",
        _ => "invalid",
    }
}

fn background_validation_status_for_shell(
    status: StandardAgentCenterBackgroundValidationStatus,
) -> &'static str {
    match status {
        StandardAgentCenterBackgroundValidationStatus::Valid => "valid",
        _ => "invalid",
    }
}

fn validation_message(
    errors: &[StandardAgentCenterValidationIssue],
    warnings: &[StandardAgentCenterValidationIssue],
) -> Option<String> {
    errors
        .first()
        .or_else(|| warnings.first())
        .map(|issue| issue.message.clone())
}

fn validation_issue_rows(
    errors: &[StandardAgentCenterValidationIssue],
    warnings: &[StandardAgentCenterValidationIssue],
) -> Vec<String> {
    errors
        .iter()
        .chain(warnings.iter())
        .map(|issue| {
            if issue.code.trim().is_empty() {
                issue.message.clone()
            } else {
                format!("{}: {}", issue.code, issue.message)
            }
        })
        .collect()
}

pub fn shell_avatar_asset_import_result(
    result: StandardAgentCenterAvatarAssetImportResult,
) -> serde_json::Value {
    serde_json::json!({
        "avatarAssetRef": result.local_asset_id,
        "backendKind": avatar_backend_kind_label(result.backend_kind),
        "validationStatus": avatar_validation_status_for_shell(result.validation.status),
        "validationMessage": validation_message(&result.validation.errors, &result.validation.warnings),
        "backendCapabilityProfileRef": result.backend_capability_profile_ref,
    })
}

pub fn shell_avatar_asset_validate_result(
    result: StandardAgentCenterAvatarAssetValidationResult,
) -> serde_json::Value {
    let avatar_asset_ref = result.local_asset_id;
    let backend_kind = avatar_backend_kind_for_asset_ref(&avatar_asset_ref)
        .unwrap_or(StandardAgentCenterAvatarBackendKind::Future);
    serde_json::json!({
        "avatarAssetRef": avatar_asset_ref.clone(),
        "backendKind": avatar_backend_kind_label(backend_kind),
        "validationStatus": avatar_validation_status_for_shell(result.status),
        "validationMessage": validation_message(&result.errors, &result.warnings),
        "backendCapabilityProfileRef": backend_capability_profile_ref_for(
            avatar_backend_kind_label(backend_kind),
            &avatar_asset_ref,
        ),
        "validationIssueRows": validation_issue_rows(&result.errors, &result.warnings),
    })
}

pub fn shell_avatar_preview_result(
    avatar_asset_ref: String,
    backend_kind: StandardAgentCenterAvatarBackendKind,
    validation: StandardAgentCenterAvatarAssetValidationResult,
) -> serde_json::Value {
    serde_json::json!({
        "avatarAssetRef": avatar_asset_ref,
        "backendKind": avatar_backend_kind_label(backend_kind),
        "previewArtifactRef": format!(
            "agent-center-preview:{}:{}",
            avatar_backend_kind_label(backend_kind),
            validation.local_asset_id,
        ),
        "validationStatus": avatar_validation_status_for_shell(validation.status),
        "validationMessage": validation_message(&validation.errors, &validation.warnings),
        "warnings": validation.warnings.iter().map(|issue| issue.message.clone()).collect::<Vec<_>>(),
    })
}

pub fn shell_live2d_adapter_import_result(
    result: StandardAgentCenterLive2dAdapterManifestImportResult,
) -> serde_json::Value {
    serde_json::json!({
        "avatarAssetRef": result.local_asset_id,
        "live2dAdapterManifestRef": result.manifest_ref,
        "live2dAdapterManifestSource": "external_sidecar_manifest",
    })
}

pub fn shell_background_import_result(
    result: StandardAgentCenterBackgroundImportResult,
) -> serde_json::Value {
    serde_json::json!({
        "backgroundAssetRef": result.background_asset_id,
        "validationStatus": background_validation_status_for_shell(result.validation.status),
        "validationMessage": validation_message(&result.validation.errors, &result.validation.warnings),
    })
}

pub fn shell_background_get_result(
    result: StandardAgentCenterBackgroundAssetResult,
) -> serde_json::Value {
    serde_json::json!({
        "backgroundAssetRef": result.background_asset_id,
        "url": result.file_url,
        "validationStatus": background_validation_status_for_shell(result.validation.status),
        "validationMessage": validation_message(&result.validation.errors, &result.validation.warnings),
    })
}

pub fn shell_background_validate_result(
    result: StandardAgentCenterBackgroundValidationResult,
) -> serde_json::Value {
    serde_json::json!({
        "backgroundAssetRef": result.background_asset_id,
        "validationStatus": background_validation_status_for_shell(result.status),
        "validationMessage": validation_message(&result.errors, &result.warnings),
    })
}

pub fn shell_resource_removal_result(
    result: StandardAgentCenterLocalResourceRemoveResult,
) -> serde_json::Value {
    let mut payload = serde_json::json!({
        "removed": result.quarantined,
    });
    if let Some(record) = payload.as_object_mut() {
        match result.resource_kind.as_str() {
            "background" => {
                record.insert(
                    "backgroundAssetRef".to_string(),
                    serde_json::Value::String(result.resource_id),
                );
            }
            "avatar_asset" => {
                record.insert(
                    "avatarAssetRef".to_string(),
                    serde_json::Value::String(result.resource_id),
                );
            }
            "live2d_adapter_manifest" => {
                record.insert(
                    "live2dAdapterManifestRef".to_string(),
                    serde_json::Value::String(result.resource_id),
                );
            }
            _ => {}
        }
    }
    payload
}

#[cfg(test)]
mod shell_contract_tests {
    use super::*;

    #[test]
    fn avatar_import_payload_accepts_renderer_shell_contract_fields() {
        let payload = serde_json::json!({
            "hostScope": "local-agent",
            "accountId": "account-1",
            "ownerUserId": "owner-1",
            "runtimeSourceRef": "runtime-source:local",
            "localAgentRef": "local-agent:ren",
            "backendKind": "live2d",
            "sourcePath": "fixtures/picked-live2d"
        });

        assert!(
            serde_json::from_value::<StandardAgentCenterAvatarAssetImportPayload>(payload).is_ok()
        );
    }

    #[test]
    fn avatar_validation_projection_returns_renderer_shell_contract_fields() {
        let projected =
            shell_avatar_asset_validate_result(StandardAgentCenterAvatarAssetValidationResult {
                schema_version: 1,
                local_asset_id: "live2d_111111111111".to_string(),
                checked_at: "2026-01-01T00:00:00Z".to_string(),
                status: StandardAgentCenterAvatarAssetValidationStatus::Valid,
                errors: vec![],
                warnings: vec![],
            });

        assert_eq!(projected["avatarAssetRef"], "live2d_111111111111");
        assert_eq!(projected["backendKind"], "live2d");
        assert_eq!(projected["validationStatus"], "valid");
        assert!(projected.get("localAssetId").is_none());
        assert!(projected.get("validation").is_none());
    }
}
