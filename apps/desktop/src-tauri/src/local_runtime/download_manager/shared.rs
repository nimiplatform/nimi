use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

use tauri::{AppHandle, Emitter};

use super::super::store::{load_state, save_state};
use super::super::types::{
    now_iso_timestamp, slugify_local_model_id, LocalAiDownloadProgressEvent,
    LocalAiDownloadSessionRecord, LocalAiDownloadState, LOCAL_AI_DOWNLOAD_PROGRESS_EVENT,
};

pub(super) const LOCAL_AI_HF_DOWNLOAD_INTERRUPTED: &str = "LOCAL_AI_HF_DOWNLOAD_INTERRUPTED";
pub(super) const LOCAL_AI_HF_DOWNLOAD_CANCELLED: &str = "LOCAL_AI_HF_DOWNLOAD_CANCELLED";
pub(super) const LOCAL_AI_HF_DOWNLOAD_HASH_MISMATCH: &str = "LOCAL_AI_HF_DOWNLOAD_HASH_MISMATCH";

#[derive(Debug, Default)]
struct DownloadManagerState {
    initialized: bool,
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
        session_kind: record.session_kind.clone(),
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

pub(super) fn with_state_mut<T>(
    app: &AppHandle,
    op: impl FnOnce(&mut crate::local_runtime::types::LocalAiRuntimeState) -> Result<T, String>,
) -> Result<T, String> {
    let mut state = load_state(app)?;
    let output = op(&mut state)?;
    save_state(app, &state)?;
    Ok(output)
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

pub(super) fn recover_manager_state() {
    if let Ok(mut lock) = manager().lock() {
        lock.initialized = true;
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
