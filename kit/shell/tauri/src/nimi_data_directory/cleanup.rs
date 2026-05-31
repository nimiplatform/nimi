//! `nimi_data` destructive-cleanup confirmation — `P-MIG-008`.

use std::fs;
use std::path::Path;

use serde::Serialize;

use super::layout::measure_directory;
use super::ownership::{first_level_row, CleanupClass};

pub const DESTRUCTIVE_CLEANUP_CONFIRMATION: &str = "CLEAN";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanupPlan {
    pub directory: String,
    pub owner: String,
    pub cleanup_class: String,
    pub total_bytes: u64,
    pub file_count: u64,
    pub requires_confirmation: bool,
    pub runtime_owner_blocked: bool,
}

fn cleanup_class_id(class: CleanupClass) -> &'static str {
    match class {
        CleanupClass::PureCache => "pure_cache",
        CleanupClass::RuntimeManaged => "runtime_managed",
        CleanupClass::ConfirmRequired => "confirm_required",
        CleanupClass::UserManaged => "user_managed",
    }
}

pub fn plan_directory_cleanup(data_root: &Path, directory: &str) -> Result<CleanupPlan, String> {
    let row = first_level_row(directory).ok_or_else(|| {
        format!("{directory} 不是 P-MIG-006 矩阵中的一级 nimi_data 目录，无法清理")
    })?;
    let usage = measure_directory(&data_root.join(directory))?;
    Ok(CleanupPlan {
        directory: directory.to_string(),
        owner: row.owner.owner_id().to_string(),
        cleanup_class: cleanup_class_id(row.cleanup).to_string(),
        total_bytes: usage.total_bytes,
        file_count: usage.file_count,
        requires_confirmation: row.cleanup.requires_confirmation(),
        runtime_owner_blocked: row.owner.is_runtime_owned(),
    })
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanupOutcome {
    pub directory: String,
    pub removed_bytes: u64,
    pub removed_files: u64,
}

pub fn execute_directory_cleanup(
    data_root: &Path,
    directory: &str,
    confirmation: Option<&str>,
) -> Result<CleanupOutcome, String> {
    let row = first_level_row(directory).ok_or_else(|| {
        format!("{directory} 不是 P-MIG-006 矩阵中的一级 nimi_data 目录，无法清理")
    })?;

    if row.owner.is_runtime_owned() {
        return Err(format!(
            "{directory} 由 Runtime ({}) 拥有，P-MIG-006 禁止 Desktop 直接清理；必须通过 Runtime 管理路径",
            row.owner.owner_id()
        ));
    }

    if row.cleanup.requires_confirmation() {
        let supplied = confirmation.map(str::trim).unwrap_or_default();
        if supplied != DESTRUCTIVE_CLEANUP_CONFIRMATION {
            return Err(format!(
                "清理 {directory} 会删除非缓存的用户/应用/账户数据，必须提供显式确认令牌 ({DESTRUCTIVE_CLEANUP_CONFIRMATION})"
            ));
        }
    }

    let target = data_root.join(directory);
    let usage = measure_directory(&target)?;
    if target.exists() {
        fs::remove_dir_all(&target)
            .map_err(|error| format!("清理 nimi_data 目录失败 ({}): {error}", target.display()))?;
    }
    fs::create_dir_all(&target).map_err(|error| {
        format!(
            "清理后重建 nimi_data 目录失败 ({}): {error}",
            target.display()
        )
    })?;

    Ok(CleanupOutcome {
        directory: directory.to_string(),
        removed_bytes: usage.total_bytes,
        removed_files: usage.file_count,
    })
}
