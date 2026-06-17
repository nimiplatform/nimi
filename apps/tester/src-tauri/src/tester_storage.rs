use std::fs;
use std::path::{Path, PathBuf};

use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use nimi_shell_tauri::runtime_app_storage;
use serde::{Deserialize, Serialize};
use serde_json::Value;

const RUN_HISTORY_FILE: &str = "tester-run-history.json";
const IMAGE_HISTORY_FILE: &str = "tester-image-history.json";
const FALLBACK_EXPORT_FILE_NAME: &str = "nimi-tester-generation.txt";

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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TesterExportSavePayload {
    filename: String,
    mime_type: Option<String>,
    data_base64: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TesterExportSaveResult {
    artifact_path: String,
    filename: String,
    byte_size: usize,
    mime_type: Option<String>,
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

fn resolve_downloads_dir() -> Result<PathBuf, String> {
    let dir = dirs::download_dir()
        .or_else(dirs::home_dir)
        .ok_or_else(|| {
            "TESTER_EXPORT_NO_DOWNLOADS_DIR: unable to locate a user Downloads directory"
                .to_string()
        })?;
    fs::create_dir_all(&dir)
        .map_err(|error| format!("TESTER_EXPORT_DOWNLOADS_DIR_UNWRITABLE: {error}"))?;
    Ok(dir)
}

fn sanitize_export_filename(filename: &str) -> String {
    let normalized = filename
        .trim()
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || matches!(ch, '.' | '-' | '_') {
                ch
            } else {
                '-'
            }
        })
        .collect::<String>();
    let collapsed = normalized
        .split('-')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("-");
    let trimmed = collapsed.trim_matches('.').trim_matches('-');
    if trimmed.is_empty() || trimmed == "." || trimmed == ".." {
        return FALLBACK_EXPORT_FILE_NAME.to_string();
    }
    trimmed.chars().take(180).collect()
}

fn unique_export_output_path(output_dir: &Path, filename: &str) -> PathBuf {
    let candidate = output_dir.join(filename);
    if !candidate.exists() {
        return candidate;
    }
    let path = Path::new(filename);
    let stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("nimi-tester-generation");
    let extension = path.extension().and_then(|value| value.to_str());
    for index in 1..10_000 {
        let next_name = match extension {
            Some(extension) if !extension.is_empty() => format!("{stem}-{index}.{extension}"),
            _ => format!("{stem}-{index}"),
        };
        let next = output_dir.join(next_name);
        if !next.exists() {
            return next;
        }
    }
    output_dir.join(format!("{stem}-{}", unix_millis_stamp()))
}

fn unix_millis_stamp() -> String {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis().to_string())
        .unwrap_or_else(|_| "now".to_string())
}

pub fn save_export_bytes(
    output_dir: &Path,
    filename: &str,
    mime_type: Option<String>,
    bytes: &[u8],
) -> Result<TesterExportSaveResult, String> {
    if bytes.is_empty() {
        return Err("TESTER_EXPORT_EMPTY_PAYLOAD: export payload is empty".to_string());
    }
    fs::create_dir_all(output_dir)
        .map_err(|error| format!("TESTER_EXPORT_OUTPUT_DIR_UNWRITABLE: {error}"))?;
    let safe_filename = sanitize_export_filename(filename);
    let path = unique_export_output_path(output_dir, &safe_filename);
    fs::write(&path, bytes).map_err(|error| {
        format!(
            "TESTER_EXPORT_ARTIFACT_UNWRITABLE: unable to write {}: {error}",
            path.display()
        )
    })?;
    Ok(TesterExportSaveResult {
        artifact_path: path.display().to_string(),
        filename: path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or(&safe_filename)
            .to_string(),
        byte_size: bytes.len(),
        mime_type,
    })
}

fn reveal_in_os(path: &Path) {
    #[cfg(target_os = "macos")]
    {
        let _ = std::process::Command::new("open")
            .arg("-R")
            .arg(path)
            .spawn();
    }
    #[cfg(target_os = "windows")]
    {
        let _ = std::process::Command::new("explorer")
            .arg("/select,")
            .arg(path)
            .spawn();
    }
    #[cfg(target_os = "linux")]
    {
        let parent = path.parent().unwrap_or(path);
        let _ = std::process::Command::new("xdg-open").arg(parent).spawn();
    }
}

#[tauri::command]
pub fn tester_export_save(
    payload: TesterExportSavePayload,
) -> Result<TesterExportSaveResult, String> {
    let bytes = BASE64_STANDARD
        .decode(payload.data_base64.trim())
        .map_err(|error| format!("TESTER_EXPORT_INVALID_BASE64: {error}"))?;
    let result = save_export_bytes(
        &resolve_downloads_dir()?,
        &payload.filename,
        payload.mime_type,
        &bytes,
    )?;
    reveal_in_os(Path::new(&result.artifact_path));
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::{sanitize_export_filename, save_export_bytes};
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_dir(prefix: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("nimi-tester-export-{prefix}-{unique}"));
        fs::create_dir_all(&dir).expect("create temp dir");
        dir
    }

    #[test]
    fn filename_sanitizer_blocks_path_traversal() {
        assert_eq!(
            sanitize_export_filename("../runtime ready?.txt"),
            "runtime-ready-.txt"
        );
        assert_eq!(sanitize_export_filename(""), "nimi-tester-generation.txt");
        assert_eq!(sanitize_export_filename(".."), "nimi-tester-generation.txt");
    }

    #[test]
    fn save_export_bytes_writes_without_overwriting_existing_files() {
        let dir = temp_dir("unique");
        fs::write(dir.join("chat.stream.txt"), b"existing").expect("seed existing");

        let result = save_export_bytes(
            &dir,
            "chat.stream.txt",
            Some("text/plain;charset=utf-8".to_string()),
            b"runtime ready",
        )
        .expect("save export");

        assert_eq!(result.filename, "chat.stream-1.txt");
        assert_eq!(result.byte_size, b"runtime ready".len());
        assert_eq!(
            fs::read(dir.join("chat.stream.txt")).expect("read existing"),
            b"existing"
        );
        assert_eq!(
            fs::read(PathBuf::from(result.artifact_path)).expect("read export"),
            b"runtime ready"
        );
    }

    #[test]
    fn save_export_bytes_fails_closed_on_empty_payload() {
        let dir = temp_dir("empty");
        let error =
            save_export_bytes(&dir, "empty.txt", None, b"").expect_err("empty export must fail");

        assert!(error.starts_with("TESTER_EXPORT_EMPTY_PAYLOAD"));
        assert!(fs::read_dir(dir).expect("read dir").next().is_none());
    }
}
