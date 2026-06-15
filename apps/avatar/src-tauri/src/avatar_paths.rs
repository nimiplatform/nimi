use std::fs;
use std::path::{Component, Path, PathBuf};

const NIMI_APP_DATA_ROOT_ENV: &str = "NIMI_APP_DATA_ROOT";
const AVATAR_APP_ID: &str = "nimi.avatar";

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

pub(crate) fn resolve_nimi_data_dir_from_avatar_app_data_root(
    app_data_root: &Path,
) -> Result<PathBuf, String> {
    let normalized = normalize_absolute_path(app_data_root);
    if !normalized.is_absolute() {
        return Err(format!("{NIMI_APP_DATA_ROOT_ENV} must be an absolute path"));
    }
    let data_segment = normalized
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("");
    if data_segment != "data" {
        return Err(format!(
            "{NIMI_APP_DATA_ROOT_ENV} must point to <nimi_data>/apps/{AVATAR_APP_ID}/data"
        ));
    }
    let app_root = normalized
        .parent()
        .ok_or_else(|| format!("{NIMI_APP_DATA_ROOT_ENV} has no app root parent"))?;
    if app_root
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        != AVATAR_APP_ID
    {
        return Err(format!(
            "{NIMI_APP_DATA_ROOT_ENV} must point to <nimi_data>/apps/{AVATAR_APP_ID}/data"
        ));
    }
    let apps_root = app_root
        .parent()
        .ok_or_else(|| format!("{NIMI_APP_DATA_ROOT_ENV} has no apps root parent"))?;
    if apps_root
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        != "apps"
    {
        return Err(format!(
            "{NIMI_APP_DATA_ROOT_ENV} must point to <nimi_data>/apps/{AVATAR_APP_ID}/data"
        ));
    }
    let data_root = apps_root
        .parent()
        .ok_or_else(|| format!("{NIMI_APP_DATA_ROOT_ENV} has no nimi_data parent"))?;
    Ok(data_root.to_path_buf())
}

pub(crate) fn resolve_avatar_nimi_data_dir() -> Result<PathBuf, String> {
    let app_data_dir = resolve_avatar_app_data_dir()?;
    resolve_nimi_data_dir_from_avatar_app_data_root(&app_data_dir)
}

#[cfg(test)]
mod tests {
    use super::{
        resolve_avatar_app_data_dir, resolve_env_app_data_root,
        resolve_nimi_data_dir_from_avatar_app_data_root,
    };
    use crate::test_env_guard;
    use std::path::PathBuf;

    #[test]
    fn env_app_data_root_requires_absolute_path() {
        let error = resolve_env_app_data_root(Some("relative/nimi-data"))
            .expect_err("relative env root must fail");

        assert!(error.contains("NIMI_APP_DATA_ROOT must be an absolute path"));
    }

    #[test]
    fn env_app_data_root_normalizes_absolute_path() {
        let raw = if cfg!(windows) {
            r"D:\tmp\nimi-data\..\nimi-data-selected"
        } else {
            "/tmp/nimi-data/../nimi-data-selected"
        };
        let root = resolve_env_app_data_root(Some(raw))
            .expect("valid root")
            .expect("root");

        let expected = if cfg!(windows) {
            std::path::PathBuf::from(r"D:\tmp\nimi-data-selected")
        } else {
            std::path::PathBuf::from("/tmp/nimi-data-selected")
        };
        assert_eq!(root, expected);
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

    #[test]
    fn derives_nimi_data_dir_from_avatar_app_data_root() {
        let root = if cfg!(windows) {
            PathBuf::from(r"D:\DataNimi\apps\nimi.avatar\data")
        } else {
            PathBuf::from("/tmp/DataNimi/apps/nimi.avatar/data")
        };
        let data_root =
            resolve_nimi_data_dir_from_avatar_app_data_root(&root).expect("derive data root");

        let expected = if cfg!(windows) {
            PathBuf::from(r"D:\DataNimi")
        } else {
            PathBuf::from("/tmp/DataNimi")
        };
        assert_eq!(data_root, expected);
    }

    #[test]
    fn rejects_avatar_app_data_root_outside_admitted_layout() {
        let root = if cfg!(windows) {
            PathBuf::from(r"D:\DataNimi\apps\other.app\data")
        } else {
            PathBuf::from("/tmp/DataNimi/apps/other.app/data")
        };
        let error = resolve_nimi_data_dir_from_avatar_app_data_root(&root)
            .expect_err("wrong app id must fail");

        assert!(error.contains("<nimi_data>/apps/nimi.avatar/data"));
    }
}
