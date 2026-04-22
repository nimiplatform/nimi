use super::types::{DesktopAgentBackdropBindingRecord, DesktopAgentBackdropImportPayload};
use crate::desktop_paths::resolve_nimi_data_dir;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use url::Url;

const BACKDROP_ROOT_DIR: &str = "chat-agent-backdrops";
const BACKDROP_ASSET_DIR: &str = "assets";
const BACKDROP_BINDINGS_FILE: &str = "bindings.json";

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DesktopAgentBackdropBindingsFile {
    #[serde(default)]
    bindings: HashMap<String, DesktopAgentBackdropBindingRecord>,
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}

fn backdrop_root_dir() -> Result<PathBuf, String> {
    let dir = resolve_nimi_data_dir()?.join(BACKDROP_ROOT_DIR);
    fs::create_dir_all(dir.join(BACKDROP_ASSET_DIR))
        .map_err(|error| format!("failed to create desktop backdrop store directory: {error}"))?;
    Ok(dir)
}

fn backdrop_asset_dir() -> Result<PathBuf, String> {
    Ok(backdrop_root_dir()?.join(BACKDROP_ASSET_DIR))
}

fn backdrop_bindings_path() -> Result<PathBuf, String> {
    Ok(backdrop_root_dir()?.join(BACKDROP_BINDINGS_FILE))
}

fn load_bindings_file() -> Result<DesktopAgentBackdropBindingsFile, String> {
    let path = backdrop_bindings_path()?;
    if !path.exists() {
        return Ok(DesktopAgentBackdropBindingsFile::default());
    }
    let raw = fs::read_to_string(&path).map_err(|error| {
        format!(
            "failed to read desktop backdrop bindings ({}): {error}",
            path.display()
        )
    })?;
    serde_json::from_str::<DesktopAgentBackdropBindingsFile>(&raw).map_err(|error| {
        format!(
            "failed to parse desktop backdrop bindings ({}): {error}",
            path.display()
        )
    })
}

fn persist_bindings_file(payload: &DesktopAgentBackdropBindingsFile) -> Result<(), String> {
    let path = backdrop_bindings_path()?;
    let raw = serde_json::to_string_pretty(payload)
        .map_err(|error| format!("failed to serialize desktop backdrop bindings: {error}"))?;
    fs::write(&path, raw).map_err(|error| {
        format!(
            "failed to persist desktop backdrop bindings ({}): {error}",
            path.display()
        )
    })
}

fn sanitize_agent_segment(value: &str) -> String {
    let mut result = String::new();
    for ch in value.trim().chars() {
        if ch.is_ascii_alphanumeric() {
            result.push(ch.to_ascii_lowercase());
        } else if ch == '-' || ch == '_' {
            result.push(ch);
        } else if ch.is_whitespace() && !result.ends_with('-') {
            result.push('-');
        }
    }
    let trimmed = result.trim_matches('-').trim_matches('_').to_string();
    if trimmed.is_empty() {
        "agent".to_string()
    } else {
        trimmed
    }
}

fn allowed_extension(path: &Path) -> Result<String, String> {
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.trim().to_ascii_lowercase())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            "desktop backdrop import requires an image filename extension".to_string()
        })?;
    match extension.as_str() {
        "png" | "jpg" | "jpeg" | "webp" | "gif" | "avif" => Ok(extension),
        _ => Err(format!(
            "desktop backdrop import does not support .{extension} files"
        )),
    }
}

fn file_url_from_path(path: &Path) -> Result<String, String> {
    Url::from_file_path(path)
        .map_err(|_| {
            format!(
                "failed to convert backdrop path to file url: {}",
                path.display()
            )
        })
        .map(|url| url.to_string())
}

fn backdrop_asset_filename(
    agent_id: &str,
    source_path: &Path,
    imported_at_ms: i64,
) -> Result<String, String> {
    let extension = allowed_extension(source_path)?;
    let mut hasher = Sha256::new();
    hasher.update(agent_id.as_bytes());
    hasher.update(b":");
    hasher.update(imported_at_ms.to_string().as_bytes());
    hasher.update(b":");
    hasher.update(source_path.to_string_lossy().as_bytes());
    let digest = hasher.finalize();
    let suffix = format!("{:x}", digest);
    Ok(format!(
        "{}-{}-{}.{}",
        sanitize_agent_segment(agent_id),
        imported_at_ms,
        &suffix[..12],
        extension
    ))
}

fn remove_bound_asset_if_owned(stored_path: &str) {
    let Ok(asset_dir) = backdrop_asset_dir() else {
        return;
    };
    let target = PathBuf::from(stored_path);
    if target.starts_with(&asset_dir) {
        let _ = fs::remove_file(target);
    }
}

pub fn get_binding(agent_id: &str) -> Result<Option<DesktopAgentBackdropBindingRecord>, String> {
    let bindings = load_bindings_file()?;
    Ok(bindings.bindings.get(agent_id).cloned())
}

pub fn import_binding(
    payload: &DesktopAgentBackdropImportPayload,
) -> Result<DesktopAgentBackdropBindingRecord, String> {
    let agent_id = payload.agent_id.trim();
    if agent_id.is_empty() {
        return Err("agentId is required".to_string());
    }
    let source_path = PathBuf::from(payload.source_path.trim());
    if payload.source_path.trim().is_empty() {
        return Err("sourcePath is required".to_string());
    }
    if !source_path.exists() {
        return Err(format!(
            "desktop backdrop source path does not exist: {}",
            source_path.display()
        ));
    }
    if !source_path.is_file() {
        return Err(format!(
            "desktop backdrop import requires a file path: {}",
            source_path.display()
        ));
    }
    let imported_at_ms = payload.imported_at_ms.unwrap_or_else(now_ms);
    let asset_dir = backdrop_asset_dir()?;
    let filename = backdrop_asset_filename(agent_id, &source_path, imported_at_ms)?;
    let target_path = asset_dir.join(filename);
    fs::copy(&source_path, &target_path).map_err(|error| {
        format!(
            "failed to copy desktop backdrop asset into store ({} -> {}): {error}",
            source_path.display(),
            target_path.display()
        )
    })?;

    let mut bindings = load_bindings_file()?;
    let previous = bindings.bindings.get(agent_id).cloned();

    let record = DesktopAgentBackdropBindingRecord {
        agent_id: agent_id.to_string(),
        display_name: source_path
            .file_stem()
            .and_then(|value| value.to_str())
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| "Backdrop".to_string()),
        source_filename: source_path
            .file_name()
            .and_then(|value| value.to_str())
            .map(|value| value.to_string())
            .unwrap_or_else(|| "backdrop".to_string()),
        stored_path: target_path.display().to_string(),
        file_url: file_url_from_path(&target_path)?,
        updated_at_ms: imported_at_ms,
    };
    bindings
        .bindings
        .insert(agent_id.to_string(), record.clone());
    persist_bindings_file(&bindings)?;
    if let Some(previous_record) = previous {
        if previous_record.stored_path != record.stored_path {
            remove_bound_asset_if_owned(previous_record.stored_path.as_str());
        }
    }
    Ok(record)
}

pub fn clear_binding(agent_id: &str) -> Result<bool, String> {
    let trimmed = agent_id.trim();
    if trimmed.is_empty() {
        return Err("agentId is required".to_string());
    }
    let mut bindings = load_bindings_file()?;
    let removed = bindings.bindings.remove(trimmed);
    if let Some(record) = removed {
        persist_bindings_file(&bindings)?;
        remove_bound_asset_if_owned(record.stored_path.as_str());
        return Ok(true);
    }
    Ok(false)
}
