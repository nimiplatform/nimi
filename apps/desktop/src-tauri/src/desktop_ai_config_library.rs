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
//!   - no provider/model/connector identifiers are hardcoded — capability
//!     intent is sourced only from the admitted factory `AIProfile` row.

use crate::platform_ai_profile_factory_catalog::{
    verify_first_run_factory_ai_profile, PlatformAIProfileFactoryRow,
    PLATFORM_AI_PROFILE_FACTORY_CATALOG_ID, PLATFORM_AI_PROFILE_FACTORY_CATALOG_VERSION,
    PLATFORM_AI_PROFILE_SELECTION_POLICY_REF,
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Path, PathBuf};

const BUILT_IN_AI_CONFIG_SCHEMA_VERSION: u32 = 1;
const BUILT_IN_AI_CONFIG_REF_PREFIX: &str = "built-in-ai-config:v1";
const BUILT_IN_AI_CONFIG_WRITER_IDENTITY: &str = "desktop_host_ai_config_service";
const BUILT_IN_AI_CONFIG_SCOPE_KIND: &str = "feature";
const BUILT_IN_AI_CONFIG_SCOPE_OWNER_ID: &str = "desktop.chat";
const BUILT_IN_AI_CONFIG_APPLY_SOURCE: &str = "desktop_host_first_run_built_in_ai_config";
const TEXT_GENERATE_CAPABILITY: &str = "text.generate";
const FIRST_RUN_TEXT_CONSUMER_ID: &str = "llama.cpp.cpu";

/// The two canonical first-run built-in chat surface ids (`P-AISC-006`).
const BUILT_IN_CHAT_SURFACE_IDS: &[&str] = &["nimi", "agent"];

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

impl BuiltInAiConfigEvidenceSet {
    /// Durable `builtInAiConfigRefs` in stable order (`nimi`, then `agent`).
    pub fn refs(&self) -> Vec<String> {
        vec![
            self.nimi.built_in_ai_config_ref.clone(),
            self.agent.built_in_ai_config_ref.clone(),
        ]
    }
}

fn now_iso_timestamp() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

fn sha256_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    let mut out = String::with_capacity(digest.len() * 2);
    for byte in digest {
        out.push_str(&format!("{byte:02x}"));
    }
    out
}

fn stable_json_hash<T: Serialize>(value: &T, label: &str) -> Result<String, String> {
    let raw =
        serde_json::to_vec(value).map_err(|error| format!("serialize {label} failed: {error}"))?;
    Ok(format!("sha256:{}", sha256_hex(&raw)))
}

/// Canonical `data-root:sha256:*` ref for the selected absolute data root.
pub fn data_root_ref(data_root: &Path) -> Result<String, String> {
    if !data_root.is_absolute() {
        return Err("selected dataRootRef requires an absolute data root path".to_string());
    }
    let normalized = data_root.to_string_lossy().trim().to_string();
    if normalized.is_empty() {
        return Err("selected dataRootRef requires a non-empty data root path".to_string());
    }
    Ok(format!(
        "data-root:sha256:{}",
        sha256_hex(normalized.as_bytes())
    ))
}

fn validate_account_id(account_id: &str) -> Result<String, String> {
    let normalized = account_id.trim();
    if normalized.is_empty() {
        return Err("authenticated Runtime account_id is required".to_string());
    }
    if normalized.contains('\0') {
        return Err("authenticated Runtime account_id contains an invalid byte".to_string());
    }
    Ok(normalized.to_string())
}

fn account_path_segment(account_id: &str) -> String {
    let mut out = String::new();
    for byte in account_id.as_bytes() {
        match *byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' => {
                out.push(*byte as char);
            }
            other => out.push_str(&format!("%{other:02X}")),
        }
    }
    out
}

/// Reject any non-canonical surface id. Generic / merged / omitted scopes fail.
fn validate_built_in_chat_surface_id(surface_id: &str) -> Result<String, String> {
    let normalized = surface_id.trim();
    if !BUILT_IN_CHAT_SURFACE_IDS.contains(&normalized) {
        return Err(format!(
            "built-in chat surfaceId must be one of {:?}, got: {}",
            BUILT_IN_CHAT_SURFACE_IDS, normalized
        ));
    }
    Ok(normalized.to_string())
}

/// Canonical built-in chat scope (`P-AISC-006` `feature` shape).
fn built_in_chat_scope_ref(surface_id: &str) -> Result<BuiltInChatScopeRef, String> {
    Ok(BuiltInChatScopeRef {
        kind: BUILT_IN_AI_CONFIG_SCOPE_KIND.to_string(),
        owner_id: BUILT_IN_AI_CONFIG_SCOPE_OWNER_ID.to_string(),
        surface_id: validate_built_in_chat_surface_id(surface_id)?,
    })
}

/// Reject the generic / retired / merged / string-only scope shapes.
fn verify_built_in_chat_scope_ref(scope_ref: &BuiltInChatScopeRef) -> Result<(), String> {
    if scope_ref.kind.trim() != BUILT_IN_AI_CONFIG_SCOPE_KIND {
        return Err(
            "built-in AIConfig scopeRef.kind must be the feature shape, not a generic app scope"
                .to_string(),
        );
    }
    if scope_ref.owner_id.trim() != BUILT_IN_AI_CONFIG_SCOPE_OWNER_ID {
        return Err(
            "built-in AIConfig scopeRef.ownerId must be the canonical desktop.chat feature owner"
                .to_string(),
        );
    }
    validate_built_in_chat_surface_id(&scope_ref.surface_id)?;
    Ok(())
}

fn scope_path_segment(surface_id: &str) -> String {
    format!("desktop.chat.{surface_id}")
}

/// On-disk path of one scope's committed built-in `AIConfig` record.
pub fn built_in_ai_config_path(
    data_root: &Path,
    account_id: &str,
    surface_id: &str,
) -> Result<PathBuf, String> {
    let normalized_account = validate_account_id(account_id)?;
    let normalized_surface = validate_built_in_chat_surface_id(surface_id)?;
    if !data_root.is_absolute() {
        return Err("built-in AIConfig data root must be absolute".to_string());
    }
    Ok(data_root
        .join("accounts")
        .join(account_path_segment(&normalized_account))
        .join("ai-config")
        .join("built-in")
        .join(format!("{}.json", scope_path_segment(&normalized_surface))))
}

/// Materialize the full per-capability config from the factory `AIProfile` row.
///
/// `D-AIPC-005`: this is a full materialization overwrite, not a merge. Binding
/// intent starts unbound (`null`) — first-run does not hardcode any provider,
/// connector, engine, or model identifier.
fn config_capabilities_from_row(
    row: &PlatformAIProfileFactoryRow,
    text_generate_binding: &serde_json::Value,
) -> Vec<BuiltInAiConfigCapability> {
    let mut capabilities: Vec<BuiltInAiConfigCapability> = row
        .capability_set
        .iter()
        .map(|capability| BuiltInAiConfigCapability {
            capability: (*capability).to_string(),
            binding: if *capability == TEXT_GENERATE_CAPABILITY {
                text_generate_binding.clone()
            } else {
                serde_json::Value::Null
            },
        })
        .collect();
    capabilities.sort_by(|a, b| a.capability.cmp(&b.capability));
    capabilities
}

fn ai_profile_ref_from_row(
    row: &PlatformAIProfileFactoryRow,
    install_level: &str,
    applied_at: &str,
    text_generate_binding: &serde_json::Value,
) -> Result<BuiltInAiProfileRef, String> {
    let payload_hash = stable_json_hash(
        &config_capabilities_from_row(row, text_generate_binding),
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

pub fn runtime_text_generate_binding_from_baseline_ref(
    baseline: &crate::runtime_bridge::generated::RuntimeBaselineReadinessRef,
) -> Result<serde_json::Value, String> {
    let consumer = baseline
        .activation_ready_responses
        .iter()
        .find(|item| item.consumer_id.trim() == FIRST_RUN_TEXT_CONSUMER_ID)
        .ok_or_else(|| {
            "Runtime baseline evidence is missing the first-run text consumer".to_string()
        })?;
    let bound_asset_id = consumer.bound_asset_id.trim();
    if bound_asset_id.is_empty() {
        return Err("Runtime baseline text consumer is missing bound_asset_id".to_string());
    }
    let runtime_baseline_ref = baseline.runtime_baseline_ref.trim();
    if runtime_baseline_ref.is_empty() {
        return Err("Runtime baseline evidence is missing runtimeBaselineRef".to_string());
    }
    Ok(json!({
        "source": "local",
        "connectorId": "",
        "model": bound_asset_id,
        "modelId": bound_asset_id,
        "localModelId": bound_asset_id,
        "provider": "local",
        "engine": consumer.consumer_id.trim(),
        "goRuntimeLocalModelId": bound_asset_id,
        "runtimeBaselineRef": runtime_baseline_ref,
        "runtimeConsumerId": consumer.consumer_id.trim(),
    }))
}

fn text_generate_binding_from_capabilities(
    capabilities: &[BuiltInAiConfigCapability],
) -> Option<&serde_json::Value> {
    capabilities
        .iter()
        .find(|capability| capability.capability == TEXT_GENERATE_CAPABILITY)
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
    expected_text_generate_binding: Option<&serde_json::Value>,
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
    let recorded_text_binding =
        text_generate_binding_from_capabilities(&record.config_payload.capabilities)
            .unwrap_or(&serde_json::Value::Null);
    if let Some(expected_binding) = expected_text_generate_binding {
        if recorded_text_binding != expected_binding {
            return Err(
                "built-in AIConfig text.generate binding does not match Runtime baseline evidence"
                    .to_string(),
            );
        }
    }
    // Capability payload must equal the full materialization of the factory row.
    let expected_capabilities = config_capabilities_from_row(row, recorded_text_binding);
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
    let tmp_path = path.with_extension(format!("json.tmp.{}", std::process::id()));
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
    text_generate_binding: &serde_json::Value,
) -> Result<BuiltInAiConfigRecord, String> {
    let now = now_iso_timestamp();
    let scope_ref = built_in_chat_scope_ref(surface_id)?;
    let ai_profile_ref = ai_profile_ref_from_row(row, install_level, &now, text_generate_binding)?;
    let config_payload = BuiltInAiConfigPayload {
        scope_ref: scope_ref.clone(),
        capabilities: config_capabilities_from_row(row, text_generate_binding),
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
    expected_text_generate_binding: Option<&serde_json::Value>,
) -> Result<BuiltInAiConfigEvidence, String> {
    let path = built_in_ai_config_path(data_root, authenticated_account_id, surface_id)?;
    let expected_data_root_ref = data_root_ref(data_root)?;
    let record = read_config_record(&path)?;
    verify_record_fields(
        &record,
        authenticated_account_id,
        &expected_data_root_ref,
        surface_id,
        expected_text_generate_binding,
    )?;
    let evidence = evidence_from_record(&path, &record)?;
    if evidence.built_in_ai_config_ref != built_in_ai_config_ref_value.trim() {
        return Err("built-in AIConfig ref is caller-provided, stale, or string-only".to_string());
    }
    Ok(evidence)
}

/// Ensure the committed built-in `AIConfig` for one canonical scope exists, then
/// resolve + verify it. Idempotent: an existing valid record is reused without
/// rewrite; an existing invalid record fails closed instead of overwriting.
pub fn ensure_built_in_ai_config(
    data_root: &Path,
    authenticated_account_id: &str,
    surface_id: &str,
    selected_ai_profile_alias: &str,
    install_level: &str,
    text_generate_binding: &serde_json::Value,
) -> Result<BuiltInAiConfigEvidence, String> {
    let path = built_in_ai_config_path(data_root, authenticated_account_id, surface_id)?;
    let expected_data_root_ref = data_root_ref(data_root)?;
    let selected_row =
        verify_first_run_factory_ai_profile(selected_ai_profile_alias, install_level)?;
    if path.exists() {
        let record = read_config_record(&path)?;
        if verify_record_fields(
            &record,
            authenticated_account_id,
            &expected_data_root_ref,
            surface_id,
            Some(text_generate_binding),
        )
        .is_ok()
        {
            let evidence = evidence_from_record(&path, &record)?;
            return verify_built_in_ai_config_ref(
                data_root,
                authenticated_account_id,
                surface_id,
                &evidence.built_in_ai_config_ref,
                Some(text_generate_binding),
            );
        }
    }
    let record = new_config_record(
        authenticated_account_id,
        &expected_data_root_ref,
        surface_id,
        install_level,
        selected_row,
        text_generate_binding,
    )?;
    write_config_record(&path, &record)?;
    let evidence = evidence_from_record(&path, &record)?;
    verify_built_in_ai_config_ref(
        data_root,
        authenticated_account_id,
        surface_id,
        &evidence.built_in_ai_config_ref,
        Some(text_generate_binding),
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
    text_generate_binding: &serde_json::Value,
) -> Result<BuiltInAiConfigEvidenceSet, String> {
    let nimi = ensure_built_in_ai_config(
        data_root,
        authenticated_account_id,
        "nimi",
        selected_ai_profile_alias,
        install_level,
        text_generate_binding,
    )?;
    let agent = ensure_built_in_ai_config(
        data_root,
        authenticated_account_id,
        "agent",
        selected_ai_profile_alias,
        install_level,
        text_generate_binding,
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
    expected_text_generate_binding: Option<&serde_json::Value>,
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
                expected_text_generate_binding,
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

#[cfg(test)]
mod tests {
    use super::{
        built_in_ai_config_path, compute_config_content_hash, data_root_ref,
        ensure_built_in_ai_config, ensure_built_in_ai_config_evidence_set,
        verify_built_in_ai_config_evidence_set, verify_built_in_ai_config_ref,
        BuiltInAiConfigRecord,
    };
    use std::path::{Path, PathBuf};
    use std::time::{SystemTime, UNIX_EPOCH};

    const ALIAS: &str = "local-speech-ready";
    const LEVEL: &str = "minimal";

    fn text_binding() -> serde_json::Value {
        serde_json::json!({
            "source": "local",
            "connectorId": "",
            "model": "asset-id:gemma-test",
            "modelId": "asset-id:gemma-test",
            "localModelId": "asset-id:gemma-test",
            "provider": "local",
            "engine": "llama.cpp.cpu",
            "goRuntimeLocalModelId": "asset-id:gemma-test",
            "runtimeBaselineRef": "runtime-baseline:test",
            "runtimeConsumerId": "llama.cpp.cpu",
        })
    }

    fn temp_data_root(prefix: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("nimi-built-in-aiconfig-{prefix}-{unique}"));
        std::fs::create_dir_all(&dir).expect("create temp data root");
        dir
    }

    fn temp_home(prefix: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time")
            .as_nanos();
        let dir =
            std::env::temp_dir().join(format!("nimi-built-in-aiconfig-home-{prefix}-{unique}"));
        std::fs::create_dir_all(&dir).expect("create temp home");
        dir
    }

    fn read_record(path: &Path) -> BuiltInAiConfigRecord {
        serde_json::from_str(&std::fs::read_to_string(path).expect("read built-in ai config"))
            .expect("parse built-in ai config")
    }

    fn write_record(path: &Path, record: &BuiltInAiConfigRecord) {
        std::fs::write(path, serde_json::to_string_pretty(record).expect("json")).expect("write");
    }

    fn write_json(path: &Path, value: serde_json::Value) {
        std::fs::write(path, serde_json::to_string_pretty(&value).expect("json"))
            .expect("write json");
    }

    fn refresh_content_hash(record: &mut BuiltInAiConfigRecord) {
        record.ai_config_content_hash = compute_config_content_hash(record).expect("content hash");
    }

    // ---- Positive ---------------------------------------------------------

    #[test]
    fn first_run_materializes_both_canonical_feature_scopes_with_five_projection_fields() {
        let root = temp_data_root("positive");
        let set = ensure_built_in_ai_config_evidence_set(
            &root,
            "account:abc.def+1",
            ALIAS,
            LEVEL,
            &text_binding(),
        )
        .expect("ensure evidence set");

        for (surface, evidence) in [("nimi", &set.nimi), ("agent", &set.agent)] {
            // required_projection[0]: canonical feature-shape scopeRef.
            assert_eq!(evidence.scope_ref.kind, "feature");
            assert_eq!(evidence.scope_ref.owner_id, "desktop.chat");
            assert_eq!(evidence.scope_ref.surface_id, surface);
            // required_projection[1]: applied AIProfile ref + payload hash.
            assert_eq!(evidence.ai_profile_ref.ai_profile_alias, ALIAS);
            assert!(evidence
                .ai_profile_ref
                .profile_payload_hash
                .starts_with("sha256:"));
            // required_projection[2]: committed version + content hash.
            assert_eq!(evidence.ai_config_version, 1);
            assert!(evidence.ai_config_content_hash.starts_with("sha256:"));
            // required_projection[3]: Desktop host writer identity.
            assert_eq!(evidence.writer_identity, "desktop_host_ai_config_service");
            // required_projection[4]: committedAt.
            assert!(!evidence.committed_at.trim().is_empty());
            assert!(built_in_ai_config_path(&root, "account:abc.def+1", surface)
                .expect("path")
                .exists());
        }
        // Both refs resolve back through the host AIConfig service.
        let resolved = verify_built_in_ai_config_evidence_set(
            &root,
            "account:abc.def+1",
            &set.refs(),
            Some(&text_binding()),
        )
        .expect("resolve evidence set");
        assert_eq!(resolved.refs(), set.refs());
        assert_ne!(
            set.nimi.built_in_ai_config_ref,
            set.agent.built_in_ai_config_ref
        );
    }

    #[test]
    fn committed_built_in_config_is_full_materialized_for_factory_capability_set() {
        let root = temp_data_root("materialized");
        let set = ensure_built_in_ai_config_evidence_set(
            &root,
            "account_1",
            ALIAS,
            LEVEL,
            &text_binding(),
        )
        .expect("ensure evidence set");
        let record =
            read_record(&built_in_ai_config_path(&root, "account_1", "nimi").expect("path"));
        assert!(record
            .config_payload
            .capabilities
            .iter()
            .any(|cap| cap.capability == "text.generate"));
        let text = record
            .config_payload
            .capabilities
            .iter()
            .find(|cap| cap.capability == "text.generate")
            .expect("text.generate");
        assert_eq!(text.binding, text_binding());
        for capability in record
            .config_payload
            .capabilities
            .iter()
            .filter(|cap| cap.capability != "text.generate")
        {
            assert!(capability.binding.is_null());
        }
        assert_eq!(set.nimi.ai_profile_ref.install_level, LEVEL);
    }

    #[test]
    fn existing_valid_records_are_reused_without_rewrite() {
        let root = temp_data_root("idempotent");
        let first = ensure_built_in_ai_config_evidence_set(
            &root,
            "account_1",
            ALIAS,
            LEVEL,
            &text_binding(),
        )
        .expect("first ensure");
        let nimi_path = built_in_ai_config_path(&root, "account_1", "nimi").expect("path");
        let raw_before = std::fs::read_to_string(&nimi_path).expect("read before");
        let second = ensure_built_in_ai_config_evidence_set(
            &root,
            "account_1",
            "local-gpu",
            "recommended",
            &text_binding(),
        )
        .expect("second ensure");
        let raw_after = std::fs::read_to_string(&nimi_path).expect("read after");
        assert_eq!(raw_after, raw_before);
        assert_eq!(first.refs(), second.refs());
    }

    // ---- Negative ---------------------------------------------------------

    #[test]
    fn generic_app_chat_scope_is_rejected_as_built_in_evidence() {
        let root = temp_data_root("generic-scope");
        let set = ensure_built_in_ai_config_evidence_set(
            &root,
            "account_1",
            ALIAS,
            LEVEL,
            &text_binding(),
        )
        .expect("ensure evidence set");
        let path = built_in_ai_config_path(&root, "account_1", "nimi").expect("path");
        let mut record = read_record(&path);
        record.scope_ref.kind = "app".to_string();
        record.scope_ref.owner_id = "desktop".to_string();
        record.scope_ref.surface_id = "chat".to_string();
        record.config_payload.scope_ref = record.scope_ref.clone();
        refresh_content_hash(&mut record);
        write_record(&path, &record);
        let error = verify_built_in_ai_config_ref(
            &root,
            "account_1",
            "nimi",
            &set.nimi.built_in_ai_config_ref,
            Some(&text_binding()),
        )
        .expect_err("generic app scope must fail");
        assert!(error.contains("feature shape") || error.contains("surfaceId"));
    }

    #[test]
    fn omitted_or_empty_scope_surface_id_is_rejected() {
        let root = temp_data_root("omitted-scope");
        let set = ensure_built_in_ai_config_evidence_set(
            &root,
            "account_1",
            ALIAS,
            LEVEL,
            &text_binding(),
        )
        .expect("ensure evidence set");
        let path = built_in_ai_config_path(&root, "account_1", "nimi").expect("path");
        let mut record = serde_json::to_value(read_record(&path)).expect("record json");
        record
            .get_mut("scopeRef")
            .and_then(|value| value.as_object_mut())
            .expect("scopeRef object")
            .insert(
                "surfaceId".to_string(),
                serde_json::Value::String(String::new()),
            );
        write_json(&path, record);
        let error = verify_built_in_ai_config_ref(
            &root,
            "account_1",
            "nimi",
            &set.nimi.built_in_ai_config_ref,
            Some(&text_binding()),
        )
        .expect_err("omitted surfaceId must fail");
        assert!(error.contains("surfaceId") || error.contains("cannot be parsed"));
    }

    #[test]
    fn string_only_and_missing_refs_fail_closed() {
        let root = temp_data_root("string-only");
        let missing = verify_built_in_ai_config_ref(
            &root,
            "account_1",
            "nimi",
            "built-in-ai-config:v1:string-only",
            None,
        )
        .expect_err("missing config must fail");
        assert!(missing.contains("missing or unreadable"));

        let set = ensure_built_in_ai_config_evidence_set(
            &root,
            "account_1",
            ALIAS,
            LEVEL,
            &text_binding(),
        )
        .expect("ensure evidence set");
        let string_only = verify_built_in_ai_config_ref(
            &root,
            "account_1",
            "nimi",
            "built-in-ai-config:v1:string-only",
            None,
        )
        .expect_err("string-only ref must fail");
        assert!(string_only.contains("string-only"));
        // Sanity: the real ref still resolves.
        verify_built_in_ai_config_ref(
            &root,
            "account_1",
            "nimi",
            &set.nimi.built_in_ai_config_ref,
            Some(&text_binding()),
        )
        .expect("real ref resolves");
    }

    #[test]
    fn wrong_account_and_wrong_data_root_fail_closed() {
        let root = temp_data_root("wrong-identity");
        let set = ensure_built_in_ai_config_evidence_set(
            &root,
            "account_1",
            ALIAS,
            LEVEL,
            &text_binding(),
        )
        .expect("ensure evidence set");
        let wrong_account = verify_built_in_ai_config_ref(
            &root,
            "account_2",
            "nimi",
            &set.nimi.built_in_ai_config_ref,
            Some(&text_binding()),
        )
        .expect_err("wrong account must fail");
        assert!(wrong_account.contains("missing or unreadable"));

        let other_root = temp_data_root("wrong-identity-other");
        let wrong_root = verify_built_in_ai_config_ref(
            &other_root,
            "account_1",
            "nimi",
            &set.nimi.built_in_ai_config_ref,
            Some(&text_binding()),
        )
        .expect_err("wrong data root must fail");
        assert!(wrong_root.contains("missing or unreadable"));
    }

    #[test]
    fn content_hash_and_writer_identity_tampering_fail_closed() {
        let root = temp_data_root("tamper");
        let set = ensure_built_in_ai_config_evidence_set(
            &root,
            "account_1",
            ALIAS,
            LEVEL,
            &text_binding(),
        )
        .expect("ensure evidence set");
        let path = built_in_ai_config_path(&root, "account_1", "agent").expect("path");

        let mut record = read_record(&path);
        record.ai_config_content_hash = "sha256:bad".to_string();
        write_record(&path, &record);
        let hash_error = verify_built_in_ai_config_ref(
            &root,
            "account_1",
            "agent",
            &set.agent.built_in_ai_config_ref,
            Some(&text_binding()),
        )
        .expect_err("content hash tampering must fail");
        assert!(hash_error.contains("content hash"));

        let mut record = read_record(&path);
        record.writer_identity = "renderer".to_string();
        refresh_content_hash(&mut record);
        write_record(&path, &record);
        let writer_error = verify_built_in_ai_config_ref(
            &root,
            "account_1",
            "agent",
            &set.agent.built_in_ai_config_ref,
            Some(&text_binding()),
        )
        .expect_err("writer identity tampering must fail");
        assert!(writer_error.contains("writer identity"));
    }

    #[test]
    fn partial_one_of_two_built_in_set_fails_closed() {
        let root = temp_data_root("partial");
        let set = ensure_built_in_ai_config_evidence_set(
            &root,
            "account_1",
            ALIAS,
            LEVEL,
            &text_binding(),
        )
        .expect("ensure evidence set");
        // Only the nimi ref present — not a complete built-in chat set.
        let partial = verify_built_in_ai_config_evidence_set(
            &root,
            "account_1",
            std::slice::from_ref(&set.nimi.built_in_ai_config_ref),
            Some(&text_binding()),
        )
        .expect_err("partial set must fail");
        assert!(partial.contains("exactly 2"));

        // Both refs are the nimi ref — agent scope is missing.
        let duplicate = verify_built_in_ai_config_evidence_set(
            &root,
            "account_1",
            &[
                set.nimi.built_in_ai_config_ref.clone(),
                set.nimi.built_in_ai_config_ref.clone(),
            ],
            Some(&text_binding()),
        )
        .expect_err("duplicate scope must fail");
        assert!(duplicate.contains("duplicate") || duplicate.contains("missing"));
    }

    #[test]
    fn string_only_set_member_fails_closed() {
        let root = temp_data_root("set-string-only");
        let set = ensure_built_in_ai_config_evidence_set(
            &root,
            "account_1",
            ALIAS,
            LEVEL,
            &text_binding(),
        )
        .expect("ensure evidence set");
        let error = verify_built_in_ai_config_evidence_set(
            &root,
            "account_1",
            &[
                set.nimi.built_in_ai_config_ref.clone(),
                "built-in-ai-config:v1:string-only".to_string(),
            ],
            Some(&text_binding()),
        )
        .expect_err("string-only set member must fail");
        assert!(error.contains("does not resolve"));
    }

    #[test]
    fn applying_account_default_profile_does_not_mutate_committed_built_in_evidence() {
        // Wave-10 invariant: replacing the Account Default Profile must not
        // mutate committed built-in AIConfig evidence.
        let root = temp_data_root("aiconfig-isolation");
        let home = temp_home("aiconfig-isolation");
        let set = ensure_built_in_ai_config_evidence_set(
            &root,
            "account_1",
            ALIAS,
            LEVEL,
            &text_binding(),
        )
        .expect("ensure evidence set");
        let nimi_path = built_in_ai_config_path(&root, "account_1", "nimi").expect("path");
        let raw_before = std::fs::read_to_string(&nimi_path).expect("read before");

        let home_str = home.to_str().expect("home path").to_string();
        crate::test_support::with_env(&[("HOME", Some(home_str.as_str()))], || {
            let _ = crate::account_profile_library::ensure_account_default_profile(
                &root,
                "account_1",
                ALIAS,
                LEVEL,
            )
            .expect("ensure account default profile");
        });

        let raw_after = std::fs::read_to_string(&nimi_path).expect("read after");
        assert_eq!(raw_after, raw_before);
        // Built-in evidence still resolves unchanged.
        let resolved = verify_built_in_ai_config_evidence_set(
            &root,
            "account_1",
            &set.refs(),
            Some(&text_binding()),
        )
        .expect("resolve after account profile");
        assert_eq!(resolved.refs(), set.refs());
    }

    #[test]
    fn data_root_ref_requires_absolute_path() {
        let error = data_root_ref(Path::new("relative/path")).expect_err("relative must fail");
        assert!(error.contains("absolute"));
    }

    #[test]
    fn ensure_single_scope_rejects_non_canonical_surface_id() {
        let root = temp_data_root("bad-surface");
        let error =
            ensure_built_in_ai_config(&root, "account_1", "chat", ALIAS, LEVEL, &text_binding())
                .expect_err("non-canonical surface must fail");
        assert!(error.contains("surfaceId"));
    }
}
