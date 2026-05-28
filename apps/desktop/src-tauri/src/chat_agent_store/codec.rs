use super::types::*;

pub(super) fn normalize_required_string(value: &str, field_name: &str) -> Result<String, String> {
    let normalized = value.trim();
    if normalized.is_empty() {
        return Err(format!("{field_name} must not be empty"));
    }
    Ok(normalized.to_string())
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

pub(super) fn parse_message_kind(value: &str) -> Result<ChatAgentMessageKind, String> {
    match value {
        "text" => Ok(ChatAgentMessageKind::Text),
        "image" => Ok(ChatAgentMessageKind::Image),
        "voice" => Ok(ChatAgentMessageKind::Voice),
        other => Err(format!("chat_agent message kind is invalid: {other}")),
    }
}

pub(super) fn parse_json_required<T: serde::de::DeserializeOwned>(
    raw: String,
    field_name: &str,
) -> Result<T, String> {
    serde_json::from_str::<T>(&raw)
        .map_err(|error| format!("{field_name} contains invalid JSON: {error}"))
}
