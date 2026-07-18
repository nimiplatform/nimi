use serde::Deserialize;
use std::fs;
use std::path::PathBuf;

use crate::runtime_bridge::resolve_nimi_dir_hook;

use super::DEFAULT_GRPC_ADDR;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeFileConfig {
    grpc_addr: Option<String>,
    http_addr: Option<String>,
}

pub(crate) fn grpc_addr() -> String {
    if let Some(value) = read_non_empty_env("NIMI_RUNTIME_GRPC_ADDR") {
        return value;
    }
    if let Some(value) = runtime_file_config()
        .and_then(|config| config.grpc_addr)
        .and_then(|value| normalize_non_empty(value.as_str()))
    {
        return value;
    }
    DEFAULT_GRPC_ADDR.to_string()
}

pub fn http_addr() -> String {
    if let Some(value) = read_non_empty_env("NIMI_RUNTIME_HTTP_ADDR") {
        return value;
    }
    if let Some(value) = runtime_file_config()
        .and_then(|config| config.http_addr)
        .and_then(|value| normalize_non_empty(value.as_str()))
    {
        return value;
    }
    "127.0.0.1:46372".to_string()
}

pub(crate) fn runtime_config_path() -> Option<PathBuf> {
    if let Some(value) = read_non_empty_env("NIMI_RUNTIME_CONFIG_PATH") {
        return Some(expand_home_path(value.as_str()));
    }
    if let Some(Ok(nimi_dir)) = resolve_nimi_dir_hook() {
        return Some(nimi_dir.join("runtime").join("config.json"));
    }
    let home = read_non_empty_env("HOME")?;
    Some(PathBuf::from(home).join(".nimi/runtime/config.json"))
}

pub(super) fn read_non_empty_env(name: &str) -> Option<String> {
    std::env::var(name)
        .ok()
        .and_then(|value| normalize_non_empty(value.as_str()))
}

fn normalize_non_empty(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn runtime_file_config() -> Option<RuntimeFileConfig> {
    let path = runtime_config_path()?;
    let content = fs::read(path).ok()?;
    if content.is_empty() {
        return None;
    }
    serde_json::from_slice::<RuntimeFileConfig>(&content).ok()
}

fn expand_home_path(raw: &str) -> PathBuf {
    if raw == "~" {
        if let Some(home) = read_non_empty_env("HOME") {
            return PathBuf::from(home);
        }
        return PathBuf::from(raw);
    }
    if !raw.starts_with("~/") {
        return PathBuf::from(raw);
    }
    if let Some(home) = read_non_empty_env("HOME") {
        return PathBuf::from(home).join(raw.trim_start_matches("~/"));
    }
    PathBuf::from(raw)
}
