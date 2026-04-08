use serde::{Deserialize, Serialize};

pub(crate) const CHAT_AGENT_DB_SCHEMA_VERSION: i64 = 3;

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
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ChatAgentTurnRole {
    System,
    User,
    Assistant,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ChatAgentTurnStatus {
    Pending,
    Completed,
    Failed,
    Canceled,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ChatAgentBeatModality {
    Text,
    Voice,
    Image,
    Video,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ChatAgentBeatStatus {
    Planned,
    Sealed,
    Delivered,
    Failed,
    Canceled,
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
    pub kind: ChatAgentMessageKind,
    pub content_text: String,
    pub reasoning_text: Option<String>,
    pub error: Option<ChatAgentMessageError>,
    pub trace_id: Option<String>,
    pub parent_message_id: Option<String>,
    pub media_url: Option<String>,
    pub media_mime_type: Option<String>,
    pub artifact_id: Option<String>,
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
pub struct ChatAgentTurnRecord {
    pub id: String,
    pub thread_id: String,
    pub role: ChatAgentTurnRole,
    pub status: ChatAgentTurnStatus,
    pub provider_mode: String,
    pub trace_id: Option<String>,
    pub prompt_trace_id: Option<String>,
    pub started_at_ms: i64,
    pub completed_at_ms: Option<i64>,
    pub aborted_at_ms: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ChatAgentTurnBeatRecord {
    pub id: String,
    pub turn_id: String,
    pub beat_index: i64,
    pub modality: ChatAgentBeatModality,
    pub status: ChatAgentBeatStatus,
    pub text_shadow: Option<String>,
    pub artifact_id: Option<String>,
    pub mime_type: Option<String>,
    pub media_url: Option<String>,
    pub projection_message_id: Option<String>,
    pub created_at_ms: i64,
    pub delivered_at_ms: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ChatAgentInteractionSnapshotRecord {
    pub thread_id: String,
    pub version: i64,
    pub relationship_state: String,
    pub emotional_temperature: f64,
    pub assistant_commitments_json: serde_json::Value,
    pub user_prefs_json: serde_json::Value,
    pub open_loops_json: serde_json::Value,
    pub updated_at_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ChatAgentRelationMemorySlotRecord {
    pub id: String,
    pub thread_id: String,
    pub slot_type: String,
    pub summary: String,
    pub source_turn_id: Option<String>,
    pub source_beat_id: Option<String>,
    pub score: f64,
    pub updated_at_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ChatAgentRecallEntryRecord {
    pub id: String,
    pub thread_id: String,
    pub source_turn_id: Option<String>,
    pub source_beat_id: Option<String>,
    pub summary: String,
    pub search_text: String,
    pub updated_at_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ChatAgentTurnContext {
    pub thread: ChatAgentThreadRecord,
    pub recent_turns: Vec<ChatAgentTurnRecord>,
    pub recent_beats: Vec<ChatAgentTurnBeatRecord>,
    pub interaction_snapshot: Option<ChatAgentInteractionSnapshotRecord>,
    pub relation_memory_slots: Vec<ChatAgentRelationMemorySlotRecord>,
    pub recall_entries: Vec<ChatAgentRecallEntryRecord>,
    pub draft: Option<ChatAgentDraftRecord>,
    pub projection_version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ChatAgentProjectionRebuildResult {
    pub bundle: ChatAgentThreadBundle,
    pub projection_version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ChatAgentCommitTurnResult {
    pub turn: ChatAgentTurnRecord,
    pub beats: Vec<ChatAgentTurnBeatRecord>,
    pub interaction_snapshot: Option<ChatAgentInteractionSnapshotRecord>,
    pub relation_memory_slots: Vec<ChatAgentRelationMemorySlotRecord>,
    pub recall_entries: Vec<ChatAgentRecallEntryRecord>,
    pub bundle: ChatAgentThreadBundle,
    pub projection_version: String,
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
    pub kind: ChatAgentMessageKind,
    pub content_text: String,
    pub reasoning_text: Option<String>,
    pub error: Option<ChatAgentMessageError>,
    pub trace_id: Option<String>,
    pub parent_message_id: Option<String>,
    pub media_url: Option<String>,
    pub media_mime_type: Option<String>,
    pub artifact_id: Option<String>,
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
    pub media_url: Option<String>,
    pub media_mime_type: Option<String>,
    pub artifact_id: Option<String>,
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

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatAgentLoadTurnContextInput {
    pub thread_id: String,
    pub recent_turn_limit: Option<i64>,
    pub relation_memory_limit: Option<i64>,
    pub recall_limit: Option<i64>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatAgentTurnRecordInput {
    pub id: String,
    pub thread_id: String,
    pub role: ChatAgentTurnRole,
    pub status: ChatAgentTurnStatus,
    pub provider_mode: String,
    pub trace_id: Option<String>,
    pub prompt_trace_id: Option<String>,
    pub started_at_ms: i64,
    pub completed_at_ms: Option<i64>,
    pub aborted_at_ms: Option<i64>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatAgentTurnBeatInput {
    pub id: String,
    pub turn_id: String,
    pub beat_index: i64,
    pub modality: ChatAgentBeatModality,
    pub status: ChatAgentBeatStatus,
    pub text_shadow: Option<String>,
    pub artifact_id: Option<String>,
    pub mime_type: Option<String>,
    pub media_url: Option<String>,
    pub projection_message_id: Option<String>,
    pub created_at_ms: i64,
    pub delivered_at_ms: Option<i64>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatAgentInteractionSnapshotInput {
    pub thread_id: String,
    pub version: i64,
    pub relationship_state: String,
    pub emotional_temperature: f64,
    pub assistant_commitments_json: serde_json::Value,
    pub user_prefs_json: serde_json::Value,
    pub open_loops_json: serde_json::Value,
    pub updated_at_ms: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatAgentRelationMemorySlotInput {
    pub id: String,
    pub thread_id: String,
    pub slot_type: String,
    pub summary: String,
    pub source_turn_id: Option<String>,
    pub source_beat_id: Option<String>,
    pub score: f64,
    pub updated_at_ms: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatAgentRecallEntryInput {
    pub id: String,
    pub thread_id: String,
    pub source_turn_id: Option<String>,
    pub source_beat_id: Option<String>,
    pub summary: String,
    pub search_text: String,
    pub updated_at_ms: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatAgentProjectionMessageInput {
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
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatAgentProjectionCommitInput {
    pub thread: ChatAgentUpdateThreadMetadataInput,
    pub messages: Vec<ChatAgentProjectionMessageInput>,
    pub draft: Option<ChatAgentPutDraftInput>,
    pub clear_draft: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatAgentCommitTurnResultInput {
    pub thread_id: String,
    pub turn: ChatAgentTurnRecordInput,
    pub beats: Vec<ChatAgentTurnBeatInput>,
    pub interaction_snapshot: Option<ChatAgentInteractionSnapshotInput>,
    pub relation_memory_slots: Vec<ChatAgentRelationMemorySlotInput>,
    pub recall_entries: Vec<ChatAgentRecallEntryInput>,
    pub projection: ChatAgentProjectionCommitInput,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatAgentCancelTurnInput {
    pub thread_id: String,
    pub turn_id: String,
    pub scope: String,
    pub aborted_at_ms: i64,
}
