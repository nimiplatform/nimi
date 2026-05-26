use serde::Serialize;
use tauri::AppHandle;

use super::super::audit::{append_audit_event, EVENT_MODEL_DOWNLOAD_INTERRUPTED};
use super::super::store::load_state;
use super::super::types::{
    now_iso_timestamp, LocalAiDownloadSessionRecord, LocalAiDownloadState, LocalAiInstallRequest,
    LocalAiTransferSessionKind,
};
use super::shared::classify_reason_code;
use super::shared::{
    build_install_session_id, emit_progress_event, find_record, is_terminal_state,
    manager_initialized, recover_manager_state, update_record, with_state_mut,
    LOCAL_AI_HF_DOWNLOAD_INTERRUPTED,
};
use crate::local_runtime::commands::runtime_remove_asset_via_runtime;

const LOCAL_AI_BACKGROUND_IMPORT_INTERRUPTED: &str = "LOCAL_AI_BACKGROUND_IMPORT_INTERRUPTED";
const LOCAL_AI_BACKGROUND_IMPORT_CANCELLED: &str = "LOCAL_AI_BACKGROUND_IMPORT_CANCELLED";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadEnqueueAccepted {
    pub install_session_id: String,
    pub model_id: String,
    pub local_model_id: String,
}

#[derive(Clone)]
pub struct BackgroundImportCancelToken {
    app: AppHandle,
    install_session_id: String,
}

impl BackgroundImportCancelToken {
    fn new(app: AppHandle, install_session_id: String) -> Self {
        Self {
            app,
            install_session_id,
        }
    }

    pub fn is_cancelled(&self) -> bool {
        background_import_cancelled(&self.app, self.install_session_id.as_str())
    }

    pub fn throw_if_cancelled(&self) -> Result<(), String> {
        if self.is_cancelled() {
            Err(format!(
                "{LOCAL_AI_BACKGROUND_IMPORT_CANCELLED}: background import was cancelled"
            ))
        } else {
            Ok(())
        }
    }
}

pub fn is_background_import_cancelled_error(error: &str) -> bool {
    error
        .trim_start()
        .starts_with(LOCAL_AI_BACKGROUND_IMPORT_CANCELLED)
}

fn default_background_request(model_id: &str) -> LocalAiInstallRequest {
    LocalAiInstallRequest {
        model_id: model_id.to_string(),
        repo: String::new(),
        revision: None,
        capabilities: None,
        engine: None,
        entry: None,
        files: None,
        license: None,
        hashes: None,
        endpoint: None,
        provider_hints: None,
        engine_config: None,
    }
}

pub fn ensure_initialized(app: &AppHandle) -> Result<(), String> {
    if manager_initialized() {
        return Ok(());
    }

    let recovered = with_state_mut(app, |state| {
        let mut changed = false;
        let mut interrupted_sessions = Vec::<(String, String, String, String)>::new();
        for session in &mut state.downloads {
            if session.state == LocalAiDownloadState::Running
                || session.state == LocalAiDownloadState::Queued
            {
                match session.session_kind {
                    LocalAiTransferSessionKind::Download => {
                        session.state = LocalAiDownloadState::Paused;
                        session.reason_code = Some(LOCAL_AI_HF_DOWNLOAD_INTERRUPTED.to_string());
                        session.retryable = true;
                        session.message = Some("download interrupted, resume manually".to_string());
                    }
                    LocalAiTransferSessionKind::Import => {
                        session.state = LocalAiDownloadState::Failed;
                        session.reason_code =
                            Some(LOCAL_AI_BACKGROUND_IMPORT_INTERRUPTED.to_string());
                        session.retryable = false;
                        session.message =
                            Some("background import interrupted, start a new import".to_string());
                    }
                }
                session.updated_at = now_iso_timestamp();
                let reason_code =
                    session
                        .reason_code
                        .clone()
                        .unwrap_or_else(|| match session.session_kind {
                            LocalAiTransferSessionKind::Download => {
                                LOCAL_AI_HF_DOWNLOAD_INTERRUPTED.to_string()
                            }
                            LocalAiTransferSessionKind::Import => {
                                LOCAL_AI_BACKGROUND_IMPORT_INTERRUPTED.to_string()
                            }
                        });
                interrupted_sessions.push((
                    session.install_session_id.clone(),
                    session.model_id.clone(),
                    session.local_model_id.clone(),
                    reason_code,
                ));
                changed = true;
            }
        }
        for (install_session_id, model_id, local_model_id, reason_code) in interrupted_sessions {
            append_audit_event(
                state,
                EVENT_MODEL_DOWNLOAD_INTERRUPTED,
                Some(model_id.as_str()),
                Some(local_model_id.as_str()),
                Some(serde_json::json!({
                    "installSessionId": install_session_id,
                    "reasonCode": reason_code,
                })),
            );
        }
        Ok(changed)
    })?;

    if recovered {
        let state = load_state(app)?;
        for session in &state.downloads {
            emit_progress_event(app, session);
        }
    }

    recover_manager_state();
    Ok(())
}

fn background_import_cancelled(app: &AppHandle, install_session_id: &str) -> bool {
    find_record(app, install_session_id)
        .map(|record| record.state == LocalAiDownloadState::Cancelled)
        .unwrap_or(true)
}

fn rollback_completed_background_import(local_model_id: &str) {
    let local_model_id = local_model_id.trim();
    if local_model_id.is_empty() || local_model_id.starts_with("pending:") {
        return;
    }
    if let Err(error) = runtime_remove_asset_via_runtime(local_model_id) {
        eprintln!("LOCAL_AI_BACKGROUND_IMPORT_CANCEL_ROLLBACK_FAILED: {error}");
    }
}

pub fn enqueue_background_import_task<F>(
    app: &AppHandle,
    model_id: &str,
    local_model_id: &str,
    phase: &str,
    message: &str,
    task: F,
) -> Result<DownloadEnqueueAccepted, String>
where
    F: FnOnce(AppHandle, String, String, String, BackgroundImportCancelToken) + Send + 'static,
{
    ensure_initialized(app)?;
    let model_id = model_id.trim().to_string();
    if model_id.is_empty() {
        return Err("LOCAL_AI_BACKGROUND_TASK_MODEL_ID_EMPTY: modelId is required".to_string());
    }
    let local_model_id = local_model_id.trim().to_string();
    if local_model_id.is_empty() {
        return Err(
            "LOCAL_AI_BACKGROUND_TASK_LOCAL_MODEL_ID_EMPTY: localModelId is required".to_string(),
        );
    }
    let install_session_id = build_install_session_id(model_id.as_str());
    let now = now_iso_timestamp();
    let record = LocalAiDownloadSessionRecord {
        install_session_id: install_session_id.clone(),
        model_id: model_id.clone(),
        local_model_id: local_model_id.clone(),
        session_kind: LocalAiTransferSessionKind::Import,
        request: default_background_request(model_id.as_str()),
        install_metadata: Some(serde_json::json!({
            "backgroundTask": true,
        })),
        phase: phase.to_string(),
        state: LocalAiDownloadState::Running,
        bytes_received: 0,
        bytes_total: None,
        speed_bytes_per_sec: None,
        eta_seconds: None,
        message: Some(message.to_string()),
        reason_code: None,
        retryable: false,
        created_at: now.clone(),
        updated_at: now,
    };

    with_state_mut(app, |state| {
        let has_active_for_model = state.downloads.iter().any(|item| {
            item.model_id.eq_ignore_ascii_case(model_id.as_str()) && !is_terminal_state(&item.state)
        });
        if has_active_for_model {
            return Err(format!(
                "LOCAL_AI_BACKGROUND_TASK_SESSION_EXISTS: active transfer already exists for modelId={model_id}"
            ));
        }
        state.downloads.push(record.clone());
        Ok(())
    })?;
    emit_progress_event(app, &record);

    let bg_app = app.clone();
    let bg_session_id = install_session_id.clone();
    let bg_model_id = model_id.clone();
    let bg_local_model_id = local_model_id.clone();
    let cancel_token = BackgroundImportCancelToken::new(bg_app.clone(), bg_session_id.clone());
    tauri::async_runtime::spawn_blocking(move || {
        if cancel_token.is_cancelled() {
            return;
        }
        task(
            bg_app,
            bg_session_id,
            bg_model_id,
            bg_local_model_id,
            cancel_token,
        );
    });

    Ok(DownloadEnqueueAccepted {
        install_session_id,
        model_id,
        local_model_id,
    })
}

pub fn complete_background_import_task(
    app: &AppHandle,
    install_session_id: &str,
    model_id: &str,
    local_model_id: &str,
    message: &str,
) {
    if background_import_cancelled(app, install_session_id) {
        rollback_completed_background_import(local_model_id);
        return;
    }
    match update_record(app, install_session_id, |entry| {
        if is_terminal_state(&entry.state) {
            return;
        }
        entry.model_id = model_id.to_string();
        entry.local_model_id = local_model_id.to_string();
        entry.phase = "complete".to_string();
        entry.state = LocalAiDownloadState::Completed;
        entry.bytes_received = entry.bytes_total.unwrap_or(1);
        entry.bytes_total = Some(entry.bytes_received.max(1));
        entry.message = Some(message.to_string());
        entry.reason_code = None;
        entry.retryable = false;
    }) {
        Ok(updated) => emit_progress_event(app, &updated),
        Err(error) => eprintln!("LOCAL_AI_BACKGROUND_TASK_COMPLETE_FAILED: {error}"),
    }
}

pub fn fail_background_import_task(
    app: &AppHandle,
    install_session_id: &str,
    message: String,
    retryable: bool,
) {
    if background_import_cancelled(app, install_session_id) {
        return;
    }
    let (reason_code, _) = classify_reason_code(message.as_str());
    match update_record(app, install_session_id, |entry| {
        if is_terminal_state(&entry.state) {
            return;
        }
        entry.phase = "failed".to_string();
        entry.state = LocalAiDownloadState::Failed;
        entry.message = Some(message.clone());
        entry.reason_code = Some(reason_code.clone());
        entry.retryable = retryable;
    }) {
        Ok(updated) => emit_progress_event(app, &updated),
        Err(error) => eprintln!("LOCAL_AI_BACKGROUND_TASK_FAILURE_SAVE_FAILED: {error}"),
    }
}
