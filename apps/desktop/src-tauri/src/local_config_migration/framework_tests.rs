//! Framework-level tests for the shared `~/.nimi` migration / repair runner.
//!
//! These exercise the `P-MIG` mechanics with a test-only governed family that
//! carries a real two-stage migration chain (v1 -> v2 -> v3). Every production
//! family is currently at `schemaVersion` 1 with an empty step set, so the
//! ordered-apply / idempotent-replay / backup behavior cannot be observed
//! through a production family yet — this synthetic family proves the
//! machinery itself. Per-family fail-closed read and repair routing are
//! additionally verified in each owner module's own tests.

use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Deserialize;
use serde_json::{json, Value};

use super::backup::BACKUP_SUFFIX;
use super::outcome::{ConfigReadOutcome, ConfigRepairSeverity, GovernedConfigFile};
use super::registry::{MigrationRegistry, MigrationStep};
use super::runner::read_governed_config;

const TEST_FILE: GovernedConfigFile =
    GovernedConfigFile::new("framework_probe", "~/.nimi/framework-probe.json");

/// v1 -> v2: rename the `name` field to `displayName`, drop the retired
/// `legacy` field explicitly, stamp `schemaVersion` to 2.
fn migrate_v1_to_v2(mut document: Value) -> Result<Value, String> {
    let object = document
        .as_object_mut()
        .ok_or_else(|| "document is not an object".to_string())?;
    let name = object
        .remove("name")
        .ok_or_else(|| "v1 document missing the name field".to_string())?;
    object.insert("displayName".to_string(), name);
    object.remove("legacy");
    object.insert("schemaVersion".to_string(), json!(2));
    Ok(document)
}

/// v2 -> v3: add the `revision` field with a default, stamp `schemaVersion`
/// to 3.
fn migrate_v2_to_v3(mut document: Value) -> Result<Value, String> {
    let object = document
        .as_object_mut()
        .ok_or_else(|| "document is not an object".to_string())?;
    object
        .entry("revision".to_string())
        .or_insert_with(|| json!(0));
    object.insert("schemaVersion".to_string(), json!(3));
    Ok(document)
}

const TEST_STEPS: &[MigrationStep] = &[
    MigrationStep::new(1, 2, migrate_v1_to_v2),
    MigrationStep::new(2, 3, migrate_v2_to_v3),
];

const TEST_REGISTRY: MigrationRegistry = MigrationRegistry::new("framework_probe", 3, TEST_STEPS);

/// The current-version typed shape the owner closure deserializes into.
#[derive(Debug, Deserialize, PartialEq, Eq)]
struct ProbeRecordV3 {
    #[serde(rename = "schemaVersion")]
    schema_version: u32,
    #[serde(rename = "displayName")]
    display_name: String,
    revision: u32,
}

/// The owner's typed deserialize + structural validate closure.
fn deserialize_probe(document: &Value) -> Result<ProbeRecordV3, String> {
    let record: ProbeRecordV3 = serde_json::from_value(document.clone())
        .map_err(|error| format!("probe record cannot be deserialized: {error}"))?;
    if record.display_name.trim().is_empty() {
        return Err("probe record displayName is required".to_string());
    }
    Ok(record)
}

fn temp_path(prefix: &str) -> PathBuf {
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("time")
        .as_nanos();
    let dir = std::env::temp_dir().join(format!("nimi-migration-fw-{prefix}-{unique}"));
    std::fs::create_dir_all(&dir).expect("create temp dir");
    dir.join("framework-probe.json")
}

fn read(path: &Path) -> Result<ConfigReadOutcome<ProbeRecordV3>, String> {
    read_governed_config(&TEST_FILE, path, &TEST_REGISTRY, deserialize_probe)
}

#[test]
fn absent_file_reads_as_absent_not_repair() {
    let path = temp_path("absent");
    let outcome = read(&path).expect("read");
    assert!(
        matches!(outcome, ConfigReadOutcome::Absent),
        "a missing governed config file is Absent, never a routed repair state"
    );
}

#[test]
fn current_version_file_reads_ready_without_rewrite() {
    let path = temp_path("current");
    let raw = serde_json::to_vec_pretty(&json!({
        "schemaVersion": 3,
        "displayName": "Probe",
        "revision": 7
    }))
    .expect("json");
    std::fs::write(&path, &raw).expect("write");

    let outcome = read(&path).expect("read");
    match outcome {
        ConfigReadOutcome::Ready(record) => {
            assert_eq!(record.schema_version, 3);
            assert_eq!(record.display_name, "Probe");
            assert_eq!(record.revision, 7);
        }
        other => panic!("expected Ready, got {other:?}"),
    }
    // Idempotent replay: a current-version file is never rewritten, so no
    // `.bak` is produced.
    let backup = path.with_extension(format!("json{BACKUP_SUFFIX}"));
    assert!(
        !backup.exists(),
        "current-version read must not write a backup"
    );
}

#[test]
fn missing_schema_version_fails_closed_to_repair() {
    let path = temp_path("no-schema");
    std::fs::write(
        &path,
        serde_json::to_vec_pretty(&json!({ "displayName": "Probe", "revision": 1 })).expect("json"),
    )
    .expect("write");

    let outcome = read(&path).expect("read");
    match outcome {
        ConfigReadOutcome::Repair { severity, reason } => {
            assert_eq!(severity, ConfigRepairSeverity::RepairRequired);
            assert!(reason.contains("schemaVersion"));
            assert!(reason.contains("~/.nimi/framework-probe.json"));
        }
        other => panic!("expected Repair, got {other:?}"),
    }
}

#[test]
fn unknown_future_version_fails_closed_to_repair() {
    let path = temp_path("future");
    std::fs::write(
        &path,
        serde_json::to_vec_pretty(&json!({
            "schemaVersion": 9999,
            "displayName": "Probe",
            "revision": 1
        }))
        .expect("json"),
    )
    .expect("write");

    let outcome = read(&path).expect("read");
    match outcome {
        ConfigReadOutcome::Repair { severity, reason } => {
            assert_eq!(severity, ConfigRepairSeverity::RepairRequired);
            assert!(reason.contains("newer than the supported version"));
        }
        other => panic!("expected Repair, got {other:?}"),
    }
}

#[test]
fn corrupt_json_fails_closed_to_repair() {
    let path = temp_path("corrupt");
    std::fs::write(&path, b"{ not valid json").expect("write");

    let outcome = read(&path).expect("read");
    match outcome {
        ConfigReadOutcome::Repair { severity, reason } => {
            assert_eq!(severity, ConfigRepairSeverity::RepairRequired);
            assert!(reason.contains("not valid JSON"));
        }
        other => panic!("expected Repair, got {other:?}"),
    }
}

#[test]
fn ordered_migration_applies_v1_to_v3_and_backs_up() {
    let path = temp_path("migrate");
    let v1_raw = serde_json::to_vec_pretty(&json!({
        "schemaVersion": 1,
        "name": "Probe",
        "legacy": "retired-field"
    }))
    .expect("json");
    std::fs::write(&path, &v1_raw).expect("write");

    let outcome = read(&path).expect("read");
    match outcome {
        ConfigReadOutcome::Ready(record) => {
            assert_eq!(record.schema_version, 3);
            assert_eq!(record.display_name, "Probe");
            // v2->v3 default applied.
            assert_eq!(record.revision, 0);
        }
        other => panic!("expected Ready after migration, got {other:?}"),
    }

    // The on-disk file was atomically rewritten to v3.
    let on_disk: Value =
        serde_json::from_slice(&std::fs::read(&path).expect("read after")).expect("parse after");
    assert_eq!(on_disk["schemaVersion"], json!(3));
    assert_eq!(on_disk["displayName"], json!("Probe"));
    assert!(
        on_disk.get("name").is_none() && on_disk.get("legacy").is_none(),
        "migrated document drops the retired v1 fields"
    );

    // The pre-migration v1 bytes were retained as a recoverable backup.
    let backup = path.with_extension(format!("json{BACKUP_SUFFIX}"));
    assert!(backup.exists(), "migration retains a pre-migration .bak");
    assert_eq!(
        std::fs::read(&backup).expect("read backup"),
        v1_raw,
        "the backup holds the verbatim pre-migration bytes"
    );
}

#[test]
fn migration_replay_is_idempotent() {
    let path = temp_path("replay");
    std::fs::write(
        &path,
        serde_json::to_vec_pretty(&json!({
            "schemaVersion": 1,
            "name": "Probe",
            "legacy": "retired-field"
        }))
        .expect("json"),
    )
    .expect("write");

    let first = read(&path).expect("first read");
    let first_record = match first {
        ConfigReadOutcome::Ready(record) => record,
        other => panic!("expected Ready, got {other:?}"),
    };
    let after_first = std::fs::read(&path).expect("read after first");

    // Re-running the read on the already-migrated file is a typed no-op: the
    // result is identical and the file is not rewritten again.
    let second = read(&path).expect("second read");
    let second_record = match second {
        ConfigReadOutcome::Ready(record) => record,
        other => panic!("expected Ready on replay, got {other:?}"),
    };
    assert_eq!(first_record, second_record);
    assert_eq!(
        after_first,
        std::fs::read(&path).expect("read after second"),
        "replaying the migration must not rewrite an already-current file"
    );
}

#[test]
fn missing_migration_step_fails_closed_to_repair() {
    // A registry whose chain does not cover an on-disk version below current.
    static GAPPED_STEPS: &[MigrationStep] = &[MigrationStep::new(2, 3, migrate_v2_to_v3)];
    static GAPPED_REGISTRY: MigrationRegistry =
        MigrationRegistry::new("framework_probe", 3, GAPPED_STEPS);

    let path = temp_path("gap");
    std::fs::write(
        &path,
        serde_json::to_vec_pretty(&json!({ "schemaVersion": 1, "name": "Probe" })).expect("json"),
    )
    .expect("write");

    // The chain is internally consistent (2->3 ends at current 3) but does not
    // reach down to the on-disk v1 — a v1 file has no registered path.
    let outcome =
        read_governed_config(&TEST_FILE, &path, &GAPPED_REGISTRY, deserialize_probe).expect("read");
    match outcome {
        ConfigReadOutcome::Repair { severity, reason } => {
            assert_eq!(severity, ConfigRepairSeverity::RepairRequired);
            assert!(reason.contains("no registered migration from schemaVersion 1"));
        }
        other => panic!("expected Repair, got {other:?}"),
    }
    // The on-disk file is left untouched — no silent recreate.
    let on_disk: Value =
        serde_json::from_slice(&std::fs::read(&path).expect("read after")).expect("parse");
    assert_eq!(on_disk["schemaVersion"], json!(1));
}

#[test]
fn post_migration_validation_failure_routes_repair() {
    let path = temp_path("invalid-after");
    // A v1 file whose migrated form fails the owner's structural validator
    // (empty displayName) must route to repair, not surface a raw Err.
    std::fs::write(
        &path,
        serde_json::to_vec_pretty(&json!({ "schemaVersion": 1, "name": "" })).expect("json"),
    )
    .expect("write");

    let outcome = read(&path).expect("read");
    match outcome {
        ConfigReadOutcome::Repair { severity, reason } => {
            assert_eq!(severity, ConfigRepairSeverity::RepairRequired);
            assert!(reason.contains("displayName is required"));
        }
        other => panic!("expected Repair, got {other:?}"),
    }
}

#[test]
fn broken_pointer_routes_repair_without_orphaning() {
    // P-MIG-004 / P-MIG-005: a config file whose pointer to another on-disk
    // path no longer resolves must route to repair_required — never a silent
    // recreate that would orphan the data the stale pointer used to reach. The
    // owner's deserialize closure detects the dangling pointer; the framework
    // routes it and leaves the on-disk file byte-for-byte intact.
    #[derive(Debug, Deserialize)]
    struct PointerRecord {
        #[serde(rename = "schemaVersion")]
        #[allow(dead_code)]
        schema_version: u32,
        #[serde(rename = "dataPointer")]
        data_pointer: String,
    }

    fn deserialize_pointer(document: &Value) -> Result<PointerRecord, String> {
        let record: PointerRecord = serde_json::from_value(document.clone())
            .map_err(|error| format!("pointer record cannot be deserialized: {error}"))?;
        if !std::path::Path::new(&record.data_pointer).exists() {
            // A dangling pointer is a broken-pointer fault: fail closed to
            // repair, do not recreate the target (that would orphan data).
            return Err(format!(
                "dataPointer no longer resolves: {}",
                record.data_pointer
            ));
        }
        Ok(record)
    }

    static POINTER_REGISTRY: MigrationRegistry = MigrationRegistry::new("framework_probe", 1, &[]);
    const POINTER_FILE: GovernedConfigFile =
        GovernedConfigFile::new("framework_probe", "~/.nimi/framework-probe.json");

    let path = temp_path("broken-pointer");
    let raw = serde_json::to_vec_pretty(&json!({
        "schemaVersion": 1,
        "dataPointer": "/nimi-test/path/that/does/not/exist"
    }))
    .expect("json");
    std::fs::write(&path, &raw).expect("write");

    let outcome =
        read_governed_config(&POINTER_FILE, &path, &POINTER_REGISTRY, deserialize_pointer)
            .expect("read");
    match outcome {
        ConfigReadOutcome::Repair { severity, reason } => {
            assert_eq!(severity, ConfigRepairSeverity::RepairRequired);
            assert!(reason.contains("dataPointer no longer resolves"));
        }
        other => panic!("expected repair_required for a broken pointer, got {other:?}"),
    }
    // No-orphaning: the on-disk file is untouched — no silent pointer recreate.
    assert_eq!(
        std::fs::read(&path).expect("read after"),
        raw,
        "a broken-pointer fault leaves the file intact for guided repair"
    );
}

#[test]
fn malformed_registry_chain_is_a_hard_error() {
    // A registry whose step does not land on the declared current version is a
    // build-time programming fault, surfaced as a hard Err (not a user repair
    // state) so it is caught in tests rather than corrupting a file.
    static BAD_STEPS: &[MigrationStep] = &[MigrationStep::new(1, 2, migrate_v1_to_v2)];
    static BAD_REGISTRY: MigrationRegistry =
        MigrationRegistry::new("framework_probe", 3, BAD_STEPS);

    let path = temp_path("bad-registry");
    std::fs::write(
        &path,
        serde_json::to_vec_pretty(
            &json!({ "schemaVersion": 3, "displayName": "P", "revision": 0 }),
        )
        .expect("json"),
    )
    .expect("write");

    let error = read_governed_config(&TEST_FILE, &path, &BAD_REGISTRY, deserialize_probe)
        .expect_err("malformed registry is a hard error");
    assert!(error.contains("migration chain ends at schemaVersion 2"));
}
