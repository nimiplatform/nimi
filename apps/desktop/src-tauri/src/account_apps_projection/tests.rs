use super::{
    account_grants_path, read_account_grants_fail_closed, read_account_grants_governed,
    ACCOUNT_GRANTS_SCHEMA_VERSION,
};
use crate::test_support::with_env;
use nimi_shell_tauri::capabilities::config::{ConfigReadOutcome, ConfigRepairSeverity};
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
    std::fs::write(path, serde_json::to_string_pretty(&value).expect("json")).expect("write json");
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
                    "subjectAccountId": "account_1",
                    "appId": "nimi.example-app",
                    "scopeFamily": "account",
                    "scopeName": "account.session.read",
                    "qualifier": null,
                    "state": "granted",
                    "expiresAt": null,
                    "version": 1
                }]
            }),
        );
        let projection =
            read_account_grants_fail_closed("account_1").expect("valid grants read back");
        assert_eq!(projection.schema_version, ACCOUNT_GRANTS_SCHEMA_VERSION);
        assert_eq!(projection.account_id, "account_1");
        assert_eq!(projection.grants.len(), 1);
        assert_eq!(projection.grants[0].state, "granted");
        assert_eq!(projection.grants[0].scope_family, "account");
        assert_eq!(projection.grants[0].scope_name, "account.session.read");
    });
}

#[test]
fn grants_superseded_state_is_canonical_projection_state() {
    let home = temp_home("grants-superseded");
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
                    "subjectAccountId": "account_1",
                    "appId": "nimi.example-app",
                    "scopeFamily": "account",
                    "scopeName": "account.session.read",
                    "qualifier": null,
                    "state": "superseded",
                    "expiresAt": "2020-01-02T00:00:00.000Z",
                    "version": 1
                }]
            }),
        );
        let projection =
            read_account_grants_fail_closed("account_1").expect("superseded grants read back");
        assert_eq!(projection.grants.len(), 1);
        assert_eq!(projection.grants[0].state, "superseded");
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
                    "subjectAccountId": "account_1",
                    "appId": "nimi.example-app",
                    "scopeFamily": "account",
                    "scopeName": "account.session.read",
                    "qualifier": null,
                    "state": "granted",
                    "expiresAt": "2020-01-02T00:00:00.000Z",
                    "version": 1
                }]
            }),
        );
        let error =
            read_account_grants_fail_closed("account_1").expect_err("expired grant fails closed");
        assert!(error.contains("expired"));
        assert!(error.contains("stale"));
    });
}

#[test]
fn grants_corrupt_and_unknown_schema_route_repair_required() {
    let home = temp_home("grants-corrupt");
    with_env(&[("HOME", home.to_str())], || {
        let path = account_grants_path("account_1").expect("path");
        std::fs::create_dir_all(path.parent().expect("parent")).expect("mkdir");
        std::fs::write(&path, "{ not json").expect("write corrupt");
        // A corrupt grants file routes to a typed repair_required, and the
        // fail-closed adapter still surfaces the framework reason.
        match read_account_grants_governed("account_1").expect("governed read") {
            ConfigReadOutcome::Repair { severity, reason } => {
                assert_eq!(severity, ConfigRepairSeverity::RepairRequired);
                assert!(reason.contains("not valid JSON"));
            }
            other => panic!("expected repair_required, got {other:?}"),
        }
        assert!(read_account_grants_fail_closed("account_1")
            .expect_err("corrupt grants fails closed")
            .contains("not valid JSON"));

        write_json(
            &path,
            serde_json::json!({
                "schemaVersion": 9999,
                "accountId": "account_1",
                "updatedAt": "2026-05-21T00:00:00.000Z",
                "grants": []
            }),
        );
        match read_account_grants_governed("account_1").expect("governed read") {
            ConfigReadOutcome::Repair { severity, reason } => {
                assert_eq!(severity, ConfigRepairSeverity::RepairRequired);
                assert!(reason.contains("newer than the supported version"));
            }
            other => panic!("expected repair_required, got {other:?}"),
        }
    });
}

#[test]
fn grants_missing_required_version_fails_closed() {
    let home = temp_home("grants-missing-version");
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
                    "subjectAccountId": "account_1",
                    "appId": "nimi.example-app",
                    "scopeFamily": "account",
                    "scopeName": "account.session.read",
                    "qualifier": null,
                    "state": "granted",
                    "expiresAt": null
                }]
            }),
        );
        let error = read_account_grants_fail_closed("account_1")
            .expect_err("missing grant version fails closed");
        assert!(error.contains("version"));
    });
}
