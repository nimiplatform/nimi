//! Shared Desktop-owned account profile library core.
//!
//! This crate is the single implementation consumed by the Electron Node-API
//! projection. It contains no shell framework dependency.

pub mod desktop_paths {
    use std::fs;
    use std::path::PathBuf;

    fn non_empty_env_path(name: &str) -> Option<PathBuf> {
        std::env::var(name)
            .ok()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .map(PathBuf::from)
    }

    pub fn resolve_nimi_dir() -> Result<PathBuf, String> {
        let home = non_empty_env_path("HOME")
            .or_else(|| non_empty_env_path("USERPROFILE"))
            .or_else(|| {
                let drive = std::env::var("HOMEDRIVE").ok()?;
                let path = std::env::var("HOMEPATH").ok()?;
                let combined = format!("{}{}", drive.trim(), path.trim());
                (!combined.trim().is_empty()).then(|| PathBuf::from(combined))
            })
            .or_else(dirs::home_dir)
            .ok_or_else(|| "Desktop control root requires a user home directory".to_string())?;
        let nimi_dir = home.join(".nimi");
        fs::create_dir_all(&nimi_dir).map_err(|error| {
            format!(
                "create Desktop control root failed ({}): {error}",
                nimi_dir.display()
            )
        })?;
        Ok(nimi_dir)
    }
}

pub mod account_profile_library;

#[cfg(test)]
pub mod test_support {
    use std::sync::Mutex;

    static ENV_LOCK: Mutex<()> = Mutex::new(());

    pub fn with_env<T>(pairs: &[(&str, Option<&str>)], action: impl FnOnce() -> T) -> T {
        let _guard = ENV_LOCK.lock().expect("env lock");
        let previous = pairs
            .iter()
            .map(|(key, _)| ((*key).to_string(), std::env::var_os(key)))
            .collect::<Vec<_>>();
        for (key, value) in pairs {
            match value {
                Some(value) => std::env::set_var(key, value),
                None => std::env::remove_var(key),
            }
        }
        let result = action();
        for (key, value) in previous {
            match value {
                Some(value) => std::env::set_var(key, value),
                None => std::env::remove_var(key),
            }
        }
        result
    }
}
