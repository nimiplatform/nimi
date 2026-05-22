use serde::{Deserialize, Serialize};

/// Canonical built-in chat `AIScopeRef` (`P-AISC-001` / `P-AISC-006`).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BuiltInChatScopeRef {
    pub kind: String,
    pub owner_id: String,
    pub surface_id: String,
}

/// The applied first-run baseline `AIProfile` reference + payload hash.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BuiltInAiProfileRef {
    pub profile_id: String,
    pub ai_profile_alias: String,
    pub install_level: String,
    pub source_policy_ref: String,
    pub source_catalog_id: String,
    pub source_catalog_version: u32,
    pub profile_payload_hash: String,
    pub applied_at: String,
}

/// Per-capability binding intent materialized from the factory `AIProfile`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BuiltInAiConfigCapability {
    pub capability: String,
    pub binding: serde_json::Value,
}

/// Full materialized built-in `AIConfig` payload for one canonical scope.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BuiltInAiConfigPayload {
    pub scope_ref: BuiltInChatScopeRef,
    pub capabilities: Vec<BuiltInAiConfigCapability>,
    pub profile_origin: BuiltInAiProfileRef,
}

/// Committed durable built-in `AIConfig` evidence record.
///
/// Persisted under the selected data root. The five `required_projection`
/// fields of `builtInAiConfigRefs` are: `scopeRef`, `aiProfileRef_or_hash`,
/// `aiConfigVersion_or_hash`, `writer_identity`, `committedAt`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BuiltInAiConfigRecord {
    pub schema_version: u32,
    pub account_id: String,
    pub data_root_ref: String,
    /// required_projection[0]: canonical built-in chat `scopeRef`.
    pub scope_ref: BuiltInChatScopeRef,
    /// required_projection[1]: applied `AIProfile` ref + payload hash.
    pub ai_profile_ref: BuiltInAiProfileRef,
    /// required_projection[2a]: committed `AIConfig` version.
    pub ai_config_version: u64,
    /// required_projection[2b]: committed `AIConfig` content hash.
    pub ai_config_content_hash: String,
    /// required_projection[3]: Desktop host writer identity.
    pub writer_identity: String,
    /// required_projection[4]: commit timestamp.
    pub committed_at: String,
    pub config_payload: BuiltInAiConfigPayload,
    pub apply_source: String,
}

/// Backend-verifiable durable built-in `AIConfig` evidence projection.
///
/// Returned by the resolve/verify seam consumed by wave-6
/// `AdmitProductReadyForUse`. Carries the five `required_projection` fields.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BuiltInAiConfigEvidence {
    pub built_in_ai_config_ref: String,
    pub config_path: String,
    pub account_id: String,
    pub data_root_ref: String,
    /// required_projection[0]
    pub scope_ref: BuiltInChatScopeRef,
    /// required_projection[1]
    pub ai_profile_ref: BuiltInAiProfileRef,
    /// required_projection[2a]
    pub ai_config_version: u64,
    /// required_projection[2b]
    pub ai_config_content_hash: String,
    /// required_projection[3]
    pub writer_identity: String,
    /// required_projection[4]
    pub committed_at: String,
}

/// Full first-run built-in chat evidence set for BOTH canonical scopes.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BuiltInAiConfigEvidenceSet {
    pub nimi: BuiltInAiConfigEvidence,
    pub agent: BuiltInAiConfigEvidence,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BuiltInAiConfigScopeInitCapabilities {
    pub selected_bindings: serde_json::Map<String, serde_json::Value>,
    pub local_profile_refs: serde_json::Map<String, serde_json::Value>,
    pub selected_params: serde_json::Map<String, serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BuiltInAiConfigScopeInitProfileOrigin {
    pub profile_id: String,
    pub title: String,
    pub applied_at: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BuiltInAiConfigForScopeInit {
    pub scope_ref: BuiltInChatScopeRef,
    pub capabilities: BuiltInAiConfigScopeInitCapabilities,
    pub profile_origin: BuiltInAiConfigScopeInitProfileOrigin,
}

impl BuiltInAiConfigEvidenceSet {
    /// Durable `builtInAiConfigRefs` in stable order (`nimi`, then `agent`).
    pub fn refs(&self) -> Vec<String> {
        vec![
            self.nimi.built_in_ai_config_ref.clone(),
            self.agent.built_in_ai_config_ref.clone(),
        ]
    }
}
