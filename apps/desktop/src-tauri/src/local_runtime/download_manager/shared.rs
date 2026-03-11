use std::collections::{HashMap, VecDeque};
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

use tauri::{AppHandle, Emitter};

use super::super::audit::append_audit_event;
use super::super::store::{load_state, runtime_models_dir, save_state};
use super::super::types::{
    now_iso_timestamp, slugify_local_model_id, LocalAiDownloadProgressEvent,
    LocalAiDownloadSessionRecord, LocalAiDownloadSessionSummary, LocalAiDownloadState,
    LOCAL_AI_DOWNLOAD_PROGRESS_EVENT,
};

pub(super) const LOCAL_AI_HF_DOWNLOAD_INTERRUPTED: &str = "LOCAL_AI_HF_DOWNLOAD_INTERRUPTED";
pub(super) const LOCAL_AI_HF_DOWNLOAD_PAUSED: &str = "LOCAL_AI_HF_DOWNLOAD_PAUSED";
pub(super) const LOCAL_AI_HF_DOWNLOAD_CANCELLED: &str = "LOCAL_AI_HF_DOWNLOAD_CANCELLED";
pub(super) const LOCAL_AI_HF_DOWNLOAD_HASH_MISMATCH: &str = "LOCAL_AI_HF_DOWNLOAD_HASH_MISMATCH";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum SessionControl {
    Running,
    Paused,
    Cancelled,
}

#[derive(Debug, Default)]
struct DownloadManagerState {
    initialized: bool,
    worker_running: bool,
    queue: VecDeque<String>,
    controls: HashMap<String, SessionControl>,
}

static DOWNLOAD_MANAGER: OnceLock<Mutex<DownloadManagerState>> = OnceLock::new();

fn manager() -> &'static Mutex<DownloadManagerState> {
    DOWNLOAD_MANAGER.get_or_init(|| Mutex::new(DownloadManagerState::default()))
}

pub(super) fn manager_initialized() -> bool {
    manager()
        .lock()
        .map(|lock| lock.initialized)
        .unwrap_or(false)
}

pub(super) fn build_install_session_id(model_id: &str) -> String {
    let now_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    format!("install-{}-{now_ms}", slugify_local_model_id(model_id))
}

pub(super) fn guessed_local_model_id(model_id: &str) -> String {
    format!("hf:{}", slugify_local_model_id(model_id))
}

pub(super) fn is_terminal_state(state: &LocalAiDownloadState) -> bool {
    matches!(
        state,
        LocalAiDownloadState::Completed
            | LocalAiDownloadState::Failed
            | LocalAiDownloadState::Cancelled
    )
}

pub(super) fn classify_reason_code(error: &str) -> (String, bool) {
    let code = error
        .split(':')
        .next()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .unwrap_or("LOCAL_AI_HF_DOWNLOAD_FAILED")
        .to_string();
    if code == LOCAL_AI_HF_DOWNLOAD_HASH_MISMATCH
        || code == LOCAL_AI_HF_DOWNLOAD_CANCELLED
        || code == "LOCAL_AI_HF_DOWNLOAD_HTTP_STATUS"
    {
        return (code, false);
    }
    (code, true)
}

fn event_done_success(state: &LocalAiDownloadState) -> (bool, bool) {
    match state {
        LocalAiDownloadState::Completed => (true, true),
        LocalAiDownloadState::Failed | LocalAiDownloadState::Cancelled => (true, false),
        _ => (false, false),
    }
}

pub(super) fn emit_progress_event(app: &AppHandle, record: &LocalAiDownloadSessionRecord) {
    let (done, success) = event_done_success(&record.state);
    let event = LocalAiDownloadProgressEvent {
        install_session_id: record.install_session_id.clone(),
        model_id: record.model_id.clone(),
        local_model_id: Some(record.local_model_id.clone()),
        phase: record.phase.clone(),
        bytes_received: record.bytes_received,
        bytes_total: record.bytes_total,
        speed_bytes_per_sec: record.speed_bytes_per_sec,
        eta_seconds: record.eta_seconds,
        message: record.message.clone(),
        state: record.state.clone(),
        reason_code: record.reason_code.clone(),
        retryable: Some(record.retryable),
        done,
        success,
    };
    if let Err(error) = app.emit(LOCAL_AI_DOWNLOAD_PROGRESS_EVENT, event) {
        eprintln!("LOCAL_AI_DOWNLOAD_PROGRESS_EMIT_FAILED: {error}");
    }
}

pub(super) fn to_summary(record: &LocalAiDownloadSessionRecord) -> LocalAiDownloadSessionSummary {
    LocalAiDownloadSessionSummary {
        install_session_id: record.install_session_id.clone(),
        model_id: record.model_id.clone(),
        local_model_id: record.local_model_id.clone(),
        phase: record.phase.clone(),
        state: record.state.clone(),
        bytes_received: record.bytes_received,
        bytes_total: record.bytes_total,
        speed_bytes_per_sec: record.speed_bytes_per_sec,
        eta_seconds: record.eta_seconds,
        message: record.message.clone(),
        reason_code: record.reason_code.clone(),
        retryable: record.retryable,
        created_at: record.created_at.clone(),
        updated_at: record.updated_at.clone(),
    }
}

pub(super) fn with_state_mut<T>(
    app: &AppHandle,
    op: impl FnOnce(&mut crate::local_runtime::types::LocalAiRuntimeState) -> Result<T, String>,
) -> Result<T, String> {
    let mut state = load_state(app)?;
    let output = op(&mut state)?;
    save_state(app, &state)?;
    Ok(output)
}

pub(super) fn append_audit_non_blocking(
    app: &AppHandle,
    event_type: &str,
    model_id: Option<&str>,
    local_model_id: Option<&str>,
    payload: Option<serde_json::Value>,
) {
    let result = with_state_mut(app, |state| {
        append_audit_event(state, event_type, model_id, local_model_id, payload);
        Ok(())
    });
    if let Err(error) = result {
        eprintln!("LOCAL_AI_AUDIT_WRITE_FAILED: {error}");
    }
}

pub(super) fn update_record(
    app: &AppHandle,
    install_session_id: &str,
    mutate: impl FnOnce(&mut LocalAiDownloadSessionRecord),
) -> Result<LocalAiDownloadSessionRecord, String> {
    with_state_mut(app, |state| {
        let entry = state
            .downloads
            .iter_mut()
            .find(|item| item.install_session_id == install_session_id)
            .ok_or_else(|| {
                format!(
                    "LOCAL_AI_DOWNLOAD_SESSION_NOT_FOUND: installSessionId={install_session_id}"
                )
            })?;
        mutate(entry);
        entry.updated_at = now_iso_timestamp();
        Ok(entry.clone())
    })
}

pub(super) fn update_or_restore_record(
    app: &AppHandle,
    fallback: &LocalAiDownloadSessionRecord,
    mutate: impl FnOnce(&mut LocalAiDownloadSessionRecord),
) -> Result<LocalAiDownloadSessionRecord, String> {
    with_state_mut(app, |state| {
        let index = state
            .downloads
            .iter()
            .position(|item| item.install_session_id == fallback.install_session_id);
        let entry = match index {
            Some(index) => &mut state.downloads[index],
            None => {
                eprintln!(
                    "LOCAL_AI_DOWNLOAD_SESSION_RECOVERED: installSessionId={}",
                    fallback.install_session_id
                );
                state.downloads.push(fallback.clone());
                state
                    .downloads
                    .last_mut()
                    .expect("download session exists after recovery push")
            }
        };
        mutate(entry);
        entry.updated_at = now_iso_timestamp();
        Ok(entry.clone())
    })
}

pub(super) fn find_record(
    app: &AppHandle,
    install_session_id: &str,
) -> Result<LocalAiDownloadSessionRecord, String> {
    let state = load_state(app)?;
    state
        .downloads
        .iter()
        .find(|item| item.install_session_id == install_session_id)
        .cloned()
        .ok_or_else(|| {
            format!("LOCAL_AI_DOWNLOAD_SESSION_NOT_FOUND: installSessionId={install_session_id}")
        })
}

pub(super) fn remove_from_queue(install_session_id: &str) {
    if let Ok(mut lock) = manager().lock() {
        if lock.queue.is_empty() {
            return;
        }
        let mut next = VecDeque::new();
        while let Some(current) = lock.queue.pop_front() {
            if current != install_session_id {
                next.push_back(current);
            }
        }
        lock.queue = next;
    }
}

pub(super) fn cleanup_staging_for_model(app: &AppHandle, model_id: &str) {
    let Ok(models_dir) = runtime_models_dir(app) else {
        return;
    };
    let slug = slugify_local_model_id(model_id);
    let staging_dir = models_dir.join(format!("{slug}-staging"));
    if staging_dir.exists() {
        let _ = std::fs::remove_dir_all(staging_dir);
    }
}

pub(super) fn set_control(install_session_id: &str, control: SessionControl) {
    if let Ok(mut lock) = manager().lock() {
        lock.controls
            .insert(install_session_id.to_string(), control);
    }
}

pub(super) fn get_control(install_session_id: &str) -> SessionControl {
    if let Ok(lock) = manager().lock() {
        if let Some(control) = lock.controls.get(install_session_id).copied() {
            return control;
        }
    }
    SessionControl::Running
}

pub(super) fn take_next_queued_session() -> Option<String> {
    manager()
        .lock()
        .ok()
        .and_then(|mut lock| lock.queue.pop_front())
}

pub(super) fn mark_worker_started() -> bool {
    if let Ok(mut lock) = manager().lock() {
        if !lock.worker_running {
            lock.worker_running = true;
            return true;
        }
    }
    false
}

pub(super) fn mark_worker_stopped() {
    if let Ok(mut lock) = manager().lock() {
        lock.worker_running = false;
    }
}

pub(super) fn recover_manager_state(app: &AppHandle) {
    if let Ok(mut lock) = manager().lock() {
        lock.initialized = true;
        lock.queue.clear();
        lock.controls.clear();
        if let Ok(state) = load_state(app) {
            for session in &state.downloads {
                let control = match session.state {
                    LocalAiDownloadState::Paused => SessionControl::Paused,
                    LocalAiDownloadState::Cancelled => SessionControl::Cancelled,
                    _ => SessionControl::Running,
                };
                lock.controls
                    .insert(session.install_session_id.clone(), control);
            }
        }
    }
}

pub(super) fn queue_session(install_session_id: &str, control: SessionControl) {
    if let Ok(mut lock) = manager().lock() {
        lock.controls
            .insert(install_session_id.to_string(), control);
        lock.queue.push_back(install_session_id.to_string());
    }
}

#[cfg(test)]
mod tests {
    use super::classify_reason_code;

    #[test]
    fn classify_reason_code_marks_non_retryable_failures() {
        let (hash_code, hash_retryable) =
            classify_reason_code("LOCAL_AI_HF_DOWNLOAD_HASH_MISMATCH: bad hash");
        assert_eq!(hash_code, "LOCAL_AI_HF_DOWNLOAD_HASH_MISMATCH");
        assert!(!hash_retryable);

        let (cancel_code, cancel_retryable) =
            classify_reason_code("LOCAL_AI_HF_DOWNLOAD_CANCELLED: cancelled");
        assert_eq!(cancel_code, "LOCAL_AI_HF_DOWNLOAD_CANCELLED");
        assert!(!cancel_retryable);

        let (http_code, http_retryable) =
            classify_reason_code("LOCAL_AI_HF_DOWNLOAD_HTTP_STATUS: status=404");
        assert_eq!(http_code, "LOCAL_AI_HF_DOWNLOAD_HTTP_STATUS");
        assert!(!http_retryable);
    }

    #[test]
    fn classify_reason_code_marks_retryable_failures() {
        let (network_code, network_retryable) =
            classify_reason_code("LOCAL_AI_HF_DOWNLOAD_REQUEST_FAILED: timeout");
        assert_eq!(network_code, "LOCAL_AI_HF_DOWNLOAD_REQUEST_FAILED");
        assert!(network_retryable);
    }
}
