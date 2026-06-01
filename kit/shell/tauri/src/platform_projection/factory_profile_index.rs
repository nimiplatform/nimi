//! Pure `~/.nimi/profiles/factory-index.json` projection rules.

use crate::governed_config::{
    read_governed_config, write_governed_json_config, ConfigReadOutcome, GovernedConfigFile,
};
use crate::platform_catalog::ai_profile_factory::{
    PlatformAIProfileFactoryRow, PLATFORM_AI_PROFILE_FACTORY_CATALOG_VERSION,
    PLATFORM_AI_PROFILE_FACTORY_ROWS, PLATFORM_AI_PROFILE_SELECTION_POLICY_REF,
};
use serde::{Deserialize, Serialize};
use std::path::Path;

pub const FACTORY_PROFILE_INDEX_SCHEMA_VERSION: u32 = 1;

const FACTORY_PROFILE_REF_PREFIX: &str = "factory-ai-profile";

/// `~/.nimi`-relative location of the factory profile index projection.
pub const FACTORY_PROFILE_INDEX_POINTER: &str = "profiles/factory-index.json";

/// Governed config-file identity for `~/.nimi/profiles/factory-index.json`
/// (`local-config-file-registry.yaml` row `factory_index_json`).
pub const FACTORY_PROFILE_INDEX_CONFIG_FILE: GovernedConfigFile = GovernedConfigFile::new(
    "factory_index_json",
    "~/.nimi/profiles/factory-index.json",
    FACTORY_PROFILE_INDEX_SCHEMA_VERSION,
);

/// One projected factory profile row.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FactoryProfileIndexRow {
    pub profile_ref: String,
    pub alias: String,
    pub mode: String,
    pub os: Vec<String>,
    pub device_class: String,
    pub capabilities: Vec<String>,
    pub applicable_scopes: Vec<String>,
    pub first_run_install_levels: Vec<String>,
}

/// Official selection policy refs projected alongside the catalog rows.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FactoryProfileIndexPolicies {
    pub baseline: String,
    pub recommended: String,
}

/// `~/.nimi/profiles/factory-index.json` record shape.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FactoryProfileIndexRecord {
    pub schema_version: u32,
    pub catalog_version: String,
    pub updated_at: String,
    pub policies: FactoryProfileIndexPolicies,
    pub profiles: Vec<FactoryProfileIndexRow>,
}

fn now_iso_timestamp() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

fn profile_ref_for_alias(alias: &str) -> String {
    format!("{FACTORY_PROFILE_REF_PREFIX}:v{PLATFORM_AI_PROFILE_FACTORY_CATALOG_VERSION}:{alias}")
}

fn os_axis_from_host_refs(host_refs: &[&'static str]) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for host_ref in host_refs {
        let os = match host_ref.split('-').next().unwrap_or_default() {
            "darwin" | "macos" => "macos",
            "windows" => "windows",
            "linux" => "linux",
            _ => continue,
        };
        let os = os.to_string();
        if !out.contains(&os) {
            out.push(os);
        }
    }
    out
}

fn device_class_from_compute_posture(compute_posture: &str) -> Result<String, String> {
    let class = match compute_posture {
        "cpu-only" => "cpu-standard",
        "metal-capable" => "apple-silicon",
        "cuda-capable" => "gpu-recommended",
        "cloud-only" => "cloud-only",
        other => {
            return Err(format!(
                "factory catalog row has an unknown compute_posture: {other}"
            ));
        }
    };
    Ok(class.to_string())
}

fn mode_from_install_levels(first_run_install_levels: &[&'static str]) -> String {
    if first_run_install_levels.contains(&"recommended") {
        "recommended".to_string()
    } else if first_run_install_levels.contains(&"minimal") {
        "baseline".to_string()
    } else {
        "scope-bound".to_string()
    }
}

fn project_row(row: &PlatformAIProfileFactoryRow) -> Result<FactoryProfileIndexRow, String> {
    Ok(FactoryProfileIndexRow {
        profile_ref: profile_ref_for_alias(row.alias),
        alias: row.alias.to_string(),
        mode: mode_from_install_levels(row.first_run_install_levels),
        os: os_axis_from_host_refs(row.host_capability_profile_refs),
        device_class: device_class_from_compute_posture(row.compute_posture)?,
        capabilities: row
            .capability_set
            .iter()
            .map(|value| value.to_string())
            .collect(),
        applicable_scopes: row
            .applicable_scopes
            .iter()
            .map(|value| value.to_string())
            .collect(),
        first_run_install_levels: row
            .first_run_install_levels
            .iter()
            .map(|value| value.to_string())
            .collect(),
    })
}

/// Build the factory profile index record from the packaged Platform factory
/// catalog.
pub fn build_factory_profile_index_record() -> Result<FactoryProfileIndexRecord, String> {
    let mut profiles = Vec::with_capacity(PLATFORM_AI_PROFILE_FACTORY_ROWS.len());
    for row in PLATFORM_AI_PROFILE_FACTORY_ROWS {
        profiles.push(project_row(row)?);
    }
    if profiles.is_empty() {
        return Err("Platform factory catalog projected zero profile rows".to_string());
    }
    Ok(FactoryProfileIndexRecord {
        schema_version: FACTORY_PROFILE_INDEX_SCHEMA_VERSION,
        catalog_version: format!("v{PLATFORM_AI_PROFILE_FACTORY_CATALOG_VERSION}"),
        updated_at: now_iso_timestamp(),
        policies: FactoryProfileIndexPolicies {
            baseline: PLATFORM_AI_PROFILE_SELECTION_POLICY_REF.to_string(),
            recommended: PLATFORM_AI_PROFILE_SELECTION_POLICY_REF.to_string(),
        },
        profiles,
    })
}

/// Structural validation of a factory profile index record.
pub fn validate_factory_profile_index_record(
    record: &FactoryProfileIndexRecord,
) -> Result<(), String> {
    if record.schema_version != FACTORY_PROFILE_INDEX_SCHEMA_VERSION {
        return Err(format!(
            "unsupported ~/.nimi/profiles/factory-index.json schemaVersion={} expected={FACTORY_PROFILE_INDEX_SCHEMA_VERSION}",
            record.schema_version
        ));
    }
    if record.catalog_version.trim().is_empty() {
        return Err("~/.nimi/profiles/factory-index.json catalogVersion is required".to_string());
    }
    if record.updated_at.trim().is_empty() {
        return Err("~/.nimi/profiles/factory-index.json updatedAt is required".to_string());
    }
    if record.policies.baseline.trim().is_empty() || record.policies.recommended.trim().is_empty() {
        return Err(
            "~/.nimi/profiles/factory-index.json policies.baseline and policies.recommended are required"
                .to_string(),
        );
    }
    if record.profiles.is_empty() {
        return Err(
            "~/.nimi/profiles/factory-index.json must project at least one factory profile row"
                .to_string(),
        );
    }
    for profile in &record.profiles {
        if profile.profile_ref.trim().is_empty() {
            return Err(
                "~/.nimi/profiles/factory-index.json profile row requires profileRef".to_string(),
            );
        }
        if profile.mode.trim().is_empty() {
            return Err(
                "~/.nimi/profiles/factory-index.json profile row requires mode".to_string(),
            );
        }
        if profile.device_class.trim().is_empty() {
            return Err(
                "~/.nimi/profiles/factory-index.json profile row requires deviceClass".to_string(),
            );
        }
        if profile.os.is_empty() {
            return Err(
                "~/.nimi/profiles/factory-index.json profile row requires a non-empty os list"
                    .to_string(),
            );
        }
        if profile.capabilities.is_empty() {
            return Err(
                "~/.nimi/profiles/factory-index.json profile row requires a non-empty capabilities list"
                    .to_string(),
            );
        }
    }
    Ok(())
}

/// Read an installed factory profile index projection through the shared
/// repair framework without mutating the file.
pub fn read_factory_profile_index_projection(
    path: &Path,
) -> Result<ConfigReadOutcome<FactoryProfileIndexRecord>, String> {
    read_governed_config(&FACTORY_PROFILE_INDEX_CONFIG_FILE, path, |document| {
        let record: FactoryProfileIndexRecord = serde_json::from_value(document.clone())
            .map_err(|error| format!("factory profile index cannot be deserialized: {error}"))?;
        validate_factory_profile_index_record(&record)?;
        Ok(record)
    })
}

/// Materialize the installed factory profile index projection if it is absent.
///
/// Current-schema files are returned as-is. Repair-routed files are left
/// untouched and surfaced to the caller; this function never overwrites a
/// faulted or future-schema projection.
pub fn materialize_factory_profile_index_projection(
    path: &Path,
) -> Result<ConfigReadOutcome<FactoryProfileIndexRecord>, String> {
    match read_factory_profile_index_projection(path)? {
        ConfigReadOutcome::Absent => {
            let record = build_factory_profile_index_record()?;
            write_governed_json_config(path, &record, validate_factory_profile_index_record)?;
            Ok(ConfigReadOutcome::Ready(record))
        }
        other => Ok(other),
    }
}

#[cfg(test)]
mod tests {
    use super::{
        build_factory_profile_index_record, materialize_factory_profile_index_projection,
        validate_factory_profile_index_record, FactoryProfileIndexRecord,
        FACTORY_PROFILE_INDEX_SCHEMA_VERSION,
    };
    use crate::governed_config::{ConfigReadOutcome, ConfigRepairSeverity};
    use crate::platform_catalog::ai_profile_factory::{
        PLATFORM_AI_PROFILE_FACTORY_CATALOG_VERSION, PLATFORM_AI_PROFILE_FACTORY_ROWS,
        PLATFORM_AI_PROFILE_SELECTION_POLICY_REF,
    };
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_projection_path(prefix: &str) -> std::path::PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time")
            .as_nanos();
        std::env::temp_dir()
            .join(format!("nimi-kit-factory-index-{prefix}-{unique}"))
            .join("factory-index.json")
    }

    #[test]
    fn projection_sources_every_catalog_row_without_inventing_rows() {
        let record = build_factory_profile_index_record().expect("record");
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
        let speech = record
            .profiles
            .iter()
            .find(|row| row.alias == "local-speech-ready")
            .expect("speech row");
        assert_eq!(speech.mode, "recommended");
        let gpu = record
            .profiles
            .iter()
            .find(|row| row.alias == "local-gpu")
            .expect("gpu row");
        assert_eq!(gpu.mode, "recommended");
        assert_eq!(gpu.device_class, "gpu-recommended");
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
    fn serde_round_trip_preserves_record() {
        let record = build_factory_profile_index_record().expect("record");
        validate_factory_profile_index_record(&record).expect("valid");
        let raw = serde_json::to_string_pretty(&record).expect("serialize");
        let parsed: FactoryProfileIndexRecord = serde_json::from_str(&raw).expect("deserialize");
        assert_eq!(record, parsed);
    }

    #[test]
    fn materializer_writes_absent_projection() {
        let path = temp_projection_path("absent");
        let outcome = materialize_factory_profile_index_projection(&path).expect("materialize");
        assert!(matches!(outcome, ConfigReadOutcome::Ready(_)));
        assert!(path.exists());
    }

    #[test]
    fn materializer_routes_future_schema_to_repair_without_overwrite() {
        let path = temp_projection_path("future");
        std::fs::create_dir_all(path.parent().expect("parent")).expect("mkdir");
        let mut record = build_factory_profile_index_record().expect("record");
        record.schema_version = 9999;
        let future_raw = serde_json::to_string_pretty(&record).expect("json");
        std::fs::write(&path, &future_raw).expect("write future schema");

        match materialize_factory_profile_index_projection(&path).expect("materialize") {
            ConfigReadOutcome::Repair { severity, reason } => {
                assert_eq!(severity, ConfigRepairSeverity::RepairRequired);
                assert!(reason.contains("newer than the supported version"));
            }
            other => panic!("expected repair_required, got {other:?}"),
        }
        assert_eq!(std::fs::read_to_string(&path).expect("read"), future_raw);
    }
}
