use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use super::bridge_error;

const CURRENT_RUNTIME_STATE_FILE: &str = "current.json";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct CurrentRuntimeState {
    pub(super) version: String,
    pub(super) binary_path: String,
    pub(super) switched_at: String,
}

fn runtime_root_dir() -> Result<PathBuf, String> {
    let root = crate::desktop_paths::resolve_nimi_dir()?.join("runtime");
    fs::create_dir_all(&root).map_err(|error| {
        bridge_error(
            "DESKTOP_RUNTIME_ROOT_CREATE_FAILED",
            format!("failed to create runtime root {}: {error}", root.display()).as_str(),
        )
    })?;
    Ok(root)
}

pub(super) fn runtime_versions_dir() -> Result<PathBuf, String> {
    let path = runtime_root_dir()?.join("versions");
    fs::create_dir_all(&path).map_err(|error| {
        bridge_error(
            "DESKTOP_RUNTIME_VERSIONS_CREATE_FAILED",
            format!("failed to create versions dir {}: {error}", path.display()).as_str(),
        )
    })?;
    Ok(path)
}

pub(super) fn runtime_staging_dir() -> Result<PathBuf, String> {
    let path = runtime_root_dir()?.join("staging");
    fs::create_dir_all(&path).map_err(|error| {
        bridge_error(
            "DESKTOP_RUNTIME_STAGING_CREATE_FAILED",
            format!("failed to create staging dir {}: {error}", path.display()).as_str(),
        )
    })?;
    Ok(path)
}

#[cfg(test)]
pub(super) fn current_runtime_state_path() -> Result<PathBuf, String> {
    Ok(runtime_root_dir()?.join(CURRENT_RUNTIME_STATE_FILE))
}

pub(super) fn write_current_runtime_state(state: &CurrentRuntimeState) -> Result<(), String> {
    let path = runtime_root_dir()?.join(CURRENT_RUNTIME_STATE_FILE);
    let payload = serde_json::to_string_pretty(state).map_err(|error| {
        bridge_error(
            "DESKTOP_RUNTIME_CURRENT_STATE_SERIALIZE_FAILED",
            error.to_string().as_str(),
        )
    })?;
    fs::write(&path, payload).map_err(|error| {
        bridge_error(
            "DESKTOP_RUNTIME_CURRENT_STATE_WRITE_FAILED",
            format!("failed to write {}: {error}", path.display()).as_str(),
        )
    })
}
