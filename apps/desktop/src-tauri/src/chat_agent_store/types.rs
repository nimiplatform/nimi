use serde::{Deserialize, Serialize};

pub(crate) const CHAT_AGENT_DB_SCHEMA_VERSION: i64 = 1;

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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ChatAgentTargetSnapshot {
    pub agent_id: String,
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
pub struct ChatAgentThreadSummary {
    pub id: String,
    pub agent_id: String,
    pub title: String,
    pub updated_at_ms: i64,
    pub last_message_at_ms: Option<i64>,
    pub archived_at_ms: Option<i64>,
    pub target_snapshot: ChatAgentTargetSnapshot,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ChatAgentThreadRecord {
    pub id: String,
    pub agent_id: String,
    pub title: String,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
    pub last_message_at_ms: Option<i64>,
    pub archived_at_ms: Option<i64>,
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
    pub content_text: String,
    pub reasoning_text: Option<String>,
    pub error: Option<ChatAgentMessageError>,
    pub trace_id: Option<String>,
    pub parent_message_id: Option<String>,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ChatAgentDraftRecord {
    pub thread_id: String,
    pub text: String,
    pub updated_at_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ChatAgentThreadBundle {
    pub thread: ChatAgentThreadRecord,
    pub messages: Vec<ChatAgentMessageRecord>,
    pub draft: Option<ChatAgentDraftRecord>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatAgentCreateThreadInput {
    pub id: String,
    pub agent_id: String,
    pub title: String,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
    pub last_message_at_ms: Option<i64>,
    pub archived_at_ms: Option<i64>,
    pub target_snapshot: ChatAgentTargetSnapshot,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatAgentUpdateThreadMetadataInput {
    pub id: String,
    pub title: String,
    pub updated_at_ms: i64,
    pub last_message_at_ms: Option<i64>,
    pub archived_at_ms: Option<i64>,
    pub target_snapshot: ChatAgentTargetSnapshot,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatAgentCreateMessageInput {
    pub id: String,
    pub thread_id: String,
    pub role: ChatAgentMessageRole,
    pub status: ChatAgentMessageStatus,
    pub content_text: String,
    pub reasoning_text: Option<String>,
    pub error: Option<ChatAgentMessageError>,
    pub trace_id: Option<String>,
    pub parent_message_id: Option<String>,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatAgentUpdateMessageInput {
    pub id: String,
    pub status: ChatAgentMessageStatus,
    pub content_text: String,
    pub reasoning_text: Option<String>,
    pub error: Option<ChatAgentMessageError>,
    pub trace_id: Option<String>,
    pub updated_at_ms: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatAgentThreadLookupPayload {
    pub thread_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatAgentPutDraftInput {
    pub thread_id: String,
    pub text: String,
    pub updated_at_ms: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatAgentDeleteDraftInput {
    pub thread_id: String,
}
