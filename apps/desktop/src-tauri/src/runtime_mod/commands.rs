use crate::desktop_paths::{describe_desktop_storage_dirs, DesktopStorageDirsPayload};
use tauri::AppHandle;

use super::commands_payloads::*;
use super::commands_progress::{
    accepted_runtime_mod_install, emit_runtime_mod_failed, emit_runtime_mod_queued, now_rfc3339,
};
use super::store::{
    append_runtime_audit, check_catalog_mod_updates, create_runtime_mod_install_session_id,
    delete_action_verify_ticket, emit_runtime_mod_install_progress, gc_media_cache,
    get_action_idempotency_record, get_action_verify_ticket, get_catalog_mod,
    get_runtime_mod_developer_mode_state, install_catalog_mod_with_session,
    install_runtime_mod_common_with_session, list_catalog_mods, list_installed_runtime_mods,
    list_local_mod_manifests, list_runtime_mod_diagnostics, list_runtime_mod_install_progress,
    list_runtime_mod_sources, mod_storage_file_delete, mod_storage_file_list,
    mod_storage_file_read, mod_storage_file_stat, mod_storage_file_write,
    mod_storage_sqlite_execute, mod_storage_sqlite_query, mod_storage_sqlite_transaction, open_db,
    open_runtime_mod_dir, purge_action_execution_ledger, purge_action_idempotency_records,
    purge_action_verify_tickets, purge_mod_storage_data, put_action_execution_ledger_record,
    put_action_idempotency_record, put_action_verify_ticket, put_media_cache,
    query_action_execution_ledger, query_runtime_audit, read_installed_runtime_mod_manifest,
    read_local_mod_asset, read_local_mod_entry, reload_all_runtime_mods, reload_runtime_mod,
    remove_runtime_mod_source, restore_runtime_mod_backup, set_runtime_mod_developer_mode_state,
    sync_runtime_mod_source_watchers, uninstall_runtime_mod,
    update_installed_catalog_mod_with_session, upsert_runtime_mod_source,
    AvailableModUpdatePayload, CatalogPackageRecordPayload, CatalogPackageSummaryPayload,
    RuntimeActionExecutionLedgerRecordPayload, RuntimeActionIdempotencyRecordPayload,
    RuntimeActionVerifyTicketPayload, RuntimeAuditRecordPayload, RuntimeLocalAssetPayload,
    RuntimeLocalManifestSummary, RuntimeMediaCacheGcResultPayload,
    RuntimeMediaCachePutResultPayload, RuntimeModDeveloperModeState, RuntimeModDiagnosticRecord,
    RuntimeModInstallAcceptedPayload, RuntimeModInstallProgressPayload,
    RuntimeModReloadResultPayload, RuntimeModSourceRecord, RuntimeModStorageDataPurgePayload,
    RuntimeModStorageFileDeletePayload, RuntimeModStorageFileEntryPayload,
    RuntimeModStorageFileListPayload, RuntimeModStorageFileReadPayload,
    RuntimeModStorageFileReadResultPayload, RuntimeModStorageFileStatPayload,
    RuntimeModStorageFileWritePayload, RuntimeModStorageFileWriteResultPayload,
    RuntimeModStorageSqliteExecuteResultPayload, RuntimeModStorageSqliteQueryPayload,
    RuntimeModStorageSqliteQueryResultPayload, RuntimeModStorageSqliteTransactionPayload,
};

async fn run_runtime_mod_store<T, F>(operation: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(operation)
        .await
        .map_err(|error| format!("RUNTIME_MOD_STORE_TASK_JOIN_FAILED: {error}"))?
}

#[tauri::command]
pub async fn runtime_mod_append_audit(
    app: AppHandle,
    payload: RuntimeAuditAppendPayload,
) -> Result<(), String> {
    run_runtime_mod_store(move || {
        let conn = open_db(&app)?;
        append_runtime_audit(&conn, &payload.record)
    })
    .await
}

#[tauri::command]
pub async fn runtime_mod_query_audit(
    app: AppHandle,
    payload: Option<RuntimeAuditQueryPayload>,
) -> Result<Vec<RuntimeAuditRecordPayload>, String> {
    run_runtime_mod_store(move || {
        let conn = open_db(&app)?;
        let filter = payload.and_then(|item| item.filter);
        query_runtime_audit(&conn, filter)
    })
    .await
}

#[tauri::command]
pub fn runtime_mod_delete_audit(
    _app: AppHandle,
    _payload: Option<RuntimeAuditDeletePayload>,
) -> Result<usize, String> {
    Err("RUNTIME_AUDIT_DELETE_FORBIDDEN: runtime mod audit records are append-only".to_string())
}

#[tauri::command]
pub async fn runtime_mod_list_local_manifests(
    app: AppHandle,
) -> Result<Vec<RuntimeLocalManifestSummary>, String> {
    run_runtime_mod_store(move || list_local_mod_manifests(&app)).await
}

#[tauri::command]
pub async fn runtime_mod_read_local_entry(
    app: AppHandle,
    payload: RuntimeModReadEntryPayload,
) -> Result<String, String> {
    run_runtime_mod_store(move || read_local_mod_entry(&app, &payload.path)).await
}

#[tauri::command]
pub async fn runtime_mod_read_local_asset(
    app: AppHandle,
    payload: RuntimeModReadAssetPayload,
) -> Result<RuntimeLocalAssetPayload, String> {
    run_runtime_mod_store(move || read_local_mod_asset(&app, &payload.path)).await
}

#[tauri::command]
pub async fn runtime_mod_list_installed(
    app: AppHandle,
) -> Result<Vec<RuntimeLocalManifestSummary>, String> {
    run_runtime_mod_store(move || list_installed_runtime_mods(&app)).await
}

#[tauri::command]
pub async fn runtime_mod_sources_list(
    app: AppHandle,
) -> Result<Vec<RuntimeModSourceRecord>, String> {
    run_runtime_mod_store(move || list_runtime_mod_sources(&app)).await
}

#[tauri::command]
pub async fn runtime_mod_sources_upsert(
    app: AppHandle,
    payload: RuntimeModSourceUpsertPayload,
) -> Result<RuntimeModSourceRecord, String> {
    run_runtime_mod_store(move || {
        let record = upsert_runtime_mod_source(
            &app,
            payload.source_id.as_deref(),
            &payload.source_type,
            &payload.source_dir,
            payload.enabled.unwrap_or(true),
        )?;
        sync_runtime_mod_source_watchers(&app)?;
        Ok(record)
    })
    .await
}

#[tauri::command]
pub async fn runtime_mod_sources_remove(
    app: AppHandle,
    payload: RuntimeModSourceRemovePayload,
) -> Result<bool, String> {
    run_runtime_mod_store(move || {
        let removed = remove_runtime_mod_source(&app, &payload.source_id)?;
        sync_runtime_mod_source_watchers(&app)?;
        Ok(removed)
    })
    .await
}

#[tauri::command]
pub async fn runtime_mod_dev_mode_get(
    app: AppHandle,
) -> Result<RuntimeModDeveloperModeState, String> {
    run_runtime_mod_store(move || get_runtime_mod_developer_mode_state(&app)).await
}

#[tauri::command]
pub async fn runtime_mod_dev_mode_set(
    app: AppHandle,
    payload: RuntimeModDeveloperModeSetPayload,
) -> Result<RuntimeModDeveloperModeState, String> {
    run_runtime_mod_store(move || {
        let state = set_runtime_mod_developer_mode_state(
            &app,
            payload.enabled,
            payload.auto_reload_enabled,
        )?;
        sync_runtime_mod_source_watchers(&app)?;
        Ok(state)
    })
    .await
}

#[tauri::command]
pub fn runtime_mod_storage_dirs_get() -> Result<DesktopStorageDirsPayload, String> {
    describe_desktop_storage_dirs()
}

#[tauri::command]
pub async fn runtime_mod_diagnostics_list(
    app: AppHandle,
) -> Result<Vec<RuntimeModDiagnosticRecord>, String> {
    run_runtime_mod_store(move || list_runtime_mod_diagnostics(&app)).await
}

#[tauri::command]
pub async fn runtime_mod_reload(
    app: AppHandle,
    payload: RuntimeModReloadPayload,
) -> Result<Vec<RuntimeModReloadResultPayload>, String> {
    run_runtime_mod_store(move || reload_runtime_mod(&app, &payload.mod_id)).await
}

#[tauri::command]
pub async fn runtime_mod_reload_all(
    app: AppHandle,
) -> Result<Vec<RuntimeModReloadResultPayload>, String> {
    run_runtime_mod_store(move || reload_all_runtime_mods(&app)).await
}

#[tauri::command]
pub async fn runtime_mod_open_dir(
    app: AppHandle,
    payload: RuntimeModOpenDirPayload,
) -> Result<(), String> {
    run_runtime_mod_store(move || open_runtime_mod_dir(&app, &payload.path)).await
}

#[tauri::command]
pub fn runtime_mod_install(
    app: AppHandle,
    payload: RuntimeModInstallPayload,
) -> Result<RuntimeModInstallAcceptedPayload, String> {
    let install_session_id = create_runtime_mod_install_session_id();
    let source_kind = payload
        .source_kind
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("pending")
        .to_string();
    let accepted = accepted_runtime_mod_install(
        install_session_id.clone(),
        "install",
        source_kind.as_str(),
        None,
        None,
    );
    emit_runtime_mod_queued(&app, &accepted, "queued runtime mod install")?;
    let bg_app = app.clone();
    let bg_accepted = accepted.clone();
    tauri::async_runtime::spawn_blocking(move || {
        if let Err(error) = install_runtime_mod_common_with_session(
            &bg_app,
            &payload.source,
            payload.source_kind.as_deref(),
            payload.replace_existing.unwrap_or(false),
            "install",
            None,
            install_session_id,
        ) {
            emit_runtime_mod_failed(&bg_app, &bg_accepted, error);
        }
    });
    Ok(accepted)
}

#[tauri::command]
pub fn runtime_mod_update(
    app: AppHandle,
    payload: RuntimeModUpdatePayload,
) -> Result<RuntimeModInstallAcceptedPayload, String> {
    let mod_id = payload.mod_id.trim().to_string();
    if mod_id.is_empty() {
        return Err("modId 不能为空".to_string());
    }
    let install_session_id = create_runtime_mod_install_session_id();
    let source_kind = payload
        .source_kind
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("pending")
        .to_string();
    let accepted = accepted_runtime_mod_install(
        install_session_id.clone(),
        "update",
        source_kind.as_str(),
        Some(mod_id.clone()),
        None,
    );
    emit_runtime_mod_queued(&app, &accepted, "queued runtime mod update")?;
    let bg_app = app.clone();
    let bg_accepted = accepted.clone();
    tauri::async_runtime::spawn_blocking(move || {
        if let Err(error) = install_runtime_mod_common_with_session(
            &bg_app,
            &payload.source,
            payload.source_kind.as_deref(),
            true,
            "update",
            Some(mod_id.as_str()),
            install_session_id,
        ) {
            emit_runtime_mod_failed(&bg_app, &bg_accepted, error);
        }
    });
    Ok(accepted)
}

#[tauri::command]
pub async fn runtime_mod_catalog_get(
    payload: RuntimeModCatalogGetPayload,
) -> Result<Option<CatalogPackageRecordPayload>, String> {
    get_catalog_mod(&payload.package_id)
}

#[tauri::command]
pub async fn runtime_mod_catalog_updates_check(
    app: AppHandle,
) -> Result<Vec<AvailableModUpdatePayload>, String> {
    check_catalog_mod_updates(&app)
}

#[tauri::command]
pub fn runtime_mod_catalog_install(
    app: AppHandle,
    payload: RuntimeModCatalogInstallPayload,
) -> Result<RuntimeModInstallAcceptedPayload, String> {
    let package_id = payload.package_id.trim().to_string();
    if package_id.is_empty() {
        return Err("packageId 不能为空".to_string());
    }
    let install_session_id = create_runtime_mod_install_session_id();
    let accepted = accepted_runtime_mod_install(
        install_session_id.clone(),
        "install",
        "catalog",
        Some(package_id.clone()),
        Some(package_id.clone()),
    );
    emit_runtime_mod_queued(&app, &accepted, "queued catalog mod install")?;
    let bg_app = app.clone();
    let bg_accepted = accepted.clone();
    tauri::async_runtime::spawn_blocking(move || {
        match install_catalog_mod_with_session(
            &bg_app,
            package_id.as_str(),
            payload.channel.as_deref(),
            install_session_id,
        ) {
            Ok(result) => {
                let _ = emit_runtime_mod_install_progress(
                    &bg_app,
                    RuntimeModInstallProgressPayload {
                        install_session_id: result.install.install_session_id.clone(),
                        operation: "install".to_string(),
                        source_kind: "catalog".to_string(),
                        phase: "catalog-complete".to_string(),
                        status: "completed".to_string(),
                        occurred_at: now_rfc3339(),
                        mod_id: Some(result.install.mod_id.clone()),
                        manifest_path: Some(result.install.manifest.path.clone()),
                        installed_path: Some(result.install.installed_path.clone()),
                        progress_percent: Some(100.0),
                        message: Some("catalog mod install completed".to_string()),
                        error: None,
                        install: Some(result.install.clone()),
                        catalog_install: Some(result),
                        restored_manifest: None,
                    },
                );
            }
            Err(error) => emit_runtime_mod_failed(&bg_app, &bg_accepted, error),
        }
    });
    Ok(accepted)
}

#[tauri::command]
pub fn runtime_mod_catalog_update(
    app: AppHandle,
    payload: RuntimeModCatalogInstallPayload,
) -> Result<RuntimeModInstallAcceptedPayload, String> {
    let package_id = payload.package_id.trim().to_string();
    if package_id.is_empty() {
        return Err("packageId 不能为空".to_string());
    }
    let install_session_id = create_runtime_mod_install_session_id();
    let accepted = accepted_runtime_mod_install(
        install_session_id.clone(),
        "update",
        "catalog",
        Some(package_id.clone()),
        Some(package_id.clone()),
    );
    emit_runtime_mod_queued(&app, &accepted, "queued catalog mod update")?;
    let bg_app = app.clone();
    let bg_accepted = accepted.clone();
    tauri::async_runtime::spawn_blocking(move || {
        match update_installed_catalog_mod_with_session(
            &bg_app,
            package_id.as_str(),
            payload.channel.as_deref(),
            install_session_id,
        ) {
            Ok(result) => {
                let _ = emit_runtime_mod_install_progress(
                    &bg_app,
                    RuntimeModInstallProgressPayload {
                        install_session_id: result.install.install_session_id.clone(),
                        operation: "update".to_string(),
                        source_kind: "catalog".to_string(),
                        phase: "catalog-complete".to_string(),
                        status: "completed".to_string(),
                        occurred_at: now_rfc3339(),
                        mod_id: Some(result.install.mod_id.clone()),
                        manifest_path: Some(result.install.manifest.path.clone()),
                        installed_path: Some(result.install.installed_path.clone()),
                        progress_percent: Some(100.0),
                        message: Some("catalog mod update completed".to_string()),
                        error: None,
                        install: Some(result.install.clone()),
                        catalog_install: Some(result),
                        restored_manifest: None,
                    },
                );
            }
            Err(error) => emit_runtime_mod_failed(&bg_app, &bg_accepted, error),
        }
    });
    Ok(accepted)
}

#[tauri::command]
pub fn runtime_mod_restore_backup(
    app: AppHandle,
    payload: RuntimeModRestoreBackupPayload,
) -> Result<RuntimeModInstallAcceptedPayload, String> {
    let mod_id = payload.mod_id.trim().to_string();
    if mod_id.is_empty() {
        return Err("modId 不能为空".to_string());
    }
    let install_session_id = create_runtime_mod_install_session_id();
    let accepted = accepted_runtime_mod_install(
        install_session_id.clone(),
        "restore",
        "backup",
        Some(mod_id.clone()),
        None,
    );
    emit_runtime_mod_queued(&app, &accepted, "queued runtime mod backup restore")?;
    let bg_app = app.clone();
    let bg_accepted = accepted.clone();
    tauri::async_runtime::spawn_blocking(move || {
        match restore_runtime_mod_backup(&bg_app, mod_id.as_str(), &payload.backup_path) {
            Ok(summary) => {
                let _ = emit_runtime_mod_install_progress(
                    &bg_app,
                    RuntimeModInstallProgressPayload {
                        install_session_id,
                        operation: "restore".to_string(),
                        source_kind: "backup".to_string(),
                        phase: "complete".to_string(),
                        status: "completed".to_string(),
                        occurred_at: now_rfc3339(),
                        mod_id: Some(summary.id.clone()),
                        manifest_path: Some(summary.path.clone()),
                        installed_path: None,
                        progress_percent: Some(100.0),
                        message: Some("runtime mod backup restored".to_string()),
                        error: None,
                        install: None,
                        catalog_install: None,
                        restored_manifest: Some(summary),
                    },
                );
            }
            Err(error) => emit_runtime_mod_failed(&bg_app, &bg_accepted, error),
        }
    });
    Ok(accepted)
}

#[tauri::command]
pub async fn runtime_mod_uninstall(
    app: AppHandle,
    payload: RuntimeModUninstallPayload,
) -> Result<RuntimeLocalManifestSummary, String> {
    run_runtime_mod_store(move || uninstall_runtime_mod(&app, &payload.mod_id)).await
}

#[tauri::command]
pub async fn runtime_mod_storage_file_read(
    app: AppHandle,
    payload: RuntimeModStorageFileReadPayload,
) -> Result<RuntimeModStorageFileReadResultPayload, String> {
    run_runtime_mod_store(move || mod_storage_file_read(&app, &payload)).await
}

#[tauri::command]
pub async fn runtime_mod_storage_file_write(
    app: AppHandle,
    payload: RuntimeModStorageFileWritePayload,
) -> Result<RuntimeModStorageFileWriteResultPayload, String> {
    run_runtime_mod_store(move || mod_storage_file_write(&app, &payload)).await
}

#[tauri::command]
pub async fn runtime_mod_storage_file_delete(
    app: AppHandle,
    payload: RuntimeModStorageFileDeletePayload,
) -> Result<bool, String> {
    run_runtime_mod_store(move || mod_storage_file_delete(&app, &payload)).await
}

#[tauri::command]
pub async fn runtime_mod_storage_file_list(
    app: AppHandle,
    payload: RuntimeModStorageFileListPayload,
) -> Result<Vec<RuntimeModStorageFileEntryPayload>, String> {
    run_runtime_mod_store(move || mod_storage_file_list(&app, &payload)).await
}

#[tauri::command]
pub async fn runtime_mod_storage_file_stat(
    app: AppHandle,
    payload: RuntimeModStorageFileStatPayload,
) -> Result<Option<RuntimeModStorageFileEntryPayload>, String> {
    run_runtime_mod_store(move || mod_storage_file_stat(&app, &payload)).await
}

#[tauri::command]
pub async fn runtime_mod_storage_sqlite_query(
    app: AppHandle,
    payload: RuntimeModStorageSqliteQueryPayload,
) -> Result<RuntimeModStorageSqliteQueryResultPayload, String> {
    run_runtime_mod_store(move || mod_storage_sqlite_query(&app, &payload)).await
}

#[tauri::command]
pub async fn runtime_mod_storage_sqlite_execute(
    app: AppHandle,
    payload: RuntimeModStorageSqliteQueryPayload,
) -> Result<RuntimeModStorageSqliteExecuteResultPayload, String> {
    run_runtime_mod_store(move || mod_storage_sqlite_execute(&app, &payload)).await
}

#[tauri::command]
pub async fn runtime_mod_storage_sqlite_transaction(
    app: AppHandle,
    payload: RuntimeModStorageSqliteTransactionPayload,
) -> Result<RuntimeModStorageSqliteExecuteResultPayload, String> {
    run_runtime_mod_store(move || mod_storage_sqlite_transaction(&app, &payload)).await
}

#[tauri::command]
pub async fn runtime_mod_storage_data_purge(
    app: AppHandle,
    payload: RuntimeModStorageDataPurgePayload,
) -> Result<bool, String> {
    run_runtime_mod_store(move || purge_mod_storage_data(&app, &payload.mod_id)).await
}

#[tauri::command]
pub async fn runtime_mod_read_manifest(
    app: AppHandle,
    payload: RuntimeModReadManifestPayload,
) -> Result<RuntimeLocalManifestSummary, String> {
    run_runtime_mod_store(move || {
        read_installed_runtime_mod_manifest(
            &app,
            payload.mod_id.as_deref(),
            payload.path.as_deref(),
        )
    })
    .await
}

#[tauri::command]
pub async fn runtime_mod_catalog_list() -> Result<Vec<CatalogPackageSummaryPayload>, String> {
    run_runtime_mod_store(list_catalog_mods).await
}

#[tauri::command]
pub async fn runtime_mod_install_progress(
    _app: AppHandle,
    payload: Option<RuntimeModInstallProgressQueryPayload>,
) -> Result<Vec<RuntimeModInstallProgressPayload>, String> {
    run_runtime_mod_store(move || {
        list_runtime_mod_install_progress(
            payload
                .as_ref()
                .and_then(|item| item.install_session_id.as_deref()),
        )
    })
    .await
}

#[tauri::command]
pub async fn runtime_mod_get_action_idempotency(
    app: AppHandle,
    payload: RuntimeActionIdempotencyGetPayload,
) -> Result<Option<RuntimeActionIdempotencyRecordPayload>, String> {
    run_runtime_mod_store(move || {
        let conn = open_db(&app)?;
        get_action_idempotency_record(
            &conn,
            &payload.principal_id,
            &payload.action_id,
            &payload.idempotency_key,
        )
    })
    .await
}

#[tauri::command]
pub async fn runtime_mod_put_action_idempotency(
    app: AppHandle,
    payload: RuntimeActionIdempotencyPutPayload,
) -> Result<(), String> {
    run_runtime_mod_store(move || {
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
    })
    .await
}

#[tauri::command]
pub async fn runtime_mod_purge_action_idempotency(
    app: AppHandle,
    payload: RuntimeActionIdempotencyPurgePayload,
) -> Result<usize, String> {
    run_runtime_mod_store(move || {
        let conn = open_db(&app)?;
        purge_action_idempotency_records(&conn, &payload.before)
    })
    .await
}

#[tauri::command]
pub async fn runtime_mod_get_action_verify_ticket(
    app: AppHandle,
    payload: RuntimeActionVerifyTicketGetPayload,
) -> Result<Option<RuntimeActionVerifyTicketPayload>, String> {
    run_runtime_mod_store(move || {
        let conn = open_db(&app)?;
        get_action_verify_ticket(&conn, &payload.ticket_id)
    })
    .await
}

#[tauri::command]
pub async fn runtime_mod_put_action_verify_ticket(
    app: AppHandle,
    payload: RuntimeActionVerifyTicketPutPayload,
) -> Result<(), String> {
    run_runtime_mod_store(move || {
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
    })
    .await
}

#[tauri::command]
pub async fn runtime_mod_delete_action_verify_ticket(
    app: AppHandle,
    payload: RuntimeActionVerifyTicketDeletePayload,
) -> Result<usize, String> {
    run_runtime_mod_store(move || {
        let conn = open_db(&app)?;
        delete_action_verify_ticket(&conn, &payload.ticket_id)
    })
    .await
}

#[tauri::command]
pub async fn runtime_mod_purge_action_verify_tickets(
    app: AppHandle,
    payload: RuntimeActionVerifyTicketPurgePayload,
) -> Result<usize, String> {
    run_runtime_mod_store(move || {
        let conn = open_db(&app)?;
        purge_action_verify_tickets(&conn, &payload.before)
    })
    .await
}

#[tauri::command]
pub async fn runtime_mod_put_action_execution_ledger(
    app: AppHandle,
    payload: RuntimeActionExecutionLedgerPutPayload,
) -> Result<(), String> {
    run_runtime_mod_store(move || {
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
    })
    .await
}

#[tauri::command]
pub async fn runtime_mod_query_action_execution_ledger(
    app: AppHandle,
    payload: Option<RuntimeActionExecutionLedgerQueryPayload>,
) -> Result<Vec<RuntimeActionExecutionLedgerRecordPayload>, String> {
    run_runtime_mod_store(move || {
        let conn = open_db(&app)?;
        let filter = payload.and_then(|item| item.filter);
        query_action_execution_ledger(&conn, filter)
    })
    .await
}

#[tauri::command]
pub async fn runtime_mod_purge_action_execution_ledger(
    app: AppHandle,
    payload: RuntimeActionExecutionLedgerPurgePayload,
) -> Result<usize, String> {
    run_runtime_mod_store(move || {
        let conn = open_db(&app)?;
        purge_action_execution_ledger(&conn, &payload.before)
    })
    .await
}

#[tauri::command]
pub async fn runtime_mod_media_cache_put(
    _app: AppHandle,
    payload: RuntimeMediaCachePutPayload,
) -> Result<RuntimeMediaCachePutResultPayload, String> {
    run_runtime_mod_store(move || {
        put_media_cache(
            &payload.media_base64,
            payload.mime_type.as_deref(),
            payload.extension_hint.as_deref(),
        )
    })
    .await
}

#[tauri::command]
pub async fn runtime_mod_media_cache_gc(
    _app: AppHandle,
    payload: Option<RuntimeMediaCacheGcPayload>,
) -> Result<RuntimeMediaCacheGcResultPayload, String> {
    run_runtime_mod_store(move || gc_media_cache(payload.and_then(|value| value.max_age_seconds)))
        .await
}
