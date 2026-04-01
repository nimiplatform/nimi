use serde::{Deserialize, Serialize};

use super::recommendation::LocalAiHostSupportClass;
use super::services::LocalAiServiceDescriptor;
use super::LocalAiAssetRecord;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum LocalAiMemoryModel {
    Discrete,
    Unified,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum LocalAiDependencyKind {
    Model,
    Service,
    Node,
    Workflow,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAiDependencyDescriptor {
    pub dependency_id: String,
    pub kind: LocalAiDependencyKind,
    pub capability: Option<String>,
    pub required: bool,
    pub selected: bool,
    pub preferred: bool,
    pub model_id: Option<String>,
    pub repo: Option<String>,
    pub engine: Option<String>,
    pub service_id: Option<String>,
    pub node_id: Option<String>,
    pub workflow_id: Option<String>,
    pub reason_code: Option<String>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAiGpuProfile {
    pub available: bool,
    pub vendor: Option<String>,
    pub model: Option<String>,
    pub total_vram_bytes: Option<u64>,
    pub available_vram_bytes: Option<u64>,
    pub memory_model: LocalAiMemoryModel,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAiPythonProfile {
    pub available: bool,
    pub version: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAiNpuProfile {
    pub available: bool,
    pub ready: bool,
    pub vendor: Option<String>,
    pub runtime: Option<String>,
    pub detail: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAiPortAvailability {
    pub port: u16,
    pub available: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAiDeviceProfile {
    pub os: String,
    pub arch: String,
    pub total_ram_bytes: u64,
    pub available_ram_bytes: u64,
    pub gpu: LocalAiGpuProfile,
    pub python: LocalAiPythonProfile,
    pub npu: LocalAiNpuProfile,
    pub disk_free_bytes: u64,
    #[serde(default)]
    pub ports: Vec<LocalAiPortAvailability>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAiHostSupportDescriptor {
    pub class: LocalAiHostSupportClass,
    pub detail: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAiPreflightDecision {
    pub dependency_id: Option<String>,
    pub target: String,
    pub check: String,
    pub ok: bool,
    pub reason_code: String,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAiDependencySelectionRationale {
    pub dependency_id: String,
    pub selected: bool,
    pub reason_code: String,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAiDependencyApplyStageResult {
    pub stage: String,
    pub ok: bool,
    pub reason_code: Option<String>,
    pub detail: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAiDependencyResolutionPlan {
    pub plan_id: String,
    pub mod_id: String,
    pub capability: Option<String>,
    pub device_profile: LocalAiDeviceProfile,
    pub dependencies: Vec<LocalAiDependencyDescriptor>,
    #[serde(default)]
    pub selection_rationale: Vec<LocalAiDependencySelectionRationale>,
    #[serde(default)]
    pub preflight_decisions: Vec<LocalAiPreflightDecision>,
    pub warnings: Vec<String>,
    pub reason_code: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAiDependencyApplyResult {
    pub plan_id: String,
    pub mod_id: String,
    pub dependencies: Vec<LocalAiDependencyDescriptor>,
    pub installed_assets: Vec<LocalAiAssetRecord>,
    pub services: Vec<LocalAiServiceDescriptor>,
    pub capabilities: Vec<String>,
    #[serde(default)]
    pub stage_results: Vec<LocalAiDependencyApplyStageResult>,
    #[serde(default)]
    pub preflight_decisions: Vec<LocalAiPreflightDecision>,
    pub rollback_applied: bool,
    pub warnings: Vec<String>,
    pub reason_code: Option<String>,
}
