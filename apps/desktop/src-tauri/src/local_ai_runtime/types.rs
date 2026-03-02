use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use chrono::SecondsFormat;
use serde::{Deserialize, Serialize};
use sha2::Digest;

pub const LOCAL_AI_RUNTIME_VERSION: u32 = 11;
pub const DEFAULT_LOCAL_RUNTIME_ENDPOINT: &str = "http://127.0.0.1:1234/v1";
pub const LOCAL_AI_DOWNLOAD_PROGRESS_EVENT: &str = "local-ai://download-progress";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum LocalAiProviderAdapterKind {
    OpenaiCompatAdapter,
    LocalaiNativeAdapter,
    NexaNativeAdapter,
}

impl Default for LocalAiProviderAdapterKind {
    fn default() -> Self {
        Self::OpenaiCompatAdapter
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAiDownloadProgressEvent {
    pub install_session_id: String,
    pub model_id: String,
    pub local_model_id: Option<String>,
    pub phase: String,
    pub bytes_received: u64,
    pub bytes_total: Option<u64>,
    pub speed_bytes_per_sec: Option<f64>,
    pub eta_seconds: Option<f64>,
    pub message: Option<String>,
    pub done: bool,
    pub success: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum LocalAiModelStatus {
    Installed,
    Active,
    Unhealthy,
    Removed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAiModelSource {
    pub repo: String,
    pub revision: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAiModelRecord {
    pub local_model_id: String,
    pub model_id: String,
    pub capabilities: Vec<String>,
    pub engine: String,
    pub entry: String,
    pub license: String,
    pub source: LocalAiModelSource,
    pub hashes: HashMap<String, String>,
    pub endpoint: String,
    pub status: LocalAiModelStatus,
    pub installed_at: String,
    pub updated_at: String,
    pub health_detail: Option<String>,
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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum LocalAiDependencyKind {
    Model,
    Service,
    Node,
    Workflow,
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
    pub gpu: LocalAiGpuProfile,
    pub python: LocalAiPythonProfile,
    pub npu: LocalAiNpuProfile,
    pub disk_free_bytes: u64,
    #[serde(default)]
    pub ports: Vec<LocalAiPortAvailability>,
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
    pub installed_models: Vec<LocalAiModelRecord>,
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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAiRuntimeState {
    pub version: u32,
    pub models: Vec<LocalAiModelRecord>,
    #[serde(default)]
    pub capability_index: HashMap<String, Vec<String>>,
    #[serde(default)]
    pub capability_matrix: Vec<LocalAiCapabilityMatrixEntry>,
    #[serde(default)]
    pub services: Vec<LocalAiServiceDescriptor>,
    pub audits: Vec<LocalAiAuditEvent>,
}

impl Default for LocalAiRuntimeState {
    fn default() -> Self {
        Self {
            version: LOCAL_AI_RUNTIME_VERSION,
            models: Vec::new(),
            capability_index: HashMap::new(),
            capability_matrix: Vec::new(),
            services: Vec::new(),
            audits: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedModelSource {
    pub repo: String,
    pub revision: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedModelManifest {
    pub schema_version: String,
    pub model_id: String,
    pub capabilities: Vec<String>,
    pub engine: String,
    pub entry: String,
    #[serde(default)]
    pub files: Vec<String>,
    pub license: String,
    pub source: ImportedModelSource,
    pub hashes: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAiVerifiedModelDescriptor {
    pub template_id: String,
    pub title: String,
    pub description: String,
    pub install_kind: String,
    pub model_id: String,
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
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum LocalAiEngineRuntimeMode {
    Supervised,
    AttachedEndpoint,
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
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAiModelHealth {
    pub local_model_id: String,
    pub status: LocalAiModelStatus,
    pub detail: String,
    pub endpoint: String,
}

pub fn now_iso_timestamp() -> String {
    chrono::Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}

pub fn normalize_non_empty(value: &str, fallback: &str) -> String {
    let normalized = value.trim();
    if normalized.is_empty() {
        fallback.to_string()
    } else {
        normalized.to_string()
    }
}

const CROCKFORD_BASE32: &[u8; 32] = b"0123456789ABCDEFGHJKMNPQRSTVWXYZ";
static ULID_COUNTER: AtomicU64 = AtomicU64::new(0);

/// Generates a ULID-compatible 26-character string using existing deps (sha2 + chrono).
/// Timestamp portion (10 chars) encodes milliseconds since Unix epoch.
/// Randomness portion (16 chars) is derived from sha256(timestamp + counter + pid + thread_id).
pub fn generate_ulid_string() -> String {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;

    let mut ts_chars = [0u8; 10];
    let mut ts = millis & 0xFFFF_FFFF_FFFF;
    for i in (0..10).rev() {
        ts_chars[i] = CROCKFORD_BASE32[(ts & 0x1F) as usize];
        ts >>= 5;
    }

    let counter = ULID_COUNTER.fetch_add(1, Ordering::Relaxed);
    let pid = std::process::id();
    let thread_id = format!("{:?}", std::thread::current().id());

    let mut hasher = sha2::Sha256::new();
    hasher.update(millis.to_le_bytes());
    hasher.update(counter.to_le_bytes());
    hasher.update(pid.to_le_bytes());
    hasher.update(thread_id.as_bytes());
    let hash = hasher.finalize();

    let mut bits: u128 = 0;
    for &b in &hash[..10] {
        bits = (bits << 8) | b as u128;
    }
    let mut rand_chars = [0u8; 16];
    for i in (0..16).rev() {
        rand_chars[i] = CROCKFORD_BASE32[(bits & 0x1F) as usize];
        bits >>= 5;
    }

    let mut result = String::with_capacity(26);
    for &c in &ts_chars {
        result.push(c as char);
    }
    for &c in &rand_chars {
        result.push(c as char);
    }
    result
}

pub fn slugify_local_model_id(input: &str) -> String {
    let mut output = String::with_capacity(input.len());
    for ch in input.chars() {
        if ch.is_ascii_alphanumeric() {
            output.push(ch.to_ascii_lowercase());
            continue;
        }
        if ch == '-' || ch == '_' {
            output.push('-');
            continue;
        }
        if ch == '/' || ch == ':' || ch == '.' || ch.is_whitespace() {
            output.push('-');
        }
    }
    let compact = output
        .split('-')
        .filter(|part| !part.trim().is_empty())
        .collect::<Vec<_>>()
        .join("-");
    if compact.is_empty() {
        "local-model".to_string()
    } else {
        compact
    }
}

#[cfg(test)]
mod tests {
    use super::{generate_ulid_string, now_iso_timestamp, slugify_local_model_id};

    #[test]
    fn now_iso_timestamp_returns_rfc3339_millis_utc() {
        let ts = now_iso_timestamp();
        assert!(ts.ends_with('Z'));
        assert!(ts.contains('T'));
        assert!(ts.contains('.'));
    }

    #[test]
    fn slugify_local_model_id_colon_to_dash() {
        assert_eq!(
            slugify_local_model_id("hf:org/model-name"),
            "hf-org-model-name"
        );
    }

    #[test]
    fn slugify_local_model_id_slash_to_dash() {
        assert_eq!(slugify_local_model_id("org/model"), "org-model");
    }

    #[test]
    fn slugify_local_model_id_empty_returns_fallback() {
        assert_eq!(slugify_local_model_id(""), "local-model");
    }

    #[test]
    fn slugify_local_model_id_consecutive_separators_collapsed() {
        assert_eq!(slugify_local_model_id("hf:::org///model"), "hf-org-model");
    }

    #[test]
    fn slugify_local_model_id_preserves_alphanumeric_lowercase() {
        assert_eq!(slugify_local_model_id("MyModel-V2.1"), "mymodel-v2-1");
    }

    #[test]
    fn generate_ulid_string_returns_26_char_crockford() {
        let ulid = generate_ulid_string();
        assert_eq!(ulid.len(), 26);
        let crockford_chars = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
        for ch in ulid.chars() {
            assert!(
                crockford_chars.contains(ch),
                "invalid crockford char: {ch}"
            );
        }
    }

    #[test]
    fn generate_ulid_string_successive_calls_unique() {
        let a = generate_ulid_string();
        let b = generate_ulid_string();
        assert_ne!(a, b);
    }
}
