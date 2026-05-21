//! `nimi_data` migration size / impact preview — `P-MIG-007`.
//!
//! `P-MIG-007` requires that moving the `nimi_data` data root after first-run
//! present a size / impact preview before the user confirms: the data volume
//! to move, the affected directories classified by `P-MIG-006` owner, and the
//! projected impact. This module computes that preview as a typed,
//! serializable payload the later Settings / Support UI wave renders.

use std::path::{Path, PathBuf};

use serde::Serialize;

use super::layout::{scan_data_root, DirectoryUsage};
use super::ownership::{first_level_row, DirectoryOwner};

/// The per-directory impact line of a migration preview.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectoryImpact {
    /// First-level `nimi_data` directory name (`models`, `apps`, ...), or the
    /// on-disk name of an unowned extra directory.
    pub directory: String,
    /// Canonical `P-MIG-006` owner id, or `unowned` for a directory that is
    /// not declared in the ownership matrix.
    pub owner: String,
    /// Whether the owner is a Runtime-owned data plane (`models` /
    /// `dependencies` / `environments`).
    pub runtime_owned: bool,
    /// Whether this directory is declared in the `P-MIG-006` ownership matrix.
    pub declared: bool,
    /// Total bytes in this directory subtree.
    pub total_bytes: u64,
    /// Regular file count in this directory subtree.
    pub file_count: u64,
}

/// The size / impact preview of a `nimi_data` data-root migration (`P-MIG-007`).
///
/// This is the typed payload a confirmation surface presents before the user
/// commits a migration. It is computed, not estimated: every byte / file count
/// comes from a real recursive scan of the current data root.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MigrationPreview {
    /// Absolute current (source) `nimi_data` data root.
    pub source_root: String,
    /// Absolute requested (target) `nimi_data` data root.
    pub target_root: String,
    /// Total bytes that will be moved.
    pub total_bytes: u64,
    /// Total regular files that will be moved.
    pub total_files: u64,
    /// Total directories that will be moved.
    pub total_directories: u64,
    /// Per-directory impact lines, ordered: declared first-level directories
    /// in matrix order, then any unowned extras.
    pub directories: Vec<DirectoryImpact>,
    /// Names of on-disk first-level entries not declared in the matrix. The
    /// migration still moves them (no orphaning) — they are surfaced so the
    /// preview can warn the user about foreign content in the data root.
    pub unowned_directories: Vec<String>,
    /// `true` when at least one Runtime-owned directory carries data. The
    /// migration moves these as opaque trees; the preview flags them because a
    /// Runtime restart / re-resolve follows the migration.
    pub includes_runtime_owned_data: bool,
}

fn impact_line(
    directory: &str,
    usage: DirectoryUsage,
    owner: Option<DirectoryOwner>,
) -> DirectoryImpact {
    DirectoryImpact {
        directory: directory.to_string(),
        owner: owner
            .map(DirectoryOwner::owner_id)
            .unwrap_or("unowned")
            .to_string(),
        runtime_owned: owner.is_some_and(DirectoryOwner::is_runtime_owned),
        declared: owner.is_some(),
        total_bytes: usage.total_bytes,
        file_count: usage.file_count,
    }
}

/// Compute the migration preview for moving `source_root` to `target_root`.
///
/// The source data root must exist (it is the current `nimi_data`); the target
/// is validated for shape only here — full target validation
/// (`P-MIG-007` collision / nesting checks) happens in the flow. The preview
/// performs a real recursive scan, so it reflects exact on-disk volume.
pub fn compute_migration_preview(
    source_root: &Path,
    target_root: &Path,
) -> Result<MigrationPreview, String> {
    let breakdown = scan_data_root(source_root)?;
    let total = breakdown.total();

    let mut directories = Vec::new();
    let mut includes_runtime_owned_data = false;
    for (name, usage) in &breakdown.per_directory {
        let owner = first_level_row(name).map(|row| row.owner);
        if owner.is_some_and(DirectoryOwner::is_runtime_owned) && usage.total_bytes > 0 {
            includes_runtime_owned_data = true;
        }
        directories.push(impact_line(name, *usage, owner));
    }
    for name in &breakdown.unowned_names {
        directories.push(impact_line(name, DirectoryUsage::default(), None));
    }

    Ok(MigrationPreview {
        source_root: source_root.display().to_string(),
        target_root: target_root.display().to_string(),
        total_bytes: total.total_bytes,
        total_files: total.file_count,
        total_directories: total.directory_count,
        directories,
        unowned_directories: breakdown.unowned_names,
        includes_runtime_owned_data,
    })
}

/// Resolve the absolute, normalized target root path from a user-supplied
/// string, applying the `P-MIG-007` shape rules.
///
/// Rejects: an empty path, a relative path, a path that is identical to the
/// source, a target nested inside the source, or a source nested inside the
/// target. Nesting in either direction would make the recursive copy either
/// self-referential or destroy the source mid-move — both are fail-closed.
pub fn resolve_migration_target(
    source_root: &Path,
    requested_target: &str,
) -> Result<PathBuf, String> {
    let trimmed = requested_target.trim();
    if trimmed.is_empty() {
        return Err("目标 nimi_data 路径不能为空".to_string());
    }
    let candidate = PathBuf::from(trimmed);
    if !candidate.is_absolute() {
        return Err(format!(
            "目标 nimi_data 路径必须是绝对路径，当前值: {trimmed}"
        ));
    }
    let target = crate::desktop_paths::normalize_desktop_absolute_path(&candidate);
    let source = crate::desktop_paths::normalize_desktop_absolute_path(source_root);
    if target == source {
        return Err("目标 nimi_data 路径与当前数据根相同，无需迁移".to_string());
    }
    if target.starts_with(&source) {
        return Err(format!(
            "目标 nimi_data 路径 ({}) 嵌套在当前数据根 ({}) 之内，拒绝迁移",
            target.display(),
            source.display()
        ));
    }
    if source.starts_with(&target) {
        return Err(format!(
            "当前 nimi_data 数据根 ({}) 嵌套在目标路径 ({}) 之内，拒绝迁移",
            source.display(),
            target.display()
        ));
    }
    Ok(target)
}
