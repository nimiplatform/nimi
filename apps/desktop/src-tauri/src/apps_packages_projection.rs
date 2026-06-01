//! `~/.nimi/apps/packages.json` — discoverability pointer for Nimi App package
//! projection records.
//!
//! Runtime package readiness is exposed by `GetAppPackageReadiness`. Desktop
//! must not scan Runtime install evidence or materialize package readiness from
//! `<nimi_data>/apps/**`.

use crate::desktop_paths::resolve_nimi_dir;
use nimi_shell_tauri::governed_config::{
    read_governed_config, ConfigReadOutcome, GovernedConfigFile,
};
pub use nimi_shell_tauri::platform_projection::apps_packages::{
    validate_apps_packages_record, AppsPackagesRecord, APPS_PACKAGES_POINTER,
    APPS_PACKAGES_SCHEMA_VERSION,
};
use std::path::PathBuf;

/// Governed config-file identity for `~/.nimi/apps/packages.json`
/// (`local-config-file-registry.yaml` row `packages_json`).
const PACKAGES_CONFIG_FILE: GovernedConfigFile = GovernedConfigFile::new(
    "packages_json",
    "~/.nimi/apps/packages.json",
    APPS_PACKAGES_SCHEMA_VERSION,
);

/// On-disk path of the package projection, fixed under the `~/.nimi` CONTROL
/// root at `apps/packages.json`.
pub fn apps_packages_path() -> Result<PathBuf, String> {
    let mut path = resolve_nimi_dir()?;
    for segment in APPS_PACKAGES_POINTER.split('/') {
        path.push(segment);
    }
    Ok(path)
}

/// Read the installed package projection through the shared `~/.nimi`
/// current-schema repair framework.
///
/// Routes a parse failure, a missing / unknown `schemaVersion`, or a structural
/// fault to a typed `ConfigReadOutcome::Repair` (`P-MIG-004`) instead of a raw
/// `Err`. `ConfigReadOutcome::Absent` means no discoverability projection has
/// been materialized; it does not imply package readiness.
#[allow(dead_code)]
pub fn read_apps_packages_governed() -> Result<ConfigReadOutcome<AppsPackagesRecord>, String> {
    let path = apps_packages_path()?;
    read_governed_config(&PACKAGES_CONFIG_FILE, &path, |document| {
        let record: AppsPackagesRecord = serde_json::from_value(document.clone())
            .map_err(|error| format!("package projection cannot be deserialized: {error}"))?;
        validate_apps_packages_record(&record)?;
        Ok(record)
    })
}

/// Read the installed package projection, if present.
///
/// Thin presence-shaped adapter over [`read_apps_packages_governed`]: a routed
/// repair state is surfaced as the typed repair reason; `Absent` maps to
/// `Ok(None)`.
#[allow(dead_code)]
pub fn read_apps_packages() -> Result<Option<AppsPackagesRecord>, String> {
    match read_apps_packages_governed()? {
        ConfigReadOutcome::Absent => Ok(None),
        ConfigReadOutcome::Ready(record) => Ok(Some(record)),
        ConfigReadOutcome::Repair { reason, .. } => Err(reason),
    }
}

#[cfg(test)]
mod tests {
    use super::{
        apps_packages_path, read_apps_packages_governed, AppsPackagesRecord, APPS_PACKAGES_POINTER,
        APPS_PACKAGES_SCHEMA_VERSION,
    };
    use crate::test_support::with_env;
    use nimi_shell_tauri::governed_config::write_governed_json_config;
    use nimi_shell_tauri::governed_config::{ConfigReadOutcome, ConfigRepairSeverity};
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_home(prefix: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("nimi-apps-packages-{prefix}-{unique}"));
        std::fs::create_dir_all(&dir).expect("create temp home");
        dir
    }

    #[test]
    fn unknown_future_schema_version_routes_repair_required() {
        let home = temp_home("future-schema");
        with_env(&[("HOME", home.to_str())], || {
            let path = apps_packages_path().expect("path");
            let record = AppsPackagesRecord {
                schema_version: APPS_PACKAGES_SCHEMA_VERSION,
                updated_at: "2026-05-21T00:00:00.000Z".to_string(),
                packages: Vec::new(),
            };
            write_governed_json_config(&path, &record, super::validate_apps_packages_record)
                .expect("write packages record");
            let mut record = serde_json::from_str::<serde_json::Value>(
                &std::fs::read_to_string(&path).expect("read"),
            )
            .expect("parse");
            record
                .as_object_mut()
                .expect("object")
                .insert("schemaVersion".to_string(), serde_json::json!(9999));
            let future_raw = serde_json::to_string_pretty(&record).expect("json");
            std::fs::write(&path, &future_raw).expect("write future schema");
            // P-MIG-002 / P-MIG-004: unknown future version -> typed repair.
            match read_apps_packages_governed().expect("governed read") {
                ConfigReadOutcome::Repair { severity, reason } => {
                    assert_eq!(severity, ConfigRepairSeverity::RepairRequired);
                    assert!(reason.contains("newer than the supported version"));
                }
                other => panic!("expected repair_required, got {other:?}"),
            }
            assert_eq!(
                std::fs::read_to_string(&path).expect("read after"),
                future_raw,
                "the faulted file is left intact for repair"
            );
        });
    }

    #[test]
    fn serde_round_trip_preserves_record() {
        let record = AppsPackagesRecord {
            schema_version: APPS_PACKAGES_SCHEMA_VERSION,
            updated_at: "2026-05-21T00:00:00.000Z".to_string(),
            packages: Vec::new(),
        };
        let raw = serde_json::to_string_pretty(&record).expect("serialize");
        let parsed: AppsPackagesRecord = serde_json::from_str(&raw).expect("deserialize");
        assert_eq!(record, parsed);
        assert!(APPS_PACKAGES_POINTER.ends_with("packages.json"));
    }
}
