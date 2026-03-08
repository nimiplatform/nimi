use serde::Serialize;
use tauri::AppHandle;

use super::shared::{
    append_audit_non_blocking, build_install_session_id, emit_progress_event, find_record,
    guessed_local_model_id, is_terminal_state, manager_initialized, queue_session,
    recover_manager_state, remove_from_queue, set_control, to_summary, update_record,
    with_state_mut, SessionControl, LOCAL_AI_HF_DOWNLOAD_CANCELLED,
    LOCAL_AI_HF_DOWNLOAD_INTERRUPTED, LOCAL_AI_HF_DOWNLOAD_PAUSED,
};
use super::worker::start_worker_if_needed;
use super::super::audit::{
    append_audit_event, EVENT_MODEL_DOWNLOAD_CANCELLED, EVENT_MODEL_DOWNLOAD_INTERRUPTED,
    EVENT_MODEL_DOWNLOAD_PAUSED, EVENT_MODEL_DOWNLOAD_RESUMED, EVENT_MODEL_DOWNLOAD_STARTED,
};
use super::super::store::load_state;
use super::super::types::{
    now_iso_timestamp, LocalAiDownloadSessionRecord, LocalAiDownloadSessionSummary,
    LocalAiDownloadState, LocalAiInstallRequest,
};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadEnqueueAccepted {
    pub install_session_id: String,
    pub model_id: String,
    pub local_model_id: String,
}

pub fn ensure_initialized(app: &AppHandle) -> Result<(), String> {
    if manager_initialized() {
        return Ok(());
    }

    let recovered = with_state_mut(app, |state| {
        let mut changed = false;
        let mut interrupted_sessions = Vec::<(String, String, String)>::new();
        for session in &mut state.downloads {
            if session.state == LocalAiDownloadState::Running
                || session.state == LocalAiDownloadState::Queued
            {
                session.state = LocalAiDownloadState::Paused;
                session.reason_code = Some(LOCAL_AI_HF_DOWNLOAD_INTERRUPTED.to_string());
                session.retryable = true;
                session.message = Some("download interrupted, resume manually".to_string());
                session.updated_at = now_iso_timestamp();
                interrupted_sessions.push((
                    session.install_session_id.clone(),
                    session.model_id.clone(),
                    session.local_model_id.clone(),
                ));
                changed = true;
            }
        }
        for (install_session_id, model_id, local_model_id) in interrupted_sessions {
            append_audit_event(
                state,
                EVENT_MODEL_DOWNLOAD_INTERRUPTED,
                Some(model_id.as_str()),
                Some(local_model_id.as_str()),
                Some(serde_json::json!({
                    "installSessionId": install_session_id,
                    "reasonCode": LOCAL_AI_HF_DOWNLOAD_INTERRUPTED,
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

    recover_manager_state(app);
    Ok(())
}

pub fn enqueue_install(
    app: &AppHandle,
    install_request: LocalAiInstallRequest,
    install_metadata: Option<serde_json::Value>,
) -> Result<DownloadEnqueueAccepted, String> {
    ensure_initialized(app)?;
    let model_id = install_request.model_id.trim().to_string();
    if model_id.is_empty() {
        return Err("LOCAL_AI_INSTALL_MODEL_ID_EMPTY: modelId is required".to_string());
    }
    let install_session_id = build_install_session_id(model_id.as_str());
    let local_model_id = guessed_local_model_id(model_id.as_str());
    let now = now_iso_timestamp();
    let record = LocalAiDownloadSessionRecord {
        install_session_id: install_session_id.clone(),
        model_id: model_id.clone(),
        local_model_id: local_model_id.clone(),
        request: install_request,
        install_metadata: install_metadata.clone(),
        phase: "download".to_string(),
        state: LocalAiDownloadState::Queued,
        bytes_received: 0,
        bytes_total: None,
        speed_bytes_per_sec: None,
        eta_seconds: None,
        message: Some("queued for download".to_string()),
        reason_code: None,
        retryable: true,
        created_at: now.clone(),
        updated_at: now,
    };

    with_state_mut(app, |state| {
        let has_active_for_model = state.downloads.iter().any(|item| {
            item.model_id.eq_ignore_ascii_case(model_id.as_str()) && !is_terminal_state(&item.state)
        });
        if has_active_for_model {
            return Err(format!(
                "LOCAL_AI_HF_DOWNLOAD_SESSION_EXISTS: active download already exists for modelId={model_id}"
            ));
        }
        state.downloads.push(record.clone());
        Ok(())
    })?;

    queue_session(install_session_id.as_str(), SessionControl::Running);
    emit_progress_event(app, &record);
    append_audit_non_blocking(
        app,
        EVENT_MODEL_DOWNLOAD_STARTED,
        Some(model_id.as_str()),
        Some(local_model_id.as_str()),
        install_metadata,
    );
    start_worker_if_needed(app);

    Ok(DownloadEnqueueAccepted {
        install_session_id,
        model_id,
        local_model_id,
    })
}

pub fn list_download_sessions(
    app: &AppHandle,
) -> Result<Vec<LocalAiDownloadSessionSummary>, String> {
    ensure_initialized(app)?;
    let mut rows = load_state(app)?
        .downloads
        .into_iter()
        .map(|item| to_summary(&item))
        .collect::<Vec<_>>();
    rows.sort_by(|left, right| right.updated_at.cmp(&left.updated_at));
    Ok(rows)
}

pub fn pause_download(
    app: &AppHandle,
    install_session_id: &str,
) -> Result<LocalAiDownloadSessionSummary, String> {
    ensure_initialized(app)?;
    let current = find_record(app, install_session_id)?;
    if current.state == LocalAiDownloadState::Completed
        || current.state == LocalAiDownloadState::Cancelled
    {
        return Ok(to_summary(&current));
    }
    if current.state != LocalAiDownloadState::Running
        && current.state != LocalAiDownloadState::Queued
    {
        return Ok(to_summary(&current));
    }
    set_control(install_session_id, SessionControl::Paused);
    remove_from_queue(install_session_id);
    let updated = update_record(app, install_session_id, |entry| {
        entry.state = LocalAiDownloadState::Paused;
        entry.reason_code = Some(LOCAL_AI_HF_DOWNLOAD_PAUSED.to_string());
        entry.message = Some("download paused".to_string());
    })?;
    emit_progress_event(app, &updated);
    append_audit_non_blocking(
        app,
        EVENT_MODEL_DOWNLOAD_PAUSED,
        Some(updated.model_id.as_str()),
        Some(updated.local_model_id.as_str()),
        Some(serde_json::json!({
            "installSessionId": updated.install_session_id,
            "reasonCode": LOCAL_AI_HF_DOWNLOAD_PAUSED,
        })),
    );
    Ok(to_summary(&updated))
}

pub fn resume_download(
    app: &AppHandle,
    install_session_id: &str,
) -> Result<LocalAiDownloadSessionSummary, String> {
    ensure_initialized(app)?;
    let current = find_record(app, install_session_id)?;
    if current.state == LocalAiDownloadState::Completed {
        return Ok(to_summary(&current));
    }
    if current.state == LocalAiDownloadState::Cancelled {
        return Err(
            "LOCAL_AI_HF_DOWNLOAD_NOT_RESUMABLE: cancelled session must start a new install"
                .to_string(),
        );
    }
    if current.state == LocalAiDownloadState::Failed && !current.retryable {
        return Err(
            "LOCAL_AI_HF_DOWNLOAD_NOT_RESUMABLE: failed session is not retryable, start a new install"
                .to_string(),
        );
    }
    set_control(install_session_id, SessionControl::Running);
    let updated = update_record(app, install_session_id, |entry| {
        entry.state = LocalAiDownloadState::Queued;
        entry.reason_code = None;
        entry.phase = "download".to_string();
        entry.retryable = true;
        entry.message = Some("queued for resume".to_string());
    })?;
    remove_from_queue(install_session_id);
    queue_session(install_session_id, SessionControl::Running);
    emit_progress_event(app, &updated);
    append_audit_non_blocking(
        app,
        EVENT_MODEL_DOWNLOAD_RESUMED,
        Some(updated.model_id.as_str()),
        Some(updated.local_model_id.as_str()),
        Some(serde_json::json!({
            "installSessionId": updated.install_session_id,
        })),
    );
    start_worker_if_needed(app);
    Ok(to_summary(&updated))
}

pub fn cancel_download(
    app: &AppHandle,
    install_session_id: &str,
) -> Result<LocalAiDownloadSessionSummary, String> {
    ensure_initialized(app)?;
    let current = find_record(app, install_session_id)?;
    if current.state == LocalAiDownloadState::Completed
        || current.state == LocalAiDownloadState::Cancelled
    {
        return Ok(to_summary(&current));
    }
    set_control(install_session_id, SessionControl::Cancelled);
    remove_from_queue(install_session_id);
    let updated = update_record(app, install_session_id, |entry| {
        entry.state = LocalAiDownloadState::Cancelled;
        entry.reason_code = Some(LOCAL_AI_HF_DOWNLOAD_CANCELLED.to_string());
        entry.retryable = false;
        entry.message = Some("download cancelled".to_string());
    })?;
    super::shared::cleanup_staging_for_model(app, updated.model_id.as_str());
    emit_progress_event(app, &updated);
    append_audit_non_blocking(
        app,
        EVENT_MODEL_DOWNLOAD_CANCELLED,
        Some(updated.model_id.as_str()),
        Some(updated.local_model_id.as_str()),
        Some(serde_json::json!({
            "installSessionId": updated.install_session_id,
            "reasonCode": LOCAL_AI_HF_DOWNLOAD_CANCELLED,
        })),
    );
    Ok(to_summary(&updated))
}
