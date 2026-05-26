fn append_app_audit_event(
    app: &AppHandle,
    event_type: &str,
    model_id: Option<&str>,
    local_model_id: Option<&str>,
    payload: Option<serde_json::Value>,
) -> Result<(), String> {
    validate_audit_payload_contract(event_type, &payload)?;
    let mut state = load_state(app)?;
    append_audit_event(&mut state, event_type, model_id, local_model_id, payload);
    save_state(app, &state)
}

fn append_app_audit_event_non_blocking(
    app: &AppHandle,
    event_type: &str,
    model_id: Option<&str>,
    local_model_id: Option<&str>,
    payload: Option<serde_json::Value>,
) {
    if let Err(error) = append_app_audit_event(app, event_type, model_id, local_model_id, payload) {
        eprintln!("LOCAL_AI_AUDIT_WRITE_FAILED: {error}");
    }
}

fn emit_download_progress_event(app: &AppHandle, event: LocalAiDownloadProgressEvent) {
    if let Err(error) = app.emit(LOCAL_AI_DOWNLOAD_PROGRESS_EVENT, &event) {
        eprintln!("LOCAL_AI_DOWNLOAD_PROGRESS_EMIT_FAILED: {error}");
    }
}
