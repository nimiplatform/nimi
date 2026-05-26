use std::io::{Read as IoRead, Write as IoWrite};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

use super::audit::{
    append_audit_event, EVENT_DEPENDENCY_RESOLVE_FAILED, EVENT_DEPENDENCY_RESOLVE_INVOKED,
    EVENT_MODEL_FILE_IMPORT_STARTED, EVENT_MODEL_IMPORT_VALIDATED,
    EVENT_RECOMMENDATION_RESOLVE_COMPLETED, EVENT_RECOMMENDATION_RESOLVE_FAILED,
    EVENT_RECOMMENDATION_RESOLVE_INVOKED, EVENT_RUNTIME_MODEL_READY_AFTER_INSTALL,
};
use super::catalog::list_catalog_variants_async;
use super::device_profile::collect_device_profile_async;
use super::download_manager;
use super::import_validator::{
    normalize_and_validate_capabilities, validate_import_asset_manifest_path,
    validate_loopback_endpoint,
};
use super::model_index::load_recommendation_feed_async;
use super::reason_codes::{
    extract_reason_code as extract_local_ai_reason_code, LOCAL_AI_PROVIDER_INTERNAL_ERROR,
};
use super::service_artifacts::find_service_artifact;
use super::store::{load_state, runtime_models_dir, save_state};
use super::types::{
    default_artifact_roles_for_capabilities, default_endpoint_for_engine,
    default_fallback_engines_for_engine, default_logical_model_id,
    default_preferred_engine_for_capabilities, infer_asset_integrity_mode_from_source,
    is_runnable_asset_kind, normalize_local_engine, now_iso_timestamp, resolved_model_dir,
    runtime_managed_asset_dir, runtime_managed_asset_manifest_path, slugify_local_model_id,
    CatalogVariantDescriptor, LocalAiAssetDeclaration, LocalAiAssetHealth, LocalAiAssetKind,
    LocalAiAssetRecord, LocalAiAssetSource, LocalAiAssetStatus, LocalAiDownloadProgressEvent,
    LocalAiDownloadState, LocalAiInstallRequest, LocalAiIntegrityMode,
    LocalAiRecommendationFeedDescriptor, LocalAiRuntimeState, LocalAiSuggestionConfidence,
    LocalAiSuggestionSource, LocalAiTransferSessionKind, LocalAiUnregisteredAssetDescriptor,
    LOCAL_AI_DOWNLOAD_PROGRESS_EVENT,
};

include!("common_types.rs");
include!("common_utils.rs");
include!("dependency_utils.rs");
include!("runtime_bridge_local.rs");
include!("commands_assets.rs");
include!("commands_catalog_dependencies.rs");
include!("commands_downloads.rs");
include!("commands_import_manifest.rs");
include!("commands_import_file.rs");
include!("commands_import_bundle.rs");
include!("commands_models_audit.rs");
include!("commands_assets_intake.rs");
include!("commands_recommendation_feed.rs");
include!("commands_reveal_tests.rs");
