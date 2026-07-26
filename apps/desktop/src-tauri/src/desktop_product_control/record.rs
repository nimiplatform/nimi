//! Product-control projection types and Tauri command payloads consumed from
//! the Runtime-validated canonical `~/.nimi/nimi.json` record.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ProductControlState {
    NotLoggedIn,
    ConfigMissing,
    DataRootMissing,
    DataRootSelected,
    AiEnvironmentUnconfigured,
    LocalAiProfileSelectedAssetsMissing,
    LocalAiProfileSelectedEnvironmentNotReady,
    LocalAiAssetsDownloadedEnvironmentNotReady,
    LocalAiReady,
    RepairRequired,
    Blocked,
    ReadyForUse,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ProductDataRootStatus {
    Selected,
    Ready,
    RepairRequired,
}

impl Default for ProductDataRootStatus {
    fn default() -> Self {
        ProductDataRootStatus::Selected
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProductDataRootRecord {
    pub path: String,
    pub status: ProductDataRootStatus,
    pub selected_at: String,
    pub verified_at: String,
    pub selected_at_unix_ms: u128,
    pub verified_at_unix_ms: u128,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProductFirstRunRecord {
    pub install_level: Option<String>,
    pub ai_profile_alias: Option<String>,
    pub completed: bool,
    pub completed_at: Option<String>,
    pub initialization_plan_id: Option<String>,
    pub baseline_profile_ref: Option<String>,
    pub baseline_commit_id: Option<String>,
    pub account_default_profile_ref: Option<String>,
    pub built_in_ai_config_refs: Vec<String>,
    pub runtime_baseline_ref: Option<String>,
    pub execution_evidence_ref: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProductPointersRecord {
    /// Discoverability pointer to `~/.nimi/profiles/factory-index.json`, the
    /// installed projection of the official Platform factory profile catalog
    /// (`factory_profile_index.rs`). This is a non-owner discovery pointer: the factory profile index is a read-only
    /// catalog projection, not product readiness truth, and it is never the
    /// Account Default Profile library.
    pub factory_profile_index: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProductRepairRecord {
    pub required: bool,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProductControlRecord {
    pub schema_version: u32,
    pub install_id: String,
    pub product_version: String,
    pub state: ProductControlState,
    pub data_root: Option<ProductDataRootRecord>,
    pub first_run: ProductFirstRunRecord,
    pub pointers: ProductPointersRecord,
    pub repair: ProductRepairRecord,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProductControlRecordProjection {
    pub path: String,
    pub exists: bool,
    pub state: ProductControlState,
    pub record: Option<ProductControlRecord>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProductControlSelectedDataRootProjection {
    pub path: String,
    pub exists: bool,
    pub state: ProductControlState,
    pub data_root: Option<ProductDataRootRecord>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProductDataRootSelectPayload {
    pub data_root: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProductFirstRunInstallLevelPayload {
    pub install_level: String,
    pub ai_profile_alias: Option<String>,
}
