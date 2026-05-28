use super::codec::{
    parse_json_required, parse_message_kind, parse_message_role, parse_message_status,
};
use super::types::*;

pub(super) fn thread_record_from_row(
    row: &rusqlite::Row<'_>,
) -> Result<ChatAgentThreadRecord, rusqlite::Error> {
    let target_snapshot_json: String = row.get(8)?;
    let target_snapshot = parse_json_required::<ChatAgentTargetSnapshot>(
        target_snapshot_json,
        "agent_threads.target_snapshot_json",
    )
    .map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(
            8,
            rusqlite::types::Type::Text,
            Box::new(std::io::Error::new(std::io::ErrorKind::InvalidData, error)),
        )
    })?;
    Ok(ChatAgentThreadRecord {
        id: row.get(0)?,
        local_agent_ref: row.get(1)?,
        owner_user_id: row.get(2)?,
        realm_agent_id: row.get(3)?,
        title: row.get(4)?,
        created_at_ms: row.get(5)?,
        updated_at_ms: row.get(6)?,
        last_message_at_ms: row.get(7)?,
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
