use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DesktopAvatarInstanceRegistryRecord {
    pub(crate) avatar_instance_id: String,
    pub(crate) agent_id: String,
    pub(crate) conversation_anchor_id: Option<String>,
    pub(crate) anchor_mode: String,
    pub(crate) launched_by: String,
    pub(crate) source_surface: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DesktopAvatarInstanceRegistryFile {
    pub(crate) schema_version: u32,
    pub(crate) publisher_pid: u32,
    pub(crate) published_at_ms: i64,
    #[serde(default)]
    pub(crate) instances: Vec<DesktopAvatarInstanceRegistryRecord>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DesktopAvatarInstanceRegistryLookupPayload {
    pub(crate) agent_id: Option<String>,
}
