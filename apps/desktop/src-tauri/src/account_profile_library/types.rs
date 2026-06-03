use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AccountDefaultAIProfilePayload {
    pub profile_id: String,
    pub title: String,
    pub description: String,
    pub tags: Vec<String>,
    pub capabilities: serde_json::Map<String, serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AccountDefaultFactoryProvenance {
    pub ai_profile_alias: String,
    pub privacy_posture: String,
    pub compute_posture: String,
    pub capability_set: Vec<String>,
    pub routing_policy: String,
    pub host_capability_profile_refs: Vec<String>,
    pub local_compute_pack_refs: Vec<String>,
    pub dependency_family_refs: Vec<String>,
    pub materialization_confirmation_required: bool,
    pub applicable_scopes: Vec<String>,
    pub first_run_install_levels: Vec<String>,
    pub source_rule: String,
    pub source_policy_ref: String,
    pub source_catalog_id: String,
    pub source_catalog_version: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AccountDefaultProfileRevisionProvenance {
    pub revision_kind: String,
    pub source: String,
    pub previous_content_hash: Option<String>,
    pub changed_at: String,
}

/// Manual-named nested `source` object for the Account Default Profile record.
///
/// Product manual `~/.nimi/accounts/<account-id>/profiles/default.json` schema:
/// `source { kind: "factory-policy", policyRef, catalogVersion }`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AccountDefaultProfileSource {
    pub kind: String,
    pub policy_ref: String,
    pub catalog_version: u32,
    /// Additive wave-10 provenance: which factory catalog the policy resolves
    /// against. The manual's named trio is `kind`/`policyRef`/`catalogVersion`;
    /// `catalogId` and `catalogRowSourceRule` stay as additive verification
    /// facts so factory-row provenance remains hash-chained.
    pub catalog_id: String,
    pub catalog_row_source_rule: String,
}

/// Manual-named nested `profile` object for the Account Default Profile record.
///
/// Product manual schema: `profile { aiProfileVersion }`. Wave-10's verified
/// AIProfile payload + payload hash stay as additive fields on the same object
/// so the seeded profile content remains hash-chained.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AccountDefaultProfileBody {
    pub ai_profile_version: u64,
    pub payload: AccountDefaultAIProfilePayload,
    pub payload_hash: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AccountDefaultProfileRecord {
    pub schema_version: u32,
    pub profile_id: String,
    pub display_name: String,
    pub source: AccountDefaultProfileSource,
    pub editable: bool,
    pub removable: bool,
    pub profile: AccountDefaultProfileBody,
    pub updated_at: String,
    // --- additive wave-10 verification / provenance / binding fields ---
    pub account_id: String,
    pub data_root_ref: String,
    pub ai_profile_alias: String,
    pub install_level: String,
    pub capability_set: Vec<String>,
    pub routing_policy: String,
    pub factory_seed_profile_payload: AccountDefaultAIProfilePayload,
    pub factory_seed_profile_payload_hash: String,
    pub factory_provenance: AccountDefaultFactoryProvenance,
    pub factory_provenance_hash: String,
    pub profile_revision: AccountDefaultProfileRevisionProvenance,
    pub created_at: String,
    pub content_hash: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AccountDefaultProfileEvidence {
    pub account_default_profile_ref: String,
    pub profile_path: String,
    pub account_id: String,
    pub data_root_ref: String,
    pub profile_id: String,
    pub profile_version: u64,
    pub content_hash: String,
    pub source_policy_ref: String,
    pub source_catalog_id: String,
    pub source_catalog_version: u32,
    pub created_at: String,
    pub updated_at: String,
    pub ai_profile_alias: String,
    pub profile_payload_hash: String,
    pub factory_provenance_hash: String,
}

/// The Account Default Profile projected as a portable AIProfile-shaped
/// payload, for the AIConfig scope-init rule.
///
/// Carries the same `profileId` / `title` / `description` / `tags` /
/// `capabilities` shape as the SDK `AIProfile` template. It is the verified
/// content of the durable `default.json` record; the renderer never
/// reconstructs it from realm session or app-local state.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AccountDefaultProfileAIProfile {
    pub profile_id: String,
    pub title: String,
    pub description: String,
    pub tags: Vec<String>,
    pub capabilities: serde_json::Map<String, serde_json::Value>,
}
