use std::collections::BTreeMap;
use std::io::{Read as IoRead, Write as IoWrite};
use std::time::{SystemTime, UNIX_EPOCH};

use chrono::DateTime;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter};

use super::audit::{
    append_audit_event, EVENT_DEPENDENCY_APPLY_COMPLETED, EVENT_DEPENDENCY_APPLY_FAILED,
    EVENT_DEPENDENCY_APPLY_STARTED, EVENT_DEPENDENCY_RESOLVE_FAILED,
    EVENT_DEPENDENCY_RESOLVE_INVOKED, EVENT_FALLBACK_TO_TOKEN_API, EVENT_INFERENCE_FAILED,
    EVENT_INFERENCE_INVOKED, EVENT_MODEL_CATALOG_SEARCH_FAILED, EVENT_MODEL_CATALOG_SEARCH_INVOKED,
    EVENT_MODEL_DOWNLOAD_COMPLETED, EVENT_MODEL_DOWNLOAD_FAILED, EVENT_MODEL_DOWNLOAD_STARTED,
    EVENT_MODEL_FILE_IMPORT_STARTED, EVENT_MODEL_IMPORT_FAILED, EVENT_MODEL_IMPORT_VALIDATED,
    EVENT_NODE_CATALOG_LISTED, EVENT_RUNTIME_MODEL_READY_AFTER_INSTALL,
    EVENT_SERVICE_INSTALL_COMPLETED, EVENT_SERVICE_INSTALL_FAILED, EVENT_SERVICE_INSTALL_STARTED,
};
use super::capability_matrix::refresh_state_capability_matrix_with_probe_and_device;
use super::catalog::{
    list_repo_gguf_variants, resolve_install_plan as resolve_catalog_install_plan, search_catalog,
    LocalAiCatalogResolveInput,
};
use super::dependency_apply::{
    fail_progress, mark_capability_matrix_refresh, run_preflight_all, DependencyApplyProgress,
};
use super::dependency_resolver::{
    resolve_dependencies, DependencyAlternativeInput, DependencyDeclarationInput,
    DependencyOptionInput, DependencyResolveInput,
};
use super::device_profile::collect_device_profile;
use super::download_manager;
use super::hf_source::{install_from_hf, HfDownloadProgress};
use super::import_validator::{
    manifest_to_model_record, normalize_and_validate_capabilities, parse_and_validate_manifest,
    validate_import_manifest_path, validate_loopback_endpoint,
};
use super::model_registry::{list_models, remove_model, upsert_model};
use super::node_catalog::list_nodes_from_services;
use super::reason_codes::{
    extract_reason_code as extract_local_ai_reason_code, normalize_local_ai_reason_code,
    LOCAL_AI_PROVIDER_INTERNAL_ERROR,
};
use super::service_artifacts::find_service_artifact;
use super::service_lifecycle::{
    bootstrap_service_artifact, build_service_descriptor, is_managed_service,
    normalize_service_descriptor, preflight_dependency, preflight_service_artifact,
    probe_service_capability_models, probe_service_endpoint_health, resolve_node_host_service,
    start_managed_service, stop_managed_service,
};
use super::store::{load_state, runtime_models_dir, save_state};
use super::supervisor::{health, start_model, stop_model};
use super::types::{
    now_iso_timestamp, slugify_local_model_id, GgufVariantDescriptor, LocalAiAuditEvent,
    LocalAiCatalogItemDescriptor, LocalAiDependencyApplyResult, LocalAiDependencyKind,
    LocalAiDependencyResolutionPlan, LocalAiDeviceProfile, LocalAiDownloadControlPayload,
    LocalAiDownloadProgressEvent, LocalAiDownloadSessionSummary, LocalAiDownloadState,
    LocalAiInstallPlanDescriptor, LocalAiInstallRequest, LocalAiModelHealth, LocalAiModelRecord,
    LocalAiNodeDescriptor, LocalAiRuntimeState, LocalAiServiceArtifactType,
    LocalAiServiceDescriptor, LocalAiServiceStatus, LocalAiVerifiedModelDescriptor,
    OrphanModelFile, DEFAULT_LOCAL_RUNTIME_ENDPOINT, LOCAL_AI_DOWNLOAD_PROGRESS_EVENT,
};
use super::verified_models::{find_verified_model, verified_model_list};

include!("common_types.rs");
include!("common_utils.rs");
include!("dependency_utils.rs");
include!("service_utils.rs");
include!("dependency_apply.rs");
include!("commands_catalog_audit.rs");
include!("commands_install_shared.rs");
include!("commands_catalog_dependencies.rs");
include!("commands_services.rs");
include!("commands_downloads.rs");
include!("commands_import_manifest.rs");
include!("commands_import_file.rs");
include!("commands_models_audit.rs");
include!("commands_orphan_scan.rs");
include!("commands_reveal_tests.rs");
