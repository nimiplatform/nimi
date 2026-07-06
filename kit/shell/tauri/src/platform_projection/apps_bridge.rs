//! Shared SDK-shaped Apps bridge projection mapping.

use crate::platform_catalog::nimi_app_registry::{
    PlatformNimiAppRegistryRow, PLATFORM_NIMI_APP_REGISTRY_ROWS,
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
    pub ai_profile_selection_ref: String,
    pub capability_set: Vec<String>,
    pub release_descriptor_ref: String,
    pub install_storage_policy_ref: String,
    pub source_rule: String,
    pub admission_status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub installed_version: Option<String>,
}

/// SDK `NimiAppReleaseDescriptorRow`-shaped row for the bridge
/// `loadReleaseDescriptors` loader.
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

/// The full bridge projection payload: SDK-shaped registry and descriptor
/// loader inputs. Package readiness is Runtime-owned and is requested through
/// the SDK Runtime app lifecycle surface, not projected from host-scanned
/// install evidence.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppsBridgeProjection {
    pub registry_path: String,
    pub packages_path: String,
    pub registry_rows: Vec<BridgeRegistryRow>,
    pub release_descriptors: Vec<BridgeReleaseDescriptorRow>,
}

fn project_registry_row(row: &PlatformNimiAppRegistryRow) -> BridgeRegistryRow {
    BridgeRegistryRow {
        app_id: row.app_id.to_string(),
        app_kind: row.app_kind.to_string(),
        display_name: row.display_name.to_string(),
        publisher: row.publisher.to_string(),
        trust_tier: row.trust_tier.to_string(),
        ordinary_visibility: row.ordinary_visibility.to_string(),
        ai_profile_selection_ref: row.ai_profile_selection_ref.to_string(),
        capability_set: row
            .capability_set_refs
            .iter()
            .map(|capability| capability.to_string())
            .collect(),
        release_descriptor_ref: row.release_descriptor_ref.to_string(),
        install_storage_policy_ref: row.install_storage_policy_ref.to_string(),
        source_rule: row.source_rule.to_string(),
        admission_status: row.admission_status.to_string(),
        installed_version: None,
    }
}

/// Build the SDK-shaped Apps bridge projection from materialized host
/// projection paths. It deliberately does not carry Runtime install evidence.
pub fn build_apps_bridge_projection(
    registry_path: String,
    packages_path: String,
) -> Result<AppsBridgeProjection, String> {
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
            source_ref: descriptor.source_ref.to_string(),
            artifact_locator: descriptor.artifact_locator.to_string(),
            digest_algorithm: descriptor.digest_algorithm.to_string(),
            sha256: descriptor.sha256.to_string(),
            size: descriptor.size.to_string(),
            provenance_ref: descriptor.provenance_ref.to_string(),
            package_kind: descriptor.package_kind.to_string(),
            entry_ref: descriptor.entry_ref.to_string(),
            sandbox_ref: descriptor.sandbox_ref.to_string(),
            permissions_ref: descriptor.permissions_ref.to_string(),
            storage_policy_ref: descriptor.storage_policy_ref.to_string(),
            admission_path: descriptor.admission_path.to_string(),
            mutable_source_allowed: descriptor.mutable_source_allowed,
            install_digest_verification_required: descriptor
                .install_digest_verification_required
                .to_string(),
            source_rule: descriptor.source_rule.to_string(),
        })
        .collect();
    Ok(AppsBridgeProjection {
        registry_path,
        packages_path,
        registry_rows,
        release_descriptors,
    })
}

#[cfg(test)]
mod tests {
    use super::build_apps_bridge_projection;
    use crate::platform_catalog::nimi_app_registry::{
        PLATFORM_NIMI_APP_REGISTRY_ROWS, PLATFORM_NIMI_APP_RELEASE_DESCRIPTOR_ROWS,
    };
    #[test]
    fn bridge_projection_includes_catalog_rows_and_release_descriptors() {
        let projection = build_apps_bridge_projection(
            "~/.nimi/apps/registry.json".to_string(),
            "~/.nimi/apps/packages.json".to_string(),
        )
        .expect("projection");
        assert_eq!(
            projection.registry_rows.len(),
            PLATFORM_NIMI_APP_REGISTRY_ROWS.len()
        );
        assert_eq!(
            projection.release_descriptors.len(),
            PLATFORM_NIMI_APP_RELEASE_DESCRIPTOR_ROWS.len()
        );
    }

    #[test]
    fn bridge_projection_preserves_external_release_descriptor_fields() {
        let projection = build_apps_bridge_projection(
            "~/.nimi/apps/registry.json".to_string(),
            "~/.nimi/apps/packages.json".to_string(),
        )
        .expect("projection");
        let descriptor = projection
            .release_descriptors
            .iter()
            .find(|row| row.descriptor_id == "community.nimi.fixture.platform-proof.0.1.0-sandbox")
            .expect("sandbox fixture descriptor");

        assert_eq!(descriptor.source_kind, "admission-sandbox-https-artifact");
        assert_eq!(
            descriptor.source_ref,
            "https://fixtures.nimi.test/releases/platform-proof/0.1.0-sandbox/nimi-app-platform-fixture-0.1.0-sandbox.tar"
        );
        assert_eq!(descriptor.artifact_locator, descriptor.source_ref);
        assert_eq!(descriptor.size, "1503232");
        assert_eq!(
            descriptor.provenance_ref,
            "ci-provenance/platform-proof/0.1.0-sandbox/sha256-2e8527a892b227a0d0ea5038f6f375b13c6ba2649ba4c06d96ae539ec9105863"
        );
        assert_eq!(descriptor.entry_ref, "dist/index.html");
        assert_eq!(
            descriptor.sandbox_ref,
            "installed-nimi-app-standard-shell-v1"
        );
        assert_eq!(
            descriptor.permissions_ref,
            "community.nimi.fixture.platform-proof.permission_scope_ref"
        );
    }
}
