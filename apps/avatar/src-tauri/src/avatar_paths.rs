use std::fs;
use std::path::{Component, Path, PathBuf};

const NIMI_APP_DATA_ROOT_ENV: &str = "NIMI_APP_DATA_ROOT";

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

pub(crate) fn resolve_env_app_data_root(value: Option<&str>) -> Result<Option<PathBuf>, String> {
    let Some(raw) = value.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(None);
    };
    let candidate = PathBuf::from(raw);
    if !candidate.is_absolute() {
        return Err(format!("{NIMI_APP_DATA_ROOT_ENV} must be an absolute path"));
    }
    Ok(Some(normalize_absolute_path(&candidate)))
}

pub(crate) fn resolve_avatar_app_data_dir() -> Result<PathBuf, String> {
    let env_value = std::env::var(NIMI_APP_DATA_ROOT_ENV).ok();
    let path = resolve_env_app_data_root(env_value.as_deref())?
        .ok_or_else(|| format!("{NIMI_APP_DATA_ROOT_ENV} is required"))?;
    fs::create_dir_all(&path).map_err(|error| {
        format!(
            "failed to create Avatar app data root ({}): {error}",
            path.display()
        )
    })?;
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::{resolve_avatar_app_data_dir, resolve_env_app_data_root};
    use crate::test_env_guard;

    #[test]
    fn env_app_data_root_requires_absolute_path() {
        let error = resolve_env_app_data_root(Some("relative/nimi-data"))
            .expect_err("relative env root must fail");

        assert!(error.contains("NIMI_APP_DATA_ROOT must be an absolute path"));
    }

    #[test]
    fn env_app_data_root_normalizes_absolute_path() {
        let root = resolve_env_app_data_root(Some("/tmp/nimi-data/../nimi-data-selected"))
            .expect("valid root")
            .expect("root");

        assert_eq!(root, std::path::PathBuf::from("/tmp/nimi-data-selected"));
    }

    #[test]
    fn avatar_app_data_root_env_is_required() {
        let _guard = test_env_guard();
        let saved = std::env::var("NIMI_APP_DATA_ROOT").ok();
        std::env::remove_var("NIMI_APP_DATA_ROOT");

        let error = resolve_avatar_app_data_dir().expect_err("missing app data root must fail");

        match saved {
            Some(value) => std::env::set_var("NIMI_APP_DATA_ROOT", value),
            None => std::env::remove_var("NIMI_APP_DATA_ROOT"),
        }
        assert!(error.contains("NIMI_APP_DATA_ROOT is required"));
    }
}
