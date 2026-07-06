use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};

pub fn canonical_storage_root(root: &str, label: &str) -> Result<PathBuf, String> {
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

pub fn scoped_storage_child(
    root: &str,
    label: &str,
    child: impl AsRef<Path>,
) -> Result<PathBuf, String> {
    let root = canonical_storage_root(root, label)?;
    let child_path = root.join(child.as_ref());
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

#[derive(Debug, Clone)]
pub struct StandardAppStorageRoot {
    root: PathBuf,
}

impl StandardAppStorageRoot {
    pub fn from_path(root: impl Into<PathBuf>) -> Result<Self, String> {
        let path = root.into();
        if !path.is_absolute() {
            return Err(
                "standard app storage root must be an absolute Runtime app storage root"
                    .to_string(),
            );
        }
        fs::create_dir_all(&path).map_err(|error| {
            format!(
                "create standard app storage root failed ({}): {error}",
                path.display()
            )
        })?;
        let canonical = path
            .canonicalize()
            .map_err(|error| format!("resolve standard app storage root failed: {error}"))?;
        Ok(Self { root: canonical })
    }

    pub fn root(&self) -> &Path {
        &self.root
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
pub struct StandardStoragePathPayload {
    pub relative_path: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
pub struct StandardStorageWriteJsonPayload {
    pub relative_path: String,
    pub value: Value,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StandardPathResolveResult {
    pub path: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StandardStorageJsonResult {
    pub path: String,
    pub value: Value,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StandardStorageRemoveJsonResult {
    pub path: String,
    pub removed: bool,
}

pub fn data_path_resolve_for_root(
    root: &StandardAppStorageRoot,
    payload: StandardStoragePathPayload,
) -> Result<StandardPathResolveResult, String> {
    let path =
        resolve_standard_storage_child(root, payload.relative_path.as_str(), "data_path_resolve")?;
    Ok(StandardPathResolveResult {
        path: path.display().to_string(),
    })
}

pub fn storage_read_json_for_root(
    root: &StandardAppStorageRoot,
    payload: StandardStoragePathPayload,
) -> Result<StandardStorageJsonResult, String> {
    let path =
        resolve_standard_storage_child(root, payload.relative_path.as_str(), "storage_read_json")?;
    if !path.exists() {
        return Err(storage_error(
            "not-found",
            "tauri-standard-storage-json-not-found",
            "write_storage_json_before_reading_it",
            "storage_read_json",
            Some(path.as_path()),
            None,
        ));
    }
    let raw = fs::read_to_string(&path).map_err(|error| {
        storage_error(
            "host-internal-error",
            "tauri-standard-storage-json-read-failed",
            "inspect_standard_storage_host_permissions",
            "storage_read_json",
            Some(path.as_path()),
            Some(error.to_string()),
        )
    })?;
    let value = serde_json::from_str::<Value>(raw.as_str()).map_err(|error| {
        storage_error(
            "invalid-payload",
            "tauri-standard-storage-json-invalid",
            "repair_or_replace_storage_json",
            "storage_read_json",
            Some(path.as_path()),
            Some(error.to_string()),
        )
    })?;
    Ok(StandardStorageJsonResult {
        path: path.display().to_string(),
        value,
    })
}

pub fn storage_write_json_for_root(
    root: &StandardAppStorageRoot,
    payload: StandardStorageWriteJsonPayload,
) -> Result<StandardStorageJsonResult, String> {
    let path =
        resolve_standard_storage_child(root, payload.relative_path.as_str(), "storage_write_json")?;
    let body = serde_json::to_string_pretty(&payload.value).map_err(|error| {
        storage_error(
            "invalid-payload",
            "tauri-standard-storage-json-serialize-failed",
            "provide_json_serializable_storage_value",
            "storage_write_json",
            Some(path.as_path()),
            Some(error.to_string()),
        )
    })?;
    let tmp_path = path.with_file_name(format!(
        ".{}.{}.{}.tmp",
        path.file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("storage-json"),
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or(0)
    ));
    fs::write(&tmp_path, body).map_err(|error| {
        storage_error(
            "host-internal-error",
            "tauri-standard-storage-json-temp-write-failed",
            "inspect_standard_storage_host_permissions",
            "storage_write_json",
            Some(tmp_path.as_path()),
            Some(error.to_string()),
        )
    })?;
    fs::rename(&tmp_path, &path).map_err(|error| {
        let _ = fs::remove_file(&tmp_path);
        storage_error(
            "host-internal-error",
            "tauri-standard-storage-json-rename-failed",
            "inspect_standard_storage_host_permissions",
            "storage_write_json",
            Some(path.as_path()),
            Some(error.to_string()),
        )
    })?;
    Ok(StandardStorageJsonResult {
        path: path.display().to_string(),
        value: payload.value,
    })
}

pub fn storage_remove_json_for_root(
    root: &StandardAppStorageRoot,
    payload: StandardStoragePathPayload,
) -> Result<StandardStorageRemoveJsonResult, String> {
    let path = resolve_standard_storage_child(
        root,
        payload.relative_path.as_str(),
        "storage_remove_json",
    )?;
    if !path.exists() {
        return Ok(StandardStorageRemoveJsonResult {
            path: path.display().to_string(),
            removed: false,
        });
    }
    fs::remove_file(&path).map_err(|error| {
        storage_error(
            "host-internal-error",
            "tauri-standard-storage-json-remove-failed",
            "inspect_standard_storage_host_permissions",
            "storage_remove_json",
            Some(path.as_path()),
            Some(error.to_string()),
        )
    })?;
    Ok(StandardStorageRemoveJsonResult {
        path: path.display().to_string(),
        removed: true,
    })
}

fn resolve_standard_storage_child(
    root: &StandardAppStorageRoot,
    relative_path: &str,
    command: &str,
) -> Result<PathBuf, String> {
    let normalized = relative_path.trim();
    if normalized.is_empty() {
        return Err(storage_error(
            "invalid-path",
            "tauri-standard-storage-relative-path-required",
            "provide_app_relative_storage_path",
            command,
            None,
            None,
        ));
    }
    let child = Path::new(normalized);
    if child.is_absolute() {
        return Err(storage_error(
            "invalid-path",
            "tauri-standard-storage-absolute-path-forbidden",
            "provide_app_relative_storage_path",
            command,
            None,
            None,
        ));
    }
    scoped_storage_child(
        root.root().to_str().unwrap_or_default(),
        "standard app storage root",
        child,
    )
    .map_err(|error| {
        storage_error(
            "invalid-path",
            "tauri-standard-storage-relative-path-invalid",
            "provide_app_relative_storage_path",
            command,
            None,
            Some(error),
        )
    })
}

fn storage_error(
    code: &str,
    reason_code: &str,
    action_hint: &str,
    command: &str,
    path: Option<&Path>,
    cause: Option<String>,
) -> String {
    crate::capabilities::standard_shell_error(
        code,
        reason_code,
        action_hint,
        "tauri",
        Some(json!({
            "command": command,
            "path": path.map(|value| value.display().to_string()),
            "cause": cause,
        })),
    )
}

#[cfg(test)]
mod tests {
    use super::{
        canonical_storage_root, data_path_resolve_for_root, scoped_storage_child,
        storage_read_json_for_root, storage_remove_json_for_root, storage_write_json_for_root,
        StandardAppStorageRoot, StandardStoragePathPayload, StandardStorageWriteJsonPayload,
    };
    use serde_json::Value;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_root(prefix: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("nimi-runtime-app-storage-{prefix}-{unique}"));
        std::fs::create_dir_all(&dir).expect("create temp root");
        dir
    }

    #[test]
    fn canonical_root_requires_absolute_path() {
        assert!(canonical_storage_root("relative/path", "test root")
            .expect_err("relative rejected")
            .contains("absolute Runtime app storage root"));
    }

    #[test]
    fn scoped_child_rejects_parent_escape() {
        let root = temp_root("escape");
        let error =
            scoped_storage_child(root.to_str().expect("root"), "test root", "../outside.json")
                .expect_err("escape rejected");
        assert!(error.contains("escapes Runtime app storage root"));
    }

    #[test]
    fn scoped_child_materializes_parent_under_root() {
        let root = temp_root("child");
        let child = scoped_storage_child(
            root.to_str().expect("root"),
            "test root",
            "nested/file.json",
        )
        .expect("child");
        assert!(child.starts_with(root.canonicalize().expect("canonical root")));
        assert!(child.parent().expect("parent").exists());
    }

    #[test]
    fn standard_storage_root_requires_absolute_path() {
        let error =
            StandardAppStorageRoot::from_path("relative/path").expect_err("relative root rejected");
        assert!(error.contains("absolute Runtime app storage root"));
    }

    #[test]
    fn standard_storage_helpers_confine_relative_paths() {
        let root = temp_root("standard-escape");
        let provider = StandardAppStorageRoot::from_path(root).expect("provider");
        let error = data_path_resolve_for_root(
            &provider,
            StandardStoragePathPayload {
                relative_path: "../escape.json".to_string(),
            },
        )
        .expect_err("escape rejected");
        let parsed: Value = serde_json::from_str(error.as_str()).expect("standard shell error");
        assert_eq!(
            parsed.get("code").and_then(Value::as_str),
            Some("invalid-path")
        );
    }

    #[test]
    fn standard_storage_payload_rejects_renderer_root_fields() {
        let parsed = serde_json::from_value::<StandardStoragePathPayload>(serde_json::json!({
            "relativePath": "settings/profile.json",
            "path": "settings/legacy-alias.json"
        }));
        assert!(
            parsed.is_err(),
            "standard storage payload must reject path alias"
        );
        let parsed = serde_json::from_value::<StandardStorageWriteJsonPayload>(serde_json::json!({
            "relativePath": "settings/profile.json",
            "value": { "ok": true },
            "storageRoot": "/tmp/renderer-root"
        }));
        assert!(
            parsed.is_err(),
            "standard storage write payload must reject renderer root fields"
        );
    }

    #[test]
    fn standard_storage_helpers_read_write_and_remove_json() {
        let root = temp_root("standard-rw");
        let provider = StandardAppStorageRoot::from_path(root.clone()).expect("provider");
        let payload = StandardStoragePathPayload {
            relative_path: "settings/profile.json".to_string(),
        };

        let missing = storage_read_json_for_root(&provider, payload.clone())
            .expect_err("missing file rejected");
        let parsed_missing: Value =
            serde_json::from_str(missing.as_str()).expect("standard shell error");
        assert_eq!(
            parsed_missing.get("code").and_then(Value::as_str),
            Some("not-found")
        );

        let write = storage_write_json_for_root(
            &provider,
            StandardStorageWriteJsonPayload {
                relative_path: payload.relative_path.clone(),
                value: serde_json::json!({ "schemaVersion": 1, "enabled": true }),
            },
        )
        .expect("write");
        assert!(write.path.ends_with("settings/profile.json"));
        assert_eq!(write.value["enabled"], true);

        let read = storage_read_json_for_root(&provider, payload.clone()).expect("read");
        assert_eq!(read.value["schemaVersion"], 1);

        let remove = storage_remove_json_for_root(&provider, payload.clone()).expect("remove");
        assert!(remove.removed);
        let second = storage_remove_json_for_root(&provider, payload).expect("idempotent remove");
        assert!(!second.removed);
    }

    #[test]
    fn standard_storage_read_rejects_invalid_json() {
        let root = temp_root("standard-invalid-json");
        let provider = StandardAppStorageRoot::from_path(root.clone()).expect("provider");
        let file = root.join("broken.json");
        std::fs::write(&file, "{not-json").expect("write broken");
        let error = storage_read_json_for_root(
            &provider,
            StandardStoragePathPayload {
                relative_path: "broken.json".to_string(),
            },
        )
        .expect_err("invalid json rejected");
        let parsed: Value = serde_json::from_str(error.as_str()).expect("standard shell error");
        assert_eq!(
            parsed.get("code").and_then(Value::as_str),
            Some("invalid-payload")
        );
    }
}
