use std::fs;
use std::path::PathBuf;

use nimi_shell_tauri::runtime_app_storage;
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
    runtime_app_storage::canonical_storage_root(root, label)
}

pub(crate) fn scoped_storage_child(
    root: &str,
    label: &str,
    child: &str,
) -> Result<PathBuf, String> {
    runtime_app_storage::scoped_storage_child(root, label, child)
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
