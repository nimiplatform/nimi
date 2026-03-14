use serde::{Deserialize, Serialize};

use super::dependencies::{LocalAiDependencyApplyResult, LocalAiDependencyResolutionPlan};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAiProfileRequirementDescriptor {
    pub min_gpu_memory_gb: Option<f64>,
    pub min_disk_bytes: Option<u64>,
    #[serde(default)]
    pub platforms: Vec<String>,
    #[serde(default)]
    pub notes: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAiProfileEntryDescriptor {
    pub entry_id: String,
    pub kind: String,
    pub title: Option<String>,
    pub description: Option<String>,
    pub capability: Option<String>,
    pub required: Option<bool>,
    pub preferred: Option<bool>,
    pub model_id: Option<String>,
    pub repo: Option<String>,
    pub service_id: Option<String>,
    pub node_id: Option<String>,
    pub engine: Option<String>,
    pub artifact_id: Option<String>,
    pub artifact_kind: Option<String>,
    pub template_id: Option<String>,
    pub revision: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAiProfileDescriptor {
    pub id: String,
    pub title: String,
    pub description: Option<String>,
    pub recommended: bool,
    #[serde(default)]
    pub consume_capabilities: Vec<String>,
    #[serde(default)]
    pub entries: Vec<LocalAiProfileEntryDescriptor>,
    pub requirements: Option<LocalAiProfileRequirementDescriptor>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAiProfileArtifactPlanEntry {
    pub entry_id: String,
    pub kind: String,
    pub title: Option<String>,
    pub description: Option<String>,
    pub capability: Option<String>,
    pub required: Option<bool>,
    pub preferred: Option<bool>,
    pub model_id: Option<String>,
    pub repo: Option<String>,
    pub service_id: Option<String>,
    pub node_id: Option<String>,
    pub engine: Option<String>,
    pub artifact_id: Option<String>,
    pub artifact_kind: Option<String>,
    pub template_id: Option<String>,
    pub revision: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    pub installed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAiProfileResolutionPlan {
    pub plan_id: String,
    pub mod_id: String,
    pub profile_id: String,
    pub title: String,
    pub description: Option<String>,
    pub recommended: bool,
    #[serde(default)]
    pub consume_capabilities: Vec<String>,
    pub requirements: Option<LocalAiProfileRequirementDescriptor>,
    pub execution_plan: LocalAiDependencyResolutionPlan,
    #[serde(default)]
    pub artifact_entries: Vec<LocalAiProfileArtifactPlanEntry>,
    #[serde(default)]
    pub warnings: Vec<String>,
    pub reason_code: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAiProfileApplyResult {
    pub plan_id: String,
    pub mod_id: String,
    pub profile_id: String,
    pub execution_result: LocalAiDependencyApplyResult,
    #[serde(default)]
    pub installed_artifacts: Vec<serde_json::Value>,
    #[serde(default)]
    pub warnings: Vec<String>,
    pub reason_code: Option<String>,
}
