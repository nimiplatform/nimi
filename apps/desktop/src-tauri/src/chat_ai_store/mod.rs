use rusqlite::{params, Connection, Error as SqlError, OptionalExtension};
use serde_json::{Map as JsonMap, Value as JsonValue};

mod commands;
mod db;
mod schema;
mod types;

pub(crate) use commands::*;
pub(crate) use db::open_db;
pub(crate) use types::*;

fn normalize_required_string(value: &str, field_name: &str) -> Result<String, String> {
    let normalized = value.trim();
    if normalized.is_empty() {
        return Err(format!("{field_name} must not be empty"));
    }
    Ok(normalized.to_string())
}

fn require_non_negative_ms(value: i64, field_name: &str) -> Result<i64, String> {
    if value < 0 {
        return Err(format!("{field_name} must be a non-negative integer"));
    }
    Ok(value)
}

fn normalize_optional_string(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(|text| text.to_string())
}

fn normalize_route_snapshot(snapshot: &ChatAiRouteSnapshot) -> Result<ChatAiRouteSnapshot, String> {
    let connector_id = normalize_optional_string(snapshot.connector_id.as_deref());
    let provider = normalize_optional_string(snapshot.provider.as_deref());
    let model_id = normalize_optional_string(snapshot.model_id.as_deref());
    let route_binding = snapshot.route_binding.clone();
    match snapshot.route_kind {
        ChatAiRouteKind::Local => {
            if connector_id.is_some() || provider.is_some() || model_id.is_some() {
                return Err(
                    "routeSnapshot.local must not include connectorId/provider/modelId".to_string(),
                );
            }
        }
        ChatAiRouteKind::Cloud => {
            if connector_id.is_none() {
                return Err("routeSnapshot.cloud.connectorId is required".to_string());
            }
            if provider.is_none() {
                return Err("routeSnapshot.cloud.provider is required".to_string());
            }
        }
    }
    Ok(ChatAiRouteSnapshot {
        route_kind: snapshot.route_kind,
        connector_id,
        provider,
        model_id,
        route_binding,
    })
}

fn route_kind_to_db_value(value: ChatAiRouteKind) -> &'static str {
    match value {
        ChatAiRouteKind::Local => "local",
        ChatAiRouteKind::Cloud => "cloud",
    }
}

fn message_role_to_db_value(value: ChatAiMessageRole) -> &'static str {
    match value {
        ChatAiMessageRole::System => "system",
        ChatAiMessageRole::User => "user",
        ChatAiMessageRole::Assistant => "assistant",
        ChatAiMessageRole::Tool => "tool",
    }
}

fn message_status_to_db_value(value: ChatAiMessageStatus) -> &'static str {
    match value {
        ChatAiMessageStatus::Pending => "pending",
        ChatAiMessageStatus::Streaming => "streaming",
        ChatAiMessageStatus::Complete => "complete",
        ChatAiMessageStatus::Error => "error",
        ChatAiMessageStatus::Canceled => "canceled",
    }
}

fn parse_route_kind(value: &str) -> Result<ChatAiRouteKind, String> {
    match value {
        "local" => Ok(ChatAiRouteKind::Local),
        "cloud" => Ok(ChatAiRouteKind::Cloud),
        other => Err(format!("chat_ai route_kind is invalid: {other}")),
    }
}

fn parse_message_role(value: &str) -> Result<ChatAiMessageRole, String> {
    match value {
        "system" => Ok(ChatAiMessageRole::System),
        "user" => Ok(ChatAiMessageRole::User),
        "assistant" => Ok(ChatAiMessageRole::Assistant),
        "tool" => Ok(ChatAiMessageRole::Tool),
        other => Err(format!("chat_ai message role is invalid: {other}")),
    }
}

fn parse_message_status(value: &str) -> Result<ChatAiMessageStatus, String> {
    match value {
        "pending" => Ok(ChatAiMessageStatus::Pending),
        "streaming" => Ok(ChatAiMessageStatus::Streaming),
        "complete" => Ok(ChatAiMessageStatus::Complete),
        "error" => Ok(ChatAiMessageStatus::Error),
        "canceled" => Ok(ChatAiMessageStatus::Canceled),
        other => Err(format!("chat_ai message status is invalid: {other}")),
    }
}

fn normalize_message_content(
    content: &ChatAiMessageContent,
) -> Result<ChatAiMessageContent, String> {
    let parts = content
        .parts
        .iter()
        .map(|part| -> Result<ChatAiMessagePart, String> {
            match part {
                ChatAiMessagePart::Text(value) => {
                    Ok(ChatAiMessagePart::Text(ChatAiMessagePartText {
                        text: normalize_required_string(&value.text, "content.parts[].text")?,
                    }))
                }
            }
        })
        .collect::<Result<Vec<_>, _>>()?;

    let tool_calls = content
        .tool_calls
        .iter()
        .map(|tool_call| {
            let tool_call_id = normalize_required_string(
                &tool_call.tool_call_id,
                "content.toolCalls[].toolCallId",
            )?;
            let tool_name =
                normalize_required_string(&tool_call.tool_name, "content.toolCalls[].toolName")?;
            if !tool_call.input.is_object() {
                return Err("content.toolCalls[].input must be an object".to_string());
            }
            if let Some(output) = &tool_call.output {
                if !output.is_object() && !output.is_array() && !output.is_null() {
                    return Err(
                        "content.toolCalls[].output must be an object, array, or null".to_string(),
                    );
                }
            }
            let error = tool_call
                .error
                .as_ref()
                .map(|item| -> Result<ChatAiToolCallError, String> {
                    Ok(ChatAiToolCallError {
                        code: normalize_optional_string(item.code.as_deref()),
                        message: normalize_required_string(
                            &item.message,
                            "content.toolCalls[].error.message",
                        )?,
                    })
                })
                .transpose()?;
            Ok(ChatAiToolCall {
                tool_call_id,
                tool_name,
                status: tool_call.status,
                input: tool_call.input.clone(),
                output: tool_call.output.clone(),
                error,
            })
        })
        .collect::<Result<Vec<_>, String>>()?;

    let attachments = normalize_attachments(&content.attachments, "content.attachments")?;
    Ok(ChatAiMessageContent {
        parts,
        tool_calls,
        attachments,
        metadata: content.metadata.clone(),
    })
}

fn normalize_attachments(
    attachments: &[ChatAiAttachment],
    field_name: &str,
) -> Result<Vec<ChatAiAttachment>, String> {
    attachments
        .iter()
        .map(|attachment| {
            let attachment_id = normalize_required_string(
                &attachment.attachment_id,
                &format!("{field_name}[].attachmentId"),
            )?;
            let name =
                normalize_required_string(&attachment.name, &format!("{field_name}[].name"))?;
            let mime_type = normalize_required_string(
                &attachment.mime_type,
                &format!("{field_name}[].mimeType"),
            )?;
            if attachment.size_bytes < 0 {
                return Err(format!("{field_name}[].sizeBytes must be >= 0"));
            }
            Ok(ChatAiAttachment {
                attachment_id,
                name,
                mime_type,
                size_bytes: attachment.size_bytes,
            })
        })
        .collect()
}

fn normalize_message_error(
    error: Option<&ChatAiMessageError>,
) -> Result<Option<ChatAiMessageError>, String> {
    error
        .map(|value| {
            Ok(ChatAiMessageError {
                code: normalize_optional_string(value.code.as_deref()),
                message: normalize_required_string(&value.message, "error.message")?,
            })
        })
        .transpose()
}

fn map_sql_error(context: &str, error: SqlError) -> String {
    match error {
        SqlError::SqliteFailure(code, message) => {
            if code.extended_code == rusqlite::ffi::SQLITE_CONSTRAINT_PRIMARYKEY
                || code.extended_code == rusqlite::ffi::SQLITE_CONSTRAINT_UNIQUE
            {
                return format!("{context}: duplicate primary key or unique value");
            }
            if code.extended_code == rusqlite::ffi::SQLITE_CONSTRAINT_FOREIGNKEY {
                return format!("{context}: missing referenced thread");
            }
            format!("{context}: {}", message.unwrap_or_else(|| code.to_string()))
        }
        other => format!("{context}: {other}"),
    }
}

fn serialize_json_map(
    value: &Option<JsonMap<String, JsonValue>>,
    field_name: &str,
) -> Result<Option<String>, String> {
    value
        .as_ref()
        .map(|item| {
            serde_json::to_string(item)
                .map_err(|error| format!("serialize {field_name} failed: {error}"))
        })
        .transpose()
}

fn serialize_json_value<T: serde::Serialize>(
    value: &T,
    field_name: &str,
) -> Result<String, String> {
    serde_json::to_string(value).map_err(|error| format!("serialize {field_name} failed: {error}"))
}

fn parse_json_map(
    raw: Option<String>,
    field_name: &str,
) -> Result<Option<JsonMap<String, JsonValue>>, String> {
    raw.map(|value| {
        serde_json::from_str::<JsonMap<String, JsonValue>>(&value)
            .map_err(|error| format!("{field_name} contains invalid JSON: {error}"))
    })
    .transpose()
}

fn parse_json_required<T: serde::de::DeserializeOwned>(
    raw: String,
    field_name: &str,
) -> Result<T, String> {
    serde_json::from_str::<T>(&raw)
        .map_err(|error| format!("{field_name} contains invalid JSON: {error}"))
}

fn thread_record_from_row(row: &rusqlite::Row<'_>) -> Result<ChatAiThreadRecord, rusqlite::Error> {
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

fn message_record_from_row(
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
            ))
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

fn draft_record_from_row(row: &rusqlite::Row<'_>) -> Result<ChatAiDraftRecord, rusqlite::Error> {
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

fn summarize_thread(record: ChatAiThreadRecord) -> ChatAiThreadSummary {
    ChatAiThreadSummary {
        id: record.id,
        title: record.title,
        updated_at_ms: record.updated_at_ms,
        last_message_at_ms: record.last_message_at_ms,
        archived_at_ms: record.archived_at_ms,
        route_snapshot: record.route_snapshot,
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
              archived_at_ms,
              route_kind,
              connector_id,
              provider,
              model_id,
              route_binding_json
            FROM ai_threads
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
              archived_at_ms,
              route_kind,
              connector_id,
              provider,
              model_id,
              route_binding_json
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
    let route_snapshot = normalize_route_snapshot(&input.route_snapshot)?;
    conn.execute(
        r#"
        INSERT INTO ai_threads (
          id,
          title,
          created_at_ms,
          updated_at_ms,
          last_message_at_ms,
          archived_at_ms,
          route_kind,
          connector_id,
          provider,
          model_id,
          route_binding_json
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
        "#,
        params![
            id,
            title,
            created_at_ms,
            updated_at_ms,
            last_message_at_ms,
            archived_at_ms,
            route_kind_to_db_value(route_snapshot.route_kind),
            route_snapshot.connector_id.clone(),
            route_snapshot.provider.clone(),
            route_snapshot.model_id.clone(),
            serialize_json_map(&route_snapshot.route_binding, "routeSnapshot.routeBinding")?
        ],
    )
    .map_err(|error| map_sql_error("create chat_ai thread failed", error))?;
    Ok(ChatAiThreadRecord {
        id,
        title,
        created_at_ms,
        updated_at_ms,
        last_message_at_ms,
        archived_at_ms,
        route_snapshot,
    })
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
    let route_snapshot = normalize_route_snapshot(&input.route_snapshot)?;

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
              archived_at_ms = ?5,
              route_kind = ?6,
              connector_id = ?7,
              provider = ?8,
              model_id = ?9,
              route_binding_json = ?10
            WHERE id = ?1
            "#,
            params![
                &id,
                &title,
                updated_at_ms,
                last_message_at_ms,
                archived_at_ms,
                route_kind_to_db_value(route_snapshot.route_kind),
                route_snapshot.connector_id.clone(),
                route_snapshot.provider.clone(),
                route_snapshot.model_id.clone(),
                serialize_json_map(&route_snapshot.route_binding, "routeSnapshot.routeBinding")?
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
        route_snapshot,
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::with_env;
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_home(prefix: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("nimi-chat-ai-{prefix}-{unique}"));
        fs::create_dir_all(&dir).expect("create temp home");
        dir
    }

    fn sample_route_snapshot() -> ChatAiRouteSnapshot {
        ChatAiRouteSnapshot {
            route_kind: ChatAiRouteKind::Cloud,
            connector_id: Some("connector-openai".to_string()),
            provider: Some("openai".to_string()),
            model_id: Some("gpt-5.4-mini".to_string()),
            route_binding: Some(JsonMap::from_iter([(
                "temperature".to_string(),
                JsonValue::from(0.3),
            )])),
        }
    }

    fn sample_content(text: &str) -> ChatAiMessageContent {
        ChatAiMessageContent {
            parts: vec![ChatAiMessagePart::Text(ChatAiMessagePartText {
                text: text.to_string(),
            })],
            tool_calls: Vec::new(),
            attachments: Vec::new(),
            metadata: JsonMap::new(),
        }
    }

    #[test]
    fn chat_ai_db_path_stays_under_nimi_data_dir() {
        let home = temp_home("db-path");
        with_env(&[("HOME", home.to_str())], || {
            let path = super::db::db_path().expect("db path");
            assert_eq!(
                path,
                crate::desktop_paths::resolve_nimi_data_dir()
                    .expect("nimi data dir")
                    .join("chat-ai")
                    .join("main.db")
            );
        });
    }

    #[test]
    fn chat_ai_open_db_initializes_schema_idempotently() {
        let home = temp_home("schema");
        with_env(&[("HOME", home.to_str())], || {
            let path = crate::desktop_paths::resolve_nimi_data_dir()
                .expect("nimi data dir")
                .join("chat-ai")
                .join("main.db");
            fs::create_dir_all(path.parent().expect("parent")).expect("create parent");
            let conn = Connection::open(&path).expect("open");
            super::schema::init_schema(&conn).expect("init schema");
            super::schema::init_schema(&conn).expect("init schema again");

            let version: i64 = conn
                .query_row("PRAGMA user_version", [], |row| row.get(0))
                .expect("user_version");
            assert_eq!(version, CHAT_AI_DB_SCHEMA_VERSION);
        });
    }

    #[test]
    fn chat_ai_store_round_trip_thread_message_and_draft() {
        let home = temp_home("roundtrip");
        with_env(&[("HOME", home.to_str())], || {
            let path = crate::desktop_paths::resolve_nimi_data_dir()
                .expect("nimi data dir")
                .join("chat-ai")
                .join("main.db");
            fs::create_dir_all(path.parent().expect("parent")).expect("create parent");
            let conn = Connection::open(&path).expect("open");
            super::schema::init_schema(&conn).expect("init schema");

            let thread = create_thread(
                &conn,
                &ChatAiCreateThreadInput {
                    id: "thread-ai-001".to_string(),
                    title: "AI thread".to_string(),
                    created_at_ms: 100,
                    updated_at_ms: 120,
                    last_message_at_ms: None,
                    archived_at_ms: None,
                    route_snapshot: sample_route_snapshot(),
                },
            )
            .expect("create thread");
            assert_eq!(thread.id, "thread-ai-001");

            let message = create_message(
                &conn,
                &ChatAiCreateMessageInput {
                    id: "message-001".to_string(),
                    thread_id: thread.id.clone(),
                    role: ChatAiMessageRole::User,
                    status: ChatAiMessageStatus::Complete,
                    content_text: "hello".to_string(),
                    content: sample_content("hello"),
                    error: None,
                    trace_id: Some("trace-001".to_string()),
                    parent_message_id: None,
                    created_at_ms: 130,
                    updated_at_ms: 130,
                },
            )
            .expect("create message");
            assert_eq!(message.trace_id.as_deref(), Some("trace-001"));

            let draft = put_draft(
                &conn,
                &ChatAiPutDraftInput {
                    thread_id: thread.id.clone(),
                    text: "draft".to_string(),
                    attachments: vec![ChatAiAttachment {
                        attachment_id: "attachment-001".to_string(),
                        name: "note.txt".to_string(),
                        mime_type: "text/plain".to_string(),
                        size_bytes: 42,
                    }],
                    updated_at_ms: 140,
                },
            )
            .expect("put draft");
            assert_eq!(draft.attachments.len(), 1);

            let threads = list_threads(&conn).expect("list threads");
            assert_eq!(threads.len(), 1);
            assert_eq!(
                threads[0].route_snapshot.provider.as_deref(),
                Some("openai")
            );

            let bundle = get_thread_bundle(&conn, &thread.id)
                .expect("bundle")
                .expect("bundle present");
            assert_eq!(bundle.messages.len(), 1);
            assert_eq!(bundle.messages[0].content.parts.len(), 1);
            assert_eq!(bundle.draft.expect("draft").text, "draft");
        });
    }

    #[test]
    fn chat_ai_store_rejects_missing_thread_duplicate_id_and_invalid_json() {
        let home = temp_home("errors");
        with_env(&[("HOME", home.to_str())], || {
            let path = crate::desktop_paths::resolve_nimi_data_dir()
                .expect("nimi data dir")
                .join("chat-ai")
                .join("main.db");
            fs::create_dir_all(path.parent().expect("parent")).expect("create parent");
            let conn = Connection::open(&path).expect("open");
            super::schema::init_schema(&conn).expect("init schema");

            let create_missing_thread_message = create_message(
                &conn,
                &ChatAiCreateMessageInput {
                    id: "message-orphan".to_string(),
                    thread_id: "missing-thread".to_string(),
                    role: ChatAiMessageRole::User,
                    status: ChatAiMessageStatus::Complete,
                    content_text: "hello".to_string(),
                    content: sample_content("hello"),
                    error: None,
                    trace_id: None,
                    parent_message_id: None,
                    created_at_ms: 100,
                    updated_at_ms: 100,
                },
            )
            .expect_err("missing thread should fail");
            assert!(create_missing_thread_message.contains("missing referenced thread"));

            create_thread(
                &conn,
                &ChatAiCreateThreadInput {
                    id: "thread-ai-dup".to_string(),
                    title: "AI thread".to_string(),
                    created_at_ms: 100,
                    updated_at_ms: 120,
                    last_message_at_ms: None,
                    archived_at_ms: None,
                    route_snapshot: sample_route_snapshot(),
                },
            )
            .expect("create thread");
            let duplicate = create_thread(
                &conn,
                &ChatAiCreateThreadInput {
                    id: "thread-ai-dup".to_string(),
                    title: "AI thread 2".to_string(),
                    created_at_ms: 101,
                    updated_at_ms: 121,
                    last_message_at_ms: None,
                    archived_at_ms: None,
                    route_snapshot: sample_route_snapshot(),
                },
            )
            .expect_err("duplicate thread");
            assert!(duplicate.contains("duplicate primary key"));

            conn.execute(
                r#"
                INSERT INTO ai_messages (
                  id, thread_id, role, status, content_text, content_json, error_code, error_message,
                  trace_id, parent_message_id, created_at_ms, updated_at_ms
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL, NULL, NULL, NULL, ?7, ?8)
                "#,
                params![
                    "message-bad-json",
                    "thread-ai-dup",
                    "assistant",
                    "complete",
                    "bad",
                    "{bad-json",
                    200_i64,
                    200_i64,
                ],
            )
            .expect("insert bad json");
            let bundle_error =
                get_thread_bundle(&conn, "thread-ai-dup").expect_err("bad json should fail");
            assert!(bundle_error.contains("invalid JSON"));
        });
    }

    #[test]
    fn chat_ai_draft_put_overwrites_and_delete_clears() {
        let home = temp_home("draft");
        with_env(&[("HOME", home.to_str())], || {
            let path = crate::desktop_paths::resolve_nimi_data_dir()
                .expect("nimi data dir")
                .join("chat-ai")
                .join("main.db");
            fs::create_dir_all(path.parent().expect("parent")).expect("create parent");
            let conn = Connection::open(&path).expect("open");
            super::schema::init_schema(&conn).expect("init schema");

            create_thread(
                &conn,
                &ChatAiCreateThreadInput {
                    id: "thread-draft-001".to_string(),
                    title: "AI thread".to_string(),
                    created_at_ms: 100,
                    updated_at_ms: 120,
                    last_message_at_ms: None,
                    archived_at_ms: None,
                    route_snapshot: sample_route_snapshot(),
                },
            )
            .expect("create thread");

            put_draft(
                &conn,
                &ChatAiPutDraftInput {
                    thread_id: "thread-draft-001".to_string(),
                    text: "draft-1".to_string(),
                    attachments: Vec::new(),
                    updated_at_ms: 200,
                },
            )
            .expect("draft 1");
            let updated = put_draft(
                &conn,
                &ChatAiPutDraftInput {
                    thread_id: "thread-draft-001".to_string(),
                    text: "draft-2".to_string(),
                    attachments: Vec::new(),
                    updated_at_ms: 210,
                },
            )
            .expect("draft 2");
            assert_eq!(updated.text, "draft-2");
            delete_draft(&conn, "thread-draft-001").expect("delete draft");
            assert!(get_draft(&conn, "thread-draft-001")
                .expect("get draft")
                .is_none());
        });
    }
}
