use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use super::artifacts::LocalAiArtifactRecord;
use super::constants::LOCAL_AI_RUNTIME_VERSION;
use super::download::LocalAiDownloadSessionRecord;
use super::models::{LocalAiAuditEvent, LocalAiModelRecord};
use super::services::{LocalAiCapabilityMatrixEntry, LocalAiServiceDescriptor};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAiRuntimeState {
    pub version: u32,
    pub models: Vec<LocalAiModelRecord>,
    #[serde(default)]
    pub artifacts: Vec<LocalAiArtifactRecord>,
    #[serde(default)]
    pub capability_index: HashMap<String, Vec<String>>,
    #[serde(default)]
    pub capability_matrix: Vec<LocalAiCapabilityMatrixEntry>,
    #[serde(default)]
    pub services: Vec<LocalAiServiceDescriptor>,
    #[serde(default)]
    pub downloads: Vec<LocalAiDownloadSessionRecord>,
    pub audits: Vec<LocalAiAuditEvent>,
}

impl Default for LocalAiRuntimeState {
    fn default() -> Self {
        Self {
            version: LOCAL_AI_RUNTIME_VERSION,
            models: Vec::new(),
            artifacts: Vec::new(),
            capability_index: HashMap::new(),
            capability_matrix: Vec::new(),
            services: Vec::new(),
            downloads: Vec::new(),
            audits: Vec::new(),
        }
    }
}
