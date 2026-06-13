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

pub fn resolve_nimi_dir() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or_else(|| "cannot resolve home directory".to_string())?;
    let dir = home.join(NIMI_DIR_NAME);
    fs::create_dir_all(&dir).map_err(|error| format!("failed to create ~/.nimi/: {error}"))?;
    Ok(dir)
}

pub fn resolve_nimi_data_dir() -> Result<PathBuf, String> {
    let Some(hook_result) = crate::runtime_bridge::resolve_nimi_data_dir_hook() else {
        return Err(
            "resolve_nimi_data_dir requires an admitted host data-root hook; no default ~/.nimi/data fallback is allowed"
                .to_string(),
        );
    };
    let path = hook_result?;
    if !path.is_absolute() {
        return Err("admitted nimi_data_dir hook returned a non-absolute path".to_string());
    }
    let path = normalize_absolute_path(&path);
    fs::create_dir_all(&path).map_err(|error| {
        format!(
            "failed to create nimi_data_dir ({}): {error}",
            path.display()
        )
    })?;
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::{resolve_nimi_data_dir, resolve_nimi_dir};
    use crate::runtime_bridge::{with_runtime_bridge_host_hooks, RuntimeBridgeHostHooks};
    use crate::test_support::with_env;
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn make_temp_dir(prefix: &str) -> PathBuf {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!(
            "nimi-kit-desktop-paths-{}-{}-{}",
            prefix,
            std::process::id(),
            now
        ));
        fs::create_dir_all(&dir).expect("create temp dir");
        dir
    }

    #[test]
    fn resolve_nimi_data_dir_has_no_silent_default() {
        let home = make_temp_dir("no-default");
        with_env(&[("HOME", home.to_str())], || {
            with_runtime_bridge_host_hooks(RuntimeBridgeHostHooks::default(), || {
                let root = resolve_nimi_dir().expect("nimi dir");
                fs::write(
                    root.join("desktop-paths.json"),
                    r#"{"nimiDataDir":"/tmp/legacy-nimi-data"}"#,
                )
                .expect("write legacy desktop paths");

                let err = resolve_nimi_data_dir().expect_err("missing host hook");
                assert!(err.contains("requires an admitted host data-root hook"));
                assert!(!home.join(".nimi").join("data").exists());
            });
        });
        let _ = fs::remove_dir_all(home);
    }
}
