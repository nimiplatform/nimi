use super::{
    account_app_library_path, account_grants_path, apply_account_app_library_mutation,
    read_account_app_library, read_account_app_library_governed, read_account_grants_fail_closed,
    read_account_grants_governed, AccountAppLibraryMutation, ACCOUNT_APP_LIBRARY_SCHEMA_VERSION,
    ACCOUNT_GRANTS_SCHEMA_VERSION,
};
use crate::local_config_migration::{ConfigReadOutcome, ConfigRepairSeverity};
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
    std::fs::write(path, serde_json::to_string_pretty(&value).expect("json")).expect("write json");
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
fn library_unknown_schema_and_account_mismatch_route_repair_required() {
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
        // P-MIG-002 / P-MIG-004: unknown future version -> typed repair.
        match read_account_app_library_governed("account_1").expect("governed read") {
            ConfigReadOutcome::Repair { severity, reason } => {
                assert_eq!(severity, ConfigRepairSeverity::RepairRequired);
                assert!(reason.contains("newer than the supported version"));
            }
            other => panic!("expected repair_required, got {other:?}"),
        }

        write_json(
            &path,
            serde_json::json!({
                "schemaVersion": ACCOUNT_APP_LIBRARY_SCHEMA_VERSION,
                "accountId": "account_2",
                "updatedAt": "2026-05-21T00:00:00.000Z",
                "apps": []
            }),
        );
        // An account-id mismatch is a structural fault detected by the
        // owner validator; it routes to repair, not a raw Err.
        match read_account_app_library_governed("account_1").expect("governed read") {
            ConfigReadOutcome::Repair { severity, reason } => {
                assert_eq!(severity, ConfigRepairSeverity::RepairRequired);
                assert!(reason.contains("accountId does not match"));
            }
            other => panic!("expected repair_required, got {other:?}"),
        }
    });
}

#[test]
fn library_mutation_installs_then_uninstalls_keeping_record() {
    // T4-W4: the install/uninstall lifecycle terminal events drive the
    // `library.json` writer. Install marks the app installed+enabled; an
    // uninstall keeps the library record but marks the package not
    // installed (manual `#### Uninstall And Data`).
    let home = temp_home("library-mutate");
    with_env(&[("HOME", home.to_str())], || {
        let installed = apply_account_app_library_mutation(
            "account_1",
            "nimi.parentos",
            AccountAppLibraryMutation::InstalledEnabled,
        )
        .expect("install mutation");
        assert_eq!(installed.apps.len(), 1);
        assert_eq!(installed.apps[0].app_id, "nimi.parentos");
        assert_eq!(installed.apps[0].library_state, "enabled");
        assert!(installed.apps[0].installed);
        assert_eq!(installed.apps[0].data_policy, "keep_on_uninstall");

        let uninstalled = apply_account_app_library_mutation(
            "account_1",
            "nimi.parentos",
            AccountAppLibraryMutation::UninstalledKeepRecord,
        )
        .expect("uninstall mutation");
        assert_eq!(
            uninstalled.apps.len(),
            1,
            "library record kept on uninstall"
        );
        assert!(
            !uninstalled.apps[0].installed,
            "package no longer installed"
        );
        assert_eq!(uninstalled.apps[0].library_state, "enabled");

        // The committed file round-trips through the governed reader.
        let read_back = read_account_app_library("account_1")
            .expect("read")
            .expect("record present");
        assert_eq!(read_back.apps.len(), 1);
        assert!(!read_back.apps[0].installed);
    });
}

#[test]
fn library_mutation_remove_marks_record_removed() {
    let home = temp_home("library-remove");
    with_env(&[("HOME", home.to_str())], || {
        apply_account_app_library_mutation(
            "account_1",
            "nimi.parentos",
            AccountAppLibraryMutation::InstalledEnabled,
        )
        .expect("install mutation");
        let removed = apply_account_app_library_mutation(
            "account_1",
            "nimi.parentos",
            AccountAppLibraryMutation::RemovedFromLibrary,
        )
        .expect("remove mutation");
        assert_eq!(removed.apps[0].library_state, "removed");
        assert!(!removed.apps[0].installed);
    });
}

#[test]
fn library_mutation_is_idempotent() {
    let home = temp_home("library-idempotent");
    with_env(&[("HOME", home.to_str())], || {
        apply_account_app_library_mutation(
            "account_1",
            "nimi.parentos",
            AccountAppLibraryMutation::InstalledEnabled,
        )
        .expect("install mutation");
        let second = apply_account_app_library_mutation(
            "account_1",
            "nimi.parentos",
            AccountAppLibraryMutation::InstalledEnabled,
        )
        .expect("repeated install mutation");
        assert_eq!(
            second.apps.len(),
            1,
            "repeated install converges to one row"
        );
    });
}

#[test]
fn library_mutation_fails_closed_on_faulted_file() {
    // A corrupt / unknown-version file routes the governed read to a typed
    // repair; the writer must NOT overwrite it.
    let home = temp_home("library-mutate-fault");
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
        let error = apply_account_app_library_mutation(
            "account_1",
            "nimi.parentos",
            AccountAppLibraryMutation::InstalledEnabled,
        )
        .expect_err("faulted file fails the mutation closed");
        assert!(error.contains("newer than the supported version"));
        // The faulted file is untouched, not overwritten.
        let raw = std::fs::read_to_string(&path).expect("file still present");
        assert!(raw.contains("9999"), "faulted file not overwritten");
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
