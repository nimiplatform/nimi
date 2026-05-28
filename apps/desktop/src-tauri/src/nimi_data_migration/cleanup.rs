//! `nimi_data` destructive-cleanup confirmation — `P-MIG-008`.
//!
//! `P-MIG-008` requires that any cleanup that can delete user / app / account
//! data present an explicit confirmation + impact preview before it runs, and
//! obey the `P-MIG-006` cleanup rule of the directory it targets. Pure-cache
//! directories (`cache/` / `tmp/`-shaped) may be cleared without a forced
//! confirmation, but the cleanup still classifies through the same matrix.
//!
//! This module is the cleanup mechanism. It exposes:
//! - a typed cleanup *plan* (the impact preview a UI shows before confirming);
//! - a confirmed cleanup *execution* that fails closed without a matching
//!   confirmation token for any non-pure-cache directory;
//! - a Runtime-owner boundary guard: `models/` / `dependencies/` /
//!   `environments/` are never cleaned by this Desktop path at all.

use std::fs;
use std::path::Path;

use serde::Serialize;

use super::layout::measure_directory;
use super::ownership::{first_level_row, CleanupClass};

/// The confirmation token a destructive cleanup must echo back (`P-MIG-008`).
///
/// A non-pure-cache cleanup is only executed when the caller supplies this
/// exact token, which a UI obtains from the user as an explicit, deliberate
/// action. It is intentionally not localizable and not derivable — a caller
/// cannot accidentally satisfy it.
pub const DESTRUCTIVE_CLEANUP_CONFIRMATION: &str = "CLEAN";

/// A typed cleanup plan — the `P-MIG-008` impact preview.
///
/// Computed before any deletion happens. `requires_confirmation` tells a UI
/// whether it must collect the [`DESTRUCTIVE_CLEANUP_CONFIRMATION`] token;
/// `runtime_owner_blocked` tells it the directory is Runtime-owned and this
/// Desktop cleanup path will refuse it outright (`P-MIG-006`).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanupPlan {
    /// First-level `nimi_data` directory name targeted by the cleanup.
    pub directory: String,
    /// Canonical `P-MIG-006` owner id of the directory.
    pub owner: String,
    /// `pure_cache` / `runtime_managed` / `confirm_required` / `user_managed`.
    pub cleanup_class: String,
    /// Bytes that would be removed.
    pub total_bytes: u64,
    /// Regular files that would be removed.
    pub file_count: u64,
    /// Whether executing this cleanup requires the explicit confirmation token
    /// (`P-MIG-008`). `false` only for a pure-cache directory.
    pub requires_confirmation: bool,
    /// Whether this Desktop cleanup path will refuse the directory because it
    /// is Runtime-owned (`P-MIG-006`).
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

/// Compute the cleanup plan / impact preview for a first-level `nimi_data`
/// directory (`P-MIG-008`).
///
/// `directory` must be a declared first-level directory name from the
/// `P-MIG-006` matrix — an undeclared directory has no owner and is rejected.
/// This scans the directory for the real byte / file impact; it deletes
/// nothing.
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

/// The typed result of a confirmed `nimi_data` directory cleanup (`P-MIG-008`).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanupOutcome {
    /// First-level `nimi_data` directory that was cleaned.
    pub directory: String,
    /// Bytes removed (the pre-cleanup scan).
    pub removed_bytes: u64,
    /// Files removed (the pre-cleanup scan).
    pub removed_files: u64,
}

/// Execute a confirmed cleanup of a first-level `nimi_data` directory
/// (`P-MIG-008`).
///
/// Fail-closed rules, in order:
///
/// 1. `directory` must be a declared first-level matrix directory.
/// 2. A Runtime-owned directory (`models` / `dependencies` / `environments`)
///    is rejected outright — `P-MIG-006` forbids the Desktop shell from
///    mutating it; it must go through a Runtime job.
/// 3. A non-pure-cache directory requires `confirmation` to equal
///    [`DESTRUCTIVE_CLEANUP_CONFIRMATION`]; a missing / wrong token fails
///    closed with no deletion.
/// 4. A pure-cache directory may be cleaned without a token.
///
/// The cleanup removes the directory's *contents* and re-creates the empty
/// directory, so the `P-MIG-006` layout still holds afterwards. It never
/// removes the data root itself.
pub fn execute_directory_cleanup(
    data_root: &Path,
    directory: &str,
    confirmation: Option<&str>,
) -> Result<CleanupOutcome, String> {
    let row = first_level_row(directory).ok_or_else(|| {
        format!("{directory} 不是 P-MIG-006 矩阵中的一级 nimi_data 目录，无法清理")
    })?;

    // P-MIG-006: a Runtime-owned data plane is never cleaned by the Desktop
    // shell — it must go through a Runtime-owned management / job path.
    if row.owner.is_runtime_owned() {
        return Err(format!(
            "{directory} 由 Runtime ({}) 拥有，P-MIG-006 禁止 Desktop 直接清理；必须通过 Runtime 管理路径",
            row.owner.owner_id()
        ));
    }

    // P-MIG-008: a non-pure-cache directory requires the explicit confirmation
    // token. Without it, fail closed — delete nothing.
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
    // Re-create the empty directory so the P-MIG-006 first-level layout still
    // holds after the cleanup.
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

/// Reclaim a retained post-migration old `nimi_data` data root (`P-MIG-008`).
///
/// This is the explicit, confirmed cleanup that completes the lifecycle the
/// migration flow deliberately left open (`old_root_retained = true`). It is
/// always destructive — the old root holds the full pre-migration data set —
/// so it always requires the [`DESTRUCTIVE_CLEANUP_CONFIRMATION`] token.
///
/// Fail-closed guards:
/// - the old root must be different from the `active_root` — this can never
///   delete the data root the product is currently using;
/// - the active root must not be nested inside the old root;
/// - the confirmation token must match.
pub fn reclaim_old_root(
    old_root: &Path,
    active_root: &Path,
    confirmation: Option<&str>,
) -> Result<CleanupOutcome, String> {
    let old = crate::desktop_paths::normalize_desktop_absolute_path(old_root);
    let active = crate::desktop_paths::normalize_desktop_absolute_path(active_root);
    if old == active {
        return Err("拒绝回收：待回收的旧 nimi_data 数据根与当前活动数据根相同".to_string());
    }
    if active.starts_with(&old) {
        return Err(format!(
            "拒绝回收：当前活动 nimi_data 数据根 ({}) 嵌套在待回收的旧数据根 ({}) 之内",
            active.display(),
            old.display()
        ));
    }
    let supplied = confirmation.map(str::trim).unwrap_or_default();
    if supplied != DESTRUCTIVE_CLEANUP_CONFIRMATION {
        return Err(format!(
            "回收旧 nimi_data 数据根会删除迁移前的全部用户/应用/账户数据，必须提供显式确认令牌 ({DESTRUCTIVE_CLEANUP_CONFIRMATION})"
        ));
    }
    let usage = measure_directory(&old)?;
    if old.exists() {
        fs::remove_dir_all(&old)
            .map_err(|error| format!("回收旧 nimi_data 数据根失败 ({}): {error}", old.display()))?;
    }
    Ok(CleanupOutcome {
        directory: old.display().to_string(),
        removed_bytes: usage.total_bytes,
        removed_files: usage.file_count,
    })
}
