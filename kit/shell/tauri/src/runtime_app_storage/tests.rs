use super::{
    canonical_storage_root, data_path_resolve_for_roots, parse_standard_storage_payload,
    require_bound_standard_storage_roots, resolve_standard_app_storage_roots, scoped_storage_child,
    storage_read_json_for_roots, storage_remove_json_for_roots, storage_write_json_for_roots,
    test_standard_app_storage_roots, StandardAppStorageRootSlot, StandardDataRootBinding,
    StandardStoragePathPayload, StandardStorageWriteJsonPayload,
};
use base64::Engine;
use prost::Message;
use serde_json::Value;
use std::path::PathBuf;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::runtime_bridge::{
    generated, with_runtime_bridge_host_hooks, RuntimeBridgeAppSession, RuntimeBridgeHostHooks,
    RuntimeBridgeMetadata, RuntimeBridgeTrustedMetadata, RuntimeBridgeUnaryResult,
    RUNTIME_APP_GET_APP_STORAGE_METHOD_ID,
};

fn temp_root(prefix: &str) -> PathBuf {
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("time")
        .as_nanos();
    let dir = std::env::temp_dir().join(format!("nimi-runtime-app-storage-{prefix}-{unique}"));
    std::fs::create_dir_all(&dir).expect("create temp root");
    dir
}

fn parse_envelope(error: &str) -> Value {
    serde_json::from_str::<Value>(error).expect("standard shell error envelope")
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
    let error = scoped_storage_child(root.to_str().expect("root"), "test root", "../outside.json")
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
fn unbound_slot_fails_closed_with_binding_missing() {
    let slot = StandardAppStorageRootSlot::empty();
    let error = require_bound_standard_storage_roots(&slot, "data_path_resolve")
        .expect_err("unbound slot rejected");
    let parsed = parse_envelope(error.as_str());
    assert_eq!(
        parsed.get("code").and_then(Value::as_str),
        Some("capability-unavailable")
    );
    assert_eq!(
        parsed.get("reasonCode").and_then(Value::as_str),
        Some("tauri-standard-storage-binding-missing")
    );
    assert_eq!(
        parsed.get("actionHint").and_then(Value::as_str),
        Some("manage_standard_app_storage_root_from_runtime_binding")
    );
}

#[tokio::test]
async fn launch_projection_binding_resolves_canonical_roots() {
    let data_root = temp_root("projection-data");
    let cache_root = temp_root("projection-cache");
    let slot = StandardAppStorageRootSlot::from_binding_resolved(
        StandardDataRootBinding::RuntimeLaunchProjection {
            durable_data_root: data_root.clone(),
            cache_root: Some(cache_root.clone()),
            temp_root: None,
            projection_ref: "runtime-launch:test".to_string(),
        },
    )
    .await
    .expect("resolved slot");
    let roots =
        require_bound_standard_storage_roots(&slot, "data_path_resolve").expect("bound roots");
    assert_eq!(
        roots.data_root(),
        data_root.canonicalize().expect("canonical data root")
    );
    assert_eq!(
        roots.cache_root().expect("cache root"),
        cache_root.canonicalize().expect("canonical cache root")
    );
    assert!(roots.temp_root().is_none());
}

#[tokio::test]
async fn launch_projection_binding_rejects_relative_data_root() {
    let error =
        resolve_standard_app_storage_roots(StandardDataRootBinding::RuntimeLaunchProjection {
            durable_data_root: PathBuf::from("relative/data"),
            cache_root: None,
            temp_root: None,
            projection_ref: "runtime-launch:test".to_string(),
        })
        .await
        .expect_err("relative data root rejected");
    let parsed = parse_envelope(error.as_str());
    assert_eq!(
        parsed.get("code").and_then(Value::as_str),
        Some("invalid-path")
    );
    assert_eq!(
        parsed.get("reasonCode").and_then(Value::as_str),
        Some("tauri-standard-storage-binding-root-not-absolute")
    );
}

#[tokio::test]
async fn launch_projection_binding_requires_projection_ref() {
    let error =
        resolve_standard_app_storage_roots(StandardDataRootBinding::RuntimeLaunchProjection {
            durable_data_root: temp_root("projection-ref"),
            cache_root: None,
            temp_root: None,
            projection_ref: "  ".to_string(),
        })
        .await
        .expect_err("empty projection ref rejected");
    let parsed = parse_envelope(error.as_str());
    assert_eq!(
        parsed.get("reasonCode").and_then(Value::as_str),
        Some("tauri-standard-storage-binding-projection-ref-required")
    );
}

#[tokio::test]
async fn get_app_storage_binding_requires_app_id() {
    let error = resolve_standard_app_storage_roots(StandardDataRootBinding::RuntimeGetAppStorage {
        app_id: "  ".to_string(),
    })
    .await
    .expect_err("empty app id rejected");
    let parsed = parse_envelope(error.as_str());
    assert_eq!(
        parsed.get("code").and_then(Value::as_str),
        Some("invalid-payload")
    );
    assert_eq!(
        parsed.get("reasonCode").and_then(Value::as_str),
        Some("tauri-standard-storage-binding-app-id-required")
    );
}

#[test]
fn get_app_storage_binding_uses_trusted_host_metadata() {
    let data_root = temp_root("runtime-get-storage-data");
    let cache_root = temp_root("runtime-get-storage-cache");
    let trusted_called = Arc::new(AtomicBool::new(false));
    let trusted_called_for_hook = trusted_called.clone();
    let override_called = Arc::new(AtomicBool::new(false));
    let override_called_for_hook = override_called.clone();
    let data_root_for_hook = data_root.clone();
    let cache_root_for_hook = cache_root.clone();

    let hooks = RuntimeBridgeHostHooks {
        trusted_metadata: Some(Arc::new(move |request| {
            trusted_called_for_hook.store(true, Ordering::SeqCst);
            Box::pin(async move {
                assert_eq!(request.method_id, RUNTIME_APP_GET_APP_STORAGE_METHOD_ID);
                Ok(Some(RuntimeBridgeTrustedMetadata {
                    metadata: Some(RuntimeBridgeMetadata {
                        app_id: Some("nimi.parentos".to_string()),
                        participant_id: Some("nimi.parentos".to_string()),
                        caller_kind: Some("local-first-party-app".to_string()),
                        caller_id: Some("nimi.parentos.local-first-party".to_string()),
                        ..RuntimeBridgeMetadata::default()
                    }),
                    authorization: None,
                    protected_access_token: None,
                    app_session: Some(RuntimeBridgeAppSession {
                        session_id: "host-session-id".to_string(),
                        session_token: "host-session-token".to_string(),
                    }),
                }))
            })
        })),
        unary_override: Some(Arc::new(move |payload| {
            override_called_for_hook.store(true, Ordering::SeqCst);
            assert_eq!(payload.method_id, RUNTIME_APP_GET_APP_STORAGE_METHOD_ID);
            let metadata = payload.metadata.as_ref().expect("trusted host metadata");
            assert_eq!(metadata.app_id.as_deref(), Some("nimi.parentos"));
            assert_eq!(
                metadata.caller_id.as_deref(),
                Some("nimi.parentos.local-first-party")
            );
            assert_eq!(
                payload
                    .app_session
                    .as_ref()
                    .map(|session| session.session_id.as_str()),
                Some("host-session-id")
            );
            let request_bytes = base64::engine::general_purpose::STANDARD
                .decode(payload.request_bytes_base64.trim())
                .expect("decode request");
            let request = generated::GetAppStorageRequest::decode(request_bytes.as_slice())
                .expect("decode GetAppStorageRequest");
            assert_eq!(request.app_id, "nimi.parentos");

            let response = generated::GetAppStorageResponse {
                projection: Some(generated::AppStorageProjection {
                    app_id: "nimi.parentos".to_string(),
                    state: generated::AppStorageState::Ready as i32,
                    durable_data_root: data_root_for_hook.display().to_string(),
                    cache_root: cache_root_for_hook.display().to_string(),
                    ..generated::AppStorageProjection::default()
                }),
            };
            Ok(Some(RuntimeBridgeUnaryResult {
                response_bytes_base64: base64::engine::general_purpose::STANDARD
                    .encode(response.encode_to_vec()),
                response_metadata: None,
            }))
        })),
        ..RuntimeBridgeHostHooks::default()
    };

    let roots = with_runtime_bridge_host_hooks(hooks, || {
        tauri::async_runtime::block_on(resolve_standard_app_storage_roots(
            StandardDataRootBinding::RuntimeGetAppStorage {
                app_id: "nimi.parentos".to_string(),
            },
        ))
    })
    .expect("Runtime storage binding should use trusted host metadata");

    assert!(trusted_called.load(Ordering::SeqCst));
    assert!(override_called.load(Ordering::SeqCst));
    assert_eq!(
        roots.data_root(),
        data_root.canonicalize().expect("canonical data root")
    );
    assert_eq!(
        roots.cache_root().expect("cache root"),
        cache_root.canonicalize().expect("canonical cache root")
    );
}

#[test]
fn storage_payload_parse_rejects_forbidden_renderer_root_fields() {
    for field in [
        "path",
        "root",
        "storageRoot",
        "absolutePath",
        "dataRoot",
        "cacheRoot",
        "tempRoot",
    ] {
        let error = parse_standard_storage_payload::<StandardStoragePathPayload>(
            serde_json::json!({
                "relativePath": "settings/profile.json",
                field: "/tmp/renderer-root",
            }),
            "storage_read_json",
        )
        .expect_err("forbidden renderer field rejected");
        let parsed = parse_envelope(error.as_str());
        assert_eq!(
            parsed.get("code").and_then(Value::as_str),
            Some("invalid-payload")
        );
        assert_eq!(
            parsed.get("reasonCode").and_then(Value::as_str),
            Some("tauri-standard-storage-renderer-field-forbidden")
        );
    }
}

#[test]
fn storage_payload_parse_rejects_non_object_and_unknown_fields() {
    let error = parse_standard_storage_payload::<StandardStoragePathPayload>(
        serde_json::json!("relative"),
        "storage_read_json",
    )
    .expect_err("non-object rejected");
    assert_eq!(
        parse_envelope(error.as_str())
            .get("reasonCode")
            .and_then(Value::as_str),
        Some("tauri-standard-storage-payload-not-object")
    );

    let error = parse_standard_storage_payload::<StandardStorageWriteJsonPayload>(
        serde_json::json!({
            "relativePath": "settings/profile.json",
            "value": { "ok": true },
            "unexpected": true,
        }),
        "storage_write_json",
    )
    .expect_err("unknown field rejected");
    assert_eq!(
        parse_envelope(error.as_str())
            .get("reasonCode")
            .and_then(Value::as_str),
        Some("tauri-standard-storage-payload-invalid")
    );
}

#[test]
fn standard_storage_helpers_confine_relative_paths() {
    let roots = test_standard_app_storage_roots(temp_root("standard-escape"));
    let error = data_path_resolve_for_roots(
        &roots,
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
fn standard_storage_helpers_read_write_and_remove_json() {
    let roots = test_standard_app_storage_roots(temp_root("standard-rw"));
    let payload = StandardStoragePathPayload {
        relative_path: "settings/profile.json".to_string(),
    };

    let missing =
        storage_read_json_for_roots(&roots, payload.clone()).expect_err("missing file rejected");
    let parsed_missing: Value =
        serde_json::from_str(missing.as_str()).expect("standard shell error");
    assert_eq!(
        parsed_missing.get("code").and_then(Value::as_str),
        Some("not-found")
    );

    let write = storage_write_json_for_roots(
        &roots,
        StandardStorageWriteJsonPayload {
            relative_path: payload.relative_path.clone(),
            value: serde_json::json!({ "schemaVersion": 1, "enabled": true }),
        },
    )
    .expect("write");
    assert!(PathBuf::from(&write.path).ends_with(PathBuf::from("settings").join("profile.json")));
    assert_eq!(write.value["enabled"], true);

    let read = storage_read_json_for_roots(&roots, payload.clone()).expect("read");
    assert_eq!(read.value["schemaVersion"], 1);

    let remove = storage_remove_json_for_roots(&roots, payload.clone()).expect("remove");
    assert!(remove.removed);
    let second = storage_remove_json_for_roots(&roots, payload).expect("idempotent remove");
    assert!(!second.removed);
}

#[test]
fn standard_storage_read_rejects_invalid_json() {
    let root = temp_root("standard-invalid-json");
    let roots = test_standard_app_storage_roots(root.clone());
    let file = root.join("broken.json");
    std::fs::write(&file, "{not-json").expect("write broken");
    let error = storage_read_json_for_roots(
        &roots,
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
