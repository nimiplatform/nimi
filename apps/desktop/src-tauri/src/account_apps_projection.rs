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
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

/// Supported `library.json` schema version. An unknown future version fails
/// closed on read (migration mechanics are T10).
pub const ACCOUNT_APP_LIBRARY_SCHEMA_VERSION: u32 = 1;

/// Supported `grants.json` schema version.
pub const ACCOUNT_GRANTS_SCHEMA_VERSION: u32 = 1;

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

/// Read the account app-library projection, if present.
///
/// Fails closed on a parse failure, an unsupported `schemaVersion`, or an
/// account-id mismatch; returns `Ok(None)` only when the file does not exist.
///
/// T4-W1 owns the schema + fail-closed reader. The account app-library
/// lifecycle (enable/disable/open) is wave T4-W2; until that wave lands the
/// reader is exercised only by this module's tests.
#[allow(dead_code)]
pub fn read_account_app_library(
    account_id: &str,
) -> Result<Option<AccountAppLibraryRecord>, String> {
    let normalized = validate_account_id(account_id)?;
    let path = account_app_library_path(&normalized)?;
    if !path.exists() {
        return Ok(None);
    }
    let raw = fs::read_to_string(&path)
        .map_err(|error| format!("read library.json failed ({}): {error}", path.display()))?;
    let record = serde_json::from_str::<AccountAppLibraryRecord>(&raw)
        .map_err(|error| format!("parse library.json failed ({}): {error}", path.display()))?;
    validate_app_library_record(&record, &normalized)?;
    Ok(Some(record))
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

/// Read the permission/grant projection for an account, failing closed.
///
/// Returns `Err` when:
/// - the file is missing (no projection cache exists — fail closed, not empty);
/// - the file cannot be parsed;
/// - the `schemaVersion` is unsupported;
/// - the `accountId` does not match;
/// - any grant row is structurally invalid;
/// - any `granted` grant has an `expiresAt` already in the past (a stale grant
///   projection must not read as still-granted).
///
/// This is a projection reader only. It does not mint, refresh, or revoke
/// grants — the canonical grant authority is the deferred wave-4 fabric.
///
/// T4-W1 owns the schema + fail-closed reader. The Apps card
/// `permission_required` state (wave T4-W4) is its first non-test consumer;
/// until that wave lands the reader is exercised only by this module's tests.
#[allow(dead_code)]
pub fn read_account_grants_fail_closed(
    account_id: &str,
) -> Result<AccountGrantsProjection, String> {
    let normalized = validate_account_id(account_id)?;
    let path = account_grants_path(&normalized)?;
    if !path.exists() {
        return Err(
            "grants.json permission projection is missing; the permission surface fails closed"
                .to_string(),
        );
    }
    let raw = fs::read_to_string(&path)
        .map_err(|error| format!("read grants.json failed ({}): {error}", path.display()))?;
    let record = serde_json::from_str::<AccountGrantsRecord>(&raw)
        .map_err(|error| format!("parse grants.json failed ({}): {error}", path.display()))?;
    validate_grants_record(&record, &normalized)?;
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
    Ok(AccountGrantsProjection {
        account_id: record.account_id,
        grants: record.grants,
    })
}

#[cfg(test)]
mod tests {
    use super::{
        account_app_library_path, account_grants_path, read_account_app_library,
        read_account_grants_fail_closed, ACCOUNT_APP_LIBRARY_SCHEMA_VERSION,
        ACCOUNT_GRANTS_SCHEMA_VERSION,
    };
    use crate::test_support::with_env;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_home(prefix: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("nimi-account-apps-{prefix}-{unique}"));
        std::fs::create_dir_all(&dir).expect("create temp home");
        dir
    }

    fn write_json(path: &std::path::Path, value: serde_json::Value) {
        std::fs::create_dir_all(path.parent().expect("parent")).expect("mkdir");
        std::fs::write(path, serde_json::to_string_pretty(&value).expect("json"))
            .expect("write json");
    }

    #[test]
    fn library_read_returns_none_when_absent() {
        let home = temp_home("library-absent");
        with_env(&[("HOME", home.to_str())], || {
            assert!(read_account_app_library("account_1")
                .expect("read")
                .is_none());
        });
    }

    #[test]
    fn library_read_round_trips_valid_record() {
        let home = temp_home("library-valid");
        with_env(&[("HOME", home.to_str())], || {
            let path = account_app_library_path("account_1").expect("path");
            write_json(
                &path,
                serde_json::json!({
                    "schemaVersion": ACCOUNT_APP_LIBRARY_SCHEMA_VERSION,
                    "accountId": "account_1",
                    "updatedAt": "2026-05-21T00:00:00.000Z",
                    "apps": [{
                        "appId": "nimi.parentos",
                        "libraryState": "enabled",
                        "installed": true,
                        "lastOpenedAt": "2026-05-21T00:00:00.000Z",
                        "dataPolicy": "keep_on_uninstall"
                    }]
                }),
            );
            let record = read_account_app_library("account_1")
                .expect("read")
                .expect("record present");
            assert_eq!(record.apps.len(), 1);
            assert_eq!(record.apps[0].library_state, "enabled");
        });
    }

    #[test]
    fn library_unknown_schema_and_account_mismatch_fail_closed() {
        let home = temp_home("library-fail");
        with_env(&[("HOME", home.to_str())], || {
            let path = account_app_library_path("account_1").expect("path");
            write_json(
                &path,
                serde_json::json!({
                    "schemaVersion": 9999,
                    "accountId": "account_1",
                    "updatedAt": "2026-05-21T00:00:00.000Z",
                    "apps": []
                }),
            );
            let schema_err =
                read_account_app_library("account_1").expect_err("unknown schema fails closed");
            assert!(schema_err.contains("unsupported"));

            write_json(
                &path,
                serde_json::json!({
                    "schemaVersion": ACCOUNT_APP_LIBRARY_SCHEMA_VERSION,
                    "accountId": "account_2",
                    "updatedAt": "2026-05-21T00:00:00.000Z",
                    "apps": []
                }),
            );
            let account_err =
                read_account_app_library("account_1").expect_err("account mismatch fails closed");
            assert!(account_err.contains("accountId does not match"));
        });
    }

    #[test]
    fn grants_missing_projection_fails_closed() {
        let home = temp_home("grants-missing");
        with_env(&[("HOME", home.to_str())], || {
            let error = read_account_grants_fail_closed("account_1")
                .expect_err("missing grants projection fails closed");
            assert!(error.contains("missing"));
            assert!(error.contains("fails closed"));
        });
    }

    #[test]
    fn grants_valid_projection_reads_back() {
        let home = temp_home("grants-valid");
        with_env(&[("HOME", home.to_str())], || {
            let path = account_grants_path("account_1").expect("path");
            write_json(
                &path,
                serde_json::json!({
                    "schemaVersion": ACCOUNT_GRANTS_SCHEMA_VERSION,
                    "accountId": "account_1",
                    "updatedAt": "2026-05-21T00:00:00.000Z",
                    "grants": [{
                        "grantId": "grant-1",
                        "subject": "nimi.parentos",
                        "scope": "account.session.read",
                        "state": "granted",
                        "createdAt": "2026-05-21T00:00:00.000Z",
                        "expiresAt": null
                    }]
                }),
            );
            let projection =
                read_account_grants_fail_closed("account_1").expect("valid grants read back");
            assert_eq!(projection.grants.len(), 1);
            assert_eq!(projection.grants[0].state, "granted");
        });
    }

    #[test]
    fn grants_expired_granted_row_fails_closed_as_stale() {
        let home = temp_home("grants-expired");
        with_env(&[("HOME", home.to_str())], || {
            let path = account_grants_path("account_1").expect("path");
            write_json(
                &path,
                serde_json::json!({
                    "schemaVersion": ACCOUNT_GRANTS_SCHEMA_VERSION,
                    "accountId": "account_1",
                    "updatedAt": "2026-05-21T00:00:00.000Z",
                    "grants": [{
                        "grantId": "grant-1",
                        "subject": "nimi.parentos",
                        "scope": "account.session.read",
                        "state": "granted",
                        "createdAt": "2020-01-01T00:00:00.000Z",
                        "expiresAt": "2020-01-02T00:00:00.000Z"
                    }]
                }),
            );
            let error = read_account_grants_fail_closed("account_1")
                .expect_err("expired grant fails closed");
            assert!(error.contains("expired"));
            assert!(error.contains("stale"));
        });
    }

    #[test]
    fn grants_corrupt_and_unknown_schema_fail_closed() {
        let home = temp_home("grants-corrupt");
        with_env(&[("HOME", home.to_str())], || {
            let path = account_grants_path("account_1").expect("path");
            std::fs::create_dir_all(path.parent().expect("parent")).expect("mkdir");
            std::fs::write(&path, "{ not json").expect("write corrupt");
            let parse_err = read_account_grants_fail_closed("account_1")
                .expect_err("corrupt grants fails closed");
            assert!(parse_err.contains("parse"));

            write_json(
                &path,
                serde_json::json!({
                    "schemaVersion": 9999,
                    "accountId": "account_1",
                    "updatedAt": "2026-05-21T00:00:00.000Z",
                    "grants": []
                }),
            );
            let schema_err = read_account_grants_fail_closed("account_1")
                .expect_err("unknown schema fails closed");
            assert!(schema_err.contains("unsupported"));
        });
    }
}
