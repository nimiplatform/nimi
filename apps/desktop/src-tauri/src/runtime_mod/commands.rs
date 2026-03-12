use crate::desktop_paths::{
    describe_desktop_storage_dirs, set_nimi_data_dir, DesktopStorageDirsPayload,
};
use rusqlite::params;
use serde::Deserialize;
use tauri::AppHandle;

use super::store::{
    append_runtime_audit, check_catalog_mod_updates, delete_action_verify_ticket, gc_media_cache,
    get_action_idempotency_record, get_action_verify_ticket, get_catalog_mod,
    get_runtime_mod_developer_mode_state, install_catalog_mod, install_runtime_mod,
    list_catalog_mods, list_installed_runtime_mods, list_local_mod_manifests,
    list_runtime_mod_diagnostics, list_runtime_mod_install_progress, list_runtime_mod_sources,
    open_db, open_runtime_mod_dir, purge_action_execution_ledger, purge_action_idempotency_records,
    purge_action_verify_tickets, put_action_execution_ledger_record, put_action_idempotency_record,
    put_action_verify_ticket, put_media_cache, query_action_execution_ledger, query_runtime_audit,
    read_installed_runtime_mod_manifest, read_local_mod_entry, reload_all_runtime_mods,
    read_local_mod_asset, reload_runtime_mod, remove_runtime_mod_source, restore_runtime_mod_backup,
    set_runtime_mod_developer_mode_state, sync_runtime_mod_source_watchers, uninstall_runtime_mod,
    update_installed_catalog_mod, update_runtime_mod, upsert_runtime_mod_source,
    AvailableModUpdatePayload, CatalogInstallResultPayload, CatalogPackageRecordPayload,
    CatalogPackageSummaryPayload, RuntimeActionExecutionLedgerFilter,
    RuntimeActionExecutionLedgerRecordPayload, RuntimeActionIdempotencyRecordPayload,
    RuntimeActionVerifyTicketPayload, RuntimeAuditFilter, RuntimeAuditRecordPayload,
    RuntimeLocalAssetPayload, RuntimeLocalManifestSummary, RuntimeMediaCacheGcResultPayload,
    RuntimeMediaCachePutResultPayload, RuntimeModDeveloperModeState, RuntimeModDiagnosticRecord,
    RuntimeModInstallProgressPayload, RuntimeModInstallResultPayload,
    RuntimeModReloadResultPayload, RuntimeModSourceRecord,
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
pub fn runtime_mod_read_local_asset(
    app: AppHandle,
    payload: RuntimeModReadAssetPayload,
) -> Result<RuntimeLocalAssetPayload, String> {
    read_local_mod_asset(&app, &payload.path)
}

#[tauri::command]
pub fn runtime_mod_list_installed(
    app: AppHandle,
) -> Result<Vec<RuntimeLocalManifestSummary>, String> {
    list_installed_runtime_mods(&app)
}

#[tauri::command]
pub fn runtime_mod_sources_list(app: AppHandle) -> Result<Vec<RuntimeModSourceRecord>, String> {
    list_runtime_mod_sources(&app)
}

#[tauri::command]
pub fn runtime_mod_sources_upsert(
    app: AppHandle,
    payload: RuntimeModSourceUpsertPayload,
) -> Result<RuntimeModSourceRecord, String> {
    let record = upsert_runtime_mod_source(
        &app,
        payload.source_id.as_deref(),
        &payload.source_type,
        &payload.source_dir,
        payload.enabled.unwrap_or(true),
    )?;
    sync_runtime_mod_source_watchers(&app)?;
    Ok(record)
}

#[tauri::command]
pub fn runtime_mod_sources_remove(
    app: AppHandle,
    payload: RuntimeModSourceRemovePayload,
) -> Result<bool, String> {
    let removed = remove_runtime_mod_source(&app, &payload.source_id)?;
    sync_runtime_mod_source_watchers(&app)?;
    Ok(removed)
}

#[tauri::command]
pub fn runtime_mod_dev_mode_get(app: AppHandle) -> Result<RuntimeModDeveloperModeState, String> {
    get_runtime_mod_developer_mode_state(&app)
}

#[tauri::command]
pub fn runtime_mod_dev_mode_set(
    app: AppHandle,
    payload: RuntimeModDeveloperModeSetPayload,
) -> Result<RuntimeModDeveloperModeState, String> {
    let state =
        set_runtime_mod_developer_mode_state(&app, payload.enabled, payload.auto_reload_enabled)?;
    sync_runtime_mod_source_watchers(&app)?;
    Ok(state)
}

#[tauri::command]
pub fn runtime_mod_storage_dirs_get() -> Result<DesktopStorageDirsPayload, String> {
    describe_desktop_storage_dirs()
}

#[tauri::command]
pub fn runtime_mod_data_dir_set(
    app: AppHandle,
    payload: RuntimeModDataDirSetPayload,
) -> Result<DesktopStorageDirsPayload, String> {
    let directories = set_nimi_data_dir(payload.nimi_data_dir.as_str())?;
    sync_runtime_mod_source_watchers(&app)?;
    Ok(directories)
}

#[tauri::command]
pub fn runtime_mod_diagnostics_list(
    app: AppHandle,
) -> Result<Vec<RuntimeModDiagnosticRecord>, String> {
    list_runtime_mod_diagnostics(&app)
}

#[tauri::command]
pub fn runtime_mod_reload(
    app: AppHandle,
    payload: RuntimeModReloadPayload,
) -> Result<Vec<RuntimeModReloadResultPayload>, String> {
    reload_runtime_mod(&app, &payload.mod_id)
}

#[tauri::command]
pub fn runtime_mod_reload_all(
    app: AppHandle,
) -> Result<Vec<RuntimeModReloadResultPayload>, String> {
    reload_all_runtime_mods(&app)
}

#[tauri::command]
pub fn runtime_mod_open_dir(
    app: AppHandle,
    payload: RuntimeModOpenDirPayload,
) -> Result<(), String> {
    open_runtime_mod_dir(&app, &payload.path)
}

#[tauri::command]
pub fn runtime_mod_install(
    app: AppHandle,
    payload: RuntimeModInstallPayload,
) -> Result<RuntimeModInstallResultPayload, String> {
    install_runtime_mod(
        &app,
        &payload.source,
        payload.source_kind.as_deref(),
        payload.replace_existing.unwrap_or(false),
    )
}

#[tauri::command]
pub fn runtime_mod_update(
    app: AppHandle,
    payload: RuntimeModUpdatePayload,
) -> Result<RuntimeModInstallResultPayload, String> {
    update_runtime_mod(
        &app,
        &payload.mod_id,
        &payload.source,
        payload.source_kind.as_deref(),
    )
}

#[tauri::command]
pub fn runtime_mod_uninstall(
    app: AppHandle,
    payload: RuntimeModUninstallPayload,
) -> Result<RuntimeLocalManifestSummary, String> {
    uninstall_runtime_mod(&app, &payload.mod_id)
}

#[tauri::command]
pub fn runtime_mod_read_manifest(
    app: AppHandle,
    payload: RuntimeModReadManifestPayload,
) -> Result<RuntimeLocalManifestSummary, String> {
    read_installed_runtime_mod_manifest(&app, payload.mod_id.as_deref(), payload.path.as_deref())
}

#[tauri::command]
pub fn runtime_mod_catalog_list() -> Result<Vec<CatalogPackageSummaryPayload>, String> {
    list_catalog_mods()
}

#[tauri::command]
pub fn runtime_mod_catalog_get(
    payload: RuntimeModCatalogGetPayload,
) -> Result<Option<CatalogPackageRecordPayload>, String> {
    get_catalog_mod(&payload.package_id)
}

#[tauri::command]
pub fn runtime_mod_catalog_updates_check(
    app: AppHandle,
) -> Result<Vec<AvailableModUpdatePayload>, String> {
    check_catalog_mod_updates(&app)
}

#[tauri::command]
pub fn runtime_mod_catalog_install(
    app: AppHandle,
    payload: RuntimeModCatalogInstallPayload,
) -> Result<CatalogInstallResultPayload, String> {
    install_catalog_mod(&app, &payload.package_id, payload.channel.as_deref())
}

#[tauri::command]
pub fn runtime_mod_catalog_update(
    app: AppHandle,
    payload: RuntimeModCatalogInstallPayload,
) -> Result<CatalogInstallResultPayload, String> {
    update_installed_catalog_mod(&app, &payload.package_id, payload.channel.as_deref())
}

#[tauri::command]
pub fn runtime_mod_install_progress(
    _app: AppHandle,
    payload: Option<RuntimeModInstallProgressQueryPayload>,
) -> Result<Vec<RuntimeModInstallProgressPayload>, String> {
    list_runtime_mod_install_progress(
        payload
            .as_ref()
            .and_then(|item| item.install_session_id.as_deref()),
    )
}

#[tauri::command]
pub fn runtime_mod_restore_backup(
    app: AppHandle,
    payload: RuntimeModRestoreBackupPayload,
) -> Result<RuntimeLocalManifestSummary, String> {
    restore_runtime_mod_backup(&app, &payload.mod_id, &payload.backup_path)
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
