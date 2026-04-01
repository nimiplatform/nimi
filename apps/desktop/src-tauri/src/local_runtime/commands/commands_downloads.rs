fn runtime_local_models_install(
    app: AppHandle,
    payload: LocalAiModelsInstallPayload,
) -> Result<LocalAiInstallAcceptedResponse, String> {
    let default_endpoint = default_runtime_endpoint_for(payload.engine.as_deref());
    let validated_endpoint = validate_loopback_endpoint(
        payload
            .endpoint
            .as_deref()
            .unwrap_or(default_endpoint.as_str()),
    )?;
    let install_request = LocalAiInstallRequest {
        model_id: payload.model_id,
        repo: payload.repo,
        revision: payload.revision,
        capabilities: payload.capabilities,
        engine: payload.engine,
        entry: payload.entry,
        files: payload.files,
        license: payload.license,
        hashes: payload.hashes,
        endpoint: Some(validated_endpoint),
        provider_hints: None,
        engine_config: None,
    };
    run_install_preflight(&app, &install_request)?;
    let accepted = download_manager::enqueue_install(
        &app,
        install_request,
        Some(serde_json::json!({
            "installKind": "manual",
            "templateId": serde_json::Value::Null,
            "fileCount": serde_json::Value::Null,
            "engine": serde_json::Value::Null,
        })),
    )?;
    Ok(LocalAiInstallAcceptedResponse {
        install_session_id: accepted.install_session_id,
        model_id: accepted.model_id,
        local_model_id: accepted.local_model_id,
    })
}

// Unified asset command alias
#[tauri::command]
pub fn runtime_local_assets_install(
    app: AppHandle,
    payload: LocalAiModelsInstallPayload,
) -> Result<LocalAiInstallAcceptedResponse, String> {
    runtime_local_models_install(app, payload)
}

fn validated_install_session_id(payload: &LocalAiDownloadControlPayload) -> Result<String, String> {
    let value = payload.install_session_id.trim();
    if value.is_empty() {
        return Err(
            "LOCAL_AI_DOWNLOAD_SESSION_ID_REQUIRED: installSessionId is required".to_string(),
        );
    }
    Ok(value.to_string())
}

#[tauri::command]
pub fn runtime_local_downloads_list(
    app: AppHandle,
) -> Result<Vec<LocalAiDownloadSessionSummary>, String> {
    download_manager::list_download_sessions(&app)
}

#[tauri::command]
pub fn runtime_local_downloads_pause(
    app: AppHandle,
    payload: LocalAiDownloadControlPayload,
) -> Result<LocalAiDownloadSessionSummary, String> {
    let install_session_id = validated_install_session_id(&payload)?;
    download_manager::pause_download(&app, install_session_id.as_str())
}

#[tauri::command]
pub fn runtime_local_downloads_resume(
    app: AppHandle,
    payload: LocalAiDownloadControlPayload,
) -> Result<LocalAiDownloadSessionSummary, String> {
    let install_session_id = validated_install_session_id(&payload)?;
    download_manager::resume_download(&app, install_session_id.as_str())
}

#[tauri::command]
pub fn runtime_local_downloads_cancel(
    app: AppHandle,
    payload: LocalAiDownloadControlPayload,
) -> Result<LocalAiDownloadSessionSummary, String> {
    let install_session_id = validated_install_session_id(&payload)?;
    download_manager::cancel_download(&app, install_session_id.as_str())
}
