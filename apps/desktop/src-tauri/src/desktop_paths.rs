use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Component, Path, PathBuf};

const NIMI_DIR_NAME: &str = ".nimi";
const NIMI_DATA_DIR_NAME: &str = "data";
const DESKTOP_PATHS_CONFIG_FILE: &str = "desktop-paths.json";

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct DesktopPathsConfigFile {
    nimi_data_dir: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopStorageDirsPayload {
    pub nimi_dir: String,
    pub nimi_data_dir: String,
    pub installed_mods_dir: String,
    pub runtime_mod_db_path: String,
    pub media_cache_dir: String,
    pub local_models_dir: String,
    pub local_runtime_state_path: String,
}

fn normalize_absolute_path(path: &Path) -> PathBuf {
    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            Component::Prefix(prefix) => normalized.push(prefix.as_os_str()),
            Component::RootDir => normalized.push(component.as_os_str()),
            Component::CurDir => {}
            Component::ParentDir => {
                normalized.pop();
            }
            Component::Normal(segment) => normalized.push(segment),
        }
    }
    normalized
}

pub fn normalize_desktop_absolute_path(path: &Path) -> PathBuf {
    normalize_absolute_path(path)
}

pub fn resolve_nimi_dir() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or_else(|| "无法获取用户 home 目录".to_string())?;
    let dir = home.join(NIMI_DIR_NAME);
    fs::create_dir_all(&dir).map_err(|error| format!("创建 ~/.nimi/ 目录失败: {error}"))?;
    Ok(dir)
}

fn desktop_paths_config_path() -> Result<PathBuf, String> {
    Ok(resolve_nimi_dir()?.join(DESKTOP_PATHS_CONFIG_FILE))
}

fn read_desktop_paths_config() -> Result<DesktopPathsConfigFile, String> {
    let path = desktop_paths_config_path()?;
    if !path.exists() {
        return Ok(DesktopPathsConfigFile::default());
    }
    let raw = fs::read_to_string(&path)
        .map_err(|error| format!("读取 desktop paths 配置失败 ({}): {error}", path.display()))?;
    serde_json::from_str::<DesktopPathsConfigFile>(&raw)
        .map_err(|error| format!("解析 desktop paths 配置失败 ({}): {error}", path.display()))
}

fn write_desktop_paths_config(config: &DesktopPathsConfigFile) -> Result<(), String> {
    let path = desktop_paths_config_path()?;
    let raw = serde_json::to_string_pretty(config)
        .map_err(|error| format!("序列化 desktop paths 配置失败: {error}"))?;
    fs::write(&path, raw)
        .map_err(|error| format!("写入 desktop paths 配置失败 ({}): {error}", path.display()))
}

fn default_nimi_data_dir() -> Result<PathBuf, String> {
    Ok(resolve_nimi_dir()?.join(NIMI_DATA_DIR_NAME))
}

pub fn resolve_nimi_data_dir() -> Result<PathBuf, String> {
    let configured = read_desktop_paths_config()?
        .nimi_data_dir
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let path = match configured {
        Some(value) => {
            let path = PathBuf::from(value);
            if !path.is_absolute() {
                return Err("nimi_data_dir 必须是绝对路径".to_string());
            }
            normalize_absolute_path(&path)
        }
        None => default_nimi_data_dir()?,
    };
    fs::create_dir_all(&path)
        .map_err(|error| format!("创建 nimi_data_dir 失败 ({}): {error}", path.display()))?;
    Ok(path)
}

pub fn set_nimi_data_dir(path: &str) -> Result<DesktopStorageDirsPayload, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("nimi_data_dir 不能为空".to_string());
    }
    let candidate = PathBuf::from(trimmed);
    if !candidate.is_absolute() {
        return Err(format!("nimi_data_dir 必须是绝对路径，当前值: {trimmed}"));
    }
    let normalized = normalize_absolute_path(&candidate);
    fs::create_dir_all(&normalized).map_err(|error| {
        format!(
            "创建 nimi_data_dir 失败 ({}): {error}",
            normalized.display()
        )
    })?;
    write_desktop_paths_config(&DesktopPathsConfigFile {
        nimi_data_dir: Some(normalized.display().to_string()),
    })?;
    describe_desktop_storage_dirs()
}

pub fn describe_desktop_storage_dirs() -> Result<DesktopStorageDirsPayload, String> {
    let nimi_dir = resolve_nimi_dir()?;
    let nimi_data_dir = resolve_nimi_data_dir()?;
    let installed_mods_dir = nimi_data_dir.join("mods");
    let media_cache_dir = nimi_data_dir.join("cache").join("media");
    let local_models_dir = nimi_data_dir.join("models");
    let local_runtime_state_path = nimi_data_dir.join("state.json");
    let runtime_mod_db_path = nimi_data_dir.join("runtime-mod.db");

    for dir in [&installed_mods_dir, &media_cache_dir, &local_models_dir] {
        fs::create_dir_all(dir)
            .map_err(|error| format!("创建目录失败 ({}): {error}", dir.display()))?;
    }

    Ok(DesktopStorageDirsPayload {
        nimi_dir: nimi_dir.display().to_string(),
        nimi_data_dir: nimi_data_dir.display().to_string(),
        installed_mods_dir: installed_mods_dir.display().to_string(),
        runtime_mod_db_path: runtime_mod_db_path.display().to_string(),
        media_cache_dir: media_cache_dir.display().to_string(),
        local_models_dir: local_models_dir.display().to_string(),
        local_runtime_state_path: local_runtime_state_path.display().to_string(),
    })
}
