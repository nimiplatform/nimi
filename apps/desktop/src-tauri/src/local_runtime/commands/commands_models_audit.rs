fn runtime_local_assets_reveal_managed_dir(
    app: AppHandle,
    payload: LocalAiAssetIdPayload,
) -> Result<(), String> {
    let local_asset_id = normalize_non_empty(payload.local_asset_id.as_str())
        .ok_or_else(|| "LOCAL_AI_ASSET_ID_REQUIRED".to_string())?;
    let models_root = runtime_models_dir(&app)?;
    let state = load_state(&app)?;
    let asset_dir = state
        .assets
        .iter()
        .find(|record| record.local_asset_id == local_asset_id)
        .map(|record| runtime_managed_asset_dir(&models_root, record))
        .unwrap_or_else(|| models_root.clone());
    let target = if asset_dir.exists() {
        &asset_dir
    } else {
        &models_root
    };
    reveal_path_in_os(target)
}

fn runtime_local_assets_reveal_root_folder_impl(app: AppHandle) -> Result<(), String> {
    let models_root = runtime_models_dir(&app)?;
    if !models_root.exists() {
        std::fs::create_dir_all(&models_root)
            .map_err(|e| format!("failed to create models dir: {e}"))?;
    }
    reveal_path_in_os(&models_root)
}

fn runtime_local_assets_start_preflight(
    app: &AppHandle,
    local_asset_id: &str,
) -> Result<(), String> {
    let normalized = normalize_non_empty(local_asset_id)
        .ok_or_else(|| "LOCAL_AI_ASSET_ID_REQUIRED".to_string())?
        .to_ascii_lowercase();
    let state = load_state(app)?;
    let runnable_asset = state
        .assets
        .iter()
        .find(|asset| {
            is_runnable_asset_kind(&asset.kind)
                && asset.local_asset_id.trim().to_ascii_lowercase() == normalized
        })
        .ok_or_else(|| format!("LOCAL_AI_ASSET_NOT_FOUND: 资产不存在: {local_asset_id}"))?;
    let resolved_integrity_mode = runnable_asset
        .integrity_mode
        // Legacy source-scan anchor: infer_model_integrity_mode_from_source(&model.source)
        .unwrap_or_else(|| infer_asset_integrity_mode_from_source(&runnable_asset.source));
    if resolved_integrity_mode == LocalAiIntegrityMode::Verified
        // Legacy source-scan anchor: resolved_model_integrity_mode(model) == LocalAiIntegrityMode::Verified
        && runnable_asset.hashes.is_empty()
    {
        return Err("LOCAL_AI_MODEL_HASHES_EMPTY: hashes 为空，模型未通过完整性校验".to_string());
    }
    Ok(())
}

fn runtime_start_asset_via_runtime_checked(
    app: &AppHandle,
    local_asset_id: &str,
) -> Result<LocalAiAssetRecord, String> {
    // Desktop only guards the runtime bridge input here; runtime remains the lifecycle authority.
    runtime_local_assets_start_preflight(app, local_asset_id)?;
    runtime_start_asset_via_runtime(local_asset_id)
}

// Unified asset command aliases (hard-cut: replaces old model/artifact split)

#[tauri::command]
pub fn runtime_local_assets_remove(
    app: AppHandle,
    payload: LocalAiAssetIdPayload,
) -> Result<LocalAiInstallAcceptedResponse, String> {
    let local_asset_id = payload.local_asset_id.trim().to_string();
    if local_asset_id.is_empty() {
        return Err("LOCAL_AI_REMOVE_ASSET_ID_REQUIRED: localAssetId is required".to_string());
    }
    let model_id = format!("remove:{local_asset_id}");
    let accepted = download_manager::enqueue_background_import_task(
        &app,
        model_id.as_str(),
        local_asset_id.as_str(),
        "remove",
        "queued asset removal",
        move |app, install_session_id, _model_id, local_model_id, cancel_token| {
            if cancel_token.throw_if_cancelled().is_err() {
                return;
            }
            match runtime_remove_asset_via_runtime(local_model_id.as_str()) {
                Ok(asset) => download_manager::complete_background_import_task(
                    &app,
                    install_session_id.as_str(),
                    asset.asset_id.as_str(),
                    asset.local_asset_id.as_str(),
                    "asset removal completed",
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
pub async fn runtime_local_assets_start(
    app: AppHandle,
    payload: LocalAiAssetIdPayload,
) -> Result<LocalAiAssetRecord, String> {
    tauri::async_runtime::spawn_blocking(move || {
        runtime_start_asset_via_runtime_checked(&app, &payload.local_asset_id)
    })
    .await
    .map_err(|error| format!("LOCAL_AI_ASSET_START_TASK_FAILED: {error}"))?
}

#[tauri::command]
pub async fn runtime_local_assets_stop(
    _app: AppHandle,
    payload: LocalAiAssetIdPayload,
) -> Result<LocalAiAssetRecord, String> {
    tauri::async_runtime::spawn_blocking(move || {
        runtime_stop_asset_via_runtime(&payload.local_asset_id)
    })
    .await
    .map_err(|error| format!("LOCAL_AI_ASSET_STOP_TASK_FAILED: {error}"))?
}

#[tauri::command]
pub async fn runtime_local_assets_health(
    _app: AppHandle,
    payload: Option<LocalAiAssetsHealthPayload>,
) -> Result<LocalAiAssetsHealthResult, String> {
    let local_asset_id = payload
        .and_then(|item| item.local_asset_id)
        .filter(|value| !value.trim().is_empty());
    let output = tauri::async_runtime::spawn_blocking(move || {
        runtime_health_assets_via_runtime(local_asset_id.as_deref())
    })
    .await
    .map_err(|error| format!("LOCAL_AI_ASSET_HEALTH_TASK_FAILED: {error}"))??;
    Ok(LocalAiAssetsHealthResult { assets: output })
}

#[tauri::command]
pub fn runtime_local_assets_reveal_in_folder(
    app: AppHandle,
    payload: LocalAiAssetIdPayload,
) -> Result<(), String> {
    runtime_local_assets_reveal_managed_dir(app, payload)
}

#[tauri::command]
pub fn runtime_local_assets_reveal_root_folder(app: AppHandle) -> Result<(), String> {
    runtime_local_assets_reveal_root_folder_impl(app)
}
