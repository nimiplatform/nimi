use super::db::{
    clear_binding, delete_resource, get_binding, import_live2d, import_vrm, list_resources,
    open_db, read_resource_asset, set_binding,
};
use super::types::{
    DesktopAgentAvatarBindingLookupPayload, DesktopAgentAvatarBindingRecord,
    DesktopAgentAvatarBindingSetPayload, DesktopAgentAvatarImportLive2dPayload,
    DesktopAgentAvatarImportResult, DesktopAgentAvatarImportVrmPayload,
    DesktopAgentAvatarResourceAssetPayload, DesktopAgentAvatarResourceDeletePayload,
    DesktopAgentAvatarResourceReadPayload, DesktopAgentAvatarResourceRecord,
    DesktopAgentAvatarResourceRelativeReadPayload,
};
use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::AppHandle;
use url::Url;

fn mime_type_for_fixture_resource(
    kind: super::types::DesktopAgentAvatarResourceKind,
    path: &Path,
) -> &'static str {
    match kind {
        super::types::DesktopAgentAvatarResourceKind::Vrm => "model/gltf-binary",
        super::types::DesktopAgentAvatarResourceKind::Live2d => match path
            .extension()
            .and_then(|value| value.to_str())
            .map(|value| value.to_ascii_lowercase())
            .as_deref()
        {
            Some("json") => "application/json",
            Some("moc3") => "application/octet-stream",
            Some("png") => "image/png",
            Some("jpg") | Some("jpeg") => "image/jpeg",
            _ => "application/octet-stream",
        },
    }
}

fn normalize_fixture_relative_path(value: &str) -> Result<String, String> {
    let normalized = value.trim();
    if normalized.is_empty() {
        return Err("relativePath is required".to_string());
    }
    if normalized.starts_with('/') || normalized.starts_with('\\') {
        return Err("relativePath must stay within the imported avatar resource".to_string());
    }
    let candidate = Path::new(normalized);
    if candidate
        .components()
        .any(|component| matches!(component, std::path::Component::ParentDir))
    {
        return Err(
            "relativePath must not traverse outside the imported avatar resource".to_string(),
        );
    }
    Ok(normalized.replace('\\', "/"))
}

fn fixture_resource_entry_path(record: &DesktopAgentAvatarResourceRecord) -> PathBuf {
    Url::parse(&record.file_url)
        .ok()
        .and_then(|url| url.to_file_path().ok())
        .unwrap_or_else(|| {
            PathBuf::from(record.stored_path.as_str()).join(record.source_filename.as_str())
        })
}

fn read_fixture_resource_asset(
    record: &DesktopAgentAvatarResourceRecord,
    path: &Path,
) -> Result<DesktopAgentAvatarResourceAssetPayload, String> {
    let bytes = fs::read(path).map_err(|error| {
        format!(
            "failed to read desktop agent avatar fixture asset ({}): {error}",
            path.display()
        )
    })?;
    Ok(DesktopAgentAvatarResourceAssetPayload {
        mime_type: mime_type_for_fixture_resource(record.kind, path).to_string(),
        base64: BASE64_STANDARD.encode(bytes),
    })
}

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
    if let Some(override_payload) = crate::desktop_e2e_fixture::agent_avatar_store_override()? {
        return Ok(override_payload.resources);
    }
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
    if let Some(override_payload) = crate::desktop_e2e_fixture::agent_avatar_store_override()? {
        return Ok(override_payload
            .bindings
            .into_iter()
            .find(|binding| binding.agent_id == payload.agent_id));
    }
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
    if let Some(override_payload) = crate::desktop_e2e_fixture::agent_avatar_store_override()? {
        let record = override_payload
            .resources
            .into_iter()
            .find(|resource| resource.resource_id == payload.resource_id)
            .ok_or_else(|| {
                format!(
                    "desktop agent avatar fixture resource not found: {}",
                    payload.resource_id
                )
            })?;
        return read_fixture_resource_asset(&record, &fixture_resource_entry_path(&record));
    }
    let conn = open_db()?;
    read_resource_asset(&conn, &payload.resource_id)
}

#[tauri::command]
pub(crate) fn desktop_agent_avatar_resource_read_relative_asset(
    payload: DesktopAgentAvatarResourceRelativeReadPayload,
) -> Result<DesktopAgentAvatarResourceAssetPayload, String> {
    if let Some(override_payload) = crate::desktop_e2e_fixture::agent_avatar_store_override()? {
        let record = override_payload
            .resources
            .into_iter()
            .find(|resource| resource.resource_id == payload.resource_id)
            .ok_or_else(|| {
                format!(
                    "desktop agent avatar fixture resource not found: {}",
                    payload.resource_id
                )
            })?;
        let normalized_relative_path = normalize_fixture_relative_path(&payload.relative_path)?;
        let base_dir = fixture_resource_entry_path(&record)
            .parent()
            .map(Path::to_path_buf)
            .unwrap_or_else(|| PathBuf::from(record.stored_path.as_str()));
        let path = base_dir.join(&normalized_relative_path);
        if !path.starts_with(record.stored_path.as_str()) {
            return Err("relativePath must stay within the imported avatar resource".to_string());
        }
        return read_fixture_resource_asset(&record, &path);
    }
    let conn = open_db()?;
    super::db::read_relative_resource_asset(&conn, &payload.resource_id, &payload.relative_path)
}
