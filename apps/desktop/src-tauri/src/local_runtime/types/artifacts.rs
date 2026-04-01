use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use super::models::LocalAiIntegrityMode;

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
    pub engine: String,
    pub entry: String,
    #[serde(default)]
    pub files: Vec<String>,
    pub license: String,
    pub source: LocalAiAssetSource,
    #[serde(default)]
    pub integrity_mode: Option<LocalAiIntegrityMode>,
    pub hashes: HashMap<String, String>,
    pub metadata: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAiAssetRecord {
    pub local_asset_id: String,
    pub asset_id: String,
    pub kind: LocalAiAssetKind,
    pub engine: String,
    pub entry: String,
    #[serde(default)]
    pub files: Vec<String>,
    pub license: String,
    pub source: LocalAiAssetSource,
    #[serde(default)]
    pub integrity_mode: Option<LocalAiIntegrityMode>,
    pub hashes: HashMap<String, String>,
    pub status: LocalAiAssetStatus,
    pub installed_at: String,
    pub updated_at: String,
    pub health_detail: Option<String>,
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
    pub engine: String,
    pub entry: String,
    #[serde(default)]
    pub files: Vec<String>,
    pub license: String,
    pub repo: String,
    pub revision: String,
    pub hashes: HashMap<String, String>,
    pub file_count: usize,
    pub total_size_bytes: Option<u64>,
    #[serde(default)]
    pub tags: Vec<String>,
    pub metadata: Option<serde_json::Value>,
}
