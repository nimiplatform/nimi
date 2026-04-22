use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DesktopAgentAvatarResourceKind {
    Vrm,
    Live2d,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DesktopAgentAvatarResourceStatus {
    Ready,
    Invalid,
    Missing,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DesktopAgentAvatarResourceRecord {
    pub resource_id: String,
    pub kind: DesktopAgentAvatarResourceKind,
    pub display_name: String,
    pub source_filename: String,
    pub stored_path: String,
    pub file_url: String,
    pub poster_path: Option<String>,
    pub imported_at_ms: i64,
    pub updated_at_ms: i64,
    pub status: DesktopAgentAvatarResourceStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DesktopAgentAvatarBindingRecord {
    pub agent_id: String,
    pub resource_id: String,
    pub updated_at_ms: i64,
}
