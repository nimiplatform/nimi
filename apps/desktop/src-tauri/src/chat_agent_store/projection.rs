use super::codec::{
    map_sql_error, message_kind_to_db_value, message_role_to_db_value, message_status_to_db_value,
    normalize_message_error, normalize_optional_string, normalize_required_string,
    normalize_structured_json, require_non_negative_ms,
};
use super::types::*;
use rusqlite::{params, Connection};

pub(super) fn compute_projection_version(
    conn: &Connection,
    thread_id: &str,
) -> Result<String, String> {
    let (turn_count, beat_count, message_count): (i64, i64, i64) = conn
        .query_row(
            r#"
            SELECT
              (SELECT COUNT(*) FROM agent_turns WHERE thread_id = ?1),
              (SELECT COUNT(*) FROM agent_turn_beats WHERE turn_id IN (SELECT id FROM agent_turns WHERE thread_id = ?1)),
              (SELECT COUNT(*) FROM agent_messages WHERE thread_id = ?1)
            "#,
            params![thread_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .map_err(|error| format!("compute chat_agent projection version counts failed: {error}"))?;

    let latest_projection_ms: i64 = conn
        .query_row(
            r#"
            SELECT COALESCE(MAX(value), 0)
            FROM (
              SELECT COALESCE(MAX(started_at_ms), 0) AS value FROM agent_turns WHERE thread_id = ?1
              UNION ALL
              SELECT COALESCE(MAX(completed_at_ms), 0) AS value FROM agent_turns WHERE thread_id = ?1
              UNION ALL
              SELECT COALESCE(MAX(aborted_at_ms), 0) AS value FROM agent_turns WHERE thread_id = ?1
              UNION ALL
              SELECT COALESCE(MAX(created_at_ms), 0) AS value FROM agent_turn_beats WHERE turn_id IN (SELECT id FROM agent_turns WHERE thread_id = ?1)
              UNION ALL
              SELECT COALESCE(MAX(delivered_at_ms), 0) AS value FROM agent_turn_beats WHERE turn_id IN (SELECT id FROM agent_turns WHERE thread_id = ?1)
              UNION ALL
              SELECT COALESCE(MAX(updated_at_ms), 0) AS value FROM agent_messages WHERE thread_id = ?1
            )
            "#,
            params![thread_id],
            |row| row.get(0),
        )
        .map_err(|error| format!("compute chat_agent projection version timestamp failed: {error}"))?;

    Ok(format!(
        "projection:{latest_projection_ms}:t{turn_count}:b{beat_count}:msg{message_count}"
    ))
}

pub(super) fn upsert_projection_message(
    conn: &Connection,
    input: &ChatAgentProjectionMessageInput,
) -> Result<(), String> {
    let id = normalize_required_string(&input.id, "projection.messages[].id")?;
    let thread_id = normalize_required_string(&input.thread_id, "projection.messages[].threadId")?;
    let content_text = input.content_text.trim().to_string();
    let error = normalize_message_error(input.error.as_ref())?;
    let metadata_json = input
        .metadata_json
        .as_ref()
        .map(|value| normalize_structured_json(value, "projection.messages[].metadataJson"))
        .transpose()?;
    let created_at_ms =
        require_non_negative_ms(input.created_at_ms, "projection.messages[].createdAtMs")?;
    let updated_at_ms =
        require_non_negative_ms(input.updated_at_ms, "projection.messages[].updatedAtMs")?;
    conn.execute(
        r#"
        INSERT INTO agent_messages (
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
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)
        ON CONFLICT(id) DO UPDATE SET
          thread_id = excluded.thread_id,
          role = excluded.role,
          status = excluded.status,
          kind = excluded.kind,
          content_text = excluded.content_text,
          reasoning_text = excluded.reasoning_text,
          error_code = excluded.error_code,
          error_message = excluded.error_message,
          trace_id = excluded.trace_id,
          parent_message_id = excluded.parent_message_id,
          media_url = excluded.media_url,
          media_mime_type = excluded.media_mime_type,
          artifact_id = excluded.artifact_id,
          metadata_json = excluded.metadata_json,
          created_at_ms = excluded.created_at_ms,
          updated_at_ms = excluded.updated_at_ms
        "#,
        params![
            id,
            thread_id,
            message_role_to_db_value(input.role),
            message_status_to_db_value(input.status),
            message_kind_to_db_value(input.kind),
            content_text,
            normalize_optional_string(input.reasoning_text.as_deref()),
            error.as_ref().and_then(|item| item.code.clone()),
            error.as_ref().map(|item| item.message.clone()),
            normalize_optional_string(input.trace_id.as_deref()),
            normalize_optional_string(input.parent_message_id.as_deref()),
            normalize_optional_string(input.media_url.as_deref()),
            normalize_optional_string(input.media_mime_type.as_deref()),
            normalize_optional_string(input.artifact_id.as_deref()),
            metadata_json
                .as_ref()
                .map(|value| super::codec::serialize_json_value(
                    value,
                    "projection.messages[].metadataJson"
                ))
                .transpose()?,
            created_at_ms,
            updated_at_ms,
        ],
    )
    .map_err(|error| map_sql_error("upsert chat_agent projection message failed", error))?;
    Ok(())
}
