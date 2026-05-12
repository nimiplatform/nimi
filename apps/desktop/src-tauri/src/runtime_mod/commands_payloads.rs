use serde::Deserialize;

use super::store::{RuntimeActionExecutionLedgerFilter, RuntimeAuditFilter};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeAuditAppendPayload {
    pub record: super::store::RuntimeAuditRecordPayload,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeAuditQueryPayload {
    pub filter: Option<RuntimeAuditFilter>,
}

#[allow(dead_code)]
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeAuditDeletePayload {
    pub filter: Option<RuntimeAuditFilter>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeModReadEntryPayload {
    pub path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeModReadAssetPayload {
    pub path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeModInstallPayload {
    pub source: String,
    pub source_kind: Option<String>,
    pub replace_existing: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeModUpdatePayload {
    pub mod_id: String,
    pub source: String,
    pub source_kind: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeModUninstallPayload {
    pub mod_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeModReadManifestPayload {
    pub mod_id: Option<String>,
    pub path: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeModCatalogGetPayload {
    pub package_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeModCatalogInstallPayload {
    pub package_id: String,
    pub channel: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeModRestoreBackupPayload {
    pub mod_id: String,
    pub backup_path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeModInstallProgressQueryPayload {
    pub install_session_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeModSourceUpsertPayload {
    pub source_id: Option<String>,
    pub source_type: String,
    pub source_dir: String,
    pub enabled: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeModSourceRemovePayload {
    pub source_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeModDeveloperModeSetPayload {
    pub enabled: bool,
    pub auto_reload_enabled: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeModDataDirSetPayload {
    pub nimi_data_dir: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeModReloadPayload {
    pub mod_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeModOpenDirPayload {
    pub path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeActionIdempotencyGetPayload {
    pub principal_id: String,
    pub action_id: String,
    pub idempotency_key: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeActionIdempotencyPutPayload {
    pub principal_id: String,
    pub action_id: String,
    pub idempotency_key: String,
    pub input_digest: String,
    pub response: serde_json::Value,
    pub occurred_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeActionIdempotencyPurgePayload {
    pub before: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeActionVerifyTicketGetPayload {
    pub ticket_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeActionVerifyTicketPutPayload {
    pub ticket_id: String,
    pub principal_id: String,
    pub action_id: String,
    pub trace_id: String,
    pub input_digest: String,
    pub issued_at: String,
    pub expires_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeActionVerifyTicketDeletePayload {
    pub ticket_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeActionVerifyTicketPurgePayload {
    pub before: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeActionExecutionLedgerPutPayload {
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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeActionExecutionLedgerQueryPayload {
    pub filter: Option<RuntimeActionExecutionLedgerFilter>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeActionExecutionLedgerPurgePayload {
    pub before: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeMediaCachePutPayload {
    pub media_base64: String,
    pub mime_type: Option<String>,
    pub extension_hint: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeMediaCacheGcPayload {
    pub max_age_seconds: Option<u64>,
}
