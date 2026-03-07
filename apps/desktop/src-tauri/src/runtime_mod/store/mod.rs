use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use std::cmp::Ordering;
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
    pub name: Option<String>,
    pub version: Option<String>,
    pub entry: Option<String>,
    pub entry_path: Option<String>,
    pub description: Option<String>,
    pub manifest: Option<serde_json::Value>,
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

const DEFAULT_MOD_MARKER_FILE: &str = ".nimi-default-managed.json";

include!("path_env.rs");
include!("manifest_scan.rs");
include!("entry_io.rs");
include!("schema.rs");
include!("audit_ledger.rs");
include!("idempotency_verify.rs");
include!("tokens_kv.rs");
include!("media_cache.rs");
