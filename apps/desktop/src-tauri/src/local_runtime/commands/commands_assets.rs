#[tauri::command]
pub fn runtime_local_assets_install_verified(
    _app: AppHandle,
    payload: serde_json::Value,
) -> Result<LocalAiAssetRecord, String> {
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
        .filter(|value| !value.is_empty());
    runtime_install_verified_asset_via_runtime(template_id.as_str(), endpoint)
}

#[tauri::command]
pub fn runtime_local_assets_import(
    app: AppHandle,
    payload: serde_json::Value,
) -> Result<LocalAiAssetRecord, String> {
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
        .filter(|value| !value.is_empty());
    let engine_config = payload.get("engineConfig");
    let models_root = runtime_models_dir(&app)?;
    let path = validate_import_asset_manifest_path(&manifest_path, models_root.as_path())?;
    runtime_import_manifest_via_runtime(path.as_path(), endpoint, engine_config)
}
