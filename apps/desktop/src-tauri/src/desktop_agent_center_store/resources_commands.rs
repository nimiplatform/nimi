use super::*;

#[tauri::command]
pub(crate) fn desktop_agent_center_avatar_asset_pick_live2d_source(
) -> Result<Option<String>, String> {
    let start_dir = dirs::home_dir()
        .or_else(|| crate::desktop_paths::resolve_nimi_data_dir().ok())
        .unwrap_or_else(env::temp_dir);
    let selected = rfd::FileDialog::new()
        .set_directory(&start_dir)
        .set_title("Select Live2D folder")
        .pick_folder();
    Ok(selected.map(|path| path.to_string_lossy().to_string()))
}

#[tauri::command]
pub(crate) fn desktop_agent_center_avatar_asset_pick_vrm_source() -> Result<Option<String>, String>
{
    let start_dir = dirs::home_dir()
        .or_else(|| crate::desktop_paths::resolve_nimi_data_dir().ok())
        .unwrap_or_else(env::temp_dir);
    let selected = rfd::FileDialog::new()
        .set_directory(&start_dir)
        .set_title("Select VRM file")
        .add_filter("VRM", &["vrm"])
        .add_filter("All Files", &["*"])
        .pick_file();
    Ok(selected.map(|path| path.to_string_lossy().to_string()))
}

#[tauri::command]
pub(crate) async fn desktop_agent_center_avatar_asset_import(
    payload: DesktopAgentCenterAvatarAssetImportPayload,
) -> Result<DesktopAgentCenterAvatarAssetImportResult, String> {
    let account_id = crate::desktop_agent_center_store::active_agent_center_account_id().await?;
    let mut payload = payload;
    payload.account_id = account_id;
    run_agent_center_resource_blocking("desktop_agent_center_avatar_asset_import", move || {
        desktop_agent_center_avatar_asset_import_blocking(payload)
    })
    .await
}

#[tauri::command]
pub(crate) async fn desktop_agent_center_background_import(
    payload: DesktopAgentCenterBackgroundImportPayload,
) -> Result<DesktopAgentCenterBackgroundImportResult, String> {
    let account_id = crate::desktop_agent_center_store::active_agent_center_account_id().await?;
    let mut payload = payload;
    payload.account_id = account_id;
    run_agent_center_resource_blocking("desktop_agent_center_background_import", move || {
        desktop_agent_center_background_import_blocking(payload)
    })
    .await
}

#[tauri::command]
pub(crate) async fn desktop_agent_center_live2d_adapter_manifest_import(
    payload: DesktopAgentCenterLive2dAdapterManifestImportPayload,
) -> Result<DesktopAgentCenterLive2dAdapterManifestImportResult, String> {
    let account_id = crate::desktop_agent_center_store::active_agent_center_account_id().await?;
    let mut payload = payload;
    payload.account_id = account_id;
    run_agent_center_resource_blocking(
        "desktop_agent_center_live2d_adapter_manifest_import",
        move || desktop_agent_center_live2d_adapter_manifest_import_blocking(payload),
    )
    .await
}
