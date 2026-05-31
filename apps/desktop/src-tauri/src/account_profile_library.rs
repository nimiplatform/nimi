use crate::desktop_paths::resolve_nimi_dir;
use nimi_shell_tauri::platform_catalog::ai_profile_factory::{
    verify_first_run_factory_ai_profile, PlatformAIProfileFactoryRow,
    PLATFORM_AI_PROFILE_FACTORY_CATALOG_ID, PLATFORM_AI_PROFILE_FACTORY_CATALOG_VERSION,
    PLATFORM_AI_PROFILE_SELECTION_POLICY_REF,
};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Path, PathBuf};

const ACCOUNT_PROFILE_SCHEMA_VERSION: u32 = 1;
const ACCOUNT_DEFAULT_PROFILE_ID: &str = "default";
const ACCOUNT_DEFAULT_PROFILE_REF_PREFIX: &str = "account-default-profile:v1";
const ACCOUNT_PROFILE_LOCAL_LIBRARY_SOURCE: &str = "local_account_profile_library";
const PROFILE_REVISION_FACTORY_SEED: &str = "factory_seed";
const PROFILE_REVISION_LOCAL_EDIT: &str = "local_edit";
const PROFILE_REVISION_LOCAL_REPLACEMENT: &str = "local_replacement";
/// Account Default Profile `source.kind` per the product manual
/// `~/.nimi/accounts/<account-id>/profiles/default.json` schema.
const ACCOUNT_DEFAULT_PROFILE_SOURCE_KIND: &str = "factory-policy";
/// Manual fixed `displayName` for the seeded Account Default Profile template.
const ACCOUNT_DEFAULT_PROFILE_DISPLAY_NAME: &str = "Default Profile";

mod types;
pub use types::*;

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

/// On-disk path of an account's durable Account Default Profile library record.
///
/// P-AIPS-013 fixes this at `~/.nimi/accounts/<account-id>/profiles/default.json`
/// — the `~/.nimi` CONTROL root, not the user-selected `nimi_data` DATA root.
/// The account id is percent-encoded into the directory segment. The selected
/// data root it was provisioned against is recorded as the record's
/// `dataRootRef` field, not as the location it lives under.
pub fn account_default_profile_path(account_id: &str) -> Result<PathBuf, String> {
    let normalized_account = validate_account_id(account_id)?;
    Ok(resolve_nimi_dir()?
        .join("accounts")
        .join(account_path_segment(&normalized_account))
        .join("profiles")
        .join("default.json"))
}

fn record_hash_payload(record: &AccountDefaultProfileRecord) -> Result<Vec<u8>, String> {
    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    struct HashPayload<'a> {
        schema_version: u32,
        profile_id: &'a str,
        display_name: &'a str,
        source: &'a AccountDefaultProfileSource,
        editable: bool,
        removable: bool,
        profile: &'a AccountDefaultProfileBody,
        updated_at: &'a str,
        account_id: &'a str,
        data_root_ref: &'a str,
        ai_profile_alias: &'a str,
        install_level: &'a str,
        capability_set: &'a [String],
        routing_policy: &'a str,
        factory_seed_profile_payload: &'a AccountDefaultAIProfilePayload,
        factory_seed_profile_payload_hash: &'a str,
        factory_provenance: &'a AccountDefaultFactoryProvenance,
        factory_provenance_hash: &'a str,
        profile_revision: &'a AccountDefaultProfileRevisionProvenance,
        created_at: &'a str,
    }

    let payload = HashPayload {
        schema_version: record.schema_version,
        profile_id: &record.profile_id,
        display_name: &record.display_name,
        source: &record.source,
        editable: record.editable,
        removable: record.removable,
        profile: &record.profile,
        updated_at: &record.updated_at,
        account_id: &record.account_id,
        data_root_ref: &record.data_root_ref,
        ai_profile_alias: &record.ai_profile_alias,
        install_level: &record.install_level,
        capability_set: &record.capability_set,
        routing_policy: &record.routing_policy,
        factory_seed_profile_payload: &record.factory_seed_profile_payload,
        factory_seed_profile_payload_hash: &record.factory_seed_profile_payload_hash,
        factory_provenance: &record.factory_provenance,
        factory_provenance_hash: &record.factory_provenance_hash,
        profile_revision: &record.profile_revision,
        created_at: &record.created_at,
    };
    serde_json::to_vec(&payload)
        .map_err(|error| format!("serialize profile hash payload failed: {error}"))
}

fn compute_record_hash(record: &AccountDefaultProfileRecord) -> Result<String, String> {
    Ok(format!(
        "sha256:{}",
        sha256_hex(&record_hash_payload(record)?)
    ))
}

fn stable_json_hash<T: Serialize>(value: &T, label: &str) -> Result<String, String> {
    let raw =
        serde_json::to_vec(value).map_err(|error| format!("serialize {label} failed: {error}"))?;
    Ok(format!("sha256:{}", sha256_hex(&raw)))
}

fn title_from_alias(alias: &str) -> String {
    alias
        .split('-')
        .filter(|part| !part.is_empty())
        .map(|part| {
            let mut chars = part.chars();
            match chars.next() {
                Some(first) => format!("{}{}", first.to_uppercase(), chars.as_str()),
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn profile_payload_from_row(row: &PlatformAIProfileFactoryRow) -> AccountDefaultAIProfilePayload {
    let mut capabilities = serde_json::Map::new();
    for capability in row.capability_set {
        let mut binding = serde_json::Map::new();
        binding.insert("binding".to_string(), serde_json::Value::Null);
        capabilities.insert(
            (*capability).to_string(),
            serde_json::Value::Object(binding),
        );
    }
    AccountDefaultAIProfilePayload {
        profile_id: ACCOUNT_DEFAULT_PROFILE_ID.to_string(),
        title: format!("Default {}", title_from_alias(row.alias)),
        description: format!(
            "Account Default Profile seeded from factory AIProfile: {}",
            row.alias
        ),
        tags: vec![
            "account-default-profile".to_string(),
            "factory-ai-profile".to_string(),
            row.alias.to_string(),
            row.privacy_posture.to_string(),
            row.compute_posture.to_string(),
            row.routing_policy.to_string(),
        ],
        capabilities,
    }
}

fn factory_provenance_from_row(
    row: &PlatformAIProfileFactoryRow,
) -> AccountDefaultFactoryProvenance {
    AccountDefaultFactoryProvenance {
        ai_profile_alias: row.alias.to_string(),
        privacy_posture: row.privacy_posture.to_string(),
        compute_posture: row.compute_posture.to_string(),
        capability_set: row
            .capability_set
            .iter()
            .map(|value| value.to_string())
            .collect(),
        routing_policy: row.routing_policy.to_string(),
        host_capability_profile_refs: row
            .host_capability_profile_refs
            .iter()
            .map(|value| value.to_string())
            .collect(),
        local_compute_pack_refs: row
            .local_compute_pack_refs
            .iter()
            .map(|value| value.to_string())
            .collect(),
        dependency_family_refs: row
            .dependency_family_refs
            .iter()
            .map(|value| value.to_string())
            .collect(),
        materialization_confirmation_required: row.materialization_confirmation_required,
        applicable_scopes: row
            .applicable_scopes
            .iter()
            .map(|value| value.to_string())
            .collect(),
        first_run_install_levels: row
            .first_run_install_levels
            .iter()
            .map(|value| value.to_string())
            .collect(),
        source_rule: row.source_rule.to_string(),
        source_policy_ref: PLATFORM_AI_PROFILE_SELECTION_POLICY_REF.to_string(),
        source_catalog_id: PLATFORM_AI_PROFILE_FACTORY_CATALOG_ID.to_string(),
        source_catalog_version: PLATFORM_AI_PROFILE_FACTORY_CATALOG_VERSION,
    }
}

fn factory_seed_revision(changed_at: &str) -> AccountDefaultProfileRevisionProvenance {
    AccountDefaultProfileRevisionProvenance {
        revision_kind: PROFILE_REVISION_FACTORY_SEED.to_string(),
        source: ACCOUNT_PROFILE_LOCAL_LIBRARY_SOURCE.to_string(),
        previous_content_hash: None,
        changed_at: changed_at.to_string(),
    }
}

fn validate_sdk_ai_profile_payload(payload: &AccountDefaultAIProfilePayload) -> Result<(), String> {
    if payload.profile_id != ACCOUNT_DEFAULT_PROFILE_ID {
        return Err(
            "Account Default Profile AIProfile payload profileId must be default".to_string(),
        );
    }
    if payload.title.trim().is_empty() {
        return Err("Account Default Profile AIProfile payload title is required".to_string());
    }
    if payload.tags.iter().any(|tag| tag.trim().is_empty()) {
        return Err(
            "Account Default Profile AIProfile payload tags must be non-empty strings".to_string(),
        );
    }
    if payload.capabilities.is_empty() {
        return Err(
            "Account Default Profile AIProfile payload capabilities are required".to_string(),
        );
    }
    for (capability, value) in &payload.capabilities {
        if capability.trim().is_empty() {
            return Err(
                "Account Default Profile AIProfile payload capability id is required".to_string(),
            );
        }
        let Some(binding) = value.as_object() else {
            return Err(
                "Account Default Profile AIProfile payload capability entries must be objects"
                    .to_string(),
            );
        };
        if !binding.contains_key("binding") {
            return Err(
                "Account Default Profile AIProfile payload capability binding field is required"
                    .to_string(),
            );
        }
    }
    Ok(())
}

fn verify_profile_revision(
    record: &AccountDefaultProfileRecord,
    factory_seed_payload: &AccountDefaultAIProfilePayload,
) -> Result<(), String> {
    if record.profile_revision.source != ACCOUNT_PROFILE_LOCAL_LIBRARY_SOURCE {
        return Err("Account Default Profile revision provenance source is invalid".to_string());
    }
    if record.profile_revision.changed_at.trim().is_empty()
        || record.profile_revision.changed_at != record.updated_at
    {
        return Err("Account Default Profile revision timestamp is missing or stale".to_string());
    }
    let payload_is_factory_seed = record.profile.payload == *factory_seed_payload;
    match record.profile_revision.revision_kind.as_str() {
        PROFILE_REVISION_FACTORY_SEED => {
            if !payload_is_factory_seed || record.profile.ai_profile_version != 1 {
                return Err(
                    "Account Default Profile factory seed revision cannot carry edited payload"
                        .to_string(),
                );
            }
            if record.profile_revision.previous_content_hash.is_some() {
                return Err(
                    "Account Default Profile factory seed revision cannot carry previous hash"
                        .to_string(),
                );
            }
        }
        PROFILE_REVISION_LOCAL_EDIT | PROFILE_REVISION_LOCAL_REPLACEMENT => {
            if record.profile.ai_profile_version <= 1 || record.updated_at == record.created_at {
                return Err("Account Default Profile local edit/replacement requires advanced version and updated timestamp".to_string());
            }
            let Some(previous_hash) = record.profile_revision.previous_content_hash.as_deref()
            else {
                return Err(
                    "Account Default Profile local edit/replacement requires previous content hash"
                        .to_string(),
                );
            };
            if !previous_hash.starts_with("sha256:") {
                return Err(
                    "Account Default Profile local edit/replacement previous hash must use sha256"
                        .to_string(),
                );
            }
        }
        _ => {
            return Err("Account Default Profile revision kind is invalid".to_string());
        }
    }
    Ok(())
}

fn account_default_profile_ref(record: &AccountDefaultProfileRecord) -> Result<String, String> {
    let account_hash = sha256_hex(record.account_id.as_bytes());
    let content_hash = record
        .content_hash
        .strip_prefix("sha256:")
        .ok_or_else(|| "Account Default Profile contentHash must use sha256".to_string())?;
    Ok(format!(
        "{ACCOUNT_DEFAULT_PROFILE_REF_PREFIX}:{account_hash}:{}:{content_hash}",
        record.profile_id
    ))
}

fn row_from_record(
    record: &AccountDefaultProfileRecord,
) -> Result<&'static PlatformAIProfileFactoryRow, String> {
    let row = verify_first_run_factory_ai_profile(&record.ai_profile_alias, &record.install_level)?;
    if row.source_rule != record.source.catalog_row_source_rule {
        return Err("Account Default Profile source catalog row source rule mismatch".to_string());
    }
    Ok(row)
}

fn verify_record_fields(
    record: &AccountDefaultProfileRecord,
    authenticated_account_id: &str,
    expected_data_root_ref: &str,
) -> Result<(), String> {
    let account_id = validate_account_id(authenticated_account_id)?;
    if record.schema_version != ACCOUNT_PROFILE_SCHEMA_VERSION {
        return Err("Account Default Profile schemaVersion is unsupported".to_string());
    }
    if record.profile_id != ACCOUNT_DEFAULT_PROFILE_ID {
        return Err("Account Default Profile profileId must be default".to_string());
    }
    if record.display_name.trim().is_empty() {
        return Err("Account Default Profile displayName is required".to_string());
    }
    if !record.editable {
        return Err("Account Default Profile editable must be true".to_string());
    }
    if record.removable {
        return Err("Account Default Profile removable must be false".to_string());
    }
    if record.account_id != account_id {
        return Err(
            "Account Default Profile account_id does not match authenticated Runtime account"
                .to_string(),
        );
    }
    if record.data_root_ref != expected_data_root_ref {
        return Err(
            "Account Default Profile dataRootRef does not match selected data root".to_string(),
        );
    }
    if record.profile.ai_profile_version == 0 {
        return Err("Account Default Profile profile version is required".to_string());
    }
    if record.source.kind != ACCOUNT_DEFAULT_PROFILE_SOURCE_KIND {
        return Err("Account Default Profile source kind must be factory-policy".to_string());
    }
    if record.source.policy_ref != PLATFORM_AI_PROFILE_SELECTION_POLICY_REF {
        return Err(
            "Account Default Profile source policy ref is missing or unresolvable".to_string(),
        );
    }
    if record.source.catalog_id != PLATFORM_AI_PROFILE_FACTORY_CATALOG_ID
        || record.source.catalog_version != PLATFORM_AI_PROFILE_FACTORY_CATALOG_VERSION
    {
        return Err(
            "Account Default Profile source catalog version is missing or unresolvable".to_string(),
        );
    }
    if record.created_at.trim().is_empty() || record.updated_at.trim().is_empty() {
        return Err("Account Default Profile createdAt/updatedAt evidence is required".to_string());
    }
    let row = row_from_record(record)?;
    validate_sdk_ai_profile_payload(&record.profile.payload)?;
    let expected_payload_hash = stable_json_hash(
        &record.profile.payload,
        "Account Default Profile AIProfile payload",
    )?;
    if record.profile.payload_hash != expected_payload_hash {
        return Err(
            "Account Default Profile profile payload hash is missing or mismatched".to_string(),
        );
    }
    let expected_seed_payload = profile_payload_from_row(row);
    if record.factory_seed_profile_payload != expected_seed_payload {
        return Err(
            "Account Default Profile factory seed AIProfile payload is missing or mismatched"
                .to_string(),
        );
    }
    let expected_seed_payload_hash = stable_json_hash(
        &record.factory_seed_profile_payload,
        "Account Default Profile factory seed AIProfile payload",
    )?;
    if record.factory_seed_profile_payload_hash != expected_seed_payload_hash {
        return Err(
            "Account Default Profile factory seed payload hash is missing or mismatched"
                .to_string(),
        );
    }
    verify_profile_revision(record, &expected_seed_payload)?;
    let expected_provenance = factory_provenance_from_row(row);
    if record.factory_provenance != expected_provenance {
        return Err(
            "Account Default Profile factory provenance is missing or mismatched".to_string(),
        );
    }
    let expected_provenance_hash = stable_json_hash(
        &record.factory_provenance,
        "Account Default Profile factory provenance",
    )?;
    if record.factory_provenance_hash != expected_provenance_hash {
        return Err(
            "Account Default Profile factory provenance hash is missing or mismatched".to_string(),
        );
    }
    let expected_hash = compute_record_hash(record)?;
    if record.content_hash != expected_hash {
        return Err("Account Default Profile content hash is missing or mismatched".to_string());
    }
    let row_capabilities = row
        .capability_set
        .iter()
        .map(|value| value.to_string())
        .collect::<Vec<_>>();
    if record.capability_set != row_capabilities {
        return Err("Account Default Profile source catalog capability set mismatch".to_string());
    }
    if record.routing_policy != row.routing_policy {
        return Err("Account Default Profile source catalog routing policy mismatch".to_string());
    }
    Ok(())
}

fn is_reseedable_factory_profile_record(
    record: &AccountDefaultProfileRecord,
    authenticated_account_id: &str,
    expected_data_root_ref: &str,
) -> Result<bool, String> {
    let account_id = validate_account_id(authenticated_account_id)?;
    if record.schema_version != ACCOUNT_PROFILE_SCHEMA_VERSION
        || record.profile_id != ACCOUNT_DEFAULT_PROFILE_ID
        || record.account_id != account_id
        || record.data_root_ref != expected_data_root_ref
        || record.source.kind != ACCOUNT_DEFAULT_PROFILE_SOURCE_KIND
        || record.source.policy_ref != PLATFORM_AI_PROFILE_SELECTION_POLICY_REF
        || record.source.catalog_id != PLATFORM_AI_PROFILE_FACTORY_CATALOG_ID
        || record.source.catalog_version != PLATFORM_AI_PROFILE_FACTORY_CATALOG_VERSION
    {
        return Ok(false);
    }
    let Ok(row) = row_from_record(record) else {
        return Ok(false);
    };
    if row.source_rule != record.source.catalog_row_source_rule {
        return Ok(false);
    }
    if record.profile.ai_profile_version != 1
        || record.profile.payload != record.factory_seed_profile_payload
        || record.profile_revision.revision_kind != PROFILE_REVISION_FACTORY_SEED
        || record.profile_revision.source != ACCOUNT_PROFILE_LOCAL_LIBRARY_SOURCE
        || record.profile_revision.previous_content_hash.is_some()
        || record.profile_revision.changed_at.trim().is_empty()
        || record.profile_revision.changed_at != record.updated_at
    {
        return Ok(false);
    }
    validate_sdk_ai_profile_payload(&record.profile.payload)?;
    if record.profile.payload_hash
        != stable_json_hash(
            &record.profile.payload,
            "Account Default Profile AIProfile payload",
        )?
    {
        return Ok(false);
    }
    if record.factory_seed_profile_payload_hash
        != stable_json_hash(
            &record.factory_seed_profile_payload,
            "Account Default Profile factory seed AIProfile payload",
        )?
    {
        return Ok(false);
    }
    if record.factory_provenance_hash
        != stable_json_hash(
            &record.factory_provenance,
            "Account Default Profile factory provenance",
        )?
    {
        return Ok(false);
    }
    if record.content_hash != compute_record_hash(record)? {
        return Ok(false);
    }
    Ok(true)
}

fn is_factory_catalog_drift_error(error: &str) -> bool {
    error.contains("factory seed AIProfile payload")
        || error.contains("factory seed payload hash")
        || error.contains("factory provenance")
        || error.contains("source catalog capability set")
        || error.contains("source catalog routing policy")
}

fn evidence_from_record(
    path: &Path,
    record: &AccountDefaultProfileRecord,
) -> Result<AccountDefaultProfileEvidence, String> {
    Ok(AccountDefaultProfileEvidence {
        account_default_profile_ref: account_default_profile_ref(record)?,
        profile_path: path.display().to_string(),
        account_id: record.account_id.clone(),
        data_root_ref: record.data_root_ref.clone(),
        profile_id: record.profile_id.clone(),
        profile_version: record.profile.ai_profile_version,
        content_hash: record.content_hash.clone(),
        source_policy_ref: record.source.policy_ref.clone(),
        source_catalog_id: record.source.catalog_id.clone(),
        source_catalog_version: record.source.catalog_version,
        created_at: record.created_at.clone(),
        updated_at: record.updated_at.clone(),
        ai_profile_alias: record.ai_profile_alias.clone(),
        profile_payload_hash: record.profile.payload_hash.clone(),
        factory_provenance_hash: record.factory_provenance_hash.clone(),
    })
}

fn read_profile_record(path: &Path) -> Result<AccountDefaultProfileRecord, String> {
    let raw = fs::read_to_string(path).map_err(|error| {
        format!(
            "Account Default Profile record is missing or unreadable ({}): {error}",
            path.display()
        )
    })?;
    serde_json::from_str::<AccountDefaultProfileRecord>(&raw).map_err(|error| {
        format!(
            "Account Default Profile record cannot be parsed ({}): {error}",
            path.display()
        )
    })
}

fn write_profile_record(path: &Path, record: &AccountDefaultProfileRecord) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "Account Default Profile path has no parent directory".to_string())?;
    fs::create_dir_all(parent).map_err(|error| {
        format!(
            "create Account Default Profile directory failed ({}): {error}",
            parent.display()
        )
    })?;
    let raw = serde_json::to_string_pretty(record)
        .map_err(|error| format!("serialize Account Default Profile failed: {error}"))?;
    let tmp_path = path.with_extension(format!("json.tmp.{}", std::process::id()));
    fs::write(&tmp_path, raw).map_err(|error| {
        format!(
            "write Account Default Profile temporary file failed ({}): {error}",
            tmp_path.display()
        )
    })?;
    fs::rename(&tmp_path, path).map_err(|error| {
        format!(
            "commit Account Default Profile record failed ({}): {error}",
            path.display()
        )
    })
}

fn new_profile_record(
    account_id: &str,
    data_root_ref: &str,
    install_level: &str,
    row: &PlatformAIProfileFactoryRow,
) -> Result<AccountDefaultProfileRecord, String> {
    let now = now_iso_timestamp();
    let profile_payload = profile_payload_from_row(row);
    let profile_payload_hash = stable_json_hash(
        &profile_payload,
        "Account Default Profile AIProfile payload",
    )?;
    let factory_seed_profile_payload = profile_payload.clone();
    let factory_seed_profile_payload_hash = stable_json_hash(
        &factory_seed_profile_payload,
        "Account Default Profile factory seed AIProfile payload",
    )?;
    let factory_provenance = factory_provenance_from_row(row);
    let factory_provenance_hash = stable_json_hash(
        &factory_provenance,
        "Account Default Profile factory provenance",
    )?;
    let mut record = AccountDefaultProfileRecord {
        schema_version: ACCOUNT_PROFILE_SCHEMA_VERSION,
        profile_id: ACCOUNT_DEFAULT_PROFILE_ID.to_string(),
        display_name: ACCOUNT_DEFAULT_PROFILE_DISPLAY_NAME.to_string(),
        source: AccountDefaultProfileSource {
            kind: ACCOUNT_DEFAULT_PROFILE_SOURCE_KIND.to_string(),
            policy_ref: PLATFORM_AI_PROFILE_SELECTION_POLICY_REF.to_string(),
            catalog_version: PLATFORM_AI_PROFILE_FACTORY_CATALOG_VERSION,
            catalog_id: PLATFORM_AI_PROFILE_FACTORY_CATALOG_ID.to_string(),
            catalog_row_source_rule: row.source_rule.to_string(),
        },
        editable: true,
        removable: false,
        profile: AccountDefaultProfileBody {
            ai_profile_version: 1,
            payload: profile_payload,
            payload_hash: profile_payload_hash,
        },
        updated_at: now.clone(),
        account_id: validate_account_id(account_id)?,
        data_root_ref: data_root_ref.to_string(),
        ai_profile_alias: row.alias.to_string(),
        install_level: install_level.trim().to_string(),
        capability_set: row
            .capability_set
            .iter()
            .map(|value| value.to_string())
            .collect(),
        routing_policy: row.routing_policy.to_string(),
        factory_seed_profile_payload,
        factory_seed_profile_payload_hash,
        factory_provenance,
        factory_provenance_hash,
        profile_revision: factory_seed_revision(&now),
        created_at: now,
        content_hash: String::new(),
    };
    record.content_hash = compute_record_hash(&record)?;
    Ok(record)
}

/// The Account Default Profile projected as a portable AIProfile-shaped
/// payload, for the AIConfig scope-init rule.
///
/// Carries the same `profileId` / `title` / `description` / `tags` /
/// `capabilities` shape as the SDK `AIProfile` template. It is the verified
/// content of the durable `default.json` record — the renderer never
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

/// Read + verify the durable Account Default Profile record and project its
/// AIProfile payload for the AIConfig scope-init rule (P-AIPS-013 / product
/// manual "Profile And AIConfig Model").
///
/// The record's structural / hash / provenance fields are fully verified
/// against the authenticated account and selected data root before the payload
/// is returned, so a missing / tampered / wrong-account record fails closed.
pub fn read_account_default_profile_ai_profile(
    data_root: &Path,
    authenticated_account_id: &str,
) -> Result<AccountDefaultProfileAIProfile, String> {
    let path = account_default_profile_path(authenticated_account_id)?;
    let expected_data_root_ref = data_root_ref(data_root)?;
    let record = read_profile_record(&path)?;
    verify_record_fields(&record, authenticated_account_id, &expected_data_root_ref)?;
    Ok(AccountDefaultProfileAIProfile {
        profile_id: record.profile.payload.profile_id,
        title: record.profile.payload.title,
        description: record.profile.payload.description,
        tags: record.profile.payload.tags,
        capabilities: record.profile.payload.capabilities,
    })
}

pub fn verify_account_default_profile_ref(
    data_root: &Path,
    authenticated_account_id: &str,
    account_default_profile_ref: &str,
) -> Result<AccountDefaultProfileEvidence, String> {
    let path = account_default_profile_path(authenticated_account_id)?;
    let expected_data_root_ref = data_root_ref(data_root)?;
    let record = read_profile_record(&path)?;
    verify_record_fields(&record, authenticated_account_id, &expected_data_root_ref)?;
    let evidence = evidence_from_record(&path, &record)?;
    if evidence.account_default_profile_ref != account_default_profile_ref.trim() {
        return Err(
            "Account Default Profile ref is caller-provided, stale, or string-only".to_string(),
        );
    }
    Ok(evidence)
}

pub fn ensure_account_default_profile(
    data_root: &Path,
    authenticated_account_id: &str,
    selected_ai_profile_alias: &str,
    install_level: &str,
) -> Result<AccountDefaultProfileEvidence, String> {
    let path = account_default_profile_path(authenticated_account_id)?;
    let expected_data_root_ref = data_root_ref(data_root)?;
    let selected_row =
        verify_first_run_factory_ai_profile(selected_ai_profile_alias, install_level)?;
    if path.exists() {
        let record = read_profile_record(&path)?;
        if let Err(error) =
            verify_record_fields(&record, authenticated_account_id, &expected_data_root_ref)
        {
            if is_factory_catalog_drift_error(&error)
                && is_reseedable_factory_profile_record(
                    &record,
                    authenticated_account_id,
                    &expected_data_root_ref,
                )?
            {
                let next_record = new_profile_record(
                    authenticated_account_id,
                    &expected_data_root_ref,
                    install_level,
                    selected_row,
                )?;
                write_profile_record(&path, &next_record)?;
                let evidence = evidence_from_record(&path, &next_record)?;
                return verify_account_default_profile_ref(
                    data_root,
                    authenticated_account_id,
                    &evidence.account_default_profile_ref,
                );
            }
            return Err(error);
        }
        let evidence = evidence_from_record(&path, &record)?;
        return verify_account_default_profile_ref(
            data_root,
            authenticated_account_id,
            &evidence.account_default_profile_ref,
        );
    }

    let record = new_profile_record(
        authenticated_account_id,
        &expected_data_root_ref,
        install_level,
        selected_row,
    )?;
    write_profile_record(&path, &record)?;
    let evidence = evidence_from_record(&path, &record)?;
    verify_account_default_profile_ref(
        data_root,
        authenticated_account_id,
        &evidence.account_default_profile_ref,
    )
}

#[cfg(test)]
mod tests;
