//! `nimi_data` data-root layout enforcement and recursive directory scanning.
//!
//! `P-MIG-006`: every first-level `nimi_data` directory has a declared owner
//! in `NIMI_DATA_DIRECTORY_MATRIX`. `enforce_data_root_layout` materializes
//! exactly that declared set — it is the authoritative directory model, so a
//! data root is never created with an undeclared or missing first-level
//! directory.
//!
//! The scan helpers compute the per-owner size / file-count breakdown the
//! `P-MIG-007` migration preview needs, and back the integrity verification
//! that gates the atomic pointer cutover.

use std::collections::BTreeMap;
use std::fs;
use std::path::Path;

use super::ownership::{first_level_directory_names, first_level_row, is_declared_first_level};

/// Materialize the `nimi_data` data-root layout enforced by `P-MIG-006`.
///
/// Creates the root and every first-level directory declared in
/// `NIMI_DATA_DIRECTORY_MATRIX`. This is the single authoritative layout
/// builder: callers that previously hardcoded a directory list now route here
/// so the on-disk layout cannot drift from the kernel ownership table.
pub fn enforce_data_root_layout(root: &Path) -> Result<(), String> {
    fs::create_dir_all(root).map_err(|error| {
        format!(
            "nimi_data 根目录创建失败 ({}): {error}",
            root.display()
        )
    })?;
    for name in first_level_directory_names() {
        // P-MIG-006: a directory created under the data root must be a
        // declared first-level directory. `first_level_directory_names` is
        // derived from the matrix, so this can only ever create declared
        // directories — the re-assert is a defensive guard against a future
        // code path passing an undeclared name.
        if !is_declared_first_level(name) {
            return Err(format!(
                "nimi_data 子目录 {name} 不在 P-MIG-006 目录所有权矩阵中，拒绝创建"
            ));
        }
        let dir = root.join(name);
        fs::create_dir_all(&dir).map_err(|error| {
            format!(
                "nimi_data 子目录创建失败 ({}): {error}",
                dir.display()
            )
        })?;
    }
    Ok(())
}

/// The recursive size / file-count measurement of one directory subtree.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct DirectoryUsage {
    /// Total bytes of all regular files in the subtree.
    pub total_bytes: u64,
    /// Count of regular files in the subtree.
    pub file_count: u64,
    /// Count of directories in the subtree (excluding the root itself).
    pub directory_count: u64,
}

impl DirectoryUsage {
    fn add(&mut self, other: DirectoryUsage) {
        self.total_bytes = self.total_bytes.saturating_add(other.total_bytes);
        self.file_count = self.file_count.saturating_add(other.file_count);
        self.directory_count = self
            .directory_count
            .saturating_add(other.directory_count);
    }
}

/// Recursively measure a directory subtree.
///
/// A non-existent path measures as an empty `DirectoryUsage` (not an error):
/// an absent first-level directory is a legitimate not-yet-materialized state.
/// Symlinks are NOT followed — a symlink is counted as a single entry and not
/// descended into, so the measurement cannot loop and cannot escape the
/// `nimi_data` subtree.
pub fn measure_directory(path: &Path) -> Result<DirectoryUsage, String> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(DirectoryUsage::default());
        }
        Err(error) => {
            return Err(format!(
                "读取目录元数据失败 ({}): {error}",
                path.display()
            ));
        }
    };
    if !metadata.is_dir() {
        // A regular file or symlink at the scan root.
        return Ok(DirectoryUsage {
            total_bytes: metadata.len(),
            file_count: 1,
            directory_count: 0,
        });
    }
    let mut usage = DirectoryUsage::default();
    let entries = fs::read_dir(path)
        .map_err(|error| format!("读取目录失败 ({}): {error}", path.display()))?;
    for entry in entries {
        let entry =
            entry.map_err(|error| format!("遍历目录项失败 ({}): {error}", path.display()))?;
        let entry_path = entry.path();
        let entry_metadata = fs::symlink_metadata(&entry_path).map_err(|error| {
            format!(
                "读取目录项元数据失败 ({}): {error}",
                entry_path.display()
            )
        })?;
        let file_type = entry_metadata.file_type();
        if file_type.is_symlink() {
            // Count a symlink as one file; do not descend (no loop, no escape).
            usage.file_count = usage.file_count.saturating_add(1);
        } else if file_type.is_dir() {
            usage.directory_count = usage.directory_count.saturating_add(1);
            usage.add(measure_directory(&entry_path)?);
        } else {
            usage.file_count = usage.file_count.saturating_add(1);
            usage.total_bytes = usage.total_bytes.saturating_add(entry_metadata.len());
        }
    }
    Ok(usage)
}

/// The per-first-level-directory usage breakdown of a `nimi_data` data root.
///
/// Each entry is one first-level matrix directory; `unowned_extra` is the
/// aggregate of any on-disk first-level entries that are NOT declared in the
/// matrix (a foreign directory the user or another tool placed in the data
/// root). The migration flow still copies those — dropping them would orphan
/// data (`P-MIG-005`) — but they are surfaced separately so the preview can
/// flag them.
#[derive(Debug, Clone, Default)]
pub struct DataRootUsageBreakdown {
    /// Per-declared-directory usage, keyed by the first-level directory name.
    pub per_directory: BTreeMap<String, DirectoryUsage>,
    /// Aggregate usage of on-disk first-level entries not in the matrix.
    pub unowned_extra: DirectoryUsage,
    /// The names of the on-disk first-level entries not in the matrix.
    pub unowned_names: Vec<String>,
}

impl DataRootUsageBreakdown {
    /// The total usage across every directory (declared + unowned).
    pub fn total(&self) -> DirectoryUsage {
        let mut total = self.unowned_extra;
        for usage in self.per_directory.values() {
            total.add(*usage);
        }
        total
    }
}

/// Compute the per-directory usage breakdown of an existing `nimi_data` data
/// root.
///
/// Scans every declared first-level directory and additionally every on-disk
/// first-level entry that is not declared in the matrix. The data root itself
/// must exist; a missing data root is a fault for the migration source.
pub fn scan_data_root(root: &Path) -> Result<DataRootUsageBreakdown, String> {
    if !root.is_dir() {
        return Err(format!(
            "nimi_data 数据根不存在或不是目录 ({})",
            root.display()
        ));
    }
    let mut breakdown = DataRootUsageBreakdown::default();
    for name in first_level_directory_names() {
        let usage = measure_directory(&root.join(name))?;
        breakdown.per_directory.insert(name.to_string(), usage);
    }
    // Surface any on-disk first-level entry that is not a declared directory:
    // the migration must still copy it (no orphaning) but the preview flags it.
    let entries = fs::read_dir(root)
        .map_err(|error| format!("读取 nimi_data 数据根失败 ({}): {error}", root.display()))?;
    for entry in entries {
        let entry = entry
            .map_err(|error| format!("遍历 nimi_data 数据根失败 ({}): {error}", root.display()))?;
        let entry_metadata = fs::symlink_metadata(entry.path()).map_err(|error| {
            format!(
                "读取 nimi_data 数据根项元数据失败 ({}): {error}",
                entry.path().display()
            )
        })?;
        if !entry_metadata.is_dir() {
            continue;
        }
        let Some(name) = entry.file_name().to_str().map(str::to_string) else {
            continue;
        };
        if first_level_row(&name).is_none() {
            breakdown
                .unowned_extra
                .add(measure_directory(&entry.path())?);
            breakdown.unowned_names.push(name);
        }
    }
    breakdown.unowned_names.sort();
    Ok(breakdown)
}

