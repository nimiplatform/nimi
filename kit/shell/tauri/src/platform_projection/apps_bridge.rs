//! Shared SDK-shaped Apps bridge projection mapping.

use crate::platform_catalog::nimi_app_registry::{
    resolve_release_descriptor, PlatformNimiAppRegistryRow, PLATFORM_NIMI_APP_REGISTRY_ROWS,
    PLATFORM_NIMI_APP_RELEASE_DESCRIPTOR_ROWS,
};
use crate::platform_projection::apps_packages::AppsPackageRow;
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

/// SDK `NimiAppInstallEvidenceRow`-shaped row for the bridge
/// `loadInstallEvidence` loader.
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

fn project_install_evidence(package: &AppsPackageRow) -> Result<BridgeInstallEvidenceRow, String> {
    let verification_state = match package.state.as_str() {
        "installed" => "digest-verified",
        "repair_required" => "digest-mismatch",
        _ => "blocked",
    };
    let descriptor = resolve_release_descriptor(&package.package_ref).ok_or_else(|| {
        format!(
            "Apps package row {} packageRef does not resolve: {}",
            package.app_id, package.package_ref
        )
    })?;
    Ok(BridgeInstallEvidenceRow {
        app_id: package.app_id.clone(),
        release_descriptor_ref: package.package_ref.clone(),
        storage_policy_ref: descriptor.storage_policy_ref.to_string(),
        installed_version: Some(package.version.clone()),
        sha256: Some(descriptor.sha256.to_string()),
        verification_state: verification_state.to_string(),
    })
}

/// Build the SDK-shaped Apps bridge projection from materialized host
/// projection paths and the current packages projection rows.
pub fn build_apps_bridge_projection(
    registry_path: String,
    packages_path: String,
    packages: &[AppsPackageRow],
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
        .iter()
        .map(project_install_evidence)
        .collect::<Result<Vec<_>, _>>()?;
    Ok(AppsBridgeProjection {
        registry_path,
        packages_path,
        registry_rows,
        release_descriptors,
        install_evidence,
    })
}

#[cfg(test)]
mod tests {
    use super::build_apps_bridge_projection;
    use crate::platform_catalog::nimi_app_registry::{
        PLATFORM_NIMI_APP_REGISTRY_ROWS, PLATFORM_NIMI_APP_RELEASE_DESCRIPTOR_ROWS,
    };
    use crate::platform_projection::apps_packages::AppsPackageRow;

    fn package_row(package_ref: &str) -> AppsPackageRow {
        AppsPackageRow {
            app_id: "nimi.avatar".to_string(),
            package_ref: package_ref.to_string(),
            version: "1.0.0".to_string(),
            state: "installed".to_string(),
            verified_at: "2026-05-31T00:00:00Z".to_string(),
        }
    }

    #[test]
    fn bridge_projection_includes_catalog_rows_and_release_descriptors() {
        let projection = build_apps_bridge_projection(
            "~/.nimi/apps/registry.json".to_string(),
            "~/.nimi/apps/packages.json".to_string(),
            &[],
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
        assert!(projection.install_evidence.is_empty());
    }

    #[test]
    fn install_evidence_projects_package_state_without_storage_roots() {
        let projection = build_apps_bridge_projection(
            "~/.nimi/apps/registry.json".to_string(),
            "~/.nimi/apps/packages.json".to_string(),
            &[package_row("nimi.avatar.bundled-with-nimi")],
        )
        .expect("projection");
        let row = projection.install_evidence.first().expect("evidence");
        assert_eq!(row.app_id, "nimi.avatar");
        assert_eq!(row.verification_state, "digest-verified");
    }

    #[test]
    fn unresolved_package_ref_fails_closed() {
        let error = build_apps_bridge_projection(
            "~/.nimi/apps/registry.json".to_string(),
            "~/.nimi/apps/packages.json".to_string(),
            &[package_row("missing.descriptor")],
        )
        .expect_err("unresolved descriptor");
        assert!(error.contains("packageRef does not resolve"));
    }
}
