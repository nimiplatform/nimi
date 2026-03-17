use serde::{Deserialize, Serialize};

use super::catalog::LocalAiInstallRequest;
use super::dependencies::LocalAiDeviceProfile;
use super::models::LocalAiModelStatus;
use super::recommendation::{LocalAiRecommendationDescriptor, LocalAiRecommendationFormat};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum LocalAiRecommendationFeedCacheState {
    Fresh,
    Stale,
    Empty,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum LocalAiRecommendationFeedCapability {
    Chat,
    Image,
    Video,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum LocalAiRecommendationFeedSource {
    ModelIndex,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAiRecommendationFeedEntryDescriptor {
    pub entry_id: String,
    pub format: LocalAiRecommendationFormat,
    pub entry: String,
    #[serde(default)]
    pub files: Vec<String>,
    pub total_size_bytes: u64,
    pub sha256: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAiRecommendationInstalledState {
    pub installed: bool,
    pub local_model_id: Option<String>,
    pub status: Option<LocalAiModelStatus>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAiRecommendationActionState {
    pub can_review_install_plan: bool,
    pub can_open_variants: bool,
    pub can_open_local_model: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAiRecommendationFeedItemDescriptor {
    pub item_id: String,
    pub source: LocalAiRecommendationFeedSource,
    pub repo: String,
    pub revision: String,
    pub title: String,
    pub description: Option<String>,
    #[serde(default)]
    pub capabilities: Vec<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub formats: Vec<LocalAiRecommendationFormat>,
    pub downloads: Option<u64>,
    pub likes: Option<u64>,
    pub last_modified: Option<String>,
    pub preferred_engine: String,
    pub verified: bool,
    #[serde(default)]
    pub entries: Vec<LocalAiRecommendationFeedEntryDescriptor>,
    pub recommendation: Option<LocalAiRecommendationDescriptor>,
    pub installed_state: LocalAiRecommendationInstalledState,
    pub action_state: LocalAiRecommendationActionState,
    pub install_payload: LocalAiInstallRequest,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAiRecommendationFeedDescriptor {
    pub device_profile: LocalAiDeviceProfile,
    pub active_capability: LocalAiRecommendationFeedCapability,
    pub generated_at: Option<String>,
    pub cache_state: LocalAiRecommendationFeedCacheState,
    #[serde(default)]
    pub items: Vec<LocalAiRecommendationFeedItemDescriptor>,
}
