//! `~/.nimi/apps/registry.json` — installed projection of the admitted ordinary
//! Nimi App registry.
//!
//! Product owner: Platform / Nimi App registry projection (product manual
//! `~/.nimi/apps/registry.json` subsection; `P-NAPP-*`).
//!
//! This file is a READ-ONLY projection of Platform catalog truth. It is
//! regenerated deterministically from the packaged Platform Nimi App registry
//! catalog (`nimi_shell_tauri::platform_catalog::nimi_app_registry`, itself
//! generated from `.nimi/spec/platform/kernel/tables/nimi-app-registry.yaml` +
//! `nimi-app-release-descriptors.yaml`). It is never hand-edited.
//!
//! It is the source the Desktop Apps bridge reads — `generated.ts` is retired
//! as the Apps bridge source (T4 Fork C). The Apps page consumes this
//! projection, never app-local spec admission directly.
//!
//! Avatar (`hidden-internal`) is projected as
//! rows for package/update coordination, but the registry row's `visibility`
//! field carries their true catalog visibility — they are never projected as
//! `visibility='ordinary'`. The ordinary-visible filter is applied by the
//! consuming bridge transport.

use crate::desktop_paths::resolve_nimi_dir;
use nimi_shell_tauri::governed_config::ConfigReadOutcome;
use nimi_shell_tauri::platform_projection::apps_registry::{
    build_apps_registry_record, materialize_apps_registry_projection, read_apps_registry_projection,
    AppsRegistryRecord, APPS_REGISTRY_POINTER, APPS_REGISTRY_SCHEMA_VERSION,
};
use serde::Serialize;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppsRegistryProjection {
    pub path: String,
    pub record: AppsRegistryRecord,
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

/// Read the installed registry projection through the shared `~/.nimi`
/// current-schema repair framework.
///
/// Routes a parse failure, a missing / unknown `schemaVersion`, or a structural
/// fault to a typed `ConfigReadOutcome::Repair` (`P-MIG-004`) instead of a raw
/// `Err`. `ConfigReadOutcome::Absent` means the projection has not been
/// materialized yet — the deterministic [`ensure_apps_registry`] regeneration
/// is the caller's recovery path. `ConfigReadOutcome::Repair` means the on-disk
/// file is faulted and was left intact for a guided repair.
pub fn read_apps_registry_governed() -> Result<ConfigReadOutcome<AppsRegistryRecord>, String> {
    let path = apps_registry_path()?;
    read_apps_registry_projection(&path)
}

/// Read the installed registry projection, if present.
///
/// Thin presence-shaped adapter over [`read_apps_registry_governed`] for the
/// internal package-projection consumer that needs an `Option<Record>`: a
/// routed repair state is surfaced as the typed repair reason (still not a raw
/// serde dump), and `Absent` maps to `Ok(None)`.
pub fn read_apps_registry() -> Result<Option<AppsRegistryRecord>, String> {
    match read_apps_registry_governed()? {
        ConfigReadOutcome::Absent => Ok(None),
        ConfigReadOutcome::Ready(record) => Ok(Some(record)),
        ConfigReadOutcome::Repair { reason, .. } => Err(reason),
    }
}

/// Materialize `~/.nimi/apps/registry.json` from the packaged Platform Nimi App
/// registry catalog only when the projection is absent.
///
/// Current-schema files are returned as-is. Repair-routed files are surfaced as
/// a typed error and left intact for guided repair.
pub fn ensure_apps_registry() -> Result<AppsRegistryProjection, String> {
    let path = apps_registry_path()?;
    match materialize_apps_registry_projection(&path)? {
        ConfigReadOutcome::Ready(record) => Ok(AppsRegistryProjection {
            path: path.display().to_string(),
            record,
        }),
        ConfigReadOutcome::Absent => Err("registry projection materializer returned absent".to_string()),
        ConfigReadOutcome::Repair { reason, .. } => Err(reason),
    }
}

#[cfg(test)]
mod tests {
    use super::{
        apps_registry_path, build_apps_registry_record, ensure_apps_registry, read_apps_registry,
        read_apps_registry_governed, AppsRegistryRecord, APPS_REGISTRY_POINTER,
        APPS_REGISTRY_SCHEMA_VERSION,
    };
    use crate::test_support::with_env;
    use nimi_shell_tauri::governed_config::{ConfigReadOutcome, ConfigRepairSeverity};
    use nimi_shell_tauri::platform_catalog::nimi_app_registry::PLATFORM_NIMI_APP_REGISTRY_ROWS;
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
        // Avatar is gated_by_avatar_master_gate -> blocked, not bundled.
        assert_eq!(avatar.install_state, "blocked");
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
            assert!(matches!(
                read_apps_registry_governed().expect("governed read"),
                ConfigReadOutcome::Absent
            ));
        });
    }

    #[test]
    fn unknown_future_schema_version_routes_repair_required() {
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
            let future_raw = serde_json::to_string_pretty(&record).expect("json");
            std::fs::write(&path, &future_raw).expect("write future schema");
            // P-MIG-002 / P-MIG-004: an unknown future version routes to a typed
            // repair_required outcome, never a raw Err, and never a silent
            // recreate of the file.
            match read_apps_registry_governed().expect("governed read") {
                ConfigReadOutcome::Repair { severity, reason } => {
                    assert_eq!(severity, ConfigRepairSeverity::RepairRequired);
                    assert!(reason.contains("newer than the supported version"));
                    assert!(reason.contains("~/.nimi/apps/registry.json"));
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
    fn ensure_does_not_overwrite_future_schema_projection() {
        let home = temp_home("ensure-future-schema");
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
            let future_raw = serde_json::to_string_pretty(&record).expect("json");
            std::fs::write(&path, &future_raw).expect("write future schema");

            let error = ensure_apps_registry().expect_err("future schema repair");
            assert!(error.contains("newer than the supported version"));
            assert_eq!(
                std::fs::read_to_string(&path).expect("read after"),
                future_raw
            );
        });
    }

    #[test]
    fn corrupt_projection_routes_repair_required() {
        let home = temp_home("corrupt");
        with_env(&[("HOME", home.to_str())], || {
            let path = apps_registry_path().expect("path");
            std::fs::create_dir_all(path.parent().expect("parent")).expect("mkdir");
            std::fs::write(&path, "{ not valid json").expect("write corrupt");
            match read_apps_registry_governed().expect("governed read") {
                ConfigReadOutcome::Repair { severity, reason } => {
                    assert_eq!(severity, ConfigRepairSeverity::RepairRequired);
                    assert!(reason.contains("not valid JSON"));
                }
                other => panic!("expected repair_required, got {other:?}"),
            }
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
