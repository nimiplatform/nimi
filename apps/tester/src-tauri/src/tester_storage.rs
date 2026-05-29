use std::fs;
use std::path::PathBuf;

use serde::Deserialize;
use serde_json::Value;

const TESTER_TMP_DIR: &str = "nimiapp-tester";
const RUN_HISTORY_FILE: &str = "tester-run-history.json";
const IMAGE_HISTORY_FILE: &str = "tester-image-history.json";
const WORLD_TOUR_CACHE_REL: &str = "world-tour";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TesterHistorySavePayload {
    records_json: String,
}

pub(crate) fn tester_app_tmp_root() -> Result<PathBuf, String> {
    let root = std::env::temp_dir().join(TESTER_TMP_DIR);
    fs::create_dir_all(&root)
        .map_err(|error| format!("create tester temp root failed ({}): {error}", root.display()))?;
    root.canonicalize()
        .map_err(|error| format!("resolve tester temp root failed: {error}"))
}

pub(crate) fn tester_world_tour_cache_root() -> Result<PathBuf, String> {
    let root = tester_app_tmp_root()?.join(WORLD_TOUR_CACHE_REL);
    fs::create_dir_all(&root)
        .map_err(|error| format!("create world-tour cache root failed ({}): {error}", root.display()))?;
    root.canonicalize()
        .map_err(|error| format!("resolve world-tour cache root failed: {error}"))
}

fn history_path(file_name: &str) -> Result<PathBuf, String> {
    Ok(tester_app_tmp_root()?.join(file_name))
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
        fs::create_dir_all(parent)
            .map_err(|error| format!("create tester storage directory failed ({}): {error}", parent.display()))?;
    }
    fs::write(&path, serde_json::to_string_pretty(&parsed).unwrap_or_else(|_| raw_json.to_string()))
        .map_err(|error| format!("write tester storage failed ({}): {error}", path.display()))
}

#[tauri::command]
pub fn tester_run_history_load() -> Result<String, String> {
    read_or_default(history_path(RUN_HISTORY_FILE)?, "{}")
}

#[tauri::command]
pub fn tester_run_history_save(payload: TesterHistorySavePayload) -> Result<(), String> {
    write_json(history_path(RUN_HISTORY_FILE)?, &payload.records_json, false)
}

#[tauri::command]
pub fn tester_image_history_load() -> Result<String, String> {
    read_or_default(history_path(IMAGE_HISTORY_FILE)?, "[]")
}

#[tauri::command]
pub fn tester_image_history_save(payload: TesterHistorySavePayload) -> Result<(), String> {
    write_json(history_path(IMAGE_HISTORY_FILE)?, &payload.records_json, true)
}
