use super::codec::{
    beat_modality_to_db_value, beat_status_to_db_value, map_sql_error,
    normalize_optional_string, normalize_required_string, require_non_negative_ms,
    turn_role_to_db_value, turn_status_to_db_value,
};
use super::crud::{delete_draft, get_thread_bundle, put_draft, update_thread_metadata};
use super::projection::{compute_projection_version, upsert_projection_message};
use super::rows::{beat_record_from_row, turn_record_from_row};
use super::types::*;
use rusqlite::{params, Connection};

pub(crate) fn commit_turn_result(
    conn: &mut Connection,
    input: &ChatAgentCommitTurnResultInput,
) -> Result<ChatAgentCommitTurnResult, String> {
    let thread_id = normalize_required_string(&input.thread_id, "threadId")?;
    if input.projection.thread.id.trim() != thread_id {
        return Err("projection.thread.id must match threadId".to_string());
    }
    if input.turn.thread_id.trim() != thread_id {
        return Err("turn.threadId must match threadId".to_string());
    }
    if input.projection.clear_draft && input.projection.draft.is_some() {
        return Err(
            "projection.clearDraft and projection.draft are mutually exclusive".to_string(),
        );
    }
    if input.turn.role == ChatAgentTurnRole::Assistant {
        let text_beat_count = input
            .beats
            .iter()
            .filter(|beat| beat.modality == ChatAgentBeatModality::Text)
            .count();
        if text_beat_count > 1 {
            return Err("assistant turns admit at most one text beat per turn".to_string());
        }
        let assistant_text_projection_count = input
            .projection
            .messages
            .iter()
            .filter(|message| {
                message.role == ChatAgentMessageRole::Assistant
                    && message.kind == ChatAgentMessageKind::Text
            })
            .count();
        if assistant_text_projection_count > 1 {
            return Err(
                "assistant turns admit at most one projected text message per turn".to_string(),
            );
        }
    }

    let tx = conn
        .transaction()
        .map_err(|error| format!("begin chat_agent commit turn transaction failed: {error}"))?;

    let turn_id = normalize_required_string(&input.turn.id, "turn.id")?;
    let provider_mode = normalize_required_string(&input.turn.provider_mode, "turn.providerMode")?;
    let started_at_ms = require_non_negative_ms(input.turn.started_at_ms, "turn.startedAtMs")?;
    let completed_at_ms = input
        .turn
        .completed_at_ms
        .map(|value| require_non_negative_ms(value, "turn.completedAtMs"))
        .transpose()?;
    let aborted_at_ms = input
        .turn
        .aborted_at_ms
        .map(|value| require_non_negative_ms(value, "turn.abortedAtMs"))
        .transpose()?;
    tx.execute(
        r#"
        INSERT INTO agent_turns (
          id,
          thread_id,
          role,
          status,
          provider_mode,
          trace_id,
          prompt_trace_id,
          started_at_ms,
          completed_at_ms,
          aborted_at_ms
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
        "#,
        params![
            &turn_id,
            &thread_id,
            turn_role_to_db_value(input.turn.role),
            turn_status_to_db_value(input.turn.status),
            provider_mode,
            normalize_optional_string(input.turn.trace_id.as_deref()),
            normalize_optional_string(input.turn.prompt_trace_id.as_deref()),
            started_at_ms,
            completed_at_ms,
            aborted_at_ms,
        ],
    )
    .map_err(|error| map_sql_error("insert chat_agent turn failed", error))?;

    let mut seen_beat_indexes = std::collections::HashSet::new();
    let mut seen_projection_message_ids = std::collections::HashSet::new();
    for beat in &input.beats {
        if beat.turn_id.trim() != turn_id {
            return Err("beats[].turnId must match turn.id".to_string());
        }
        if !seen_beat_indexes.insert(beat.beat_index) {
            return Err("beats[].beatIndex must be unique within a turn".to_string());
        }
        if let Some(message_id) = beat.projection_message_id.as_deref() {
            let message_id = normalize_required_string(message_id, "beats[].projectionMessageId")?;
            if !seen_projection_message_ids.insert(message_id) {
                return Err("beats[].projectionMessageId must be unique within a turn".to_string());
            }
        }
        tx.execute(
            r#"
            INSERT INTO agent_turn_beats (
              id,
              turn_id,
              beat_index,
              modality,
              status,
              text_shadow,
              artifact_id,
              mime_type,
              media_url,
              projection_message_id,
              created_at_ms,
              delivered_at_ms
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
            "#,
            params![
                normalize_required_string(&beat.id, "beats[].id")?,
                &turn_id,
                require_non_negative_ms(beat.beat_index, "beats[].beatIndex")?,
                beat_modality_to_db_value(beat.modality),
                beat_status_to_db_value(beat.status),
                normalize_optional_string(beat.text_shadow.as_deref()),
                normalize_optional_string(beat.artifact_id.as_deref()),
                normalize_optional_string(beat.mime_type.as_deref()),
                normalize_optional_string(beat.media_url.as_deref()),
                normalize_optional_string(beat.projection_message_id.as_deref()),
                require_non_negative_ms(beat.created_at_ms, "beats[].createdAtMs")?,
                beat.delivered_at_ms
                    .map(|value| require_non_negative_ms(value, "beats[].deliveredAtMs"))
                    .transpose()?,
            ],
        )
        .map_err(|error| map_sql_error("insert chat_agent turn beat failed", error))?;
    }

    let _ = update_thread_metadata(&tx, &input.projection.thread)?;
    for message in &input.projection.messages {
        if message.thread_id.trim() != thread_id {
            return Err("projection.messages[].threadId must match threadId".to_string());
        }
        upsert_projection_message(&tx, message)?;
    }
    if let Some(draft) = &input.projection.draft {
        if draft.thread_id.trim() != thread_id {
            return Err("projection.draft.threadId must match threadId".to_string());
        }
        let _ = put_draft(&tx, draft)?;
    } else if input.projection.clear_draft {
        delete_draft(&tx, &thread_id)?;
    }

    let turn = tx
        .query_row(
            r#"
            SELECT
              id,
              thread_id,
              role,
              status,
              provider_mode,
              trace_id,
              prompt_trace_id,
              started_at_ms,
              completed_at_ms,
              aborted_at_ms
            FROM agent_turns
            WHERE id = ?1
            "#,
            params![&turn_id],
            turn_record_from_row,
        )
        .map_err(|error| format!("query chat_agent inserted turn failed: {error}"))?;
    let mut beats = Vec::new();
    {
        let mut beat_statement = tx
            .prepare(
                r#"
                SELECT
                  id,
                  turn_id,
                  beat_index,
                  modality,
                  status,
                  text_shadow,
                  artifact_id,
                  mime_type,
                  media_url,
                  projection_message_id,
                  created_at_ms,
                  delivered_at_ms
                FROM agent_turn_beats
                WHERE turn_id = ?1
                ORDER BY beat_index ASC, id ASC
                "#,
            )
            .map_err(|error| format!("prepare chat_agent inserted beats failed: {error}"))?;
        let beat_rows = beat_statement
            .query_map(params![&turn_id], beat_record_from_row)
            .map_err(|error| format!("query chat_agent inserted beats failed: {error}"))?;
        for row in beat_rows {
            beats.push(
                row.map_err(|error| format!("decode chat_agent inserted beat failed: {error}"))?,
            );
        }
    }

    let bundle = get_thread_bundle(&tx, &thread_id)?.ok_or_else(|| {
        "commit chat_agent turn failed: missing thread bundle after commit".to_string()
    })?;

    let projection_version = compute_projection_version(&tx, &thread_id)?;
    tx.commit()
        .map_err(|error| format!("commit chat_agent turn transaction failed: {error}"))?;

    Ok(ChatAgentCommitTurnResult {
        turn,
        beats,
        bundle,
        projection_version,
    })
}
