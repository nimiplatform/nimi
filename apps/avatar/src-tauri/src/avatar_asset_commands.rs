use nimi_shell_tauri::capabilities::avatar::{
    nimi_avatar_resolve_agent_center_avatar_asset as resolve_agent_center_avatar_asset,
    AgentCenterAvatarAssetResolvePayload, AgentCenterAvatarAssetResolveResult,
};
use nimi_shell_tauri::capabilities::runtime::RuntimeBridgeLocalAppHost;

#[tauri::command]
pub(crate) async fn nimi_avatar_resolve_agent_center_avatar_asset(
    host: tauri::State<'_, RuntimeBridgeLocalAppHost>,
    payload: AgentCenterAvatarAssetResolvePayload,
) -> Result<AgentCenterAvatarAssetResolveResult, String> {
    resolve_agent_center_avatar_asset(host.inner(), payload).await
}
