use std::collections::{HashMap, VecDeque};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::{AppHandle, Emitter};

use super::audit::{
    append_audit_event, EVENT_MODEL_DOWNLOAD_CANCELLED, EVENT_MODEL_DOWNLOAD_COMPLETED,
    EVENT_MODEL_DOWNLOAD_FAILED, EVENT_MODEL_DOWNLOAD_INTERRUPTED, EVENT_MODEL_DOWNLOAD_PAUSED,
    EVENT_MODEL_DOWNLOAD_RESUMED, EVENT_MODEL_DOWNLOAD_STARTED,
};
use super::hf_source::{install_from_hf_with_control, HfDownloadControl, HfDownloadProgress};
use super::model_registry::upsert_model;
use super::store::{load_state, runtime_models_dir, save_state};
use super::types::{
    now_iso_timestamp, slugify_local_model_id, LocalAiDownloadProgressEvent,
    LocalAiDownloadSessionRecord, LocalAiDownloadSessionSummary, LocalAiDownloadState,
    LocalAiInstallRequest, LOCAL_AI_DOWNLOAD_PROGRESS_EVENT,
};

const LOCAL_AI_HF_DOWNLOAD_INTERRUPTED: &str = "LOCAL_AI_HF_DOWNLOAD_INTERRUPTED";
const LOCAL_AI_HF_DOWNLOAD_PAUSED: &str = "LOCAL_AI_HF_DOWNLOAD_PAUSED";
const LOCAL_AI_HF_DOWNLOAD_CANCELLED: &str = "LOCAL_AI_HF_DOWNLOAD_CANCELLED";
const LOCAL_AI_HF_DOWNLOAD_HASH_MISMATCH: &str = "LOCAL_AI_HF_DOWNLOAD_HASH_MISMATCH";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadEnqueueAccepted {
    pub install_session_id: String,
    pub model_id: String,
    pub local_model_id: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SessionControl {
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

fn build_install_session_id(model_id: &str) -> String {
    let now_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    format!("install-{}-{now_ms}", slugify_local_model_id(model_id))
}

fn guessed_local_model_id(model_id: &str) -> String {
    format!("hf:{}", slugify_local_model_id(model_id))
}

fn is_terminal_state(state: &LocalAiDownloadState) -> bool {
    matches!(
        state,
        LocalAiDownloadState::Completed
            | LocalAiDownloadState::Failed
            | LocalAiDownloadState::Cancelled
    )
}

fn classify_reason_code(error: &str) -> (String, bool) {
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

fn emit_progress_event(app: &AppHandle, record: &LocalAiDownloadSessionRecord) {
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

fn to_summary(record: &LocalAiDownloadSessionRecord) -> LocalAiDownloadSessionSummary {
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

fn with_state_mut<T>(
    app: &AppHandle,
    op: impl FnOnce(&mut super::types::LocalAiRuntimeState) -> Result<T, String>,
) -> Result<T, String> {
    let mut state = load_state(app)?;
    let output = op(&mut state)?;
    save_state(app, &state)?;
    Ok(output)
}

fn append_audit_non_blocking(
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

fn update_record(
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

fn update_or_restore_record(
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

fn find_record(
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

fn remove_from_queue(queue: &mut VecDeque<String>, install_session_id: &str) {
    if queue.is_empty() {
        return;
    }
    let mut next = VecDeque::new();
    while let Some(current) = queue.pop_front() {
        if current != install_session_id {
            next.push_back(current);
        }
    }
    *queue = next;
}

fn cleanup_staging_for_model(app: &AppHandle, model_id: &str) {
    let Ok(models_dir) = runtime_models_dir(app) else {
        return;
    };
    let slug = slugify_local_model_id(model_id);
    let staging_dir = models_dir.join(format!("{slug}-staging"));
    if staging_dir.exists() {
        let _ = std::fs::remove_dir_all(staging_dir);
    }
}

fn set_control(install_session_id: &str, control: SessionControl) {
    if let Ok(mut lock) = manager().lock() {
        lock.controls
            .insert(install_session_id.to_string(), control);
    }
}

fn get_control(install_session_id: &str) -> SessionControl {
    if let Ok(lock) = manager().lock() {
        if let Some(control) = lock.controls.get(install_session_id).copied() {
            return control;
        }
    }
    SessionControl::Running
}

fn take_next_queued_session() -> Option<String> {
    if let Ok(mut lock) = manager().lock() {
        while let Some(session_id) = lock.queue.pop_front() {
            return Some(session_id);
        }
    }
    None
}

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

fn start_worker_if_needed(app: &AppHandle) {
    let mut should_start = false;
    if let Ok(mut lock) = manager().lock() {
        if !lock.worker_running {
            lock.worker_running = true;
            should_start = true;
        }
    }
    if !should_start {
        return;
    }
    let app = app.clone();
    std::thread::spawn(move || loop {
        let Some(session_id) = take_next_queued_session() else {
            if let Ok(mut lock) = manager().lock() {
                lock.worker_running = false;
            }
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

pub fn ensure_initialized(app: &AppHandle) -> Result<(), String> {
    let mut should_recover = false;
    if let Ok(lock) = manager().lock() {
        if !lock.initialized {
            should_recover = true;
        }
    }
    if !should_recover {
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

    if let Ok(mut lock) = manager().lock() {
        lock.controls
            .insert(install_session_id.clone(), SessionControl::Running);
        lock.queue.push_back(install_session_id.clone());
    }
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
    if let Ok(mut lock) = manager().lock() {
        remove_from_queue(&mut lock.queue, install_session_id);
    }
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
    if let Ok(mut lock) = manager().lock() {
        remove_from_queue(&mut lock.queue, install_session_id);
        lock.queue.push_back(install_session_id.to_string());
    }
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
    if let Ok(mut lock) = manager().lock() {
        remove_from_queue(&mut lock.queue, install_session_id);
    }
    let updated = update_record(app, install_session_id, |entry| {
        entry.state = LocalAiDownloadState::Cancelled;
        entry.reason_code = Some(LOCAL_AI_HF_DOWNLOAD_CANCELLED.to_string());
        entry.retryable = false;
        entry.message = Some("download cancelled".to_string());
    })?;
    cleanup_staging_for_model(app, updated.model_id.as_str());
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
