use std::fs;
use std::path::{Component, Path, PathBuf};

const NIMI_DATA_ROOT_ENV: &str = "NIMI_DATA_ROOT";

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

pub(crate) fn resolve_env_nimi_data_root(value: Option<&str>) -> Result<Option<PathBuf>, String> {
    let Some(raw) = value.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(None);
    };
    let candidate = PathBuf::from(raw);
    if !candidate.is_absolute() {
        return Err(format!("{NIMI_DATA_ROOT_ENV} must be an absolute path"));
    }
    Ok(Some(normalize_absolute_path(&candidate)))
}

pub(crate) fn resolve_avatar_nimi_data_dir() -> Result<PathBuf, String> {
    let env_value = std::env::var(NIMI_DATA_ROOT_ENV).ok();
    let path = match resolve_env_nimi_data_root(env_value.as_deref())? {
        Some(path) => path,
        None => nimi_shell_tauri::desktop_paths::resolve_nimi_data_dir()?,
    };
    fs::create_dir_all(&path).map_err(|error| {
        format!(
            "failed to create Avatar nimi_data root ({}): {error}",
            path.display()
        )
    })?;
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::resolve_env_nimi_data_root;

    #[test]
    fn env_nimi_data_root_requires_absolute_path() {
        let error = resolve_env_nimi_data_root(Some("relative/nimi-data"))
            .expect_err("relative env root must fail");

        assert!(error.contains("NIMI_DATA_ROOT must be an absolute path"));
    }

    #[test]
    fn env_nimi_data_root_normalizes_absolute_path() {
        let root = resolve_env_nimi_data_root(Some("/tmp/nimi-data/../nimi-data-selected"))
            .expect("valid root")
            .expect("root");

        assert_eq!(root, std::path::PathBuf::from("/tmp/nimi-data-selected"));
    }
}
