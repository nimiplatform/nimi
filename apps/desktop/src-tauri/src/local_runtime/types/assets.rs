use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use super::recommendation::LocalAiRecommendationDescriptor;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum LocalAiIntegrityMode {
    Verified,
    LocalUnverified,
}

pub fn infer_asset_integrity_mode_from_source(source: &LocalAiAssetSource) -> LocalAiIntegrityMode {
    if source
        .repo
        .trim()
        .to_ascii_lowercase()
        .starts_with("local-import/")
    {
        return LocalAiIntegrityMode::LocalUnverified;
    }
    LocalAiIntegrityMode::Verified
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum LocalAiAssetKind {
    Chat,
    Image,
    Video,
    Tts,
    Stt,
    Vae,
    Clip,
    Controlnet,
    Lora,
    Auxiliary,
}

pub fn is_runnable_asset_kind(kind: &LocalAiAssetKind) -> bool {
    matches!(
        kind,
        LocalAiAssetKind::Chat
            | LocalAiAssetKind::Image
            | LocalAiAssetKind::Video
            | LocalAiAssetKind::Tts
            | LocalAiAssetKind::Stt
    )
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum LocalAiAssetStatus {
    Installed,
    Active,
    Unhealthy,
    Removed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAiAssetSource {
    pub repo: String,
    pub revision: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedAssetManifest {
    pub schema_version: String,
    pub asset_id: String,
    pub kind: String,
    #[serde(default)]
    pub logical_model_id: String,
    #[serde(default)]
    pub capabilities: Vec<String>,
    pub engine: String,
    pub entry: String,
    #[serde(default)]
    pub files: Vec<String>,
    pub license: String,
    pub source: LocalAiAssetSource,
    #[serde(default)]
    pub integrity_mode: Option<LocalAiIntegrityMode>,
    pub hashes: HashMap<String, String>,
    #[serde(default)]
    pub artifact_roles: Vec<String>,
    #[serde(default)]
    pub preferred_engine: Option<String>,
    #[serde(default)]
    pub fallback_engines: Vec<String>,
    #[serde(default)]
    pub engine_config: Option<serde_json::Value>,
    #[serde(default)]
    pub endpoint: String,
    pub metadata: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAiAssetRecord {
    pub local_asset_id: String,
    pub asset_id: String,
    pub kind: LocalAiAssetKind,
    #[serde(default)]
    pub logical_model_id: String,
    #[serde(default)]
    pub capabilities: Vec<String>,
    pub engine: String,
    pub entry: String,
    #[serde(default)]
    pub files: Vec<String>,
    pub license: String,
    pub source: LocalAiAssetSource,
    #[serde(default)]
    pub integrity_mode: Option<LocalAiIntegrityMode>,
    pub hashes: HashMap<String, String>,
    #[serde(default)]
    pub tags: Vec<String>,
    pub known_total_size_bytes: Option<u64>,
    #[serde(default)]
    pub endpoint: String,
    pub status: LocalAiAssetStatus,
    pub installed_at: String,
    pub updated_at: String,
    #[serde(default)]
    pub health_detail: Option<String>,
    #[serde(default)]
    pub artifact_roles: Vec<String>,
    #[serde(default)]
    pub preferred_engine: Option<String>,
    #[serde(default)]
    pub fallback_engines: Vec<String>,
    #[serde(default)]
    pub engine_config: Option<serde_json::Value>,
    #[serde(default)]
    pub recommendation: Option<LocalAiRecommendationDescriptor>,
    #[serde(default)]
    pub metadata: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAiVerifiedAssetDescriptor {
    pub template_id: String,
    pub title: String,
    pub description: String,
    pub asset_id: String,
    pub kind: LocalAiAssetKind,
    #[serde(default)]
    pub logical_model_id: String,
    #[serde(default)]
    pub capabilities: Vec<String>,
    pub engine: String,
    pub entry: String,
    #[serde(default)]
    pub files: Vec<String>,
    pub license: String,
    pub repo: String,
    pub revision: String,
    pub hashes: HashMap<String, String>,
    #[serde(default)]
    pub endpoint: String,
    pub file_count: usize,
    pub total_size_bytes: Option<u64>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub artifact_roles: Vec<String>,
    #[serde(default)]
    pub preferred_engine: Option<String>,
    #[serde(default)]
    pub fallback_engines: Vec<String>,
    #[serde(default)]
    pub engine_config: Option<serde_json::Value>,
    #[serde(default)]
    pub metadata: Option<serde_json::Value>,
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
