use super::codec::{
    map_sql_error, message_role_to_db_value, message_status_to_db_value, normalize_message_error,
    normalize_optional_string, normalize_required_string, normalize_target_snapshot,
    require_non_negative_ms,
};
use super::rows::{draft_record_from_row, message_record_from_row, thread_record_from_row};
use super::types::*;
use rusqlite::{params, Connection, OptionalExtension};

fn summarize_thread(record: ChatAgentThreadRecord) -> ChatAgentThreadSummary {
    ChatAgentThreadSummary {
        id: record.id,
        agent_id: record.agent_id,
        title: record.title,
        updated_at_ms: record.updated_at_ms,
        last_message_at_ms: record.last_message_at_ms,
        archived_at_ms: record.archived_at_ms,
        target_snapshot: record.target_snapshot,
    }
}

pub(crate) fn list_threads(conn: &Connection) -> Result<Vec<ChatAgentThreadSummary>, String> {
    let mut statement = conn
        .prepare(
            r#"
            SELECT
              id,
              agent_id,
              title,
              created_at_ms,
              updated_at_ms,
              last_message_at_ms,
              archived_at_ms,
              target_snapshot_json
            FROM agent_threads
            ORDER BY updated_at_ms DESC, id DESC
            "#,
        )
        .map_err(|error| format!("prepare chat_agent list_threads failed: {error}"))?;
    let rows = statement
        .query_map([], thread_record_from_row)
        .map_err(|error| format!("query chat_agent list_threads failed: {error}"))?;
    let mut result = Vec::new();
    for row in rows {
        let record = row.map_err(|error| format!("decode chat_agent thread failed: {error}"))?;
        result.push(summarize_thread(record));
    }
    Ok(result)
}

pub(crate) fn get_thread_bundle(
    conn: &Connection,
    thread_id: &str,
) -> Result<Option<ChatAgentThreadBundle>, String> {
    let thread_id = normalize_required_string(thread_id, "threadId")?;
    let thread = conn
        .query_row(
            r#"
            SELECT
              id,
              agent_id,
              title,
              created_at_ms,
              updated_at_ms,
              last_message_at_ms,
              archived_at_ms,
              target_snapshot_json
            FROM agent_threads
            WHERE id = ?1
            "#,
            params![thread_id],
            thread_record_from_row,
        )
        .optional()
        .map_err(|error| format!("query chat_agent thread failed: {error}"))?;
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
              reasoning_text,
              error_code,
              error_message,
              trace_id,
              parent_message_id,
              created_at_ms,
              updated_at_ms
            FROM agent_messages
            WHERE thread_id = ?1
            ORDER BY created_at_ms ASC, id ASC
            "#,
        )
        .map_err(|error| {
            format!("prepare chat_agent get_thread_bundle messages failed: {error}")
        })?;
    let message_rows = message_statement
        .query_map(params![&thread.id], message_record_from_row)
        .map_err(|error| format!("query chat_agent messages failed: {error}"))?;
    let mut messages = Vec::new();
    for row in message_rows {
        messages.push(row.map_err(|error| format!("decode chat_agent message failed: {error}"))?);
    }

    let draft = conn
        .query_row(
            r#"
            SELECT thread_id, draft_text, updated_at_ms
            FROM agent_thread_drafts
            WHERE thread_id = ?1
            "#,
            params![&thread.id],
            draft_record_from_row,
        )
        .optional()
        .map_err(|error| format!("query chat_agent draft failed: {error}"))?;

    Ok(Some(ChatAgentThreadBundle {
        thread,
        messages,
        draft,
    }))
}

pub(crate) fn create_thread(
    conn: &Connection,
    input: &ChatAgentCreateThreadInput,
) -> Result<ChatAgentThreadRecord, String> {
    let id = normalize_required_string(&input.id, "id")?;
    let agent_id = normalize_required_string(&input.agent_id, "agentId")?;
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
    let target_snapshot = normalize_target_snapshot(&input.target_snapshot)?;
    if target_snapshot.agent_id != agent_id {
        return Err("targetSnapshot.agentId must match agentId".to_string());
    }
    conn.execute(
        r#"
        INSERT INTO agent_threads (
          id,
          agent_id,
          title,
          created_at_ms,
          updated_at_ms,
          last_message_at_ms,
          archived_at_ms,
          target_snapshot_json
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
        "#,
        params![
            id,
            agent_id,
            title,
            created_at_ms,
            updated_at_ms,
            last_message_at_ms,
            archived_at_ms,
            super::codec::serialize_json_value(&target_snapshot, "targetSnapshot")?,
        ],
    )
    .map_err(|error| map_sql_error("create chat_agent thread failed", error))?;
    get_thread_bundle(conn, &input.id)?
        .map(|bundle| bundle.thread)
        .ok_or_else(|| "create chat_agent thread failed: missing thread after insert".to_string())
}

pub(crate) fn update_thread_metadata(
    conn: &Connection,
    input: &ChatAgentUpdateThreadMetadataInput,
) -> Result<ChatAgentThreadRecord, String> {
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
    let target_snapshot = normalize_target_snapshot(&input.target_snapshot)?;
    let changed = conn
        .execute(
            r#"
            UPDATE agent_threads
            SET
              title = ?2,
              updated_at_ms = ?3,
              last_message_at_ms = ?4,
              archived_at_ms = ?5,
              agent_id = ?6,
              target_snapshot_json = ?7
            WHERE id = ?1
            "#,
            params![
                id,
                title,
                updated_at_ms,
                last_message_at_ms,
                archived_at_ms,
                target_snapshot.agent_id,
                super::codec::serialize_json_value(&target_snapshot, "targetSnapshot")?,
            ],
        )
        .map_err(|error| map_sql_error("update chat_agent thread failed", error))?;
    if changed == 0 {
        return Err("update chat_agent thread failed: thread not found".to_string());
    }
    get_thread_bundle(conn, &input.id)?
        .map(|bundle| bundle.thread)
        .ok_or_else(|| "update chat_agent thread failed: missing thread after update".to_string())
}

pub(crate) fn create_message(
    conn: &Connection,
    input: &ChatAgentCreateMessageInput,
) -> Result<ChatAgentMessageRecord, String> {
    let id = normalize_required_string(&input.id, "id")?;
    let thread_id = normalize_required_string(&input.thread_id, "threadId")?;
    let content_text = input.content_text.trim().to_string();
    let error = normalize_message_error(input.error.as_ref())?;
    let created_at_ms = require_non_negative_ms(input.created_at_ms, "createdAtMs")?;
    let updated_at_ms = require_non_negative_ms(input.updated_at_ms, "updatedAtMs")?;
    conn.execute(
        r#"
        INSERT INTO agent_messages (
          id,
          thread_id,
          role,
          status,
          content_text,
          reasoning_text,
          error_code,
          error_message,
          trace_id,
          parent_message_id,
          created_at_ms,
          updated_at_ms
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
        "#,
        params![
            id,
            thread_id,
            message_role_to_db_value(input.role),
            message_status_to_db_value(input.status),
            content_text,
            normalize_optional_string(input.reasoning_text.as_deref()),
            error.as_ref().and_then(|item| item.code.clone()),
            error.as_ref().map(|item| item.message.clone()),
            normalize_optional_string(input.trace_id.as_deref()),
            normalize_optional_string(input.parent_message_id.as_deref()),
            created_at_ms,
            updated_at_ms,
        ],
    )
    .map_err(|error| map_sql_error("create chat_agent message failed", error))?;
    conn.query_row(
        r#"
        SELECT
          id,
          thread_id,
          role,
          status,
          content_text,
          reasoning_text,
          error_code,
          error_message,
          trace_id,
          parent_message_id,
          created_at_ms,
          updated_at_ms
        FROM agent_messages
        WHERE id = ?1
        "#,
        params![input.id],
        message_record_from_row,
    )
    .map_err(|error| format!("query chat_agent created message failed: {error}"))
}

pub(crate) fn update_message(
    conn: &Connection,
    input: &ChatAgentUpdateMessageInput,
) -> Result<ChatAgentMessageRecord, String> {
    let id = normalize_required_string(&input.id, "id")?;
    let content_text = input.content_text.trim().to_string();
    let error = normalize_message_error(input.error.as_ref())?;
    let updated_at_ms = require_non_negative_ms(input.updated_at_ms, "updatedAtMs")?;
    let changed = conn
        .execute(
            r#"
            UPDATE agent_messages
            SET
              status = ?2,
              content_text = ?3,
              reasoning_text = ?4,
              error_code = ?5,
              error_message = ?6,
              trace_id = ?7,
              updated_at_ms = ?8
            WHERE id = ?1
            "#,
            params![
                id,
                message_status_to_db_value(input.status),
                content_text,
                normalize_optional_string(input.reasoning_text.as_deref()),
                error.as_ref().and_then(|item| item.code.clone()),
                error.as_ref().map(|item| item.message.clone()),
                normalize_optional_string(input.trace_id.as_deref()),
                updated_at_ms,
            ],
        )
        .map_err(|error| map_sql_error("update chat_agent message failed", error))?;
    if changed == 0 {
        return Err("update chat_agent message failed: message not found".to_string());
    }
    conn.query_row(
        r#"
        SELECT
          id,
          thread_id,
          role,
          status,
          content_text,
          reasoning_text,
          error_code,
          error_message,
          trace_id,
          parent_message_id,
          created_at_ms,
          updated_at_ms
        FROM agent_messages
        WHERE id = ?1
        "#,
        params![input.id],
        message_record_from_row,
    )
    .map_err(|error| format!("query chat_agent updated message failed: {error}"))
}

pub(crate) fn get_draft(
    conn: &Connection,
    thread_id: &str,
) -> Result<Option<ChatAgentDraftRecord>, String> {
    let thread_id = normalize_required_string(thread_id, "threadId")?;
    conn.query_row(
        r#"
        SELECT thread_id, draft_text, updated_at_ms
        FROM agent_thread_drafts
        WHERE thread_id = ?1
        "#,
        params![thread_id],
        draft_record_from_row,
    )
    .optional()
    .map_err(|error| format!("query chat_agent draft failed: {error}"))
}

pub(crate) fn put_draft(
    conn: &Connection,
    input: &ChatAgentPutDraftInput,
) -> Result<ChatAgentDraftRecord, String> {
    let thread_id = normalize_required_string(&input.thread_id, "threadId")?;
    let updated_at_ms = require_non_negative_ms(input.updated_at_ms, "updatedAtMs")?;
    let text = input.text.to_string();
    conn.execute(
        r#"
        INSERT INTO agent_thread_drafts (thread_id, draft_text, updated_at_ms)
        VALUES (?1, ?2, ?3)
        ON CONFLICT(thread_id) DO UPDATE SET
          draft_text = excluded.draft_text,
          updated_at_ms = excluded.updated_at_ms
        "#,
        params![thread_id, text, updated_at_ms],
    )
    .map_err(|error| map_sql_error("put chat_agent draft failed", error))?;
    get_draft(conn, &input.thread_id)?
        .ok_or_else(|| "put chat_agent draft failed: missing draft after write".to_string())
}

pub(crate) fn delete_draft(conn: &Connection, thread_id: &str) -> Result<(), String> {
    let thread_id = normalize_required_string(thread_id, "threadId")?;
    conn.execute(
        "DELETE FROM agent_thread_drafts WHERE thread_id = ?1",
        params![thread_id],
    )
    .map_err(|error| map_sql_error("delete chat_agent draft failed", error))?;
    Ok(())
}
