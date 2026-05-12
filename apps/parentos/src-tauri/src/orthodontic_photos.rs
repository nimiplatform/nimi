//! Tauri command surface for orthodontic photo sessions (`PO-ORTHO-012`).
//!
//! The two non-trivial commands here are:
//!
//! - `attach_orthodontic_photo` — runs the gated decode→downsample→re-encode
//!   pipeline (`photos::compress_to_jpeg`), writes the JPEG to the per-session
//!   directory, then inserts the corresponding `attachments` row. If the DB
//!   insert fails after the file write, the file is removed so the disk does
//!   not leak. Fail-close on every contract path (PO-ORTHO-011).
//! - `delete_orthodontic_photo_session` — W3 two-phase delete: collect the
//!   on-disk paths, then perform a single SQL `DELETE` on
//!   `orthodontic_photo_sessions` which fires the v18 cascade trigger that
//!   purges the corresponding `attachments` rows. Once the DB commits, the
//!   file purge runs as a fail-safe step (directory-missing is OK, anything
//!   else surfaces an error to the caller).

use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine;
use std::fs;
use std::path::Path;

use crate::photos;
use crate::sqlite::queries::{
    delete_orthodontic_photo_session_collecting_paths, delete_photo_attachment_collecting_path,
    get_photo_attachment_path, insert_photo_attachment, list_orthodontic_photo_sessions_for_case,
    list_photo_attachments_for_session, photo_attachment_exists_for_angle,
    OrthodonticPhotoAttachment, OrthodonticPhotoSession,
};

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OrthodonticPhotoSessionBundle {
    pub session: OrthodonticPhotoSession,
    pub attachments: Vec<OrthodonticPhotoAttachment>,
}

/// Capture flow: take the raw base64-encoded source bitmap, compress it
/// through the codec gate, write the resulting JPEG to the per-session
/// directory, and persist the `attachments` row.
#[tauri::command]
pub fn attach_orthodontic_photo(
    attachment_id: String,
    child_id: String,
    session_id: String,
    file_name: String,
    mime_type: String,
    angle: String,
    image_base64: String,
    now: String,
) -> Result<OrthodonticPhotoAttachment, String> {
    if !photos::is_admitted_angle(angle.as_str()) {
        return Err(format!(
            "unsupported photo angle \"{angle}\" (PO-ORTHO-012)"
        ));
    }

    // Wave B audit follow-up (W1): short-circuit duplicate-angle attaches
    // BEFORE we decode, compress, or touch the filesystem. Without this
    // guard the deterministic path `{session}/{angle}.jpg` gets overwritten
    // by `fs::write`, the partial unique index then rejects the INSERT, and
    // our compensating `fs::remove_file` leaves the existing attachment
    // row pointing at a deleted file.
    if photo_attachment_exists_for_angle(session_id.as_str(), angle.as_str())? {
        return Err(format!(
            "photo for angle \"{angle}\" already exists on this session; delete the existing attachment first (PO-ORTHO-012)"
        ));
    }

    let src_bytes = BASE64_STANDARD
        .decode(image_base64.trim())
        .map_err(|e| format!("photo payload base64 decode failed: {e}"))?;
    let jpeg_bytes = photos::compress_to_jpeg(&src_bytes, &mime_type)?;

    let dest = photos::save_session_jpeg(&child_id, &session_id, &angle, &jpeg_bytes)?;
    let file_path_str = dest.to_string_lossy().into_owned();

    // Persist the attachments row. If that fails (e.g. session round-trip
    // failure, duplicate angle hitting the unique index), we must clean up
    // the file we just wrote so the next attempt isn't blocked by a stale
    // artifact.
    match insert_photo_attachment(
        attachment_id,
        child_id,
        session_id,
        file_path_str,
        file_name,
        // Persisted mime is always image/jpeg — the source mime is just for
        // the decoder gate. Recording the source mime would mislead any
        // reader that later trusts mimeType to drive a renderer codec.
        "image/jpeg".to_string(),
        angle,
        now,
    ) {
        Ok(attachment) => Ok(attachment),
        Err(err) => {
            let _ = fs::remove_file(&dest);
            Err(err)
        }
    }
}

#[tauri::command]
pub fn list_orthodontic_photo_session_bundles(
    case_id: String,
    child_id: String,
) -> Result<Vec<OrthodonticPhotoSessionBundle>, String> {
    let sessions = list_orthodontic_photo_sessions_for_case(case_id, child_id)?;
    let mut bundles = Vec::with_capacity(sessions.len());
    for session in sessions {
        let attachments = list_photo_attachments_for_session(session.session_id.clone())?;
        bundles.push(OrthodonticPhotoSessionBundle { session, attachments });
    }
    Ok(bundles)
}

#[tauri::command]
pub fn read_orthodontic_photo_blob(attachment_id: String) -> Result<String, String> {
    let file_path = get_photo_attachment_path(attachment_id.as_str())?;
    let bytes = photos::read_photo_bytes(Path::new(&file_path))?;
    Ok(BASE64_STANDARD.encode(bytes))
}

/// W3 two-phase delete. DB rows are atomic via the v18 trigger; the on-disk
/// purge runs after the SQL succeeds.
#[tauri::command]
pub fn delete_orthodontic_photo_session(
    session_id: String,
    child_id: String,
) -> Result<(), String> {
    // Collect → delete session row (cascade trigger purges attachments rows).
    let paths = delete_orthodontic_photo_session_collecting_paths(session_id.as_str())?;

    // Phase 2: best-effort file purge. Per-file removal first (so we catch
    // anything outside the session dir, e.g. legacy paths); then prune the
    // session directory itself.
    let mut file_errors: Vec<String> = Vec::new();
    for path in &paths {
        if let Err(err) = fs::remove_file(path) {
            if err.kind() != std::io::ErrorKind::NotFound {
                file_errors.push(format!("remove {path}: {err}"));
            }
        }
    }
    if let Err(err) = photos::delete_session_dir(&child_id, &session_id) {
        file_errors.push(err);
    }
    if file_errors.is_empty() {
        Ok(())
    } else {
        // DB state is already consistent; the renderer can surface this so
        // the user knows a manual cleanup is needed. We do NOT roll back the
        // DB delete — that would put the row state out of sync with the
        // (already-purged) attachments rows.
        Err(format!(
            "photo session row deleted, but file purge had issues: {}",
            file_errors.join("; ")
        ))
    }
}

#[tauri::command]
pub fn delete_orthodontic_photo_attachment(attachment_id: String) -> Result<(), String> {
    let file_path = delete_photo_attachment_collecting_path(attachment_id.as_str())?;
    match fs::remove_file(&file_path) {
        Ok(()) => Ok(()),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(err) => Err(format!(
            "photo attachment row deleted but file removal failed ({file_path}): {err}"
        )),
    }
}
