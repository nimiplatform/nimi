//! Pure `~/.nimi/apps/registry.json` projection rules.

use crate::platform_catalog::nimi_app_registry::{
    resolve_release_descriptor, PlatformNimiAppRegistryRow, PLATFORM_NIMI_APP_REGISTRY_CATALOG_ID,
    PLATFORM_NIMI_APP_REGISTRY_CATALOG_VERSION, PLATFORM_NIMI_APP_REGISTRY_ROWS,
};
use serde::{Deserialize, Serialize};

/// Supported `~/.nimi/apps/registry.json` schema version.
pub const APPS_REGISTRY_SCHEMA_VERSION: u32 = 1;

/// `~/.nimi`-relative location of the registry projection. This is the manual
/// `~/.nimi/nimi.json` `pointers.appRegistry` value.
pub const APPS_REGISTRY_POINTER: &str = "apps/registry.json";

const INSTALL_STATE_NOT_INSTALLED: &str = "not_installed";
const INSTALL_STATE_BUNDLED: &str = "bundled";
const INSTALL_STATE_BLOCKED: &str = "blocked";

const VISIBILITY_ORDINARY: &str = "ordinary";
const VISIBILITY_HIDDEN_INTERNAL: &str = "hidden-internal";
const VISIBILITY_DEVELOPER_ONLY: &str = "developer-only";
const VISIBILITY_NOT_ADMITTED: &str = "not-admitted-visible";

/// One projected Nimi App registry row.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AppsRegistryRow {
    pub app_id: String,
    pub display_name: String,
    pub visibility: String,
    pub trust_tier: String,
    pub install_state: String,
    pub package_ref: String,
    pub manifest_ref: String,
    pub recommended_profile_ref: Option<String>,
    pub requirements_ref: String,
}

/// `~/.nimi/apps/registry.json` record shape.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AppsRegistryRecord {
    pub schema_version: u32,
    pub catalog_id: String,
    pub catalog_version: u32,
    pub updated_at: String,
    pub apps: Vec<AppsRegistryRow>,
}

fn now_iso_timestamp() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

fn project_visibility(ordinary_visibility: &str) -> Result<&'static str, String> {
    match ordinary_visibility {
        "ordinary-visible" => Ok(VISIBILITY_ORDINARY),
        "hidden-internal" => Ok(VISIBILITY_HIDDEN_INTERNAL),
        "developer-only" => Ok(VISIBILITY_DEVELOPER_ONLY),
        "not-admitted-visible" => Ok(VISIBILITY_NOT_ADMITTED),
        other => Err(format!(
            "Nimi App registry row has an unknown ordinary_visibility: {other}"
        )),
    }
}

fn project_install_state(row: &PlatformNimiAppRegistryRow) -> Result<&'static str, String> {
    let descriptor = resolve_release_descriptor(row.release_descriptor_ref).ok_or_else(|| {
        format!(
            "Nimi App registry row {} release descriptor does not resolve: {}",
            row.app_id, row.release_descriptor_ref
        )
    })?;
    match row.admission_status {
        "admitted" => {
            if descriptor.descriptor_class == "bundled-with-nimi" {
                Ok(INSTALL_STATE_BUNDLED)
            } else {
                Ok(INSTALL_STATE_NOT_INSTALLED)
            }
        }
        "gated_by_avatar_master_gate" | "pending_wave_4" | "deferred" | "retired" => {
            Ok(INSTALL_STATE_BLOCKED)
        }
        other => Err(format!(
            "Nimi App registry row {} has an unknown admission_status: {other}",
            row.app_id
        )),
    }
}

fn project_row(row: &PlatformNimiAppRegistryRow) -> Result<AppsRegistryRow, String> {
    let descriptor = resolve_release_descriptor(row.release_descriptor_ref).ok_or_else(|| {
        format!(
            "Nimi App registry row {} release descriptor does not resolve: {}",
            row.app_id, row.release_descriptor_ref
        )
    })?;
    if descriptor.app_id != row.app_id {
        return Err(format!(
            "Nimi App registry row {} release descriptor resolves to a different app: {}",
            row.app_id, descriptor.app_id
        ));
    }
    if descriptor.storage_policy_ref != row.install_storage_policy_ref {
        return Err(format!(
            "Nimi App registry row {} install storage policy does not match release descriptor",
            row.app_id
        ));
    }
    Ok(AppsRegistryRow {
        app_id: row.app_id.to_string(),
        display_name: row.display_name.to_string(),
        visibility: project_visibility(row.ordinary_visibility)?.to_string(),
        trust_tier: row.trust_tier.to_string(),
        install_state: project_install_state(row)?.to_string(),
        package_ref: row.release_descriptor_ref.to_string(),
        manifest_ref: row.release_descriptor_ref.to_string(),
        recommended_profile_ref: None,
        requirements_ref: row.source_rule.to_string(),
    })
}

/// Build the registry projection record from the packaged Platform Nimi App
/// registry catalog.
pub fn build_apps_registry_record() -> Result<AppsRegistryRecord, String> {
    let mut apps = Vec::with_capacity(PLATFORM_NIMI_APP_REGISTRY_ROWS.len());
    for row in PLATFORM_NIMI_APP_REGISTRY_ROWS {
        apps.push(project_row(row)?);
    }
    if apps.is_empty() {
        return Err("Platform Nimi App registry catalog projected zero rows".to_string());
    }
    Ok(AppsRegistryRecord {
        schema_version: APPS_REGISTRY_SCHEMA_VERSION,
        catalog_id: PLATFORM_NIMI_APP_REGISTRY_CATALOG_ID.to_string(),
        catalog_version: PLATFORM_NIMI_APP_REGISTRY_CATALOG_VERSION,
        updated_at: now_iso_timestamp(),
        apps,
    })
}

/// Structural validation of a registry record.
pub fn validate_apps_registry_record(record: &AppsRegistryRecord) -> Result<(), String> {
    if record.schema_version != APPS_REGISTRY_SCHEMA_VERSION {
        return Err(format!(
            "unsupported ~/.nimi/apps/registry.json schemaVersion={} expected={APPS_REGISTRY_SCHEMA_VERSION}",
            record.schema_version
        ));
    }
    if record.catalog_id.trim().is_empty() {
        return Err("~/.nimi/apps/registry.json catalogId is required".to_string());
    }
    if record.updated_at.trim().is_empty() {
        return Err("~/.nimi/apps/registry.json updatedAt is required".to_string());
    }
    if record.apps.is_empty() {
        return Err("~/.nimi/apps/registry.json must project at least one app row".to_string());
    }
    for app in &record.apps {
        if app.app_id.trim().is_empty() {
            return Err("~/.nimi/apps/registry.json app row requires appId".to_string());
        }
        if app.display_name.trim().is_empty() {
            return Err(format!(
                "~/.nimi/apps/registry.json app row {} requires displayName",
                app.app_id
            ));
        }
        if !matches!(
            app.visibility.as_str(),
            VISIBILITY_ORDINARY
                | VISIBILITY_HIDDEN_INTERNAL
                | VISIBILITY_DEVELOPER_ONLY
                | VISIBILITY_NOT_ADMITTED
        ) {
            return Err(format!(
                "~/.nimi/apps/registry.json app row {} has an unknown visibility: {}",
                app.app_id, app.visibility
            ));
        }
        if !matches!(
            app.install_state.as_str(),
            INSTALL_STATE_NOT_INSTALLED | INSTALL_STATE_BUNDLED | INSTALL_STATE_BLOCKED
        ) {
            return Err(format!(
                "~/.nimi/apps/registry.json app row {} has an unknown installState: {}",
                app.app_id, app.install_state
            ));
        }
        if app.package_ref.trim().is_empty()
            || app.manifest_ref.trim().is_empty()
            || app.requirements_ref.trim().is_empty()
        {
            return Err(format!(
                "~/.nimi/apps/registry.json app row {} requires packageRef, manifestRef, and requirementsRef",
                app.app_id
            ));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        build_apps_registry_record, validate_apps_registry_record, AppsRegistryRecord,
        APPS_REGISTRY_SCHEMA_VERSION,
    };
    use crate::platform_catalog::nimi_app_registry::PLATFORM_NIMI_APP_REGISTRY_ROWS;

    #[test]
    fn projection_sources_every_catalog_row_without_inventing_rows() {
        let record = build_apps_registry_record().expect("record");
        assert_eq!(record.apps.len(), PLATFORM_NIMI_APP_REGISTRY_ROWS.len());
        assert_eq!(record.schema_version, APPS_REGISTRY_SCHEMA_VERSION);
    }

    #[test]
    fn internal_and_developer_apps_never_project_as_ordinary_visibility() {
        let record = build_apps_registry_record().expect("record");
        let avatar = record
            .apps
            .iter()
            .find(|row| row.app_id == "nimi.avatar")
            .expect("avatar row");
        assert_eq!(avatar.visibility, "hidden-internal");
        assert_ne!(avatar.visibility, "ordinary");
        assert!(
            record.apps.iter().all(|row| row.visibility != "ordinary"),
            "this cut admits no ordinary-visible first-party app rows"
        );
    }

    #[test]
    fn gated_avatar_routes_install_state_blocked() {
        let record = build_apps_registry_record().expect("record");
        let avatar = record
            .apps
            .iter()
            .find(|row| row.app_id == "nimi.avatar")
            .expect("avatar row");
        assert_eq!(avatar.install_state, "blocked");
    }

    #[test]
    fn serde_round_trip_preserves_record() {
        let record = build_apps_registry_record().expect("record");
        validate_apps_registry_record(&record).expect("valid");
        let raw = serde_json::to_string_pretty(&record).expect("serialize");
        let parsed: AppsRegistryRecord = serde_json::from_str(&raw).expect("deserialize");
        assert_eq!(record, parsed);
    }
}
