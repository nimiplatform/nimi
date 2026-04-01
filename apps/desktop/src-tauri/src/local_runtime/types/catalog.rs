use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use super::recommendation::LocalAiRecommendationDescriptor;
use super::services::LocalAiProviderHints;
use super::LocalAiAssetStatus;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAiVerifiedModelDescriptor {
    pub template_id: String,
    pub title: String,
    pub description: String,
    pub install_kind: String,
    pub model_id: String,
    pub logical_model_id: String,
    pub repo: String,
    pub revision: String,
    pub capabilities: Vec<String>,
    pub engine: String,
    pub entry: String,
    pub files: Vec<String>,
    pub license: String,
    pub hashes: HashMap<String, String>,
    pub endpoint: String,
    pub file_count: usize,
    pub total_size_bytes: Option<u64>,
    pub tags: Vec<String>,
    pub artifact_roles: Vec<String>,
    pub preferred_engine: String,
    pub fallback_engines: Vec<String>,
    pub engine_config: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum LocalAiEngineRuntimeMode {
    Supervised,
    AttachedEndpoint,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogVariantDescriptor {
    pub filename: String,
    pub entry: String,
    #[serde(default)]
    pub files: Vec<String>,
    pub format: String,
    pub size_bytes: Option<u64>,
    pub sha256: Option<String>,
    pub recommendation: Option<LocalAiRecommendationDescriptor>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAiCatalogItemDescriptor {
    pub item_id: String,
    pub source: String,
    pub title: String,
    pub description: String,
    pub model_id: String,
    pub repo: String,
    pub revision: String,
    pub template_id: Option<String>,
    pub capabilities: Vec<String>,
    pub engine: String,
    pub engine_runtime_mode: LocalAiEngineRuntimeMode,
    pub install_kind: String,
    pub install_available: bool,
    pub endpoint: Option<String>,
    pub provider_hints: Option<LocalAiProviderHints>,
    pub entry: Option<String>,
    pub files: Vec<String>,
    pub license: Option<String>,
    pub hashes: HashMap<String, String>,
    pub tags: Vec<String>,
    pub downloads: Option<u64>,
    pub likes: Option<u64>,
    pub last_modified: Option<String>,
    pub verified: bool,
    pub engine_config: Option<serde_json::Value>,
    pub recommendation: Option<LocalAiRecommendationDescriptor>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAiInstallPlanDescriptor {
    pub plan_id: String,
    pub item_id: String,
    pub source: String,
    pub template_id: Option<String>,
    pub model_id: String,
    pub repo: String,
    pub revision: String,
    pub capabilities: Vec<String>,
    pub engine: String,
    pub engine_runtime_mode: LocalAiEngineRuntimeMode,
    pub install_kind: String,
    pub install_available: bool,
    pub endpoint: String,
    pub provider_hints: Option<LocalAiProviderHints>,
    pub entry: String,
    pub files: Vec<String>,
    pub license: String,
    pub hashes: HashMap<String, String>,
    pub warnings: Vec<String>,
    pub reason_code: Option<String>,
    pub engine_config: Option<serde_json::Value>,
    pub recommendation: Option<LocalAiRecommendationDescriptor>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAiInstallRequest {
    pub model_id: String,
    pub repo: String,
    pub revision: Option<String>,
    pub capabilities: Option<Vec<String>>,
    pub engine: Option<String>,
    pub entry: Option<String>,
    pub files: Option<Vec<String>>,
    pub license: Option<String>,
    pub hashes: Option<HashMap<String, String>>,
    pub endpoint: Option<String>,
    pub provider_hints: Option<LocalAiProviderHints>,
    pub engine_config: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAiAssetHealth {
    #[serde(rename = "localAssetId", alias = "localModelId")]
    pub local_asset_id: String,
    pub status: LocalAiAssetStatus,
    pub detail: String,
    pub endpoint: String,
}
