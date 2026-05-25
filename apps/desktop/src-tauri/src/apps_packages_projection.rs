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
use crate::local_config_migration::{
    read_governed_config, ConfigReadOutcome, GovernedConfigFile, MigrationRegistry,
};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

/// Supported `~/.nimi/apps/packages.json` schema version. An unknown future
/// version or an old version with no registered migration fails closed to a
/// typed repair outcome through the `local_config_migration` framework
/// (`P-MIG-002`).
pub const APPS_PACKAGES_SCHEMA_VERSION: u32 = 1;

/// Governed config-file identity for `~/.nimi/apps/packages.json`
/// (`local-config-file-registry.yaml` row `packages_json`).
const PACKAGES_CONFIG_FILE: GovernedConfigFile =
    GovernedConfigFile::new("packages_json", "~/.nimi/apps/packages.json");

/// The shared-framework migration registry for `~/.nimi/apps/packages.json`.
///
/// The package projection is deterministically rebuilt from Runtime-written
/// install evidence; a schema bump's forward migration is owned by its T4
/// schema owner and registered here. No version has been bumped yet, so the
/// step set is empty — an old/unknown version then fails closed to repair
/// (`P-MIG-002`), and the repair action is the deterministic
/// [`ensure_apps_packages`] regeneration.
const PACKAGES_MIGRATIONS: MigrationRegistry =
    MigrationRegistry::new("packages_json", APPS_PACKAGES_SCHEMA_VERSION, &[]);

/// `~/.nimi`-relative location of the package projection. This is the manual
/// `~/.nimi/nimi.json` `pointers.appPackages` value.
pub const APPS_PACKAGES_POINTER: &str = "apps/packages.json";

/// Closed product-level package `state` vocabulary. Mirrors the
/// `appstorage.InstallEvidence` `verificationState` floor.
const PACKAGE_STATE_INSTALLED: &str = "installed";
const PACKAGE_STATE_REPAIR_REQUIRED: &str = "repair_required";
const PACKAGE_STATE_BLOCKED: &str = "blocked";

/// The Runtime-owned install-evidence file shape, mirrored from
/// `runtime/internal/appstorage/storage.go` `InstallEvidence`. Only the fields
/// the package projection consumes are deserialized; unknown fields are
/// ignored so a Runtime-side additive field never breaks the read.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeInstallEvidence {
    app_id: String,
    release_descriptor_ref: String,
    storage_policy_ref: String,
    installed_version: String,
    // Mirrors `appstorage.InstallEvidence.SHA256`; retained for shape parity
    // with the Runtime-written file. Package readiness is derived from
    // `verification_state`, so the digest itself is not consumed here.
    #[allow(dead_code)]
    #[serde(default)]
    sha256: String,
    verification_state: String,
    release_root: String,
}

/// One projected package row. The minimum product fields are fixed by the
/// manual `~/.nimi/apps/packages.json` schema:
/// `appId, packageRef, version, state, installRoot, verifiedAt`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AppsPackageRow {
    pub app_id: String,
    pub package_ref: String,
    pub version: String,
    pub state: String,
    pub install_root: String,
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

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppsPackagesProjection {
    pub path: String,
    pub record: AppsPackagesRecord,
}

fn now_iso_timestamp() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

fn now_unix_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
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

/// Map the Runtime `appstorage` `verificationState` onto the product-level
/// package `state`.
fn project_package_state(verification_state: &str) -> &'static str {
    match verification_state {
        "digest-verified" => PACKAGE_STATE_INSTALLED,
        "digest-mismatch" => PACKAGE_STATE_REPAIR_REQUIRED,
        // `not-installed`, `blocked`, `unsupported`, or any unexpected value
        // fail closed: a package whose Runtime evidence is not verified is not
        // projected as installed.
        _ => PACKAGE_STATE_BLOCKED,
    }
}

/// Scan one Runtime install-evidence file and project a package row.
///
/// Returns `Ok(None)` when the file does not exist; fails closed on a parse
/// failure (a corrupt evidence file is a real readiness fault, not absence).
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
        verified_at: now_iso_timestamp(),
    }))
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
    let mut packages = Vec::new();
    for app in &registry.apps {
        let releases_root = data_root.join("apps").join(&app.app_id).join("releases");
        let Ok(entries) = fs::read_dir(&releases_root) else {
            // No releases directory for this app yet — no package row.
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
    Ok(AppsPackagesRecord {
        schema_version: APPS_PACKAGES_SCHEMA_VERSION,
        updated_at: now_iso_timestamp(),
        packages,
    })
}

/// Structural validation of a package record.
///
/// `schemaVersion` fail-closed / migration routing is owned by the
/// `local_config_migration` framework (`P-MIG-002`); the `schemaVersion` check
/// here is a defensive post-migration assertion. A failure routes the read to
/// `repair_required`, never a raw `Err`.
fn validate_record(record: &AppsPackagesRecord) -> Result<(), String> {
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
            || package.verified_at.trim().is_empty()
        {
            return Err(
                "~/.nimi/apps/packages.json package row requires appId, packageRef, version, installRoot, and verifiedAt"
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

fn write_record(path: &Path, record: &AppsPackagesRecord) -> Result<(), String> {
    validate_record(record)?;
    let parent = path
        .parent()
        .ok_or_else(|| "~/.nimi/apps/packages.json path has no parent directory".to_string())?;
    fs::create_dir_all(parent).map_err(|error| {
        format!(
            "create ~/.nimi/apps directory failed ({}): {error}",
            parent.display()
        )
    })?;
    let raw = serde_json::to_string_pretty(record)
        .map_err(|error| format!("serialize ~/.nimi/apps/packages.json failed: {error}"))?;
    let tmp_path =
        path.with_extension(format!("json.tmp.{}.{}", std::process::id(), now_unix_ms()));
    fs::write(&tmp_path, raw).map_err(|error| {
        format!(
            "write ~/.nimi/apps/packages.json temporary file failed ({}): {error}",
            tmp_path.display()
        )
    })?;
    fs::rename(&tmp_path, path).map_err(|error| {
        format!(
            "commit ~/.nimi/apps/packages.json failed ({}): {error}",
            path.display()
        )
    })
}

/// Read the installed package projection through the shared `~/.nimi`
/// migration / repair framework.
///
/// Routes a parse failure, a missing / unknown `schemaVersion`, or a structural
/// fault to a typed `ConfigReadOutcome::Repair` (`P-MIG-004`) instead of a raw
/// `Err`. `ConfigReadOutcome::Absent` means the projection has not been
/// materialized; the deterministic [`ensure_apps_packages`] regeneration is the
/// recovery path.
#[allow(dead_code)]
pub fn read_apps_packages_governed() -> Result<ConfigReadOutcome<AppsPackagesRecord>, String> {
    let path = apps_packages_path()?;
    read_governed_config(
        &PACKAGES_CONFIG_FILE,
        &path,
        &PACKAGES_MIGRATIONS,
        |document| {
            let record: AppsPackagesRecord = serde_json::from_value(document.clone())
                .map_err(|error| format!("package projection cannot be deserialized: {error}"))?;
            validate_record(&record)?;
            Ok(record)
        },
    )
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
    write_record(&path, &record)?;
    Ok(AppsPackagesProjection {
        path: path.display().to_string(),
        record,
    })
}

#[tauri::command]
pub async fn apps_packages_get() -> Result<AppsPackagesProjection, String> {
    tauri::async_runtime::spawn_blocking(ensure_apps_packages)
        .await
        .map_err(|error| format!("apps_packages_get task failed: {error}"))?
}

#[cfg(test)]
mod tests {
    use super::{
        apps_packages_path, ensure_apps_packages, read_apps_packages_governed, AppsPackagesRecord,
        APPS_PACKAGES_POINTER, APPS_PACKAGES_SCHEMA_VERSION,
    };
    use crate::desktop_product_control::select_product_data_root;
    use crate::local_config_migration::{ConfigReadOutcome, ConfigRepairSeverity};
    use crate::test_support::with_env;
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
            write_runtime_evidence(&data_root, "nimi.shijing", "1.0.0", "digest-verified");
            let projection = ensure_apps_packages().expect("ensure packages");
            let row = projection
                .record
                .packages
                .iter()
                .find(|row| row.app_id == "nimi.shijing")
                .expect("shijing package row");
            assert_eq!(row.version, "1.0.0");
            assert_eq!(row.state, "installed");
            assert!(row.install_root.contains("releases"));
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
            write_runtime_evidence(&data_root, "nimi.shijing", "1.0.0", "digest-mismatch");
            let projection = ensure_apps_packages().expect("ensure packages");
            let row = projection
                .record
                .packages
                .iter()
                .find(|row| row.app_id == "nimi.shijing")
                .expect("shijing package row");
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
                .join("nimi.shijing")
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
