//! `~/.nimi/apps/packages.json` — installed projection of Nimi App package
//! readiness.
//!
//! Product owner: Platform / Runtime package projection (product manual
//! `~/.nimi/apps/packages.json` subsection).
//!
//! The canonical package install truth is the Runtime `appstorage`
//! `InstallEvidence` record the Runtime app install gateway writes at
//! `<nimi_data>/apps/<app-id>/releases/<version>/.nimi/install-evidence.json`
//! (`runtime/internal/appstorage/storage.go`). That evidence and this
//! projection live on the same local filesystem; the Desktop host already
//! resolves the selected `nimi_data` root, so this projection is built by
//! scanning the Runtime-written install-evidence directly. No new RPC or
//! cross-process boundary is introduced — the Runtime keeps writing the
//! evidence, the Desktop host reads it and projects it into `~/.nimi`.
//!
//! Package projection is NOT app data. It records package readiness only;
//! removing a package never deletes app durable data.

use crate::apps_registry_projection::read_apps_registry;
use crate::desktop_paths::resolve_nimi_dir;
use crate::desktop_product_control::selected_product_data_root;
use nimi_shell_tauri::governed_config::{
    read_governed_config, write_governed_json_config, ConfigReadOutcome, GovernedConfigFile,
};
use nimi_shell_tauri::platform_projection::apps_packages::{
    build_apps_packages_record_from_runtime_install_evidence, validate_apps_packages_record,
};
pub use nimi_shell_tauri::platform_projection::apps_packages::{
    AppsPackagesRecord, APPS_PACKAGES_POINTER, APPS_PACKAGES_SCHEMA_VERSION,
};
use serde::Serialize;
use std::path::PathBuf;

/// Governed config-file identity for `~/.nimi/apps/packages.json`
/// (`local-config-file-registry.yaml` row `packages_json`).
const PACKAGES_CONFIG_FILE: GovernedConfigFile = GovernedConfigFile::new(
    "packages_json",
    "~/.nimi/apps/packages.json",
    APPS_PACKAGES_SCHEMA_VERSION,
);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppsPackagesProjection {
    pub path: String,
    pub record: AppsPackagesRecord,
}

/// On-disk path of the package projection, fixed under the `~/.nimi` CONTROL
/// root at `apps/packages.json`.
pub fn apps_packages_path() -> Result<PathBuf, String> {
    let mut path = resolve_nimi_dir()?;
    for segment in APPS_PACKAGES_POINTER.split('/') {
        path.push(segment);
    }
    Ok(path)
}

/// Build the package projection record by scanning the Runtime-written install
/// evidence under each admitted app's release roots.
///
/// The candidate app set is the admitted registry projection; for each app, the
/// `<nimi_data>/apps/<app-id>/releases/*/.nimi/install-evidence.json` files are
/// scanned. An app with no install evidence simply contributes no package row.
pub fn build_apps_packages_record() -> Result<AppsPackagesRecord, String> {
    let data_root = selected_product_data_root()?;
    let registry = read_apps_registry()?.ok_or_else(|| {
        "~/.nimi/apps/registry.json is required before package projection".to_string()
    })?;
    build_apps_packages_record_from_runtime_install_evidence(&data_root, &registry)
}

/// Read the installed package projection through the shared `~/.nimi`
/// current-schema repair framework.
///
/// Routes a parse failure, a missing / unknown `schemaVersion`, or a structural
/// fault to a typed `ConfigReadOutcome::Repair` (`P-MIG-004`) instead of a raw
/// `Err`. `ConfigReadOutcome::Absent` means the projection has not been
/// materialized; the deterministic [`ensure_apps_packages`] regeneration is the
/// recovery path.
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

/// Regenerate `~/.nimi/apps/packages.json` from the Runtime-written install
/// evidence and return the installed projection.
pub fn ensure_apps_packages() -> Result<AppsPackagesProjection, String> {
    let path = apps_packages_path()?;
    let record = build_apps_packages_record()?;
    write_governed_json_config(&path, &record, validate_apps_packages_record)?;
    Ok(AppsPackagesProjection {
        path: path.display().to_string(),
        record,
    })
}

#[cfg(test)]
mod tests {
    use super::{
        apps_packages_path, ensure_apps_packages, read_apps_packages_governed, AppsPackagesRecord,
        APPS_PACKAGES_POINTER, APPS_PACKAGES_SCHEMA_VERSION,
    };
    use crate::desktop_product_control::select_product_data_root;
    use crate::test_support::with_env;
    use nimi_shell_tauri::governed_config::{ConfigReadOutcome, ConfigRepairSeverity};
    use std::path::{Path, PathBuf};
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

    /// Write a Runtime-shaped install-evidence file under
    /// `<data_root>/apps/<app-id>/releases/<version>/.nimi/install-evidence.json`.
    fn write_runtime_evidence(
        data_root: &Path,
        app_id: &str,
        version: &str,
        verification_state: &str,
    ) {
        let release_root = data_root
            .join("apps")
            .join(app_id)
            .join("releases")
            .join(version);
        let evidence_dir = release_root.join(".nimi");
        std::fs::create_dir_all(&evidence_dir).expect("mkdir evidence");
        let evidence = serde_json::json!({
            "appId": app_id,
            "releaseDescriptorRef": format!("{app_id}.bundled-with-nimi"),
            "storagePolicyRef": "nimi-data-app-roots",
            "installedVersion": version,
            "sha256": "abc123",
            "verificationState": verification_state,
            "releaseRoot": release_root.display().to_string(),
            "durableDataRoot": data_root.join("apps").join(app_id).join("data").display().to_string(),
            "cacheRoot": data_root.join("apps").join(app_id).join("cache").display().to_string(),
            "tempRoot": data_root.join("apps").join(app_id).join("tmp").display().to_string()
        });
        std::fs::write(
            evidence_dir.join("install-evidence.json"),
            serde_json::to_string_pretty(&evidence).expect("json"),
        )
        .expect("write evidence");
    }

    #[test]
    fn projects_runtime_install_evidence_into_package_rows() {
        let home = temp_home("project");
        let data_root = home.join("nimi-data");
        with_env(&[("HOME", home.to_str())], || {
            select_product_data_root(data_root.to_str().expect("data root"))
                .expect("select data root");
            crate::apps_registry_projection::ensure_apps_registry().expect("ensure registry");
            write_runtime_evidence(&data_root, "nimi.avatar", "1.0.0", "digest-verified");
            let projection = ensure_apps_packages().expect("ensure packages");
            let row = projection
                .record
                .packages
                .iter()
                .find(|row| row.app_id == "nimi.avatar")
                .expect("avatar package row");
            assert_eq!(row.version, "1.0.0");
            assert_eq!(row.state, "installed");
            // Runtime app storage roots are intentionally not copied into the
            // package projection; consumers must call Runtime GetAppStorage.
        });
    }

    #[test]
    fn digest_mismatch_evidence_routes_repair_required() {
        let home = temp_home("repair");
        let data_root = home.join("nimi-data");
        with_env(&[("HOME", home.to_str())], || {
            select_product_data_root(data_root.to_str().expect("data root"))
                .expect("select data root");
            crate::apps_registry_projection::ensure_apps_registry().expect("ensure registry");
            write_runtime_evidence(&data_root, "nimi.avatar", "1.0.0", "digest-mismatch");
            let projection = ensure_apps_packages().expect("ensure packages");
            let row = projection
                .record
                .packages
                .iter()
                .find(|row| row.app_id == "nimi.avatar")
                .expect("avatar package row");
            assert_eq!(row.state, "repair_required");
        });
    }

    #[test]
    fn no_install_evidence_projects_empty_package_set() {
        let home = temp_home("empty");
        let data_root = home.join("nimi-data");
        with_env(&[("HOME", home.to_str())], || {
            select_product_data_root(data_root.to_str().expect("data root"))
                .expect("select data root");
            crate::apps_registry_projection::ensure_apps_registry().expect("ensure registry");
            let projection = ensure_apps_packages().expect("ensure packages");
            assert!(projection.record.packages.is_empty());
        });
    }

    #[test]
    fn corrupt_runtime_evidence_fails_closed() {
        let home = temp_home("corrupt-evidence");
        let data_root = home.join("nimi-data");
        with_env(&[("HOME", home.to_str())], || {
            select_product_data_root(data_root.to_str().expect("data root"))
                .expect("select data root");
            crate::apps_registry_projection::ensure_apps_registry().expect("ensure registry");
            let evidence_dir = data_root
                .join("apps")
                .join("nimi.avatar")
                .join("releases")
                .join("1.0.0")
                .join(".nimi");
            std::fs::create_dir_all(&evidence_dir).expect("mkdir");
            std::fs::write(evidence_dir.join("install-evidence.json"), "{ bad json")
                .expect("write corrupt");
            let error = ensure_apps_packages().expect_err("corrupt evidence fails closed");
            assert!(error.contains("parse"));
        });
    }

    #[test]
    fn unknown_future_schema_version_routes_repair_required() {
        let home = temp_home("future-schema");
        let data_root = home.join("nimi-data");
        with_env(&[("HOME", home.to_str())], || {
            select_product_data_root(data_root.to_str().expect("data root"))
                .expect("select data root");
            crate::apps_registry_projection::ensure_apps_registry().expect("ensure registry");
            ensure_apps_packages().expect("ensure packages");
            let path = apps_packages_path().expect("path");
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
