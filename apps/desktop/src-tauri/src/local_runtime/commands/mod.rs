use std::io::{Read as IoRead, Write as IoWrite};

use serde::Deserialize;
use tauri::AppHandle;

use super::audit::{
    append_audit_event, EVENT_DEPENDENCY_RESOLVE_FAILED, EVENT_DEPENDENCY_RESOLVE_INVOKED,
    EVENT_RECOMMENDATION_RESOLVE_COMPLETED, EVENT_RECOMMENDATION_RESOLVE_FAILED,
    EVENT_RECOMMENDATION_RESOLVE_INVOKED, EVENT_RUNTIME_MODEL_READY_AFTER_INSTALL,
};
use super::import_validator::{
    validate_import_asset_manifest_path,
};
use super::reason_codes::{
    extract_reason_code as extract_local_ai_reason_code, LOCAL_AI_PROVIDER_INTERNAL_ERROR,
};
use super::service_artifacts::find_service_artifact;
use super::store::{load_state, runtime_models_dir, save_state};
use super::types::{
    default_artifact_roles_for_capabilities, default_endpoint_for_engine,
    default_fallback_engines_for_engine, default_logical_model_id,
    default_preferred_engine_for_capabilities, infer_asset_integrity_mode_from_source,
    is_runnable_asset_kind, normalize_local_engine, resolved_model_dir, runtime_managed_asset_dir,
    runtime_managed_asset_manifest_path, slugify_local_model_id, LocalAiAssetKind,
    LocalAiAssetRecord, LocalAiAssetSource, LocalAiAssetStatus,
};

include!("common_types.rs");
include!("common_utils.rs");
include!("dependency_utils.rs");
include!("runtime_bridge_local.rs");
include!("commands_asset_helpers.rs");
include!("commands_import_manifest.rs");
include!("commands_import_bundle.rs");
include!("commands_models_audit.rs");
include!("commands_reveal_tests.rs");
