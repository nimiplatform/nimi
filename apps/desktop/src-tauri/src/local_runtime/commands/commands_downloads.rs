fn runtime_local_assets_install_impl(
    app: AppHandle,
    payload: LocalAiAssetsInstallPayload,
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
    payload: LocalAiAssetsInstallPayload,
) -> Result<LocalAiInstallAcceptedResponse, String> {
    runtime_local_assets_install_impl(app, payload)
}
