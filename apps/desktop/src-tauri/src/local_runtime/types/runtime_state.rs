use std::collections::HashMap;

use serde::{Deserialize, Deserializer, Serialize};

use super::assets::{LocalAiAssetRecord, LocalAiAuditEvent};
use super::constants::LOCAL_AI_RUNTIME_VERSION;
use super::download::LocalAiDownloadSessionRecord;
use super::services::{LocalAiCapabilityMatrixEntry, LocalAiServiceDescriptor};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAiRuntimeState {
    pub version: u32,
    pub assets: Vec<LocalAiAssetRecord>,
    pub capability_index: HashMap<String, Vec<String>>,
    pub capability_matrix: Vec<LocalAiCapabilityMatrixEntry>,
    pub services: Vec<LocalAiServiceDescriptor>,
    pub downloads: Vec<LocalAiDownloadSessionRecord>,
    pub audits: Vec<LocalAiAuditEvent>,
}

impl Default for LocalAiRuntimeState {
    fn default() -> Self {
        Self {
            version: LOCAL_AI_RUNTIME_VERSION,
            assets: Vec::new(),
            capability_index: HashMap::new(),
            capability_matrix: Vec::new(),
            services: Vec::new(),
            downloads: Vec::new(),
            audits: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PersistedLocalAiRuntimeStateRead {
    #[serde(default = "default_local_ai_runtime_version")]
    version: u32,
    #[serde(default)]
    assets: Vec<LocalAiAssetRecord>,
    #[serde(default)]
    models: Vec<serde_json::Value>,
    #[serde(default)]
    artifacts: Vec<serde_json::Value>,
    #[serde(default)]
    capability_index: HashMap<String, Vec<String>>,
    #[serde(default)]
    capability_matrix: Vec<LocalAiCapabilityMatrixEntry>,
    #[serde(default)]
    services: Vec<LocalAiServiceDescriptor>,
    #[serde(default)]
    downloads: Vec<LocalAiDownloadSessionRecord>,
    #[serde(default)]
    audits: Vec<LocalAiAuditEvent>,
}

fn default_local_ai_runtime_version() -> u32 {
    LOCAL_AI_RUNTIME_VERSION
}

impl<'de> Deserialize<'de> for LocalAiRuntimeState {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let persisted = PersistedLocalAiRuntimeStateRead::deserialize(deserializer)?;
        if !persisted.models.is_empty() || !persisted.artifacts.is_empty() {
            return Err(serde::de::Error::custom(
                "LOCAL_AI_LEGACY_RUNTIME_STATE_UNSUPPORTED: legacy models/artifacts state is no longer supported",
            ));
        }
        Ok(Self {
            version: persisted.version,
            assets: persisted.assets,
            capability_index: persisted.capability_index,
            capability_matrix: persisted.capability_matrix,
            services: persisted.services,
            downloads: persisted.downloads,
            audits: persisted.audits,
        })
    }
}
