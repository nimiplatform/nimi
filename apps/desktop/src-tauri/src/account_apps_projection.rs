//! `~/.nimi/accounts/<account-id>/apps/library.json` — account app-library
//! projection — and
//! `~/.nimi/accounts/<account-id>/permissions/grants.json` — permission/grant
//! projection.
//!
//! Product owners (product manual):
//! - `library.json`: account app-library projection.
//! - `grants.json`: permission/grant projection consumer. The canonical
//!   permission/grant authority is the deferred wave-4 permission fabric
//!   (`permission_scope_ref` is `pending_wave_4` in the registry table). T4
//!   owns only the projection schema + a fail-closed reader (T4 Fork B). This
//!   module does NOT implement a canonical grant service; it reads a projection
//!   and fails closed when it is stale, missing, or inconsistent.
//!
//! Both files are account-scoped, fixed under the `~/.nimi` CONTROL root. The
//! account id is percent-encoded into the directory segment, mirroring the
//! Account Default Profile library encoding (`account_profile_library.rs`).
//!
//! T4-W1 scope: schemas + fail-closed readers. The library/launch lifecycle
//! writes are T4-W2; this wave does not implement enable/disable/open mutation.

use crate::desktop_paths::resolve_nimi_dir;
use nimi_shell_tauri::governed_config::{
    read_governed_config, ConfigReadOutcome, GovernedConfigFile,
};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// Supported `library.json` schema version. Any other version fails closed to
/// typed repair through the current-schema framework.
pub const ACCOUNT_APP_LIBRARY_SCHEMA_VERSION: u32 = 1;

/// Supported `grants.json` schema version.
pub const ACCOUNT_GRANTS_SCHEMA_VERSION: u32 = 1;

/// Governed config-file identity for the account app-library projection
/// (`local-config-file-registry.yaml` row `library_json`).
const LIBRARY_CONFIG_FILE: GovernedConfigFile = GovernedConfigFile::new(
    "library_json",
    "~/.nimi/accounts/<account-id>/apps/library.json",
    ACCOUNT_APP_LIBRARY_SCHEMA_VERSION,
);

/// Governed config-file identity for the permission/grant projection
/// (`local-config-file-registry.yaml` row `grants_json`).
const GRANTS_CONFIG_FILE: GovernedConfigFile = GovernedConfigFile::new(
    "grants_json",
    "~/.nimi/accounts/<account-id>/permissions/grants.json",
    ACCOUNT_GRANTS_SCHEMA_VERSION,
);

/// Closed account app-library `libraryState` vocabulary.
const LIBRARY_STATE_ENABLED: &str = "enabled";
const LIBRARY_STATE_DISABLED: &str = "disabled";
const LIBRARY_STATE_REMOVED: &str = "removed";

/// Closed app-data retention policy vocabulary.
const DATA_POLICY_KEEP_ON_UNINSTALL: &str = "keep_on_uninstall";
const DATA_POLICY_DELETE_ON_UNINSTALL: &str = "delete_on_uninstall";

/// Closed grant `state` vocabulary.
const GRANT_STATE_GRANTED: &str = "granted";
const GRANT_STATE_DENIED: &str = "denied";
const GRANT_STATE_PENDING: &str = "pending";
const GRANT_STATE_EXPIRED: &str = "expired";
const GRANT_STATE_REVOKED: &str = "revoked";

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

/// Percent-encode an account id into a safe directory segment. Mirrors the
/// encoding used by `account_profile_library.rs`.
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

// === Account app-library projection (`library.json`) ===

/// One projected account app-library row. Minimum product fields fixed by the
/// manual: `appId, libraryState, installed, lastOpenedAt, dataPolicy`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AccountAppLibraryRow {
    pub app_id: String,
    pub library_state: String,
    pub installed: bool,
    pub last_opened_at: Option<String>,
    pub data_policy: String,
}

/// `~/.nimi/accounts/<account-id>/apps/library.json` record shape.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AccountAppLibraryRecord {
    pub schema_version: u32,
    pub account_id: String,
    pub updated_at: String,
    pub apps: Vec<AccountAppLibraryRow>,
}

/// On-disk path of an account's app-library projection.
pub fn account_app_library_path(account_id: &str) -> Result<PathBuf, String> {
    let normalized = validate_account_id(account_id)?;
    Ok(resolve_nimi_dir()?
        .join("accounts")
        .join(account_path_segment(&normalized))
        .join("apps")
        .join("library.json"))
}

fn validate_app_library_record(
    record: &AccountAppLibraryRecord,
    account_id: &str,
) -> Result<(), String> {
    if record.schema_version != ACCOUNT_APP_LIBRARY_SCHEMA_VERSION {
        return Err(format!(
            "unsupported library.json schemaVersion={} expected={ACCOUNT_APP_LIBRARY_SCHEMA_VERSION}",
            record.schema_version
        ));
    }
    if record.account_id != account_id {
        return Err(
            "library.json accountId does not match the authenticated Runtime account".to_string(),
        );
    }
    if record.updated_at.trim().is_empty() {
        return Err("library.json updatedAt is required".to_string());
    }
    for app in &record.apps {
        if app.app_id.trim().is_empty() {
            return Err("library.json app row requires appId".to_string());
        }
        if !matches!(
            app.library_state.as_str(),
            LIBRARY_STATE_ENABLED | LIBRARY_STATE_DISABLED | LIBRARY_STATE_REMOVED
        ) {
            return Err(format!(
                "library.json app row {} has an unknown libraryState: {}",
                app.app_id, app.library_state
            ));
        }
        if !matches!(
            app.data_policy.as_str(),
            DATA_POLICY_KEEP_ON_UNINSTALL | DATA_POLICY_DELETE_ON_UNINSTALL
        ) {
            return Err(format!(
                "library.json app row {} has an unknown dataPolicy: {}",
                app.app_id, app.data_policy
            ));
        }
        if app
            .last_opened_at
            .as_deref()
            .is_some_and(|value| value.trim().is_empty())
        {
            return Err(format!(
                "library.json app row {} lastOpenedAt must be omitted or a non-empty timestamp",
                app.app_id
            ));
        }
    }
    Ok(())
}

/// Read the account app-library projection through the shared `~/.nimi`
/// current-schema repair framework.
///
/// Routes a parse failure, a missing / unknown `schemaVersion`, an account-id
/// mismatch, or a structural fault to a typed `ConfigReadOutcome::Repair`
/// (`P-MIG-004`) instead of a raw `Err`. `ConfigReadOutcome::Absent` means the
/// projection has not been written yet (the account app-library lifecycle is
/// T4-W2).
pub fn read_account_app_library_governed(
    account_id: &str,
) -> Result<ConfigReadOutcome<AccountAppLibraryRecord>, String> {
    let normalized = validate_account_id(account_id)?;
    let path = account_app_library_path(&normalized)?;
    read_governed_config(&LIBRARY_CONFIG_FILE, &path, |document| {
        let record: AccountAppLibraryRecord = serde_json::from_value(document.clone())
            .map_err(|error| format!("library.json cannot be deserialized: {error}"))?;
        validate_app_library_record(&record, &normalized)?;
        Ok(record)
    })
}

/// Read the account app-library projection, if present.
///
/// Thin presence-shaped adapter over [`read_account_app_library_governed`]: a
/// routed repair state is surfaced as the typed repair reason; `Absent` maps
/// to `Ok(None)`.
pub fn read_account_app_library(
    account_id: &str,
) -> Result<Option<AccountAppLibraryRecord>, String> {
    match read_account_app_library_governed(account_id)? {
        ConfigReadOutcome::Absent => Ok(None),
        ConfigReadOutcome::Ready(record) => Ok(Some(record)),
        ConfigReadOutcome::Repair { reason, .. } => Err(reason),
    }
}

// === Account app-library projection writer (T4-W4) ===
//
// T4-W4 Fork D (D1): the desktop Tauri layer owns the `library.json` writer.
// `library.json` is an account-scoped display/launch-preference projection; it
// is mutated on install / uninstall (here) and on open (`lastOpenedAt`, the
// app-launch wave). The writer is fail-closed: it routes through the same
// governed read so a corrupt / unknown-version / account-mismatched file is a
// typed repair, never silently overwritten.

/// The library mutation a lifecycle terminal event applies.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AccountAppLibraryMutation {
    /// A terminal `installed` job: the app is installed and enabled in the
    /// account library. The data-retention policy defaults to keep-on-uninstall
    /// (manual `#### Uninstall And Data`).
    InstalledEnabled,
    /// A terminal `uninstalled` job that removed the release only: the package
    /// is no longer installed, but the account library record is kept (the app
    /// stays in the library, just not installed) per manual `#### Uninstall And
    /// Data` ("keep account library record unless user explicitly removes").
    UninstalledKeepRecord,
    /// A confirmed destructive "Delete app data" flow: the app is removed from
    /// the account library entirely (`libraryState = removed`).
    RemovedFromLibrary,
}

/// Build an empty, valid library record for an account that has none yet.
fn empty_app_library_record(account_id: &str) -> AccountAppLibraryRecord {
    AccountAppLibraryRecord {
        schema_version: ACCOUNT_APP_LIBRARY_SCHEMA_VERSION,
        account_id: account_id.to_string(),
        updated_at: now_app_iso_timestamp(),
        apps: Vec::new(),
    }
}

fn now_app_iso_timestamp() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

/// Atomically write the account app-library record (temp-file + rename).
fn write_app_library_record(
    path: &std::path::Path,
    record: &AccountAppLibraryRecord,
) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "library.json path has no parent directory".to_string())?;
    std::fs::create_dir_all(parent).map_err(|error| {
        format!(
            "create library.json directory failed ({}): {error}",
            parent.display()
        )
    })?;
    let raw = serde_json::to_string_pretty(record)
        .map_err(|error| format!("serialize library.json failed: {error}"))?;
    let tmp_path = path.with_extension(format!(
        "json.tmp.{}.{}",
        std::process::id(),
        chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default()
    ));
    std::fs::write(&tmp_path, raw).map_err(|error| {
        format!(
            "write library.json temporary file failed ({}): {error}",
            tmp_path.display()
        )
    })?;
    std::fs::rename(&tmp_path, path).map_err(|error| {
        format!(
            "commit library.json record failed ({}): {error}",
            path.display()
        )
    })
}

/// Apply a lifecycle mutation to one app row in an account's `library.json`.
///
/// Fail-closed: the existing file is read through the governed reader, so a
/// corrupt / unknown-version / account-mismatched file routes to a typed
/// repair `Err` and is NOT overwritten. An absent file is treated as an empty
/// library and a fresh record is written. The mutation is idempotent — the
/// same install/uninstall event applied twice converges to the same row.
///
/// Returns the committed record.
pub fn apply_account_app_library_mutation(
    account_id: &str,
    app_id: &str,
    mutation: AccountAppLibraryMutation,
) -> Result<AccountAppLibraryRecord, String> {
    let normalized_account = validate_account_id(account_id)?;
    let normalized_app = app_id.trim();
    if normalized_app.is_empty() {
        return Err("library.json mutation requires a non-empty appId".to_string());
    }
    let path = account_app_library_path(&normalized_account)?;

    // Fail-closed read of the current record. `Absent` -> fresh empty record;
    // `Repair` -> typed Err (never overwrite a faulted file).
    let mut record = match read_account_app_library_governed(&normalized_account)? {
        ConfigReadOutcome::Absent => empty_app_library_record(&normalized_account),
        ConfigReadOutcome::Ready(existing) => existing,
        ConfigReadOutcome::Repair { reason, .. } => return Err(reason),
    };

    let existing = record
        .apps
        .iter_mut()
        .find(|row| row.app_id == normalized_app);

    match mutation {
        AccountAppLibraryMutation::InstalledEnabled => {
            if let Some(row) = existing {
                row.library_state = LIBRARY_STATE_ENABLED.to_string();
                row.installed = true;
            } else {
                record.apps.push(AccountAppLibraryRow {
                    app_id: normalized_app.to_string(),
                    library_state: LIBRARY_STATE_ENABLED.to_string(),
                    installed: true,
                    last_opened_at: None,
                    // Default retention: keep durable data on uninstall.
                    data_policy: DATA_POLICY_KEEP_ON_UNINSTALL.to_string(),
                });
            }
        }
        AccountAppLibraryMutation::UninstalledKeepRecord => {
            if let Some(row) = existing {
                // Package removed; the library record is kept. The app stays
                // in the library (enabled vocabulary keeps it visible), just
                // not installed.
                row.installed = false;
            }
            // An uninstall of an app with no library row is a no-op — there is
            // no record to keep.
        }
        AccountAppLibraryMutation::RemovedFromLibrary => {
            if let Some(row) = existing {
                row.library_state = LIBRARY_STATE_REMOVED.to_string();
                row.installed = false;
            }
        }
    }

    record.updated_at = now_app_iso_timestamp();
    // Validate the mutated record before committing — a write must never
    // produce a file the governed reader would reject.
    validate_app_library_record(&record, &normalized_account)?;
    write_app_library_record(&path, &record)?;
    Ok(record)
}

// === Permission/grant projection (`grants.json`) ===

/// One projected permission/grant row. Minimum product fields fixed by the
/// manual: `grantId, subject, scope, state, createdAt, expiresAt`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AccountGrantRow {
    pub grant_id: String,
    pub subject: String,
    pub scope: String,
    pub state: String,
    pub created_at: String,
    pub expires_at: Option<String>,
}

/// `~/.nimi/accounts/<account-id>/permissions/grants.json` record shape.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AccountGrantsRecord {
    pub schema_version: u32,
    pub account_id: String,
    pub updated_at: String,
    pub grants: Vec<AccountGrantRow>,
}

/// On-disk path of an account's permission/grant projection.
pub fn account_grants_path(account_id: &str) -> Result<PathBuf, String> {
    let normalized = validate_account_id(account_id)?;
    Ok(resolve_nimi_dir()?
        .join("accounts")
        .join(account_path_segment(&normalized))
        .join("permissions")
        .join("grants.json"))
}

fn validate_grants_record(record: &AccountGrantsRecord, account_id: &str) -> Result<(), String> {
    if record.schema_version != ACCOUNT_GRANTS_SCHEMA_VERSION {
        return Err(format!(
            "unsupported grants.json schemaVersion={} expected={ACCOUNT_GRANTS_SCHEMA_VERSION}",
            record.schema_version
        ));
    }
    if record.account_id != account_id {
        return Err(
            "grants.json accountId does not match the authenticated Runtime account".to_string(),
        );
    }
    if record.updated_at.trim().is_empty() {
        return Err("grants.json updatedAt is required".to_string());
    }
    for grant in &record.grants {
        if grant.grant_id.trim().is_empty()
            || grant.subject.trim().is_empty()
            || grant.scope.trim().is_empty()
            || grant.created_at.trim().is_empty()
        {
            return Err(
                "grants.json grant row requires grantId, subject, scope, and createdAt".to_string(),
            );
        }
        if !matches!(
            grant.state.as_str(),
            GRANT_STATE_GRANTED
                | GRANT_STATE_DENIED
                | GRANT_STATE_PENDING
                | GRANT_STATE_EXPIRED
                | GRANT_STATE_REVOKED
        ) {
            return Err(format!(
                "grants.json grant row {} has an unknown state: {}",
                grant.grant_id, grant.state
            ));
        }
        if grant
            .expires_at
            .as_deref()
            .is_some_and(|value| value.trim().is_empty())
        {
            return Err(format!(
                "grants.json grant row {} expiresAt must be omitted or a non-empty timestamp",
                grant.grant_id
            ));
        }
    }
    Ok(())
}

/// The result of a fail-closed grant projection read.
///
/// The canonical permission/grant authority is the deferred wave-4 permission
/// fabric. This reader never asserts a grant is valid — it only projects what
/// the local cache file says, and fails closed (`Err`) when the file is
/// missing, unparseable, schema-incompatible, account-mismatched, or carries a
/// grant that is already expired by the wall clock. A consumer that cannot get
/// an `Ok` projection must treat the grant surface as not satisfied.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountGrantsProjection {
    pub account_id: String,
    pub grants: Vec<AccountGrantRow>,
}

/// Structural + staleness validation of a grants record.
///
/// `schemaVersion` fail-closed / migration routing is owned by the
/// shared governed-config framework; this checks the account-id binding,
/// per-row structure, and the wall-clock staleness invariant (an already-
/// expired `granted` row makes the whole projection stale). A failure routes
/// the read to `repair_required`.
fn validate_grants_record_freshness(
    record: &AccountGrantsRecord,
    account_id: &str,
) -> Result<(), String> {
    validate_grants_record(record, account_id)?;
    let now = chrono::Utc::now();
    for grant in &record.grants {
        if grant.state != GRANT_STATE_GRANTED {
            continue;
        }
        if let Some(expires_at) = grant.expires_at.as_deref() {
            let parsed = chrono::DateTime::parse_from_rfc3339(expires_at).map_err(|error| {
                format!(
                    "grants.json grant {} has an unparseable expiresAt: {error}",
                    grant.grant_id
                )
            })?;
            if parsed.with_timezone(&chrono::Utc) <= now {
                return Err(format!(
                    "grants.json grant {} is expired; the permission projection is stale and fails closed",
                    grant.grant_id
                ));
            }
        }
    }
    Ok(())
}

/// Read the permission/grant projection through the shared `~/.nimi` migration
/// / repair framework.
///
/// Routes a parse failure, a missing / unknown `schemaVersion`, an account-id
/// mismatch, a structural fault, or a stale (expired) grant to a typed
/// `ConfigReadOutcome::Repair` (`P-MIG-004`). `ConfigReadOutcome::Absent`
/// means the projection cache has never been written — the caller maps that to
/// the T4-owned fail-closed permission semantic
/// (see [`read_account_grants_fail_closed`]).
#[allow(dead_code)]
pub fn read_account_grants_governed(
    account_id: &str,
) -> Result<ConfigReadOutcome<AccountGrantsProjection>, String> {
    let normalized = validate_account_id(account_id)?;
    let path = account_grants_path(&normalized)?;
    read_governed_config(&GRANTS_CONFIG_FILE, &path, |document| {
        let record: AccountGrantsRecord = serde_json::from_value(document.clone())
            .map_err(|error| format!("grants.json cannot be deserialized: {error}"))?;
        validate_grants_record_freshness(&record, &normalized)?;
        Ok(AccountGrantsProjection {
            account_id: record.account_id,
            grants: record.grants,
        })
    })
}

/// Read the permission/grant projection for an account, failing closed.
///
/// Returns `Err` when the projection is absent, faulted, account-mismatched, or
/// stale. The framework distinguishes `Absent` from a routed repair state;
/// this reader applies the T4-owned permission semantic that a *missing*
/// grants projection is itself a fail-closed condition (the permission surface
/// is not satisfied), so both `Absent` and `Repair` collapse to `Err` here.
///
/// This is a projection reader only. It does not mint, refresh, or revoke
/// grants — the canonical grant authority is the deferred wave-4 fabric.
#[allow(dead_code)]
pub fn read_account_grants_fail_closed(
    account_id: &str,
) -> Result<AccountGrantsProjection, String> {
    match read_account_grants_governed(account_id)? {
        ConfigReadOutcome::Ready(projection) => Ok(projection),
        ConfigReadOutcome::Absent => Err(
            "grants.json permission projection is missing; the permission surface fails closed"
                .to_string(),
        ),
        ConfigReadOutcome::Repair { reason, .. } => Err(reason),
    }
}

#[cfg(test)]
mod tests;
