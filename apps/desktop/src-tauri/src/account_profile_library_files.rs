//! Account-scoped editable AI profile library file family.
//!
//! Spec authority:
//!   - `P-AIPS-013` Account Default Profile Local Library Evidence — fixes the
//!     account profile library under
//!     `<dataRoot>/accounts/<account-id>/profiles/`
//!     and forbids renderer profile state / SDK cache / app-local cache as
//!     profile-library truth.
//!   - Product manual "User-Local Config And Data Roots" — the account profile
//!     library is `<dataRoot>/accounts/<account-id>/profiles/{ index.json,
//!     default.json, user/, imported/ }`.
//!
//! This module owns the EDITABLE library family: the `index.json` library
//! index, the `user/` directory of user-created profiles, and the `imported/`
//! directory of imported profiles. The non-removable Account Default Profile
//! (`default.json`, `account_profile_library.rs`, T2.1a/c) keeps its own record
//! and lives where it is — the library index references it as a fixed,
//! non-removable, non-editable-through-this-module entry; this module never
//! reads, writes, or mutates `default.json`.
//!
//! Hard boundaries:
//!   - the library file family on disk is the single source of truth; the
//!     renderer holds only a read-through projection, never a parallel store;
//!   - every list/create/edit/import/export/delete operation reads or writes
//!     the file family and re-derives the index from disk;
//!   - the `default` profile id is reserved for the Account Default Profile and
//!     cannot be created, edited, imported, or deleted through this module.

use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

mod types;

pub use types::{
    AccountProfileLibraryProjection, LibraryAIProfilePayload, LibraryIndexEntry,
    LibraryIndexRecord, LibraryProfileProjection, LibraryProfileRecord,
};

/// Schema version of an account profile library entry record.
const LIBRARY_ENTRY_SCHEMA_VERSION: u32 = 1;
/// Schema version of the `index.json` library index record.
const LIBRARY_INDEX_SCHEMA_VERSION: u32 = 1;
/// Reserved profile id of the non-removable Account Default Profile.
const ACCOUNT_DEFAULT_PROFILE_ID: &str = "default";
/// On-disk file name of the Account Default Profile record (`account_profile_library.rs`).
const ACCOUNT_DEFAULT_PROFILE_FILE: &str = "default.json";
/// On-disk file name of the editable library index.
const LIBRARY_INDEX_FILE: &str = "index.json";
/// Library entry origin: a user-created profile under `user/`.
const LIBRARY_ORIGIN_USER: &str = "user";
/// Library entry origin: an imported profile under `imported/`.
const LIBRARY_ORIGIN_IMPORTED: &str = "imported";
/// Library entry origin of the Account Default Profile index reference.
const LIBRARY_ORIGIN_ACCOUNT_DEFAULT: &str = "account-default";
const FORBIDDEN_AI_PROFILE_FIELD_NAMES: &[&str] = &[
    "RuntimeRouteBinding",
    "selectedBindings",
    "selected_source_records",
    "selectedSourceRecords",
    "install_evidence",
    "installEvidence",
    "materialization_evidence",
    "materializationEvidence",
    "workflow_binding_id",
    "workflowBindingId",
    "prepared_asset_id",
    "preparedAssetId",
    "backend_environment_evidence",
    "backendEnvironmentEvidence",
    "provider_health",
    "providerHealth",
    "scheduler_state",
    "schedulerState",
    "credential_payload",
    "credentialPayload",
    "secret",
    "token",
    "apiKey",
    "api_key",
    "oauth",
    "endpoint",
    "localModelId",
    "goRuntimeLocalModelId",
    "goRuntimeStatus",
    "providerHints",
    "binding",
    "localProfileRef",
    "localProfileRefs",
];

// ---------------------------------------------------------------------------
// Time helpers
// ---------------------------------------------------------------------------

fn now_iso_timestamp() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

fn now_unix_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

// ---------------------------------------------------------------------------
// Account id + path helpers
// ---------------------------------------------------------------------------

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

/// Resolve the account profile library root
/// (`<dataRoot>/accounts/<account-id>/profiles/`). The caller must pass the
/// canonical Product Control data root; this file family never discovers or
/// guesses a root.
pub fn account_profile_library_dir(data_root: &Path, account_id: &str) -> Result<PathBuf, String> {
    if !data_root.is_absolute() {
        return Err("canonical data_root must be absolute".to_string());
    }
    let normalized_account = validate_account_id(account_id)?;
    Ok(data_root
        .join("accounts")
        .join(account_path_segment(&normalized_account))
        .join("profiles"))
}

fn library_index_path(data_root: &Path, account_id: &str) -> Result<PathBuf, String> {
    Ok(account_profile_library_dir(data_root, account_id)?.join(LIBRARY_INDEX_FILE))
}

fn library_origin_dir(data_root: &Path, account_id: &str, origin: &str) -> Result<PathBuf, String> {
    Ok(account_profile_library_dir(data_root, account_id)?.join(origin))
}

/// Profile id validation. The id must be a safe path segment and must never
/// collide with the reserved Account Default Profile id.
fn validate_library_profile_id(profile_id: &str) -> Result<String, String> {
    let normalized = profile_id.trim();
    if normalized.is_empty() {
        return Err("library profile id is required".to_string());
    }
    if normalized == ACCOUNT_DEFAULT_PROFILE_ID {
        return Err(
            "library profile id `default` is reserved for the non-removable Account Default Profile"
                .to_string(),
        );
    }
    let safe = normalized
        .chars()
        .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.'));
    if !safe {
        return Err(
            "library profile id must contain only ASCII letters, digits, '-', '_', or '.'"
                .to_string(),
        );
    }
    if normalized.starts_with('.') {
        return Err("library profile id must not start with '.'".to_string());
    }
    Ok(normalized.to_string())
}

fn validate_origin(origin: &str) -> Result<String, String> {
    match origin.trim() {
        LIBRARY_ORIGIN_USER => Ok(LIBRARY_ORIGIN_USER.to_string()),
        LIBRARY_ORIGIN_IMPORTED => Ok(LIBRARY_ORIGIN_IMPORTED.to_string()),
        other => Err(format!(
            "library profile origin must be `user` or `imported`, got: {other}"
        )),
    }
}

fn library_profile_path(
    data_root: &Path,
    account_id: &str,
    origin: &str,
    profile_id: &str,
) -> Result<PathBuf, String> {
    let normalized_origin = validate_origin(origin)?;
    let normalized_id = validate_library_profile_id(profile_id)?;
    Ok(
        library_origin_dir(data_root, account_id, &normalized_origin)?
            .join(format!("{normalized_id}.json")),
    )
}

fn is_path_like_string(value: &str) -> bool {
    let trimmed = value.trim();
    trimmed.starts_with('/')
        || trimmed.starts_with('~')
        || trimmed.starts_with("file://")
        || trimmed.contains("\\")
        || trimmed.contains("/Users/")
        || trimmed.contains("/tmp/")
        || trimmed.contains("/var/")
        || (trimmed.len() > 2
            && trimmed.as_bytes()[1] == b':'
            && (trimmed.as_bytes()[2] == b'/' || trimmed.as_bytes()[2] == b'\\'))
}

fn validate_no_forbidden_payload_fields(
    value: &serde_json::Value,
    path: &str,
) -> Result<(), String> {
    match value {
        serde_json::Value::String(text) => {
            if is_path_like_string(text) {
                return Err(format!("{path} must be a portable non-path logical ref"));
            }
        }
        serde_json::Value::Array(items) => {
            for (index, item) in items.iter().enumerate() {
                validate_no_forbidden_payload_fields(item, &format!("{path}[{index}]"))?;
            }
        }
        serde_json::Value::Object(record) => {
            for (key, child) in record {
                if FORBIDDEN_AI_PROFILE_FIELD_NAMES.contains(&key.as_str()) {
                    return Err(format!(
                        "{path}.{key} is forbidden in library AIProfile payload"
                    ));
                }
                validate_no_forbidden_payload_fields(child, &format!("{path}.{key}"))?;
            }
        }
        _ => {}
    }
    Ok(())
}

fn validate_optional_string_vec(values: &Option<Vec<String>>, label: &str) -> Result<(), String> {
    if let Some(values) = values {
        if values.iter().any(|value| value.trim().is_empty()) {
            return Err(format!("{label} must contain only non-empty strings"));
        }
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// AIProfile payload validation
// ---------------------------------------------------------------------------

/// Validate a library AIProfile payload. Mirrors the SDK `validateAIProfile`
/// static-schema rules so a malformed profile fails closed before it is
/// committed to the library file family.
fn validate_library_ai_profile_payload(
    payload: &LibraryAIProfilePayload,
    expected_profile_id: &str,
) -> Result<(), String> {
    if payload.profile_id != expected_profile_id {
        return Err(
            "library AIProfile payload profileId does not match the library entry id".to_string(),
        );
    }
    validate_library_profile_id(&payload.profile_id)?;
    if payload.title.trim().is_empty() {
        return Err("library AIProfile payload title is required".to_string());
    }
    if payload.tags.iter().any(|tag| tag.trim().is_empty()) {
        return Err("library AIProfile payload tags must be non-empty strings".to_string());
    }
    let payload_value = serde_json::to_value(payload)
        .map_err(|error| format!("library AIProfile payload cannot serialize: {error}"))?;
    validate_no_forbidden_payload_fields(&payload_value, "profile")?;
    for (capability, value) in &payload.capabilities {
        if capability.trim().is_empty() {
            return Err("library AIProfile payload capability id is required".to_string());
        }
        let Some(intent) = value.as_object() else {
            return Err("library AIProfile payload capability entries must be objects".to_string());
        };
        if let Some(policy) = intent.get("readinessPolicy") {
            if policy.as_str() != Some("required") && policy.as_str() != Some("optional") {
                return Err(format!(
                    "library AIProfile payload capability {capability} readinessPolicy is invalid"
                ));
            }
        }
        if let Some(contract_state) = intent.get("contractState") {
            if contract_state.as_str() != Some("declared")
                && contract_state.as_str() != Some("proposed")
                && contract_state.as_str() != Some("unsupported")
            {
                return Err(format!(
                    "library AIProfile payload capability {capability} contractState is invalid"
                ));
            }
        }
    }
    if let Some(default_params) = &payload.default_params {
        if !default_params.is_object() {
            return Err("library AIProfile payload defaultParams must be an object".to_string());
        }
    }
    validate_optional_string_vec(
        &payload.editable_fields,
        "library AIProfile payload editableFields",
    )?;
    validate_optional_string_vec(
        &payload.prepare_requirements,
        "library AIProfile payload prepareRequirements",
    )?;
    validate_optional_string_vec(
        &payload.contract_states,
        "library AIProfile payload contractStates",
    )?;
    validate_optional_string_vec(
        &payload.projection_warnings,
        "library AIProfile payload projectionWarnings",
    )?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Record IO
// ---------------------------------------------------------------------------

fn write_json_atomic<T: Serialize>(path: &Path, value: &T, label: &str) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| format!("{label} path has no parent directory"))?;
    fs::create_dir_all(parent).map_err(|error| {
        format!(
            "create {label} directory failed ({}): {error}",
            parent.display()
        )
    })?;
    let raw = serde_json::to_string_pretty(value)
        .map_err(|error| format!("serialize {label} failed: {error}"))?;
    let tmp_path =
        path.with_extension(format!("json.tmp.{}.{}", std::process::id(), now_unix_ms()));
    fs::write(&tmp_path, raw).map_err(|error| {
        format!(
            "write {label} temporary file failed ({}): {error}",
            tmp_path.display()
        )
    })?;
    fs::rename(&tmp_path, path)
        .map_err(|error| format!("commit {label} record failed ({}): {error}", path.display()))
}

fn read_library_profile_record(path: &Path) -> Result<LibraryProfileRecord, String> {
    let raw = fs::read_to_string(path).map_err(|error| {
        format!(
            "library profile record is unreadable ({}): {error}",
            path.display()
        )
    })?;
    let record = serde_json::from_str::<LibraryProfileRecord>(&raw).map_err(|error| {
        format!(
            "library profile record cannot be parsed ({}): {error}",
            path.display()
        )
    })?;
    if record.schema_version != LIBRARY_ENTRY_SCHEMA_VERSION {
        return Err(format!(
            "library profile record schemaVersion={} is unsupported ({})",
            record.schema_version,
            path.display()
        ));
    }
    Ok(record)
}

// ---------------------------------------------------------------------------
// Library scan + index derivation
// ---------------------------------------------------------------------------

/// One scanned editable library profile record plus its on-disk path.
struct ScannedLibraryProfile {
    record: LibraryProfileRecord,
    relative_path: String,
}

/// Scan one editable origin directory (`user/` or `imported/`) and return every
/// valid `<profileId>.json` record. A malformed record fails closed.
fn scan_origin_directory(
    data_root: &Path,
    account_id: &str,
    origin: &str,
) -> Result<Vec<ScannedLibraryProfile>, String> {
    let dir = library_origin_dir(data_root, account_id, origin)?;
    if !dir.exists() {
        return Ok(Vec::new());
    }
    let mut scanned: Vec<ScannedLibraryProfile> = Vec::new();
    let entries = fs::read_dir(&dir).map_err(|error| {
        format!(
            "read library {origin} directory failed ({}): {error}",
            dir.display()
        )
    })?;
    for entry in entries {
        let entry =
            entry.map_err(|error| format!("read library {origin} entry failed: {error}"))?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let file_name = path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or_default();
        let Some(profile_id) = file_name.strip_suffix(".json") else {
            return Err(format!(
                "library {origin} directory has a non-profile file: {file_name}"
            ));
        };
        let expected_id = validate_library_profile_id(profile_id)?;
        let record = read_library_profile_record(&path)?;
        if record.account_id != account_id {
            return Err(format!(
                "library profile record account_id does not match account ({})",
                path.display()
            ));
        }
        if record.origin != origin {
            return Err(format!(
                "library profile record origin `{}` does not match its `{origin}` directory ({})",
                record.origin,
                path.display()
            ));
        }
        if record.profile.profile_id != expected_id {
            return Err(format!(
                "library profile record profileId does not match its file name ({})",
                path.display()
            ));
        }
        validate_library_ai_profile_payload(&record.profile, &expected_id)?;
        scanned.push(ScannedLibraryProfile {
            record,
            relative_path: format!("{origin}/{file_name}"),
        });
    }
    scanned.sort_by(|left, right| {
        left.record
            .profile
            .profile_id
            .cmp(&right.record.profile.profile_id)
    });
    Ok(scanned)
}

/// Read the title of the Account Default Profile record for the index row.
///
/// The Account Default Profile is owned by `account_profile_library.rs`; this
/// module only reads its `displayName` to project the non-removable index row.
/// Returns `None` when `default.json` does not exist yet.
fn read_account_default_index_row(
    data_root: &Path,
    account_id: &str,
) -> Result<Option<LibraryIndexEntry>, String> {
    let path =
        account_profile_library_dir(data_root, account_id)?.join(ACCOUNT_DEFAULT_PROFILE_FILE);
    if !path.exists() {
        return Ok(None);
    }
    let raw = fs::read_to_string(&path).map_err(|error| {
        format!(
            "Account Default Profile record is unreadable ({}): {error}",
            path.display()
        )
    })?;
    let value = serde_json::from_str::<serde_json::Value>(&raw).map_err(|error| {
        format!(
            "Account Default Profile record cannot be parsed ({}): {error}",
            path.display()
        )
    })?;
    let display_name = value
        .get("displayName")
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("Default Profile")
        .to_string();
    let updated_at = value
        .get("updatedAt")
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("")
        .to_string();
    Ok(Some(LibraryIndexEntry {
        profile_id: ACCOUNT_DEFAULT_PROFILE_ID.to_string(),
        title: display_name,
        origin: LIBRARY_ORIGIN_ACCOUNT_DEFAULT.to_string(),
        relative_path: ACCOUNT_DEFAULT_PROFILE_FILE.to_string(),
        // The Account Default Profile is editable through its own owner module,
        // but it is NOT editable or removable through THIS library module.
        editable: false,
        removable: false,
        updated_at,
    }))
}

/// Derive the full account profile library projection from the file family on
/// disk and re-commit `index.json`. The index is always re-derived — it is a
/// deterministic projection of the file family, never hand-maintained.
fn derive_and_commit_library_projection(
    data_root: &Path,
    account_id: &str,
) -> Result<AccountProfileLibraryProjection, String> {
    let normalized_account = validate_account_id(account_id)?;
    let library_dir = account_profile_library_dir(data_root, &normalized_account)?;

    let user_profiles = scan_origin_directory(data_root, &normalized_account, LIBRARY_ORIGIN_USER)?;
    let imported_profiles =
        scan_origin_directory(data_root, &normalized_account, LIBRARY_ORIGIN_IMPORTED)?;

    let mut entries: Vec<LibraryIndexEntry> = Vec::new();
    if let Some(default_entry) = read_account_default_index_row(data_root, &normalized_account)? {
        entries.push(default_entry);
    }
    let mut projections: Vec<LibraryProfileProjection> = Vec::new();
    for scanned in user_profiles.iter().chain(imported_profiles.iter()) {
        entries.push(LibraryIndexEntry {
            profile_id: scanned.record.profile.profile_id.clone(),
            title: scanned.record.profile.title.clone(),
            origin: scanned.record.origin.clone(),
            relative_path: scanned.relative_path.clone(),
            editable: true,
            removable: true,
            updated_at: scanned.record.updated_at.clone(),
        });
        projections.push(LibraryProfileProjection {
            profile_id: scanned.record.profile.profile_id.clone(),
            origin: scanned.record.origin.clone(),
            editable: true,
            removable: true,
            created_at: scanned.record.created_at.clone(),
            updated_at: scanned.record.updated_at.clone(),
            profile: scanned.record.profile.clone(),
        });
    }

    let index = LibraryIndexRecord {
        schema_version: LIBRARY_INDEX_SCHEMA_VERSION,
        account_id: normalized_account.clone(),
        updated_at: now_iso_timestamp(),
        entries,
    };
    write_json_atomic(
        &library_index_path(data_root, &normalized_account)?,
        &index,
        "account profile library index",
    )?;

    Ok(AccountProfileLibraryProjection {
        account_id: normalized_account,
        library_path: library_dir.display().to_string(),
        index,
        profiles: projections,
    })
}

// ---------------------------------------------------------------------------
// Library operations
// ---------------------------------------------------------------------------

/// List the account profile library: re-derive `index.json` from disk and
/// return the index plus every editable library profile payload.
pub fn list_account_profile_library(
    data_root: &Path,
    account_id: &str,
) -> Result<AccountProfileLibraryProjection, String> {
    derive_and_commit_library_projection(data_root, account_id)
}

/// Resolve the on-disk record path of an existing editable library profile by
/// scanning both `user/` and `imported/`. Fails closed when the id is not found
/// in either editable origin.
fn locate_editable_profile(
    data_root: &Path,
    account_id: &str,
    profile_id: &str,
) -> Result<(String, PathBuf), String> {
    let normalized_id = validate_library_profile_id(profile_id)?;
    for origin in [LIBRARY_ORIGIN_USER, LIBRARY_ORIGIN_IMPORTED] {
        let path = library_profile_path(data_root, account_id, origin, &normalized_id)?;
        if path.exists() {
            return Ok((origin.to_string(), path));
        }
    }
    Err(format!(
        "library profile `{normalized_id}` was not found in the editable account profile library"
    ))
}

/// Create a new user-authored library profile under `user/`.
///
/// Fails closed when the id collides with an existing library profile or with
/// the reserved Account Default Profile id.
pub fn create_account_profile_library_entry(
    data_root: &Path,
    account_id: &str,
    profile: LibraryAIProfilePayload,
) -> Result<AccountProfileLibraryProjection, String> {
    let normalized_account = validate_account_id(account_id)?;
    let normalized_id = validate_library_profile_id(&profile.profile_id)?;
    validate_library_ai_profile_payload(&profile, &normalized_id)?;
    if locate_editable_profile(data_root, &normalized_account, &normalized_id).is_ok() {
        return Err(format!(
            "library profile `{normalized_id}` already exists; edit it instead of recreating"
        ));
    }
    let now = now_iso_timestamp();
    let record = LibraryProfileRecord {
        schema_version: LIBRARY_ENTRY_SCHEMA_VERSION,
        account_id: normalized_account.clone(),
        origin: LIBRARY_ORIGIN_USER.to_string(),
        profile,
        created_at: now.clone(),
        updated_at: now,
    };
    let path = library_profile_path(
        data_root,
        &normalized_account,
        LIBRARY_ORIGIN_USER,
        &normalized_id,
    )?;
    write_json_atomic(&path, &record, "library profile record")?;
    derive_and_commit_library_projection(data_root, &normalized_account)
}

/// Edit an existing editable library profile in place. The profile keeps its
/// origin (`user/` or `imported/`) and its `createdAt`; `updatedAt` advances.
///
/// The Account Default Profile (`default` id) is never editable through this
/// module — it has its own owner.
pub fn edit_account_profile_library_entry(
    data_root: &Path,
    account_id: &str,
    profile: LibraryAIProfilePayload,
) -> Result<AccountProfileLibraryProjection, String> {
    let normalized_account = validate_account_id(account_id)?;
    let normalized_id = validate_library_profile_id(&profile.profile_id)?;
    validate_library_ai_profile_payload(&profile, &normalized_id)?;
    let (origin, path) = locate_editable_profile(data_root, &normalized_account, &normalized_id)?;
    let existing = read_library_profile_record(&path)?;
    let record = LibraryProfileRecord {
        schema_version: LIBRARY_ENTRY_SCHEMA_VERSION,
        account_id: normalized_account.clone(),
        origin,
        profile,
        created_at: existing.created_at,
        updated_at: now_iso_timestamp(),
    };
    write_json_atomic(&path, &record, "library profile record")?;
    derive_and_commit_library_projection(data_root, &normalized_account)
}

/// Import one or more profiles into the library `imported/` directory.
///
/// Each candidate is validated against the static AIProfile schema. A candidate
/// whose id collides with an existing library profile or with the reserved
/// Account Default Profile id is rejected. The whole import fails closed if any
/// candidate is invalid — no partial pseudo-success.
pub fn import_account_profile_library_entries(
    data_root: &Path,
    account_id: &str,
    profiles: Vec<LibraryAIProfilePayload>,
) -> Result<AccountProfileLibraryProjection, String> {
    let normalized_account = validate_account_id(account_id)?;
    if profiles.is_empty() {
        return Err("import requires at least one profile".to_string());
    }
    let mut validated: Vec<(String, LibraryAIProfilePayload)> = Vec::with_capacity(profiles.len());
    let mut seen_ids: Vec<String> = Vec::new();
    for profile in profiles {
        let normalized_id = validate_library_profile_id(&profile.profile_id)?;
        validate_library_ai_profile_payload(&profile, &normalized_id)?;
        if seen_ids.contains(&normalized_id) {
            return Err(format!(
                "import payload has a duplicate profile id `{normalized_id}`"
            ));
        }
        if locate_editable_profile(data_root, &normalized_account, &normalized_id).is_ok() {
            return Err(format!(
                "library profile `{normalized_id}` already exists; cannot import over it"
            ));
        }
        seen_ids.push(normalized_id.clone());
        validated.push((normalized_id, profile));
    }
    let now = now_iso_timestamp();
    for (normalized_id, profile) in validated {
        let record = LibraryProfileRecord {
            schema_version: LIBRARY_ENTRY_SCHEMA_VERSION,
            account_id: normalized_account.clone(),
            origin: LIBRARY_ORIGIN_IMPORTED.to_string(),
            profile,
            created_at: now.clone(),
            updated_at: now.clone(),
        };
        let path = library_profile_path(
            data_root,
            &normalized_account,
            LIBRARY_ORIGIN_IMPORTED,
            &normalized_id,
        )?;
        write_json_atomic(&path, &record, "library profile record")?;
    }
    derive_and_commit_library_projection(data_root, &normalized_account)
}

/// Export the editable library profiles as their portable AIProfile payloads.
///
/// When `profile_ids` is empty every editable library profile is exported;
/// otherwise only the requested ids are exported and an unknown id fails
/// closed. The Account Default Profile is never part of this export.
pub fn export_account_profile_library_entries(
    data_root: &Path,
    account_id: &str,
    profile_ids: Vec<String>,
) -> Result<Vec<LibraryAIProfilePayload>, String> {
    let projection = derive_and_commit_library_projection(data_root, account_id)?;
    if profile_ids.is_empty() {
        return Ok(projection
            .profiles
            .into_iter()
            .map(|entry| entry.profile)
            .collect());
    }
    let mut exported: Vec<LibraryAIProfilePayload> = Vec::with_capacity(profile_ids.len());
    for requested in profile_ids {
        let normalized_id = validate_library_profile_id(&requested)?;
        let matched = projection
            .profiles
            .iter()
            .find(|entry| entry.profile_id == normalized_id)
            .ok_or_else(|| format!("library profile `{normalized_id}` was not found for export"))?;
        exported.push(matched.profile.clone());
    }
    Ok(exported)
}

/// Delete an editable library profile. The Account Default Profile (`default`
/// id) is non-removable and can never be deleted through this module.
pub fn delete_account_profile_library_entry(
    data_root: &Path,
    account_id: &str,
    profile_id: &str,
) -> Result<AccountProfileLibraryProjection, String> {
    let normalized_account = validate_account_id(account_id)?;
    let normalized_id = validate_library_profile_id(profile_id)?;
    let (_origin, path) = locate_editable_profile(data_root, &normalized_account, &normalized_id)?;
    fs::remove_file(&path).map_err(|error| {
        format!(
            "delete library profile record failed ({}): {error}",
            path.display()
        )
    })?;
    derive_and_commit_library_projection(data_root, &normalized_account)
}

#[cfg(test)]
mod tests;
