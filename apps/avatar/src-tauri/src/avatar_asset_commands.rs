use nimi_shell_tauri::agent_center_avatar_asset::{
    nimi_avatar_resolve_agent_center_avatar_asset as resolve_agent_center_avatar_asset,
    nimi_avatar_resolve_local_avatar_asset as resolve_local_avatar_asset,
    AgentCenterAvatarAssetResolvePayload, LocalAvatarAssetResolvePayload, ModelManifest,
};

#[tauri::command]
pub(crate) async fn nimi_avatar_resolve_agent_center_avatar_asset(
    payload: AgentCenterAvatarAssetResolvePayload,
) -> Result<ModelManifest, String> {
    resolve_agent_center_avatar_asset(payload).await
}

#[tauri::command]
pub(crate) async fn nimi_avatar_resolve_local_avatar_asset(
    payload: LocalAvatarAssetResolvePayload,
) -> Result<ModelManifest, String> {
    resolve_local_avatar_asset(payload).await
}
