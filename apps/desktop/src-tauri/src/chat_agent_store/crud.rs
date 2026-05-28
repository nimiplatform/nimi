use super::codec::normalize_required_string;
use super::rows::{message_record_from_row, thread_record_from_row};
use super::types::*;
use rusqlite::{params, Connection, OptionalExtension};

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
              local_agent_ref,
              owner_user_id,
              realm_agent_id,
              title,
              created_at_ms,
              updated_at_ms,
              last_message_at_ms,
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
              kind,
              content_text,
              reasoning_text,
              error_code,
              error_message,
              trace_id,
              parent_message_id,
              media_url,
              media_mime_type,
              artifact_id,
              metadata_json,
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

    Ok(Some(ChatAgentThreadBundle {
        thread,
        messages,
    }))
}
