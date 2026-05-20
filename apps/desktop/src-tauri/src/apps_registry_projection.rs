//! `~/.nimi/apps/registry.json` — installed projection of the admitted ordinary
//! Nimi App registry.
//!
//! Product owner: Platform / Nimi App registry projection (product manual
//! `~/.nimi/apps/registry.json` subsection; `P-NAPP-001..P-NAPP-016`).
//!
//! This file is a READ-ONLY projection of Platform catalog truth. It is
//! regenerated deterministically from the packaged Platform Nimi App registry
//! catalog (`platform_nimi_app_registry.rs`, itself generated from
//! `.nimi/spec/platform/kernel/tables/nimi-app-registry.yaml` +
//! `nimi-app-release-descriptors.yaml`). It is never hand-edited.
//!
//! It is the source the Desktop Apps bridge reads — `generated.ts` is retired
//! as the Apps bridge source (T4 Fork C). The Apps page consumes this
//! projection, never app-local spec admission directly.
//!
//! Avatar (`hidden-internal`) and Tester (`developer-only`) are projected as
//! rows for package/update coordination, but the registry row's `visibility`
//! field carries their true catalog visibility — they are never projected as
//! `visibility='ordinary'`. The ordinary-visible filter is applied by the
//! consuming bridge transport.

use crate::desktop_paths::resolve_nimi_dir;
use crate::platform_nimi_app_registry::{
    resolve_release_descriptor, PlatformNimiAppRegistryRow, PLATFORM_NIMI_APP_REGISTRY_CATALOG_ID,
    PLATFORM_NIMI_APP_REGISTRY_CATALOG_VERSION, PLATFORM_NIMI_APP_REGISTRY_ROWS,
};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

/// Supported `~/.nimi/apps/registry.json` schema version. An unknown future
/// version fails closed on read (migration mechanics are T10, not this wave).
pub const APPS_REGISTRY_SCHEMA_VERSION: u32 = 1;

/// `~/.nimi`-relative location of the registry projection. This is the manual
/// `~/.nimi/nimi.json` `pointers.appRegistry` value.
pub const APPS_REGISTRY_POINTER: &str = "apps/registry.json";

/// Closed product-level row `installState` vocabulary. T4-W1 owns config truth
/// only; the actual install/open/update/uninstall lifecycle is T4-W2. The
/// registry projection records the admission-derived baseline state.
const INSTALL_STATE_NOT_INSTALLED: &str = "not_installed";
const INSTALL_STATE_BUNDLED: &str = "bundled";
const INSTALL_STATE_BLOCKED: &str = "blocked";

/// Closed product-level `visibility` vocabulary projected from the catalog
/// `ordinary_visibility` axis.
const VISIBILITY_ORDINARY: &str = "ordinary";
const VISIBILITY_HIDDEN_INTERNAL: &str = "hidden-internal";
const VISIBILITY_DEVELOPER_ONLY: &str = "developer-only";
const VISIBILITY_NOT_ADMITTED: &str = "not-admitted-visible";

/// One projected Nimi App registry row. The minimum product fields are fixed by
/// the manual `~/.nimi/apps/registry.json` schema:
/// `appId, displayName, visibility, trustTier, installState, packageRef,
/// manifestRef, recommendedProfileRef, requirementsRef`.
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

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppsRegistryProjection {
    pub path: String,
    pub record: AppsRegistryRecord,
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

/// On-disk path of the installed registry projection, fixed under the `~/.nimi`
/// CONTROL root at `apps/registry.json`.
pub fn apps_registry_path() -> Result<PathBuf, String> {
    let mut path = resolve_nimi_dir()?;
    for segment in APPS_REGISTRY_POINTER.split('/') {
        path.push(segment);
    }
    Ok(path)
}

/// Project the catalog `ordinary_visibility` axis onto the product-facing
/// `visibility` field. Avatar stays `hidden-internal`, Tester stays
/// `developer-only` — neither is ever projected as `ordinary`.
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

/// Derive the registry projection `installState` baseline from the catalog row.
///
/// A bundled-with-nimi descriptor is installed with the atomic Nimi release; an
/// admitted externally-installable app is `not_installed` until T4-W2 install
/// lands; an app whose admission is gated routes to `blocked`.
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
        // The Platform release descriptor is the installable-version manifest
        // for the app; the registry projection points the manifestRef at the
        // same admitted descriptor identity. App-local manifest validation is
        // an app-first-launch concern (T4-W3), not this projection.
        manifest_ref: row.release_descriptor_ref.to_string(),
        // T4-W1 owns config truth only. The recommended AIProfile binding for an
        // app is resolved by app first-launch (T4-W3); the registry projection
        // does not embed it.
        recommended_profile_ref: None,
        // The Platform catalog `source_rule` is the requirements-admission
        // anchor for the row; T4-W1 records the ref, not the resolved
        // requirement set.
        requirements_ref: row.source_rule.to_string(),
    })
}

/// Build the registry projection record from the packaged Platform Nimi App
/// registry catalog. The record is derived purely from catalog truth — no row
/// is invented and no user state is read.
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

/// Structural validation of a registry record read from disk.
///
/// An unknown future `schemaVersion` fails closed: the cross-cutting migration
/// mechanics are owned by T10, so this read just rejects unsupported versions.
fn validate_record(record: &AppsRegistryRecord) -> Result<(), String> {
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

fn write_record(path: &Path, record: &AppsRegistryRecord) -> Result<(), String> {
    validate_record(record)?;
    let parent = path
        .parent()
        .ok_or_else(|| "~/.nimi/apps/registry.json path has no parent directory".to_string())?;
    fs::create_dir_all(parent).map_err(|error| {
        format!(
            "create ~/.nimi/apps directory failed ({}): {error}",
            parent.display()
        )
    })?;
    let raw = serde_json::to_string_pretty(record)
        .map_err(|error| format!("serialize ~/.nimi/apps/registry.json failed: {error}"))?;
    let tmp_path =
        path.with_extension(format!("json.tmp.{}.{}", std::process::id(), now_unix_ms()));
    fs::write(&tmp_path, raw).map_err(|error| {
        format!(
            "write ~/.nimi/apps/registry.json temporary file failed ({}): {error}",
            tmp_path.display()
        )
    })?;
    fs::rename(&tmp_path, path).map_err(|error| {
        format!(
            "commit ~/.nimi/apps/registry.json failed ({}): {error}",
            path.display()
        )
    })
}

/// Read the installed registry projection, if present.
///
/// Fails closed on a parse failure or an unsupported `schemaVersion`; returns
/// `Ok(None)` only when the file does not exist.
pub fn read_apps_registry() -> Result<Option<AppsRegistryRecord>, String> {
    let path = apps_registry_path()?;
    if !path.exists() {
        return Ok(None);
    }
    let raw = fs::read_to_string(&path).map_err(|error| {
        format!(
            "read ~/.nimi/apps/registry.json failed ({}): {error}",
            path.display()
        )
    })?;
    let record = serde_json::from_str::<AppsRegistryRecord>(&raw).map_err(|error| {
        format!(
            "parse ~/.nimi/apps/registry.json failed ({}): {error}",
            path.display()
        )
    })?;
    validate_record(&record)?;
    Ok(Some(record))
}

/// Regenerate `~/.nimi/apps/registry.json` from the packaged Platform Nimi App
/// registry catalog and return the installed projection.
///
/// Deterministic catalog projection: it always derives the record from catalog
/// truth and overwrites any prior projection.
pub fn ensure_apps_registry() -> Result<AppsRegistryProjection, String> {
    let path = apps_registry_path()?;
    let record = build_apps_registry_record()?;
    write_record(&path, &record)?;
    Ok(AppsRegistryProjection {
        path: path.display().to_string(),
        record,
    })
}

#[tauri::command]
pub fn apps_registry_get() -> Result<AppsRegistryProjection, String> {
    ensure_apps_registry()
}

#[cfg(test)]
mod tests {
    use super::{
        apps_registry_path, build_apps_registry_record, ensure_apps_registry, read_apps_registry,
        AppsRegistryRecord, APPS_REGISTRY_POINTER, APPS_REGISTRY_SCHEMA_VERSION,
    };
    use crate::test_support::with_env;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_home(prefix: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("nimi-apps-registry-{prefix}-{unique}"));
        std::fs::create_dir_all(&dir).expect("create temp home");
        dir
    }

    #[test]
    fn projection_sources_every_catalog_row_without_inventing_rows() {
        let record = build_apps_registry_record().expect("record");
        assert_eq!(
            record.apps.len(),
            super::PLATFORM_NIMI_APP_REGISTRY_ROWS.len()
        );
        assert_eq!(record.schema_version, APPS_REGISTRY_SCHEMA_VERSION);
    }

    #[test]
    fn avatar_and_tester_never_project_as_ordinary_visibility() {
        let record = build_apps_registry_record().expect("record");
        let avatar = record
            .apps
            .iter()
            .find(|row| row.app_id == "nimi.avatar")
            .expect("avatar row");
        assert_eq!(avatar.visibility, "hidden-internal");
        assert_ne!(avatar.visibility, "ordinary");
        let tester = record
            .apps
            .iter()
            .find(|row| row.app_id == "nimi.tester")
            .expect("tester row");
        assert_eq!(tester.visibility, "developer-only");
        assert_ne!(tester.visibility, "ordinary");
        let parentos = record
            .apps
            .iter()
            .find(|row| row.app_id == "nimi.parentos")
            .expect("parentos row");
        assert_eq!(parentos.visibility, "ordinary");
    }

    #[test]
    fn gated_avatar_routes_install_state_blocked() {
        let record = build_apps_registry_record().expect("record");
        let avatar = record
            .apps
            .iter()
            .find(|row| row.app_id == "nimi.avatar")
            .expect("avatar row");
        // Avatar is gated_by_avatar_master_gate -> blocked, not bundled.
        assert_eq!(avatar.install_state, "blocked");
        let parentos = record
            .apps
            .iter()
            .find(|row| row.app_id == "nimi.parentos")
            .expect("parentos row");
        // ParentOS admitted + bundled-with-nimi descriptor -> bundled.
        assert_eq!(parentos.install_state, "bundled");
    }

    #[test]
    fn ensure_writes_projection_under_nimi_apps_and_reads_back() {
        let home = temp_home("ensure");
        with_env(&[("HOME", home.to_str())], || {
            let projection = ensure_apps_registry().expect("ensure");
            let path = apps_registry_path().expect("path");
            assert!(path.exists());
            assert!(path.starts_with(home.join(".nimi").join("apps")));
            assert!(path.ends_with(APPS_REGISTRY_POINTER));
            let read_back = read_apps_registry().expect("read").expect("record present");
            assert_eq!(read_back, projection.record);
        });
    }

    #[test]
    fn read_returns_none_when_projection_is_absent() {
        let home = temp_home("absent");
        with_env(&[("HOME", home.to_str())], || {
            assert!(read_apps_registry().expect("read").is_none());
        });
    }

    #[test]
    fn unknown_future_schema_version_fails_closed_on_read() {
        let home = temp_home("future-schema");
        with_env(&[("HOME", home.to_str())], || {
            ensure_apps_registry().expect("ensure");
            let path = apps_registry_path().expect("path");
            let mut record = serde_json::from_str::<serde_json::Value>(
                &std::fs::read_to_string(&path).expect("read"),
            )
            .expect("parse");
            record
                .as_object_mut()
                .expect("object")
                .insert("schemaVersion".to_string(), serde_json::json!(9999));
            std::fs::write(&path, serde_json::to_string_pretty(&record).expect("json"))
                .expect("write future schema");
            let error = read_apps_registry().expect_err("unknown schema fails closed");
            assert!(error.contains("unsupported"));
            assert!(error.contains("schemaVersion"));
        });
    }

    #[test]
    fn corrupt_projection_fails_closed_on_read() {
        let home = temp_home("corrupt");
        with_env(&[("HOME", home.to_str())], || {
            let path = apps_registry_path().expect("path");
            std::fs::create_dir_all(path.parent().expect("parent")).expect("mkdir");
            std::fs::write(&path, "{ not valid json").expect("write corrupt");
            let error = read_apps_registry().expect_err("corrupt fails closed");
            assert!(error.contains("parse"));
        });
    }

    #[test]
    fn serde_round_trip_preserves_record() {
        let record = build_apps_registry_record().expect("record");
        let raw = serde_json::to_string_pretty(&record).expect("serialize");
        let parsed: AppsRegistryRecord = serde_json::from_str(&raw).expect("deserialize");
        assert_eq!(record, parsed);
    }
}
