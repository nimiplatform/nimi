//! `nimi_data` data-root layout enforcement and recursive directory scanning.

#[cfg(test)]
use std::collections::BTreeMap;
use std::fs;
use std::path::Path;

#[cfg(test)]
use super::ownership::first_level_row;
use super::ownership::{first_level_directory_names, is_declared_first_level};

pub fn enforce_data_root_layout(root: &Path) -> Result<(), String> {
    fs::create_dir_all(root)
        .map_err(|error| format!("nimi_data 根目录创建失败 ({}): {error}", root.display()))?;
    for name in first_level_directory_names() {
        if !is_declared_first_level(name) {
            return Err(format!(
                "nimi_data 子目录 {name} 不在 P-MIG-006 目录所有权矩阵中，拒绝创建"
            ));
        }
        let dir = root.join(name);
        fs::create_dir_all(&dir)
            .map_err(|error| format!("nimi_data 子目录创建失败 ({}): {error}", dir.display()))?;
    }
    Ok(())
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct DirectoryUsage {
    pub total_bytes: u64,
    pub file_count: u64,
    pub directory_count: u64,
}

impl DirectoryUsage {
    fn add(&mut self, other: DirectoryUsage) {
        self.total_bytes = self.total_bytes.saturating_add(other.total_bytes);
        self.file_count = self.file_count.saturating_add(other.file_count);
        self.directory_count = self.directory_count.saturating_add(other.directory_count);
    }
}

pub fn measure_directory(path: &Path) -> Result<DirectoryUsage, String> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(DirectoryUsage::default());
        }
        Err(error) => {
            return Err(format!("读取目录元数据失败 ({}): {error}", path.display()));
        }
    };
    if !metadata.is_dir() {
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
        let entry_metadata = fs::symlink_metadata(&entry_path)
            .map_err(|error| format!("读取目录项元数据失败 ({}): {error}", entry_path.display()))?;
        let file_type = entry_metadata.file_type();
        if file_type.is_symlink() {
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

#[derive(Debug, Clone, Default)]
#[cfg(test)]
pub struct DataRootUsageBreakdown {
    pub per_directory: BTreeMap<String, DirectoryUsage>,
    pub unowned_extra: DirectoryUsage,
    pub unowned_names: Vec<String>,
}

#[cfg(test)]
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
