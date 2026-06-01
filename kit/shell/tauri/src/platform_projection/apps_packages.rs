//! Shared `~/.nimi/apps/packages.json` record shape and validation.

use serde::{Deserialize, Serialize};

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
            || package.verified_at.trim().is_empty()
        {
            return Err(
                "~/.nimi/apps/packages.json package row requires appId, packageRef, version, and verifiedAt"
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
        build_apps_packages_record_from_rows, validate_apps_packages_record, AppsPackageRow,
        AppsPackagesRecord, APPS_PACKAGES_POINTER, APPS_PACKAGES_SCHEMA_VERSION,
    };

    fn package_row(state: &str) -> AppsPackageRow {
        AppsPackageRow {
            app_id: "nimi.avatar".to_string(),
            package_ref: "nimi.avatar.bundled-with-nimi".to_string(),
            version: "1.0.0".to_string(),
            state: state.to_string(),
            verified_at: "2026-05-31T00:00:00Z".to_string(),
        }
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
}
