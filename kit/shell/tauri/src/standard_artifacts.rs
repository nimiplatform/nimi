// Standard shell `artifacts.write` (nimi.shell.artifacts.write).
//
// Writes an app artifact under the bound standard data root's `artifacts/`
// subtree only. Relative-path confinement reuses the standard storage child
// resolver; writes are atomic (tmp + rename).

use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine as _;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fs;
use std::path::{Component, Path};

use crate::runtime_app_storage::StandardAppStorageRoots;

const ARTIFACTS_PREFIX: &str = "artifacts/";

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
pub struct StandardArtifactsWritePayload {
    pub relative_path: String,
    #[serde(default)]
    pub mime_type: Option<String>,
    pub data_base64: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StandardArtifactsWriteResult {
    pub path: String,
    pub byte_size: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mime_type: Option<String>,
}

pub fn artifacts_write(
    roots: &StandardAppStorageRoots,
    payload: Value,
) -> Result<StandardArtifactsWriteResult, String> {
    let parsed =
        serde_json::from_value::<StandardArtifactsWritePayload>(payload).map_err(|error| {
            artifacts_error(
                "invalid-payload",
                "tauri-standard-artifacts-payload-invalid",
                "send_artifacts_relative_path_and_data_base64",
                Some(error.to_string()),
            )
        })?;
    let relative = parsed.relative_path.trim();
    if !relative.starts_with(ARTIFACTS_PREFIX) || relative.len() <= ARTIFACTS_PREFIX.len() {
        return Err(artifacts_error(
            "invalid-path",
            "tauri-standard-artifacts-prefix-required",
            "write_artifacts_under_artifacts_prefix",
            Some(relative.to_string()),
        ));
    }
    if Path::new(relative)
        .components()
        .any(|component| matches!(component, Component::ParentDir))
    {
        return Err(artifacts_error(
            "invalid-path",
            "tauri-standard-artifacts-path-escapes-prefix",
            "write_artifacts_under_artifacts_prefix",
            Some(relative.to_string()),
        ));
    }
    let target = crate::runtime_app_storage::resolve_standard_storage_child(
        roots,
        relative,
        "artifacts_write",
    )?;
    let bytes = BASE64_STANDARD
        .decode(parsed.data_base64.trim())
        .map_err(|error| {
            artifacts_error(
                "invalid-payload",
                "tauri-standard-artifacts-base64-invalid",
                "send_standard_base64_artifact_payload",
                Some(error.to_string()),
            )
        })?;
    if bytes.is_empty() {
        return Err(artifacts_error(
            "invalid-payload",
            "tauri-standard-artifacts-empty-payload",
            "send_non_empty_artifact_payload",
            None,
        ));
    }
    atomic_write(target.as_path(), bytes.as_slice()).map_err(|cause| {
        artifacts_error(
            "host-internal-error",
            "tauri-standard-artifacts-write-failed",
            "inspect_standard_storage_host_permissions",
            Some(cause),
        )
    })?;
    Ok(StandardArtifactsWriteResult {
        path: target.display().to_string(),
        byte_size: bytes.len(),
        mime_type: crate::standard_export::normalize_mime_type(parsed.mime_type),
    })
}

fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let tmp_path = path.with_file_name(format!(
        ".{}.{}.{}.tmp",
        path.file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("artifact"),
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or(0)
    ));
    fs::write(&tmp_path, bytes)
        .map_err(|error| format!("temp write failed ({}): {error}", tmp_path.display()))?;
    fs::rename(&tmp_path, path).map_err(|error| {
        let _ = fs::remove_file(&tmp_path);
        format!("rename failed ({}): {error}", path.display())
    })
}

fn artifacts_error(
    code: &str,
    reason_code: &str,
    action_hint: &str,
    cause: Option<String>,
) -> String {
    crate::capabilities::standard_shell_error(
        code,
        reason_code,
        action_hint,
        "tauri",
        Some(json!({ "command": "artifacts_write", "cause": cause })),
    )
}

#[cfg(test)]
mod tests {
    use super::artifacts_write;
    use crate::runtime_app_storage::test_standard_app_storage_roots;
    use serde_json::{json, Value};
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_root(prefix: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("nimi-standard-artifacts-{prefix}-{unique}"));
        std::fs::create_dir_all(&dir).expect("create temp root");
        dir
    }

    fn envelope(error: &str) -> Value {
        serde_json::from_str::<Value>(error).expect("standard shell error envelope")
    }

    #[test]
    fn artifacts_write_requires_artifacts_prefix() {
        let roots = test_standard_app_storage_roots(temp_root("prefix"));
        for relative_path in ["exports/out.txt", "artifacts", "artifacts/"] {
            let error = artifacts_write(
                &roots,
                json!({ "relativePath": relative_path, "dataBase64": "aGk=" }),
            )
            .expect_err("prefix violation rejected");
            let parsed = envelope(error.as_str());
            assert_eq!(
                parsed.get("code").and_then(Value::as_str),
                Some("invalid-path")
            );
            assert_eq!(
                parsed.get("reasonCode").and_then(Value::as_str),
                Some("tauri-standard-artifacts-prefix-required")
            );
        }
    }

    #[test]
    fn artifacts_write_rejects_parent_dir_escape_inside_prefix() {
        let roots = test_standard_app_storage_roots(temp_root("escape"));
        let error = artifacts_write(
            &roots,
            json!({ "relativePath": "artifacts/../settings/profile.json", "dataBase64": "aGk=" }),
        )
        .expect_err("prefix escape rejected");
        assert_eq!(
            envelope(error.as_str())
                .get("reasonCode")
                .and_then(Value::as_str),
            Some("tauri-standard-artifacts-path-escapes-prefix")
        );
    }

    #[test]
    fn artifacts_write_rejects_invalid_and_empty_base64_payloads() {
        let roots = test_standard_app_storage_roots(temp_root("base64"));
        let error = artifacts_write(
            &roots,
            json!({ "relativePath": "artifacts/out.txt", "dataBase64": "!!!" }),
        )
        .expect_err("invalid base64 rejected");
        assert_eq!(
            envelope(error.as_str())
                .get("reasonCode")
                .and_then(Value::as_str),
            Some("tauri-standard-artifacts-base64-invalid")
        );

        let error = artifacts_write(
            &roots,
            json!({ "relativePath": "artifacts/out.txt", "dataBase64": "" }),
        )
        .expect_err("empty payload rejected");
        assert_eq!(
            envelope(error.as_str())
                .get("reasonCode")
                .and_then(Value::as_str),
            Some("tauri-standard-artifacts-empty-payload")
        );
    }

    #[test]
    fn artifacts_write_rejects_unknown_payload_fields() {
        let roots = test_standard_app_storage_roots(temp_root("fields"));
        let error = artifacts_write(
            &roots,
            json!({
                "relativePath": "artifacts/out.txt",
                "dataBase64": "aGk=",
                "storageRoot": "/tmp/renderer-root",
            }),
        )
        .expect_err("unknown field rejected");
        assert_eq!(
            envelope(error.as_str())
                .get("reasonCode")
                .and_then(Value::as_str),
            Some("tauri-standard-artifacts-payload-invalid")
        );
    }

    #[test]
    fn artifacts_write_persists_decoded_bytes_atomically_under_data_root() {
        let root = temp_root("write");
        let roots = test_standard_app_storage_roots(root.clone());
        let result = artifacts_write(
            &roots,
            json!({
                "relativePath": "artifacts/generations/out.txt",
                "mimeType": " text/plain ",
                "dataBase64": "cnVudGltZSByZWFkeQ==",
            }),
        )
        .expect("artifact write");
        assert_eq!(result.byte_size, b"runtime ready".len());
        assert_eq!(result.mime_type.as_deref(), Some("text/plain"));
        let written = PathBuf::from(result.path.clone());
        assert!(written.starts_with(roots.data_root()));
        assert!(written.ends_with("artifacts/generations/out.txt"));
        assert_eq!(
            std::fs::read(&written).expect("read artifact"),
            b"runtime ready"
        );
        let artifact_dir = written.parent().expect("artifact dir");
        let leftover_tmp = std::fs::read_dir(artifact_dir)
            .expect("read artifact dir")
            .filter_map(|entry| entry.ok())
            .any(|entry| entry.file_name().to_string_lossy().ends_with(".tmp"));
        assert!(!leftover_tmp, "atomic write must not leave tmp files");
    }
}
