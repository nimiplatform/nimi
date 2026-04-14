use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine;
use rusqlite::params;
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

use crate::desktop_paths;
use crate::sqlite::get_conn;

const ATTACHMENTS_DIR: &str = "parentos/attachments";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentRow {
    pub attachment_id: String,
    pub child_id: String,
    pub owner_table: String,
    pub owner_id: String,
    pub file_path: String,
    pub file_name: String,
    pub mime_type: String,
    pub caption: Option<String>,
    pub created_at: String,
}

fn resolve_attachments_root() -> Result<PathBuf, String> {
    let root = desktop_paths::resolve_nimi_data_dir()?.join(ATTACHMENTS_DIR);
    fs::create_dir_all(&root)
        .map_err(|e| format!("failed to create attachments dir ({}): {e}", root.display()))?;
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
        unsupported => Err(format!("unsupported attachment mime type: {unsupported}")),
    }
}

fn ensure_path_is_owned(path: &Path) -> Result<(), String> {
    let root = resolve_attachments_root()?;
    if path.starts_with(&root) {
        return Ok(());
    }
    Err(format!(
        "attachment path is outside owned storage root: {}",
        path.display()
    ))
}

fn is_supported_owner_table(t: &str) -> bool {
    matches!(
        t,
        "dental_records"
            | "growth_measurements"
            | "medical_events"
            | "vaccine_records"
            | "milestone_records"
    )
}

#[tauri::command]
pub fn save_attachment(
    attachment_id: String,
    child_id: String,
    owner_table: String,
    owner_id: String,
    file_name: String,
    mime_type: String,
    image_base64: String,
    caption: Option<String>,
    now: String,
) -> Result<AttachmentRow, String> {
    if !is_supported_owner_table(owner_table.trim()) {
        return Err(format!(
            "unsupported attachment ownerTable \"{owner_table}\""
        ));
    }

    let safe_child_id = sanitize_segment(&child_id, "child_id")?;
    let safe_attachment_id = sanitize_segment(&attachment_id, "attachment_id")?;
    let ext = extension_for_mime_type(&mime_type)?;

    let image_bytes = BASE64_STANDARD
        .decode(image_base64.trim())
        .map_err(|e| format!("invalid attachment base64 payload: {e}"))?;
    if image_bytes.is_empty() {
        return Err("attachment payload must not be empty".to_string());
    }

    // Write file to disk
    let child_dir = resolve_attachments_root()?.join(&safe_child_id);
    fs::create_dir_all(&child_dir).map_err(|e| {
        format!(
            "failed to create child attachment dir ({}): {e}",
            child_dir.display()
        )
    })?;

    let file_path = child_dir.join(format!("{safe_attachment_id}.{ext}"));
    fs::write(&file_path, &image_bytes).map_err(|e| {
        format!(
            "failed to write attachment ({}): {e}",
            file_path.display()
        )
    })?;

    let file_path_str = file_path.display().to_string();

    // Insert DB row; clean up file on failure
    let conn = get_conn()?.lock().map_err(|e| e.to_string())?;
    if let Err(e) = conn.execute(
        "INSERT INTO attachments (attachmentId, childId, ownerTable, ownerId, filePath, fileName, mimeType, caption, createdAt) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)",
        params![attachment_id, child_id, owner_table, owner_id, file_path_str, file_name, mime_type, caption, now],
    ) {
        let _ = fs::remove_file(&file_path);
        return Err(format!("save_attachment db insert: {e}"));
    }

    Ok(AttachmentRow {
        attachment_id,
        child_id,
        owner_table,
        owner_id,
        file_path: file_path_str,
        file_name,
        mime_type,
        caption,
        created_at: now,
    })
}

#[tauri::command]
pub fn get_attachments(child_id: String) -> Result<Vec<AttachmentRow>, String> {
    let conn = get_conn()?.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT attachmentId, childId, ownerTable, ownerId, filePath, fileName, mimeType, caption, createdAt FROM attachments WHERE childId = ?1 ORDER BY createdAt DESC")
        .map_err(|e| format!("get_attachments: {e}"))?;
    let rows = stmt
        .query_map(params![child_id], |row| {
            Ok(AttachmentRow {
                attachment_id: row.get(0)?,
                child_id: row.get(1)?,
                owner_table: row.get(2)?,
                owner_id: row.get(3)?,
                file_path: row.get(4)?,
                file_name: row.get(5)?,
                mime_type: row.get(6)?,
                caption: row.get(7)?,
                created_at: row.get(8)?,
            })
        })
        .map_err(|e| format!("get_attachments: {e}"))?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("get_attachments collect: {e}"))
}

#[tauri::command]
pub fn get_attachments_by_owner(
    child_id: String,
    owner_table: String,
    owner_id: String,
) -> Result<Vec<AttachmentRow>, String> {
    let conn = get_conn()?.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT attachmentId, childId, ownerTable, ownerId, filePath, fileName, mimeType, caption, createdAt FROM attachments WHERE childId = ?1 AND ownerTable = ?2 AND ownerId = ?3 ORDER BY createdAt DESC")
        .map_err(|e| format!("get_attachments_by_owner: {e}"))?;
    let rows = stmt
        .query_map(params![child_id, owner_table, owner_id], |row| {
            Ok(AttachmentRow {
                attachment_id: row.get(0)?,
                child_id: row.get(1)?,
                owner_table: row.get(2)?,
                owner_id: row.get(3)?,
                file_path: row.get(4)?,
                file_name: row.get(5)?,
                mime_type: row.get(6)?,
                caption: row.get(7)?,
                created_at: row.get(8)?,
            })
        })
        .map_err(|e| format!("get_attachments_by_owner: {e}"))?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("get_attachments_by_owner collect: {e}"))
}

#[tauri::command]
pub fn delete_attachment(attachment_id: String) -> Result<(), String> {
    let conn = get_conn()?.lock().map_err(|e| e.to_string())?;

    // Query the row to get filePath
    let file_path: String = conn
        .query_row(
            "SELECT filePath FROM attachments WHERE attachmentId = ?1",
            params![attachment_id],
            |row| row.get(0),
        )
        .map_err(|e| format!("delete_attachment lookup: {e}"))?;

    let candidate = PathBuf::from(file_path.trim());
    if candidate.is_absolute() {
        if let Ok(()) = ensure_path_is_owned(&candidate) {
            if candidate.exists() {
                let _ = fs::remove_file(&candidate);
            }
        }
    }

    conn.execute(
        "DELETE FROM attachments WHERE attachmentId = ?1",
        params![attachment_id],
    )
    .map_err(|e| format!("delete_attachment: {e}"))?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{extension_for_mime_type, is_supported_owner_table, sanitize_segment};

    #[test]
    fn rejects_unsupported_mime_types() {
        assert!(extension_for_mime_type("image/bmp").is_err());
        assert!(extension_for_mime_type("application/pdf").is_err());
    }

    #[test]
    fn accepts_supported_mime_types() {
        assert_eq!(extension_for_mime_type("image/jpeg").unwrap(), "jpg");
        assert_eq!(extension_for_mime_type("image/png").unwrap(), "png");
        assert_eq!(extension_for_mime_type("image/webp").unwrap(), "webp");
    }

    #[test]
    fn rejects_path_separators_in_segments() {
        assert!(sanitize_segment("../evil", "test").is_err());
        assert!(sanitize_segment("foo/bar", "test").is_err());
        assert!(sanitize_segment("foo\\bar", "test").is_err());
    }

    #[test]
    fn validates_owner_tables() {
        assert!(is_supported_owner_table("dental_records"));
        assert!(is_supported_owner_table("growth_measurements"));
        assert!(!is_supported_owner_table("unknown_table"));
    }
}
