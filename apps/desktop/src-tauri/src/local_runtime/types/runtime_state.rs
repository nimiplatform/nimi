use std::collections::HashMap;

use serde::{Deserialize, Deserializer, Serialize, Serializer};

use super::artifacts::{
    LocalAiAssetKind, LocalAiAssetRecord, LocalAiAssetSource, LocalAiAssetStatus,
};
use super::constants::LOCAL_AI_RUNTIME_VERSION;
use super::download::LocalAiDownloadSessionRecord;
use super::intake::LocalAiModelType;
use super::models::{
    LocalAiAuditEvent, LocalAiIntegrityMode, LocalAiModelRecord, LocalAiModelSource,
    LocalAiModelStatus,
};
use super::recommendation::LocalAiRecommendationDescriptor;
use super::services::{LocalAiCapabilityMatrixEntry, LocalAiServiceDescriptor};

#[derive(Debug, Clone)]
pub struct LocalAiRuntimeState {
    pub version: u32,
    pub models: Vec<LocalAiModelRecord>,
    pub artifacts: Vec<LocalAiAssetRecord>,
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

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PersistedLocalAiRuntimeStateWrite {
    version: u32,
    assets: Vec<PersistedLocalAiInventoryRecord>,
    capability_index: HashMap<String, Vec<String>>,
    capability_matrix: Vec<LocalAiCapabilityMatrixEntry>,
    services: Vec<LocalAiServiceDescriptor>,
    downloads: Vec<LocalAiDownloadSessionRecord>,
    audits: Vec<LocalAiAuditEvent>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PersistedLocalAiRuntimeStateRead {
    #[serde(default = "default_local_ai_runtime_version")]
    version: u32,
    #[serde(default)]
    assets: Vec<PersistedLocalAiInventoryRecord>,
    #[serde(default)]
    models: Vec<LocalAiModelRecord>,
    #[serde(default)]
    artifacts: Vec<LocalAiAssetRecord>,
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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "assetRecordType", rename_all = "snake_case")]
enum PersistedLocalAiInventoryRecord {
    Runnable(PersistedRunnableAssetRecord),
    Passive(PersistedPassiveAssetRecord),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PersistedRunnableAssetRecord {
    local_asset_id: String,
    asset_id: String,
    model_type: LocalAiModelType,
    #[serde(default)]
    logical_model_id: String,
    #[serde(default)]
    capabilities: Vec<String>,
    engine: String,
    entry: String,
    #[serde(default)]
    files: Vec<String>,
    license: String,
    source: LocalAiAssetSource,
    #[serde(default)]
    integrity_mode: Option<LocalAiIntegrityMode>,
    #[serde(default)]
    hashes: HashMap<String, String>,
    #[serde(default)]
    tags: Vec<String>,
    known_total_size_bytes: Option<u64>,
    endpoint: String,
    status: PersistedLocalAiInventoryStatus,
    installed_at: String,
    updated_at: String,
    health_detail: Option<String>,
    #[serde(default)]
    asset_roles: Vec<String>,
    preferred_engine: Option<String>,
    #[serde(default)]
    fallback_engines: Vec<String>,
    engine_config: Option<serde_json::Value>,
    #[serde(default)]
    recommendation: Option<LocalAiRecommendationDescriptor>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PersistedPassiveAssetRecord {
    local_asset_id: String,
    asset_id: String,
    kind: LocalAiAssetKind,
    engine: String,
    entry: String,
    #[serde(default)]
    files: Vec<String>,
    license: String,
    source: LocalAiAssetSource,
    #[serde(default)]
    integrity_mode: Option<LocalAiIntegrityMode>,
    #[serde(default)]
    hashes: HashMap<String, String>,
    status: PersistedLocalAiInventoryStatus,
    installed_at: String,
    updated_at: String,
    health_detail: Option<String>,
    metadata: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
enum PersistedLocalAiInventoryStatus {
    Installed,
    Active,
    Unhealthy,
    Removed,
}

fn default_local_ai_runtime_version() -> u32 {
    LOCAL_AI_RUNTIME_VERSION
}

fn infer_model_type(capabilities: &[String]) -> LocalAiModelType {
    for capability in capabilities {
        let normalized = capability.trim().to_ascii_lowercase();
        match normalized.as_str() {
            "image" | "image.generate" | "image.edit" => return LocalAiModelType::Image,
            "video" | "video.generate" | "i2v" => return LocalAiModelType::Video,
            "stt" | "audio.transcribe" => return LocalAiModelType::Stt,
            "tts" | "audio.synthesize" | "voice_workflow.tts_v2v" | "voice_workflow.tts_t2v" => {
                return LocalAiModelType::Tts;
            }
            "music" | "music.generate" => return LocalAiModelType::Music,
            "chat" => return LocalAiModelType::Chat,
            "embedding" | "text.embedding" => return LocalAiModelType::Embedding,
            _ => {}
        }
    }
    LocalAiModelType::Chat
}

fn persisted_status_from_model(status: LocalAiModelStatus) -> PersistedLocalAiInventoryStatus {
    match status {
        LocalAiModelStatus::Installed => PersistedLocalAiInventoryStatus::Installed,
        LocalAiModelStatus::Active => PersistedLocalAiInventoryStatus::Active,
        LocalAiModelStatus::Unhealthy => PersistedLocalAiInventoryStatus::Unhealthy,
        LocalAiModelStatus::Removed => PersistedLocalAiInventoryStatus::Removed,
    }
}

fn persisted_status_from_asset(status: LocalAiAssetStatus) -> PersistedLocalAiInventoryStatus {
    match status {
        LocalAiAssetStatus::Installed => PersistedLocalAiInventoryStatus::Installed,
        LocalAiAssetStatus::Active => PersistedLocalAiInventoryStatus::Active,
        LocalAiAssetStatus::Unhealthy => PersistedLocalAiInventoryStatus::Unhealthy,
        LocalAiAssetStatus::Removed => PersistedLocalAiInventoryStatus::Removed,
    }
}

fn model_status_from_persisted(status: PersistedLocalAiInventoryStatus) -> LocalAiModelStatus {
    match status {
        PersistedLocalAiInventoryStatus::Installed => LocalAiModelStatus::Installed,
        PersistedLocalAiInventoryStatus::Active => LocalAiModelStatus::Active,
        PersistedLocalAiInventoryStatus::Unhealthy => LocalAiModelStatus::Unhealthy,
        PersistedLocalAiInventoryStatus::Removed => LocalAiModelStatus::Removed,
    }
}

fn asset_status_from_persisted(status: PersistedLocalAiInventoryStatus) -> LocalAiAssetStatus {
    match status {
        PersistedLocalAiInventoryStatus::Installed => LocalAiAssetStatus::Installed,
        PersistedLocalAiInventoryStatus::Active => LocalAiAssetStatus::Active,
        PersistedLocalAiInventoryStatus::Unhealthy => LocalAiAssetStatus::Unhealthy,
        PersistedLocalAiInventoryStatus::Removed => LocalAiAssetStatus::Removed,
    }
}

fn persisted_assets_from_runtime_state(
    state: &LocalAiRuntimeState,
) -> Vec<PersistedLocalAiInventoryRecord> {
    let mut assets = Vec::with_capacity(state.models.len() + state.artifacts.len());
    for model in &state.models {
        assets.push(PersistedLocalAiInventoryRecord::Runnable(
            PersistedRunnableAssetRecord {
                local_asset_id: model.local_model_id.clone(),
                asset_id: model.model_id.clone(),
                model_type: infer_model_type(&model.capabilities),
                logical_model_id: model.logical_model_id.clone(),
                capabilities: model.capabilities.clone(),
                engine: model.engine.clone(),
                entry: model.entry.clone(),
                files: model.files.clone(),
                license: model.license.clone(),
                source: LocalAiAssetSource {
                    repo: model.source.repo.clone(),
                    revision: model.source.revision.clone(),
                },
                integrity_mode: model.integrity_mode,
                hashes: model.hashes.clone(),
                tags: model.tags.clone(),
                known_total_size_bytes: model.known_total_size_bytes,
                endpoint: model.endpoint.clone(),
                status: persisted_status_from_model(model.status.clone()),
                installed_at: model.installed_at.clone(),
                updated_at: model.updated_at.clone(),
                health_detail: model.health_detail.clone(),
                asset_roles: model.artifact_roles.clone(),
                preferred_engine: model.preferred_engine.clone(),
                fallback_engines: model.fallback_engines.clone(),
                engine_config: model.engine_config.clone(),
                recommendation: model.recommendation.clone(),
            },
        ));
    }
    for asset in &state.artifacts {
        assets.push(PersistedLocalAiInventoryRecord::Passive(
            PersistedPassiveAssetRecord {
                local_asset_id: asset.local_asset_id.clone(),
                asset_id: asset.asset_id.clone(),
                kind: asset.kind.clone(),
                engine: asset.engine.clone(),
                entry: asset.entry.clone(),
                files: asset.files.clone(),
                license: asset.license.clone(),
                source: asset.source.clone(),
                integrity_mode: asset.integrity_mode,
                hashes: asset.hashes.clone(),
                status: persisted_status_from_asset(asset.status.clone()),
                installed_at: asset.installed_at.clone(),
                updated_at: asset.updated_at.clone(),
                health_detail: asset.health_detail.clone(),
                metadata: asset.metadata.clone(),
            },
        ));
    }
    assets
}

fn runtime_assets_from_persisted(
    assets: Vec<PersistedLocalAiInventoryRecord>,
) -> (Vec<LocalAiModelRecord>, Vec<LocalAiAssetRecord>) {
    let mut models = Vec::<LocalAiModelRecord>::new();
    let mut passive_assets = Vec::<LocalAiAssetRecord>::new();
    for asset in assets {
        match asset {
            PersistedLocalAiInventoryRecord::Runnable(record) => {
                models.push(LocalAiModelRecord {
                    local_model_id: record.local_asset_id,
                    model_id: record.asset_id,
                    logical_model_id: record.logical_model_id,
                    capabilities: record.capabilities,
                    engine: record.engine,
                    entry: record.entry,
                    files: record.files,
                    license: record.license,
                    source: LocalAiModelSource {
                        repo: record.source.repo,
                        revision: record.source.revision,
                    },
                    integrity_mode: record.integrity_mode,
                    hashes: record.hashes,
                    tags: record.tags,
                    known_total_size_bytes: record.known_total_size_bytes,
                    endpoint: record.endpoint,
                    status: model_status_from_persisted(record.status),
                    installed_at: record.installed_at,
                    updated_at: record.updated_at,
                    health_detail: record.health_detail,
                    artifact_roles: record.asset_roles,
                    preferred_engine: record.preferred_engine,
                    fallback_engines: record.fallback_engines,
                    engine_config: record.engine_config,
                    recommendation: record.recommendation,
                });
            }
            PersistedLocalAiInventoryRecord::Passive(record) => {
                passive_assets.push(LocalAiAssetRecord {
                    local_asset_id: record.local_asset_id,
                    asset_id: record.asset_id,
                    kind: record.kind,
                    engine: record.engine,
                    entry: record.entry,
                    files: record.files,
                    license: record.license,
                    source: record.source,
                    integrity_mode: record.integrity_mode,
                    hashes: record.hashes,
                    status: asset_status_from_persisted(record.status),
                    installed_at: record.installed_at,
                    updated_at: record.updated_at,
                    health_detail: record.health_detail,
                    metadata: record.metadata,
                });
            }
        }
    }
    (models, passive_assets)
}

impl Serialize for LocalAiRuntimeState {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        PersistedLocalAiRuntimeStateWrite {
            version: self.version,
            assets: persisted_assets_from_runtime_state(self),
            capability_index: self.capability_index.clone(),
            capability_matrix: self.capability_matrix.clone(),
            services: self.services.clone(),
            downloads: self.downloads.clone(),
            audits: self.audits.clone(),
        }
        .serialize(serializer)
    }
}

impl<'de> Deserialize<'de> for LocalAiRuntimeState {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let persisted = PersistedLocalAiRuntimeStateRead::deserialize(deserializer)?;
        let (models, artifacts) = if persisted.assets.is_empty() {
            (persisted.models, persisted.artifacts)
        } else {
            runtime_assets_from_persisted(persisted.assets)
        };
        Ok(Self {
            version: persisted.version,
            models,
            artifacts,
            capability_index: persisted.capability_index,
            capability_matrix: persisted.capability_matrix,
            services: persisted.services,
            downloads: persisted.downloads,
            audits: persisted.audits,
        })
    }
}
