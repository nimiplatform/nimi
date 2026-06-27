//! `~/.nimi/profiles/factory-index.json` — installed projection of the official
//! Platform factory profile catalog plus selection policy.
//!
//! Product owner: Platform / Nimi Profile Policy Logic projection
//! (product manual `~/.nimi/profiles/factory-index.json` subsection;
//! `P-AIPS-001..P-AIPS-013`).
//!
//! This file is a READ-ONLY projection of official catalog truth. It is
//! regenerated deterministically from the packaged Platform factory catalog
//! (`nimi_shell_tauri::capabilities::ai_profile`, itself generated
//! from `.nimi/spec/platform/kernel/tables/ai-profile-factory-catalog.yaml`).
//! It is never hand-edited and never carries user edits.
//!
//! It is NOT the user's editable profile library and it does NOT own or mutate
//! the Account Default Profile (`~/.nimi/accounts/<id>/profiles/default.json`,
//! `account_profile_library.rs`). Any seed/restore of the Account Default
//! Profile from this index is an explicit product flow owned elsewhere; this
//! module never writes account-scoped records.

use crate::desktop_paths::resolve_nimi_dir;
use nimi_shell_tauri::capabilities::platform_projection::factory_profile_index::{
    FactoryProfileIndexRecord, FACTORY_PROFILE_INDEX_POINTER,
};
use serde::Serialize;
use std::path::PathBuf;

#[cfg(test)]
use nimi_shell_tauri::capabilities::config::ConfigReadOutcome;
#[cfg(test)]
use nimi_shell_tauri::capabilities::platform_projection::factory_profile_index::{
    build_factory_profile_index_record, materialize_factory_profile_index_projection,
    read_factory_profile_index_projection, FACTORY_PROFILE_INDEX_SCHEMA_VERSION,
};

#[cfg(test)]
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FactoryProfileIndexProjection {
    pub path: String,
    pub record: FactoryProfileIndexRecord,
}

/// On-disk path of the installed factory profile index projection.
///
/// Fixed under the `~/.nimi` CONTROL root at `profiles/factory-index.json`,
/// matching the manual user-local config shape and the `nimi.json`
/// `pointers.factoryProfileIndex` value.
pub fn factory_profile_index_path() -> Result<PathBuf, String> {
    let mut path = resolve_nimi_dir()?;
    for segment in FACTORY_PROFILE_INDEX_POINTER.split('/') {
        path.push(segment);
    }
    Ok(path)
}

/// Read the installed factory profile index projection through the shared
/// `~/.nimi` current-schema repair framework.
///
/// Routes a parse failure, a missing / unknown `schemaVersion`, or a structural
/// fault to a typed `ConfigReadOutcome::Repair` (`P-MIG-004`) instead of a raw
/// `Err`. `ConfigReadOutcome::Absent` means the projection has not been
/// materialized; the deterministic [`ensure_factory_profile_index`]
/// regeneration is the recovery path.
#[cfg(test)]
pub fn read_factory_profile_index_governed(
) -> Result<ConfigReadOutcome<FactoryProfileIndexRecord>, String> {
    let path = factory_profile_index_path()?;
    read_factory_profile_index_projection(&path)
}

/// Read the installed factory profile index projection, if present.
///
/// Thin presence-shaped adapter over [`read_factory_profile_index_governed`]:
/// a routed repair state is surfaced as the typed repair reason; `Absent` maps
/// to `Ok(None)`.
#[cfg(test)]
pub fn read_factory_profile_index() -> Result<Option<FactoryProfileIndexRecord>, String> {
    match read_factory_profile_index_governed()? {
        ConfigReadOutcome::Absent => Ok(None),
        ConfigReadOutcome::Ready(record) => Ok(Some(record)),
        ConfigReadOutcome::Repair { reason, .. } => Err(reason),
    }
}

/// Materialize `~/.nimi/profiles/factory-index.json` from the packaged
/// Platform factory catalog only when the projection is absent.
///
/// Current-schema files are returned as-is. Repair-routed files are surfaced as
/// a typed error and left intact for guided repair. This never reads, seeds, or
/// restores the Account Default Profile.
#[cfg(test)]
pub fn ensure_factory_profile_index() -> Result<FactoryProfileIndexProjection, String> {
    let path = factory_profile_index_path()?;
    match materialize_factory_profile_index_projection(&path)? {
        ConfigReadOutcome::Ready(record) => Ok(FactoryProfileIndexProjection {
            path: path.display().to_string(),
            record,
        }),
        ConfigReadOutcome::Absent => {
            Err("factory profile index materializer returned absent".to_string())
        }
        ConfigReadOutcome::Repair { reason, .. } => Err(reason),
    }
}

#[cfg(test)]
mod tests {
    use super::{
        build_factory_profile_index_record, ensure_factory_profile_index,
        factory_profile_index_path, read_factory_profile_index,
        read_factory_profile_index_governed, FactoryProfileIndexRecord,
        FACTORY_PROFILE_INDEX_POINTER, FACTORY_PROFILE_INDEX_SCHEMA_VERSION,
    };
    use crate::test_support::with_env;
    use nimi_shell_tauri::capabilities::config::{ConfigReadOutcome, ConfigRepairSeverity};
    use nimi_shell_tauri::capabilities::ai_profile::{
        PLATFORM_AI_PROFILE_FACTORY_CATALOG_VERSION, PLATFORM_AI_PROFILE_FACTORY_ROWS,
        PLATFORM_AI_PROFILE_SELECTION_POLICY_REF,
    };
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_home(prefix: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("nimi-factory-index-{prefix}-{unique}"));
        std::fs::create_dir_all(&dir).expect("create temp home");
        dir
    }

    #[test]
    fn projection_sources_every_catalog_row_without_inventing_rows() {
        let record = build_factory_profile_index_record().expect("record");
        // The projection is derived purely from the packaged Platform factory
        // catalog: one row per catalog row, no invented entries.
        assert_eq!(
            record.profiles.len(),
            PLATFORM_AI_PROFILE_FACTORY_ROWS.len()
        );
        assert_eq!(record.schema_version, FACTORY_PROFILE_INDEX_SCHEMA_VERSION);
        assert_eq!(
            record.catalog_version,
            format!("v{PLATFORM_AI_PROFILE_FACTORY_CATALOG_VERSION}")
        );
        assert_eq!(
            record.policies.baseline,
            PLATFORM_AI_PROFILE_SELECTION_POLICY_REF
        );
        for catalog_row in PLATFORM_AI_PROFILE_FACTORY_ROWS {
            let projected = record
                .profiles
                .iter()
                .find(|row| row.alias == catalog_row.alias)
                .expect("every catalog alias is projected");
            assert_eq!(
                projected.capabilities.len(),
                catalog_row.capability_set.len()
            );
        }
    }

    #[test]
    fn baseline_and_recommended_modes_are_derived_from_install_levels() {
        let record = build_factory_profile_index_record().expect("record");
        // local-speech-ready is admitted for minimal + recommended -> recommended.
        let speech = record
            .profiles
            .iter()
            .find(|row| row.alias == "local-speech-ready")
            .expect("speech row");
        assert_eq!(speech.mode, "recommended");
        // local-gpu is admitted for recommended only -> recommended.
        let gpu = record
            .profiles
            .iter()
            .find(|row| row.alias == "local-gpu")
            .expect("gpu row");
        assert_eq!(gpu.mode, "recommended");
        assert_eq!(gpu.device_class, "gpu-recommended");
        // cloud-first has no first-run install level -> scope-bound, not a
        // first-run baseline.
        let cloud = record
            .profiles
            .iter()
            .find(|row| row.alias == "cloud-first")
            .expect("cloud row");
        assert_eq!(cloud.mode, "scope-bound");
        assert_eq!(cloud.device_class, "cloud-only");
    }

    #[test]
    fn os_axis_is_projected_from_host_capability_profile_refs() {
        let record = build_factory_profile_index_record().expect("record");
        let speech = record
            .profiles
            .iter()
            .find(|row| row.alias == "local-speech-ready")
            .expect("speech row");
        assert!(speech.os.contains(&"macos".to_string()));
        assert!(speech.os.contains(&"windows".to_string()));
    }

    #[test]
    fn ensure_writes_projection_under_nimi_profiles_and_reads_back() {
        let home = temp_home("ensure");
        with_env(&[("HOME", home.to_str())], || {
            let projection = ensure_factory_profile_index().expect("ensure");
            let path = factory_profile_index_path().expect("path");
            assert!(path.exists());
            assert!(path.starts_with(home.join(".nimi").join("profiles")));
            assert_eq!(path.display().to_string(), projection.path);
            // The pointer value recorded in nimi.json must resolve to this file.
            assert!(path.ends_with(FACTORY_PROFILE_INDEX_POINTER));

            let read_back = read_factory_profile_index()
                .expect("read")
                .expect("record present");
            assert_eq!(read_back, projection.record);
        });
    }

    #[test]
    fn read_returns_none_when_projection_is_absent() {
        let home = temp_home("absent");
        with_env(&[("HOME", home.to_str())], || {
            assert!(read_factory_profile_index().expect("read").is_none());
        });
    }

    #[test]
    fn unknown_future_schema_version_routes_repair_required() {
        let home = temp_home("future-schema");
        with_env(&[("HOME", home.to_str())], || {
            ensure_factory_profile_index().expect("ensure");
            let path = factory_profile_index_path().expect("path");
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
            match read_factory_profile_index_governed().expect("governed read") {
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
    fn ensure_does_not_overwrite_future_schema_projection() {
        let home = temp_home("ensure-future-schema");
        with_env(&[("HOME", home.to_str())], || {
            ensure_factory_profile_index().expect("ensure");
            let path = factory_profile_index_path().expect("path");
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

            let error = ensure_factory_profile_index().expect_err("future schema repair");
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
            let path = factory_profile_index_path().expect("path");
            std::fs::create_dir_all(path.parent().expect("parent")).expect("mkdir");
            std::fs::write(&path, "{ not valid json").expect("write corrupt");
            match read_factory_profile_index_governed().expect("governed read") {
                ConfigReadOutcome::Repair { severity, reason } => {
                    assert_eq!(severity, ConfigRepairSeverity::RepairRequired);
                    assert!(reason.contains("not valid JSON"));
                }
                other => panic!("expected repair_required, got {other:?}"),
            }
        });
    }

    #[test]
    fn regeneration_does_not_touch_account_default_profile() {
        let home = temp_home("account-isolation");
        with_env(&[("HOME", home.to_str())], || {
            // Seed a stand-in Account Default Profile record under the account
            // control root. The factory index projection must never read,
            // overwrite, or otherwise mutate it.
            let account_default_profile = home
                .join(".nimi")
                .join("accounts")
                .join("account_1")
                .join("profiles")
                .join("default.json");
            std::fs::create_dir_all(account_default_profile.parent().expect("parent"))
                .expect("mkdir");
            let account_default_contents = "{\"profileId\":\"default\",\"editedLocally\":true}";
            std::fs::write(&account_default_profile, account_default_contents)
                .expect("write account default");

            ensure_factory_profile_index().expect("ensure 1");
            ensure_factory_profile_index().expect("ensure 2 (idempotent regeneration)");

            assert_eq!(
                std::fs::read_to_string(&account_default_profile).expect("read account default"),
                account_default_contents
            );
        });
    }

    #[test]
    fn serde_round_trip_preserves_record() {
        let record = build_factory_profile_index_record().expect("record");
        let raw = serde_json::to_string_pretty(&record).expect("serialize");
        let parsed: FactoryProfileIndexRecord = serde_json::from_str(&raw).expect("deserialize");
        assert_eq!(record, parsed);
    }
}
