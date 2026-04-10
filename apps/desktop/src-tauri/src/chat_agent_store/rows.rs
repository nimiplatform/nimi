use super::codec::{
    parse_beat_modality, parse_beat_status, parse_json_required, parse_message_kind,
    parse_message_role, parse_message_status, parse_turn_role, parse_turn_status,
};
use super::types::*;

pub(super) fn thread_record_from_row(
    row: &rusqlite::Row<'_>,
) -> Result<ChatAgentThreadRecord, rusqlite::Error> {
    let target_snapshot_json: String = row.get(7)?;
    let target_snapshot = parse_json_required::<ChatAgentTargetSnapshot>(
        target_snapshot_json,
        "agent_threads.target_snapshot_json",
    )
    .map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(
            7,
            rusqlite::types::Type::Text,
            Box::new(std::io::Error::new(std::io::ErrorKind::InvalidData, error)),
        )
    })?;
    Ok(ChatAgentThreadRecord {
        id: row.get(0)?,
        agent_id: row.get(1)?,
        title: row.get(2)?,
        created_at_ms: row.get(3)?,
        updated_at_ms: row.get(4)?,
        last_message_at_ms: row.get(5)?,
        archived_at_ms: row.get(6)?,
        target_snapshot,
    })
}

pub(super) fn message_record_from_row(
    row: &rusqlite::Row<'_>,
) -> Result<ChatAgentMessageRecord, rusqlite::Error> {
    let role_raw: String = row.get(2)?;
    let role = parse_message_role(&role_raw).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(
            2,
            rusqlite::types::Type::Text,
            Box::new(std::io::Error::new(std::io::ErrorKind::InvalidData, error)),
        )
    })?;
    let status_raw: String = row.get(3)?;
    let status = parse_message_status(&status_raw).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(
            3,
            rusqlite::types::Type::Text,
            Box::new(std::io::Error::new(std::io::ErrorKind::InvalidData, error)),
        )
    })?;
    let kind_raw: String = row.get(4)?;
    let kind = parse_message_kind(&kind_raw).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(
            4,
            rusqlite::types::Type::Text,
            Box::new(std::io::Error::new(std::io::ErrorKind::InvalidData, error)),
        )
    })?;
    let reasoning_text: Option<String> = row.get(6)?;
    let error_code: Option<String> = row.get(7)?;
    let error_message: Option<String> = row.get(8)?;
    let metadata_json_raw: Option<String> = row.get(14)?;
    let error = match (error_code, error_message) {
        (None, None) => None,
        (Some(code), Some(message)) => Some(ChatAgentMessageError {
            code: Some(code),
            message,
        }),
        (None, Some(message)) => Some(ChatAgentMessageError {
            code: None,
            message,
        }),
        (Some(_), None) => {
            return Err(rusqlite::Error::FromSqlConversionFailure(
                6,
                rusqlite::types::Type::Text,
                Box::new(std::io::Error::new(
                    std::io::ErrorKind::InvalidData,
                    "agent_messages.error_code/error_message mismatch",
                )),
            ));
        }
    };
    Ok(ChatAgentMessageRecord {
        id: row.get(0)?,
        thread_id: row.get(1)?,
        role,
        status,
        kind,
        content_text: row.get(5)?,
        reasoning_text,
        error,
        trace_id: row.get(9)?,
        parent_message_id: row.get(10)?,
        media_url: row.get(11)?,
        media_mime_type: row.get(12)?,
        artifact_id: row.get(13)?,
        metadata_json: metadata_json_raw
            .map(|raw| parse_json_required(raw, "agent_messages.metadata_json"))
            .transpose()
            .map_err(|error| {
                rusqlite::Error::FromSqlConversionFailure(
                    14,
                    rusqlite::types::Type::Text,
                    Box::new(std::io::Error::new(std::io::ErrorKind::InvalidData, error)),
                )
            })?,
        created_at_ms: row.get(15)?,
        updated_at_ms: row.get(16)?,
    })
}

pub(super) fn draft_record_from_row(
    row: &rusqlite::Row<'_>,
) -> Result<ChatAgentDraftRecord, rusqlite::Error> {
    Ok(ChatAgentDraftRecord {
        thread_id: row.get(0)?,
        text: row.get(1)?,
        updated_at_ms: row.get(2)?,
    })
}

pub(super) fn turn_record_from_row(
    row: &rusqlite::Row<'_>,
) -> Result<ChatAgentTurnRecord, rusqlite::Error> {
    let role_raw: String = row.get(2)?;
    let role = parse_turn_role(&role_raw).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(
            2,
            rusqlite::types::Type::Text,
            Box::new(std::io::Error::new(std::io::ErrorKind::InvalidData, error)),
        )
    })?;
    let status_raw: String = row.get(3)?;
    let status = parse_turn_status(&status_raw).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(
            3,
            rusqlite::types::Type::Text,
            Box::new(std::io::Error::new(std::io::ErrorKind::InvalidData, error)),
        )
    })?;
    Ok(ChatAgentTurnRecord {
        id: row.get(0)?,
        thread_id: row.get(1)?,
        role,
        status,
        provider_mode: row.get(4)?,
        trace_id: row.get(5)?,
        prompt_trace_id: row.get(6)?,
        started_at_ms: row.get(7)?,
        completed_at_ms: row.get(8)?,
        aborted_at_ms: row.get(9)?,
    })
}

pub(super) fn beat_record_from_row(
    row: &rusqlite::Row<'_>,
) -> Result<ChatAgentTurnBeatRecord, rusqlite::Error> {
    let modality_raw: String = row.get(3)?;
    let modality = parse_beat_modality(&modality_raw).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(
            3,
            rusqlite::types::Type::Text,
            Box::new(std::io::Error::new(std::io::ErrorKind::InvalidData, error)),
        )
    })?;
    let status_raw: String = row.get(4)?;
    let status = parse_beat_status(&status_raw).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(
            4,
            rusqlite::types::Type::Text,
            Box::new(std::io::Error::new(std::io::ErrorKind::InvalidData, error)),
        )
    })?;
    Ok(ChatAgentTurnBeatRecord {
        id: row.get(0)?,
        turn_id: row.get(1)?,
        beat_index: row.get(2)?,
        modality,
        status,
        text_shadow: row.get(5)?,
        artifact_id: row.get(6)?,
        mime_type: row.get(7)?,
        media_url: row.get(8)?,
        projection_message_id: row.get(9)?,
        created_at_ms: row.get(10)?,
        delivered_at_ms: row.get(11)?,
    })
}

pub(super) fn interaction_snapshot_record_from_row(
    row: &rusqlite::Row<'_>,
) -> Result<ChatAgentInteractionSnapshotRecord, rusqlite::Error> {
    let assistant_commitments_raw: String = row.get(4)?;
    let user_prefs_raw: String = row.get(5)?;
    let open_loops_raw: String = row.get(6)?;
    Ok(ChatAgentInteractionSnapshotRecord {
        thread_id: row.get(0)?,
        version: row.get(1)?,
        relationship_state: row.get(2)?,
        emotional_temperature: row.get(3)?,
        assistant_commitments_json: parse_json_required(
            assistant_commitments_raw,
            "agent_interaction_snapshots.assistant_commitments_json",
        )
        .map_err(|error| {
            rusqlite::Error::FromSqlConversionFailure(
                4,
                rusqlite::types::Type::Text,
                Box::new(std::io::Error::new(std::io::ErrorKind::InvalidData, error)),
            )
        })?,
        user_prefs_json: parse_json_required(
            user_prefs_raw,
            "agent_interaction_snapshots.user_prefs_json",
        )
        .map_err(|error| {
            rusqlite::Error::FromSqlConversionFailure(
                5,
                rusqlite::types::Type::Text,
                Box::new(std::io::Error::new(std::io::ErrorKind::InvalidData, error)),
            )
        })?,
        open_loops_json: parse_json_required(
            open_loops_raw,
            "agent_interaction_snapshots.open_loops_json",
        )
        .map_err(|error| {
            rusqlite::Error::FromSqlConversionFailure(
                6,
                rusqlite::types::Type::Text,
                Box::new(std::io::Error::new(std::io::ErrorKind::InvalidData, error)),
            )
        })?,
        updated_at_ms: row.get(7)?,
    })
}

pub(super) fn relation_memory_slot_record_from_row(
    row: &rusqlite::Row<'_>,
) -> Result<ChatAgentRelationMemorySlotRecord, rusqlite::Error> {
    Ok(ChatAgentRelationMemorySlotRecord {
        id: row.get(0)?,
        thread_id: row.get(1)?,
        slot_type: row.get(2)?,
        summary: row.get(3)?,
        source_turn_id: row.get(4)?,
        source_beat_id: row.get(5)?,
        score: row.get(6)?,
        updated_at_ms: row.get(7)?,
    })
}

pub(super) fn recall_entry_record_from_row(
    row: &rusqlite::Row<'_>,
) -> Result<ChatAgentRecallEntryRecord, rusqlite::Error> {
    Ok(ChatAgentRecallEntryRecord {
        id: row.get(0)?,
        thread_id: row.get(1)?,
        source_turn_id: row.get(2)?,
        source_beat_id: row.get(3)?,
        summary: row.get(4)?,
        search_text: row.get(5)?,
        updated_at_ms: row.get(6)?,
    })
}
