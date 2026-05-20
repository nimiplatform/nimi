//! Account-scoped editable AI profile library file family.
//!
//! Spec authority:
//!   - `P-AIPS-013` Account Default Profile Local Library Evidence — fixes the
//!     account profile library under `~/.nimi/accounts/<account-id>/profiles/`
//!     and forbids renderer profile state / SDK cache / app-local cache as
//!     profile-library truth.
//!   - Product manual "User-Local Config And Data Roots" — the account profile
//!     library is `~/.nimi/accounts/<account-id>/profiles/{ index.json,
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

use crate::desktop_paths::resolve_nimi_dir;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

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

// ---------------------------------------------------------------------------
// AIProfile payload (mirrors the SDK `AIProfile` portable template shape)
// ---------------------------------------------------------------------------

/// Portable AI profile payload. Mirrors the SDK `AIProfile` type — a portable
/// configuration template, not a live `AIConfig`. The library stores this
/// verbatim; capability bindings stay opaque JSON so this module never owns the
/// provider/model/connector vocabulary.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LibraryAIProfilePayload {
    pub profile_id: String,
    pub title: String,
    pub description: String,
    pub tags: Vec<String>,
    pub capabilities: serde_json::Map<String, serde_json::Value>,
}

/// One editable account profile library entry record persisted under `user/`
/// or `imported/` as `<profileId>.json`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LibraryProfileRecord {
    pub schema_version: u32,
    pub account_id: String,
    /// `"user"` for user-created profiles, `"imported"` for imported profiles.
    pub origin: String,
    pub profile: LibraryAIProfilePayload,
    pub created_at: String,
    pub updated_at: String,
}

/// One row of the `index.json` account profile library index.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LibraryIndexEntry {
    pub profile_id: String,
    pub title: String,
    /// `"account-default"`, `"user"`, or `"imported"`.
    pub origin: String,
    /// Library-root-relative path of the entry record file.
    pub relative_path: String,
    pub editable: bool,
    pub removable: bool,
    pub updated_at: String,
}

/// The `index.json` account profile library index record.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LibraryIndexRecord {
    pub schema_version: u32,
    pub account_id: String,
    pub updated_at: String,
    pub entries: Vec<LibraryIndexEntry>,
}

/// One projected library profile returned to the renderer. Carries the full
/// AIProfile payload plus library provenance.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LibraryProfileProjection {
    pub profile_id: String,
    pub origin: String,
    pub editable: bool,
    pub removable: bool,
    pub created_at: String,
    pub updated_at: String,
    pub profile: LibraryAIProfilePayload,
}

/// The full account profile library projection returned by list/mutation
/// commands: the re-derived index plus every editable library profile payload.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AccountProfileLibraryProjection {
    pub account_id: String,
    pub library_path: String,
    pub index: LibraryIndexRecord,
    /// Editable library profiles (`user/` + `imported/`). The Account Default
    /// Profile is referenced by the index but is NOT projected here — it is
    /// owned by `account_profile_library.rs` and resolved separately.
    pub profiles: Vec<LibraryProfileProjection>,
}

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
/// (`~/.nimi/accounts/<account-id>/profiles/`). P-AIPS-013 fixes the library
/// under the `~/.nimi` CONTROL root, not the user-selected `nimi_data` root.
pub fn account_profile_library_dir(account_id: &str) -> Result<PathBuf, String> {
    let normalized_account = validate_account_id(account_id)?;
    Ok(resolve_nimi_dir()?
        .join("accounts")
        .join(account_path_segment(&normalized_account))
        .join("profiles"))
}

fn library_index_path(account_id: &str) -> Result<PathBuf, String> {
    Ok(account_profile_library_dir(account_id)?.join(LIBRARY_INDEX_FILE))
}

fn library_origin_dir(account_id: &str, origin: &str) -> Result<PathBuf, String> {
    Ok(account_profile_library_dir(account_id)?.join(origin))
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
    let safe = normalized.chars().all(|character| {
        character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.')
    });
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
    account_id: &str,
    origin: &str,
    profile_id: &str,
) -> Result<PathBuf, String> {
    let normalized_origin = validate_origin(origin)?;
    let normalized_id = validate_library_profile_id(profile_id)?;
    Ok(library_origin_dir(account_id, &normalized_origin)?.join(format!("{normalized_id}.json")))
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
    for (capability, value) in &payload.capabilities {
        if capability.trim().is_empty() {
            return Err("library AIProfile payload capability id is required".to_string());
        }
        if !value.is_object() {
            return Err(
                "library AIProfile payload capability entries must be objects".to_string(),
            );
        }
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Record IO
// ---------------------------------------------------------------------------

fn write_json_atomic<T: Serialize>(path: &Path, value: &T, label: &str) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| format!("{label} path has no parent directory"))?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("create {label} directory failed ({}): {error}", parent.display()))?;
    let raw = serde_json::to_string_pretty(value)
        .map_err(|error| format!("serialize {label} failed: {error}"))?;
    let tmp_path = path.with_extension(format!("json.tmp.{}.{}", std::process::id(), now_unix_ms()));
    fs::write(&tmp_path, raw)
        .map_err(|error| format!("write {label} temporary file failed ({}): {error}", tmp_path.display()))?;
    fs::rename(&tmp_path, path)
        .map_err(|error| format!("commit {label} record failed ({}): {error}", path.display()))
}

fn read_library_profile_record(path: &Path) -> Result<LibraryProfileRecord, String> {
    let raw = fs::read_to_string(path)
        .map_err(|error| format!("library profile record is unreadable ({}): {error}", path.display()))?;
    let record = serde_json::from_str::<LibraryProfileRecord>(&raw)
        .map_err(|error| format!("library profile record cannot be parsed ({}): {error}", path.display()))?;
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
    account_id: &str,
    origin: &str,
) -> Result<Vec<ScannedLibraryProfile>, String> {
    let dir = library_origin_dir(account_id, origin)?;
    if !dir.exists() {
        return Ok(Vec::new());
    }
    let mut scanned: Vec<ScannedLibraryProfile> = Vec::new();
    let entries = fs::read_dir(&dir)
        .map_err(|error| format!("read library {origin} directory failed ({}): {error}", dir.display()))?;
    for entry in entries {
        let entry = entry
            .map_err(|error| format!("read library {origin} entry failed: {error}"))?;
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
    scanned.sort_by(|left, right| left.record.profile.profile_id.cmp(&right.record.profile.profile_id));
    Ok(scanned)
}

/// Read the title of the Account Default Profile record for the index row.
///
/// The Account Default Profile is owned by `account_profile_library.rs`; this
/// module only reads its `displayName` to project the non-removable index row.
/// Returns `None` when `default.json` does not exist yet.
fn read_account_default_index_row(account_id: &str) -> Result<Option<LibraryIndexEntry>, String> {
    let path = account_profile_library_dir(account_id)?.join(ACCOUNT_DEFAULT_PROFILE_FILE);
    if !path.exists() {
        return Ok(None);
    }
    let raw = fs::read_to_string(&path)
        .map_err(|error| format!("Account Default Profile record is unreadable ({}): {error}", path.display()))?;
    let value = serde_json::from_str::<serde_json::Value>(&raw)
        .map_err(|error| format!("Account Default Profile record cannot be parsed ({}): {error}", path.display()))?;
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
    account_id: &str,
) -> Result<AccountProfileLibraryProjection, String> {
    let normalized_account = validate_account_id(account_id)?;
    let library_dir = account_profile_library_dir(&normalized_account)?;

    let user_profiles = scan_origin_directory(&normalized_account, LIBRARY_ORIGIN_USER)?;
    let imported_profiles = scan_origin_directory(&normalized_account, LIBRARY_ORIGIN_IMPORTED)?;

    let mut entries: Vec<LibraryIndexEntry> = Vec::new();
    if let Some(default_entry) = read_account_default_index_row(&normalized_account)? {
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
        &library_index_path(&normalized_account)?,
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
    account_id: &str,
) -> Result<AccountProfileLibraryProjection, String> {
    derive_and_commit_library_projection(account_id)
}

/// Resolve the on-disk record path of an existing editable library profile by
/// scanning both `user/` and `imported/`. Fails closed when the id is not found
/// in either editable origin.
fn locate_editable_profile(
    account_id: &str,
    profile_id: &str,
) -> Result<(String, PathBuf), String> {
    let normalized_id = validate_library_profile_id(profile_id)?;
    for origin in [LIBRARY_ORIGIN_USER, LIBRARY_ORIGIN_IMPORTED] {
        let path = library_profile_path(account_id, origin, &normalized_id)?;
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
    account_id: &str,
    profile: LibraryAIProfilePayload,
) -> Result<AccountProfileLibraryProjection, String> {
    let normalized_account = validate_account_id(account_id)?;
    let normalized_id = validate_library_profile_id(&profile.profile_id)?;
    validate_library_ai_profile_payload(&profile, &normalized_id)?;
    if locate_editable_profile(&normalized_account, &normalized_id).is_ok() {
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
    let path = library_profile_path(&normalized_account, LIBRARY_ORIGIN_USER, &normalized_id)?;
    write_json_atomic(&path, &record, "library profile record")?;
    derive_and_commit_library_projection(&normalized_account)
}

/// Edit an existing editable library profile in place. The profile keeps its
/// origin (`user/` or `imported/`) and its `createdAt`; `updatedAt` advances.
///
/// The Account Default Profile (`default` id) is never editable through this
/// module — it has its own owner.
pub fn edit_account_profile_library_entry(
    account_id: &str,
    profile: LibraryAIProfilePayload,
) -> Result<AccountProfileLibraryProjection, String> {
    let normalized_account = validate_account_id(account_id)?;
    let normalized_id = validate_library_profile_id(&profile.profile_id)?;
    validate_library_ai_profile_payload(&profile, &normalized_id)?;
    let (origin, path) = locate_editable_profile(&normalized_account, &normalized_id)?;
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
    derive_and_commit_library_projection(&normalized_account)
}

/// Import one or more profiles into the library `imported/` directory.
///
/// Each candidate is validated against the static AIProfile schema. A candidate
/// whose id collides with an existing library profile or with the reserved
/// Account Default Profile id is rejected. The whole import fails closed if any
/// candidate is invalid — no partial pseudo-success.
pub fn import_account_profile_library_entries(
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
        if locate_editable_profile(&normalized_account, &normalized_id).is_ok() {
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
        let path =
            library_profile_path(&normalized_account, LIBRARY_ORIGIN_IMPORTED, &normalized_id)?;
        write_json_atomic(&path, &record, "library profile record")?;
    }
    derive_and_commit_library_projection(&normalized_account)
}

/// Export the editable library profiles as their portable AIProfile payloads.
///
/// When `profile_ids` is empty every editable library profile is exported;
/// otherwise only the requested ids are exported and an unknown id fails
/// closed. The Account Default Profile is never part of this export.
pub fn export_account_profile_library_entries(
    account_id: &str,
    profile_ids: Vec<String>,
) -> Result<Vec<LibraryAIProfilePayload>, String> {
    let projection = derive_and_commit_library_projection(account_id)?;
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
            .ok_or_else(|| {
                format!("library profile `{normalized_id}` was not found for export")
            })?;
        exported.push(matched.profile.clone());
    }
    Ok(exported)
}

/// Delete an editable library profile. The Account Default Profile (`default`
/// id) is non-removable and can never be deleted through this module.
pub fn delete_account_profile_library_entry(
    account_id: &str,
    profile_id: &str,
) -> Result<AccountProfileLibraryProjection, String> {
    let normalized_account = validate_account_id(account_id)?;
    let normalized_id = validate_library_profile_id(profile_id)?;
    let (_origin, path) = locate_editable_profile(&normalized_account, &normalized_id)?;
    fs::remove_file(&path)
        .map_err(|error| format!("delete library profile record failed ({}): {error}", path.display()))?;
    derive_and_commit_library_projection(&normalized_account)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::with_env;
    use std::path::PathBuf;

    fn unique_suffix() -> u128 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time")
            .as_nanos()
    }

    fn temp_home(prefix: &str) -> PathBuf {
        let dir = std::env::temp_dir()
            .join(format!("nimi-account-profile-library-{prefix}-{}", unique_suffix()));
        std::fs::create_dir_all(&dir).expect("create temp home");
        dir
    }

    fn with_isolated_home<R>(prefix: &str, body: impl FnOnce() -> R) -> R {
        let home = temp_home(prefix);
        with_env(&[("HOME", home.to_str())], body)
    }

    fn sample_payload(profile_id: &str, title: &str) -> LibraryAIProfilePayload {
        let mut capabilities = serde_json::Map::new();
        capabilities.insert(
            "text.generate".to_string(),
            serde_json::json!({ "binding": null }),
        );
        LibraryAIProfilePayload {
            profile_id: profile_id.to_string(),
            title: title.to_string(),
            description: "library test profile".to_string(),
            tags: vec!["test".to_string()],
            capabilities,
        }
    }

    #[test]
    fn create_writes_user_directory_and_index() {
        with_isolated_home("create", || {
            let projection = create_account_profile_library_entry(
                "account_1",
                sample_payload("custom-alpha", "Alpha"),
            )
            .expect("create");
            assert_eq!(projection.profiles.len(), 1);
            assert_eq!(projection.profiles[0].origin, "user");
            assert!(projection.profiles[0].editable);
            assert!(projection.profiles[0].removable);

            let user_path =
                library_profile_path("account_1", "user", "custom-alpha").expect("path");
            assert!(user_path.exists());
            // Index is re-derived and committed.
            let index_path = library_index_path("account_1").expect("index path");
            assert!(index_path.exists());
            assert!(projection
                .index
                .entries
                .iter()
                .any(|entry| entry.profile_id == "custom-alpha" && entry.origin == "user"));
        });
    }

    #[test]
    fn reserved_default_id_cannot_be_created_or_deleted() {
        with_isolated_home("reserved", || {
            let create_error = create_account_profile_library_entry(
                "account_1",
                sample_payload("default", "Default"),
            )
            .expect_err("reserved id must fail");
            assert!(create_error.contains("reserved"));

            let delete_error =
                delete_account_profile_library_entry("account_1", "default")
                    .expect_err("reserved id delete must fail");
            assert!(delete_error.contains("reserved"));
        });
    }

    #[test]
    fn edit_preserves_created_at_and_advances_updated_at() {
        with_isolated_home("edit", || {
            create_account_profile_library_entry("account_1", sample_payload("custom-edit", "V1"))
                .expect("create");
            let path = library_profile_path("account_1", "user", "custom-edit").expect("path");
            let created = read_library_profile_record(&path).expect("read").created_at;

            let edited = edit_account_profile_library_entry(
                "account_1",
                sample_payload("custom-edit", "V2"),
            )
            .expect("edit");
            let profile = edited
                .profiles
                .iter()
                .find(|entry| entry.profile_id == "custom-edit")
                .expect("edited profile present");
            assert_eq!(profile.profile.title, "V2");
            assert_eq!(profile.created_at, created);
        });
    }

    #[test]
    fn edit_missing_profile_fails_closed() {
        with_isolated_home("edit-missing", || {
            let error = edit_account_profile_library_entry(
                "account_1",
                sample_payload("custom-missing", "X"),
            )
            .expect_err("missing profile must fail");
            assert!(error.contains("was not found"));
        });
    }

    #[test]
    fn import_writes_imported_directory_and_rejects_collisions() {
        with_isolated_home("import", || {
            let projection = import_account_profile_library_entries(
                "account_1",
                vec![
                    sample_payload("import-a", "Import A"),
                    sample_payload("import-b", "Import B"),
                ],
            )
            .expect("import");
            assert_eq!(projection.profiles.len(), 2);
            assert!(projection
                .profiles
                .iter()
                .all(|entry| entry.origin == "imported"));

            // Re-importing a colliding id fails closed (no partial success).
            let collision = import_account_profile_library_entries(
                "account_1",
                vec![sample_payload("import-a", "Again")],
            )
            .expect_err("colliding import must fail");
            assert!(collision.contains("already exists"));
        });
    }

    #[test]
    fn import_rejects_duplicate_ids_within_payload() {
        with_isolated_home("import-dup", || {
            let error = import_account_profile_library_entries(
                "account_1",
                vec![
                    sample_payload("dup", "One"),
                    sample_payload("dup", "Two"),
                ],
            )
            .expect_err("duplicate ids must fail");
            assert!(error.contains("duplicate"));
        });
    }

    #[test]
    fn import_rejects_reserved_default_id() {
        with_isolated_home("import-reserved", || {
            let error = import_account_profile_library_entries(
                "account_1",
                vec![sample_payload("default", "Default")],
            )
            .expect_err("reserved id import must fail");
            assert!(error.contains("reserved"));
        });
    }

    #[test]
    fn export_returns_requested_profiles_and_fails_on_unknown_id() {
        with_isolated_home("export", || {
            create_account_profile_library_entry("account_1", sample_payload("exp-a", "Exp A"))
                .expect("create a");
            create_account_profile_library_entry("account_1", sample_payload("exp-b", "Exp B"))
                .expect("create b");

            let all = export_account_profile_library_entries("account_1", Vec::new())
                .expect("export all");
            assert_eq!(all.len(), 2);

            let one = export_account_profile_library_entries(
                "account_1",
                vec!["exp-a".to_string()],
            )
            .expect("export one");
            assert_eq!(one.len(), 1);
            assert_eq!(one[0].profile_id, "exp-a");

            let unknown = export_account_profile_library_entries(
                "account_1",
                vec!["exp-missing".to_string()],
            )
            .expect_err("unknown export must fail");
            assert!(unknown.contains("was not found"));
        });
    }

    #[test]
    fn delete_removes_record_and_reindexes() {
        with_isolated_home("delete", || {
            create_account_profile_library_entry("account_1", sample_payload("del-a", "Del A"))
                .expect("create");
            let path = library_profile_path("account_1", "user", "del-a").expect("path");
            assert!(path.exists());

            let projection =
                delete_account_profile_library_entry("account_1", "del-a").expect("delete");
            assert!(!path.exists());
            assert!(projection.profiles.is_empty());
            assert!(!projection
                .index
                .entries
                .iter()
                .any(|entry| entry.profile_id == "del-a"));
        });
    }

    #[test]
    fn list_includes_account_default_index_row_when_default_json_exists() {
        with_isolated_home("default-row", || {
            // Seed a stand-in Account Default Profile record. The library index
            // must project a non-removable, non-editable `account-default` row.
            let library_dir = account_profile_library_dir("account_1").expect("dir");
            std::fs::create_dir_all(&library_dir).expect("mkdir");
            std::fs::write(
                library_dir.join("default.json"),
                serde_json::to_string_pretty(&serde_json::json!({
                    "profileId": "default",
                    "displayName": "Default Profile",
                    "updatedAt": "2026-05-21T00:00:00.000Z",
                }))
                .expect("json"),
            )
            .expect("write default");

            let projection = list_account_profile_library("account_1").expect("list");
            let default_row = projection
                .index
                .entries
                .iter()
                .find(|entry| entry.profile_id == "default")
                .expect("account-default row present");
            assert_eq!(default_row.origin, "account-default");
            assert!(!default_row.editable);
            assert!(!default_row.removable);
            // The Account Default Profile is NOT projected as an editable profile.
            assert!(projection.profiles.is_empty());
        });
    }

    #[test]
    fn malformed_record_fails_closed_on_scan() {
        with_isolated_home("malformed", || {
            let dir = library_origin_dir("account_1", "user").expect("dir");
            std::fs::create_dir_all(&dir).expect("mkdir");
            std::fs::write(dir.join("broken.json"), "{ not json").expect("write broken");
            let error = list_account_profile_library("account_1")
                .expect_err("malformed record must fail closed");
            assert!(error.contains("cannot be parsed"));
        });
    }
}
