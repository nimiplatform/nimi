//! Desktop Apps bridge projection command.
//!
//! The Desktop Apps bridge (`nimi-home-live-bridge.ts`) constructs a
//! `NimiAppClient` over `createNimiAppRegistryTransport`, which needs three
//! loader payloads in the SDK Nimi App client shapes:
//! - registry rows (`NimiAppRegistrySourceRow[]`),
//! - release descriptors (`NimiAppReleaseDescriptorRow[]`),
//! - install evidence (`NimiAppInstallEvidenceRow[]`).
//!
//! T4 Fork C: `~/.nimi/apps/registry.json` is the runtime source the Apps
//! bridge reads — the build-time `generated.ts` is retired as the bridge
//! source. This command is the seam: it ensures both `~/.nimi` Apps
//! projections (`registry.json`, `packages.json`) are materialized from
//! catalog + Runtime-evidence truth, then projects them into the exact SDK
//! transport shapes so the bridge consumes the `~/.nimi` projection rather
//! than a packaged build-time catalog.
//!
//! The release descriptors are sourced from the same packaged Platform release
//! descriptor catalog the registry projection resolves against; they are
//! immutable Platform admission truth, not user-local state, so they do not
//! need a separate `~/.nimi` projection file.

use crate::apps_packages_projection::{ensure_apps_packages, AppsPackageRow};
use crate::apps_registry_projection::ensure_apps_registry;
use crate::platform_nimi_app_registry::{
    resolve_release_descriptor, PlatformNimiAppRegistryRow, PLATFORM_NIMI_APP_REGISTRY_ROWS,
    PLATFORM_NIMI_APP_RELEASE_DESCRIPTOR_ROWS,
};
use serde::Serialize;

/// SDK `NimiAppRegistrySourceRow`-shaped row for the bridge `loadRows` loader.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeRegistryRow {
    pub app_id: String,
    pub app_kind: String,
    pub display_name: String,
    pub publisher: String,
    pub trust_tier: String,
    pub ordinary_visibility: String,
    pub release_descriptor_ref: String,
    pub install_storage_policy_ref: String,
    pub source_rule: String,
    pub admission_status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub installed_version: Option<String>,
}

/// SDK `NimiAppReleaseDescriptorRow`-shaped row for the bridge
/// `loadReleaseDescriptors` loader. Only the digest-verification fields the SDK
/// transport reads are projected; the descriptor catalog is immutable Platform
/// admission truth.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeReleaseDescriptorRow {
    pub descriptor_id: String,
    pub app_id: String,
    pub version: String,
    pub descriptor_class: String,
    pub source_kind: String,
    pub source_ref: String,
    pub artifact_locator: String,
    pub digest_algorithm: String,
    pub sha256: String,
    pub size: String,
    pub provenance_ref: String,
    pub package_kind: String,
    pub entry_ref: String,
    pub sandbox_ref: String,
    pub permissions_ref: String,
    pub storage_policy_ref: String,
    pub admission_path: String,
    pub mutable_source_allowed: bool,
    pub install_digest_verification_required: String,
    pub source_rule: String,
}

/// SDK `NimiAppStorageRoots`-shaped object.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeStorageRoots {
    pub release_root: String,
    pub data_root: String,
    pub cache_root: String,
    pub temp_root: String,
}

/// SDK `NimiAppInstallEvidenceRow`-shaped row for the bridge
/// `loadInstallEvidence` loader, sourced from `~/.nimi/apps/packages.json`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeInstallEvidenceRow {
    pub app_id: String,
    pub release_descriptor_ref: String,
    pub storage_policy_ref: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub installed_version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sha256: Option<String>,
    pub verification_state: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub storage_roots: Option<BridgeStorageRoots>,
}

/// The full bridge projection payload: the three SDK-shaped loader inputs.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppsBridgeProjection {
    pub registry_path: String,
    pub packages_path: String,
    pub registry_rows: Vec<BridgeRegistryRow>,
    pub release_descriptors: Vec<BridgeReleaseDescriptorRow>,
    pub install_evidence: Vec<BridgeInstallEvidenceRow>,
}

/// Project one packaged registry catalog row to an SDK-shaped bridge row.
///
/// The SDK transport applies its own ordinary-visible + admitted filter; this
/// command projects every catalog row in its true catalog shape so that filter
/// can run. Avatar (`hidden-internal`) and Tester (`developer-only`) are
/// projected with their true `ordinary_visibility`, so the SDK filter drops
/// them from the ordinary Apps surface.
fn project_registry_row(row: &PlatformNimiAppRegistryRow) -> BridgeRegistryRow {
    BridgeRegistryRow {
        app_id: row.app_id.to_string(),
        app_kind: row.app_kind.to_string(),
        display_name: row.display_name.to_string(),
        publisher: row.publisher.to_string(),
        trust_tier: row.trust_tier.to_string(),
        ordinary_visibility: row.ordinary_visibility.to_string(),
        release_descriptor_ref: row.release_descriptor_ref.to_string(),
        install_storage_policy_ref: row.install_storage_policy_ref.to_string(),
        source_rule: row.source_rule.to_string(),
        admission_status: row.admission_status.to_string(),
        installed_version: None,
    }
}

/// Map a `~/.nimi/apps/packages.json` package row onto an SDK install-evidence
/// row. The package projection product `state` is mapped back to the SDK
/// `NimiAppInstallVerificationState` floor the transport readiness logic reads.
fn project_install_evidence(package: &AppsPackageRow) -> BridgeInstallEvidenceRow {
    let verification_state = match package.state.as_str() {
        "installed" => "digest-verified",
        "repair_required" => "digest-mismatch",
        // `blocked` or any unexpected value -> blocked: a package whose Runtime
        // evidence is not verified is never projected as installable-ready.
        _ => "blocked",
    };
    let storage_policy_ref = resolve_release_descriptor(&package.package_ref)
        .map(|descriptor| descriptor.storage_policy_ref.to_string())
        .unwrap_or_default();
    BridgeInstallEvidenceRow {
        app_id: package.app_id.clone(),
        release_descriptor_ref: package.package_ref.clone(),
        storage_policy_ref,
        installed_version: Some(package.version.clone()),
        sha256: resolve_release_descriptor(&package.package_ref)
            .map(|descriptor| descriptor.sha256.to_string()),
        verification_state: verification_state.to_string(),
        // Package projection records the release root; the SDK transport needs
        // the full storage-root quartet to treat evidence as resolved. The
        // sibling data/cache/tmp roots are derived from the release root's
        // app-root parent, mirroring `appstorage.Resolve`.
        storage_roots: derive_storage_roots(&package.install_root),
    }
}

/// Derive the SDK storage-root quartet from a release root.
///
/// `appstorage.Resolve` lays out `<dataRoot>/apps/<app-id>/releases/<version>`,
/// with sibling `data`, `cache`, `tmp` directories under the app root. The
/// release root recorded in `packages.json` is `.../releases/<version>`; the
/// app root is its grandparent.
fn derive_storage_roots(release_root: &str) -> Option<BridgeStorageRoots> {
    let release_path = std::path::Path::new(release_root);
    let app_root = release_path.parent()?.parent()?;
    Some(BridgeStorageRoots {
        release_root: release_root.to_string(),
        data_root: app_root.join("data").display().to_string(),
        cache_root: app_root.join("cache").display().to_string(),
        temp_root: app_root.join("tmp").display().to_string(),
    })
}

/// Build the Apps bridge projection.
///
/// Ensures both `~/.nimi` Apps projections are materialized, then projects them
/// (plus the immutable Platform release descriptor catalog) into the SDK
/// transport loader shapes the Desktop Apps bridge consumes.
pub fn build_apps_bridge_projection() -> Result<AppsBridgeProjection, String> {
    let registry = ensure_apps_registry()?;
    let packages = ensure_apps_packages()?;
    let registry_rows = PLATFORM_NIMI_APP_REGISTRY_ROWS
        .iter()
        .map(project_registry_row)
        .collect();
    let release_descriptors = PLATFORM_NIMI_APP_RELEASE_DESCRIPTOR_ROWS
        .iter()
        .map(|descriptor| BridgeReleaseDescriptorRow {
            descriptor_id: descriptor.descriptor_id.to_string(),
            app_id: descriptor.app_id.to_string(),
            version: descriptor.version.to_string(),
            descriptor_class: descriptor.descriptor_class.to_string(),
            source_kind: descriptor.source_kind.to_string(),
            // bundled-with-nimi descriptors bind to the atomic Nimi release;
            // the source ref is the bundle marker, not a mutable git ref.
            source_ref: "current-atomic-nimi-release".to_string(),
            artifact_locator: "current-nimi-release-bundle".to_string(),
            digest_algorithm: descriptor.digest_algorithm.to_string(),
            sha256: descriptor.sha256.to_string(),
            size: "inherited-from-atomic-nimi-release-manifest".to_string(),
            provenance_ref: "nimi-first-party-signature-policy".to_string(),
            package_kind: descriptor.package_kind.to_string(),
            entry_ref: format!("{}-runtime-registration", descriptor.app_id),
            sandbox_ref: "first-party-bundled-app".to_string(),
            permissions_ref: format!("{}.permission_scope_ref", descriptor.app_id),
            storage_policy_ref: descriptor.storage_policy_ref.to_string(),
            admission_path: descriptor.admission_path.to_string(),
            mutable_source_allowed: descriptor.mutable_source_allowed,
            install_digest_verification_required: descriptor
                .install_digest_verification_required
                .to_string(),
            source_rule: descriptor.source_rule.to_string(),
        })
        .collect();
    let install_evidence = packages
        .record
        .packages
        .iter()
        .map(project_install_evidence)
        .collect();
    Ok(AppsBridgeProjection {
        registry_path: registry.path,
        packages_path: packages.path,
        registry_rows,
        release_descriptors,
        install_evidence,
    })
}

#[tauri::command]
pub fn apps_bridge_projection_get() -> Result<AppsBridgeProjection, String> {
    build_apps_bridge_projection()
}

#[cfg(test)]
mod tests {
    use super::{build_apps_bridge_projection, derive_storage_roots};
    use crate::desktop_product_control::select_product_data_root;
    use crate::test_support::with_env;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_home(prefix: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("nimi-apps-bridge-{prefix}-{unique}"));
        std::fs::create_dir_all(&dir).expect("create temp home");
        dir
    }

    #[test]
    fn projection_includes_all_catalog_registry_rows_and_release_descriptors() {
        let home = temp_home("rows");
        let data_root = home.join("nimi-data");
        with_env(&[("HOME", home.to_str())], || {
            select_product_data_root(data_root.to_str().expect("data root"))
                .expect("select data root");
            let projection = build_apps_bridge_projection().expect("projection");
            assert_eq!(
                projection.registry_rows.len(),
                super::PLATFORM_NIMI_APP_REGISTRY_ROWS.len()
            );
            assert_eq!(
                projection.release_descriptors.len(),
                super::PLATFORM_NIMI_APP_RELEASE_DESCRIPTOR_ROWS.len()
            );
            // No install evidence on a fresh data root.
            assert!(projection.install_evidence.is_empty());
            // Avatar/Tester are projected with their true visibility so the SDK
            // transport filter drops them from ordinary Apps.
            let avatar = projection
                .registry_rows
                .iter()
                .find(|row| row.app_id == "nimi.avatar")
                .expect("avatar row");
            assert_eq!(avatar.ordinary_visibility, "hidden-internal");
            let tester = projection
                .registry_rows
                .iter()
                .find(|row| row.app_id == "nimi.tester")
                .expect("tester row");
            assert_eq!(tester.ordinary_visibility, "developer-only");
        });
    }

    #[test]
    fn install_evidence_is_projected_from_packages_projection() {
        let home = temp_home("evidence");
        let data_root = home.join("nimi-data");
        with_env(&[("HOME", home.to_str())], || {
            select_product_data_root(data_root.to_str().expect("data root"))
                .expect("select data root");
            // Write Runtime install evidence for ParentOS.
            let release_root = data_root
                .join("apps")
                .join("nimi.parentos")
                .join("releases")
                .join("1.0.0");
            let evidence_dir = release_root.join(".nimi");
            std::fs::create_dir_all(&evidence_dir).expect("mkdir");
            let evidence = serde_json::json!({
                "appId": "nimi.parentos",
                "releaseDescriptorRef": "nimi.parentos.bundled-with-nimi",
                "storagePolicyRef": "nimi-data-app-roots",
                "installedVersion": "1.0.0",
                "sha256": "abc123",
                "verificationState": "digest-verified",
                "releaseRoot": release_root.display().to_string(),
                "durableDataRoot": "",
                "cacheRoot": "",
                "tempRoot": ""
            });
            std::fs::write(
                evidence_dir.join("install-evidence.json"),
                serde_json::to_string_pretty(&evidence).expect("json"),
            )
            .expect("write evidence");
            let projection = build_apps_bridge_projection().expect("projection");
            let row = projection
                .install_evidence
                .iter()
                .find(|row| row.app_id == "nimi.parentos")
                .expect("parentos evidence");
            assert_eq!(row.verification_state, "digest-verified");
            assert_eq!(row.installed_version.as_deref(), Some("1.0.0"));
            let roots = row.storage_roots.as_ref().expect("storage roots");
            assert!(roots.release_root.contains("releases"));
            assert!(roots.data_root.ends_with("data"));
        });
    }

    #[test]
    fn derive_storage_roots_resolves_app_root_siblings() {
        let roots =
            derive_storage_roots("/data/apps/nimi.parentos/releases/1.0.0").expect("storage roots");
        assert_eq!(
            roots.release_root,
            "/data/apps/nimi.parentos/releases/1.0.0"
        );
        assert_eq!(roots.data_root, "/data/apps/nimi.parentos/data");
        assert_eq!(roots.cache_root, "/data/apps/nimi.parentos/cache");
        assert_eq!(roots.temp_root, "/data/apps/nimi.parentos/tmp");
    }
}
