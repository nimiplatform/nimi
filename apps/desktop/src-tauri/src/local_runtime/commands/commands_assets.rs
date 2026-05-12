#[tauri::command]
pub fn runtime_local_assets_install_verified(
    app: AppHandle,
    payload: serde_json::Value,
) -> Result<LocalAiInstallAcceptedResponse, String> {
    let template_id = payload
        .get("templateId")
        .and_then(|value| value.as_str())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "LOCAL_AI_VERIFIED_ASSET_TEMPLATE_REQUIRED: templateId is required".to_string())?;
    let endpoint = payload
        .get("endpoint")
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.to_string());
    let model_id = format!("verified:{template_id}");
    let local_model_id = format!("pending:{}", slugify_local_model_id(model_id.as_str()));
    let accepted = download_manager::enqueue_background_import_task(
        &app,
        model_id.as_str(),
        local_model_id.as_str(),
        "install",
        "queued verified asset install",
        move |app, install_session_id, _model_id, _local_model_id, cancel_token| {
            if cancel_token.throw_if_cancelled().is_err() {
                return;
            }
            match runtime_install_verified_asset_via_runtime(template_id.as_str(), endpoint.as_deref()) {
                Ok(asset) => download_manager::complete_background_import_task(
                    &app,
                    install_session_id.as_str(),
                    asset.asset_id.as_str(),
                    asset.local_asset_id.as_str(),
                    "verified asset install completed",
                ),
                Err(error) => download_manager::fail_background_import_task(
                    &app,
                    install_session_id.as_str(),
                    error,
                    false,
                ),
            }
        },
    )?;
    Ok(LocalAiInstallAcceptedResponse {
        install_session_id: accepted.install_session_id,
        model_id: accepted.model_id,
        local_model_id: accepted.local_model_id,
    })
}

#[tauri::command]
pub fn runtime_local_assets_import(
    app: AppHandle,
    payload: serde_json::Value,
) -> Result<LocalAiInstallAcceptedResponse, String> {
    let manifest_path = payload
        .get("manifestPath")
        .and_then(|value| value.as_str())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "LOCAL_AI_IMPORT_ASSET_MANIFEST_PATH_REQUIRED: manifestPath is required".to_string())?;
    let endpoint = payload
        .get("endpoint")
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.to_string());
    let engine_config = payload.get("engineConfig").cloned();
    let raw_path = std::path::PathBuf::from(manifest_path.as_str());
    let model_id = raw_path
        .parent()
        .and_then(|value| value.file_name())
        .and_then(|value| value.to_str())
        .map(|value| format!("manifest:{value}"))
        .unwrap_or_else(|| "manifest:asset".to_string());
    let local_model_id = format!("pending:{}", slugify_local_model_id(model_id.as_str()));
    let accepted = download_manager::enqueue_background_import_task(
        &app,
        model_id.as_str(),
        local_model_id.as_str(),
        "import",
        "queued manifest import",
        move |app, install_session_id, _model_id, _local_model_id, cancel_token| {
            if cancel_token.throw_if_cancelled().is_err() {
                return;
            }
            let path = match runtime_models_dir(&app)
                .and_then(|models_root| {
                    validate_import_asset_manifest_path(
                        manifest_path.as_str(),
                        models_root.as_path(),
                    )
                }) {
                Ok(path) => path,
                Err(error) => {
                    download_manager::fail_background_import_task(
                        &app,
                        install_session_id.as_str(),
                        error,
                        false,
                    );
                    return;
                }
            };
            if cancel_token.throw_if_cancelled().is_err() {
                return;
            }
            match runtime_import_manifest_via_runtime(
                path.as_path(),
                endpoint.as_deref(),
                engine_config.as_ref(),
            ) {
                Ok(asset) => download_manager::complete_background_import_task(
                    &app,
                    install_session_id.as_str(),
                    asset.asset_id.as_str(),
                    asset.local_asset_id.as_str(),
                    "manifest import completed",
                ),
                Err(error) => download_manager::fail_background_import_task(
                    &app,
                    install_session_id.as_str(),
                    error,
                    false,
                ),
            }
        },
    )?;
    Ok(LocalAiInstallAcceptedResponse {
        install_session_id: accepted.install_session_id,
        model_id: accepted.model_id,
        local_model_id: accepted.local_model_id,
    })
}
