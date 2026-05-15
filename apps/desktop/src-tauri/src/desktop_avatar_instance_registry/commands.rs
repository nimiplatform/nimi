use super::store::list_instances;
use super::types::{
    DesktopAvatarInstanceRegistryLookupPayload, DesktopAvatarInstanceRegistryRecord,
};

#[tauri::command]
pub(crate) fn desktop_avatar_instance_registry_list(
    payload: DesktopAvatarInstanceRegistryLookupPayload,
) -> Result<Vec<DesktopAvatarInstanceRegistryRecord>, String> {
    list_instances(
        payload.owner_user_id.as_deref(),
        payload.realm_agent_id.as_deref(),
        payload.local_agent_ref.as_deref(),
    )
}
