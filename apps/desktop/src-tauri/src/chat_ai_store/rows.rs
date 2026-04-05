use super::codec::{
    parse_json_map, parse_json_required, parse_message_role, parse_message_status,
    parse_route_kind,
};
use super::types::*;

pub(super) fn thread_record_from_row(
    row: &rusqlite::Row<'_>,
) -> Result<ChatAiThreadRecord, rusqlite::Error> {
    let route_kind_raw: String = row.get(6)?;
    let route_kind = parse_route_kind(&route_kind_raw).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(
            6,
            rusqlite::types::Type::Text,
            Box::new(std::io::Error::new(std::io::ErrorKind::InvalidData, error)),
        )
    })?;
    let route_snapshot = ChatAiRouteSnapshot {
        route_kind,
        connector_id: row.get(7)?,
        provider: row.get(8)?,
        model_id: row.get(9)?,
        route_binding: parse_json_map(row.get(10)?, "ai_threads.route_binding_json").map_err(
            |error| {
                rusqlite::Error::FromSqlConversionFailure(
                    10,
                    rusqlite::types::Type::Text,
                    Box::new(std::io::Error::new(std::io::ErrorKind::InvalidData, error)),
                )
            },
        )?,
    };
    Ok(ChatAiThreadRecord {
        id: row.get(0)?,
        title: row.get(1)?,
        created_at_ms: row.get(2)?,
        updated_at_ms: row.get(3)?,
        last_message_at_ms: row.get(4)?,
        archived_at_ms: row.get(5)?,
        route_snapshot,
    })
}

pub(super) fn message_record_from_row(
    row: &rusqlite::Row<'_>,
) -> Result<ChatAiMessageRecord, rusqlite::Error> {
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
    let error_code: Option<String> = row.get(6)?;
    let error_message: Option<String> = row.get(7)?;
    let error = match (error_code, error_message) {
        (None, None) => None,
        (Some(code), Some(message)) => Some(ChatAiMessageError {
            code: Some(code),
            message,
        }),
        (None, Some(message)) => Some(ChatAiMessageError {
            code: None,
            message,
        }),
        (Some(_), None) => {
            return Err(rusqlite::Error::FromSqlConversionFailure(
                6,
                rusqlite::types::Type::Text,
                Box::new(std::io::Error::new(
                    std::io::ErrorKind::InvalidData,
                    "ai_messages.error_code/error_message mismatch",
                )),
            ));
        }
    };
    let content_json: String = row.get(5)?;
    let content =
        parse_json_required::<ChatAiMessageContent>(content_json, "ai_messages.content_json")
            .map_err(|error| {
                rusqlite::Error::FromSqlConversionFailure(
                    5,
                    rusqlite::types::Type::Text,
                    Box::new(std::io::Error::new(std::io::ErrorKind::InvalidData, error)),
                )
            })?;
    Ok(ChatAiMessageRecord {
        id: row.get(0)?,
        thread_id: row.get(1)?,
        role,
        status,
        content_text: row.get(4)?,
        content,
        error,
        trace_id: row.get(8)?,
        parent_message_id: row.get(9)?,
        created_at_ms: row.get(10)?,
        updated_at_ms: row.get(11)?,
    })
}

pub(super) fn draft_record_from_row(
    row: &rusqlite::Row<'_>,
) -> Result<ChatAiDraftRecord, rusqlite::Error> {
    let attachments_json: Option<String> = row.get(2)?;
    let attachments = match attachments_json {
        Some(value) => parse_json_required::<Vec<ChatAiAttachment>>(
            value,
            "ai_thread_drafts.draft_attachments_json",
        )
        .map_err(|error| {
            rusqlite::Error::FromSqlConversionFailure(
                2,
                rusqlite::types::Type::Text,
                Box::new(std::io::Error::new(std::io::ErrorKind::InvalidData, error)),
            )
        })?,
        None => Vec::new(),
    };
    Ok(ChatAiDraftRecord {
        thread_id: row.get(0)?,
        text: row.get(1)?,
        attachments,
        updated_at_ms: row.get(3)?,
    })
}
