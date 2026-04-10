use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine;
use serde::Serialize;
use std::fs;
use std::path::PathBuf;

use crate::desktop_paths;

const CHILD_AVATAR_DIR: &str = "parentos/child-avatar";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedChildAvatar {
    pub path: String,
}

fn resolve_avatar_root() -> Result<PathBuf, String> {
    let root = desktop_paths::resolve_nimi_data_dir()?.join(CHILD_AVATAR_DIR);
    fs::create_dir_all(&root)
        .map_err(|error| format!("failed to create child avatar dir ({}): {error}", root.display()))?;
    Ok(root)
}

fn extension_for_mime_type(mime_type: &str) -> Result<&'static str, String> {
    match mime_type.trim().to_ascii_lowercase().as_str() {
        "image/jpeg" | "image/jpg" => Ok("jpg"),
        "image/png" => Ok("png"),
        "image/webp" => Ok("webp"),
        _ => Err(format!("unsupported child avatar mime type: {mime_type}")),
    }
}

#[tauri::command]
pub fn save_child_avatar(
    child_id: String,
    mime_type: String,
    image_base64: String,
) -> Result<SavedChildAvatar, String> {
    let child_id = child_id.trim().to_string();
    if child_id.is_empty() || child_id.contains('/') || child_id.contains('\\') {
        return Err("invalid child_id for avatar".to_string());
    }
    let ext = extension_for_mime_type(&mime_type)?;

    let image_bytes = BASE64_STANDARD
        .decode(image_base64.trim())
        .map_err(|error| format!("invalid child avatar base64 payload: {error}"))?;
    if image_bytes.is_empty() {
        return Err("child avatar payload must not be empty".to_string());
    }

    let file_path = resolve_avatar_root()?.join(format!("{child_id}.{ext}"));
    fs::write(&file_path, &image_bytes)
        .map_err(|error| format!("failed to write child avatar ({}): {error}", file_path.display()))?;

    Ok(SavedChildAvatar {
        path: file_path.display().to_string(),
    })
}
