// Orthodontic photo session command surface (PO-ORTHO-012).
//
// Sessions group 0..=2 photo attachments (front + side) so the parent can
// flip through a growth-album style timeline. Image bytes themselves live in
// the unified `attachments` table; this surface owns the per-session
// metadata and the round-trip integrity checks that PO-ORTHO-011 fail-close
// enumerates.
//
// File-system writes for the actual JPEG bytes are NOT in this layer — see
// `src-tauri/src/photos/mod.rs` and the Tauri command in
// `src-tauri/src/orthodontic_photos.rs`. This layer is pure SQL.

const ADMITTED_PHOTO_ANGLES: &str = "front | side";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OrthodonticPhotoSession {
    pub session_id: String,
    pub child_id: String,
    pub case_id: String,
    pub appliance_id: Option<String>,
    pub tray_index: Option<i64>,
    pub session_date: String,
    pub note: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OrthodonticPhotoAttachment {
    pub attachment_id: String,
    pub child_id: String,
    pub session_id: String,
    pub angle: String,
    pub file_path: String,
    pub file_name: String,
    pub mime_type: String,
    pub created_at: String,
}

fn is_admitted_photo_angle(angle: &str) -> bool {
    matches!(angle, "front" | "side")
}

/// Round-trip the (caseId, childId) pair and return whether the case is in a
/// completed state. PO-ORTHO-012 doesn't formally forbid sessions on a
/// completed case (the user may still want to add post-treatment photos),
/// but it does forbid sessions on a missing or wrong-child case.
fn fetch_case_for_session(
    conn: &Connection,
    case_id: &str,
    child_id: &str,
) -> Result<(), String> {
    let exists: i64 = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM orthodontic_cases WHERE caseId = ?1 AND childId = ?2)",
            params![case_id, child_id],
            |row| row.get(0),
        )
        .map_err(|e| format!("fetch_case_for_session query: {e}"))?;
    if exists != 1 {
        return Err(
            "photo session caseId does not round-trip to declared childId (PO-ORTHO-012)"
                .to_string(),
        );
    }
    Ok(())
}

/// Round-trip the (applianceId, caseId, childId) triple. Returns the
/// `applianceType` so the caller can validate `tray_index` semantics.
fn fetch_appliance_for_session(
    conn: &Connection,
    appliance_id: &str,
    case_id: &str,
    child_id: &str,
) -> Result<String, String> {
    let row: Option<String> = conn
        .query_row(
            "SELECT applianceType FROM orthodontic_appliances WHERE applianceId = ?1 AND caseId = ?2 AND childId = ?3",
            params![appliance_id, case_id, child_id],
            |row| row.get::<_, String>(0),
        )
        .ok();
    row.ok_or_else(|| {
        "photo session applianceId does not round-trip to declared caseId/childId (PO-ORTHO-012)"
            .to_string()
    })
}

/// Round-trip the (sessionId, childId) pair and return the resolved session.
fn fetch_session_for_attachment(
    conn: &Connection,
    session_id: &str,
    child_id: &str,
) -> Result<(), String> {
    let exists: i64 = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM orthodontic_photo_sessions WHERE sessionId = ?1 AND childId = ?2)",
            params![session_id, child_id],
            |row| row.get(0),
        )
        .map_err(|e| format!("fetch_session_for_attachment query: {e}"))?;
    if exists != 1 {
        return Err(
            "photo attachment sessionId does not round-trip to declared childId (PO-ORTHO-012)"
                .to_string(),
        );
    }
    Ok(())
}

/// Wave B audit follow-up (W1): callers MUST consult this before writing
/// JPEG bytes to the on-disk session directory. If a duplicate angle exists,
/// the partial unique index will reject the eventual INSERT, but only AFTER
/// the file write — which would clobber the first attachment's file while
/// leaving its DB row intact. Pre-checking here lets the command layer
/// short-circuit before any disk side-effects.
pub fn photo_attachment_exists_for_angle(
    session_id: &str,
    angle: &str,
) -> Result<bool, String> {
    let conn = get_conn()?.lock().map_err(|e| e.to_string())?;
    let exists: i64 = conn
        .query_row(
            "SELECT EXISTS(
                 SELECT 1 FROM attachments
                 WHERE ownerTable = 'orthodontic_photo_sessions'
                   AND ownerId = ?1
                   AND json_extract(metadataJson, '$.angle') = ?2
             )",
            params![session_id, angle],
            |row| row.get(0),
        )
        .map_err(|e| format!("photo_attachment_exists_for_angle: {e}"))?;
    Ok(exists == 1)
}

#[tauri::command]
pub fn insert_orthodontic_photo_session(
    session_id: String,
    child_id: String,
    case_id: String,
    appliance_id: Option<String>,
    tray_index: Option<i64>,
    session_date: String,
    note: Option<String>,
    now: String,
) -> Result<OrthodonticPhotoSession, String> {
    if session_id.trim().is_empty() {
        return Err("photo session sessionId must not be empty".to_string());
    }
    if session_date.trim().is_empty() {
        return Err("photo session sessionDate must not be empty".to_string());
    }
    if let Some(t) = tray_index {
        if t < 1 {
            return Err(format!(
                "photo session trayIndex \"{t}\" must be >= 1 when present"
            ));
        }
    }

    let conn = get_conn()?.lock().map_err(|e| e.to_string())?;
    fetch_case_for_session(&conn, &case_id, &child_id)?;
    if let Some(app_id) = appliance_id.as_deref() {
        let appliance_type = fetch_appliance_for_session(&conn, app_id, &case_id, &child_id)?;
        if tray_index.is_some() && appliance_type != "clear-aligner" {
            return Err(format!(
                "trayIndex is admitted only for clear-aligner appliances; got applianceType \"{appliance_type}\" (PO-ORTHO-012)"
            ));
        }
    } else if tray_index.is_some() {
        return Err(
            "trayIndex requires a pinned clear-aligner applianceId on the photo session (PO-ORTHO-012)"
                .to_string(),
        );
    }

    conn.execute(
        "INSERT INTO orthodontic_photo_sessions (sessionId, childId, caseId, applianceId, trayIndex, sessionDate, note, createdAt, updatedAt)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)",
        params![session_id, child_id, case_id, appliance_id, tray_index, session_date, note, now],
    )
    .map_err(|e| format!("insert_orthodontic_photo_session: {e}"))?;

    Ok(OrthodonticPhotoSession {
        session_id,
        child_id,
        case_id,
        appliance_id,
        tray_index,
        session_date,
        note,
        created_at: now.clone(),
        updated_at: now,
    })
}

#[tauri::command]
pub fn update_orthodontic_photo_session(
    session_id: String,
    tray_index: Option<i64>,
    session_date: String,
    note: Option<String>,
    now: String,
) -> Result<(), String> {
    if session_date.trim().is_empty() {
        return Err("photo session sessionDate must not be empty".to_string());
    }
    if let Some(t) = tray_index {
        if t < 1 {
            return Err(format!(
                "photo session trayIndex \"{t}\" must be >= 1 when present"
            ));
        }
    }

    let conn = get_conn()?.lock().map_err(|e| e.to_string())?;

    // If trayIndex is being set, the pinned appliance MUST be clear-aligner.
    if tray_index.is_some() {
        let row: Option<String> = conn
            .query_row(
                "SELECT a.applianceType
                 FROM orthodontic_photo_sessions s
                 JOIN orthodontic_appliances a ON a.applianceId = s.applianceId
                 WHERE s.sessionId = ?1",
                params![session_id],
                |row| row.get::<_, String>(0),
            )
            .ok();
        let appliance_type = row.ok_or_else(|| {
            "trayIndex requires a pinned clear-aligner applianceId on the photo session (PO-ORTHO-012)"
                .to_string()
        })?;
        if appliance_type != "clear-aligner" {
            return Err(format!(
                "trayIndex is admitted only for clear-aligner appliances; got applianceType \"{appliance_type}\" (PO-ORTHO-012)"
            ));
        }
    }

    let affected = conn
        .execute(
            "UPDATE orthodontic_photo_sessions
             SET trayIndex = ?2, sessionDate = ?3, note = ?4, updatedAt = ?5
             WHERE sessionId = ?1",
            params![session_id, tray_index, session_date, note, now],
        )
        .map_err(|e| format!("update_orthodontic_photo_session: {e}"))?;
    if affected == 0 {
        return Err(format!(
            "update_orthodontic_photo_session: sessionId \"{session_id}\" not found"
        ));
    }
    Ok(())
}

#[tauri::command]
pub fn get_orthodontic_photo_session(
    session_id: String,
) -> Result<Option<OrthodonticPhotoSession>, String> {
    let conn = get_conn()?.lock().map_err(|e| e.to_string())?;
    let row = conn
        .query_row(
            "SELECT sessionId, childId, caseId, applianceId, trayIndex, sessionDate, note, createdAt, updatedAt
             FROM orthodontic_photo_sessions
             WHERE sessionId = ?1",
            params![session_id],
            |row| {
                Ok(OrthodonticPhotoSession {
                    session_id: row.get(0)?,
                    child_id: row.get(1)?,
                    case_id: row.get(2)?,
                    appliance_id: row.get(3)?,
                    tray_index: row.get(4)?,
                    session_date: row.get(5)?,
                    note: row.get(6)?,
                    created_at: row.get(7)?,
                    updated_at: row.get(8)?,
                })
            },
        )
        .ok();
    Ok(row)
}

#[tauri::command]
pub fn list_orthodontic_photo_sessions_for_case(
    case_id: String,
    child_id: String,
) -> Result<Vec<OrthodonticPhotoSession>, String> {
    let conn = get_conn()?.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT sessionId, childId, caseId, applianceId, trayIndex, sessionDate, note, createdAt, updatedAt
             FROM orthodontic_photo_sessions
             WHERE caseId = ?1 AND childId = ?2
             ORDER BY sessionDate ASC, createdAt ASC",
        )
        .map_err(|e| format!("list_photo_sessions prepare: {e}"))?;
    let rows = stmt
        .query_map(params![case_id, child_id], |row| {
            Ok(OrthodonticPhotoSession {
                session_id: row.get(0)?,
                child_id: row.get(1)?,
                case_id: row.get(2)?,
                appliance_id: row.get(3)?,
                tray_index: row.get(4)?,
                session_date: row.get(5)?,
                note: row.get(6)?,
                created_at: row.get(7)?,
                updated_at: row.get(8)?,
            })
        })
        .map_err(|e| format!("list_photo_sessions query: {e}"))?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| format!("list_photo_sessions row: {e}"))?);
    }
    Ok(out)
}

/// Collects attachment file paths owned by a session, then deletes both the
/// session row (trigger cascades attachments rows). Returns the collected
/// file paths so the Tauri command can purge the bytes from disk.
///
/// W3 mitigation: the row purge is atomic (single SQL DELETE + AFTER DELETE
/// trigger), and the on-disk purge happens after the DB transaction commits.
/// On-disk failure is fail-safe (PO-ORTHO-012) — the caller logs and
/// surfaces the error but DB state stays consistent.
pub fn delete_orthodontic_photo_session_collecting_paths(
    session_id: &str,
) -> Result<Vec<String>, String> {
    let conn = get_conn()?.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT filePath FROM attachments
             WHERE ownerTable = 'orthodontic_photo_sessions' AND ownerId = ?1",
        )
        .map_err(|e| format!("delete_session collect prepare: {e}"))?;
    let rows = stmt
        .query_map(params![session_id], |row| row.get::<_, String>(0))
        .map_err(|e| format!("delete_session collect query: {e}"))?;
    let mut paths: Vec<String> = Vec::new();
    for r in rows {
        paths.push(r.map_err(|e| format!("delete_session collect row: {e}"))?);
    }

    let affected = conn
        .execute(
            "DELETE FROM orthodontic_photo_sessions WHERE sessionId = ?1",
            params![session_id],
        )
        .map_err(|e| format!("delete_orthodontic_photo_session: {e}"))?;
    if affected == 0 {
        return Err(format!(
            "delete_orthodontic_photo_session: sessionId \"{session_id}\" not found"
        ));
    }
    Ok(paths)
}

#[tauri::command]
pub fn insert_photo_attachment(
    attachment_id: String,
    child_id: String,
    session_id: String,
    file_path: String,
    file_name: String,
    mime_type: String,
    angle: String,
    now: String,
) -> Result<OrthodonticPhotoAttachment, String> {
    if attachment_id.trim().is_empty() {
        return Err("photo attachment attachmentId must not be empty".to_string());
    }
    if !is_admitted_photo_angle(angle.as_str()) {
        return Err(format!(
            "unsupported photo angle \"{angle}\"; expected {ADMITTED_PHOTO_ANGLES} (PO-ORTHO-012)"
        ));
    }

    let conn = get_conn()?.lock().map_err(|e| e.to_string())?;
    fetch_session_for_attachment(&conn, &session_id, &child_id)?;

    // Wave B audit follow-up (W3): build the metadataJson through
    // serde_json so a future angle enum extension that contains a `"` or `\`
    // cannot escape the JSON string. The runtime keys angles off
    // `json_extract` so we keep the canonical `$.angle` shape.
    let metadata_json = serde_json::json!({ "angle": angle }).to_string();
    conn.execute(
        "INSERT INTO attachments (attachmentId, childId, ownerTable, ownerId, filePath, fileName, mimeType, caption, metadataJson, createdAt)
         VALUES (?1, ?2, 'orthodontic_photo_sessions', ?3, ?4, ?5, ?6, NULL, ?7, ?8)",
        params![attachment_id, child_id, session_id, file_path, file_name, mime_type, metadata_json, now],
    )
    .map_err(|e| format!("insert_photo_attachment: {e}"))?;

    Ok(OrthodonticPhotoAttachment {
        attachment_id,
        child_id,
        session_id,
        angle,
        file_path,
        file_name,
        mime_type,
        created_at: now,
    })
}

#[tauri::command]
pub fn list_photo_attachments_for_session(
    session_id: String,
) -> Result<Vec<OrthodonticPhotoAttachment>, String> {
    let conn = get_conn()?.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT attachmentId, childId, ownerId,
                    json_extract(metadataJson, '$.angle') AS angle,
                    filePath, fileName, mimeType, createdAt
             FROM attachments
             WHERE ownerTable = 'orthodontic_photo_sessions' AND ownerId = ?1
             ORDER BY angle ASC",
        )
        .map_err(|e| format!("list_photo_attachments prepare: {e}"))?;
    let rows = stmt
        .query_map(params![session_id], |row| {
            let angle: Option<String> = row.get(3)?;
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                angle,
                row.get::<_, String>(4)?,
                row.get::<_, String>(5)?,
                row.get::<_, String>(6)?,
                row.get::<_, String>(7)?,
            ))
        })
        .map_err(|e| format!("list_photo_attachments query: {e}"))?;
    let mut out = Vec::new();
    for r in rows {
        let (attachment_id, child_id, owner_id, angle, file_path, file_name, mime_type, created_at) =
            r.map_err(|e| format!("list_photo_attachments row: {e}"))?;
        let Some(angle) = angle else {
            return Err(format!(
                "attachment {attachment_id} for photo session has missing angle metadata (PO-ORTHO-012)"
            ));
        };
        if !is_admitted_photo_angle(angle.as_str()) {
            return Err(format!(
                "attachment {attachment_id} carries unsupported angle \"{angle}\" (PO-ORTHO-012)"
            ));
        }
        out.push(OrthodonticPhotoAttachment {
            attachment_id,
            child_id,
            session_id: owner_id,
            angle,
            file_path,
            file_name,
            mime_type,
            created_at,
        });
    }
    Ok(out)
}

/// Returns the file path of an attachment so the command layer can verify the
/// file is inside the photos root before reading bytes.
pub fn get_photo_attachment_path(attachment_id: &str) -> Result<String, String> {
    let conn = get_conn()?.lock().map_err(|e| e.to_string())?;
    conn.query_row(
        "SELECT filePath FROM attachments
         WHERE attachmentId = ?1 AND ownerTable = 'orthodontic_photo_sessions'",
        params![attachment_id],
        |row| row.get::<_, String>(0),
    )
    .map_err(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => format!(
            "photo attachment \"{attachment_id}\" not found or not owned by a photo session"
        ),
        other => format!("get_photo_attachment_path: {other}"),
    })
}

/// Delete a single attachment row + return its filePath. Used when the user
/// removes one angle from a session without deleting the whole session.
pub fn delete_photo_attachment_collecting_path(attachment_id: &str) -> Result<String, String> {
    let conn = get_conn()?.lock().map_err(|e| e.to_string())?;
    let file_path: String = conn
        .query_row(
            "SELECT filePath FROM attachments
             WHERE attachmentId = ?1 AND ownerTable = 'orthodontic_photo_sessions'",
            params![attachment_id],
            |row| row.get::<_, String>(0),
        )
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => format!(
                "photo attachment \"{attachment_id}\" not found or not owned by a photo session"
            ),
            other => format!("delete_photo_attachment collect: {other}"),
        })?;
    conn.execute(
        "DELETE FROM attachments WHERE attachmentId = ?1",
        params![attachment_id],
    )
    .map_err(|e| format!("delete_photo_attachment: {e}"))?;
    Ok(file_path)
}
