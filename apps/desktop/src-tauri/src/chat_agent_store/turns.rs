use super::codec::{
    beat_modality_to_db_value, beat_status_to_db_value, map_sql_error, normalize_f64,
    normalize_non_negative_f64, normalize_optional_string, normalize_positive_limit,
    normalize_required_string, normalize_structured_json, require_non_negative_ms,
    serialize_json_value, turn_role_to_db_value, turn_status_to_db_value,
};
use super::crud::{delete_draft, get_draft, get_thread_bundle, put_draft, update_thread_metadata};
use super::projection::{
    compute_projection_version, rebuild_projection_internal, upsert_projection_message,
};
use super::rows::{
    beat_record_from_row, interaction_snapshot_record_from_row, recall_entry_record_from_row,
    relation_memory_slot_record_from_row, turn_record_from_row,
};
use super::types::*;
use rusqlite::{params, Connection, OptionalExtension, ToSql};

pub(crate) fn load_turn_context(
    conn: &Connection,
    input: &ChatAgentLoadTurnContextInput,
) -> Result<ChatAgentTurnContext, String> {
    let thread_id = normalize_required_string(&input.thread_id, "threadId")?;
    let recent_turn_limit =
        normalize_positive_limit(input.recent_turn_limit, "recentTurnLimit", 32)?;
    let relation_memory_limit =
        normalize_positive_limit(input.relation_memory_limit, "relationMemoryLimit", 16)?;
    let recall_limit = normalize_positive_limit(input.recall_limit, "recallLimit", 32)?;

    let thread = get_thread_bundle(conn, &thread_id)?
        .map(|bundle| bundle.thread)
        .ok_or_else(|| "load chat_agent turn context failed: thread not found".to_string())?;

    let mut turn_statement = conn
        .prepare(
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
            WHERE thread_id = ?1
            ORDER BY started_at_ms DESC, id DESC
            LIMIT ?2
            "#,
        )
        .map_err(|error| format!("prepare chat_agent recent turns failed: {error}"))?;
    let turn_rows = turn_statement
        .query_map(params![&thread_id, recent_turn_limit], turn_record_from_row)
        .map_err(|error| format!("query chat_agent recent turns failed: {error}"))?;
    let mut recent_turns = Vec::new();
    for row in turn_rows {
        recent_turns
            .push(row.map_err(|error| format!("decode chat_agent recent turn failed: {error}"))?);
    }
    recent_turns.reverse();

    let recent_beats = if recent_turns.is_empty() {
        Vec::new()
    } else {
        let placeholders = (0..recent_turns.len())
            .map(|index| format!("?{}", index + 2))
            .collect::<Vec<_>>()
            .join(", ");
        let sql = format!(
            r#"
            SELECT
              b.id,
              b.turn_id,
              b.beat_index,
              b.modality,
              b.status,
              b.text_shadow,
              b.artifact_id,
              b.mime_type,
              b.projection_message_id,
              b.created_at_ms,
              b.delivered_at_ms
            FROM agent_turn_beats b
            INNER JOIN agent_turns t ON t.id = b.turn_id
            WHERE t.thread_id = ?1 AND b.turn_id IN ({placeholders})
            ORDER BY t.started_at_ms ASC, b.beat_index ASC, b.id ASC
            "#
        );
        let mut params_vec: Vec<&dyn ToSql> = Vec::with_capacity(recent_turns.len() + 1);
        params_vec.push(&thread_id);
        let turn_ids: Vec<String> = recent_turns.iter().map(|turn| turn.id.clone()).collect();
        for turn_id in &turn_ids {
            params_vec.push(turn_id);
        }
        let mut beat_statement = conn
            .prepare(&sql)
            .map_err(|error| format!("prepare chat_agent recent beats failed: {error}"))?;
        let beat_rows = beat_statement
            .query_map(rusqlite::params_from_iter(params_vec), beat_record_from_row)
            .map_err(|error| format!("query chat_agent recent beats failed: {error}"))?;
        let mut beats = Vec::new();
        for row in beat_rows {
            beats.push(
                row.map_err(|error| format!("decode chat_agent recent beat failed: {error}"))?,
            );
        }
        beats
    };

    let interaction_snapshot = conn
        .query_row(
            r#"
            SELECT
              thread_id,
              version,
              relationship_state,
              emotional_temperature,
              assistant_commitments_json,
              user_prefs_json,
              open_loops_json,
              updated_at_ms
            FROM agent_interaction_snapshots
            WHERE thread_id = ?1
            ORDER BY version DESC
            LIMIT 1
            "#,
            params![&thread_id],
            interaction_snapshot_record_from_row,
        )
        .optional()
        .map_err(|error| format!("query chat_agent interaction snapshot failed: {error}"))?;

    let mut memory_statement = conn
        .prepare(
            r#"
            SELECT
              id,
              thread_id,
              slot_type,
              summary,
              source_turn_id,
              source_beat_id,
              score,
              updated_at_ms
            FROM agent_relation_memory_slots
            WHERE thread_id = ?1
            ORDER BY updated_at_ms DESC, id DESC
            LIMIT ?2
            "#,
        )
        .map_err(|error| format!("prepare chat_agent relation memory failed: {error}"))?;
    let memory_rows = memory_statement
        .query_map(
            params![&thread_id, relation_memory_limit],
            relation_memory_slot_record_from_row,
        )
        .map_err(|error| format!("query chat_agent relation memory failed: {error}"))?;
    let mut relation_memory_slots = Vec::new();
    for row in memory_rows {
        relation_memory_slots.push(
            row.map_err(|error| format!("decode chat_agent relation memory failed: {error}"))?,
        );
    }

    let mut recall_statement = conn
        .prepare(
            r#"
            SELECT
              id,
              thread_id,
              source_turn_id,
              source_beat_id,
              summary,
              search_text,
              updated_at_ms
            FROM agent_recall_index
            WHERE thread_id = ?1
            ORDER BY updated_at_ms DESC, id DESC
            LIMIT ?2
            "#,
        )
        .map_err(|error| format!("prepare chat_agent recall index failed: {error}"))?;
    let recall_rows = recall_statement
        .query_map(
            params![&thread_id, recall_limit],
            recall_entry_record_from_row,
        )
        .map_err(|error| format!("query chat_agent recall index failed: {error}"))?;
    let mut recall_entries = Vec::new();
    for row in recall_rows {
        recall_entries
            .push(row.map_err(|error| format!("decode chat_agent recall entry failed: {error}"))?);
    }

    let draft = get_draft(conn, &thread_id)?;
    let projection_version = compute_projection_version(conn, &thread_id)?;
    Ok(ChatAgentTurnContext {
        thread,
        recent_turns,
        recent_beats,
        interaction_snapshot,
        relation_memory_slots,
        recall_entries,
        draft,
        projection_version,
    })
}

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
              projection_message_id,
              created_at_ms,
              delivered_at_ms
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
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
                normalize_optional_string(beat.projection_message_id.as_deref()),
                require_non_negative_ms(beat.created_at_ms, "beats[].createdAtMs")?,
                beat.delivered_at_ms
                    .map(|value| require_non_negative_ms(value, "beats[].deliveredAtMs"))
                    .transpose()?,
            ],
        )
        .map_err(|error| map_sql_error("insert chat_agent turn beat failed", error))?;
    }

    let interaction_snapshot = if let Some(snapshot) = &input.interaction_snapshot {
        if snapshot.thread_id.trim() != thread_id {
            return Err("interactionSnapshot.threadId must match threadId".to_string());
        }
        tx.execute(
            r#"
            INSERT INTO agent_interaction_snapshots (
              thread_id,
              version,
              relationship_state,
              emotional_temperature,
              assistant_commitments_json,
              user_prefs_json,
              open_loops_json,
              updated_at_ms
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
            "#,
            params![
                &thread_id,
                require_non_negative_ms(snapshot.version, "interactionSnapshot.version")?,
                normalize_required_string(
                    &snapshot.relationship_state,
                    "interactionSnapshot.relationshipState",
                )?,
                normalize_f64(
                    snapshot.emotional_temperature,
                    "interactionSnapshot.emotionalTemperature",
                )?,
                serialize_json_value(
                    &normalize_structured_json(
                        &snapshot.assistant_commitments_json,
                        "interactionSnapshot.assistantCommitmentsJson",
                    )?,
                    "interactionSnapshot.assistantCommitmentsJson",
                )?,
                serialize_json_value(
                    &normalize_structured_json(
                        &snapshot.user_prefs_json,
                        "interactionSnapshot.userPrefsJson",
                    )?,
                    "interactionSnapshot.userPrefsJson",
                )?,
                serialize_json_value(
                    &normalize_structured_json(
                        &snapshot.open_loops_json,
                        "interactionSnapshot.openLoopsJson",
                    )?,
                    "interactionSnapshot.openLoopsJson",
                )?,
                require_non_negative_ms(snapshot.updated_at_ms, "interactionSnapshot.updatedAtMs")?,
            ],
        )
        .map_err(|error| map_sql_error("insert chat_agent interaction snapshot failed", error))?;
        Some(
            tx.query_row(
                r#"
                SELECT
                  thread_id,
                  version,
                  relationship_state,
                  emotional_temperature,
                  assistant_commitments_json,
                  user_prefs_json,
                  open_loops_json,
                  updated_at_ms
                FROM agent_interaction_snapshots
                WHERE thread_id = ?1 AND version = ?2
                "#,
                params![&thread_id, snapshot.version],
                interaction_snapshot_record_from_row,
            )
            .map_err(|error| {
                format!("query chat_agent inserted interaction snapshot failed: {error}")
            })?,
        )
    } else {
        None
    };

    for slot in &input.relation_memory_slots {
        if slot.thread_id.trim() != thread_id {
            return Err("relationMemorySlots[].threadId must match threadId".to_string());
        }
        tx.execute(
            r#"
            INSERT INTO agent_relation_memory_slots (
              id,
              thread_id,
              slot_type,
              summary,
              source_turn_id,
              source_beat_id,
              score,
              updated_at_ms
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
            ON CONFLICT(id) DO UPDATE SET
              thread_id = excluded.thread_id,
              slot_type = excluded.slot_type,
              summary = excluded.summary,
              source_turn_id = excluded.source_turn_id,
              source_beat_id = excluded.source_beat_id,
              score = excluded.score,
              updated_at_ms = excluded.updated_at_ms
            "#,
            params![
                normalize_required_string(&slot.id, "relationMemorySlots[].id")?,
                &thread_id,
                normalize_required_string(&slot.slot_type, "relationMemorySlots[].slotType")?,
                normalize_required_string(&slot.summary, "relationMemorySlots[].summary")?,
                normalize_optional_string(slot.source_turn_id.as_deref()),
                normalize_optional_string(slot.source_beat_id.as_deref()),
                normalize_non_negative_f64(slot.score, "relationMemorySlots[].score")?,
                require_non_negative_ms(slot.updated_at_ms, "relationMemorySlots[].updatedAtMs")?,
            ],
        )
        .map_err(|error| map_sql_error("upsert chat_agent relation memory slot failed", error))?;
    }

    for entry in &input.recall_entries {
        if entry.thread_id.trim() != thread_id {
            return Err("recallEntries[].threadId must match threadId".to_string());
        }
        tx.execute(
            r#"
            INSERT INTO agent_recall_index (
              id,
              thread_id,
              source_turn_id,
              source_beat_id,
              summary,
              search_text,
              updated_at_ms
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
            ON CONFLICT(id) DO UPDATE SET
              thread_id = excluded.thread_id,
              source_turn_id = excluded.source_turn_id,
              source_beat_id = excluded.source_beat_id,
              summary = excluded.summary,
              search_text = excluded.search_text,
              updated_at_ms = excluded.updated_at_ms
            "#,
            params![
                normalize_required_string(&entry.id, "recallEntries[].id")?,
                &thread_id,
                normalize_optional_string(entry.source_turn_id.as_deref()),
                normalize_optional_string(entry.source_beat_id.as_deref()),
                normalize_required_string(&entry.summary, "recallEntries[].summary")?,
                normalize_required_string(&entry.search_text, "recallEntries[].searchText")?,
                require_non_negative_ms(entry.updated_at_ms, "recallEntries[].updatedAtMs")?,
            ],
        )
        .map_err(|error| map_sql_error("upsert chat_agent recall entry failed", error))?;
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

    let mut relation_memory_slots = Vec::new();
    if !input.relation_memory_slots.is_empty() {
        let mut stmt = tx
            .prepare(
                r#"
                SELECT
                  id,
                  thread_id,
                  slot_type,
                  summary,
                  source_turn_id,
                  source_beat_id,
                  score,
                  updated_at_ms
                FROM agent_relation_memory_slots
                WHERE thread_id = ?1
                ORDER BY updated_at_ms DESC, id DESC
                "#,
            )
            .map_err(|error| format!("prepare committed relation memory slots failed: {error}"))?;
        let rows = stmt
            .query_map(params![&thread_id], relation_memory_slot_record_from_row)
            .map_err(|error| format!("query committed relation memory slots failed: {error}"))?;
        for row in rows {
            relation_memory_slots.push(row.map_err(|error| {
                format!("decode committed relation memory slot failed: {error}")
            })?);
        }
    }

    let mut recall_entries = Vec::new();
    if !input.recall_entries.is_empty() {
        let mut stmt = tx
            .prepare(
                r#"
                SELECT
                  id,
                  thread_id,
                  source_turn_id,
                  source_beat_id,
                  summary,
                  search_text,
                  updated_at_ms
                FROM agent_recall_index
                WHERE thread_id = ?1
                ORDER BY updated_at_ms DESC, id DESC
                "#,
            )
            .map_err(|error| format!("prepare committed recall entries failed: {error}"))?;
        let rows = stmt
            .query_map(params![&thread_id], recall_entry_record_from_row)
            .map_err(|error| format!("query committed recall entries failed: {error}"))?;
        for row in rows {
            recall_entries.push(
                row.map_err(|error| format!("decode committed recall entry failed: {error}"))?,
            );
        }
    }

    let projection_version = compute_projection_version(&tx, &thread_id)?;
    tx.commit()
        .map_err(|error| format!("commit chat_agent turn transaction failed: {error}"))?;

    Ok(ChatAgentCommitTurnResult {
        turn,
        beats,
        interaction_snapshot,
        relation_memory_slots,
        recall_entries,
        bundle,
        projection_version,
    })
}

pub(crate) fn cancel_turn(
    conn: &mut Connection,
    input: &ChatAgentCancelTurnInput,
) -> Result<ChatAgentTurnRecord, String> {
    let thread_id = normalize_required_string(&input.thread_id, "threadId")?;
    let turn_id = normalize_required_string(&input.turn_id, "turnId")?;
    let scope = normalize_required_string(&input.scope, "scope")?;
    if scope != "turn" && scope != "tail" && scope != "projection" {
        return Err("scope must be one of: turn, tail, projection".to_string());
    }
    let aborted_at_ms = require_non_negative_ms(input.aborted_at_ms, "abortedAtMs")?;

    let tx = conn
        .transaction()
        .map_err(|error| format!("begin chat_agent cancel turn transaction failed: {error}"))?;
    let changed = tx
        .execute(
            r#"
            UPDATE agent_turns
            SET
              status = 'canceled',
              aborted_at_ms = ?3
            WHERE id = ?1 AND thread_id = ?2
            "#,
            params![&turn_id, &thread_id, aborted_at_ms],
        )
        .map_err(|error| map_sql_error("cancel chat_agent turn failed", error))?;
    if changed == 0 {
        return Err("cancel chat_agent turn failed: turn not found".to_string());
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
        .map_err(|error| format!("query canceled chat_agent turn failed: {error}"))?;
    tx.commit()
        .map_err(|error| format!("commit chat_agent cancel turn transaction failed: {error}"))?;
    Ok(turn)
}

pub(crate) fn rebuild_projection(
    conn: &mut Connection,
    thread_id: &str,
) -> Result<ChatAgentProjectionRebuildResult, String> {
    let tx = conn.transaction().map_err(|error| {
        format!("begin chat_agent rebuild projection transaction failed: {error}")
    })?;
    let result = rebuild_projection_internal(&tx, thread_id)?;
    tx.commit().map_err(|error| {
        format!("commit chat_agent rebuild projection transaction failed: {error}")
    })?;
    Ok(result)
}
