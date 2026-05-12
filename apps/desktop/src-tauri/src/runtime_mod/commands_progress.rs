use chrono::Utc;
use tauri::AppHandle;

use super::store::{
    emit_runtime_mod_install_progress, RuntimeModInstallAcceptedPayload,
    RuntimeModInstallProgressPayload,
};

pub(super) fn now_rfc3339() -> String {
    Utc::now().to_rfc3339()
}

pub(super) fn accepted_runtime_mod_install(
    install_session_id: String,
    operation: &str,
    source_kind: &str,
    mod_id: Option<String>,
    package_id: Option<String>,
) -> RuntimeModInstallAcceptedPayload {
    RuntimeModInstallAcceptedPayload {
        install_session_id,
        operation: operation.to_string(),
        mod_id,
        package_id,
        source_kind: source_kind.to_string(),
    }
}

pub(super) fn emit_runtime_mod_queued(
    app: &AppHandle,
    accepted: &RuntimeModInstallAcceptedPayload,
    message: &str,
) -> Result<(), String> {
    emit_runtime_mod_install_progress(
        app,
        RuntimeModInstallProgressPayload {
            install_session_id: accepted.install_session_id.clone(),
            operation: accepted.operation.clone(),
            source_kind: accepted.source_kind.clone(),
            phase: "queued".to_string(),
            status: "queued".to_string(),
            occurred_at: now_rfc3339(),
            mod_id: accepted
                .mod_id
                .clone()
                .or_else(|| accepted.package_id.clone()),
            manifest_path: None,
            installed_path: None,
            progress_percent: Some(0.0),
            message: Some(message.to_string()),
            error: None,
            install: None,
            catalog_install: None,
            restored_manifest: None,
        },
    )
}

pub(super) fn emit_runtime_mod_failed(
    app: &AppHandle,
    accepted: &RuntimeModInstallAcceptedPayload,
    error: String,
) {
    let _ = emit_runtime_mod_install_progress(
        app,
        RuntimeModInstallProgressPayload {
            install_session_id: accepted.install_session_id.clone(),
            operation: accepted.operation.clone(),
            source_kind: accepted.source_kind.clone(),
            phase: "complete".to_string(),
            status: "failed".to_string(),
            occurred_at: now_rfc3339(),
            mod_id: accepted
                .mod_id
                .clone()
                .or_else(|| accepted.package_id.clone()),
            manifest_path: None,
            installed_path: None,
            progress_percent: None,
            message: Some("runtime mod background operation failed".to_string()),
            error: Some(error),
            install: None,
            catalog_install: None,
            restored_manifest: None,
        },
    );
}
