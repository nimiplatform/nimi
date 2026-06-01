//! Desktop Apps bridge projection command adapter.
//!
//! The Desktop Apps bridge (`apps-live-bridge.ts`) constructs a
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

use crate::apps_packages_projection::ensure_apps_packages;
use crate::apps_registry_projection::ensure_apps_registry;
use nimi_shell_tauri::platform_projection::apps_bridge::{
    build_apps_bridge_projection as build_shared_apps_bridge_projection, AppsBridgeProjection,
};

/// Build the Apps bridge projection.
///
/// Ensures both `~/.nimi` Apps projections are materialized, then projects them
/// (plus the immutable Platform release descriptor catalog) into the SDK
/// transport loader shapes the Desktop Apps bridge consumes.
pub fn build_apps_bridge_projection() -> Result<AppsBridgeProjection, String> {
    let registry = ensure_apps_registry()?;
    let packages = ensure_apps_packages()?;
    build_shared_apps_bridge_projection(registry.path, packages.path, &packages.record.packages)
}

#[tauri::command]
pub async fn apps_bridge_projection_get() -> Result<AppsBridgeProjection, String> {
    tauri::async_runtime::spawn_blocking(build_apps_bridge_projection)
        .await
        .map_err(|error| format!("apps_bridge_projection_get task failed: {error}"))?
}

#[cfg(test)]
mod tests {
    use super::build_apps_bridge_projection;
    use crate::desktop_product_control::select_product_data_root;
    use crate::test_support::with_env;
    use nimi_shell_tauri::platform_catalog::nimi_app_registry::{
        PLATFORM_NIMI_APP_REGISTRY_ROWS, PLATFORM_NIMI_APP_RELEASE_DESCRIPTOR_ROWS,
    };
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
                PLATFORM_NIMI_APP_REGISTRY_ROWS.len()
            );
            assert_eq!(
                projection.release_descriptors.len(),
                PLATFORM_NIMI_APP_RELEASE_DESCRIPTOR_ROWS.len()
            );
            // No install evidence on a fresh data root.
            assert!(projection.install_evidence.is_empty());
            // Avatar is projected with its true visibility so the SDK transport
            // filter drops it from ordinary Apps.
            let avatar = projection
                .registry_rows
                .iter()
                .find(|row| row.app_id == "nimi.avatar")
                .expect("avatar row");
            assert_eq!(avatar.ordinary_visibility, "hidden-internal");
        });
    }

    #[test]
    fn install_evidence_is_projected_from_packages_projection() {
        let home = temp_home("evidence");
        let data_root = home.join("nimi-data");
        with_env(&[("HOME", home.to_str())], || {
            select_product_data_root(data_root.to_str().expect("data root"))
                .expect("select data root");
            // Write Runtime install evidence for Avatar.
            let release_root = data_root
                .join("apps")
                .join("nimi.avatar")
                .join("releases")
                .join("1.0.0");
            let evidence_dir = release_root.join(".nimi");
            std::fs::create_dir_all(&evidence_dir).expect("mkdir");
            let app_root = data_root.join("apps").join("nimi.avatar");
            let evidence = serde_json::json!({
                "appId": "nimi.avatar",
                "releaseDescriptorRef": "nimi.avatar.bundled-with-nimi",
                "storagePolicyRef": "nimi-data-app-roots",
                "installedVersion": "1.0.0",
                "sha256": "abc123",
                "verificationState": "digest-verified",
                "releaseRoot": release_root.display().to_string(),
                "durableDataRoot": app_root.join("data").display().to_string(),
                "cacheRoot": app_root.join("cache").display().to_string(),
                "tempRoot": app_root.join("tmp").display().to_string()
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
                .find(|row| row.app_id == "nimi.avatar")
                .expect("avatar evidence");
            assert_eq!(row.verification_state, "digest-verified");
            assert_eq!(row.installed_version.as_deref(), Some("1.0.0"));
        });
    }
}
