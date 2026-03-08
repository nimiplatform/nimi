use std::time::{Duration, Instant};

use tauri::AppHandle;

use super::shared::{
    append_audit_non_blocking, classify_reason_code, cleanup_staging_for_model, emit_progress_event,
    get_control, mark_worker_started, mark_worker_stopped, take_next_queued_session,
    update_or_restore_record, update_record, SessionControl, LOCAL_AI_HF_DOWNLOAD_CANCELLED,
    LOCAL_AI_HF_DOWNLOAD_HASH_MISMATCH, LOCAL_AI_HF_DOWNLOAD_PAUSED,
};
use super::super::audit::{
    EVENT_MODEL_DOWNLOAD_CANCELLED, EVENT_MODEL_DOWNLOAD_COMPLETED, EVENT_MODEL_DOWNLOAD_FAILED,
    EVENT_MODEL_DOWNLOAD_PAUSED,
};
use super::super::hf_source::{install_from_hf_with_control, HfDownloadControl, HfDownloadProgress};
use super::super::model_registry::upsert_model;
use super::super::store::load_state;
use super::super::types::LocalAiDownloadState;

fn process_session(app: &AppHandle, install_session_id: &str) {
    let record = match update_record(app, install_session_id, |entry| {
        entry.state = LocalAiDownloadState::Running;
        entry.phase = "download".to_string();
        entry.reason_code = None;
        entry.message = Some("downloading from Hugging Face".to_string());
        entry.retryable = true;
    }) {
        Ok(updated) => updated,
        Err(error) => {
            eprintln!("LOCAL_AI_DOWNLOAD_SESSION_START_FAILED: {error}");
            return;
        }
    };
    emit_progress_event(app, &record);

    let install_request = record.request.clone();
    let local_model_id = record.local_model_id.clone();
    let model_id = record.model_id.clone();
    let metadata = record.install_metadata.clone();
    let mut latest_record = record.clone();

    let mut last_save = Instant::now();
    let mut last_saved_phase = record.phase.clone();
    let mut on_progress = |progress: HfDownloadProgress| -> HfDownloadControl {
        let control = get_control(install_session_id);
        if control == SessionControl::Cancelled {
            return HfDownloadControl::Cancel;
        }
        if control == SessionControl::Paused {
            return HfDownloadControl::Pause;
        }
        let phase_changed = progress.phase != last_saved_phase;
        let reached_known_total = progress
            .bytes_total
            .map(|total| progress.bytes_received >= total)
            .unwrap_or(false);
        let should_save = phase_changed
            || reached_known_total
            || last_save.elapsed() >= Duration::from_millis(250);
        if should_save {
            match update_or_restore_record(app, &latest_record, |entry| {
                entry.phase = progress.phase.clone();
                entry.bytes_received = progress.bytes_received;
                entry.bytes_total = progress.bytes_total;
                entry.speed_bytes_per_sec = progress.speed_bytes_per_sec;
                entry.eta_seconds = progress.eta_seconds;
                entry.message = progress.message.clone();
            }) {
                Ok(updated) => {
                    emit_progress_event(app, &updated);
                    latest_record = updated;
                }
                Err(error) => {
                    eprintln!("LOCAL_AI_DOWNLOAD_PROGRESS_SAVE_FAILED: {error}");
                }
            }
            last_save = Instant::now();
            last_saved_phase = progress.phase;
        }
        HfDownloadControl::Continue
    };

    match install_from_hf_with_control(app, &install_request, &mut on_progress) {
        Ok(model) => match upsert_model(app, model) {
            Ok(saved) => {
                match update_or_restore_record(app, &latest_record, |entry| {
                    entry.phase = "verify".to_string();
                    entry.state = LocalAiDownloadState::Completed;
                    entry.message = Some("installation completed".to_string());
                    entry.reason_code = None;
                    entry.retryable = false;
                    entry.local_model_id = saved.local_model_id.clone();
                }) {
                    Ok(updated) => {
                        emit_progress_event(app, &updated);
                    }
                    Err(error) => {
                        eprintln!("LOCAL_AI_DOWNLOAD_COMPLETION_SAVE_FAILED: {error}");
                    }
                }
                append_audit_non_blocking(
                    app,
                    EVENT_MODEL_DOWNLOAD_COMPLETED,
                    Some(saved.model_id.as_str()),
                    Some(saved.local_model_id.as_str()),
                    Some(serde_json::json!({
                        "source": "huggingface",
                    })),
                );
            }
            Err(error) => {
                let reason_code = classify_reason_code(error.as_str()).0;
                match update_or_restore_record(app, &latest_record, |entry| {
                    entry.phase = "upsert".to_string();
                    entry.state = LocalAiDownloadState::Failed;
                    entry.message = Some(error.clone());
                    entry.reason_code = Some(reason_code.clone());
                    entry.retryable = false;
                }) {
                    Ok(updated) => {
                        emit_progress_event(app, &updated);
                    }
                    Err(save_error) => {
                        eprintln!("LOCAL_AI_DOWNLOAD_UPSERT_FAILURE_SAVE_FAILED: {save_error}");
                    }
                }
                append_audit_non_blocking(
                    app,
                    EVENT_MODEL_DOWNLOAD_FAILED,
                    Some(model_id.as_str()),
                    Some(local_model_id.as_str()),
                    Some(serde_json::json!({
                        "reasonCode": reason_code,
                        "error": error,
                        "retryable": false,
                        "phase": "upsert",
                        "metadata": metadata,
                    })),
                );
            }
        },
        Err(error) => {
            let (reason_code, retryable) = classify_reason_code(error.as_str());
            let mut next_state = LocalAiDownloadState::Failed;
            if reason_code == LOCAL_AI_HF_DOWNLOAD_PAUSED {
                next_state = LocalAiDownloadState::Paused;
            } else if reason_code == LOCAL_AI_HF_DOWNLOAD_CANCELLED {
                next_state = LocalAiDownloadState::Cancelled;
                cleanup_staging_for_model(app, model_id.as_str());
            } else if reason_code == LOCAL_AI_HF_DOWNLOAD_HASH_MISMATCH {
                cleanup_staging_for_model(app, model_id.as_str());
            }
            match update_or_restore_record(app, &latest_record, |entry| {
                entry.state = next_state.clone();
                entry.message = Some(error.clone());
                entry.reason_code = Some(reason_code.clone());
                entry.retryable = retryable;
            }) {
                Ok(updated) => {
                    emit_progress_event(app, &updated);
                }
                Err(save_error) => {
                    eprintln!("LOCAL_AI_DOWNLOAD_FAILURE_SAVE_FAILED: {save_error}");
                }
            }
            let audit_event = if next_state == LocalAiDownloadState::Paused {
                EVENT_MODEL_DOWNLOAD_PAUSED
            } else if next_state == LocalAiDownloadState::Cancelled {
                EVENT_MODEL_DOWNLOAD_CANCELLED
            } else {
                EVENT_MODEL_DOWNLOAD_FAILED
            };
            append_audit_non_blocking(
                app,
                audit_event,
                Some(model_id.as_str()),
                Some(local_model_id.as_str()),
                Some(serde_json::json!({
                    "reasonCode": reason_code,
                    "error": error,
                    "retryable": retryable,
                    "metadata": metadata,
                })),
            );
        }
    }
}

pub(super) fn start_worker_if_needed(app: &AppHandle) {
    if !mark_worker_started() {
        return;
    }
    let app = app.clone();
    std::thread::spawn(move || loop {
        let Some(session_id) = take_next_queued_session() else {
            mark_worker_stopped();
            break;
        };
        let state = load_state(&app)
            .ok()
            .and_then(|value| {
                value
                    .downloads
                    .iter()
                    .find(|item| item.install_session_id == session_id)
                    .map(|item| item.state.clone())
            })
            .unwrap_or(LocalAiDownloadState::Cancelled);
        if state != LocalAiDownloadState::Queued {
            continue;
        }
        process_session(&app, session_id.as_str());
    });
}
