use super::*;

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
