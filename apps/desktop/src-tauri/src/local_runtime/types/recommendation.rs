use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum LocalAiRecommendationSource {
    Llmfit,
    MediaFit,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum LocalAiRecommendationFormat {
    Gguf,
    Safetensors,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum LocalAiRecommendationTier {
    Recommended,
    Runnable,
    Tight,
    NotRecommended,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum LocalAiRecommendationConfidence {
    High,
    Medium,
    Low,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum LocalAiHostSupportClass {
    SupportedSupervised,
    AttachedOnly,
    Unsupported,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum LocalAiRecommendationBaseline {
    ImageDefaultV1,
    VideoDefaultV1,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LocalAiSuggestedAsset {
    pub template_id: Option<String>,
    pub asset_id: Option<String>,
    pub kind: String,
    pub family: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LocalAiRecommendationDescriptor {
    pub source: LocalAiRecommendationSource,
    pub format: Option<LocalAiRecommendationFormat>,
    pub tier: Option<LocalAiRecommendationTier>,
    pub host_support_class: Option<LocalAiHostSupportClass>,
    pub confidence: Option<LocalAiRecommendationConfidence>,
    #[serde(default)]
    pub reason_codes: Vec<String>,
    pub recommended_entry: Option<String>,
    #[serde(default)]
    pub fallback_entries: Vec<String>,
    #[serde(default)]
    pub suggested_assets: Vec<LocalAiSuggestedAsset>,
    #[serde(default)]
    pub suggested_notes: Vec<String>,
    pub baseline: Option<LocalAiRecommendationBaseline>,
}
