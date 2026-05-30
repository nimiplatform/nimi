use std::fs;
use std::path::PathBuf;

use serde::Deserialize;
use serde_json::Value;

const RUN_HISTORY_FILE: &str = "tester-run-history.json";
const IMAGE_HISTORY_FILE: &str = "tester-image-history.json";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TesterHistorySavePayload {
    storage_root: String,
    records_json: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TesterStorageRootPayload {
    storage_root: String,
}

pub(crate) fn canonical_storage_root(root: &str, label: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(root.trim());
    if !path.is_absolute() {
        return Err(format!(
            "{label} must be an absolute Runtime app storage root"
        ));
    }
    fs::create_dir_all(&path)
        .map_err(|error| format!("create {label} failed ({}): {error}", path.display()))?;
    path.canonicalize()
        .map_err(|error| format!("resolve {label} failed: {error}"))
}

pub(crate) fn scoped_storage_child(
    root: &str,
    label: &str,
    child: &str,
) -> Result<PathBuf, String> {
    let root = canonical_storage_root(root, label)?;
    let child_path = root.join(child);
    if let Some(parent) = child_path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "create {label} child directory failed ({}): {error}",
                parent.display()
            )
        })?;
    }
    let parent = child_path
        .parent()
        .ok_or_else(|| format!("{label} child has no parent"))?
        .canonicalize()
        .map_err(|error| format!("resolve {label} child parent failed: {error}"))?;
    if !parent.starts_with(&root) {
        return Err(format!("{label} child escapes Runtime app storage root"));
    }
    Ok(child_path)
}

fn history_path(storage_root: &str, file_name: &str) -> Result<PathBuf, String> {
    scoped_storage_child(storage_root, "tester data root", file_name)
}

fn read_or_default(path: PathBuf, default_json: &str) -> Result<String, String> {
    if !path.exists() {
        return Ok(default_json.to_string());
    }
    fs::read_to_string(&path)
        .map_err(|error| format!("read tester storage failed ({}): {error}", path.display()))
}

fn write_json(path: PathBuf, raw_json: &str, expected_array: bool) -> Result<(), String> {
    let parsed: Value = serde_json::from_str(raw_json)
        .map_err(|error| format!("tester storage payload JSON invalid: {error}"))?;
    if expected_array && !parsed.is_array() {
        return Err("tester storage payload must be an array".to_string());
    }
    if !expected_array && (!parsed.is_object() || parsed.is_array()) {
        return Err("tester storage payload must be an object".to_string());
    }
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "create tester storage directory failed ({}): {error}",
                parent.display()
            )
        })?;
    }
    fs::write(
        &path,
        serde_json::to_string_pretty(&parsed).unwrap_or_else(|_| raw_json.to_string()),
    )
    .map_err(|error| format!("write tester storage failed ({}): {error}", path.display()))
}

#[tauri::command]
pub fn tester_run_history_load(payload: TesterStorageRootPayload) -> Result<String, String> {
    read_or_default(history_path(&payload.storage_root, RUN_HISTORY_FILE)?, "{}")
}

#[tauri::command]
pub fn tester_run_history_save(payload: TesterHistorySavePayload) -> Result<(), String> {
    write_json(
        history_path(&payload.storage_root, RUN_HISTORY_FILE)?,
        &payload.records_json,
        false,
    )
}

#[tauri::command]
pub fn tester_image_history_load(payload: TesterStorageRootPayload) -> Result<String, String> {
    read_or_default(
        history_path(&payload.storage_root, IMAGE_HISTORY_FILE)?,
        "[]",
    )
}

#[tauri::command]
pub fn tester_image_history_save(payload: TesterHistorySavePayload) -> Result<(), String> {
    write_json(
        history_path(&payload.storage_root, IMAGE_HISTORY_FILE)?,
        &payload.records_json,
        true,
    )
}
