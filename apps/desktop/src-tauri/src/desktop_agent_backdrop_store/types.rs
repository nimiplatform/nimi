use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DesktopAgentBackdropBindingRecord {
    pub agent_id: String,
    pub display_name: String,
    pub source_filename: String,
    pub stored_path: String,
    pub file_url: String,
    pub updated_at_ms: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopAgentBackdropLookupPayload {
    pub agent_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopAgentBackdropImportPayload {
    pub agent_id: String,
    pub source_path: String,
    pub imported_at_ms: Option<i64>,
}
