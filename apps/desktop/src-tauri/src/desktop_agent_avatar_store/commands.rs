use super::db::{
    clear_binding, delete_resource, get_binding, import_live2d, import_vrm, list_resources, open_db,
    read_resource_asset, set_binding,
};
use super::types::{
    DesktopAgentAvatarResourceAssetPayload, DesktopAgentAvatarResourceReadPayload,
    DesktopAgentAvatarBindingLookupPayload, DesktopAgentAvatarBindingRecord,
    DesktopAgentAvatarBindingSetPayload, DesktopAgentAvatarImportLive2dPayload,
    DesktopAgentAvatarImportResult, DesktopAgentAvatarImportVrmPayload,
    DesktopAgentAvatarResourceDeletePayload, DesktopAgentAvatarResourceRecord,
};
use tauri::AppHandle;

#[tauri::command]
pub(crate) fn desktop_agent_avatar_resource_pick_vrm(
    app: AppHandle,
) -> Result<Option<String>, String> {
    let start_dir = dirs::home_dir()
        .or_else(|| crate::desktop_paths::resolve_nimi_data_dir().ok())
        .unwrap_or_else(std::env::temp_dir);
    let selected = rfd::FileDialog::new()
        .set_directory(&start_dir)
        .set_title("Select VRM file to import")
        .add_filter("VRM Files", &["vrm"])
        .add_filter("All Files", &["*"])
        .pick_file();
    let _ = app;
    Ok(selected.map(|path| path.to_string_lossy().to_string()))
}

#[tauri::command]
pub(crate) fn desktop_agent_avatar_resource_pick_live2d(
    app: AppHandle,
) -> Result<Option<String>, String> {
    let start_dir = dirs::home_dir()
        .or_else(|| crate::desktop_paths::resolve_nimi_data_dir().ok())
        .unwrap_or_else(std::env::temp_dir);
    let selected = rfd::FileDialog::new()
        .set_directory(&start_dir)
        .set_title("Select Live2D runtime directory to import")
        .pick_folder();
    let _ = app;
    Ok(selected.map(|path| path.to_string_lossy().to_string()))
}

#[tauri::command]
pub(crate) fn desktop_agent_avatar_resource_import_vrm(
    payload: DesktopAgentAvatarImportVrmPayload,
) -> Result<DesktopAgentAvatarImportResult, String> {
    let conn = open_db()?;
    import_vrm(&conn, &payload)
}

#[tauri::command]
pub(crate) fn desktop_agent_avatar_resource_import_live2d(
    payload: DesktopAgentAvatarImportLive2dPayload,
) -> Result<DesktopAgentAvatarImportResult, String> {
    let conn = open_db()?;
    import_live2d(&conn, &payload)
}

#[tauri::command]
pub(crate) fn desktop_agent_avatar_resource_list(
) -> Result<Vec<DesktopAgentAvatarResourceRecord>, String> {
    let conn = open_db()?;
    list_resources(&conn)
}

#[tauri::command]
pub(crate) fn desktop_agent_avatar_resource_delete(
    payload: DesktopAgentAvatarResourceDeletePayload,
) -> Result<bool, String> {
    let conn = open_db()?;
    delete_resource(&conn, &payload.resource_id)
}

#[tauri::command]
pub(crate) fn desktop_agent_avatar_binding_get(
    payload: DesktopAgentAvatarBindingLookupPayload,
) -> Result<Option<DesktopAgentAvatarBindingRecord>, String> {
    let conn = open_db()?;
    get_binding(&conn, &payload.agent_id)
}

#[tauri::command]
pub(crate) fn desktop_agent_avatar_binding_set(
    payload: DesktopAgentAvatarBindingSetPayload,
) -> Result<DesktopAgentAvatarBindingRecord, String> {
    let conn = open_db()?;
    set_binding(&conn, &payload)
}

#[tauri::command]
pub(crate) fn desktop_agent_avatar_binding_clear(
    payload: DesktopAgentAvatarBindingLookupPayload,
) -> Result<bool, String> {
    let conn = open_db()?;
    clear_binding(&conn, &payload.agent_id)
}

#[tauri::command]
pub(crate) fn desktop_agent_avatar_resource_read_asset(
    payload: DesktopAgentAvatarResourceReadPayload,
) -> Result<DesktopAgentAvatarResourceAssetPayload, String> {
    let conn = open_db()?;
    read_resource_asset(&conn, &payload.resource_id)
}
