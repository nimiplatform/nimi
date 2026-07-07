// Standard shell `export.saveFile` (nimi.shell.export.saveFile).
//
// Saves a user-facing export artifact into the user's Downloads directory
// (dirs::download_dir, falling back to the home directory), never
// overwriting existing files. Semantics extracted from the tester app's
// export path: sanitized filenames, unique output paths, fail-closed on
// empty payloads.

use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine as _;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};

const FALLBACK_EXPORT_FILE_NAME: &str = "nimi-export.bin";
const MAX_EXPORT_FILE_NAME_CHARS: usize = 180;

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
pub struct StandardExportSaveFilePayload {
    pub filename: String,
    #[serde(default)]
    pub mime_type: Option<String>,
    pub data_base64: String,
    #[serde(default)]
    pub reveal: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StandardExportSaveFileResult {
    pub artifact_path: String,
    pub filename: String,
    pub byte_size: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mime_type: Option<String>,
}

pub fn export_save_file(payload: Value) -> Result<StandardExportSaveFileResult, String> {
    let output_dir = resolve_downloads_dir()?;
    export_save_file_to_dir(payload, output_dir.as_path())
}

pub(crate) fn export_save_file_to_dir(
    payload: Value,
    output_dir: &Path,
) -> Result<StandardExportSaveFileResult, String> {
    let parsed =
        serde_json::from_value::<StandardExportSaveFilePayload>(payload).map_err(|error| {
            export_error(
                "invalid-payload",
                "tauri-standard-export-payload-invalid",
                "send_export_filename_and_data_base64",
                Some(error.to_string()),
            )
        })?;
    let bytes = BASE64_STANDARD
        .decode(parsed.data_base64.trim())
        .map_err(|error| {
            export_error(
                "invalid-payload",
                "tauri-standard-export-base64-invalid",
                "send_standard_base64_export_payload",
                Some(error.to_string()),
            )
        })?;
    let result = save_export_bytes(
        output_dir,
        parsed.filename.as_str(),
        normalize_mime_type(parsed.mime_type),
        bytes.as_slice(),
    )?;
    if parsed.reveal.unwrap_or(false) {
        // Best effort: the export contract is the saved artifact; reveal is a
        // courtesy and must not turn a completed save into an error.
        let _ = crate::standard_file_reveal::reveal_path_in_os(Path::new(
            result.artifact_path.as_str(),
        ));
    }
    Ok(result)
}

pub(crate) fn save_export_bytes(
    output_dir: &Path,
    filename: &str,
    mime_type: Option<String>,
    bytes: &[u8],
) -> Result<StandardExportSaveFileResult, String> {
    if bytes.is_empty() {
        return Err(export_error(
            "invalid-payload",
            "tauri-standard-export-empty-payload",
            "send_non_empty_export_payload",
            None,
        ));
    }
    fs::create_dir_all(output_dir).map_err(|error| {
        export_error(
            "host-internal-error",
            "tauri-standard-export-output-dir-unwritable",
            "inspect_export_output_directory_permissions",
            Some(format!("{} ({error})", output_dir.display())),
        )
    })?;
    let safe_filename = sanitize_export_filename(filename);
    let path = unique_export_output_path(output_dir, safe_filename.as_str());
    fs::write(&path, bytes).map_err(|error| {
        export_error(
            "host-internal-error",
            "tauri-standard-export-write-failed",
            "inspect_export_output_directory_permissions",
            Some(format!("{} ({error})", path.display())),
        )
    })?;
    Ok(StandardExportSaveFileResult {
        artifact_path: path.display().to_string(),
        filename: path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or(safe_filename.as_str())
            .to_string(),
        byte_size: bytes.len(),
        mime_type,
    })
}

fn resolve_downloads_dir() -> Result<PathBuf, String> {
    let dir = dirs::download_dir()
        .or_else(dirs::home_dir)
        .ok_or_else(|| {
            export_error(
                "capability-unavailable",
                "tauri-standard-export-downloads-dir-unavailable",
                "configure_user_downloads_directory",
                None,
            )
        })?;
    fs::create_dir_all(&dir).map_err(|error| {
        export_error(
            "host-internal-error",
            "tauri-standard-export-output-dir-unwritable",
            "inspect_export_output_directory_permissions",
            Some(format!("{} ({error})", dir.display())),
        )
    })?;
    Ok(dir)
}

pub(crate) fn sanitize_export_filename(filename: &str) -> String {
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
    trimmed.chars().take(MAX_EXPORT_FILE_NAME_CHARS).collect()
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
        .unwrap_or("nimi-export");
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

pub(crate) fn normalize_mime_type(mime_type: Option<String>) -> Option<String> {
    mime_type
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn export_error(code: &str, reason_code: &str, action_hint: &str, cause: Option<String>) -> String {
    crate::capabilities::standard_shell_error(
        code,
        reason_code,
        action_hint,
        "tauri",
        Some(json!({ "command": "export_save_file", "cause": cause })),
    )
}

#[cfg(test)]
mod tests {
    use super::{export_save_file_to_dir, sanitize_export_filename, save_export_bytes};
    use serde_json::{json, Value};
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_dir(prefix: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("nimi-standard-export-{prefix}-{unique}"));
        fs::create_dir_all(&dir).expect("create temp dir");
        dir
    }

    fn envelope(error: &str) -> Value {
        serde_json::from_str::<Value>(error).expect("standard shell error envelope")
    }

    #[test]
    fn filename_sanitizer_blocks_path_traversal() {
        assert_eq!(
            sanitize_export_filename("../runtime ready?.txt"),
            "runtime-ready-.txt"
        );
        assert_eq!(sanitize_export_filename(""), "nimi-export.bin");
        assert_eq!(sanitize_export_filename(".."), "nimi-export.bin");
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
        let parsed = envelope(error.as_str());
        assert_eq!(
            parsed.get("code").and_then(Value::as_str),
            Some("invalid-payload")
        );
        assert_eq!(
            parsed.get("reasonCode").and_then(Value::as_str),
            Some("tauri-standard-export-empty-payload")
        );
        assert!(fs::read_dir(dir).expect("read dir").next().is_none());
    }

    #[test]
    fn export_command_rejects_invalid_base64_payload() {
        let dir = temp_dir("base64");
        let error = export_save_file_to_dir(
            json!({ "filename": "out.txt", "dataBase64": "!!!" }),
            dir.as_path(),
        )
        .expect_err("invalid base64 rejected");
        assert_eq!(
            envelope(error.as_str())
                .get("reasonCode")
                .and_then(Value::as_str),
            Some("tauri-standard-export-base64-invalid")
        );
    }

    #[test]
    fn export_command_rejects_unknown_payload_fields() {
        let dir = temp_dir("fields");
        let error = export_save_file_to_dir(
            json!({
                "filename": "out.txt",
                "dataBase64": "aGk=",
                "outputDir": "/tmp/elsewhere",
            }),
            dir.as_path(),
        )
        .expect_err("unknown field rejected");
        assert_eq!(
            envelope(error.as_str())
                .get("reasonCode")
                .and_then(Value::as_str),
            Some("tauri-standard-export-payload-invalid")
        );
    }

    #[test]
    fn export_command_saves_decoded_payload_and_normalizes_mime_type() {
        let dir = temp_dir("save");
        let result = export_save_file_to_dir(
            json!({
                "filename": "chat export.txt",
                "mimeType": "  text/plain  ",
                "dataBase64": "cnVudGltZSByZWFkeQ==",
            }),
            dir.as_path(),
        )
        .expect("save export");
        assert_eq!(result.filename, "chat-export.txt");
        assert_eq!(result.byte_size, b"runtime ready".len());
        assert_eq!(result.mime_type.as_deref(), Some("text/plain"));
        assert_eq!(
            fs::read(PathBuf::from(result.artifact_path)).expect("read export"),
            b"runtime ready"
        );
    }
}
