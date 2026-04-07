use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine;
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

use crate::desktop_paths;

const JOURNAL_PHOTO_DIR: &str = "parentos/journal-photo";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedJournalPhoto {
    pub path: String,
}

fn resolve_photo_root() -> Result<PathBuf, String> {
    let root = desktop_paths::resolve_nimi_data_dir()?.join(JOURNAL_PHOTO_DIR);
    fs::create_dir_all(&root)
        .map_err(|error| format!("failed to create journal photo dir ({}): {error}", root.display()))?;
    Ok(root)
}

fn sanitize_segment(value: &str, label: &str) -> Result<String, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(format!("{label} must not be empty"));
    }
    if trimmed.contains('/') || trimmed.contains('\\') {
        return Err(format!("{label} must not contain path separators"));
    }
    Ok(trimmed.to_string())
}

fn extension_for_mime_type(mime_type: &str) -> Result<&'static str, String> {
    match mime_type.trim().to_ascii_lowercase().as_str() {
        "image/jpeg" | "image/jpg" => Ok("jpg"),
        "image/png" => Ok("png"),
        "image/webp" => Ok("webp"),
        "image/gif" => Ok("gif"),
        "image/heic" | "image/heif" => Ok("heic"),
        unsupported => Err(format!("unsupported journal photo mime type: {unsupported}")),
    }
}

fn ensure_photo_path_is_owned(path: &Path) -> Result<(), String> {
    let root = resolve_photo_root()?;
    if path.starts_with(&root) {
        return Ok(());
    }
    Err(format!(
        "journal photo path is outside owned storage root: {}",
        path.display()
    ))
}

#[tauri::command]
pub fn save_journal_photo(
    child_id: String,
    entry_id: String,
    index: u32,
    mime_type: String,
    image_base64: String,
) -> Result<SavedJournalPhoto, String> {
    let child_id = sanitize_segment(&child_id, "child_id")?;
    let entry_id = sanitize_segment(&entry_id, "entry_id")?;
    let extension = extension_for_mime_type(&mime_type)?;
    let image_bytes = BASE64_STANDARD
        .decode(image_base64.trim())
        .map_err(|error| format!("invalid journal photo base64 payload: {error}"))?;
    if image_bytes.is_empty() {
        return Err("journal photo payload must not be empty".to_string());
    }

    let child_dir = resolve_photo_root()?.join(&child_id);
    fs::create_dir_all(&child_dir)
        .map_err(|error| format!("failed to create child journal photo dir ({}): {error}", child_dir.display()))?;

    let file_path = child_dir.join(format!("{entry_id}_{index}.{extension}"));
    fs::write(&file_path, &image_bytes)
        .map_err(|error| format!("failed to write journal photo ({}): {error}", file_path.display()))?;

    Ok(SavedJournalPhoto {
        path: file_path.display().to_string(),
    })
}

#[tauri::command]
pub fn delete_journal_photo(path: String) -> Result<(), String> {
    let candidate = PathBuf::from(path.trim());
    if !candidate.is_absolute() {
        return Err("journal photo delete path must be absolute".to_string());
    }
    ensure_photo_path_is_owned(&candidate)?;
    if !candidate.exists() {
        return Ok(());
    }
    fs::remove_file(&candidate)
        .map_err(|error| format!("failed to delete journal photo ({}): {error}", candidate.display()))
}

#[cfg(test)]
mod tests {
    use super::{delete_journal_photo, save_journal_photo};

    #[test]
    fn rejects_unsupported_mime_types() {
        let result = save_journal_photo(
            "child-1".to_string(),
            "entry-1".to_string(),
            0,
            "image/bmp".to_string(),
            "YQ==".to_string(),
        );
        assert!(result.is_err());
    }

    #[test]
    fn delete_requires_absolute_path() {
        let result = delete_journal_photo("relative/file.jpg".to_string());
        assert!(result.is_err());
    }
}
