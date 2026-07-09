use crate::desktop_paths::normalize_desktop_absolute_path;

use super::super::paths::product_control_record_path;
use super::super::paths::{now_iso_timestamp, now_unix_ms};
use super::super::pointers::resolve_product_pointers;
use super::super::projection::read_product_control_projection;
use super::super::record::{
    ProductDataRootRecord, ProductDataRootStatus, ProductFirstRunRecord, ProductRepairRecord,
};
use super::super::record_store::{
    empty_record, ensure_data_root_layout, read_existing_record, selected_data_root_path,
    write_record,
};
use super::{ProductControlRecord, ProductControlRecordProjection, ProductControlState};
use std::path::PathBuf;

// Test-only local product-control record mutator.
// Production code must route product-control state changes through RuntimeLocalService.
#[cfg(test)]
pub fn ensure_product_control_record_created() -> Result<ProductControlRecordProjection, String> {
    let control_path = product_control_record_path()?;
    match read_existing_record(&control_path) {
        Ok(Some(_)) => read_product_control_projection(),
        Ok(None) => {
            let record = empty_record(ProductControlState::DataRootMissing)?;
            if let Err(error) = write_record(&control_path, &record) {
                return Ok(ProductControlRecordProjection {
                    path: control_path.display().to_string(),
                    exists: false,
                    state: ProductControlState::Blocked,
                    record: None,
                    error: Some(format!("~/.nimi/nimi.json could not be created: {error}")),
                });
            }
            read_product_control_projection()
        }
        Err(_) => read_product_control_projection(),
    }
}

// Test-only local product-control record mutator.
// Production code must route product-control state changes through RuntimeLocalService.
#[cfg(test)]
pub fn select_product_data_root(path: &str) -> Result<ProductControlRecordProjection, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("nimi_data path is required".to_string());
    }
    let candidate = PathBuf::from(trimmed);
    if !candidate.is_absolute() {
        return Err(format!("nimi_data path must be absolute, got: {trimmed}"));
    }
    let normalized = normalize_desktop_absolute_path(&candidate);
    let control_path = product_control_record_path()?;
    let mut record = match read_existing_record(&control_path)? {
        Some(mut record) => {
            ensure_first_run_data_root_selection_allowed(&record)?;
            record.first_run = ProductFirstRunRecord::default();
            record
        }
        None => empty_record(ProductControlState::DataRootMissing)?,
    };
    ensure_data_root_layout(&normalized)?;
    let now = now_unix_ms();
    record.state = ProductControlState::DataRootSelected;
    record.data_root = Some(ProductDataRootRecord {
        path: normalized.display().to_string(),
        status: ProductDataRootStatus::Selected,
        selected_at: now_iso_timestamp(),
        verified_at: now_iso_timestamp(),
        selected_at_unix_ms: now,
        verified_at_unix_ms: now,
    });
    record.pointers = resolve_product_pointers()?;
    record.repair = ProductRepairRecord::default();
    write_record(&control_path, &record)?;
    read_product_control_projection()
}

#[cfg(test)]
fn ensure_first_run_data_root_selection_allowed(
    record: &ProductControlRecord,
) -> Result<(), String> {
    if !matches!(
        record.state,
        ProductControlState::ConfigMissing
            | ProductControlState::DataRootMissing
            | ProductControlState::DataRootSelected
            | ProductControlState::AiEnvironmentUnconfigured
    ) {
        return Err(format!(
            "nimi_data data root is already beyond first-run selection state ({:?}); data-root selection is first-run only",
            record.state
        ));
    }
    if record
        .data_root
        .as_ref()
        .is_some_and(|data_root| matches!(data_root.status, ProductDataRootStatus::Ready))
    {
        return Err(
            "nimi_data data root is already ready; data-root selection is first-run only"
                .to_string(),
        );
    }
    let first_run = &record.first_run;
    let has_heavy_setup_evidence = first_run.completed
        || first_run.completed_at.is_some()
        || first_run.initialization_plan_id.is_some()
        || first_run.baseline_profile_ref.is_some()
        || first_run.baseline_commit_id.is_some()
        || first_run.account_default_profile_ref.is_some()
        || !first_run.built_in_ai_config_refs.is_empty()
        || first_run.runtime_baseline_ref.is_some()
        || first_run.execution_evidence_ref.is_some();
    if has_heavy_setup_evidence {
        return Err(
            "nimi_data data root cannot be changed after first-run evidence exists".to_string(),
        );
    }
    Ok(())
}

// Test-only local product-control record mutator.
// Production code must route product-control state changes through RuntimeLocalService.
#[cfg(test)]
pub fn set_first_run_install_level(
    install_level: &str,
    ai_profile_alias: Option<String>,
) -> Result<ProductControlRecordProjection, String> {
    let normalized = install_level.trim().to_lowercase();
    if normalized != "minimal" && normalized != "recommended" {
        return Err("first-run install level must be minimal or recommended".to_string());
    }
    let control_path = product_control_record_path()?;
    let mut record = read_existing_record(&control_path)?.ok_or_else(|| {
        "~/.nimi/nimi.json is missing; select nimi_data before install level".to_string()
    })?;
    if selected_data_root_path(&record).is_none() {
        return Err("selected nimi_data is required before install level".to_string());
    }
    let normalized_alias = ai_profile_alias
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let alias = normalized_alias
        .as_deref()
        .ok_or_else(|| "first-run aiProfileAlias is required".to_string())?;
    nimi_shell_tauri::capabilities::ai_profile::verify_first_run_factory_ai_profile(
        alias,
        &normalized,
    )?;
    record.first_run.install_level = Some(normalized);
    record.first_run.ai_profile_alias = Some(alias.to_string());
    record.first_run.completed = false;
    record.first_run.completed_at = None;
    record.first_run.initialization_plan_id = None;
    record.first_run.baseline_profile_ref = None;
    record.first_run.baseline_commit_id = None;
    record.first_run.account_default_profile_ref = None;
    record.first_run.built_in_ai_config_refs = Vec::new();
    record.first_run.runtime_baseline_ref = None;
    record.first_run.execution_evidence_ref = None;
    if matches!(record.state, ProductControlState::DataRootSelected) {
        record.state = ProductControlState::AiEnvironmentUnconfigured;
    }
    write_record(&control_path, &record)?;
    read_product_control_projection()
}

#[cfg(test)]
fn validate_first_run_device_profile(
    profile: &crate::runtime_bridge::generated::LocalDeviceProfile,
) -> Result<(), String> {
    if profile.os.trim().is_empty() || profile.arch.trim().is_empty() {
        return Err("Runtime device profile must include os and arch".to_string());
    }
    Ok(())
}

// Test-only local product-control record mutator.
// Production code must route product-control state changes through RuntimeLocalService.
#[cfg(test)]
pub(crate) fn complete_first_run_device_environment_scan_with_profile(
    host_profile: crate::runtime_bridge::generated::LocalDeviceProfile,
) -> Result<ProductControlRecordProjection, String> {
    validate_first_run_device_profile(&host_profile)?;
    let control_path = product_control_record_path()?;
    let mut record = read_existing_record(&control_path)?.ok_or_else(|| {
        "~/.nimi/nimi.json is missing; select nimi_data before device scan".to_string()
    })?;
    if selected_data_root_path(&record).is_none() {
        return Err("selected nimi_data is required before device scan".to_string());
    }
    match record.state {
        ProductControlState::DataRootSelected => {
            record.state = ProductControlState::AiEnvironmentUnconfigured;
        }
        ProductControlState::AiEnvironmentUnconfigured => {}
        _ => {
            return Err(
                "device environment scan can only complete after data-root selection".to_string(),
            );
        }
    }
    write_record(&control_path, &record)?;
    read_product_control_projection()
}
