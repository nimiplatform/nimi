use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use super::models::LocalAiIntegrityMode;

pub fn infer_artifact_integrity_mode_from_source(
    source: &LocalAiArtifactSource,
) -> LocalAiIntegrityMode {
    if source.repo.trim().to_ascii_lowercase().starts_with("local-import/") {
        return LocalAiIntegrityMode::LocalUnverified;
    }
    LocalAiIntegrityMode::Verified
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum LocalAiArtifactKind {
    Vae,
    Ae,
    Llm,
    Clip,
    Controlnet,
    Lora,
    Auxiliary,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum LocalAiArtifactStatus {
    Installed,
    Active,
    Unhealthy,
    Removed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAiArtifactSource {
    pub repo: String,
    pub revision: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedArtifactManifest {
    pub schema_version: String,
    pub artifact_id: String,
    pub kind: String,
    pub engine: String,
    pub entry: String,
    #[serde(default)]
    pub files: Vec<String>,
    pub license: String,
    pub source: LocalAiArtifactSource,
    #[serde(default)]
    pub integrity_mode: Option<LocalAiIntegrityMode>,
    pub hashes: HashMap<String, String>,
    pub metadata: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAiArtifactRecord {
    pub local_artifact_id: String,
    pub artifact_id: String,
    pub kind: LocalAiArtifactKind,
    pub engine: String,
    pub entry: String,
    #[serde(default)]
    pub files: Vec<String>,
    pub license: String,
    pub source: LocalAiArtifactSource,
    #[serde(default)]
    pub integrity_mode: Option<LocalAiIntegrityMode>,
    pub hashes: HashMap<String, String>,
    pub status: LocalAiArtifactStatus,
    pub installed_at: String,
    pub updated_at: String,
    pub health_detail: Option<String>,
    pub metadata: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAiVerifiedArtifactDescriptor {
    pub template_id: String,
    pub title: String,
    pub description: String,
    pub artifact_id: String,
    pub kind: LocalAiArtifactKind,
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
