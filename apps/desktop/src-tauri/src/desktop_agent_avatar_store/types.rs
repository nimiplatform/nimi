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
    pub owner_user_id: String,
    pub realm_agent_id: String,
    pub local_agent_ref: String,
    pub resource_id: String,
    pub updated_at_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DesktopAgentAvatarBindingLookupPayload {
    pub owner_user_id: String,
    pub realm_agent_id: String,
    pub local_agent_ref: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DesktopAgentAvatarBindingSetPayload {
    pub owner_user_id: String,
    pub realm_agent_id: String,
    pub local_agent_ref: String,
    pub resource_id: String,
    pub updated_at_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DesktopAgentAvatarResourceDeletePayload {
    pub resource_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DesktopAgentAvatarResourceReadPayload {
    pub resource_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DesktopAgentAvatarResourceRelativeReadPayload {
    pub resource_id: String,
    pub relative_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DesktopAgentAvatarResourceAssetPayload {
    pub mime_type: String,
    pub base64: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DesktopAgentAvatarImportVrmPayload {
    pub source_path: String,
    pub display_name: Option<String>,
    pub bind_owner_user_id: Option<String>,
    pub bind_realm_agent_id: Option<String>,
    pub bind_local_agent_ref: Option<String>,
    pub imported_at_ms: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DesktopAgentAvatarImportLive2dPayload {
    pub source_path: String,
    pub display_name: Option<String>,
    pub bind_owner_user_id: Option<String>,
    pub bind_realm_agent_id: Option<String>,
    pub bind_local_agent_ref: Option<String>,
    pub imported_at_ms: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DesktopAgentAvatarImportResult {
    pub resource: DesktopAgentAvatarResourceRecord,
    pub binding: Option<DesktopAgentAvatarBindingRecord>,
}
