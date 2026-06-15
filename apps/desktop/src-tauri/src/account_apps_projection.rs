//! `~/.nimi/accounts/<account-id>/permissions/grants.json` — permission/grant
//! projection.
//!
//! Product owners (product manual):
//! - `grants.json`: permission/grant projection consumer. The canonical
//!   permission/grant lifecycle authority is Realm-owned `AppPermissionGrant`
//!   truth. T4 owns only the local projection schema + a fail-closed reader.
//!   This module does NOT implement a canonical grant service; it reads a
//!   projection and fails closed when it is stale, missing, or inconsistent.
//!
//! The file is account-scoped, fixed under the `~/.nimi` CONTROL root. The
//! account id is percent-encoded into the directory segment, mirroring the
//! Account Default Profile library encoding (`account_profile_library.rs`).
//!
//! Runtime app lifecycle owns account app-inventory reads/writes. Desktop consumes
//! that inventory through Runtime RPC and keeps only the permission/grant
//! projection reader here; it never mints, refreshes, revokes, or persists grant
//! truth.

use crate::desktop_paths::resolve_nimi_dir;
use nimi_shell_tauri::governed_config::{
    read_governed_config, ConfigReadOutcome, GovernedConfigFile,
};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// Supported `grants.json` schema version.
pub const ACCOUNT_GRANTS_SCHEMA_VERSION: u32 = 1;

/// Governed config-file identity for the permission/grant projection
/// (`local-config-file-registry.yaml` row `grants_json`).
const GRANTS_CONFIG_FILE: GovernedConfigFile = GovernedConfigFile::new(
    "grants_json",
    "~/.nimi/accounts/<account-id>/permissions/grants.json",
    ACCOUNT_GRANTS_SCHEMA_VERSION,
);

/// Closed grant `state` vocabulary.
const GRANT_STATE_GRANTED: &str = "granted";
const GRANT_STATE_DENIED: &str = "denied";
const GRANT_STATE_PENDING: &str = "pending";
const GRANT_STATE_EXPIRED: &str = "expired";
const GRANT_STATE_REVOKED: &str = "revoked";
const GRANT_STATE_SUPERSEDED: &str = "superseded";

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

// === Permission/grant projection (`grants.json`) ===

/// One Realm-projected permission/grant row.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AccountGrantProjectionRowDto {
    pub grant_id: String,
    pub subject_account_id: String,
    pub app_id: String,
    pub scope_family: String,
    pub scope_name: String,
    pub qualifier: Option<String>,
    pub state: String,
    pub expires_at: Option<String>,
    pub version: Option<u64>,
}

/// `~/.nimi/accounts/<account-id>/permissions/grants.json` record shape.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AccountGrantsProjectionDto {
    pub schema_version: u32,
    pub account_id: String,
    pub updated_at: String,
    pub grants: Vec<AccountGrantProjectionRowDto>,
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

fn validate_grants_record(
    record: &AccountGrantsProjectionDto,
    account_id: &str,
) -> Result<(), String> {
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
            || grant.subject_account_id.trim().is_empty()
            || grant.app_id.trim().is_empty()
            || grant.scope_family.trim().is_empty()
            || grant.scope_name.trim().is_empty()
            || grant.state.trim().is_empty()
            || grant.version.is_none()
        {
            return Err("grants.json grant row requires grantId, subjectAccountId, appId, scopeFamily, scopeName, state, and version".to_string());
        }
        if !matches!(
            grant.state.as_str(),
            GRANT_STATE_GRANTED
                | GRANT_STATE_DENIED
                | GRANT_STATE_PENDING
                | GRANT_STATE_EXPIRED
                | GRANT_STATE_REVOKED
                | GRANT_STATE_SUPERSEDED
        ) {
            return Err(format!(
                "grants.json grant row {} has an unknown state: {}",
                grant.grant_id, grant.state
            ));
        }
        if grant.subject_account_id != account_id {
            return Err(format!(
                "grants.json grant row {} subjectAccountId does not match the authenticated Runtime account",
                grant.grant_id
            ));
        }
        if grant
            .qualifier
            .as_deref()
            .is_some_and(|value| value.trim().is_empty())
        {
            return Err(format!(
                "grants.json grant row {} qualifier must be omitted or a non-empty value",
                grant.grant_id
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

/// Structural + staleness validation of a grants record.
///
/// The canonical permission/grant authority is Realm-owned grant lifecycle
/// truth. This reader never asserts a grant is valid — it only projects what
/// the local cache file says, and fails closed (`Err`) when the file is
/// missing, unparseable, schema-incompatible, account-mismatched, or carries a
/// grant that is already expired by the wall clock. A consumer that cannot get
/// an `Ok` projection must treat the grant surface as not satisfied.
///
/// `schemaVersion` fail-closed / migration routing is owned by the
/// shared governed-config framework; this checks the account-id binding,
/// per-row structure, and the wall-clock staleness invariant (an already-
/// expired `granted` row makes the whole projection stale). A failure routes
/// the read to `repair_required`.
fn validate_grants_record_freshness(
    record: &AccountGrantsProjectionDto,
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
) -> Result<ConfigReadOutcome<AccountGrantsProjectionDto>, String> {
    let normalized = validate_account_id(account_id)?;
    let path = account_grants_path(&normalized)?;
    read_governed_config(&GRANTS_CONFIG_FILE, &path, |document| {
        let record: AccountGrantsProjectionDto = serde_json::from_value(document.clone())
            .map_err(|error| format!("grants.json cannot be deserialized: {error}"))?;
        validate_grants_record_freshness(&record, &normalized)?;
        Ok(record)
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
/// grants — the canonical grant authority is Realm-owned grant lifecycle truth.
#[allow(dead_code)]
pub fn read_account_grants_fail_closed(
    account_id: &str,
) -> Result<AccountGrantsProjectionDto, String> {
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
