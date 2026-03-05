use rusqlite::params;
use serde::Deserialize;
use tauri::AppHandle;

use super::store::{
    append_runtime_audit, delete_action_verify_ticket, get_action_idempotency_record,
    get_action_verify_ticket, gc_media_cache, list_local_mod_manifests, open_db, put_media_cache,
    purge_action_execution_ledger, purge_action_idempotency_records, purge_action_verify_tickets,
    put_action_execution_ledger_record, put_action_idempotency_record, put_action_verify_ticket,
    query_action_execution_ledger, query_runtime_audit, read_local_mod_entry,
    RuntimeActionExecutionLedgerFilter, RuntimeActionExecutionLedgerRecordPayload,
    RuntimeActionIdempotencyRecordPayload, RuntimeActionVerifyTicketPayload, RuntimeAuditFilter,
    RuntimeAuditRecordPayload, RuntimeLocalManifestSummary, RuntimeMediaCacheGcResultPayload,
    RuntimeMediaCachePutResultPayload,
};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeAuditAppendPayload {
    pub record: RuntimeAuditRecordPayload,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeAuditQueryPayload {
    pub filter: Option<RuntimeAuditFilter>,
}

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

#[tauri::command]
pub fn runtime_mod_append_audit(
    app: AppHandle,
    payload: RuntimeAuditAppendPayload,
) -> Result<(), String> {
    let conn = open_db(&app)?;
    append_runtime_audit(&conn, &payload.record)
}

#[tauri::command]
pub fn runtime_mod_query_audit(
    app: AppHandle,
    payload: Option<RuntimeAuditQueryPayload>,
) -> Result<Vec<RuntimeAuditRecordPayload>, String> {
    let conn = open_db(&app)?;
    let filter = payload.and_then(|item| item.filter);
    query_runtime_audit(&conn, filter)
}

#[tauri::command]
pub fn runtime_mod_delete_audit(
    app: AppHandle,
    payload: Option<RuntimeAuditDeletePayload>,
) -> Result<usize, String> {
    let conn = open_db(&app)?;
    let filter = payload
        .and_then(|item| item.filter)
        .unwrap_or(RuntimeAuditFilter {
            mod_id: None,
            stage: None,
            event_type: None,
            from: None,
            to: None,
            limit: None,
        });

    if let Some(limit) = filter.limit {
        let normalized_limit = (limit.max(1).min(1000)) as i64;
        return conn
            .execute(
                r#"
                DELETE FROM runtime_audit_records
                WHERE id IN (
                  SELECT id
                  FROM runtime_audit_records
                  WHERE (?1 IS NULL OR mod_id = ?1)
                    AND (?2 IS NULL OR stage = ?2)
                    AND (?3 IS NULL OR event_type = ?3)
                    AND (?4 IS NULL OR occurred_at >= ?4)
                    AND (?5 IS NULL OR occurred_at <= ?5)
                  ORDER BY occurred_at DESC
                  LIMIT ?6
                )
                "#,
                params![
                    filter.mod_id,
                    filter.stage,
                    filter.event_type,
                    filter.from,
                    filter.to,
                    normalized_limit
                ],
            )
            .map_err(|error| format!("删除 runtime audit 失败: {error}"));
    }

    conn.execute(
        r#"
        DELETE FROM runtime_audit_records
        WHERE (?1 IS NULL OR mod_id = ?1)
          AND (?2 IS NULL OR stage = ?2)
          AND (?3 IS NULL OR event_type = ?3)
          AND (?4 IS NULL OR occurred_at >= ?4)
          AND (?5 IS NULL OR occurred_at <= ?5)
        "#,
        params![
            filter.mod_id,
            filter.stage,
            filter.event_type,
            filter.from,
            filter.to
        ],
    )
    .map_err(|error| format!("删除 runtime audit 失败: {error}"))
}

#[tauri::command]
pub fn runtime_mod_list_local_manifests(
    app: AppHandle,
) -> Result<Vec<RuntimeLocalManifestSummary>, String> {
    list_local_mod_manifests(&app)
}

#[tauri::command]
pub fn runtime_mod_read_local_entry(
    app: AppHandle,
    payload: RuntimeModReadEntryPayload,
) -> Result<String, String> {
    read_local_mod_entry(&app, &payload.path)
}

#[tauri::command]
pub fn runtime_mod_get_action_idempotency(
    app: AppHandle,
    payload: RuntimeActionIdempotencyGetPayload,
) -> Result<Option<RuntimeActionIdempotencyRecordPayload>, String> {
    let conn = open_db(&app)?;
    get_action_idempotency_record(
        &conn,
        &payload.principal_id,
        &payload.action_id,
        &payload.idempotency_key,
    )
}

#[tauri::command]
pub fn runtime_mod_put_action_idempotency(
    app: AppHandle,
    payload: RuntimeActionIdempotencyPutPayload,
) -> Result<(), String> {
    let conn = open_db(&app)?;
    put_action_idempotency_record(
        &conn,
        &RuntimeActionIdempotencyRecordPayload {
            principal_id: payload.principal_id,
            action_id: payload.action_id,
            idempotency_key: payload.idempotency_key,
            input_digest: payload.input_digest,
            response: payload.response,
            occurred_at: payload.occurred_at,
        },
    )
}

#[tauri::command]
pub fn runtime_mod_purge_action_idempotency(
    app: AppHandle,
    payload: RuntimeActionIdempotencyPurgePayload,
) -> Result<usize, String> {
    let conn = open_db(&app)?;
    purge_action_idempotency_records(&conn, &payload.before)
}

#[tauri::command]
pub fn runtime_mod_get_action_verify_ticket(
    app: AppHandle,
    payload: RuntimeActionVerifyTicketGetPayload,
) -> Result<Option<RuntimeActionVerifyTicketPayload>, String> {
    let conn = open_db(&app)?;
    get_action_verify_ticket(&conn, &payload.ticket_id)
}

#[tauri::command]
pub fn runtime_mod_put_action_verify_ticket(
    app: AppHandle,
    payload: RuntimeActionVerifyTicketPutPayload,
) -> Result<(), String> {
    let conn = open_db(&app)?;
    put_action_verify_ticket(
        &conn,
        &RuntimeActionVerifyTicketPayload {
            ticket_id: payload.ticket_id,
            principal_id: payload.principal_id,
            action_id: payload.action_id,
            trace_id: payload.trace_id,
            input_digest: payload.input_digest,
            issued_at: payload.issued_at,
            expires_at: payload.expires_at,
        },
    )
}

#[tauri::command]
pub fn runtime_mod_delete_action_verify_ticket(
    app: AppHandle,
    payload: RuntimeActionVerifyTicketDeletePayload,
) -> Result<usize, String> {
    let conn = open_db(&app)?;
    delete_action_verify_ticket(&conn, &payload.ticket_id)
}

#[tauri::command]
pub fn runtime_mod_purge_action_verify_tickets(
    app: AppHandle,
    payload: RuntimeActionVerifyTicketPurgePayload,
) -> Result<usize, String> {
    let conn = open_db(&app)?;
    purge_action_verify_tickets(&conn, &payload.before)
}

#[tauri::command]
pub fn runtime_mod_put_action_execution_ledger(
    app: AppHandle,
    payload: RuntimeActionExecutionLedgerPutPayload,
) -> Result<(), String> {
    let conn = open_db(&app)?;
    put_action_execution_ledger_record(
        &conn,
        &RuntimeActionExecutionLedgerRecordPayload {
            execution_id: payload.execution_id,
            action_id: payload.action_id,
            principal_id: payload.principal_id,
            phase: payload.phase,
            status: payload.status,
            trace_id: payload.trace_id,
            reason_code: payload.reason_code,
            payload: payload.payload,
            occurred_at: payload.occurred_at,
        },
    )
}

#[tauri::command]
pub fn runtime_mod_query_action_execution_ledger(
    app: AppHandle,
    payload: Option<RuntimeActionExecutionLedgerQueryPayload>,
) -> Result<Vec<RuntimeActionExecutionLedgerRecordPayload>, String> {
    let conn = open_db(&app)?;
    let filter = payload.and_then(|item| item.filter);
    query_action_execution_ledger(&conn, filter)
}

#[tauri::command]
pub fn runtime_mod_purge_action_execution_ledger(
    app: AppHandle,
    payload: RuntimeActionExecutionLedgerPurgePayload,
) -> Result<usize, String> {
    let conn = open_db(&app)?;
    purge_action_execution_ledger(&conn, &payload.before)
}

#[tauri::command]
pub fn runtime_mod_media_cache_put(
    _app: AppHandle,
    payload: RuntimeMediaCachePutPayload,
) -> Result<RuntimeMediaCachePutResultPayload, String> {
    put_media_cache(
        &payload.media_base64,
        payload.mime_type.as_deref(),
        payload.extension_hint.as_deref(),
    )
}

#[tauri::command]
pub fn runtime_mod_media_cache_gc(
    _app: AppHandle,
    payload: Option<RuntimeMediaCacheGcPayload>,
) -> Result<RuntimeMediaCacheGcResultPayload, String> {
    gc_media_cache(payload.and_then(|value| value.max_age_seconds))
}
