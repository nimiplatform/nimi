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
