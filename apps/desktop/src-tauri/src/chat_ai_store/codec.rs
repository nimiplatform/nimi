use super::types::*;
use rusqlite::Error as SqlError;
use serde_json::{Map as JsonMap, Value as JsonValue};

pub(super) fn normalize_required_string(value: &str, field_name: &str) -> Result<String, String> {
    let normalized = value.trim();
    if normalized.is_empty() {
        return Err(format!("{field_name} must not be empty"));
    }
    Ok(normalized.to_string())
}

pub(super) fn require_non_negative_ms(value: i64, field_name: &str) -> Result<i64, String> {
    if value < 0 {
        return Err(format!("{field_name} must be a non-negative integer"));
    }
    Ok(value)
}

pub(super) fn normalize_optional_string(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(|text| text.to_string())
}

pub(super) fn normalize_route_snapshot(
    snapshot: &ChatAiRouteSnapshot,
) -> Result<ChatAiRouteSnapshot, String> {
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

pub(super) fn route_kind_to_db_value(value: ChatAiRouteKind) -> &'static str {
    match value {
        ChatAiRouteKind::Local => "local",
        ChatAiRouteKind::Cloud => "cloud",
    }
}

pub(super) fn message_role_to_db_value(value: ChatAiMessageRole) -> &'static str {
    match value {
        ChatAiMessageRole::System => "system",
        ChatAiMessageRole::User => "user",
        ChatAiMessageRole::Assistant => "assistant",
        ChatAiMessageRole::Tool => "tool",
    }
}

pub(super) fn message_status_to_db_value(value: ChatAiMessageStatus) -> &'static str {
    match value {
        ChatAiMessageStatus::Pending => "pending",
        ChatAiMessageStatus::Streaming => "streaming",
        ChatAiMessageStatus::Complete => "complete",
        ChatAiMessageStatus::Error => "error",
        ChatAiMessageStatus::Canceled => "canceled",
    }
}

pub(super) fn parse_route_kind(value: &str) -> Result<ChatAiRouteKind, String> {
    match value {
        "local" => Ok(ChatAiRouteKind::Local),
        "cloud" => Ok(ChatAiRouteKind::Cloud),
        other => Err(format!("chat_ai route_kind is invalid: {other}")),
    }
}

pub(super) fn parse_message_role(value: &str) -> Result<ChatAiMessageRole, String> {
    match value {
        "system" => Ok(ChatAiMessageRole::System),
        "user" => Ok(ChatAiMessageRole::User),
        "assistant" => Ok(ChatAiMessageRole::Assistant),
        "tool" => Ok(ChatAiMessageRole::Tool),
        other => Err(format!("chat_ai message role is invalid: {other}")),
    }
}

pub(super) fn parse_message_status(value: &str) -> Result<ChatAiMessageStatus, String> {
    match value {
        "pending" => Ok(ChatAiMessageStatus::Pending),
        "streaming" => Ok(ChatAiMessageStatus::Streaming),
        "complete" => Ok(ChatAiMessageStatus::Complete),
        "error" => Ok(ChatAiMessageStatus::Error),
        "canceled" => Ok(ChatAiMessageStatus::Canceled),
        other => Err(format!("chat_ai message status is invalid: {other}")),
    }
}

pub(super) fn normalize_message_content(
    content: &ChatAiMessageContent,
) -> Result<ChatAiMessageContent, String> {
    let parts = content
        .parts
        .iter()
        .map(|part| -> Result<ChatAiMessagePart, String> {
            match part {
                ChatAiMessagePart::Text(value) => Ok(ChatAiMessagePart::Text(ChatAiMessagePartText {
                    text: value.text.clone(),
                })),
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

pub(super) fn normalize_attachments(
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

pub(super) fn normalize_message_error(
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

pub(super) fn map_sql_error(context: &str, error: SqlError) -> String {
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

pub(super) fn serialize_json_map(
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

pub(super) fn serialize_json_value<T: serde::Serialize>(
    value: &T,
    field_name: &str,
) -> Result<String, String> {
    serde_json::to_string(value).map_err(|error| format!("serialize {field_name} failed: {error}"))
}

pub(super) fn parse_json_map(
    raw: Option<String>,
    field_name: &str,
) -> Result<Option<JsonMap<String, JsonValue>>, String> {
    raw.map(|value| {
        serde_json::from_str::<JsonMap<String, JsonValue>>(&value)
            .map_err(|error| format!("{field_name} contains invalid JSON: {error}"))
    })
    .transpose()
}

pub(super) fn parse_json_required<T: serde::de::DeserializeOwned>(
    raw: String,
    field_name: &str,
) -> Result<T, String> {
    serde_json::from_str::<T>(&raw)
        .map_err(|error| format!("{field_name} contains invalid JSON: {error}"))
}
