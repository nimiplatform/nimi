use super::store::{
    agent_center_dir, desktop_agent_center_config_get, desktop_agent_center_config_put,
    local_scope_path_segment, validate_background_id, validate_normalized_id, validate_package_id,
    validate_utc_timestamp,
};
use super::types::*;
use chrono::{Duration, Utc};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{BTreeSet, HashSet};
use std::env;
use std::fs::{self, OpenOptions};
use std::io::ErrorKind;
use std::io::Write;
use std::path::{Component, Path, PathBuf};
use url::Url;

const VALIDATION_SCHEMA_VERSION: u8 = 1;
const AVATAR_PACKAGE_MANIFEST_VERSION: u8 = 1;
const MAX_MANIFEST_BYTES: u64 = 262_144;
const MAX_PACKAGE_BYTES: u64 = 524_288_000;
const MAX_FILE_BYTES: u64 = 104_857_600;
const MAX_FILE_COUNT: usize = 2_048;
const MAX_BACKGROUND_BYTES: u64 = 20_971_520;
const MAX_BACKGROUND_PIXELS: u32 = 8_192;
const VALIDATION_FILE_NAME: &str = "validation.json";
const MANIFEST_FILE_NAME: &str = "manifest.json";
const OPERATIONS_FILE_NAME: &str = "agent-center-local-resources.jsonl";
const OPERATION_RETENTION_DAYS: i64 = 30;
const QUARANTINE_RETENTION_DAYS: i64 = 7;

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct AvatarPackageManifest {
    manifest_version: u8,
    package_version: String,
    package_id: String,
    kind: AgentCenterAvatarPackageKind,
    loader_min_version: String,
    display_name: String,
    #[serde(default)]
    display_name_i18n: serde_json::Map<String, serde_json::Value>,
    entry_file: String,
    required_files: Vec<String>,
    content_digest: String,
    files: Vec<AvatarPackageManifestFile>,
    limits: AvatarPackageManifestLimits,
    capabilities: serde_json::Value,
    import: AvatarPackageManifestImport,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct AvatarPackageManifestFile {
    path: String,
    sha256: String,
    bytes: u64,
    mime: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct AvatarPackageManifestLimits {
    max_manifest_bytes: u64,
    max_package_bytes: u64,
    max_file_bytes: u64,
    max_file_count: usize,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct AvatarPackageManifestImport {
    imported_at: String,
    source_label: String,
    source_fingerprint: String,
}

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
#[path = "resources_validation.rs"]
mod resources_validation;

use resources_manifest_validation::*;
use resources_operations::*;
use resources_validation::*;

pub(crate) use resources_commands::*;
pub(crate) use resources_manifest_validation::*;

#[cfg(test)]
#[path = "resources_tests.rs"]
mod resources_tests;
