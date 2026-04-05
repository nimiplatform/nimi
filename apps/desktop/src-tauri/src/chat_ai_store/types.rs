use serde::{Deserialize, Serialize};
use serde_json::{Map as JsonMap, Value as JsonValue};

pub(crate) const CHAT_AI_DB_SCHEMA_VERSION: i64 = 1;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ChatAiRouteKind {
    Local,
    Cloud,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ChatAiMessageRole {
    System,
    User,
    Assistant,
    Tool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ChatAiMessageStatus {
    Pending,
    Streaming,
    Complete,
    Error,
    Canceled,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ChatAiRouteSnapshot {
    pub route_kind: ChatAiRouteKind,
    pub connector_id: Option<String>,
    pub provider: Option<String>,
    pub model_id: Option<String>,
    pub route_binding: Option<JsonMap<String, JsonValue>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ChatAiThreadSummary {
    pub id: String,
    pub title: String,
    pub updated_at_ms: i64,
    pub last_message_at_ms: Option<i64>,
    pub archived_at_ms: Option<i64>,
    pub route_snapshot: ChatAiRouteSnapshot,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ChatAiThreadRecord {
    pub id: String,
    pub title: String,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
    pub last_message_at_ms: Option<i64>,
    pub archived_at_ms: Option<i64>,
    pub route_snapshot: ChatAiRouteSnapshot,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ChatAiMessagePartText {
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ChatAiMessagePart {
    Text(ChatAiMessagePartText),
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ChatAiToolCallError {
    pub code: Option<String>,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ChatAiToolCall {
    pub tool_call_id: String,
    pub tool_name: String,
    pub status: ChatAiMessageStatus,
    pub input: JsonValue,
    pub output: Option<JsonValue>,
    pub error: Option<ChatAiToolCallError>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ChatAiAttachment {
    pub attachment_id: String,
    pub name: String,
    pub mime_type: String,
    pub size_bytes: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ChatAiMessageContent {
    pub parts: Vec<ChatAiMessagePart>,
    pub tool_calls: Vec<ChatAiToolCall>,
    pub attachments: Vec<ChatAiAttachment>,
    pub metadata: JsonMap<String, JsonValue>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ChatAiMessageError {
    pub code: Option<String>,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ChatAiMessageRecord {
    pub id: String,
    pub thread_id: String,
    pub role: ChatAiMessageRole,
    pub status: ChatAiMessageStatus,
    pub content_text: String,
    pub content: ChatAiMessageContent,
    pub error: Option<ChatAiMessageError>,
    pub trace_id: Option<String>,
    pub parent_message_id: Option<String>,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ChatAiDraftRecord {
    pub thread_id: String,
    pub text: String,
    pub attachments: Vec<ChatAiAttachment>,
    pub updated_at_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ChatAiThreadBundle {
    pub thread: ChatAiThreadRecord,
    pub messages: Vec<ChatAiMessageRecord>,
    pub draft: Option<ChatAiDraftRecord>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatAiCreateThreadInput {
    pub id: String,
    pub title: String,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
    pub last_message_at_ms: Option<i64>,
    pub archived_at_ms: Option<i64>,
    pub route_snapshot: ChatAiRouteSnapshot,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatAiUpdateThreadMetadataInput {
    pub id: String,
    pub title: String,
    pub updated_at_ms: i64,
    pub last_message_at_ms: Option<i64>,
    pub archived_at_ms: Option<i64>,
    pub route_snapshot: ChatAiRouteSnapshot,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatAiCreateMessageInput {
    pub id: String,
    pub thread_id: String,
    pub role: ChatAiMessageRole,
    pub status: ChatAiMessageStatus,
    pub content_text: String,
    pub content: ChatAiMessageContent,
    pub error: Option<ChatAiMessageError>,
    pub trace_id: Option<String>,
    pub parent_message_id: Option<String>,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatAiUpdateMessageInput {
    pub id: String,
    pub status: ChatAiMessageStatus,
    pub content_text: String,
    pub content: ChatAiMessageContent,
    pub error: Option<ChatAiMessageError>,
    pub trace_id: Option<String>,
    pub updated_at_ms: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatAiThreadLookupPayload {
    pub thread_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatAiPutDraftInput {
    pub thread_id: String,
    pub text: String,
    pub attachments: Vec<ChatAiAttachment>,
    pub updated_at_ms: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatAiDeleteDraftInput {
    pub thread_id: String,
}
