use serde::{Deserialize, Serialize};

pub(crate) const CHAT_AGENT_DB_SCHEMA_VERSION: i64 = 7;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ChatAgentMessageRole {
    System,
    User,
    Assistant,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ChatAgentMessageStatus {
    Pending,
    Complete,
    Error,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ChatAgentMessageKind {
    Text,
    Image,
    Voice,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ChatAgentTargetSnapshot {
    pub owner_user_id: String,
    pub realm_agent_id: String,
    pub local_agent_ref: String,
    pub display_name: String,
    pub handle: String,
    pub avatar_url: Option<String>,
    pub world_id: Option<String>,
    pub world_name: Option<String>,
    pub bio: Option<String>,
    pub ownership_type: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ChatAgentThreadRecord {
    pub id: String,
    pub owner_user_id: String,
    pub realm_agent_id: String,
    pub local_agent_ref: String,
    pub title: String,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
    pub last_message_at_ms: Option<i64>,
    pub target_snapshot: ChatAgentTargetSnapshot,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ChatAgentMessageError {
    pub code: Option<String>,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ChatAgentMessageRecord {
    pub id: String,
    pub thread_id: String,
    pub role: ChatAgentMessageRole,
    pub status: ChatAgentMessageStatus,
    pub kind: ChatAgentMessageKind,
    pub content_text: String,
    pub reasoning_text: Option<String>,
    pub error: Option<ChatAgentMessageError>,
    pub trace_id: Option<String>,
    pub parent_message_id: Option<String>,
    pub media_url: Option<String>,
    pub media_mime_type: Option<String>,
    pub artifact_id: Option<String>,
    pub metadata_json: Option<serde_json::Value>,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ChatAgentThreadBundle {
    pub thread: ChatAgentThreadRecord,
    pub messages: Vec<ChatAgentMessageRecord>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatAgentThreadLookupPayload {
    pub thread_id: String,
}
