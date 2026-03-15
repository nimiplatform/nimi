use std::collections::HashMap;

use serde::{Deserialize, Serialize};

#[allow(clippy::enum_variant_names)]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum LocalAiProviderAdapterKind {
    #[default]
    OpenaiCompatAdapter,
    LocalaiNativeAdapter,
    NexaNativeAdapter,
    NimiMediaNativeAdapter,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum LocalAiServiceStatus {
    Installed,
    Active,
    Unhealthy,
    Removed,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum LocalAiServiceArtifactType {
    PythonEnv,
    Binary,
    AttachedEndpoint,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAiPreflightRule {
    pub check: String,
    pub reason_code: String,
    pub params: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAiServiceInstallSpec {
    #[serde(default)]
    pub requirements: Vec<String>,
    pub bootstrap: Option<String>,
    pub binary_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAiServiceProcessSpec {
    pub entry: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub env: HashMap<String, String>,
    pub model_binding: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAiServiceHealthSpec {
    pub endpoint: String,
    pub capability_probe_endpoint: Option<String>,
    pub interval_ms: u64,
    pub timeout_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct LocalAiProviderHints {
    pub localai: Option<LocalAiProviderLocalHints>,
    pub nexa: Option<LocalAiProviderNexaHints>,
    pub nimi_media: Option<LocalAiProviderNimiMediaHints>,
    pub extra: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct LocalAiProviderLocalHints {
    pub backend: Option<String>,
    pub preferred_adapter: Option<LocalAiProviderAdapterKind>,
    pub whisper_variant: Option<String>,
    pub stablediffusion_pipeline: Option<String>,
    pub video_backend: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct LocalAiProviderNexaHints {
    pub backend: Option<String>,
    pub preferred_adapter: Option<LocalAiProviderAdapterKind>,
    pub plugin_id: Option<String>,
    pub device_id: Option<String>,
    pub model_type: Option<String>,
    pub npu_mode: Option<String>,
    pub policy_gate: Option<String>,
    pub host_npu_ready: Option<bool>,
    pub model_probe_has_npu_candidate: Option<bool>,
    pub policy_gate_allows_npu: Option<bool>,
    pub npu_usable: Option<bool>,
    pub gate_reason: Option<String>,
    pub gate_detail: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct LocalAiProviderNimiMediaHints {
    pub preferred_adapter: Option<LocalAiProviderAdapterKind>,
    pub driver: Option<String>,
    pub family: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAiCapabilityMatrixEntry {
    pub service_id: String,
    pub node_id: String,
    pub capability: String,
    pub provider: String,
    pub model_id: Option<String>,
    pub model_engine: Option<String>,
    pub backend: Option<String>,
    pub backend_source: String,
    pub adapter: LocalAiProviderAdapterKind,
    pub available: bool,
    pub reason_code: Option<String>,
    pub provider_hints: Option<LocalAiProviderHints>,
    pub policy_gate: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAiNodeContract {
    pub node_id: String,
    pub title: String,
    pub capability: String,
    pub api_path: String,
    pub input_schema: Option<serde_json::Value>,
    pub output_schema: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAiServiceArtifact {
    pub service_id: String,
    pub artifact_type: LocalAiServiceArtifactType,
    pub engine: String,
    pub install: LocalAiServiceInstallSpec,
    #[serde(default)]
    pub preflight: Vec<LocalAiPreflightRule>,
    pub process: LocalAiServiceProcessSpec,
    pub health: LocalAiServiceHealthSpec,
    #[serde(default)]
    pub nodes: Vec<LocalAiNodeContract>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAiServiceDescriptor {
    pub service_id: String,
    pub title: String,
    pub engine: String,
    pub artifact_type: Option<LocalAiServiceArtifactType>,
    pub endpoint: Option<String>,
    pub capabilities: Vec<String>,
    pub local_model_id: Option<String>,
    pub status: LocalAiServiceStatus,
    pub detail: Option<String>,
    pub installed_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAiNodeDescriptor {
    pub node_id: String,
    pub title: String,
    pub service_id: String,
    pub capabilities: Vec<String>,
    pub provider: String,
    pub adapter: LocalAiProviderAdapterKind,
    pub backend: Option<String>,
    pub backend_source: Option<String>,
    pub available: bool,
    pub reason_code: Option<String>,
    pub provider_hints: Option<LocalAiProviderHints>,
    pub policy_gate: Option<String>,
    pub api_path: Option<String>,
    pub input_schema: Option<serde_json::Value>,
    pub output_schema: Option<serde_json::Value>,
    pub read_only: bool,
}
