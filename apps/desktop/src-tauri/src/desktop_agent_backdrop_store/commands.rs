use super::store::{clear_binding, get_binding, import_binding};
use super::types::{
    DesktopAgentBackdropBindingRecord, DesktopAgentBackdropImportPayload,
    DesktopAgentBackdropLookupPayload,
};
use std::env;
use tauri::AppHandle;

#[tauri::command]
pub(crate) fn desktop_agent_backdrop_pick_image(app: AppHandle) -> Result<Option<String>, String> {
    let start_dir = dirs::home_dir()
        .or_else(|| crate::desktop_paths::resolve_nimi_data_dir().ok())
        .unwrap_or_else(env::temp_dir);
    let selected = rfd::FileDialog::new()
        .set_directory(&start_dir)
        .set_title("Select backdrop image to import")
        .add_filter("Images", &["png", "jpg", "jpeg", "webp", "gif", "avif"])
        .add_filter("All Files", &["*"])
        .pick_file();
    let _ = app;
    Ok(selected.map(|path| path.to_string_lossy().to_string()))
}

#[tauri::command]
pub(crate) fn desktop_agent_backdrop_get_binding(
    payload: DesktopAgentBackdropLookupPayload,
) -> Result<Option<DesktopAgentBackdropBindingRecord>, String> {
    get_binding(payload.agent_id.as_str())
}

#[tauri::command]
pub(crate) fn desktop_agent_backdrop_import(
    payload: DesktopAgentBackdropImportPayload,
) -> Result<DesktopAgentBackdropBindingRecord, String> {
    import_binding(&payload)
}

#[tauri::command]
pub(crate) fn desktop_agent_backdrop_clear(
    payload: DesktopAgentBackdropLookupPayload,
) -> Result<bool, String> {
    clear_binding(payload.agent_id.as_str())
}
