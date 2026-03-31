use std::fs;
use std::path::{Component, Path, PathBuf};

const NIMI_DIR_NAME: &str = ".nimi";
const NIMI_DATA_DIR_NAME: &str = "data";

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

pub fn resolve_nimi_data_dir() -> Result<PathBuf, String> {
    let path = normalize_absolute_path(&resolve_nimi_dir()?.join(NIMI_DATA_DIR_NAME));
    fs::create_dir_all(&path).map_err(|error| {
        format!(
            "failed to create nimi_data_dir ({}): {error}",
            path.display()
        )
    })?;
    Ok(path)
}
