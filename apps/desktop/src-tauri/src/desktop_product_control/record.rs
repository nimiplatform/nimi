//! Product-control record (`~/.nimi/nimi.json`) type surface: the persisted
//! schema, the renderer-facing projection, and the Tauri command payloads.

use serde::{Deserialize, Serialize};

pub(crate) const PRODUCT_CONTROL_FILE_NAME: &str = "nimi.json";
pub(crate) const PRODUCT_CONTROL_SCHEMA_VERSION: u32 = 1;

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
    pub runtime_config_path: Option<String>,
    /// Discoverability pointer to `~/.nimi/profiles/factory-index.json`, the
    /// installed projection of the official Platform factory profile catalog
    /// (`factory_profile_index.rs`). Like `runtime_config_path`, this is a
    /// non-owner discovery pointer: the factory profile index is a read-only
    /// catalog projection, not product readiness truth, and it is never the
    /// Account Default Profile library.
    pub factory_profile_index: Option<String>,
    /// Discoverability pointer to `~/.nimi/apps/registry.json`, the installed
    /// projection of the admitted ordinary Nimi App registry
    /// (`apps_registry_projection.rs`). Non-owner discovery pointer: the
    /// registry projection is a read-only catalog projection, not product
    /// readiness truth. This is the manual `pointers.appRegistry` value.
    pub app_registry: Option<String>,
    /// Discoverability pointer to `~/.nimi/apps/packages.json`. Runtime
    /// `GetAppPackageReadiness` owns package readiness; this pointer is not a
    /// readiness source. This is the manual `pointers.appPackages` value.
    pub app_packages: Option<String>,
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

#[allow(dead_code)]
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProductFirstRunSetupStatePayload {
    pub state: String,
    pub reason: Option<String>,
}
