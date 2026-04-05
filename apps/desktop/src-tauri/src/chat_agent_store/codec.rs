use super::types::*;
use rusqlite::Error as SqlError;

pub(super) fn normalize_required_string(value: &str, field_name: &str) -> Result<String, String> {
    let normalized = value.trim();
    if normalized.is_empty() {
        return Err(format!("{field_name} must not be empty"));
    }
    Ok(normalized.to_string())
}

pub(super) fn normalize_optional_string(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(|text| text.to_string())
}

pub(super) fn require_non_negative_ms(value: i64, field_name: &str) -> Result<i64, String> {
    if value < 0 {
        return Err(format!("{field_name} must be a non-negative integer"));
    }
    Ok(value)
}

pub(super) fn normalize_target_snapshot(
    snapshot: &ChatAgentTargetSnapshot,
) -> Result<ChatAgentTargetSnapshot, String> {
    Ok(ChatAgentTargetSnapshot {
        agent_id: normalize_required_string(&snapshot.agent_id, "targetSnapshot.agentId")?,
        display_name: normalize_required_string(
            &snapshot.display_name,
            "targetSnapshot.displayName",
        )?,
        handle: normalize_required_string(&snapshot.handle, "targetSnapshot.handle")?,
        avatar_url: normalize_optional_string(snapshot.avatar_url.as_deref()),
        world_id: normalize_optional_string(snapshot.world_id.as_deref()),
        world_name: normalize_optional_string(snapshot.world_name.as_deref()),
        bio: normalize_optional_string(snapshot.bio.as_deref()),
        ownership_type: normalize_optional_string(snapshot.ownership_type.as_deref()),
    })
}

pub(super) fn message_role_to_db_value(value: ChatAgentMessageRole) -> &'static str {
    match value {
        ChatAgentMessageRole::System => "system",
        ChatAgentMessageRole::User => "user",
        ChatAgentMessageRole::Assistant => "assistant",
    }
}

pub(super) fn message_status_to_db_value(value: ChatAgentMessageStatus) -> &'static str {
    match value {
        ChatAgentMessageStatus::Pending => "pending",
        ChatAgentMessageStatus::Complete => "complete",
        ChatAgentMessageStatus::Error => "error",
    }
}

pub(super) fn parse_message_role(value: &str) -> Result<ChatAgentMessageRole, String> {
    match value {
        "system" => Ok(ChatAgentMessageRole::System),
        "user" => Ok(ChatAgentMessageRole::User),
        "assistant" => Ok(ChatAgentMessageRole::Assistant),
        other => Err(format!("chat_agent message role is invalid: {other}")),
    }
}

pub(super) fn parse_message_status(value: &str) -> Result<ChatAgentMessageStatus, String> {
    match value {
        "pending" => Ok(ChatAgentMessageStatus::Pending),
        "complete" => Ok(ChatAgentMessageStatus::Complete),
        "error" => Ok(ChatAgentMessageStatus::Error),
        other => Err(format!("chat_agent message status is invalid: {other}")),
    }
}

pub(super) fn turn_role_to_db_value(value: ChatAgentTurnRole) -> &'static str {
    match value {
        ChatAgentTurnRole::System => "system",
        ChatAgentTurnRole::User => "user",
        ChatAgentTurnRole::Assistant => "assistant",
    }
}

pub(super) fn turn_status_to_db_value(value: ChatAgentTurnStatus) -> &'static str {
    match value {
        ChatAgentTurnStatus::Pending => "pending",
        ChatAgentTurnStatus::Completed => "completed",
        ChatAgentTurnStatus::Failed => "failed",
        ChatAgentTurnStatus::Canceled => "canceled",
    }
}

pub(super) fn beat_modality_to_db_value(value: ChatAgentBeatModality) -> &'static str {
    match value {
        ChatAgentBeatModality::Text => "text",
        ChatAgentBeatModality::Voice => "voice",
        ChatAgentBeatModality::Image => "image",
        ChatAgentBeatModality::Video => "video",
    }
}

pub(super) fn beat_status_to_db_value(value: ChatAgentBeatStatus) -> &'static str {
    match value {
        ChatAgentBeatStatus::Planned => "planned",
        ChatAgentBeatStatus::Sealed => "sealed",
        ChatAgentBeatStatus::Delivered => "delivered",
        ChatAgentBeatStatus::Failed => "failed",
        ChatAgentBeatStatus::Canceled => "canceled",
    }
}

pub(super) fn parse_turn_role(value: &str) -> Result<ChatAgentTurnRole, String> {
    match value {
        "system" => Ok(ChatAgentTurnRole::System),
        "user" => Ok(ChatAgentTurnRole::User),
        "assistant" => Ok(ChatAgentTurnRole::Assistant),
        other => Err(format!("chat_agent turn role is invalid: {other}")),
    }
}

pub(super) fn parse_turn_status(value: &str) -> Result<ChatAgentTurnStatus, String> {
    match value {
        "pending" => Ok(ChatAgentTurnStatus::Pending),
        "completed" => Ok(ChatAgentTurnStatus::Completed),
        "failed" => Ok(ChatAgentTurnStatus::Failed),
        "canceled" => Ok(ChatAgentTurnStatus::Canceled),
        other => Err(format!("chat_agent turn status is invalid: {other}")),
    }
}

pub(super) fn parse_beat_modality(value: &str) -> Result<ChatAgentBeatModality, String> {
    match value {
        "text" => Ok(ChatAgentBeatModality::Text),
        "voice" => Ok(ChatAgentBeatModality::Voice),
        "image" => Ok(ChatAgentBeatModality::Image),
        "video" => Ok(ChatAgentBeatModality::Video),
        other => Err(format!("chat_agent beat modality is invalid: {other}")),
    }
}

pub(super) fn parse_beat_status(value: &str) -> Result<ChatAgentBeatStatus, String> {
    match value {
        "planned" => Ok(ChatAgentBeatStatus::Planned),
        "sealed" => Ok(ChatAgentBeatStatus::Sealed),
        "delivered" => Ok(ChatAgentBeatStatus::Delivered),
        "failed" => Ok(ChatAgentBeatStatus::Failed),
        "canceled" => Ok(ChatAgentBeatStatus::Canceled),
        other => Err(format!("chat_agent beat status is invalid: {other}")),
    }
}

pub(super) fn normalize_message_error(
    error: Option<&ChatAgentMessageError>,
) -> Result<Option<ChatAgentMessageError>, String> {
    error
        .map(|value| {
            Ok(ChatAgentMessageError {
                code: normalize_optional_string(value.code.as_deref()),
                message: normalize_required_string(&value.message, "error.message")?,
            })
        })
        .transpose()
}

pub(super) fn normalize_f64(value: f64, field_name: &str) -> Result<f64, String> {
    if !value.is_finite() {
        return Err(format!("{field_name} must be finite"));
    }
    Ok(value)
}

pub(super) fn normalize_non_negative_f64(value: f64, field_name: &str) -> Result<f64, String> {
    let value = normalize_f64(value, field_name)?;
    if value < 0.0 {
        return Err(format!("{field_name} must be non-negative"));
    }
    Ok(value)
}

pub(super) fn normalize_structured_json(
    value: &serde_json::Value,
    field_name: &str,
) -> Result<serde_json::Value, String> {
    if value.is_array() || value.is_object() {
        return Ok(value.clone());
    }
    Err(format!("{field_name} must be an array or object"))
}

pub(super) fn serialize_json_value<T: serde::Serialize>(
    value: &T,
    field_name: &str,
) -> Result<String, String> {
    serde_json::to_string(value).map_err(|error| format!("serialize {field_name} failed: {error}"))
}

pub(super) fn parse_json_required<T: serde::de::DeserializeOwned>(
    raw: String,
    field_name: &str,
) -> Result<T, String> {
    serde_json::from_str::<T>(&raw)
        .map_err(|error| format!("{field_name} contains invalid JSON: {error}"))
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

pub(super) fn normalize_positive_limit(
    value: Option<i64>,
    field_name: &str,
    default_value: i64,
) -> Result<i64, String> {
    match value {
        None => Ok(default_value),
        Some(next) if next > 0 => Ok(next),
        Some(_) => Err(format!("{field_name} must be a positive integer")),
    }
}
