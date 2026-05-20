use crate::platform_ai_profile_factory_catalog::{
    verify_first_run_factory_ai_profile, PlatformAIProfileFactoryRow,
    PLATFORM_AI_PROFILE_FACTORY_CATALOG_ID, PLATFORM_AI_PROFILE_FACTORY_CATALOG_VERSION,
    PLATFORM_AI_PROFILE_SELECTION_POLICY_REF,
};
use serde::{Deserialize, Serialize};
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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AccountDefaultAIProfilePayload {
    pub profile_id: String,
    pub title: String,
    pub description: String,
    pub tags: Vec<String>,
    pub capabilities: serde_json::Map<String, serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AccountDefaultFactoryProvenance {
    pub ai_profile_alias: String,
    pub privacy_posture: String,
    pub compute_posture: String,
    pub capability_set: Vec<String>,
    pub routing_policy: String,
    pub host_capability_profile_refs: Vec<String>,
    pub local_compute_pack_refs: Vec<String>,
    pub dependency_family_refs: Vec<String>,
    pub materialization_confirmation_required: bool,
    pub applicable_scopes: Vec<String>,
    pub first_run_install_levels: Vec<String>,
    pub source_rule: String,
    pub source_policy_ref: String,
    pub source_catalog_id: String,
    pub source_catalog_version: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AccountDefaultProfileRevisionProvenance {
    pub revision_kind: String,
    pub source: String,
    pub previous_content_hash: Option<String>,
    pub changed_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AccountDefaultProfileRecord {
    pub schema_version: u32,
    pub account_id: String,
    pub data_root_ref: String,
    pub profile_id: String,
    pub profile_version: u64,
    pub ai_profile_alias: String,
    pub install_level: String,
    pub source_policy_ref: String,
    pub source_catalog_id: String,
    pub source_catalog_version: u32,
    pub source_catalog_row_source_rule: String,
    pub capability_set: Vec<String>,
    pub routing_policy: String,
    pub profile_payload: AccountDefaultAIProfilePayload,
    pub profile_payload_hash: String,
    pub factory_seed_profile_payload: AccountDefaultAIProfilePayload,
    pub factory_seed_profile_payload_hash: String,
    pub factory_provenance: AccountDefaultFactoryProvenance,
    pub factory_provenance_hash: String,
    pub profile_revision: AccountDefaultProfileRevisionProvenance,
    pub created_at: String,
    pub updated_at: String,
    pub content_hash: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AccountDefaultProfileEvidence {
    pub account_default_profile_ref: String,
    pub profile_path: String,
    pub account_id: String,
    pub data_root_ref: String,
    pub profile_id: String,
    pub profile_version: u64,
    pub content_hash: String,
    pub source_policy_ref: String,
    pub source_catalog_id: String,
    pub source_catalog_version: u32,
    pub created_at: String,
    pub updated_at: String,
    pub ai_profile_alias: String,
    pub profile_payload_hash: String,
    pub factory_provenance_hash: String,
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

pub fn account_default_profile_path(data_root: &Path, account_id: &str) -> Result<PathBuf, String> {
    let normalized_account = validate_account_id(account_id)?;
    if !data_root.is_absolute() {
        return Err("Account Default Profile data root must be absolute".to_string());
    }
    Ok(data_root
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
        account_id: &'a str,
        data_root_ref: &'a str,
        profile_id: &'a str,
        profile_version: u64,
        ai_profile_alias: &'a str,
        install_level: &'a str,
        source_policy_ref: &'a str,
        source_catalog_id: &'a str,
        source_catalog_version: u32,
        source_catalog_row_source_rule: &'a str,
        capability_set: &'a [String],
        routing_policy: &'a str,
        profile_payload: &'a AccountDefaultAIProfilePayload,
        profile_payload_hash: &'a str,
        factory_seed_profile_payload: &'a AccountDefaultAIProfilePayload,
        factory_seed_profile_payload_hash: &'a str,
        factory_provenance: &'a AccountDefaultFactoryProvenance,
        factory_provenance_hash: &'a str,
        profile_revision: &'a AccountDefaultProfileRevisionProvenance,
        created_at: &'a str,
        updated_at: &'a str,
    }

    let payload = HashPayload {
        schema_version: record.schema_version,
        account_id: &record.account_id,
        data_root_ref: &record.data_root_ref,
        profile_id: &record.profile_id,
        profile_version: record.profile_version,
        ai_profile_alias: &record.ai_profile_alias,
        install_level: &record.install_level,
        source_policy_ref: &record.source_policy_ref,
        source_catalog_id: &record.source_catalog_id,
        source_catalog_version: record.source_catalog_version,
        source_catalog_row_source_rule: &record.source_catalog_row_source_rule,
        capability_set: &record.capability_set,
        routing_policy: &record.routing_policy,
        profile_payload: &record.profile_payload,
        profile_payload_hash: &record.profile_payload_hash,
        factory_seed_profile_payload: &record.factory_seed_profile_payload,
        factory_seed_profile_payload_hash: &record.factory_seed_profile_payload_hash,
        factory_provenance: &record.factory_provenance,
        factory_provenance_hash: &record.factory_provenance_hash,
        profile_revision: &record.profile_revision,
        created_at: &record.created_at,
        updated_at: &record.updated_at,
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
    let payload_is_factory_seed = record.profile_payload == *factory_seed_payload;
    match record.profile_revision.revision_kind.as_str() {
        PROFILE_REVISION_FACTORY_SEED => {
            if !payload_is_factory_seed || record.profile_version != 1 {
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
            if record.profile_version <= 1 || record.updated_at == record.created_at {
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
    if row.source_rule != record.source_catalog_row_source_rule {
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
    if record.profile_version == 0 {
        return Err("Account Default Profile profile version is required".to_string());
    }
    if record.source_policy_ref != PLATFORM_AI_PROFILE_SELECTION_POLICY_REF {
        return Err(
            "Account Default Profile source policy ref is missing or unresolvable".to_string(),
        );
    }
    if record.source_catalog_id != PLATFORM_AI_PROFILE_FACTORY_CATALOG_ID
        || record.source_catalog_version != PLATFORM_AI_PROFILE_FACTORY_CATALOG_VERSION
    {
        return Err(
            "Account Default Profile source catalog version is missing or unresolvable".to_string(),
        );
    }
    if record.created_at.trim().is_empty() || record.updated_at.trim().is_empty() {
        return Err("Account Default Profile createdAt/updatedAt evidence is required".to_string());
    }
    let row = row_from_record(record)?;
    validate_sdk_ai_profile_payload(&record.profile_payload)?;
    let expected_payload_hash = stable_json_hash(
        &record.profile_payload,
        "Account Default Profile AIProfile payload",
    )?;
    if record.profile_payload_hash != expected_payload_hash {
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
        profile_version: record.profile_version,
        content_hash: record.content_hash.clone(),
        source_policy_ref: record.source_policy_ref.clone(),
        source_catalog_id: record.source_catalog_id.clone(),
        source_catalog_version: record.source_catalog_version,
        created_at: record.created_at.clone(),
        updated_at: record.updated_at.clone(),
        ai_profile_alias: record.ai_profile_alias.clone(),
        profile_payload_hash: record.profile_payload_hash.clone(),
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
        account_id: validate_account_id(account_id)?,
        data_root_ref: data_root_ref.to_string(),
        profile_id: ACCOUNT_DEFAULT_PROFILE_ID.to_string(),
        profile_version: 1,
        ai_profile_alias: row.alias.to_string(),
        install_level: install_level.trim().to_string(),
        source_policy_ref: PLATFORM_AI_PROFILE_SELECTION_POLICY_REF.to_string(),
        source_catalog_id: PLATFORM_AI_PROFILE_FACTORY_CATALOG_ID.to_string(),
        source_catalog_version: PLATFORM_AI_PROFILE_FACTORY_CATALOG_VERSION,
        source_catalog_row_source_rule: row.source_rule.to_string(),
        capability_set: row
            .capability_set
            .iter()
            .map(|value| value.to_string())
            .collect(),
        routing_policy: row.routing_policy.to_string(),
        profile_payload,
        profile_payload_hash,
        factory_seed_profile_payload,
        factory_seed_profile_payload_hash,
        factory_provenance,
        factory_provenance_hash,
        profile_revision: factory_seed_revision(&now),
        created_at: now.clone(),
        updated_at: now,
        content_hash: String::new(),
    };
    record.content_hash = compute_record_hash(&record)?;
    Ok(record)
}

pub fn verify_account_default_profile_ref(
    data_root: &Path,
    authenticated_account_id: &str,
    account_default_profile_ref: &str,
) -> Result<AccountDefaultProfileEvidence, String> {
    let path = account_default_profile_path(data_root, authenticated_account_id)?;
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
    let path = account_default_profile_path(data_root, authenticated_account_id)?;
    let expected_data_root_ref = data_root_ref(data_root)?;
    let selected_row =
        verify_first_run_factory_ai_profile(selected_ai_profile_alias, install_level)?;
    if path.exists() {
        let record = read_profile_record(&path)?;
        verify_record_fields(&record, authenticated_account_id, &expected_data_root_ref)?;
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
mod tests {
    use super::{
        account_default_profile_path, data_root_ref, ensure_account_default_profile,
        verify_account_default_profile_ref, AccountDefaultProfileRecord,
        PLATFORM_AI_PROFILE_FACTORY_CATALOG_VERSION,
    };
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_data_root(prefix: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("nimi-account-profile-{prefix}-{unique}"));
        std::fs::create_dir_all(&dir).expect("create temp data root");
        dir
    }

    fn read_record(path: &std::path::Path) -> AccountDefaultProfileRecord {
        serde_json::from_str(&std::fs::read_to_string(path).expect("read account default profile"))
            .expect("parse account default profile")
    }

    fn write_record(path: &std::path::Path, record: &AccountDefaultProfileRecord) {
        std::fs::write(path, serde_json::to_string_pretty(record).expect("json")).expect("write");
    }

    fn write_json(path: &std::path::Path, value: serde_json::Value) {
        std::fs::write(path, serde_json::to_string_pretty(&value).expect("json"))
            .expect("write json");
    }

    fn refresh_content_hash(record: &mut AccountDefaultProfileRecord) {
        record.content_hash = super::compute_record_hash(record).expect("content hash");
    }

    fn apply_local_payload_change(
        record: &mut AccountDefaultProfileRecord,
        revision_kind: &str,
        title: &str,
    ) {
        let previous_hash = record.content_hash.clone();
        record.profile_version += 1;
        record.updated_at = format!("2026-05-20T00:00:0{}.000Z", record.profile_version);
        record.profile_payload.title = title.to_string();
        record
            .profile_payload
            .tags
            .push("locally-edited".to_string());
        record.profile_payload_hash = super::stable_json_hash(
            &record.profile_payload,
            "Account Default Profile AIProfile payload",
        )
        .expect("payload hash");
        record.profile_revision = super::AccountDefaultProfileRevisionProvenance {
            revision_kind: revision_kind.to_string(),
            source: super::ACCOUNT_PROFILE_LOCAL_LIBRARY_SOURCE.to_string(),
            previous_content_hash: Some(previous_hash),
            changed_at: record.updated_at.clone(),
        };
        refresh_content_hash(record);
    }

    #[test]
    fn creates_default_profile_under_selected_data_root_accounts() {
        let root = temp_data_root("create");
        let evidence = ensure_account_default_profile(
            &root,
            "account:abc.def+1",
            "local-speech-ready",
            "minimal",
        )
        .expect("ensure profile");
        assert_eq!(evidence.profile_id, "default");
        assert_eq!(evidence.account_id, "account:abc.def+1");
        assert_eq!(
            evidence.data_root_ref,
            data_root_ref(&root).expect("data root ref")
        );
        assert!(account_default_profile_path(&root, "account:abc.def+1")
            .expect("profile path")
            .exists());
        let record = read_record(
            &account_default_profile_path(&root, "account:abc.def+1").expect("profile path"),
        );
        assert_eq!(record.profile_payload.profile_id, "default");
        assert!(record
            .profile_payload
            .capabilities
            .contains_key("text.generate"));
        assert_eq!(record.profile_payload, record.factory_seed_profile_payload);
        assert_eq!(
            record.profile_payload_hash,
            record.factory_seed_profile_payload_hash
        );
        assert_eq!(record.profile_revision.revision_kind, "factory_seed");
        assert_eq!(
            record.factory_provenance.source_catalog_id,
            super::PLATFORM_AI_PROFILE_FACTORY_CATALOG_ID
        );
        assert_eq!(
            record.factory_provenance.source_policy_ref,
            super::PLATFORM_AI_PROFILE_SELECTION_POLICY_REF
        );
        assert_eq!(
            record.factory_provenance.ai_profile_alias,
            "local-speech-ready"
        );
        assert!(!record
            .factory_provenance
            .host_capability_profile_refs
            .is_empty());
        assert!(!record.factory_provenance.local_compute_pack_refs.is_empty());
        assert!(!record.factory_provenance.dependency_family_refs.is_empty());
    }

    #[test]
    fn restores_existing_valid_profile_without_overwriting_for_new_selection() {
        let root = temp_data_root("restore");
        let first =
            ensure_account_default_profile(&root, "account_1", "local-speech-ready", "minimal")
                .expect("first ensure");
        let path = account_default_profile_path(&root, "account_1").expect("profile path");
        let mut edited_record = read_record(&path);
        apply_local_payload_change(
            &mut edited_record,
            super::PROFILE_REVISION_LOCAL_EDIT,
            "Edited Before Catalog Selection Change",
        );
        write_record(&path, &edited_record);
        let edited_evidence =
            super::evidence_from_record(&path, &edited_record).expect("edited evidence");
        let raw_before = std::fs::read_to_string(&path).expect("read before");
        let restored =
            ensure_account_default_profile(&root, "account_1", "local-gpu", "recommended")
                .expect("restore existing");
        let raw_after = std::fs::read_to_string(&path).expect("read after");
        assert_eq!(
            restored.account_default_profile_ref,
            edited_evidence.account_default_profile_ref
        );
        assert_ne!(
            restored.account_default_profile_ref,
            first.account_default_profile_ref
        );
        assert_eq!(raw_after, raw_before);
    }

    #[test]
    fn verifier_rejects_missing_string_only_wrong_account_and_wrong_data_root_refs() {
        let root = temp_data_root("negative");
        let missing = verify_account_default_profile_ref(
            &root,
            "account_1",
            "account-default-profile:v1:string-only",
        )
        .expect_err("missing profile must fail");
        assert!(missing.contains("missing or unreadable"));

        let evidence =
            ensure_account_default_profile(&root, "account_1", "local-speech-ready", "minimal")
                .expect("ensure profile");
        let string_only = verify_account_default_profile_ref(
            &root,
            "account_1",
            "account-default-profile:v1:string-only",
        )
        .expect_err("string-only ref must fail");
        assert!(string_only.contains("string-only"));

        let wrong_account = verify_account_default_profile_ref(
            &root,
            "account_2",
            &evidence.account_default_profile_ref,
        )
        .expect_err("wrong account must fail");
        assert!(wrong_account.contains("missing or unreadable"));

        let other_root = temp_data_root("other-root");
        let wrong_root = verify_account_default_profile_ref(
            &other_root,
            "account_1",
            &evidence.account_default_profile_ref,
        )
        .expect_err("wrong root must fail");
        assert!(wrong_root.contains("missing or unreadable"));
    }

    #[test]
    fn verifier_rejects_source_and_hash_tampering() {
        let root = temp_data_root("tamper");
        let evidence =
            ensure_account_default_profile(&root, "account_1", "local-speech-ready", "minimal")
                .expect("ensure profile");
        let path = account_default_profile_path(&root, "account_1").expect("profile path");

        let mut record = read_record(&path);
        record.source_policy_ref.clear();
        write_record(&path, &record);
        let source_policy = verify_account_default_profile_ref(
            &root,
            "account_1",
            &evidence.account_default_profile_ref,
        )
        .expect_err("source policy must fail");
        assert!(source_policy.contains("source policy"));

        ensure_account_default_profile(&root, "account_1", "local-speech-ready", "minimal")
            .expect_err("invalid existing profile must fail closed instead of overwrite");
        let mut record = read_record(&path);
        record.source_policy_ref = super::PLATFORM_AI_PROFILE_SELECTION_POLICY_REF.to_string();
        record.source_catalog_version = PLATFORM_AI_PROFILE_FACTORY_CATALOG_VERSION + 1;
        write_record(&path, &record);
        let source_catalog = verify_account_default_profile_ref(
            &root,
            "account_1",
            &evidence.account_default_profile_ref,
        )
        .expect_err("source catalog must fail");
        assert!(source_catalog.contains("source catalog"));

        let mut record = read_record(&path);
        record.source_catalog_version = PLATFORM_AI_PROFILE_FACTORY_CATALOG_VERSION;
        record.content_hash = "sha256:bad".to_string();
        write_record(&path, &record);
        let hash = verify_account_default_profile_ref(
            &root,
            "account_1",
            &evidence.account_default_profile_ref,
        )
        .expect_err("hash must fail");
        assert!(hash.contains("content hash"));
    }

    #[test]
    fn verifier_rejects_missing_payload_payload_hash_mismatch_and_missing_provenance() {
        let root = temp_data_root("payload-negative");
        let evidence =
            ensure_account_default_profile(&root, "account_1", "local-speech-ready", "minimal")
                .expect("ensure profile");
        let path = account_default_profile_path(&root, "account_1").expect("profile path");
        let valid_record = read_record(&path);

        let mut missing_payload = serde_json::to_value(&valid_record).expect("record json");
        missing_payload
            .as_object_mut()
            .expect("object")
            .remove("profilePayload");
        write_json(&path, missing_payload);
        let missing_payload_error = verify_account_default_profile_ref(
            &root,
            "account_1",
            &evidence.account_default_profile_ref,
        )
        .expect_err("missing profile payload must fail");
        assert!(
            missing_payload_error.contains("profilePayload")
                || missing_payload_error.contains("cannot be parsed")
        );

        let mut payload_hash_mismatch = valid_record.clone();
        payload_hash_mismatch.profile_payload_hash = "sha256:bad".to_string();
        refresh_content_hash(&mut payload_hash_mismatch);
        write_record(&path, &payload_hash_mismatch);
        let payload_hash_error = verify_account_default_profile_ref(
            &root,
            "account_1",
            &evidence.account_default_profile_ref,
        )
        .expect_err("payload hash mismatch must fail");
        assert!(payload_hash_error.contains("profile payload hash"));

        let mut missing_provenance = serde_json::to_value(&valid_record).expect("record json");
        missing_provenance
            .as_object_mut()
            .expect("object")
            .remove("factoryProvenance");
        write_json(&path, missing_provenance);
        let missing_provenance_error = verify_account_default_profile_ref(
            &root,
            "account_1",
            &evidence.account_default_profile_ref,
        )
        .expect_err("missing provenance must fail");
        assert!(
            missing_provenance_error.contains("factoryProvenance")
                || missing_provenance_error.contains("cannot be parsed")
        );

        let mut provenance_hash_mismatch = valid_record.clone();
        provenance_hash_mismatch.factory_provenance_hash = "sha256:bad".to_string();
        refresh_content_hash(&mut provenance_hash_mismatch);
        write_record(&path, &provenance_hash_mismatch);
        let provenance_hash_error = verify_account_default_profile_ref(
            &root,
            "account_1",
            &evidence.account_default_profile_ref,
        )
        .expect_err("provenance hash mismatch must fail");
        assert!(provenance_hash_error.contains("factory provenance hash"));

        let mut malformed_payload = valid_record.clone();
        malformed_payload.profile_payload.title.clear();
        malformed_payload.profile_payload_hash = super::stable_json_hash(
            &malformed_payload.profile_payload,
            "Account Default Profile AIProfile payload",
        )
        .expect("payload hash");
        refresh_content_hash(&mut malformed_payload);
        write_record(&path, &malformed_payload);
        let malformed_payload_error = verify_account_default_profile_ref(
            &root,
            "account_1",
            &evidence.account_default_profile_ref,
        )
        .expect_err("malformed payload must fail");
        assert!(malformed_payload_error.contains("payload title"));
    }

    #[test]
    fn locally_edited_payload_verifies_with_revision_provenance_and_hashes() {
        let root = temp_data_root("payload-seed");
        let evidence =
            ensure_account_default_profile(&root, "account_1", "local-speech-ready", "minimal")
                .expect("ensure profile");
        let path = account_default_profile_path(&root, "account_1").expect("profile path");
        let mut record = read_record(&path);
        assert_eq!(record.profile_payload, record.factory_seed_profile_payload);
        apply_local_payload_change(
            &mut record,
            super::PROFILE_REVISION_LOCAL_EDIT,
            "Edited Local Default",
        );
        assert_ne!(record.profile_payload, record.factory_seed_profile_payload);
        assert_eq!(record.profile_version, 2);
        assert_eq!(record.profile_revision.revision_kind, "local_edit");
        write_record(&path, &record);
        let edited_evidence = super::evidence_from_record(&path, &record).expect("edited evidence");

        verify_account_default_profile_ref(
            &root,
            "account_1",
            &edited_evidence.account_default_profile_ref,
        )
        .expect("edited payload verifies");
        assert_ne!(
            edited_evidence.account_default_profile_ref,
            evidence.account_default_profile_ref
        );
    }

    #[test]
    fn replacing_account_default_profile_does_not_mutate_scope_bound_ai_config_fixture() {
        let root = temp_data_root("aiconfig-isolation");
        let evidence =
            ensure_account_default_profile(&root, "account_1", "local-speech-ready", "minimal")
                .expect("ensure profile");
        let ai_config = serde_json::json!({
            "schemaVersion": 1,
            "scopeRef": {
                "kind": "feature",
                "ownerId": "desktop.chat",
                "surfaceId": "nimi"
            },
            "aiProfileRef": "factory:local-speech-ready",
            "aiConfigVersion": 7,
            "routeIntent": {
                "text.generate": {
                    "binding": null
                }
            }
        });
        let ai_config_before = ai_config.clone();
        let ai_config_path = root.join("scope-bound-aiconfig.json");
        write_json(&ai_config_path, ai_config.clone());
        let ai_config_raw_before = std::fs::read_to_string(&ai_config_path).expect("ai config");

        let path = account_default_profile_path(&root, "account_1").expect("profile path");
        let mut replacement = read_record(&path);
        apply_local_payload_change(
            &mut replacement,
            super::PROFILE_REVISION_LOCAL_REPLACEMENT,
            "Replacement Local Default",
        );
        write_record(&path, &replacement);
        let replacement_evidence =
            super::evidence_from_record(&path, &replacement).expect("replacement evidence");
        verify_account_default_profile_ref(
            &root,
            "account_1",
            &replacement_evidence.account_default_profile_ref,
        )
        .expect("replacement verifies");
        assert_ne!(
            replacement_evidence.account_default_profile_ref,
            evidence.account_default_profile_ref
        );

        assert_eq!(ai_config, ai_config_before);
        assert_eq!(
            std::fs::read_to_string(&ai_config_path).expect("ai config after"),
            ai_config_raw_before
        );
    }
}
