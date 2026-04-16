use rusqlite::params;
use serde::{Deserialize, Serialize};

use super::super::get_conn;
use super::validate_observation_selection;

fn normalize_keepsake_metadata(
    keepsake: i32,
    keepsake_title: Option<String>,
    keepsake_reason: Option<String>,
) -> Result<(Option<String>, Option<String>), String> {
    if keepsake != 1 {
        return Ok((None, None));
    }

    let title = keepsake_title.and_then(|value| {
        let trimmed = value.trim().to_string();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed)
        }
    });

    let reason = keepsake_reason.and_then(|value| {
        let trimmed = value.trim().to_string();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed)
        }
    });

    if let Some(reason_value) = reason.as_deref() {
        let is_supported = matches!(
            reason_value,
            "commemorative"
                | "first-time"
                | "achievement"
                | "persistence"
                | "character"
                | "family-moment"
                | "other"
        );
        if !is_supported {
            return Err(format!(
                "unsupported keepsakeReason \"{reason_value}\""
            ));
        }
    }

    Ok((title, reason))
}

// ── Journal Entries ────────────────────────────────────────

#[tauri::command]
pub fn insert_journal_entry(
    entry_id: String, child_id: String, content_type: String, text_content: Option<String>,
    voice_path: Option<String>, photo_paths: Option<String>, recorded_at: String, age_months: i32,
    observation_mode: Option<String>, dimension_id: Option<String>, selected_tags: Option<String>,
    guided_answers: Option<String>, observation_duration: Option<i32>,
    keepsake: i32, keepsake_title: Option<String>, keepsake_reason: Option<String>,
    _mood_tag: Option<String>, recorder_id: Option<String>, now: String,
) -> Result<(), String> {
    validate_observation_selection(
        dimension_id.as_deref(),
        selected_tags.as_deref(),
        &[],
    )?;
    let (keepsake_title, keepsake_reason) =
        normalize_keepsake_metadata(keepsake, keepsake_title, keepsake_reason)?;

    let conn = get_conn()?.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO journal_entries (entryId, childId, contentType, textContent, voicePath, photoPaths, recordedAt, ageMonths, observationMode, dimensionId, selectedTags, guidedAnswers, observationDuration, keepsake, keepsakeTitle, keepsakeReason, recorderId, createdAt, updatedAt) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?18)",
        params![entry_id, child_id, content_type, text_content, voice_path, photo_paths, recorded_at, age_months, observation_mode, dimension_id, selected_tags, guided_answers, observation_duration, keepsake, keepsake_title, keepsake_reason, recorder_id, now],
    )
    .map_err(|e| format!("insert_journal_entry: {e}"))?;
    Ok(())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JournalTagInput {
    pub tag_id: String,
    pub domain: String,
    pub tag: String,
    pub source: String,
    pub confidence: Option<f64>,
}

#[tauri::command]
pub fn insert_journal_entry_with_tags(
    entry_id: String, child_id: String, content_type: String, text_content: Option<String>,
    voice_path: Option<String>, photo_paths: Option<String>, recorded_at: String, age_months: i32,
    observation_mode: Option<String>, dimension_id: Option<String>, selected_tags: Option<String>,
    guided_answers: Option<String>, observation_duration: Option<i32>,
    keepsake: i32, keepsake_title: Option<String>, keepsake_reason: Option<String>,
    _mood_tag: Option<String>, recorder_id: Option<String>, ai_tags: Vec<JournalTagInput>, now: String,
) -> Result<(), String> {
    validate_observation_selection(
        dimension_id.as_deref(),
        selected_tags.as_deref(),
        &ai_tags,
    )?;
    let (keepsake_title, keepsake_reason) =
        normalize_keepsake_metadata(keepsake, keepsake_title, keepsake_reason)?;

    let mut conn = get_conn()?.lock().map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| format!("insert_journal_entry_with_tags tx: {e}"))?;

    tx.execute(
        "INSERT INTO journal_entries (entryId, childId, contentType, textContent, voicePath, photoPaths, recordedAt, ageMonths, observationMode, dimensionId, selectedTags, guidedAnswers, observationDuration, keepsake, keepsakeTitle, keepsakeReason, recorderId, createdAt, updatedAt) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?18)",
        params![entry_id, child_id, content_type, text_content, voice_path, photo_paths, recorded_at, age_months, observation_mode, dimension_id, selected_tags, guided_answers, observation_duration, keepsake, keepsake_title, keepsake_reason, recorder_id, now],
    ).map_err(|e| format!("insert_journal_entry_with_tags entry: {e}"))?;

    for tag in ai_tags {
        tx.execute(
            "INSERT INTO journal_tags (tagId, entryId, domain, tag, source, confidence, createdAt) VALUES (?1,?2,?3,?4,?5,?6,?7)",
            params![tag.tag_id, entry_id, tag.domain, tag.tag, tag.source, tag.confidence, now],
        ).map_err(|e| format!("insert_journal_entry_with_tags tag: {e}"))?;
    }

    tx.commit().map_err(|e| format!("insert_journal_entry_with_tags commit: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn update_journal_entry_with_tags(
    entry_id: String, child_id: String, content_type: String, text_content: Option<String>,
    voice_path: Option<String>, photo_paths: Option<String>, recorded_at: String, age_months: i32,
    observation_mode: Option<String>, dimension_id: Option<String>, selected_tags: Option<String>,
    guided_answers: Option<String>, observation_duration: Option<i32>,
    keepsake: i32, keepsake_title: Option<String>, keepsake_reason: Option<String>,
    _mood_tag: Option<String>, recorder_id: Option<String>, ai_tags: Vec<JournalTagInput>, now: String,
) -> Result<(), String> {
    validate_observation_selection(
        dimension_id.as_deref(),
        selected_tags.as_deref(),
        &ai_tags,
    )?;
    let (keepsake_title, keepsake_reason) =
        normalize_keepsake_metadata(keepsake, keepsake_title, keepsake_reason)?;

    let mut conn = get_conn()?.lock().map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| format!("update_journal_entry_with_tags tx: {e}"))?;

    let updated = tx.execute(
        "UPDATE journal_entries SET childId = ?2, contentType = ?3, textContent = ?4, voicePath = ?5, photoPaths = ?6, recordedAt = ?7, ageMonths = ?8, observationMode = ?9, dimensionId = ?10, selectedTags = ?11, guidedAnswers = ?12, observationDuration = ?13, keepsake = ?14, keepsakeTitle = ?15, keepsakeReason = ?16, recorderId = ?17, updatedAt = ?18 WHERE entryId = ?1",
        params![entry_id, child_id, content_type, text_content, voice_path, photo_paths, recorded_at, age_months, observation_mode, dimension_id, selected_tags, guided_answers, observation_duration, keepsake, keepsake_title, keepsake_reason, recorder_id, now],
    ).map_err(|e| format!("update_journal_entry_with_tags entry: {e}"))?;
    if updated == 0 {
        return Err(format!("update_journal_entry_with_tags: no entry found with id {entry_id}"));
    }

    tx.execute(
        "DELETE FROM journal_tags WHERE entryId = ?1",
        params![entry_id],
    ).map_err(|e| format!("update_journal_entry_with_tags delete tags: {e}"))?;

    for tag in ai_tags {
        tx.execute(
            "INSERT INTO journal_tags (tagId, entryId, domain, tag, source, confidence, createdAt) VALUES (?1,?2,?3,?4,?5,?6,?7)",
            params![tag.tag_id, entry_id, tag.domain, tag.tag, tag.source, tag.confidence, now],
        ).map_err(|e| format!("update_journal_entry_with_tags tag: {e}"))?;
    }

    tx.commit().map_err(|e| format!("update_journal_entry_with_tags commit: {e}"))?;
    Ok(())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JournalEntry {
    pub entry_id: String,
    pub child_id: String,
    pub content_type: String,
    pub text_content: Option<String>,
    pub voice_path: Option<String>,
    pub photo_paths: Option<String>,
    pub recorded_at: String,
    pub age_months: i32,
    pub observation_mode: Option<String>,
    pub dimension_id: Option<String>,
    pub selected_tags: Option<String>,
    pub guided_answers: Option<String>,
    pub observation_duration: Option<i32>,
    pub keepsake: i32,
    pub keepsake_title: Option<String>,
    pub keepsake_reason: Option<String>,
    pub mood_tag: Option<String>,
    pub recorder_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[tauri::command]
pub fn get_journal_entries(child_id: String, limit: Option<i32>) -> Result<Vec<JournalEntry>, String> {
    let conn = get_conn()?.lock().map_err(|e| e.to_string())?;
    let lim = limit.unwrap_or(50);
    let mut stmt = conn.prepare("SELECT entryId, childId, contentType, textContent, voicePath, photoPaths, recordedAt, ageMonths, observationMode, dimensionId, selectedTags, guidedAnswers, observationDuration, keepsake, keepsakeTitle, keepsakeReason, recorderId, createdAt, updatedAt FROM journal_entries WHERE childId = ?1 ORDER BY recordedAt DESC LIMIT ?2").map_err(|e| format!("get_journal_entries: {e}"))?;
    let rows = stmt.query_map(params![child_id, lim], |row| {
        Ok(JournalEntry {
            entry_id: row.get(0)?,
            child_id: row.get(1)?,
            content_type: row.get(2)?,
            text_content: row.get(3)?,
            voice_path: row.get(4)?,
            photo_paths: row.get(5)?,
            recorded_at: row.get(6)?,
            age_months: row.get(7)?,
            observation_mode: row.get(8)?,
            dimension_id: row.get(9)?,
            selected_tags: row.get(10)?,
            guided_answers: row.get(11)?,
            observation_duration: row.get(12)?,
            keepsake: row.get(13)?,
            keepsake_title: row.get(14)?,
            keepsake_reason: row.get(15)?,
            mood_tag: None,
            recorder_id: row.get(16)?,
            created_at: row.get(17)?,
            updated_at: row.get(18)?,
        })
    }).map_err(|e| format!("get_journal_entries: {e}"))?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| format!("get_journal_entries collect: {e}"))
}

#[tauri::command]
pub fn update_journal_keepsake(
    entry_id: String,
    keepsake: i32,
    keepsake_title: Option<String>,
    keepsake_reason: Option<String>,
    now: String,
) -> Result<(), String> {
    let (keepsake_title, keepsake_reason) =
        normalize_keepsake_metadata(keepsake, keepsake_title, keepsake_reason)?;
    let conn = get_conn()?.lock().map_err(|e| e.to_string())?;
    let updated = conn.execute(
        "UPDATE journal_entries SET keepsake = ?2, keepsakeTitle = ?3, keepsakeReason = ?4, updatedAt = ?5 WHERE entryId = ?1",
        params![entry_id, keepsake, keepsake_title, keepsake_reason, now],
    ).map_err(|e| format!("update_journal_keepsake: {e}"))?;
    if updated == 0 {
        return Err(format!("update_journal_keepsake: no entry found with id {entry_id}"));
    }
    Ok(())
}

#[tauri::command]
pub fn delete_journal_entry(entry_id: String) -> Result<(), String> {
    let conn = get_conn()?.lock().map_err(|e| e.to_string())?;
    let deleted = conn.execute(
        "DELETE FROM journal_entries WHERE entryId = ?1",
        params![entry_id],
    ).map_err(|e| format!("delete_journal_entry: {e}"))?;
    if deleted == 0 {
        return Err(format!("delete_journal_entry: no entry found with id {entry_id}"));
    }
    Ok(())
}

#[tauri::command]
pub fn insert_journal_tag(tag_id: String, entry_id: String, domain: String, tag: String, source: String, confidence: Option<f64>, now: String) -> Result<(), String> {
    let conn = get_conn()?.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO journal_tags (tagId, entryId, domain, tag, source, confidence, createdAt) VALUES (?1,?2,?3,?4,?5,?6,?7)",
        params![tag_id, entry_id, domain, tag, source, confidence, now],
    ).map_err(|e| format!("insert_journal_tag: {e}"))?;
    Ok(())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JournalTag {
    pub tag_id: String,
    pub entry_id: String,
    pub domain: String,
    pub tag: String,
    pub source: String,
    pub confidence: Option<f64>,
    pub created_at: String,
}

#[tauri::command]
pub fn get_journal_tags(entry_id: String) -> Result<Vec<JournalTag>, String> {
    let conn = get_conn()?.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare("SELECT tagId, entryId, domain, tag, source, confidence, createdAt FROM journal_tags WHERE entryId = ?1").map_err(|e| format!("get_journal_tags: {e}"))?;
    let rows = stmt.query_map(params![entry_id], |row| {
        Ok(JournalTag {
            tag_id: row.get(0)?,
            entry_id: row.get(1)?,
            domain: row.get(2)?,
            tag: row.get(3)?,
            source: row.get(4)?,
            confidence: row.get(5)?,
            created_at: row.get(6)?,
        })
    }).map_err(|e| format!("get_journal_tags: {e}"))?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| format!("get_journal_tags collect: {e}"))
}

// ── AI Conversations ───────────────────────────────────────

#[tauri::command]
pub fn create_conversation(conversation_id: String, child_id: String, title: Option<String>, now: String) -> Result<(), String> {
    let conn = get_conn()?.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO ai_conversations (conversationId, childId, title, startedAt, lastMessageAt, messageCount, createdAt) VALUES (?1,?2,?3,?4,?4,0,?4)",
        params![conversation_id, child_id, title, now],
    ).map_err(|e| format!("create_conversation: {e}"))?;
    Ok(())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Conversation {
    pub conversation_id: String,
    pub child_id: String,
    pub title: Option<String>,
    pub started_at: String,
    pub last_message_at: String,
    pub message_count: i32,
    pub created_at: String,
}

#[tauri::command]
pub fn get_conversations(child_id: String) -> Result<Vec<Conversation>, String> {
    let conn = get_conn()?.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare("SELECT conversationId, childId, title, startedAt, lastMessageAt, messageCount, createdAt FROM ai_conversations WHERE childId = ?1 ORDER BY lastMessageAt DESC").map_err(|e| format!("get_conversations: {e}"))?;
    let rows = stmt.query_map(params![child_id], |row| {
        Ok(Conversation {
            conversation_id: row.get(0)?,
            child_id: row.get(1)?,
            title: row.get(2)?,
            started_at: row.get(3)?,
            last_message_at: row.get(4)?,
            message_count: row.get(5)?,
            created_at: row.get(6)?,
        })
    }).map_err(|e| format!("get_conversations: {e}"))?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| format!("get_conversations collect: {e}"))
}

#[tauri::command]
pub fn insert_ai_message(message_id: String, conversation_id: String, role: String, content: String, context_snapshot: Option<String>, now: String) -> Result<(), String> {
    let conn = get_conn()?.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO ai_messages (messageId, conversationId, role, content, contextSnapshot, createdAt) VALUES (?1,?2,?3,?4,?5,?6)",
        params![message_id, conversation_id, role, content, context_snapshot, now],
    ).map_err(|e| format!("insert_ai_message: {e}"))?;
    conn.execute(
        "UPDATE ai_conversations SET lastMessageAt = ?2, messageCount = messageCount + 1 WHERE conversationId = ?1",
        params![conversation_id, now],
    ).map_err(|e| format!("update conversation: {e}"))?;
    Ok(())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiMessage {
    pub message_id: String,
    pub conversation_id: String,
    pub role: String,
    pub content: String,
    pub context_snapshot: Option<String>,
    pub created_at: String,
}

#[tauri::command]
pub fn get_ai_messages(conversation_id: String) -> Result<Vec<AiMessage>, String> {
    let conn = get_conn()?.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare("SELECT messageId, conversationId, role, content, contextSnapshot, createdAt FROM ai_messages WHERE conversationId = ?1 ORDER BY createdAt").map_err(|e| format!("get_ai_messages: {e}"))?;
    let rows = stmt.query_map(params![conversation_id], |row| {
        Ok(AiMessage {
            message_id: row.get(0)?,
            conversation_id: row.get(1)?,
            role: row.get(2)?,
            content: row.get(3)?,
            context_snapshot: row.get(4)?,
            created_at: row.get(5)?,
        })
    }).map_err(|e| format!("get_ai_messages: {e}"))?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| format!("get_ai_messages collect: {e}"))
}
