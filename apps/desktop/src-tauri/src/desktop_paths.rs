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
    crate::desktop_product_control::selected_product_data_root()
}

/// Resolves the OS-conventional `nimi_data` location *proposed* to the user
/// during first-run Storage selection: a `Nimi` folder in the user home.
///
/// This is only a proposal surfaced as a pre-filled, user-visible value — not
/// a readiness default. It does not create the directory, does not record
/// anything, and is never wired into `resolve_nimi_data_dir`. The user reviews
/// this path on the `data_root_missing` screen and must explicitly confirm it;
/// `select_product_data_root` remains the sole owner of recording and
/// fail-closed validation (`P-COLD-010`).
pub fn default_data_root_proposal() -> Result<PathBuf, String> {
    let home = resolve_home_dir().ok_or_else(|| "无法获取用户 home 目录".to_string())?;
    Ok(normalize_absolute_path(&home.join("Nimi")))
}

#[cfg(test)]
mod tests {
    use super::{default_data_root_proposal, resolve_nimi_data_dir, resolve_nimi_dir};
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
    fn missing_product_control_record_does_not_select_default_nimi_data() {
        let home = temp_home("default-data-dir");
        with_env(&[("HOME", home.to_str())], || {
            let nimi_dir = resolve_nimi_dir().expect("nimi dir");
            let error = resolve_nimi_data_dir().expect_err("missing product data root");

            assert_eq!(nimi_dir, home.join(".nimi"));
            assert!(error.contains("~/.nimi/nimi.json is missing"));
        });
    }

    #[test]
    fn default_data_root_proposal_proposes_nimi_folder_in_home_without_creating_it() {
        let home = temp_home("default-proposal");
        with_env(&[("HOME", home.to_str())], || {
            let proposed = default_data_root_proposal().expect("default proposal");
            // The proposal is a `Nimi` folder in the user home — never the
            // `~/.nimi/data` location P-COLD-010 forbids as a silent default.
            assert_eq!(proposed, home.join("Nimi"));
            assert_ne!(proposed, home.join(".nimi").join("data"));
            // It is only a proposal: the directory is not created here, and no
            // product-control record is written. Recording stays with
            // `select_product_data_root` after explicit user confirmation.
            assert!(!proposed.exists());
            assert!(!home.join(".nimi").join("nimi.json").exists());
        });
    }
}
