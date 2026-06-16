use super::*;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

pub(crate) struct ConfigWriteLock {
    path: PathBuf,
}

impl Drop for ConfigWriteLock {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.path);
    }
}

pub(crate) fn now_nanos() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0)
}

pub(crate) fn agent_center_dir(account_id: &str, local_agent_ref: &str) -> Result<PathBuf, String> {
    Ok(crate::desktop_paths::resolve_nimi_data_dir()?
        .join("accounts")
        .join(local_scope_path_segment(account_id))
        .join("agents")
        .join(local_scope_path_segment(local_agent_ref))
        .join("agent-center"))
}

pub(crate) fn config_path(account_id: &str, local_agent_ref: &str) -> Result<PathBuf, String> {
    Ok(agent_center_dir(account_id, local_agent_ref)?.join(CONFIG_FILE_NAME))
}

pub(crate) fn acquire_write_lock(dir: &Path) -> Result<ConfigWriteLock, String> {
    fs::create_dir_all(dir).map_err(|error| {
        format!(
            "failed to create Agent Center config directory ({}): {error}",
            dir.display()
        )
    })?;
    let path = dir.join(LOCK_FILE_NAME);
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&path)
        .map_err(|error| format!("Agent Center config is currently locked: {error}"))?;
    file.write_all(std::process::id().to_string().as_bytes())
        .map_err(|error| format!("failed to write Agent Center config lock: {error}"))?;
    Ok(ConfigWriteLock { path })
}

pub(crate) fn atomic_write_json(
    path: &Path,
    config: &AgentCenterLocalConfig,
) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "Agent Center config path has no parent".to_string())?;
    fs::create_dir_all(parent).map_err(|error| {
        format!(
            "failed to create Agent Center config directory ({}): {error}",
            parent.display()
        )
    })?;
    let raw = serde_json::to_string_pretty(config)
        .map_err(|error| format!("failed to serialize Agent Center config: {error}"))?;
    let tmp_path = parent.join(format!(
        ".config.json.tmp.{}.{}",
        std::process::id(),
        now_nanos()
    ));
    fs::write(&tmp_path, raw).map_err(|error| {
        format!(
            "failed to write Agent Center config temp file ({}): {error}",
            tmp_path.display()
        )
    })?;
    fs::rename(&tmp_path, path).map_err(|error| {
        let _ = fs::remove_file(&tmp_path);
        format!(
            "failed to finalize Agent Center config ({}): {error}",
            path.display()
        )
    })
}
