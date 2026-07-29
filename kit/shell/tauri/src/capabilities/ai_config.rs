use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine as _;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::fs;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
pub struct StandardAiConfigGetPayload {
    pub scope_ref: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
pub struct StandardAiConfigSetPayload {
    pub scope_ref: String,
    pub config: serde_json::Value,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StandardAiConfigResult {
    pub scope_ref: String,
    pub config: serde_json::Value,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct StandardAiConfigRecord {
    schema_version: u8,
    scope_ref: String,
    config: serde_json::Value,
}

#[tauri::command]
pub fn ai_config_get(
    slot: tauri::State<'_, crate::runtime_app_storage::StandardAppStorageRootSlot>,
    payload: serde_json::Value,
) -> Result<StandardAiConfigResult, String> {
    let roots = crate::runtime_app_storage::require_bound_standard_storage_roots(
        slot.inner(),
        "ai_config_get",
    )?;
    ai_config_get_for_roots(&roots, payload)
}

pub(crate) fn ai_config_get_for_roots(
    roots: &crate::runtime_app_storage::StandardAppStorageRoots,
    payload: serde_json::Value,
) -> Result<StandardAiConfigResult, String> {
    let payload = crate::runtime_app_storage::parse_standard_storage_payload::<
        StandardAiConfigGetPayload,
    >(payload, "ai_config_get")?;
    let scope_ref = require_ai_config_scope_ref(payload.scope_ref, "ai_config_get")?;
    let path = ai_config_path(roots, &scope_ref)?;
    let raw = fs::read_to_string(path.as_path()).map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            crate::capabilities::standard_shell_error(
                "not-found",
                "tauri-ai-config-scope-not-found",
                "initialize_ai_config_for_scope_before_reading",
                "tauri",
                Some(json!({ "command": "ai_config_get", "scopeRef": scope_ref.as_str() })),
            )
        } else {
            crate::capabilities::standard_shell_error(
                "host-internal-error",
                "tauri-ai-config-read-failed",
                "inspect_standard_ai_config_store",
                "tauri",
                Some(json!({ "command": "ai_config_get", "scopeRef": scope_ref.as_str(), "cause": error.to_string() })),
            )
        }
    })?;
    let record: StandardAiConfigRecord = serde_json::from_str(raw.as_str()).map_err(|error| {
        crate::capabilities::standard_shell_error(
            "host-internal-error",
            "tauri-ai-config-record-invalid",
            "repair_standard_ai_config_store",
            "tauri",
            Some(json!({ "command": "ai_config_get", "scopeRef": scope_ref.as_str(), "cause": error.to_string() })),
        )
    })?;
    if record.scope_ref != scope_ref || !record.config.is_object() {
        return Err(crate::capabilities::standard_shell_error(
            "host-internal-error",
            "tauri-ai-config-record-scope-mismatch",
            "repair_standard_ai_config_store",
            "tauri",
            Some(json!({ "command": "ai_config_get", "scopeRef": scope_ref.as_str() })),
        ));
    }
    Ok(StandardAiConfigResult {
        scope_ref,
        config: record.config,
    })
}

#[tauri::command]
pub fn ai_config_set(
    slot: tauri::State<'_, crate::runtime_app_storage::StandardAppStorageRootSlot>,
    payload: serde_json::Value,
) -> Result<StandardAiConfigResult, String> {
    let roots = crate::runtime_app_storage::require_bound_standard_storage_roots(
        slot.inner(),
        "ai_config_set",
    )?;
    ai_config_set_for_roots(&roots, payload)
}

pub(crate) fn ai_config_set_for_roots(
    roots: &crate::runtime_app_storage::StandardAppStorageRoots,
    payload: serde_json::Value,
) -> Result<StandardAiConfigResult, String> {
    let payload = crate::runtime_app_storage::parse_standard_storage_payload::<
        StandardAiConfigSetPayload,
    >(payload, "ai_config_set")?;
    let scope_ref = require_ai_config_scope_ref(payload.scope_ref, "ai_config_set")?;
    if !payload.config.is_object() {
        return Err(crate::capabilities::standard_shell_error(
            "invalid-payload",
            "tauri-ai-config-value-required",
            "provide_full_materialized_ai_config",
            "tauri",
            Some(json!({ "command": "ai_config_set", "scopeRef": scope_ref.as_str() })),
        ));
    }
    let path = ai_config_path(roots, &scope_ref)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            crate::capabilities::standard_shell_error(
                "host-internal-error",
                "tauri-ai-config-directory-create-failed",
                "inspect_standard_ai_config_store",
                "tauri",
                Some(json!({ "command": "ai_config_set", "scopeRef": scope_ref.as_str(), "cause": error.to_string() })),
            )
        })?;
    }
    let record = StandardAiConfigRecord {
        schema_version: 1,
        scope_ref: scope_ref.clone(),
        config: payload.config,
    };
    let body = serde_json::to_vec_pretty(&record).map_err(|error| {
        crate::capabilities::standard_shell_error(
            "host-internal-error",
            "tauri-ai-config-serialize-failed",
            "inspect_standard_ai_config_store",
            "tauri",
            Some(json!({ "command": "ai_config_set", "scopeRef": scope_ref.as_str(), "cause": error.to_string() })),
        )
    })?;
    let tmp_path = ai_config_temp_path(path.as_path());
    fs::write(tmp_path.as_path(), body).map_err(|error| {
        crate::capabilities::standard_shell_error(
            "host-internal-error",
            "tauri-ai-config-temp-write-failed",
            "inspect_standard_ai_config_store",
            "tauri",
            Some(json!({ "command": "ai_config_set", "scopeRef": scope_ref.as_str(), "path": tmp_path.display().to_string(), "cause": error.to_string() })),
        )
    })?;
    fs::rename(tmp_path.as_path(), path.as_path()).map_err(|error| {
        let _ = fs::remove_file(tmp_path.as_path());
        crate::capabilities::standard_shell_error(
            "host-internal-error",
            "tauri-ai-config-rename-failed",
            "inspect_standard_ai_config_store",
            "tauri",
            Some(json!({ "command": "ai_config_set", "scopeRef": scope_ref.as_str(), "path": path.display().to_string(), "cause": error.to_string() })),
        )
    })?;
    Ok(StandardAiConfigResult {
        scope_ref,
        config: record.config,
    })
}

fn ai_config_path(
    roots: &crate::runtime_app_storage::StandardAppStorageRoots,
    scope_ref: &str,
) -> Result<std::path::PathBuf, String> {
    let encoded = URL_SAFE_NO_PAD.encode(scope_ref.as_bytes());
    crate::runtime_app_storage::scoped_storage_child(
        roots.data_root().to_string_lossy().as_ref(),
        "ai_config",
        std::path::Path::new("ai-config").join(format!("{encoded}.json")),
    )
    .map_err(|error| {
        crate::capabilities::standard_shell_error(
            "host-internal-error",
            "tauri-ai-config-path-resolve-failed",
            "inspect_standard_ai_config_store",
            "tauri",
            Some(json!({ "command": "ai_config_path", "scopeRef": scope_ref, "cause": error })),
        )
    })
}

fn ai_config_temp_path(path: &std::path::Path) -> std::path::PathBuf {
    path.with_file_name(format!(
        ".{}.{}.{}.tmp",
        path.file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("ai-config"),
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or(0)
    ))
}

fn require_ai_config_scope_ref(value: String, command: &str) -> Result<String, String> {
    let scope_ref = value.trim().to_string();
    if scope_ref.is_empty() {
        return Err(crate::capabilities::standard_shell_error(
            "invalid-payload",
            "tauri-ai-config-scope-ref-required",
            "provide_admitted_ai_config_scope_ref",
            "tauri",
            Some(json!({ "command": command })),
        ));
    }
    Ok(scope_ref)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_root(prefix: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("nimi-ai-config-{prefix}-{unique}"));
        std::fs::create_dir_all(&dir).expect("create temp root");
        dir
    }

    fn parse_envelope(error: &str) -> Value {
        serde_json::from_str::<Value>(error).expect("standard shell error envelope")
    }

    #[test]
    fn set_and_get_roundtrip_inside_host_bound_root() {
        let root = temp_root("roundtrip");
        let roots = crate::runtime_app_storage::test_standard_app_storage_roots(root.clone());
        let scope_ref = "app:../escape";
        let result = ai_config_set_for_roots(
            &roots,
            json!({
                "scopeRef": scope_ref,
                "config": { "capabilities": { "targetRefs": {} } }
            }),
        )
        .expect("set ai config");

        assert_eq!(result.scope_ref, scope_ref);
        assert_eq!(result.config["capabilities"]["targetRefs"], json!({}));
        assert!(!root.join("escape.json").exists());

        let encoded = URL_SAFE_NO_PAD.encode(scope_ref.as_bytes());
        assert!(root
            .join("ai-config")
            .join(format!("{encoded}.json"))
            .exists());

        let loaded = ai_config_get_for_roots(&roots, json!({ "scopeRef": scope_ref }))
            .expect("get ai config");
        assert_eq!(loaded, result);
    }

    #[test]
    fn set_rejects_empty_scope_ref_and_non_object_config() {
        let root = temp_root("invalid");
        let roots = crate::runtime_app_storage::test_standard_app_storage_roots(root);

        let empty_scope =
            ai_config_set_for_roots(&roots, json!({ "scopeRef": "   ", "config": {} }))
                .expect_err("empty scope rejected");
        assert_eq!(
            parse_envelope(empty_scope.as_str())
                .get("reasonCode")
                .and_then(Value::as_str),
            Some("tauri-ai-config-scope-ref-required"),
        );

        let non_object =
            ai_config_set_for_roots(&roots, json!({ "scopeRef": "app:fixture", "config": [] }))
                .expect_err("non-object config rejected");
        assert_eq!(
            parse_envelope(non_object.as_str())
                .get("reasonCode")
                .and_then(Value::as_str),
            Some("tauri-ai-config-value-required"),
        );
    }

    #[test]
    fn get_missing_scope_returns_typed_not_found() {
        let root = temp_root("missing");
        let roots = crate::runtime_app_storage::test_standard_app_storage_roots(root);

        let error = ai_config_get_for_roots(&roots, json!({ "scopeRef": "app:missing" }))
            .expect_err("missing scope rejected");
        let envelope = parse_envelope(error.as_str());
        assert_eq!(
            envelope.get("code").and_then(Value::as_str),
            Some("not-found")
        );
        assert_eq!(
            envelope.get("reasonCode").and_then(Value::as_str),
            Some("tauri-ai-config-scope-not-found"),
        );
    }

    #[test]
    fn renderer_path_authority_fields_are_rejected_before_write() {
        let root = temp_root("renderer-field");
        let roots = crate::runtime_app_storage::test_standard_app_storage_roots(root);

        let error = ai_config_set_for_roots(
            &roots,
            json!({
                "scopeRef": "app:fixture",
                "path": "../escape.json",
                "config": {}
            }),
        )
        .expect_err("renderer path rejected");
        assert_eq!(
            parse_envelope(error.as_str())
                .get("reasonCode")
                .and_then(Value::as_str),
            Some("tauri-standard-storage-renderer-field-forbidden"),
        );
    }

    #[test]
    fn set_fails_before_success_when_store_directory_is_not_writable_directory() {
        let root = temp_root("blocked-dir");
        std::fs::write(root.join("ai-config"), "not a directory").expect("block store dir");
        let roots = crate::runtime_app_storage::test_standard_app_storage_roots(root);

        let error =
            ai_config_set_for_roots(&roots, json!({ "scopeRef": "app:fixture", "config": {} }))
                .expect_err("blocked store dir rejected");
        assert_eq!(
            parse_envelope(error.as_str())
                .get("code")
                .and_then(Value::as_str),
            Some("host-internal-error"),
        );
    }
}
