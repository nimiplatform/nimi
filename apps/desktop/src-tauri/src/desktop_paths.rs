use std::fs;
use std::path::{Component, Path, PathBuf};

const NIMI_DIR_NAME: &str = ".nimi";

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

fn read_non_empty_env_path(name: &str) -> Option<PathBuf> {
    std::env::var(name)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
}

fn resolve_home_dir() -> Option<PathBuf> {
    read_non_empty_env_path("HOME")
        .or_else(|| read_non_empty_env_path("USERPROFILE"))
        .or_else(|| {
            let drive = std::env::var("HOMEDRIVE").ok()?;
            let path = std::env::var("HOMEPATH").ok()?;
            let candidate = format!("{}{}", drive.trim(), path.trim());
            let trimmed = candidate.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(PathBuf::from(trimmed))
            }
        })
        .or_else(dirs::home_dir)
}

pub fn resolve_nimi_dir() -> Result<PathBuf, String> {
    let home = resolve_home_dir().ok_or_else(|| "无法获取用户 home 目录".to_string())?;
    let dir = home.join(NIMI_DIR_NAME);
    fs::create_dir_all(&dir).map_err(|error| format!("创建 ~/.nimi/ 目录失败: {error}"))?;
    Ok(dir)
}

pub fn resolve_nimi_data_dir() -> Result<PathBuf, String> {
    tauri::async_runtime::block_on(async {
        crate::desktop_product_control::runtime_validated_nimi_data_root().await
    })
}

#[cfg(test)]
mod tests {
    use super::resolve_nimi_dir;
    use crate::test_support::with_env;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_home(prefix: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("nimi-desktop-{prefix}-{unique}"));
        std::fs::create_dir_all(&dir).expect("create temp home");
        dir
    }

    #[test]
    fn product_control_directory_is_fixed_under_user_home() {
        let home = temp_home("control-root");
        with_env(&[("HOME", home.to_str())], || {
            let nimi_dir = resolve_nimi_dir().expect("nimi control directory");
            assert_eq!(nimi_dir, home.join(".nimi"));
            assert!(nimi_dir.is_dir());
        });
    }
}
