//! Desktop Apps bridge projection command adapter.
//!
//! The Desktop Apps bridge (`apps-live-bridge.ts`) constructs a
//! `NimiAppClient` over `createNimiAppRegistryTransport`, which needs three
//! loader payloads in the SDK Nimi App client shapes:
//! - registry rows (`NimiAppRegistrySourceRow[]`),
//! - release descriptors (`NimiAppReleaseDescriptorRow[]`).
//!
//! T4 Fork C: `~/.nimi/apps/registry.json` is the runtime source the Apps
//! bridge reads — the build-time `generated.ts` is retired as the bridge
//! source. This command is the seam: it ensures the `~/.nimi` Apps registry
//! projection is materialized from Platform catalog truth, then projects it
//! into the exact SDK transport shapes. Package readiness is requested from
//! Runtime `GetAppPackageReadiness`; Desktop does not scan Runtime evidence.
//!
//! The release descriptors are sourced from the same packaged Platform release
//! descriptor catalog the registry projection resolves against; they are
//! immutable Platform admission truth, not user-local state, so they do not
//! need a separate `~/.nimi` projection file.

use crate::apps_registry_projection::ensure_apps_registry;
use crate::desktop_paths::resolve_nimi_dir;
use nimi_shell_tauri::platform_projection::apps_bridge::{
    build_apps_bridge_projection as build_shared_apps_bridge_projection, AppsBridgeProjection,
};
use nimi_shell_tauri::platform_projection::apps_packages::APPS_PACKAGES_POINTER;

/// Build the Apps bridge projection.
///
/// Ensures `~/.nimi/apps/registry.json` is materialized, then projects it plus
/// the immutable Platform release descriptor catalog into the SDK transport
/// loader shapes the Desktop Apps bridge consumes.
pub fn build_apps_bridge_projection() -> Result<AppsBridgeProjection, String> {
    let registry = ensure_apps_registry()?;
    let packages_path = apps_packages_pointer_path()?;
    build_shared_apps_bridge_projection(registry.path, packages_path)
}

fn apps_packages_pointer_path() -> Result<String, String> {
    let mut path = resolve_nimi_dir()?;
    for segment in APPS_PACKAGES_POINTER.split('/') {
        path.push(segment);
    }
    Ok(path.display().to_string())
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
    fn projection_does_not_project_runtime_install_evidence() {
        let home = temp_home("evidence");
        let data_root = home.join("nimi-data");
        with_env(&[("HOME", home.to_str())], || {
            select_product_data_root(data_root.to_str().expect("data root"))
                .expect("select data root");
            let projection = build_apps_bridge_projection().expect("projection");
            let raw = serde_json::to_value(&projection).expect("projection json");
            assert!(
                raw.get("installEvidence").is_none(),
                "Runtime package readiness must not be bridged from host-scanned install evidence"
            );
        });
    }
}
