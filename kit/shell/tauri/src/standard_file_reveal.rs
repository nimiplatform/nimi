// Standard shell `file-reveal.reveal` (nimi.shell.fileReveal.reveal).
//
// Cross-platform "show in file manager" semantics (macOS `open -R`,
// Windows `explorer /select,`, Linux `xdg-open` on the parent directory).
//
// Reveal targets are restricted to the bound standard app storage data-root
// subtree or paths previously returned and registered by the standard file
// dialog. Everything else fails closed.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

use crate::runtime_app_storage::StandardAppStorageRoots;

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
pub struct StandardFileRevealPayload {
    pub path: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StandardFileRevealResult {
    pub revealed: bool,
    pub path: String,
}

pub fn file_reveal_reveal(
    roots: &StandardAppStorageRoots,
    payload: Value,
) -> Result<StandardFileRevealResult, String> {
    let target = resolve_reveal_target(roots, payload)?;
    reveal_path_in_os(target.as_path()).map_err(|cause| {
        reveal_error(
            "host-internal-error",
            "tauri-standard-file-reveal-failed",
            "inspect_host_file_reveal_support",
            Some(cause),
        )
    })?;
    Ok(StandardFileRevealResult {
        revealed: true,
        path: target.display().to_string(),
    })
}

pub(crate) fn resolve_reveal_target(
    roots: &StandardAppStorageRoots,
    payload: Value,
) -> Result<PathBuf, String> {
    // file-reveal declares invalid-path/not-found negative states (no
    // invalid-payload), so malformed payloads map to invalid-path.
    let parsed = serde_json::from_value::<StandardFileRevealPayload>(payload).map_err(|error| {
        reveal_error(
            "invalid-path",
            "tauri-standard-file-reveal-payload-invalid",
            "send_absolute_path_inside_standard_data_root",
            Some(error.to_string()),
        )
    })?;
    let trimmed = parsed.path.trim();
    if trimmed.is_empty() {
        return Err(reveal_error(
            "invalid-path",
            "tauri-standard-file-reveal-path-required",
            "send_absolute_path_inside_standard_data_root",
            None,
        ));
    }
    let candidate = PathBuf::from(trimmed);
    if !candidate.is_absolute() {
        return Err(reveal_error(
            "invalid-path",
            "tauri-standard-file-reveal-absolute-path-required",
            "send_absolute_path_inside_standard_data_root",
            Some(candidate.display().to_string()),
        ));
    }
    let canonical = candidate.canonicalize().map_err(|error| {
        reveal_error(
            "not-found",
            "tauri-standard-file-reveal-target-not-found",
            "materialize_file_before_revealing_it",
            Some(format!("{} ({error})", candidate.display())),
        )
    })?;
    if !canonical.starts_with(roots.data_root())
        && !crate::standard_file_dialog::is_registered_file_dialog_selected_path(&canonical)
    {
        return Err(reveal_error(
            "invalid-path",
            "tauri-standard-file-reveal-path-not-admitted",
            "reveal_paths_inside_standard_data_root_or_file_dialog_registry",
            Some(canonical.display().to_string()),
        ));
    }
    Ok(canonical)
}

pub(crate) fn reveal_path_in_os(path: &Path) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg("-R")
            .arg(path)
            .spawn()
            .map(|_| ())
            .map_err(|error| error.to_string())
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg("/select,")
            .arg(path)
            .spawn()
            .map(|_| ())
            .map_err(|error| error.to_string())
    }
    #[cfg(target_os = "linux")]
    {
        let parent = path.parent().unwrap_or(path);
        std::process::Command::new("xdg-open")
            .arg(parent)
            .spawn()
            .map(|_| ())
            .map_err(|error| error.to_string())
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    {
        let _ = path;
        Err("file reveal is not supported on this platform".to_string())
    }
}

fn reveal_error(code: &str, reason_code: &str, action_hint: &str, cause: Option<String>) -> String {
    crate::capabilities::standard_shell_error(
        code,
        reason_code,
        action_hint,
        "tauri",
        Some(json!({ "command": "file_reveal_reveal", "cause": cause })),
    )
}

#[cfg(test)]
mod tests {
    use super::{resolve_reveal_target, StandardFileRevealResult};
    use crate::runtime_app_storage::test_standard_app_storage_roots;
    use crate::standard_file_dialog::register_file_dialog_selected_paths;
    use serde_json::{json, Value};
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_root(prefix: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("nimi-standard-reveal-{prefix}-{unique}"));
        std::fs::create_dir_all(&dir).expect("create temp root");
        dir
    }

    fn envelope(error: &str) -> Value {
        serde_json::from_str::<Value>(error).expect("standard shell error envelope")
    }

    #[test]
    fn reveal_result_serializes_revealed_true() {
        let value = serde_json::to_value(StandardFileRevealResult {
            revealed: true,
            path: "/tmp/report.txt".to_string(),
        })
        .expect("serialize reveal result");
        assert_eq!(value.get("revealed").and_then(Value::as_bool), Some(true));
        assert_eq!(
            value.get("path").and_then(Value::as_str),
            Some("/tmp/report.txt")
        );
    }

    #[test]
    fn reveal_target_requires_absolute_path() {
        let roots = test_standard_app_storage_roots(temp_root("relative"));
        let error = resolve_reveal_target(&roots, json!({ "path": "artifacts/out.txt" }))
            .expect_err("relative path rejected");
        let parsed = envelope(error.as_str());
        assert_eq!(
            parsed.get("code").and_then(Value::as_str),
            Some("invalid-path")
        );
        assert_eq!(
            parsed.get("reasonCode").and_then(Value::as_str),
            Some("tauri-standard-file-reveal-absolute-path-required")
        );
    }

    #[test]
    fn reveal_target_reports_missing_file_as_not_found() {
        let root = temp_root("missing");
        let roots = test_standard_app_storage_roots(root.clone());
        let missing = root.join("missing.txt");
        let error = resolve_reveal_target(&roots, json!({ "path": missing.display().to_string() }))
            .expect_err("missing target rejected");
        let parsed = envelope(error.as_str());
        assert_eq!(
            parsed.get("code").and_then(Value::as_str),
            Some("not-found")
        );
    }

    #[test]
    fn reveal_target_rejects_paths_outside_data_root() {
        let root = temp_root("inside");
        let outside = temp_root("outside");
        let roots = test_standard_app_storage_roots(root);
        let outside_file = outside.join("leak.txt");
        std::fs::write(&outside_file, b"outside").expect("write outside file");
        let error = resolve_reveal_target(
            &roots,
            json!({ "path": outside_file.display().to_string() }),
        )
        .expect_err("outside path rejected");
        let parsed = envelope(error.as_str());
        assert_eq!(
            parsed.get("reasonCode").and_then(Value::as_str),
            Some("tauri-standard-file-reveal-path-not-admitted")
        );
    }

    #[test]
    fn reveal_target_resolves_existing_file_inside_data_root() {
        let root = temp_root("resolve");
        let roots = test_standard_app_storage_roots(root.clone());
        let inside = root.join("artifacts");
        std::fs::create_dir_all(&inside).expect("create artifacts dir");
        let file = inside.join("out.txt");
        std::fs::write(&file, b"inside").expect("write inside file");
        let resolved = resolve_reveal_target(&roots, json!({ "path": file.display().to_string() }))
            .expect("inside path resolves");
        assert!(resolved.starts_with(roots.data_root()));
        assert!(resolved.ends_with("artifacts/out.txt"));
    }

    #[test]
    fn reveal_target_accepts_file_dialog_registered_path() {
        let root = temp_root("data-root");
        let outside = temp_root("selected");
        let roots = test_standard_app_storage_roots(root);
        let selected_file = outside.join("picked.txt");
        std::fs::write(&selected_file, b"picked").expect("write selected file");
        let canonical = selected_file
            .canonicalize()
            .expect("canonical selected file");
        register_file_dialog_selected_paths(&[canonical.clone()]).expect("register selected file");

        let resolved = resolve_reveal_target(
            &roots,
            json!({ "path": selected_file.display().to_string() }),
        )
        .expect("registered selected path resolves");

        assert_eq!(resolved, canonical);
    }

    #[test]
    fn reveal_target_rejects_malformed_payload_as_invalid_path() {
        let roots = test_standard_app_storage_roots(temp_root("payload"));
        let error = resolve_reveal_target(&roots, json!({ "target": "/tmp/x" }))
            .expect_err("malformed payload rejected");
        let parsed = envelope(error.as_str());
        assert_eq!(
            parsed.get("code").and_then(Value::as_str),
            Some("invalid-path")
        );
        assert_eq!(
            parsed.get("reasonCode").and_then(Value::as_str),
            Some("tauri-standard-file-reveal-payload-invalid")
        );
    }
}
