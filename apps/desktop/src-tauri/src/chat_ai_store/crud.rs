use super::codec::{
    map_sql_error, message_role_to_db_value, message_status_to_db_value, normalize_attachments,
    normalize_message_content, normalize_message_error, normalize_optional_string,
    normalize_required_string, require_non_negative_ms, serialize_json_value,
};
use super::rows::{draft_record_from_row, message_record_from_row, thread_record_from_row};
use super::types::*;
use rusqlite::{params, Connection, OptionalExtension};

fn summarize_thread(record: ChatAiThreadRecord) -> ChatAiThreadSummary {
    ChatAiThreadSummary {
        id: record.id,
        title: record.title,
        updated_at_ms: record.updated_at_ms,
        last_message_at_ms: record.last_message_at_ms,
        archived_at_ms: record.archived_at_ms,
    }
}

pub(crate) fn list_threads(conn: &Connection) -> Result<Vec<ChatAiThreadSummary>, String> {
    let mut statement = conn
        .prepare(
            r#"
            SELECT
              id,
              title,
              created_at_ms,
              updated_at_ms,
              last_message_at_ms,
              archived_at_ms
            FROM ai_threads
            WHERE archived_at_ms IS NULL
              AND EXISTS (
                SELECT 1 FROM ai_messages WHERE ai_messages.thread_id = ai_threads.id
              )
            ORDER BY updated_at_ms DESC, id DESC
            "#,
        )
        .map_err(|error| format!("prepare chat_ai list_threads failed: {error}"))?;
    let rows = statement
        .query_map([], thread_record_from_row)
        .map_err(|error| format!("query chat_ai list_threads failed: {error}"))?;
    let mut result = Vec::new();
    for row in rows {
        let record = row.map_err(|error| format!("decode chat_ai thread failed: {error}"))?;
        result.push(summarize_thread(record));
    }
    Ok(result)
}

pub(crate) fn get_thread_bundle(
    conn: &Connection,
    thread_id: &str,
) -> Result<Option<ChatAiThreadBundle>, String> {
    let thread_id = normalize_required_string(thread_id, "threadId")?;
    let thread = conn
        .query_row(
            r#"
            SELECT
              id,
              title,
              created_at_ms,
              updated_at_ms,
              last_message_at_ms,
              archived_at_ms
            FROM ai_threads
            WHERE id = ?1
            "#,
            params![thread_id],
            thread_record_from_row,
        )
        .optional()
        .map_err(|error| format!("query chat_ai thread failed: {error}"))?;
    let Some(thread) = thread else {
        return Ok(None);
    };

    let mut message_statement = conn
        .prepare(
            r#"
            SELECT
              id,
              thread_id,
              role,
              status,
              content_text,
              content_json,
              error_code,
              error_message,
              trace_id,
              parent_message_id,
              created_at_ms,
              updated_at_ms
            FROM ai_messages
            WHERE thread_id = ?1
            ORDER BY created_at_ms ASC, id ASC
            "#,
        )
        .map_err(|error| format!("prepare chat_ai get_thread_bundle messages failed: {error}"))?;
    let message_rows = message_statement
        .query_map(params![&thread.id], message_record_from_row)
        .map_err(|error| format!("query chat_ai messages failed: {error}"))?;
    let mut messages = Vec::new();
    for row in message_rows {
        messages.push(row.map_err(|error| format!("decode chat_ai message failed: {error}"))?);
    }

    let draft = conn
        .query_row(
            r#"
            SELECT thread_id, draft_text, draft_attachments_json, updated_at_ms
            FROM ai_thread_drafts
            WHERE thread_id = ?1
            "#,
            params![&thread.id],
            draft_record_from_row,
        )
        .optional()
        .map_err(|error| format!("query chat_ai draft failed: {error}"))?;

    Ok(Some(ChatAiThreadBundle {
        thread,
        messages,
        draft,
    }))
}

fn get_thread_record_by_id(
    conn: &Connection,
    thread_id: &str,
) -> Result<Option<ChatAiThreadRecord>, String> {
    get_thread_bundle(conn, thread_id).map(|bundle| bundle.map(|value| value.thread))
}

pub(crate) fn create_thread(
    conn: &Connection,
    input: &ChatAiCreateThreadInput,
) -> Result<ChatAiThreadRecord, String> {
    let id = normalize_required_string(&input.id, "id")?;
    let title = normalize_required_string(&input.title, "title")?;
    let created_at_ms = require_non_negative_ms(input.created_at_ms, "createdAtMs")?;
    let updated_at_ms = require_non_negative_ms(input.updated_at_ms, "updatedAtMs")?;
    let last_message_at_ms = input
        .last_message_at_ms
        .map(|value| require_non_negative_ms(value, "lastMessageAtMs"))
        .transpose()?;
    let archived_at_ms = input
        .archived_at_ms
        .map(|value| require_non_negative_ms(value, "archivedAtMs"))
        .transpose()?;
    match conn.execute(
        r#"
        INSERT INTO ai_threads (
          id,
          title,
          created_at_ms,
          updated_at_ms,
          last_message_at_ms,
          archived_at_ms
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
        "#,
        params![
            id,
            title,
            created_at_ms,
            updated_at_ms,
            last_message_at_ms,
            archived_at_ms
        ],
    ) {
        Ok(_) => Ok(ChatAiThreadRecord {
            id,
            title,
            created_at_ms,
            updated_at_ms,
            last_message_at_ms,
            archived_at_ms,
        }),
        Err(error) => {
            let is_duplicate_thread = matches!(
                &error,
                rusqlite::Error::SqliteFailure(code, _)
                    if code.extended_code == rusqlite::ffi::SQLITE_CONSTRAINT_PRIMARYKEY
                        || code.extended_code == rusqlite::ffi::SQLITE_CONSTRAINT_UNIQUE
            );
            if !is_duplicate_thread {
                return Err(map_sql_error("create chat_ai thread failed", error));
            }
            get_thread_record_by_id(conn, &id)?.ok_or_else(|| {
                "create chat_ai thread failed: duplicate thread without existing record".to_string()
            })
        }
    }
}

pub(crate) fn update_thread_metadata(
    conn: &Connection,
    input: &ChatAiUpdateThreadMetadataInput,
) -> Result<ChatAiThreadRecord, String> {
    let id = normalize_required_string(&input.id, "id")?;
    let title = normalize_required_string(&input.title, "title")?;
    let updated_at_ms = require_non_negative_ms(input.updated_at_ms, "updatedAtMs")?;
    let last_message_at_ms = input
        .last_message_at_ms
        .map(|value| require_non_negative_ms(value, "lastMessageAtMs"))
        .transpose()?;
    let archived_at_ms = input
        .archived_at_ms
        .map(|value| require_non_negative_ms(value, "archivedAtMs"))
        .transpose()?;
    let created_at_ms = conn
        .query_row(
            "SELECT created_at_ms FROM ai_threads WHERE id = ?1",
            params![&id],
            |row| row.get::<_, i64>(0),
        )
        .optional()
        .map_err(|error| format!("query chat_ai thread metadata failed: {error}"))?
        .ok_or_else(|| "chat_ai thread not found".to_string())?;

    let rows_affected = conn
        .execute(
            r#"
            UPDATE ai_threads
            SET
              title = ?2,
              updated_at_ms = ?3,
              last_message_at_ms = ?4,
              archived_at_ms = ?5
            WHERE id = ?1
            "#,
            params![
                &id,
                &title,
                updated_at_ms,
                last_message_at_ms,
                archived_at_ms
            ],
        )
        .map_err(|error| map_sql_error("update chat_ai thread failed", error))?;
    if rows_affected == 0 {
        return Err("chat_ai thread not found".to_string());
    }

    Ok(ChatAiThreadRecord {
        id,
        title,
        created_at_ms,
        updated_at_ms,
        last_message_at_ms,
        archived_at_ms,
    })
}

pub(crate) fn create_message(
    conn: &Connection,
    input: &ChatAiCreateMessageInput,
) -> Result<ChatAiMessageRecord, String> {
    let id = normalize_required_string(&input.id, "id")?;
    let thread_id = normalize_required_string(&input.thread_id, "threadId")?;
    let content = normalize_message_content(&input.content)?;
    let error = normalize_message_error(input.error.as_ref())?;
    let trace_id = normalize_optional_string(input.trace_id.as_deref());
    let parent_message_id = normalize_optional_string(input.parent_message_id.as_deref());
    let created_at_ms = require_non_negative_ms(input.created_at_ms, "createdAtMs")?;
    let updated_at_ms = require_non_negative_ms(input.updated_at_ms, "updatedAtMs")?;
    conn.execute(
        r#"
        INSERT INTO ai_messages (
          id,
          thread_id,
          role,
          status,
          content_text,
          content_json,
          error_code,
          error_message,
          trace_id,
          parent_message_id,
          created_at_ms,
          updated_at_ms
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
        "#,
        params![
            &id,
            &thread_id,
            message_role_to_db_value(input.role),
            message_status_to_db_value(input.status),
            &input.content_text,
            serialize_json_value(&content, "content")?,
            error.as_ref().and_then(|value| value.code.clone()),
            error.as_ref().map(|value| value.message.clone()),
            trace_id.clone(),
            parent_message_id.clone(),
            created_at_ms,
            updated_at_ms
        ],
    )
    .map_err(|error| map_sql_error("create chat_ai message failed", error))?;

    Ok(ChatAiMessageRecord {
        id,
        thread_id,
        role: input.role,
        status: input.status,
        content_text: input.content_text.clone(),
        content,
        error,
        trace_id,
        parent_message_id,
        created_at_ms,
        updated_at_ms,
    })
}

pub(crate) fn update_message(
    conn: &Connection,
    input: &ChatAiUpdateMessageInput,
) -> Result<ChatAiMessageRecord, String> {
    let id = normalize_required_string(&input.id, "id")?;
    let content = normalize_message_content(&input.content)?;
    let error = normalize_message_error(input.error.as_ref())?;
    let trace_id = normalize_optional_string(input.trace_id.as_deref());
    let updated_at_ms = require_non_negative_ms(input.updated_at_ms, "updatedAtMs")?;
    let existing = conn
        .query_row(
            r#"
            SELECT
              id,
              thread_id,
              role,
              status,
              content_text,
              content_json,
              error_code,
              error_message,
              trace_id,
              parent_message_id,
              created_at_ms,
              updated_at_ms
            FROM ai_messages
            WHERE id = ?1
            "#,
            params![&id],
            message_record_from_row,
        )
        .optional()
        .map_err(|error| format!("query chat_ai message failed: {error}"))?
        .ok_or_else(|| "chat_ai message not found".to_string())?;
    let rows_affected = conn
        .execute(
            r#"
            UPDATE ai_messages
            SET
              status = ?2,
              content_text = ?3,
              content_json = ?4,
              error_code = ?5,
              error_message = ?6,
              trace_id = ?7,
              updated_at_ms = ?8
            WHERE id = ?1
            "#,
            params![
                &id,
                message_status_to_db_value(input.status),
                &input.content_text,
                serialize_json_value(&content, "content")?,
                error.as_ref().and_then(|value| value.code.clone()),
                error.as_ref().map(|value| value.message.clone()),
                trace_id.clone(),
                updated_at_ms
            ],
        )
        .map_err(|error| map_sql_error("update chat_ai message failed", error))?;
    if rows_affected == 0 {
        return Err("chat_ai message not found".to_string());
    }

    Ok(ChatAiMessageRecord {
        id: existing.id,
        thread_id: existing.thread_id,
        role: existing.role,
        status: input.status,
        content_text: input.content_text.clone(),
        content,
        error,
        trace_id,
        parent_message_id: existing.parent_message_id,
        created_at_ms: existing.created_at_ms,
        updated_at_ms,
    })
}

pub(crate) fn get_draft(
    conn: &Connection,
    thread_id: &str,
) -> Result<Option<ChatAiDraftRecord>, String> {
    let thread_id = normalize_required_string(thread_id, "threadId")?;
    conn.query_row(
        r#"
        SELECT thread_id, draft_text, draft_attachments_json, updated_at_ms
        FROM ai_thread_drafts
        WHERE thread_id = ?1
        "#,
        params![thread_id],
        draft_record_from_row,
    )
    .optional()
    .map_err(|error| format!("query chat_ai draft failed: {error}"))
}

pub(crate) fn put_draft(
    conn: &Connection,
    input: &ChatAiPutDraftInput,
) -> Result<ChatAiDraftRecord, String> {
    let thread_id = normalize_required_string(&input.thread_id, "threadId")?;
    let updated_at_ms = require_non_negative_ms(input.updated_at_ms, "updatedAtMs")?;
    let attachments = normalize_attachments(&input.attachments, "attachments")?;
    let thread_exists = conn
        .query_row(
            "SELECT id FROM ai_threads WHERE id = ?1",
            params![&thread_id],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|error| format!("query chat_ai draft thread failed: {error}"))?;
    if thread_exists.is_none() {
        return Err("chat_ai draft thread not found".to_string());
    }

    let serialized_attachments = if attachments.is_empty() {
        None
    } else {
        Some(serialize_json_value(&attachments, "attachments")?)
    };
    let existing = conn
        .query_row(
            "SELECT thread_id FROM ai_thread_drafts WHERE thread_id = ?1",
            params![&thread_id],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|error| format!("query chat_ai draft presence failed: {error}"))?;
    if existing.is_some() {
        conn.execute(
            r#"
            UPDATE ai_thread_drafts
            SET draft_text = ?2, draft_attachments_json = ?3, updated_at_ms = ?4
            WHERE thread_id = ?1
            "#,
            params![
                &thread_id,
                &input.text,
                serialized_attachments,
                updated_at_ms
            ],
        )
        .map_err(|error| map_sql_error("update chat_ai draft failed", error))?;
    } else {
        conn.execute(
            r#"
            INSERT INTO ai_thread_drafts (thread_id, draft_text, draft_attachments_json, updated_at_ms)
            VALUES (?1, ?2, ?3, ?4)
            "#,
            params![&thread_id, &input.text, serialized_attachments, updated_at_ms],
        )
        .map_err(|error| map_sql_error("create chat_ai draft failed", error))?;
    }

    Ok(ChatAiDraftRecord {
        thread_id,
        text: input.text.clone(),
        attachments,
        updated_at_ms,
    })
}

pub(crate) fn delete_draft(conn: &Connection, thread_id: &str) -> Result<(), String> {
    let thread_id = normalize_required_string(thread_id, "threadId")?;
    conn.execute(
        "DELETE FROM ai_thread_drafts WHERE thread_id = ?1",
        params![thread_id],
    )
    .map_err(|error| map_sql_error("delete chat_ai draft failed", error))?;
    Ok(())
}
