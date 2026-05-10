use super::store::{
    agent_center_dir, desktop_agent_center_config_get, desktop_agent_center_config_put,
    local_scope_path_segment, validate_background_id, validate_live2d_adapter_manifest_ref,
    validate_normalized_id, validate_package_id, validate_utc_timestamp,
};
use super::types::*;
use chrono::{Duration, Utc};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::env;
use std::fs::{self, OpenOptions};
use std::io::ErrorKind;
use std::io::Write;
use std::path::{Component, Path, PathBuf};
use url::Url;

const VALIDATION_SCHEMA_VERSION: u8 = 1;
const MAX_LIVE2D_ADAPTER_MANIFEST_BYTES: u64 = 262_144;
const MAX_BACKGROUND_BYTES: u64 = 20_971_520;
const MAX_BACKGROUND_PIXELS: u32 = 8_192;
const VALIDATION_FILE_NAME: &str = "validation.json";
const MANIFEST_FILE_NAME: &str = "manifest.json";
const LIVE2D_ADAPTER_FILE_NAME: &str = "live2d-adapter.json";
const LIVE2D_ADAPTER_CUSTODY_FILE_NAME: &str = "custody.json";
const OPERATIONS_FILE_NAME: &str = "agent-center-local-resources.jsonl";
const OPERATION_RETENTION_DAYS: i64 = 30;
const QUARANTINE_RETENTION_DAYS: i64 = 7;

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct BackgroundManifest {
    manifest_version: u8,
    background_asset_id: String,
    display_name: String,
    image_file: String,
    mime: String,
    bytes: u64,
    pixel_width: u32,
    pixel_height: u32,
    limits: BackgroundManifestLimits,
    sha256: String,
    imported_at: String,
    source_label: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct BackgroundManifestLimits {
    max_bytes: u64,
    max_pixel_width: u32,
    max_pixel_height: u32,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Live2dAdapterManifestCustody {
    custody_version: u8,
    manifest_ref: String,
    package_id: String,
    manifest_kind: String,
    schema_version: u8,
    sha256: String,
    bytes: u64,
    imported_at: String,
    source_label: String,
}

#[derive(Debug, Serialize)]
#[serde(deny_unknown_fields)]
struct AgentCenterResourceOperationRecord {
    schema_version: u8,
    event_id: String,
    transaction_id: String,
    occurred_at: String,
    operation_type: String,
    resource_kind: String,
    resource_id: String,
    status: String,
    reason_code: String,
}

#[path = "resources_commands.rs"]
mod resources_commands;
#[path = "resources_manifest_validation.rs"]
mod resources_manifest_validation;
#[path = "resources_operations.rs"]
mod resources_operations;
#[path = "resources_remove_commands.rs"]
mod resources_remove_commands;
#[path = "resources_validation.rs"]
mod resources_validation;

use resources_manifest_validation::*;
use resources_operations::*;
use resources_validation::*;

pub(crate) use resources_commands::*;
pub(crate) use resources_manifest_validation::*;
pub(crate) use resources_remove_commands::*;

#[cfg(test)]
#[path = "resources_tests.rs"]
mod resources_tests;
