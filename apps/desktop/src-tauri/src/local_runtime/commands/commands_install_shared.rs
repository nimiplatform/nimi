fn merge_json_object(
    base: serde_json::Value,
    extension: Option<serde_json::Value>,
) -> serde_json::Value {
    let mut output = match base {
        serde_json::Value::Object(object) => object,
        _ => serde_json::Map::<String, serde_json::Value>::new(),
    };
    if let Some(serde_json::Value::Object(extra)) = extension {
        for (key, value) in extra {
            output.insert(key, value);
        }
    }
    serde_json::Value::Object(output)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAiInstallAcceptedResponse {
    pub install_session_id: String,
    pub model_id: String,
    pub local_model_id: String,
}

/// Blocking version used by dependency-apply which needs synchronous install + upsert
/// to coordinate multi-dependency installs before starting services.
fn execute_hf_install_blocking(
    app: &AppHandle,
    install_request: LocalAiInstallRequest,
    install_metadata: Option<serde_json::Value>,
) -> Result<LocalAiModelRecord, String> {
    let install_session_id = next_install_session_id(install_request.model_id.as_str());
    let install_model_id = install_request.model_id.clone();
    let guessed_local_model_id =
        format!("hf:{}", slugify_local_model_id(install_model_id.as_str()));

    if let Err(error) = run_install_preflight(app, &install_request) {
        let reason_code = extract_reason_code(error.as_str());
        emit_download_progress_event(
            app,
            LocalAiDownloadProgressEvent {
                install_session_id: install_session_id.clone(),
                model_id: install_model_id.clone(),
                local_model_id: Some(guessed_local_model_id.clone()),
                session_kind: LocalAiTransferSessionKind::Download,
                phase: "preflight".to_string(),
                bytes_received: 0,
                bytes_total: Some(0),
                speed_bytes_per_sec: None,
                eta_seconds: Some(0.0),
                message: Some(error.clone()),
                state: LocalAiDownloadState::Failed,
                reason_code: Some(reason_code.clone()),
                retryable: Some(false),
                done: true,
                success: false,
            },
        );
        append_app_audit_event_non_blocking(
            app,
            EVENT_MODEL_DOWNLOAD_FAILED,
            Some(install_request.model_id.as_str()),
            None,
            Some(merge_json_object(
                serde_json::json!({
                    "phase": "preflight",
                    "reasonCode": reason_code,
                    "error": error,
                }),
                install_metadata.clone(),
            )),
        );
        return Err(error);
    }

    append_app_audit_event_non_blocking(
        app,
        EVENT_MODEL_DOWNLOAD_STARTED,
        Some(install_request.model_id.as_str()),
        None,
        Some(merge_json_object(
            serde_json::json!({
            "repo": install_request.repo,
            "revision": install_request.revision,
            "endpoint": install_request.endpoint,
            }),
            install_metadata.clone(),
        )),
    );

    let mut latest_phase = "download".to_string();
    let mut latest_bytes_received = 0_u64;
    let mut latest_bytes_total: Option<u64> = None;
    emit_download_progress_event(
        app,
        LocalAiDownloadProgressEvent {
            install_session_id: install_session_id.clone(),
            model_id: install_model_id.clone(),
            local_model_id: Some(guessed_local_model_id.clone()),
            session_kind: LocalAiTransferSessionKind::Download,
            phase: latest_phase.clone(),
            bytes_received: latest_bytes_received,
            bytes_total: latest_bytes_total,
            speed_bytes_per_sec: None,
            eta_seconds: None,
            message: Some("starting model install".to_string()),
            state: LocalAiDownloadState::Running,
            reason_code: None,
            retryable: Some(true),
            done: false,
            success: false,
        },
    );

    let mut on_progress = |progress: HfDownloadProgress| {
        latest_phase = progress.phase.clone();
        latest_bytes_received = progress.bytes_received;
        latest_bytes_total = progress.bytes_total;
        emit_download_progress_event(
            app,
            LocalAiDownloadProgressEvent {
                install_session_id: install_session_id.clone(),
                model_id: install_model_id.clone(),
                local_model_id: Some(guessed_local_model_id.clone()),
                session_kind: LocalAiTransferSessionKind::Download,
                phase: progress.phase,
                bytes_received: progress.bytes_received,
                bytes_total: progress.bytes_total,
                speed_bytes_per_sec: progress.speed_bytes_per_sec,
                eta_seconds: progress.eta_seconds,
                message: progress.message,
                state: LocalAiDownloadState::Running,
                reason_code: None,
                retryable: Some(true),
                done: false,
                success: false,
            },
        );
    };

    match install_from_hf(app, &install_request, &mut on_progress) {
        Ok(model) => {
            let saved = upsert_model(app, model)?;
            emit_download_progress_event(
                app,
                LocalAiDownloadProgressEvent {
                    install_session_id: install_session_id.clone(),
                    model_id: saved.model_id.clone(),
                    local_model_id: Some(saved.local_model_id.clone()),
                    session_kind: LocalAiTransferSessionKind::Download,
                    phase: "verify".to_string(),
                    bytes_received: latest_bytes_received,
                    bytes_total: latest_bytes_total,
                    speed_bytes_per_sec: None,
                    eta_seconds: Some(0.0),
                    message: Some("installation completed".to_string()),
                    state: LocalAiDownloadState::Completed,
                    reason_code: None,
                    retryable: Some(false),
                    done: true,
                    success: true,
                },
            );
            append_app_audit_event_non_blocking(
                app,
                EVENT_MODEL_DOWNLOAD_COMPLETED,
                Some(saved.model_id.as_str()),
                Some(saved.local_model_id.as_str()),
                Some(merge_json_object(
                    serde_json::json!({
                        "engine": saved.engine,
                        "source": "huggingface",
                    }),
                    install_metadata.clone(),
                )),
            );
            append_app_audit_event_non_blocking(
                app,
                EVENT_MODEL_IMPORT_VALIDATED,
                Some(saved.model_id.as_str()),
                Some(saved.local_model_id.as_str()),
                None,
            );
            Ok(saved)
        }
        Err(error) => {
            let reason_code = extract_reason_code(error.as_str());
            let retryable = reason_code != "LOCAL_AI_HF_DOWNLOAD_HASH_MISMATCH";
            emit_download_progress_event(
                app,
                LocalAiDownloadProgressEvent {
                    install_session_id: install_session_id.clone(),
                    model_id: install_model_id.clone(),
                    local_model_id: Some(guessed_local_model_id.clone()),
                    session_kind: LocalAiTransferSessionKind::Download,
                    phase: latest_phase.clone(),
                    bytes_received: latest_bytes_received,
                    bytes_total: latest_bytes_total,
                    speed_bytes_per_sec: None,
                    eta_seconds: None,
                    message: Some(error.clone()),
                    state: LocalAiDownloadState::Failed,
                    reason_code: Some(reason_code.clone()),
                    retryable: Some(retryable),
                    done: true,
                    success: false,
                },
            );
            append_app_audit_event_non_blocking(
                app,
                EVENT_MODEL_DOWNLOAD_FAILED,
                Some(install_request.model_id.as_str()),
                None,
                Some(merge_json_object(
                    serde_json::json!({
                        "error": error,
                    }),
                    install_metadata.clone(),
                )),
            );
            Err(error)
        }
    }
}
