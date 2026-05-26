use serde::{Deserialize, Serialize};

use super::recommendation::LocalAiHostSupportClass;
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum LocalAiMemoryModel {
    Discrete,
    Unified,
    Unknown,
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
