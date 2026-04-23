use super::store::list_instances;
use super::types::{
    DesktopAvatarInstanceRegistryLookupPayload, DesktopAvatarInstanceRegistryRecord,
};

#[tauri::command]
pub(crate) fn desktop_avatar_instance_registry_list(
    payload: DesktopAvatarInstanceRegistryLookupPayload,
) -> Result<Vec<DesktopAvatarInstanceRegistryRecord>, String> {
    list_instances(payload.agent_id.as_deref())
}
