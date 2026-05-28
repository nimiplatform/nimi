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

fn build_local_agent_ref(owner_user_id: &str, realm_agent_id: &str) -> String {
    format!("local-agent:{owner_user_id}:{realm_agent_id}")
}

pub(super) fn normalize_local_agent_identity(
    owner_user_id: &str,
    realm_agent_id: &str,
    local_agent_ref: &str,
    field_prefix: &str,
) -> Result<(String, String, String), String> {
    let owner_user_id =
        normalize_required_string(owner_user_id, &format!("{field_prefix}.ownerUserId"))?;
    let realm_agent_id =
        normalize_required_string(realm_agent_id, &format!("{field_prefix}.realmAgentId"))?;
    let local_agent_ref =
        normalize_required_string(local_agent_ref, &format!("{field_prefix}.localAgentRef"))?;
    if local_agent_ref == realm_agent_id {
        return Err(format!(
            "{field_prefix}.localAgentRef must not be bare realmAgentId"
        ));
    }
    if !local_agent_ref.starts_with("local-agent:") {
        return Err(format!(
            "{field_prefix}.localAgentRef must start with local-agent:"
        ));
    }
    let expected = build_local_agent_ref(&owner_user_id, &realm_agent_id);
    if local_agent_ref != expected {
        return Err(format!(
            "{field_prefix}.localAgentRef must equal local-agent:${{ownerUserId}}:${{realmAgentId}}"
        ));
    }
    Ok((owner_user_id, realm_agent_id, local_agent_ref))
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
    let (owner_user_id, realm_agent_id, local_agent_ref) = normalize_local_agent_identity(
        &snapshot.owner_user_id,
        &snapshot.realm_agent_id,
        &snapshot.local_agent_ref,
        "targetSnapshot",
    )?;
    Ok(ChatAgentTargetSnapshot {
        owner_user_id,
        realm_agent_id,
        local_agent_ref,
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
