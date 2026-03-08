use std::collections::HashMap;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum LocalAiModelStatus {
    Installed,
    Active,
    Unhealthy,
    Removed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAiModelSource {
    pub repo: String,
    pub revision: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAiModelRecord {
    pub local_model_id: String,
    pub model_id: String,
    pub capabilities: Vec<String>,
    pub engine: String,
    pub entry: String,
    pub license: String,
    pub source: LocalAiModelSource,
    pub hashes: HashMap<String, String>,
    pub endpoint: String,
    pub status: LocalAiModelStatus,
    pub installed_at: String,
    pub updated_at: String,
    pub health_detail: Option<String>,
    pub engine_config: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAiAuditEvent {
    pub id: String,
    pub event_type: String,
    pub occurred_at: String,
    pub model_id: Option<String>,
    pub local_model_id: Option<String>,
    pub payload: Option<serde_json::Value>,
}
