//! Shared governed local-record current-schema read and repair routing.
//!
//! This module is reusable host/scaffold infrastructure. It owns only the
//! common read/repair protocol: root `schemaVersion` validation, typed repair
//! routing, and no-rewrite current-schema reads. Each file owner still provides
//! its own typed deserializer and structural validator.

use std::fs;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use serde_json::Value;

/// Identity of one governed local config or materialized projection.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct GovernedConfigFile {
    /// Stable registry id, e.g. `registry_json`.
    pub config_file_id: &'static str,
    /// Product-facing diagnostic path, e.g. `<dataRoot>/apps/registry.json`.
    ///
    /// This label never resolves the file; callers pass the actual path to the
    /// read or write operation.
    pub display_path: &'static str,
    /// Current owner-declared supported schemaVersion for this file.
    pub current_schema_version: u32,
}

impl GovernedConfigFile {
    pub const fn new(
        config_file_id: &'static str,
        display_path: &'static str,
        current_schema_version: u32,
    ) -> Self {
        Self {
            config_file_id,
            display_path,
            current_schema_version,
        }
    }
}

/// Severity of a routed repair state.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ConfigRepairSeverity {
    RepairRequired,
    Blocked,
}

/// Typed result of reading a governed local config or projection.
#[derive(Debug, Clone)]
pub enum ConfigReadOutcome<T> {
    Absent,
    Ready(T),
    Repair {
        severity: ConfigRepairSeverity,
        reason: String,
    },
}

impl<T> ConfigReadOutcome<T> {
    pub fn repair_required(file: &GovernedConfigFile, detail: impl AsRef<str>) -> Self {
        Self::Repair {
            severity: ConfigRepairSeverity::RepairRequired,
            reason: format!("{} requires repair: {}", file.display_path, detail.as_ref()),
        }
    }

    pub fn blocked(file: &GovernedConfigFile, detail: impl AsRef<str>) -> Self {
        Self::Repair {
            severity: ConfigRepairSeverity::Blocked,
            reason: format!("{} is blocked: {}", file.display_path, detail.as_ref()),
        }
    }
}

fn read_schema_version(document: &Value) -> Result<u32, String> {
    let object = document
        .as_object()
        .ok_or_else(|| "config document root is not a JSON object".to_string())?;
    let raw = object
        .get("schemaVersion")
        .ok_or_else(|| "config document is missing the required schemaVersion field".to_string())?;
    let number = raw
        .as_u64()
        .ok_or_else(|| "config document schemaVersion is not a non-negative integer".to_string())?;
    if number == 0 {
        return Err("config document schemaVersion must be a positive integer".to_string());
    }
    u32::try_from(number)
        .map_err(|_| "config document schemaVersion is out of the supported range".to_string())
}

fn load_raw(path: &Path) -> std::io::Result<Option<Vec<u8>>> {
    match fs::read(path) {
        Ok(bytes) => Ok(Some(bytes)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error),
    }
}

/// Read a governed local config or projection through the shared validation /
/// repair framework.
pub fn read_governed_config<T>(
    file: &GovernedConfigFile,
    path: &Path,
    deserialize: impl FnOnce(&Value) -> Result<T, String>,
) -> Result<ConfigReadOutcome<T>, String> {
    if file.current_schema_version == 0 {
        return Err(format!(
            "governed config {} declares an invalid current schemaVersion 0",
            file.config_file_id
        ));
    }

    let raw_bytes = match load_raw(path) {
        Ok(None) => return Ok(ConfigReadOutcome::Absent),
        Ok(Some(bytes)) => bytes,
        Err(error) => {
            return Ok(ConfigReadOutcome::repair_required(
                file,
                format!("config file is unreadable ({}): {error}", path.display()),
            ));
        }
    };

    let document: Value = match serde_json::from_slice(&raw_bytes) {
        Ok(value) => value,
        Err(error) => {
            return Ok(ConfigReadOutcome::repair_required(
                file,
                format!("config file is not valid JSON: {error}"),
            ));
        }
    };

    let on_disk_version = match read_schema_version(&document) {
        Ok(version) => version,
        Err(detail) => {
            return Ok(ConfigReadOutcome::repair_required(file, detail));
        }
    };

    if on_disk_version != file.current_schema_version {
        let relation = if on_disk_version > file.current_schema_version {
            "newer than"
        } else {
            "older than"
        };
        return Ok(ConfigReadOutcome::repair_required(
            file,
            format!(
                "config schemaVersion {on_disk_version} is {relation} the supported version {}; current-schema read requires the owner-declared current version and automatic old-schema migration is not admitted in this pre-launch build",
                file.current_schema_version
            ),
        ));
    }

    match deserialize(&document) {
        Ok(record) => Ok(ConfigReadOutcome::Ready(record)),
        Err(detail) => Ok(ConfigReadOutcome::repair_required(file, detail)),
    }
}

fn now_unix_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

fn display_path_for_error(path: &Path) -> String {
    path.display().to_string()
}

/// Atomically serialize and write a governed local JSON record.
///
/// The caller owns structural validation. This helper owns the common host
/// write mechanics: parent creation, pretty JSON serialization, tmp-file write,
/// and atomic rename into place.
pub fn write_governed_json_config<T>(
    path: &Path,
    record: &T,
    validate: impl FnOnce(&T) -> Result<(), String>,
) -> Result<(), String>
where
    T: Serialize,
{
    validate(record)?;
    let path_label = display_path_for_error(path);
    let parent = path
        .parent()
        .ok_or_else(|| format!("governed config path has no parent directory: {path_label}"))?;
    fs::create_dir_all(parent).map_err(|error| {
        format!(
            "create governed config parent failed ({}): {error}",
            parent.display()
        )
    })?;
    let raw = serde_json::to_string_pretty(record)
        .map_err(|error| format!("serialize governed config failed ({path_label}): {error}"))?;
    let tmp_path =
        path.with_extension(format!("json.tmp.{}.{}", std::process::id(), now_unix_ms()));
    fs::write(&tmp_path, raw).map_err(|error| {
        format!(
            "write governed config temporary file failed ({}): {error}",
            tmp_path.display()
        )
    })?;
    fs::rename(&tmp_path, path)
        .map_err(|error| format!("commit governed config failed ({path_label}): {error}"))
}

#[cfg(test)]
mod tests {
    use std::path::{Path, PathBuf};
    use std::time::{SystemTime, UNIX_EPOCH};

    use serde::{Deserialize, Serialize};
    use serde_json::{json, Value};

    use super::{
        read_governed_config, write_governed_json_config, ConfigReadOutcome, ConfigRepairSeverity,
        GovernedConfigFile,
    };

    const TEST_FILE: GovernedConfigFile =
        GovernedConfigFile::new("framework_probe", "~/.nimi/framework-probe.json", 3);

    #[derive(Debug, Deserialize, PartialEq, Eq)]
    struct ProbeRecordV3 {
        #[serde(rename = "schemaVersion")]
        schema_version: u32,
        #[serde(rename = "displayName")]
        display_name: String,
        revision: u32,
    }

    #[derive(Debug, Serialize)]
    struct WriteProbeRecord {
        #[serde(rename = "schemaVersion")]
        schema_version: u32,
        #[serde(rename = "displayName")]
        display_name: String,
        revision: u32,
    }

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
        let dir = std::env::temp_dir().join(format!("nimi-config-repair-{prefix}-{unique}"));
        std::fs::create_dir_all(&dir).expect("create temp dir");
        dir.join("framework-probe.json")
    }

    fn read(path: &Path) -> Result<ConfigReadOutcome<ProbeRecordV3>, String> {
        read_governed_config(&TEST_FILE, path, deserialize_probe)
    }

    #[test]
    fn absent_file_reads_as_absent_not_repair() {
        let path = temp_path("absent");
        let outcome = read(&path).expect("read");
        assert!(matches!(outcome, ConfigReadOutcome::Absent));
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
        assert_eq!(std::fs::read(&path).expect("read after"), raw);
        assert!(!path.with_extension("json.bak").exists());
    }

    #[test]
    fn missing_schema_version_fails_closed_to_repair() {
        let path = temp_path("no-schema");
        let raw = serde_json::to_vec_pretty(&json!({ "displayName": "Probe", "revision": 1 }))
            .expect("json");
        std::fs::write(&path, &raw).expect("write");

        let outcome = read(&path).expect("read");

        match outcome {
            ConfigReadOutcome::Repair { severity, reason } => {
                assert_eq!(severity, ConfigRepairSeverity::RepairRequired);
                assert!(reason.contains("schemaVersion"));
                assert!(reason.contains("~/.nimi/framework-probe.json"));
            }
            other => panic!("expected Repair, got {other:?}"),
        }
        assert_eq!(std::fs::read(&path).expect("read after"), raw);
    }

    #[test]
    fn older_schema_version_fails_closed_without_migration_or_rewrite() {
        let path = temp_path("old-schema");
        let raw = serde_json::to_vec_pretty(&json!({
            "schemaVersion": 1,
            "name": "Probe",
            "legacy": "retired-field"
        }))
        .expect("json");
        std::fs::write(&path, &raw).expect("write");

        let outcome = read(&path).expect("read");

        match outcome {
            ConfigReadOutcome::Repair { severity, reason } => {
                assert_eq!(severity, ConfigRepairSeverity::RepairRequired);
                assert!(reason.contains("older than the supported version"));
                assert!(reason.contains("automatic old-schema migration is not admitted"));
            }
            other => panic!("expected Repair, got {other:?}"),
        }
        assert_eq!(std::fs::read(&path).expect("read after"), raw);
        assert!(!path.with_extension("json.bak").exists());
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
    fn validation_failure_routes_repair_without_orphaning() {
        let path = temp_path("invalid-current");
        let raw = serde_json::to_vec_pretty(&json!({
            "schemaVersion": 3,
            "displayName": "",
            "revision": 1
        }))
        .expect("json");
        std::fs::write(&path, &raw).expect("write");

        let outcome = read(&path).expect("read");

        match outcome {
            ConfigReadOutcome::Repair { severity, reason } => {
                assert_eq!(severity, ConfigRepairSeverity::RepairRequired);
                assert!(reason.contains("displayName is required"));
            }
            other => panic!("expected Repair, got {other:?}"),
        }
        assert_eq!(std::fs::read(&path).expect("read after"), raw);
    }

    #[test]
    fn broken_pointer_routes_repair_without_recreate() {
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
                return Err(format!(
                    "dataPointer no longer resolves: {}",
                    record.data_pointer
                ));
            }
            Ok(record)
        }

        const POINTER_FILE: GovernedConfigFile =
            GovernedConfigFile::new("framework_probe", "~/.nimi/framework-probe.json", 1);

        let path = temp_path("broken-pointer");
        let raw = serde_json::to_vec_pretty(&json!({
            "schemaVersion": 1,
            "dataPointer": "/nimi-test/path/that/does/not/exist"
        }))
        .expect("json");
        std::fs::write(&path, &raw).expect("write");

        let outcome =
            read_governed_config(&POINTER_FILE, &path, deserialize_pointer).expect("read");

        match outcome {
            ConfigReadOutcome::Repair { severity, reason } => {
                assert_eq!(severity, ConfigRepairSeverity::RepairRequired);
                assert!(reason.contains("dataPointer no longer resolves"));
            }
            other => panic!("expected repair_required for a broken pointer, got {other:?}"),
        }
        assert_eq!(std::fs::read(&path).expect("read after"), raw);
    }

    #[test]
    fn governed_json_write_validates_and_round_trips() {
        let path = temp_path("write").with_file_name("nested/probe.json");
        let record = WriteProbeRecord {
            schema_version: 3,
            display_name: "Probe".to_string(),
            revision: 1,
        };

        write_governed_json_config(&path, &record, |value| {
            if value.schema_version != 3 {
                return Err("schemaVersion mismatch".to_string());
            }
            Ok(())
        })
        .expect("write governed config");

        let outcome = read(&path).expect("read after write");
        match outcome {
            ConfigReadOutcome::Ready(record) => {
                assert_eq!(record.schema_version, 3);
                assert_eq!(record.display_name, "Probe");
            }
            other => panic!("expected Ready, got {other:?}"),
        }
        assert!(
            path.parent()
                .expect("parent")
                .read_dir()
                .expect("read dir")
                .all(|entry| !entry
                    .expect("entry")
                    .file_name()
                    .to_string_lossy()
                    .contains(".tmp.")),
            "governed write should leave no tmp file after a successful commit"
        );
    }

    #[test]
    fn governed_json_write_fails_before_serializing_when_validation_fails() {
        let path = temp_path("write-invalid");
        let record = WriteProbeRecord {
            schema_version: 0,
            display_name: "Probe".to_string(),
            revision: 1,
        };

        let error = write_governed_json_config(&path, &record, |value| {
            if value.schema_version == 0 {
                return Err("schemaVersion mismatch".to_string());
            }
            Ok(())
        })
        .expect_err("validation must fail");

        assert!(error.contains("schemaVersion mismatch"));
        assert!(!path.exists());
    }
}
