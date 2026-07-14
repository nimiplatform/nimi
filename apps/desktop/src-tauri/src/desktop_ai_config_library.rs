//! Desktop host built-in first-run AIConfig evidence owner.
//!
//! Spec authority:
//!   - `D-AIPC-013` Built-In First-Run AIConfig Evidence
//!   - `D-AIPC-005` Profile apply (atomic full materialization overwrite)
//!   - `P-AISC-006` Built-In First-Run Chat Scopes (the two canonical `feature` scopes)
//!   - `product-control-record-schema.yaml` `builtInAiConfigRefs`
//!
//! This Desktop/Tauri host module owns first-run built-in `AIConfig`
//! materialization for the two canonical first-run chat scopes. It applies the
//! selected local baseline factory `AIProfile` via atomic apply, commits a full
//! materialized config record under the selected data root, and mints a durable
//! `builtInAiConfigRef` only after binding all five `required_projection`
//! fields. It exposes a resolve-by-ref + verify operation used by wave-6
//! `AdmitProductReadyForUse`.
//!
//! Hard boundaries:
//!   - generic chat scope, omitted scope, localStorage/string-only refs, and a
//!     partial one-of-two set never satisfy ready admission;
//!   - apply/verify failure for either canonical scope fails first-run closed;
//!   - capability intent is sourced only from the admitted factory `AIProfile`
//!     row;
//!   - executable model/provider values are projected only from Runtime-owned
//!     executionEvidenceRef capability proof through the shared Tauri shell
//!     projection helper; Desktop does not infer provider, engine, consumer, or
//!     route policy from runtimeBaselineRef internals.

use nimi_shell_tauri::capabilities::ai_profile::{
    verify_first_run_factory_ai_profile, PlatformAIProfileFactoryRow,
    PLATFORM_AI_PROFILE_FACTORY_CATALOG_ID, PLATFORM_AI_PROFILE_FACTORY_CATALOG_VERSION,
    PLATFORM_AI_PROFILE_SELECTION_POLICY_REF,
};
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{
    atomic::{AtomicU64, Ordering},
    Mutex,
};

const BUILT_IN_AI_CONFIG_SCHEMA_VERSION: u32 = 1;
const BUILT_IN_AI_CONFIG_REF_PREFIX: &str = "built-in-ai-config:v1";
const BUILT_IN_AI_CONFIG_WRITER_IDENTITY: &str = "desktop_host_ai_config_service";
const BUILT_IN_AI_CONFIG_SCOPE_KIND: &str = "feature";
const BUILT_IN_AI_CONFIG_SCOPE_OWNER_ID: &str = "desktop.chat";
const BUILT_IN_AI_CONFIG_APPLY_SOURCE: &str = "desktop_host_first_run_built_in_ai_config";
static BUILT_IN_AI_CONFIG_TEMP_SEQUENCE: AtomicU64 = AtomicU64::new(0);
static BUILT_IN_AI_CONFIG_MATERIALIZE_LOCK: Mutex<()> = Mutex::new(());

/// The two canonical first-run built-in chat surface ids (`P-AISC-006`).
const BUILT_IN_CHAT_SURFACE_IDS: &[&str] = &["nimi", "agent"];

#[path = "desktop_ai_config_library/types.rs"]
mod types;
pub use types::*;

fn built_in_ai_config_for_scope_init_from_record(
    record: &BuiltInAiConfigRecord,
) -> BuiltInAiConfigForScopeInit {
    let mut selected_bindings = serde_json::Map::new();
    for capability in &record.config_payload.capabilities {
        if !capability.binding.is_null() {
            selected_bindings.insert(capability.capability.clone(), capability.binding.clone());
        }
    }
    BuiltInAiConfigForScopeInit {
        scope_ref: record.scope_ref.clone(),
        capabilities: BuiltInAiConfigScopeInitCapabilities {
            target_refs: selected_bindings,
            local_profile_refs: serde_json::Map::new(),
            selected_params: serde_json::Map::new(),
        },
        profile_origin: BuiltInAiConfigScopeInitProfileOrigin {
            profile_id: record.ai_profile_ref.profile_id.clone(),
            title: format!("Factory {}", record.ai_profile_ref.ai_profile_alias),
            applied_at: record.ai_profile_ref.applied_at.clone(),
        },
    }
}

#[path = "desktop_ai_config_library/identity.rs"]
mod identity;
pub use identity::{built_in_ai_config_path, data_root_ref};
use identity::{
    built_in_chat_scope_ref, now_iso_timestamp, scope_path_segment, sha256_hex, stable_json_hash,
    validate_account_id, validate_built_in_chat_surface_id, verify_built_in_chat_scope_ref,
};

/// Materialize the full per-capability config from the factory `AIProfile` row.
///
/// `D-AIPC-005`: this is a full materialization overwrite, not a merge. Binding
/// intent starts unbound (`null`) - first-run does not hardcode any provider,
/// connector, engine, or model identifier.
fn config_capabilities_from_row(
    row: &PlatformAIProfileFactoryRow,
    baseline_bindings: &[BuiltInAiConfigCapability],
) -> Vec<BuiltInAiConfigCapability> {
    let binding_for_capability = |capability: &str| {
        baseline_bindings
            .iter()
            .find(|binding| binding.capability == capability)
            .map(|binding| binding.binding.clone())
            .unwrap_or(serde_json::Value::Null)
    };
    let mut capabilities: Vec<BuiltInAiConfigCapability> = row
        .capability_set
        .iter()
        .map(|capability| BuiltInAiConfigCapability {
            capability: (*capability).to_string(),
            binding: binding_for_capability(capability),
        })
        .collect();
    capabilities.sort_by(|a, b| a.capability.cmp(&b.capability));
    capabilities
}

fn ai_profile_ref_from_row(
    row: &PlatformAIProfileFactoryRow,
    install_level: &str,
    applied_at: &str,
    baseline_bindings: &[BuiltInAiConfigCapability],
) -> Result<BuiltInAiProfileRef, String> {
    let payload_hash = stable_json_hash(
        &config_capabilities_from_row(row, baseline_bindings),
        "built-in AIConfig capability payload",
    )?;
    Ok(BuiltInAiProfileRef {
        profile_id: format!("factory:{}", row.alias),
        ai_profile_alias: row.alias.to_string(),
        install_level: install_level.trim().to_string(),
        source_policy_ref: PLATFORM_AI_PROFILE_SELECTION_POLICY_REF.to_string(),
        source_catalog_id: PLATFORM_AI_PROFILE_FACTORY_CATALOG_ID.to_string(),
        source_catalog_version: PLATFORM_AI_PROFILE_FACTORY_CATALOG_VERSION,
        profile_payload_hash: payload_hash,
        applied_at: applied_at.to_string(),
    })
}

pub fn runtime_capability_bindings_from_execution_evidence_ref(
    evidence: &crate::runtime_bridge::generated::ExecutionEvidenceRef,
) -> Result<Vec<BuiltInAiConfigCapability>, String> {
    let mut bindings = nimi_shell_tauri::capabilities::ai_config::project_first_run_execution_evidence_to_ai_config_bindings(evidence)?
        .into_iter()
        .map(|item| BuiltInAiConfigCapability {
            capability: item.capability,
            binding: item.binding,
        })
        .collect::<Vec<_>>();
    bindings.sort_by(|a, b| a.capability.cmp(&b.capability));
    Ok(bindings)
}

fn capability_binding_from_capabilities<'a>(
    capabilities: &'a [BuiltInAiConfigCapability],
    capability: &str,
) -> Option<&'a serde_json::Value> {
    capabilities
        .iter()
        .find(|item| item.capability == capability)
        .map(|capability| &capability.binding)
}

/// Stable content hash over the committed config payload + identity binding.
fn compute_config_content_hash(record: &BuiltInAiConfigRecord) -> Result<String, String> {
    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    struct HashPayload<'a> {
        schema_version: u32,
        account_id: &'a str,
        data_root_ref: &'a str,
        scope_ref: &'a BuiltInChatScopeRef,
        ai_profile_ref: &'a BuiltInAiProfileRef,
        ai_config_version: u64,
        writer_identity: &'a str,
        committed_at: &'a str,
        config_payload: &'a BuiltInAiConfigPayload,
        apply_source: &'a str,
    }
    let payload = HashPayload {
        schema_version: record.schema_version,
        account_id: &record.account_id,
        data_root_ref: &record.data_root_ref,
        scope_ref: &record.scope_ref,
        ai_profile_ref: &record.ai_profile_ref,
        ai_config_version: record.ai_config_version,
        writer_identity: &record.writer_identity,
        committed_at: &record.committed_at,
        config_payload: &record.config_payload,
        apply_source: &record.apply_source,
    };
    stable_json_hash(&payload, "built-in AIConfig content")
}

/// Durable backend-verifiable ref. Bound to account + scope + content hash so a
/// caller-provided / string-only ref cannot resolve.
fn built_in_ai_config_ref(record: &BuiltInAiConfigRecord) -> Result<String, String> {
    let account_hash = sha256_hex(record.account_id.as_bytes());
    let content_hash = record
        .ai_config_content_hash
        .strip_prefix("sha256:")
        .ok_or_else(|| "built-in AIConfig contentHash must use sha256".to_string())?;
    Ok(format!(
        "{BUILT_IN_AI_CONFIG_REF_PREFIX}:{account_hash}:{}:{content_hash}",
        scope_path_segment(&record.scope_ref.surface_id)
    ))
}

/// Verify all committed fields against the admitted factory catalog + identity.
fn verify_record_fields(
    record: &BuiltInAiConfigRecord,
    authenticated_account_id: &str,
    expected_data_root_ref: &str,
    expected_surface_id: &str,
    expected_baseline_bindings: Option<&[BuiltInAiConfigCapability]>,
) -> Result<(), String> {
    let account_id = validate_account_id(authenticated_account_id)?;
    let expected_surface = validate_built_in_chat_surface_id(expected_surface_id)?;
    if record.schema_version != BUILT_IN_AI_CONFIG_SCHEMA_VERSION {
        return Err("built-in AIConfig schemaVersion is unsupported".to_string());
    }
    if record.account_id != account_id {
        return Err(
            "built-in AIConfig account_id does not match authenticated Runtime account".to_string(),
        );
    }
    if record.data_root_ref != expected_data_root_ref {
        return Err("built-in AIConfig dataRootRef does not match selected data root".to_string());
    }
    verify_built_in_chat_scope_ref(&record.scope_ref)?;
    if record.scope_ref.surface_id != expected_surface {
        return Err(
            "built-in AIConfig scopeRef.surfaceId does not match expected scope".to_string(),
        );
    }
    if record.config_payload.scope_ref != record.scope_ref {
        return Err(
            "built-in AIConfig payload scopeRef does not match record scopeRef".to_string(),
        );
    }
    if record.writer_identity != BUILT_IN_AI_CONFIG_WRITER_IDENTITY {
        return Err(
            "built-in AIConfig writer identity is missing or not the Desktop host AIConfig service"
                .to_string(),
        );
    }
    if record.apply_source != BUILT_IN_AI_CONFIG_APPLY_SOURCE {
        return Err("built-in AIConfig apply source is missing or invalid".to_string());
    }
    if record.committed_at.trim().is_empty() {
        return Err("built-in AIConfig committedAt evidence is required".to_string());
    }
    if record.ai_config_version == 0 {
        return Err("built-in AIConfig version is required".to_string());
    }
    // Resolve the applied factory AIProfile row from the admitted Platform catalog.
    let row = verify_first_run_factory_ai_profile(
        &record.ai_profile_ref.ai_profile_alias,
        &record.ai_profile_ref.install_level,
    )?;
    if record.ai_profile_ref.profile_id != format!("factory:{}", row.alias) {
        return Err("built-in AIConfig applied AIProfile id is missing or mismatched".to_string());
    }
    if record.ai_profile_ref.source_policy_ref != PLATFORM_AI_PROFILE_SELECTION_POLICY_REF {
        return Err("built-in AIConfig applied AIProfile source policy ref is invalid".to_string());
    }
    if record.ai_profile_ref.source_catalog_id != PLATFORM_AI_PROFILE_FACTORY_CATALOG_ID
        || record.ai_profile_ref.source_catalog_version
            != PLATFORM_AI_PROFILE_FACTORY_CATALOG_VERSION
    {
        return Err("built-in AIConfig applied AIProfile source catalog is invalid".to_string());
    }
    if record.ai_profile_ref.applied_at.trim().is_empty() {
        return Err(
            "built-in AIConfig applied AIProfile appliedAt evidence is required".to_string(),
        );
    }
    if let Some(expected_bindings) = expected_baseline_bindings {
        for expected in expected_bindings {
            let recorded = capability_binding_from_capabilities(
                &record.config_payload.capabilities,
                &expected.capability,
            )
            .unwrap_or(&serde_json::Value::Null);
            if recorded != &expected.binding {
                return Err(format!(
                    "built-in AIConfig {} binding does not match Runtime execution evidence",
                    expected.capability
                ));
            }
        }
    }
    // Capability payload must equal the full materialization of the factory row.
    let expected_capabilities = config_capabilities_from_row(
        row,
        expected_baseline_bindings.unwrap_or(&record.config_payload.capabilities),
    );
    if record.config_payload.capabilities != expected_capabilities {
        return Err(
            "built-in AIConfig capability payload is not the full materialized factory AIProfile"
                .to_string(),
        );
    }
    let expected_payload_hash = stable_json_hash(
        &expected_capabilities,
        "built-in AIConfig capability payload",
    )?;
    if record.ai_profile_ref.profile_payload_hash != expected_payload_hash {
        return Err("built-in AIConfig applied AIProfile payload hash is mismatched".to_string());
    }
    if record.config_payload.profile_origin != record.ai_profile_ref {
        return Err(
            "built-in AIConfig payload profileOrigin does not match applied AIProfile ref"
                .to_string(),
        );
    }
    let expected_content_hash = compute_config_content_hash(record)?;
    if record.ai_config_content_hash != expected_content_hash {
        return Err("built-in AIConfig content hash is missing or mismatched".to_string());
    }
    Ok(())
}

fn evidence_from_record(
    path: &Path,
    record: &BuiltInAiConfigRecord,
) -> Result<BuiltInAiConfigEvidence, String> {
    Ok(BuiltInAiConfigEvidence {
        built_in_ai_config_ref: built_in_ai_config_ref(record)?,
        config_path: path.display().to_string(),
        account_id: record.account_id.clone(),
        data_root_ref: record.data_root_ref.clone(),
        scope_ref: record.scope_ref.clone(),
        ai_profile_ref: record.ai_profile_ref.clone(),
        ai_config_version: record.ai_config_version,
        ai_config_content_hash: record.ai_config_content_hash.clone(),
        writer_identity: record.writer_identity.clone(),
        committed_at: record.committed_at.clone(),
    })
}

fn read_config_record(path: &Path) -> Result<BuiltInAiConfigRecord, String> {
    let raw = fs::read_to_string(path).map_err(|error| {
        format!(
            "built-in AIConfig record is missing or unreadable ({}): {error}",
            path.display()
        )
    })?;
    serde_json::from_str::<BuiltInAiConfigRecord>(&raw).map_err(|error| {
        format!(
            "built-in AIConfig record cannot be parsed ({}): {error}",
            path.display()
        )
    })
}

fn config_record_temp_path(path: &Path) -> PathBuf {
    let sequence = BUILT_IN_AI_CONFIG_TEMP_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    path.with_extension(format!("json.tmp.{}.{}", std::process::id(), sequence))
}

/// Atomic commit (`D-AIPC-005`): write to a temp file then rename into place.
fn write_config_record(path: &Path, record: &BuiltInAiConfigRecord) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "built-in AIConfig path has no parent directory".to_string())?;
    fs::create_dir_all(parent).map_err(|error| {
        format!(
            "create built-in AIConfig directory failed ({}): {error}",
            parent.display()
        )
    })?;
    let raw = serde_json::to_string_pretty(record)
        .map_err(|error| format!("serialize built-in AIConfig failed: {error}"))?;
    let tmp_path = config_record_temp_path(path);
    fs::write(&tmp_path, raw).map_err(|error| {
        format!(
            "write built-in AIConfig temporary file failed ({}): {error}",
            tmp_path.display()
        )
    })?;
    fs::rename(&tmp_path, path).map_err(|error| {
        format!(
            "commit built-in AIConfig record failed ({}): {error}",
            path.display()
        )
    })
}

fn new_config_record(
    account_id: &str,
    data_root_ref: &str,
    surface_id: &str,
    install_level: &str,
    row: &PlatformAIProfileFactoryRow,
    baseline_bindings: &[BuiltInAiConfigCapability],
) -> Result<BuiltInAiConfigRecord, String> {
    let now = now_iso_timestamp();
    let scope_ref = built_in_chat_scope_ref(surface_id)?;
    let ai_profile_ref = ai_profile_ref_from_row(row, install_level, &now, baseline_bindings)?;
    let config_payload = BuiltInAiConfigPayload {
        scope_ref: scope_ref.clone(),
        capabilities: config_capabilities_from_row(row, baseline_bindings),
        profile_origin: ai_profile_ref.clone(),
    };
    let mut record = BuiltInAiConfigRecord {
        schema_version: BUILT_IN_AI_CONFIG_SCHEMA_VERSION,
        account_id: validate_account_id(account_id)?,
        data_root_ref: data_root_ref.to_string(),
        scope_ref,
        ai_profile_ref,
        ai_config_version: 1,
        ai_config_content_hash: String::new(),
        writer_identity: BUILT_IN_AI_CONFIG_WRITER_IDENTITY.to_string(),
        committed_at: now,
        config_payload,
        apply_source: BUILT_IN_AI_CONFIG_APPLY_SOURCE.to_string(),
    };
    record.ai_config_content_hash = compute_config_content_hash(&record)?;
    Ok(record)
}

/// Resolve a single built-in `AIConfig` ref through the host AIConfig service
/// and verify it against the committed full materialized config.
///
/// The ref is only valid when it is the durable ref minted from the committed
/// record. A caller-provided / stale / string-only ref fails closed.
pub fn verify_built_in_ai_config_ref(
    data_root: &Path,
    authenticated_account_id: &str,
    surface_id: &str,
    built_in_ai_config_ref_value: &str,
    expected_baseline_bindings: Option<&[BuiltInAiConfigCapability]>,
) -> Result<BuiltInAiConfigEvidence, String> {
    let path = built_in_ai_config_path(data_root, authenticated_account_id, surface_id)?;
    let expected_data_root_ref = data_root_ref(data_root)?;
    let record = read_config_record(&path)?;
    verify_record_fields(
        &record,
        authenticated_account_id,
        &expected_data_root_ref,
        surface_id,
        expected_baseline_bindings,
    )?;
    let evidence = evidence_from_record(&path, &record)?;
    if evidence.built_in_ai_config_ref != built_in_ai_config_ref_value.trim() {
        return Err("built-in AIConfig ref is caller-provided, stale, or string-only".to_string());
    }
    Ok(evidence)
}

fn rematerialized_config_record(
    existing: Option<&BuiltInAiConfigRecord>,
    account_id: &str,
    data_root_ref: &str,
    surface_id: &str,
    install_level: &str,
    row: &PlatformAIProfileFactoryRow,
    baseline_bindings: &[BuiltInAiConfigCapability],
) -> Result<BuiltInAiConfigRecord, String> {
    let mut record = new_config_record(
        account_id,
        data_root_ref,
        surface_id,
        install_level,
        row,
        baseline_bindings,
    )?;
    if let Some(existing) = existing {
        record.ai_config_version = existing.ai_config_version.saturating_add(1).max(1);
        record.ai_config_content_hash = compute_config_content_hash(&record)?;
    }
    Ok(record)
}

/// Ensure the committed built-in `AIConfig` for one canonical scope exists, then
/// resolve + verify it. Idempotent: an existing valid record is reused without
/// rewrite; an existing stale host-owned record is fully rematerialized from the
/// current Runtime execution evidence instead of blocking first-run forever.
pub fn ensure_built_in_ai_config(
    data_root: &Path,
    authenticated_account_id: &str,
    surface_id: &str,
    selected_ai_profile_alias: &str,
    install_level: &str,
    baseline_bindings: &[BuiltInAiConfigCapability],
) -> Result<BuiltInAiConfigEvidence, String> {
    let _guard = BUILT_IN_AI_CONFIG_MATERIALIZE_LOCK
        .lock()
        .map_err(|_| "built-in AIConfig materialization lock is poisoned".to_string())?;
    let path = built_in_ai_config_path(data_root, authenticated_account_id, surface_id)?;
    let expected_data_root_ref = data_root_ref(data_root)?;
    let selected_row =
        verify_first_run_factory_ai_profile(selected_ai_profile_alias, install_level)?;
    if path.exists() {
        if let Ok(record) = read_config_record(&path) {
            if verify_record_fields(
                &record,
                authenticated_account_id,
                &expected_data_root_ref,
                surface_id,
                Some(baseline_bindings),
            )
            .is_ok()
            {
                let evidence = evidence_from_record(&path, &record)?;
                return verify_built_in_ai_config_ref(
                    data_root,
                    authenticated_account_id,
                    surface_id,
                    &evidence.built_in_ai_config_ref,
                    Some(baseline_bindings),
                );
            }
            let record = rematerialized_config_record(
                Some(&record),
                authenticated_account_id,
                &expected_data_root_ref,
                surface_id,
                install_level,
                selected_row,
                baseline_bindings,
            )?;
            write_config_record(&path, &record)?;
            let evidence = evidence_from_record(&path, &record)?;
            return verify_built_in_ai_config_ref(
                data_root,
                authenticated_account_id,
                surface_id,
                &evidence.built_in_ai_config_ref,
                Some(baseline_bindings),
            );
        }
    }
    let record = rematerialized_config_record(
        None,
        authenticated_account_id,
        &expected_data_root_ref,
        surface_id,
        install_level,
        selected_row,
        baseline_bindings,
    )?;
    write_config_record(&path, &record)?;
    let evidence = evidence_from_record(&path, &record)?;
    verify_built_in_ai_config_ref(
        data_root,
        authenticated_account_id,
        surface_id,
        &evidence.built_in_ai_config_ref,
        Some(baseline_bindings),
    )
}

/// First-run materialization of built-in `AIConfig` evidence for BOTH canonical
/// chat scopes (`D-AIPC-013`).
///
/// Applies the selected baseline factory `AIProfile` to `desktop.chat.nimi` and
/// `desktop.chat.agent` via atomic apply, then resolves + verifies both refs.
/// If either scope fails apply or verification, the whole operation fails
/// closed — no partial one-of-two set is returned.
pub fn ensure_built_in_ai_config_evidence_set(
    data_root: &Path,
    authenticated_account_id: &str,
    selected_ai_profile_alias: &str,
    install_level: &str,
    baseline_bindings: &[BuiltInAiConfigCapability],
) -> Result<BuiltInAiConfigEvidenceSet, String> {
    let nimi = ensure_built_in_ai_config(
        data_root,
        authenticated_account_id,
        "nimi",
        selected_ai_profile_alias,
        install_level,
        baseline_bindings,
    )?;
    let agent = ensure_built_in_ai_config(
        data_root,
        authenticated_account_id,
        "agent",
        selected_ai_profile_alias,
        install_level,
        baseline_bindings,
    )?;
    Ok(BuiltInAiConfigEvidenceSet { nimi, agent })
}

/// Resolve + verify a complete `builtInAiConfigRefs` set for wave-6
/// `AdmitProductReadyForUse`.
///
/// Requires exactly the two canonical built-in chat scopes. A partial set
/// (one-of-two), an extra ref, a duplicate scope, or a generic / string-only
/// ref fails closed.
///
/// `dead_code` allowance: this is the durable backend resolve/verify seam that
/// wave-6 `AdmitProductReadyForUse` will consume; it is exercised by this
/// module's tests today.
#[allow(dead_code)]
pub fn verify_built_in_ai_config_evidence_set(
    data_root: &Path,
    authenticated_account_id: &str,
    built_in_ai_config_refs: &[String],
    expected_baseline_bindings: Option<&[BuiltInAiConfigCapability]>,
) -> Result<BuiltInAiConfigEvidenceSet, String> {
    if built_in_ai_config_refs.len() != BUILT_IN_CHAT_SURFACE_IDS.len() {
        return Err(format!(
            "built-in AIConfig evidence requires exactly {} refs for both canonical chat scopes",
            BUILT_IN_CHAT_SURFACE_IDS.len()
        ));
    }
    let mut nimi: Option<BuiltInAiConfigEvidence> = None;
    let mut agent: Option<BuiltInAiConfigEvidence> = None;
    for raw_ref in built_in_ai_config_refs {
        let candidate = raw_ref.trim();
        if candidate.is_empty() {
            return Err("built-in AIConfig ref must be a non-empty durable ref".to_string());
        }
        let mut matched = false;
        for surface_id in BUILT_IN_CHAT_SURFACE_IDS {
            let Ok(evidence) = verify_built_in_ai_config_ref(
                data_root,
                authenticated_account_id,
                surface_id,
                candidate,
                expected_baseline_bindings,
            ) else {
                continue;
            };
            match *surface_id {
                "nimi" => {
                    if nimi.is_some() {
                        return Err(
                            "built-in AIConfig evidence has a duplicate desktop.chat.nimi ref"
                                .to_string(),
                        );
                    }
                    nimi = Some(evidence);
                }
                "agent" => {
                    if agent.is_some() {
                        return Err(
                            "built-in AIConfig evidence has a duplicate desktop.chat.agent ref"
                                .to_string(),
                        );
                    }
                    agent = Some(evidence);
                }
                _ => unreachable!("surface ids are validated"),
            }
            matched = true;
            break;
        }
        if !matched {
            return Err(
                "built-in AIConfig ref does not resolve to a committed built-in chat config"
                    .to_string(),
            );
        }
    }
    let nimi = nimi.ok_or_else(|| {
        "built-in AIConfig evidence is missing the desktop.chat.nimi scope".to_string()
    })?;
    let agent = agent.ok_or_else(|| {
        "built-in AIConfig evidence is missing the desktop.chat.agent scope".to_string()
    })?;
    Ok(BuiltInAiConfigEvidenceSet { nimi, agent })
}

pub fn read_built_in_ai_config_for_scope_init(
    data_root: &Path,
    authenticated_account_id: &str,
    surface_id: &str,
    built_in_ai_config_refs: &[String],
    expected_baseline_bindings: &[BuiltInAiConfigCapability],
) -> Result<BuiltInAiConfigForScopeInit, String> {
    for raw_ref in built_in_ai_config_refs {
        let candidate = raw_ref.trim();
        if candidate.is_empty() {
            continue;
        }
        if verify_built_in_ai_config_ref(
            data_root,
            authenticated_account_id,
            surface_id,
            candidate,
            Some(expected_baseline_bindings),
        )
        .is_ok()
        {
            let path = built_in_ai_config_path(data_root, authenticated_account_id, surface_id)?;
            let record = read_config_record(&path)?;
            return Ok(built_in_ai_config_for_scope_init_from_record(&record));
        }
    }
    Err(format!(
        "built-in AIConfig for desktop.chat.{surface_id} does not resolve from product-control refs"
    ))
}

#[cfg(test)]
#[path = "desktop_ai_config_library/tests.rs"]
mod tests;
