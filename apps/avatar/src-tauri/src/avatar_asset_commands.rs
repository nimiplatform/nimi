use nimi_shell_tauri::capabilities::avatar::{
    nimi_avatar_resolve_agent_center_avatar_asset as resolve_agent_center_avatar_asset,
    AgentCenterAvatarAssetResolvePayload, AgentCenterAvatarAssetResolveResult,
};

#[tauri::command]
pub(crate) async fn nimi_avatar_resolve_agent_center_avatar_asset(
    payload: AgentCenterAvatarAssetResolvePayload,
) -> Result<AgentCenterAvatarAssetResolveResult, String> {
    resolve_agent_center_avatar_asset(payload).await
}
