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

pub fn resolve_nimi_dir() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or_else(|| "cannot resolve home directory".to_string())?;
    let dir = home.join(NIMI_DIR_NAME);
    fs::create_dir_all(&dir).map_err(|error| format!("failed to create ~/.nimi/: {error}"))?;
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
    let raw = fs::read_to_string(&path).map_err(|error| {
        format!(
            "failed to read desktop paths config ({}): {error}",
            path.display()
        )
    })?;
    serde_json::from_str::<DesktopPathsConfigFile>(&raw).map_err(|error| {
        format!(
            "failed to parse desktop paths config ({}): {error}",
            path.display()
        )
    })
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
                return Err("nimi_data_dir must be an absolute path".to_string());
            }
            normalize_absolute_path(&path)
        }
        None => default_nimi_data_dir()?,
    };
    fs::create_dir_all(&path).map_err(|error| {
        format!(
            "failed to create nimi_data_dir ({}): {error}",
            path.display()
        )
    })?;
    Ok(path)
}
