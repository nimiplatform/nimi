use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine;
use serde::Serialize;
use std::path::PathBuf;

const MAX_DROPPED_IMAGE_BYTES: u64 = 25 * 1024 * 1024;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DroppedImagePayload {
    pub file_name: String,
    pub mime_type: String,
    pub base64: String,
}

fn extension_to_mime(extension: &str) -> Option<&'static str> {
    match extension.to_ascii_lowercase().as_str() {
        "jpg" | "jpeg" => Some("image/jpeg"),
        "png" => Some("image/png"),
        "webp" => Some("image/webp"),
        "gif" => Some("image/gif"),
        "heic" => Some("image/heic"),
        "heif" => Some("image/heif"),
        "bmp" => Some("image/bmp"),
        _ => None,
    }
}

#[tauri::command]
pub fn pick_image_files(title: Option<String>) -> Result<Vec<String>, String> {
    let start_dir = dirs::picture_dir()
        .or_else(dirs::home_dir)
        .unwrap_or_else(std::env::temp_dir);
    let dialog = rfd::FileDialog::new()
        .set_directory(&start_dir)
        .set_title(title.as_deref().unwrap_or("Select photos"))
        .add_filter("Images", &["jpg", "jpeg", "png", "webp", "gif", "heic", "heif", "bmp"])
        .add_filter("All Files", &["*"]);
    let selected = dialog.pick_files().unwrap_or_default();
    Ok(selected
        .into_iter()
        .map(|path| path.to_string_lossy().to_string())
        .collect())
}

#[tauri::command]
pub fn read_dropped_image_as_base64(path: String) -> Result<DroppedImagePayload, String> {
    let candidate = PathBuf::from(path.trim());
    if !candidate.is_absolute() {
        return Err("dropped image path must be absolute".to_string());
    }
    let file_name = candidate
        .file_name()
        .and_then(|name| name.to_str())
        .map(|name| name.to_string())
        .ok_or_else(|| "dropped image path is missing a file name".to_string())?;
    let extension = candidate
        .extension()
        .and_then(|ext| ext.to_str())
        .ok_or_else(|| "dropped image is missing an extension".to_string())?;
    let mime_type = extension_to_mime(extension)
        .ok_or_else(|| format!("dropped file is not a supported image type: {extension}"))?;

    let metadata = std::fs::metadata(&candidate)
        .map_err(|error| format!("failed to stat dropped image ({}): {error}", candidate.display()))?;
    if !metadata.is_file() {
        return Err(format!("dropped image path is not a file: {}", candidate.display()));
    }
    if metadata.len() > MAX_DROPPED_IMAGE_BYTES {
        return Err(format!(
            "dropped image exceeds {} byte limit",
            MAX_DROPPED_IMAGE_BYTES
        ));
    }

    let bytes = std::fs::read(&candidate)
        .map_err(|error| format!("failed to read dropped image ({}): {error}", candidate.display()))?;
    let base64 = BASE64_STANDARD.encode(&bytes);

    Ok(DroppedImagePayload {
        file_name,
        mime_type: mime_type.to_string(),
        base64,
    })
}
