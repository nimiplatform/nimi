use super::codec::{
    map_sql_error, message_kind_to_db_value, message_role_to_db_value,
    message_status_to_db_value, normalize_message_error, normalize_optional_string,
    normalize_required_string, normalize_structured_json, parse_beat_modality,
    parse_beat_status, parse_message_role, require_non_negative_ms,
};
use super::crud::get_thread_bundle;
use super::types::*;
use rusqlite::{params, Connection};

pub(super) fn compute_projection_version(
    conn: &Connection,
    thread_id: &str,
) -> Result<String, String> {
    let (turn_count, beat_count, message_count, snapshot_count, memory_count, recall_count): (i64, i64, i64, i64, i64, i64) = conn
        .query_row(
            r#"
            SELECT
              (SELECT COUNT(*) FROM agent_turns WHERE thread_id = ?1),
              (SELECT COUNT(*) FROM agent_turn_beats WHERE turn_id IN (SELECT id FROM agent_turns WHERE thread_id = ?1)),
              (SELECT COUNT(*) FROM agent_messages WHERE thread_id = ?1),
              (SELECT COUNT(*) FROM agent_interaction_snapshots WHERE thread_id = ?1),
              (SELECT COUNT(*) FROM agent_relation_memory_slots WHERE thread_id = ?1),
              (SELECT COUNT(*) FROM agent_recall_index WHERE thread_id = ?1)
            "#,
            params![thread_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?, row.get(5)?)),
        )
        .map_err(|error| format!("compute chat_agent projection version counts failed: {error}"))?;

    let latest_truth_ms: i64 = conn
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
              UNION ALL
              SELECT COALESCE(MAX(updated_at_ms), 0) AS value FROM agent_interaction_snapshots WHERE thread_id = ?1
              UNION ALL
              SELECT COALESCE(MAX(updated_at_ms), 0) AS value FROM agent_relation_memory_slots WHERE thread_id = ?1
              UNION ALL
              SELECT COALESCE(MAX(updated_at_ms), 0) AS value FROM agent_recall_index WHERE thread_id = ?1
            )
            "#,
            params![thread_id],
            |row| row.get(0),
        )
        .map_err(|error| format!("compute chat_agent projection version timestamp failed: {error}"))?;

    Ok(format!(
        "truth:{latest_truth_ms}:t{turn_count}:b{beat_count}:msg{message_count}:s{snapshot_count}:m{memory_count}:r{recall_count}"
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
                .map(|value| super::codec::serialize_json_value(value, "projection.messages[].metadataJson"))
                .transpose()?,
            created_at_ms,
            updated_at_ms,
        ],
    )
    .map_err(|error| map_sql_error("upsert chat_agent projection message failed", error))?;
    Ok(())
}

pub(super) fn rebuild_projection_internal(
    conn: &Connection,
    thread_id: &str,
) -> Result<ChatAgentProjectionRebuildResult, String> {
    let thread_id = normalize_required_string(thread_id, "threadId")?;
    let Some(existing_bundle) = get_thread_bundle(conn, &thread_id)? else {
        return Err("rebuild chat_agent projection failed: thread not found".to_string());
    };

    let mut statement = conn
        .prepare(
            r#"
            SELECT
              b.projection_message_id,
              t.thread_id,
              t.role,
              b.modality,
              b.status,
              b.text_shadow,
              b.artifact_id,
              b.mime_type,
              b.media_url,
              t.trace_id,
              b.created_at_ms,
              COALESCE(b.delivered_at_ms, t.completed_at_ms, t.aborted_at_ms, b.created_at_ms)
            FROM agent_turn_beats b
            INNER JOIN agent_turns t ON t.id = b.turn_id
            WHERE t.thread_id = ?1 AND b.projection_message_id IS NOT NULL
            ORDER BY b.created_at_ms ASC, b.beat_index ASC, b.id ASC
            "#,
        )
        .map_err(|error| format!("prepare rebuild chat_agent projection failed: {error}"))?;
    let rows = statement
        .query_map(params![&thread_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, Option<String>>(5)?,
                row.get::<_, Option<String>>(6)?,
                row.get::<_, Option<String>>(7)?,
                row.get::<_, Option<String>>(8)?,
                row.get::<_, Option<String>>(9)?,
                row.get::<_, i64>(10)?,
                row.get::<_, i64>(11)?,
            ))
        })
        .map_err(|error| format!("query rebuild chat_agent projection beats failed: {error}"))?;

    let mut projection_messages = Vec::new();
    let mut seen_message_ids = std::collections::HashSet::new();
    for row in rows {
        let (
            message_id,
            row_thread_id,
            role_raw,
            modality_raw,
            beat_status_raw,
            text_shadow,
            artifact_id,
            mime_type,
            media_url,
            trace_id,
            created_at_ms,
            updated_at_ms,
        ) = row
            .map_err(|error| format!("decode rebuild chat_agent projection row failed: {error}"))?;
        if !seen_message_ids.insert(message_id.clone()) {
            return Err(
                "rebuild chat_agent projection failed: duplicate projection_message_id".to_string(),
            );
        }
        let role = parse_message_role(&role_raw)?;
        let modality = parse_beat_modality(&modality_raw)?;
        let beat_status = parse_beat_status(&beat_status_raw)?;
        let kind = match modality {
            ChatAgentBeatModality::Image => ChatAgentMessageKind::Image,
            _ => ChatAgentMessageKind::Text,
        };
        let (status, error) = match beat_status {
            ChatAgentBeatStatus::Delivered => (ChatAgentMessageStatus::Complete, None),
            ChatAgentBeatStatus::Failed => (
                ChatAgentMessageStatus::Error,
                Some(ChatAgentMessageError {
                    code: Some("AGENT_BEAT_FAILED".to_string()),
                    message: "agent beat failed".to_string(),
                }),
            ),
            ChatAgentBeatStatus::Canceled => (
                ChatAgentMessageStatus::Error,
                Some(ChatAgentMessageError {
                    code: Some("AGENT_TURN_CANCELED".to_string()),
                    message: "agent beat canceled".to_string(),
                }),
            ),
            ChatAgentBeatStatus::Planned | ChatAgentBeatStatus::Sealed => {
                (ChatAgentMessageStatus::Pending, None)
            }
        };
        let content_text = if kind == ChatAgentMessageKind::Image {
            let candidate = text_shadow.clone().unwrap_or_default();
            let normalized = candidate.trim();
            if !normalized.is_empty() {
                normalized.to_string()
            } else {
                match beat_status {
                    ChatAgentBeatStatus::Planned | ChatAgentBeatStatus::Sealed => {
                        "Generating image...".to_string()
                    }
                    ChatAgentBeatStatus::Failed => "Image generation failed.".to_string(),
                    ChatAgentBeatStatus::Canceled => "Image generation stopped.".to_string(),
                    ChatAgentBeatStatus::Delivered => "".to_string(),
                }
            }
        } else {
            text_shadow.unwrap_or_default()
        };
        projection_messages.push(ChatAgentProjectionMessageInput {
            id: message_id,
            thread_id: row_thread_id,
            role,
            status,
            kind,
            content_text,
            reasoning_text: None,
            error,
            trace_id,
            parent_message_id: None,
            media_url,
            media_mime_type: mime_type,
            artifact_id,
            metadata_json: None,
            created_at_ms,
            updated_at_ms,
        });
    }

    conn.execute(
        "DELETE FROM agent_messages WHERE thread_id = ?1",
        params![&thread_id],
    )
    .map_err(|error| map_sql_error("delete chat_agent projection messages failed", error))?;
    for message in &projection_messages {
        upsert_projection_message(conn, message)?;
    }
    let rebuilt_last_message_at_ms = projection_messages
        .iter()
        .map(|item| item.updated_at_ms)
        .max();
    conn.execute(
        r#"
        UPDATE agent_threads
        SET
          updated_at_ms = CASE
            WHEN ?2 IS NOT NULL AND updated_at_ms < ?2 THEN ?2
            ELSE updated_at_ms
          END,
          last_message_at_ms = ?2
        WHERE id = ?1
        "#,
        params![&thread_id, rebuilt_last_message_at_ms],
    )
    .map_err(|error| map_sql_error("update chat_agent rebuilt thread metadata failed", error))?;

    let bundle = get_thread_bundle(conn, &thread_id)?.ok_or_else(|| {
        "rebuild chat_agent projection failed: missing thread after rebuild".to_string()
    })?;
    let projection_version = compute_projection_version(conn, &thread_id)?;
    let _ = existing_bundle;
    Ok(ChatAgentProjectionRebuildResult {
        bundle,
        projection_version,
    })
}
