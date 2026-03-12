use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::AppHandle;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeAuditRecordPayload {
    pub id: String,
    pub mod_id: Option<String>,
    pub stage: Option<String>,
    pub event_type: String,
    pub decision: Option<String>,
    pub reason_codes: Option<Vec<String>>,
    pub payload: Option<serde_json::Value>,
    pub occurred_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeAuditFilter {
    pub mod_id: Option<String>,
    pub stage: Option<String>,
    pub event_type: Option<String>,
    pub from: Option<String>,
    pub to: Option<String>,
    pub limit: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeActionIdempotencyRecordPayload {
    pub principal_id: String,
    pub action_id: String,
    pub idempotency_key: String,
    pub input_digest: String,
    pub response: serde_json::Value,
    pub occurred_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeActionVerifyTicketPayload {
    pub ticket_id: String,
    pub principal_id: String,
    pub action_id: String,
    pub trace_id: String,
    pub input_digest: String,
    pub issued_at: String,
    pub expires_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeActionExecutionLedgerRecordPayload {
    pub execution_id: String,
    pub action_id: String,
    pub principal_id: String,
    pub phase: String,
    pub status: String,
    pub trace_id: String,
    pub reason_code: Option<String>,
    pub payload: Option<serde_json::Value>,
    pub occurred_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeActionExecutionLedgerFilter {
    pub action_id: Option<String>,
    pub principal_id: Option<String>,
    pub phase: Option<String>,
    pub status: Option<String>,
    pub trace_id: Option<String>,
    pub from: Option<String>,
    pub to: Option<String>,
    pub limit: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeExternalAgentActionScope {
    pub action_id: String,
    pub ops: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalAgentTokenRecordPayload {
    pub token_id: String,
    pub principal_id: String,
    pub mode: String,
    pub subject_account_id: String,
    pub actions: Vec<String>,
    pub scopes: Vec<RuntimeExternalAgentActionScope>,
    pub issuer: String,
    pub issued_at: String,
    pub expires_at: String,
    pub revoked_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeLocalManifestSummary {
    pub path: String,
    pub id: String,
    pub source_id: Option<String>,
    pub source_type: Option<String>,
    pub source_dir: Option<String>,
    pub name: Option<String>,
    pub version: Option<String>,
    pub entry: Option<String>,
    pub entry_path: Option<String>,
    pub icon_asset: Option<String>,
    pub icon_asset_path: Option<String>,
    pub styles: Option<Vec<String>>,
    pub style_paths: Option<Vec<String>>,
    pub description: Option<String>,
    pub manifest: Option<serde_json::Value>,
    pub release_manifest: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeLocalAssetPayload {
    pub mime_type: String,
    pub base64: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeModInstallResultPayload {
    pub install_session_id: String,
    pub operation: String,
    pub mod_id: String,
    pub installed_path: String,
    pub manifest: RuntimeLocalManifestSummary,
    pub rollback_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeModInstallProgressPayload {
    pub install_session_id: String,
    pub operation: String,
    pub source_kind: String,
    pub phase: String,
    pub status: String,
    pub occurred_at: String,
    pub mod_id: Option<String>,
    pub manifest_path: Option<String>,
    pub installed_path: Option<String>,
    pub progress_percent: Option<f64>,
    pub message: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeModSourceRecord {
    pub source_id: String,
    pub source_type: String,
    pub source_dir: String,
    pub enabled: bool,
    pub is_default: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogPublisherPayload {
    pub publisher_id: String,
    pub display_name: String,
    pub trust_tier: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogStatePayload {
    pub listed: bool,
    pub yanked: bool,
    pub quarantined: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogSignerPayload {
    pub signer_id: String,
    pub algorithm: String,
    pub public_key: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogPackageSummaryPayload {
    pub package_id: String,
    pub package_type: String,
    pub name: String,
    pub description: String,
    pub latest_version: Option<String>,
    pub latest_channel: Option<String>,
    pub publisher: CatalogPublisherPayload,
    pub state: CatalogStatePayload,
    pub keywords: Vec<String>,
    pub tags: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogReleaseSourcePayload {
    pub repo_url: String,
    pub release_tag: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogReleaseRecordPayload {
    pub package_type: String,
    pub package_id: String,
    pub version: String,
    pub channel: String,
    pub artifact_url: String,
    pub sha256: String,
    pub signature: String,
    pub signer_id: String,
    pub min_desktop_version: String,
    pub min_hook_api_version: String,
    pub capabilities: Vec<String>,
    pub requires_reconsent_on_capability_increase: bool,
    pub publisher: CatalogPublisherPayload,
    pub source: CatalogReleaseSourcePayload,
    pub state: CatalogStatePayload,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub app_mode: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scope_catalog_version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub min_runtime_version: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogPackageRecordPayload {
    pub package_id: String,
    pub package_type: String,
    pub name: String,
    pub description: String,
    pub publisher: CatalogPublisherPayload,
    pub state: CatalogStatePayload,
    pub channels: std::collections::HashMap<String, String>,
    pub keywords: Vec<String>,
    pub tags: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon_url: Option<String>,
    pub signers: Vec<CatalogSignerPayload>,
    pub releases: Vec<CatalogReleaseRecordPayload>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogRevocationRecordPayload {
    pub scope: String,
    pub target_id: String,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogRevocationsPayload {
    pub items: Vec<CatalogRevocationRecordPayload>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogAdvisoryRecordPayload {
    pub advisory_id: String,
    pub package_id: String,
    pub version: Option<String>,
    pub action: String,
    pub severity: String,
    pub title: String,
    pub summary: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogAdvisoriesPayload {
    pub items: Vec<CatalogAdvisoryRecordPayload>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledModPolicyPayload {
    pub channel: String,
    pub auto_update: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AvailableModUpdatePayload {
    pub package_id: String,
    pub installed_version: String,
    pub target_version: String,
    pub policy: InstalledModPolicyPayload,
    pub trust_tier: String,
    pub requires_user_consent: bool,
    pub consent_reasons: Vec<String>,
    pub added_capabilities: Vec<String>,
    pub advisory_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogInstallResultPayload {
    pub install: RuntimeModInstallResultPayload,
    pub package: CatalogPackageRecordPayload,
    pub release: CatalogReleaseRecordPayload,
    pub policy: InstalledModPolicyPayload,
    pub requires_user_consent: bool,
    pub consent_reasons: Vec<String>,
    pub added_capabilities: Vec<String>,
    pub advisory_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeModDeveloperModeState {
    pub enabled: bool,
    pub auto_reload_enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeModDiagnosticRecord {
    pub mod_id: String,
    pub status: String,
    pub source_id: String,
    pub source_type: String,
    pub source_dir: String,
    pub manifest_path: Option<String>,
    pub entry_path: Option<String>,
    pub error: Option<String>,
    pub conflict_paths: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeModSourceChangeEventPayload {
    pub source_id: String,
    pub source_type: String,
    pub source_dir: String,
    pub occurred_at: String,
    pub paths: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeModReloadResultPayload {
    pub mod_id: String,
    pub source_id: String,
    pub status: String,
    pub occurred_at: String,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeMediaCachePutResultPayload {
    pub cache_key: String,
    pub file_path: String,
    pub uri: String,
    pub mime_type: String,
    pub size_bytes: u64,
    pub existed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeMediaCacheGcResultPayload {
    pub scanned_count: usize,
    pub removed_count: usize,
    pub removed_bytes: u64,
    pub retained_count: usize,
}

include!("path_env.rs");
include!("manifest_scan.rs");
include!("source_registry.rs");
include!("catalog_registry.rs");
#[cfg(test)]
include!("catalog_registry_tests.rs");
include!("entry_io.rs");
include!("install_store.rs");
include!("schema.rs");
include!("audit_ledger.rs");
include!("idempotency_verify.rs");
include!("tokens_kv.rs");
include!("media_cache.rs");
