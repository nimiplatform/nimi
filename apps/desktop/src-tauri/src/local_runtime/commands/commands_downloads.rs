#[tauri::command]
pub fn runtime_local_models_install(
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

#[tauri::command]
pub fn runtime_local_models_install_verified(
    app: AppHandle,
    payload: LocalAiModelsInstallVerifiedPayload,
) -> Result<LocalAiInstallAcceptedResponse, String> {
    let template_id = payload.template_id.trim();
    if template_id.is_empty() {
        return Err("LOCAL_AI_VERIFIED_TEMPLATE_REQUIRED: templateId is required".to_string());
    }
    let descriptor = find_verified_model(template_id)
        .ok_or_else(|| format!("LOCAL_AI_VERIFIED_TEMPLATE_NOT_FOUND: templateId={template_id}"))?;
    let endpoint = validate_loopback_endpoint(
        payload
            .endpoint
            .as_deref()
            .unwrap_or(descriptor.endpoint.as_str()),
    )?;
    let install_request = LocalAiInstallRequest {
        model_id: descriptor.model_id.clone(),
        repo: descriptor.repo.clone(),
        revision: Some(descriptor.revision.clone()),
        capabilities: Some(descriptor.capabilities.clone()),
        engine: Some(descriptor.engine.clone()),
        entry: Some(descriptor.entry.clone()),
        files: Some(descriptor.files.clone()),
        license: Some(descriptor.license.clone()),
        hashes: Some(descriptor.hashes.clone()),
        endpoint: Some(endpoint),
        provider_hints: None,
        engine_config: descriptor.engine_config.clone(),
    };
    run_install_preflight(&app, &install_request)?;
    let accepted = download_manager::enqueue_install(
        &app,
        install_request,
        Some(serde_json::json!({
            "templateId": descriptor.template_id,
            "installKind": descriptor.install_kind,
            "fileCount": descriptor.file_count,
            "engine": descriptor.engine,
        })),
    )?;
    Ok(LocalAiInstallAcceptedResponse {
        install_session_id: accepted.install_session_id,
        model_id: accepted.model_id,
        local_model_id: accepted.local_model_id,
    })
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
