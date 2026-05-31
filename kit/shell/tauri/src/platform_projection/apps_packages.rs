//! Shared `~/.nimi/apps/packages.json` record shape and validation.

use crate::platform_projection::apps_registry::AppsRegistryRecord;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

/// Supported `~/.nimi/apps/packages.json` schema version.
pub const APPS_PACKAGES_SCHEMA_VERSION: u32 = 2;

/// `~/.nimi`-relative location of the package projection.
pub const APPS_PACKAGES_POINTER: &str = "apps/packages.json";

const PACKAGE_STATE_INSTALLED: &str = "installed";
const PACKAGE_STATE_REPAIR_REQUIRED: &str = "repair_required";
const PACKAGE_STATE_BLOCKED: &str = "blocked";

/// One projected package row.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AppsPackageRow {
    pub app_id: String,
    pub package_ref: String,
    pub version: String,
    pub state: String,
    pub install_root: String,
    pub data_root: String,
    pub cache_root: String,
    pub temp_root: String,
    pub verified_at: String,
}

/// `~/.nimi/apps/packages.json` record shape.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AppsPackagesRecord {
    pub schema_version: u32,
    pub updated_at: String,
    pub packages: Vec<AppsPackageRow>,
}

/// Runtime-owned install-evidence file shape written under an app release root.
///
/// The package projection consumes only Runtime-written evidence fields. It
/// never re-derives app storage roots from `<nimi_data>/apps/<app-id>`.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeInstallEvidence {
    app_id: String,
    release_descriptor_ref: String,
    storage_policy_ref: String,
    installed_version: String,
    #[allow(dead_code)]
    #[serde(default)]
    sha256: String,
    verification_state: String,
    release_root: String,
    durable_data_root: String,
    cache_root: String,
    temp_root: String,
}

fn now_iso_timestamp() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

/// Map Runtime `appstorage.InstallEvidence.verificationState` onto the
/// product-level package `state` vocabulary.
pub fn project_package_state(verification_state: &str) -> &'static str {
    match verification_state {
        "digest-verified" => PACKAGE_STATE_INSTALLED,
        "digest-mismatch" => PACKAGE_STATE_REPAIR_REQUIRED,
        _ => PACKAGE_STATE_BLOCKED,
    }
}

/// Build a current-schema packages record from already scanned package rows.
pub fn build_apps_packages_record_from_rows(
    updated_at: String,
    packages: Vec<AppsPackageRow>,
) -> AppsPackagesRecord {
    AppsPackagesRecord {
        schema_version: APPS_PACKAGES_SCHEMA_VERSION,
        updated_at,
        packages,
    }
}

fn project_evidence_file(path: &Path) -> Result<Option<AppsPackageRow>, String> {
    if !path.exists() {
        return Ok(None);
    }
    let raw = fs::read_to_string(path).map_err(|error| {
        format!(
            "read Runtime app install evidence failed ({}): {error}",
            path.display()
        )
    })?;
    let evidence = serde_json::from_str::<RuntimeInstallEvidence>(&raw).map_err(|error| {
        format!(
            "parse Runtime app install evidence failed ({}): {error}",
            path.display()
        )
    })?;
    if evidence.app_id.trim().is_empty()
        || evidence.release_descriptor_ref.trim().is_empty()
        || evidence.installed_version.trim().is_empty()
        || evidence.storage_policy_ref.trim().is_empty()
        || evidence.release_root.trim().is_empty()
        || evidence.durable_data_root.trim().is_empty()
        || evidence.cache_root.trim().is_empty()
        || evidence.temp_root.trim().is_empty()
    {
        return Err(format!(
            "Runtime app install evidence is missing required fields ({})",
            path.display()
        ));
    }
    Ok(Some(AppsPackageRow {
        app_id: evidence.app_id,
        package_ref: evidence.release_descriptor_ref,
        version: evidence.installed_version,
        state: project_package_state(&evidence.verification_state).to_string(),
        install_root: evidence.release_root,
        data_root: evidence.durable_data_root,
        cache_root: evidence.cache_root,
        temp_root: evidence.temp_root,
        verified_at: now_iso_timestamp(),
    }))
}

/// Build the current package projection by scanning Runtime-written
/// install-evidence files for every app in the admitted registry projection.
///
/// The caller supplies the selected `nimi_data` root. This helper reads
/// Runtime evidence and projects package readiness; it does not validate,
/// create, or infer app storage truth.
pub fn build_apps_packages_record_from_runtime_install_evidence(
    data_root: &Path,
    registry: &AppsRegistryRecord,
) -> Result<AppsPackagesRecord, String> {
    let mut packages = Vec::new();
    for app in &registry.apps {
        let releases_root = data_root.join("apps").join(&app.app_id).join("releases");
        let Ok(entries) = fs::read_dir(&releases_root) else {
            continue;
        };
        for entry in entries.flatten() {
            let version_dir = entry.path();
            if !version_dir.is_dir() {
                continue;
            }
            let evidence_path = version_dir.join(".nimi").join("install-evidence.json");
            if let Some(row) = project_evidence_file(&evidence_path)? {
                if row.app_id != app.app_id {
                    return Err(format!(
                        "Runtime app install evidence appId {} does not match release root app {}",
                        row.app_id, app.app_id
                    ));
                }
                packages.push(row);
            }
        }
    }
    packages.sort_by(|a, b| {
        a.app_id
            .cmp(&b.app_id)
            .then_with(|| a.version.cmp(&b.version))
    });
    Ok(build_apps_packages_record_from_rows(
        now_iso_timestamp(),
        packages,
    ))
}

/// Structural validation of a package record.
pub fn validate_apps_packages_record(record: &AppsPackagesRecord) -> Result<(), String> {
    if record.schema_version != APPS_PACKAGES_SCHEMA_VERSION {
        return Err(format!(
            "unsupported ~/.nimi/apps/packages.json schemaVersion={} expected={APPS_PACKAGES_SCHEMA_VERSION}",
            record.schema_version
        ));
    }
    if record.updated_at.trim().is_empty() {
        return Err("~/.nimi/apps/packages.json updatedAt is required".to_string());
    }
    for package in &record.packages {
        if package.app_id.trim().is_empty()
            || package.package_ref.trim().is_empty()
            || package.version.trim().is_empty()
            || package.install_root.trim().is_empty()
            || package.data_root.trim().is_empty()
            || package.cache_root.trim().is_empty()
            || package.temp_root.trim().is_empty()
            || package.verified_at.trim().is_empty()
        {
            return Err(
                "~/.nimi/apps/packages.json package row requires appId, packageRef, version, installRoot, dataRoot, cacheRoot, tempRoot, and verifiedAt"
                    .to_string(),
            );
        }
        if !matches!(
            package.state.as_str(),
            PACKAGE_STATE_INSTALLED | PACKAGE_STATE_REPAIR_REQUIRED | PACKAGE_STATE_BLOCKED
        ) {
            return Err(format!(
                "~/.nimi/apps/packages.json package row {} has an unknown state: {}",
                package.app_id, package.state
            ));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        build_apps_packages_record_from_rows,
        build_apps_packages_record_from_runtime_install_evidence, project_package_state,
        validate_apps_packages_record, AppsPackageRow, AppsPackagesRecord, APPS_PACKAGES_POINTER,
        APPS_PACKAGES_SCHEMA_VERSION,
    };
    use crate::platform_projection::apps_registry::{
        build_apps_registry_record, AppsRegistryRecord,
    };
    use std::path::{Path, PathBuf};
    use std::time::{SystemTime, UNIX_EPOCH};

    fn package_row(state: &str) -> AppsPackageRow {
        AppsPackageRow {
            app_id: "nimi.avatar".to_string(),
            package_ref: "nimi.avatar.bundled-with-nimi".to_string(),
            version: "1.0.0".to_string(),
            state: state.to_string(),
            install_root: "/tmp/nimi/apps/nimi.avatar/releases/1.0.0".to_string(),
            data_root: "/tmp/nimi/apps/nimi.avatar/data".to_string(),
            cache_root: "/tmp/nimi/apps/nimi.avatar/cache".to_string(),
            temp_root: "/tmp/nimi/apps/nimi.avatar/tmp".to_string(),
            verified_at: "2026-05-31T00:00:00Z".to_string(),
        }
    }

    fn temp_data_root(prefix: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("nimi-kit-apps-packages-{prefix}-{unique}"));
        std::fs::create_dir_all(&dir).expect("create temp data root");
        dir
    }

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

    fn registry() -> AppsRegistryRecord {
        build_apps_registry_record().expect("registry")
    }

    #[test]
    fn runtime_verification_state_maps_to_package_state_floor() {
        assert_eq!(project_package_state("digest-verified"), "installed");
        assert_eq!(project_package_state("digest-mismatch"), "repair_required");
        assert_eq!(project_package_state("blocked"), "blocked");
        assert_eq!(project_package_state("unexpected"), "blocked");
    }

    #[test]
    fn record_builder_and_validation_keep_current_schema_shape() {
        let record = build_apps_packages_record_from_rows(
            "2026-05-31T00:00:00Z".to_string(),
            vec![package_row("installed")],
        );
        assert_eq!(record.schema_version, APPS_PACKAGES_SCHEMA_VERSION);
        validate_apps_packages_record(&record).expect("valid record");
        let raw = serde_json::to_string_pretty(&record).expect("serialize");
        let parsed: AppsPackagesRecord = serde_json::from_str(&raw).expect("deserialize");
        assert_eq!(record, parsed);
        assert!(APPS_PACKAGES_POINTER.ends_with("packages.json"));
    }

    #[test]
    fn validation_rejects_unknown_state() {
        let record = build_apps_packages_record_from_rows(
            "2026-05-31T00:00:00Z".to_string(),
            vec![package_row("ready-ish")],
        );
        let error = validate_apps_packages_record(&record).expect_err("unknown state");
        assert!(error.contains("unknown state"));
    }

    #[test]
    fn runtime_install_evidence_scanner_projects_package_rows() {
        let data_root = temp_data_root("project");
        write_runtime_evidence(&data_root, "nimi.avatar", "1.0.0", "digest-verified");
        let record =
            build_apps_packages_record_from_runtime_install_evidence(&data_root, &registry())
                .expect("packages");
        let row = record
            .packages
            .iter()
            .find(|row| row.app_id == "nimi.avatar")
            .expect("avatar package");
        assert_eq!(row.version, "1.0.0");
        assert_eq!(row.state, "installed");
        assert!(row.install_root.contains("releases"));
        assert!(row.data_root.ends_with("data"));
        assert!(row.cache_root.ends_with("cache"));
        assert!(row.temp_root.ends_with("tmp"));
    }

    #[test]
    fn runtime_install_evidence_scanner_fails_closed_on_corrupt_evidence() {
        let data_root = temp_data_root("corrupt");
        let evidence_dir = data_root
            .join("apps")
            .join("nimi.avatar")
            .join("releases")
            .join("1.0.0")
            .join(".nimi");
        std::fs::create_dir_all(&evidence_dir).expect("mkdir");
        std::fs::write(evidence_dir.join("install-evidence.json"), "{ bad json")
            .expect("write corrupt");
        let error =
            build_apps_packages_record_from_runtime_install_evidence(&data_root, &registry())
                .expect_err("corrupt evidence fails closed");
        assert!(error.contains("parse Runtime app install evidence failed"));
    }

    #[test]
    fn runtime_install_evidence_scanner_rejects_mismatched_app_id() {
        let data_root = temp_data_root("mismatch");
        let release_root = data_root
            .join("apps")
            .join("nimi.avatar")
            .join("releases")
            .join("1.0.0");
        let evidence_dir = release_root.join(".nimi");
        std::fs::create_dir_all(&evidence_dir).expect("mkdir evidence");
        let evidence = serde_json::json!({
            "appId": "other.app",
            "releaseDescriptorRef": "nimi.avatar.bundled-with-nimi",
            "storagePolicyRef": "nimi-data-app-roots",
            "installedVersion": "1.0.0",
            "verificationState": "digest-verified",
            "releaseRoot": release_root.display().to_string(),
            "durableDataRoot": data_root.join("apps").join("nimi.avatar").join("data").display().to_string(),
            "cacheRoot": data_root.join("apps").join("nimi.avatar").join("cache").display().to_string(),
            "tempRoot": data_root.join("apps").join("nimi.avatar").join("tmp").display().to_string()
        });
        std::fs::write(
            evidence_dir.join("install-evidence.json"),
            serde_json::to_string_pretty(&evidence).expect("json"),
        )
        .expect("write evidence");
        let error =
            build_apps_packages_record_from_runtime_install_evidence(&data_root, &registry())
                .expect_err("mismatch fails closed");
        assert!(error.contains("does not match release root app"));
    }
}
