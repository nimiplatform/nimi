use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use std::fs;
use std::path::{Component, Path, PathBuf};
use tauri::AppHandle;
use tauri::Manager;

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
    pub styles: Option<Vec<String>>,
    pub style_paths: Option<Vec<String>>,
    pub description: Option<String>,
    pub manifest: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeModInstallResultPayload {
    pub install_session_id: String,
    pub operation: String,
    pub mod_id: String,
    pub installed_path: String,
    pub manifest: RuntimeLocalManifestSummary,
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
include!("entry_io.rs");
include!("install_store.rs");
include!("schema.rs");
include!("audit_ledger.rs");
include!("idempotency_verify.rs");
include!("tokens_kv.rs");
include!("media_cache.rs");
