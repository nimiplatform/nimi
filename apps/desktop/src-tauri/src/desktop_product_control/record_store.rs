//! Product-control record construction, structural validation, atomic
//! persistence, and the selected `nimi_data` data-root layout.

use crate::desktop_paths::normalize_desktop_absolute_path;
use std::fs;
use std::path::{Path, PathBuf};

use super::paths::{new_install_id, now_unix_ms, product_version};
use super::pointers::resolve_product_pointers;
use super::record::{
    ProductControlRecord, ProductControlState, ProductDataRootStatus, ProductFirstRunRecord,
    ProductRepairRecord, PRODUCT_CONTROL_SCHEMA_VERSION,
};

pub(crate) fn empty_record(state: ProductControlState) -> Result<ProductControlRecord, String> {
    Ok(ProductControlRecord {
        schema_version: PRODUCT_CONTROL_SCHEMA_VERSION,
        install_id: new_install_id(),
        product_version: product_version(),
        state,
        data_root: None,
        first_run: ProductFirstRunRecord::default(),
        pointers: resolve_product_pointers()?,
        repair: ProductRepairRecord::default(),
    })
}

pub(crate) fn read_existing_record(path: &Path) -> Result<Option<ProductControlRecord>, String> {
    if !path.exists() {
        return Ok(None);
    }
    let raw = fs::read_to_string(path)
        .map_err(|error| format!("读取 ~/.nimi/nimi.json 失败 ({}): {error}", path.display()))?;
    let record = serde_json::from_str::<ProductControlRecord>(&raw)
        .map_err(|error| format!("解析 ~/.nimi/nimi.json 失败 ({}): {error}", path.display()))?;
    validate_record(&record)?;
    Ok(Some(record))
}

/// Structural validation of `~/.nimi/nimi.json`.
///
/// `ready_for_use` is admission-gated, not hard-rejected: a `ready_for_use`
/// record must carry the full `ready-evidence-required` field set
/// (`product-control-record-schema.yaml`). This is a shape gate only — it does
/// NOT trust the refs as valid. Owner re-verification of every first-run
/// evidence ref happens at read-for-entry in
/// [`read_product_control_projection`](super::projection::read_product_control_projection)
/// (local owners) and in the backend `AdmitProductReadyForUse` operation (all
/// four owners, P-COLD-016). A `ready_for_use` record with populated-but-
/// unverified refs, or a direct file edit, still fails closed to a non-ready
/// state because the refs never resolve through their owners.
fn validate_record(record: &ProductControlRecord) -> Result<(), String> {
    if record.schema_version != PRODUCT_CONTROL_SCHEMA_VERSION {
        return Err(format!(
            "unsupported ~/.nimi/nimi.json schemaVersion={} expected={PRODUCT_CONTROL_SCHEMA_VERSION}",
            record.schema_version
        ));
    }
    if record.install_id.trim().is_empty() {
        return Err("~/.nimi/nimi.json installId is required".to_string());
    }
    if record.product_version.trim().is_empty() {
        return Err("~/.nimi/nimi.json productVersion is required".to_string());
    }
    if matches!(
        record.state,
        ProductControlState::DataRootSelected
            | ProductControlState::AiEnvironmentUnconfigured
            | ProductControlState::LocalAiProfileSelectedAssetsMissing
            | ProductControlState::LocalAiProfileSelectedEnvironmentNotReady
            | ProductControlState::LocalAiAssetsDownloadedEnvironmentNotReady
            | ProductControlState::LocalAiReady
            | ProductControlState::ReadyForUse
    ) && selected_data_root_path(record).is_none()
    {
        return Err("~/.nimi/nimi.json state requires dataRoot.path".to_string());
    }
    if let Some(data_root) = record.data_root.as_ref() {
        if data_root.selected_at.trim().is_empty() || data_root.verified_at.trim().is_empty() {
            return Err(
                "~/.nimi/nimi.json dataRoot requires selectedAt and verifiedAt".to_string(),
            );
        }
    }
    if matches!(record.state, ProductControlState::ReadyForUse) {
        validate_ready_for_use_shape(record)?;
    }
    Ok(())
}

/// Shape gate for a `ready_for_use` record: every `ready-evidence-required`
/// field must be present and non-empty, and `dataRoot.status` must be `ready`.
///
/// This guarantees a `ready_for_use` record is structurally complete before it
/// is admitted for owner re-verification; it never asserts the refs are valid.
fn validate_ready_for_use_shape(record: &ProductControlRecord) -> Result<(), String> {
    let data_root = record
        .data_root
        .as_ref()
        .ok_or_else(|| "~/.nimi/nimi.json ready_for_use requires dataRoot".to_string())?;
    if !matches!(data_root.status, ProductDataRootStatus::Ready) {
        return Err("~/.nimi/nimi.json ready_for_use requires dataRoot.status=ready".to_string());
    }
    let first_run = &record.first_run;
    if !first_run.completed {
        return Err("~/.nimi/nimi.json ready_for_use requires firstRun.completed=true".to_string());
    }
    let required_present = first_run
        .completed_at
        .as_deref()
        .is_some_and(|value| !value.trim().is_empty())
        && first_run
            .install_level
            .as_deref()
            .is_some_and(|value| !value.trim().is_empty())
        && first_run
            .initialization_plan_id
            .as_deref()
            .is_some_and(|value| !value.trim().is_empty())
        && first_run
            .baseline_profile_ref
            .as_deref()
            .is_some_and(|value| !value.trim().is_empty())
        && first_run
            .baseline_commit_id
            .as_deref()
            .is_some_and(|value| !value.trim().is_empty())
        && first_run
            .account_default_profile_ref
            .as_deref()
            .is_some_and(|value| !value.trim().is_empty())
        && !first_run.built_in_ai_config_refs.is_empty()
        && first_run
            .built_in_ai_config_refs
            .iter()
            .all(|value| !value.trim().is_empty())
        && first_run
            .runtime_baseline_ref
            .as_deref()
            .is_some_and(|value| !value.trim().is_empty())
        && first_run
            .execution_evidence_ref
            .as_deref()
            .is_some_and(|value| !value.trim().is_empty());
    if !required_present {
        return Err(
            "~/.nimi/nimi.json ready_for_use requires the full first-run ready evidence field set"
                .to_string(),
        );
    }
    Ok(())
}

pub(crate) fn selected_data_root_path(record: &ProductControlRecord) -> Option<PathBuf> {
    let value = record.data_root.as_ref()?.path.trim();
    if value.is_empty() {
        return None;
    }
    let path = PathBuf::from(value);
    if !path.is_absolute() {
        return None;
    }
    Some(normalize_desktop_absolute_path(&path))
}

pub(crate) fn write_record(path: &Path, record: &ProductControlRecord) -> Result<(), String> {
    validate_record(record)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("创建 ~/.nimi 目录失败 ({}): {error}", parent.display()))?;
    }
    let raw = serde_json::to_string_pretty(record)
        .map_err(|error| format!("序列化 ~/.nimi/nimi.json 失败: {error}"))?;
    let tmp_path =
        path.with_extension(format!("json.tmp.{}.{}", std::process::id(), now_unix_ms()));
    fs::write(&tmp_path, raw).map_err(|error| {
        format!(
            "写入 ~/.nimi/nimi.json 临时文件失败 ({}): {error}",
            tmp_path.display()
        )
    })?;
    fs::rename(&tmp_path, path)
        .map_err(|error| format!("提交 ~/.nimi/nimi.json 失败 ({}): {error}", path.display()))?;
    Ok(())
}

/// Materialize the `nimi_data` data-root layout.
///
/// Delegates to [`crate::nimi_data_directory::enforce_data_root_layout`], the
/// single authoritative `P-MIG-006` layout builder: it creates exactly the
/// first-level directories declared in the `nimi_data` directory ownership
/// matrix (`tables/nimi-data-directory-ownership.yaml`), so the on-disk layout
/// can never drift from the kernel ownership table.
pub(crate) fn ensure_data_root_layout(path: &Path) -> Result<(), String> {
    crate::nimi_data_directory::enforce_data_root_layout(path)
}
