use crate::capabilities::standard_shell_error;
use base64::Engine;
use serde::Serialize;
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};

use super::channel_pool;
use super::codec::RawBytesCodec;
use super::error_map::{bridge_error, bridge_status_error};
use super::metadata;
use super::{RuntimeBridgeStreamClosePayload, RuntimeBridgeStreamOpenPayload};

static STREAM_COUNTER: AtomicU64 = AtomicU64::new(1);
const MAX_OPEN_STREAMS: usize = 256;
static OPEN_STREAMS: OnceLock<Mutex<HashMap<String, tauri::async_runtime::JoinHandle<()>>>> =
    OnceLock::new();

fn stream_registry() -> &'static Mutex<HashMap<String, tauri::async_runtime::JoinHandle<()>>> {
    OPEN_STREAMS.get_or_init(|| Mutex::new(HashMap::new()))
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeBridgeStreamOpenResult {
    pub stream_id: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeBridgeStreamEvent {
    stream_id: String,
    event_type: &'static str,
    payload_bytes_base64: Option<String>,
    error: Option<RuntimeBridgeStreamError>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeBridgeStreamError {
    reason_code: String,
    action_hint: String,
    trace_id: String,
    retryable: bool,
    message: String,
}

fn decode_request_bytes(payload: &RuntimeBridgeStreamOpenPayload) -> Result<Vec<u8>, String> {
    base64::engine::general_purpose::STANDARD
        .decode(payload.request_bytes_base64.trim())
        .map_err(|_| {
            bridge_error(
                "RUNTIME_BRIDGE_REQUEST_DECODE_FAILED",
                "invalid requestBytesBase64",
            )
        })
}

fn protected_desktop_stream_method(method_id: &str) -> bool {
    nimi_shell_protected_local::DesktopMachineProductStreamMethod::from_method_id(method_id)
        .is_some()
        || nimi_shell_protected_local::DesktopAccountProductStreamMethod::from_method_id(method_id)
            .is_some()
}

fn validate_stream_method(method_id: &str) -> Result<(), String> {
    if protected_desktop_stream_method(method_id) {
        return Ok(());
    }
    if !super::is_allowlisted_method(method_id) {
        return Err(bridge_error("RUNTIME_BRIDGE_METHOD_FORBIDDEN", method_id));
    }
    if !super::is_stream_method(method_id) {
        return Err(bridge_error("RUNTIME_BRIDGE_METHOD_UNARY_ONLY", method_id));
    }
    Ok(())
}

fn parse_bridge_error(error: String) -> RuntimeBridgeStreamError {
    let decoded = serde_json::from_str::<serde_json::Value>(error.as_str()).ok();
    RuntimeBridgeStreamError {
        reason_code: decoded
            .as_ref()
            .and_then(|value| value.get("reasonCode"))
            .and_then(|value| value.as_str())
            .unwrap_or("RUNTIME_BRIDGE_STREAM_FAILED")
            .to_string(),
        action_hint: decoded
            .as_ref()
            .and_then(|value| value.get("actionHint"))
            .and_then(|value| value.as_str())
            .unwrap_or("check_runtime_daemon")
            .to_string(),
        trace_id: decoded
            .as_ref()
            .and_then(|value| value.get("traceId"))
            .and_then(|value| value.as_str())
            .unwrap_or("")
            .to_string(),
        retryable: decoded
            .as_ref()
            .and_then(|value| value.get("retryable"))
            .and_then(|value| value.as_bool())
            .unwrap_or(false),
        message: decoded
            .as_ref()
            .and_then(|value| value.get("message"))
            .and_then(|value| value.as_str())
            .unwrap_or(error.as_str())
            .to_string(),
    }
}

fn emit_stream_event(app: &AppHandle, event_name: &str, event: RuntimeBridgeStreamEvent) {
    let _ = app.emit(event_name, event);
}

fn emit_stream_completed(app: &AppHandle, event_name: &str, stream_id: &str) {
    emit_stream_event(
        app,
        event_name,
        RuntimeBridgeStreamEvent {
            stream_id: stream_id.to_string(),
            event_type: "completed",
            payload_bytes_base64: None,
            error: None,
        },
    );
}

fn register_stream_task(
    stream_id: &str,
    task: tauri::async_runtime::JoinHandle<()>,
) -> Result<(), String> {
    let mut guard = stream_registry()
        .lock()
        .expect("runtime stream registry lock poisoned");
    if guard.len() >= MAX_OPEN_STREAMS {
        task.abort();
        return Err(bridge_error(
            "RUNTIME_BRIDGE_STREAM_LIMIT_EXCEEDED",
            format!("too many open streams (limit {MAX_OPEN_STREAMS})").as_str(),
        ));
    }
    guard.insert(stream_id.to_string(), task);
    Ok(())
}

fn next_stream_id() -> String {
    let counter = STREAM_COUNTER.fetch_add(1, Ordering::Relaxed);
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    format!("runtime-stream-{}-{}", now, counter)
}

fn resolve_stream_id(payload: &RuntimeBridgeStreamOpenPayload) -> Result<String, String> {
    let requested = payload.stream_id.as_deref().unwrap_or("").trim();
    if requested.is_empty() {
        return Ok(next_stream_id());
    }
    if requested.len() > 160
        || !requested
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '_')
    {
        return Err(bridge_error(
            "RUNTIME_BRIDGE_STREAM_ID_INVALID",
            "streamId must contain only ASCII letters, digits, hyphen, or underscore",
        ));
    }
    Ok(requested.to_string())
}

pub async fn open_stream(
    app: &AppHandle,
    payload: &RuntimeBridgeStreamOpenPayload,
    protected_main_window: bool,
) -> Result<RuntimeBridgeStreamOpenResult, String> {
    validate_stream_method(payload.method_id.as_str())?;

    let request_bytes = decode_request_bytes(payload)?;
    if protected_desktop_stream_method(payload.method_id.as_str()) {
        if !protected_main_window {
            return Err(bridge_error(
                "RUNTIME_BRIDGE_PROTECTED_MAIN_WINDOW_REQUIRED",
                payload.method_id.as_str(),
            ));
        }
        return open_protected_desktop_stream(app, payload, request_bytes).await;
    }
    let path = tonic::codegen::http::uri::PathAndQuery::from_maybe_shared(
        payload.method_id.trim().to_string(),
    )
    .map_err(|_| bridge_error("RUNTIME_BRIDGE_METHOD_INVALID", payload.method_id.as_str()))?;
    let channel =
        channel_pool::shared_stream_channel(super::daemon_manager::grpc_addr().as_str()).await?;
    let mut grpc = nimi_shell_protected_local::runtime_raw_client(channel);
    let mut request = tonic::Request::new(request_bytes);
    metadata::apply_metadata(
        &mut request,
        payload.metadata.as_ref(),
        payload.authorization.as_deref(),
        payload.protected_access_token.as_ref(),
        payload.app_session.as_ref(),
        payload.method_id.as_str(),
    )?;
    if let Some(timeout_ms) = payload.timeout_ms {
        if timeout_ms > 0 {
            request.set_timeout(std::time::Duration::from_millis(timeout_ms));
        }
    }

    grpc.ready().await.map_err(|error| {
        let message = format!("transport error: {}", error);
        bridge_error("RUNTIME_BRIDGE_TRANSPORT_UNAVAILABLE", message.as_str())
    })?;

    let response = grpc
        .server_streaming(request, path, RawBytesCodec)
        .await
        .map_err(bridge_status_error)?;
    let mut stream = response.into_inner();

    let stream_id = resolve_stream_id(payload)?;
    let event_name = super::stream_event_name_with_namespace(
        payload.event_namespace.as_deref().unwrap_or(""),
        stream_id.as_str(),
    );
    let app_handle = app.clone();
    let stream_id_for_task = stream_id.clone();
    let event_name_for_task = event_name.clone();
    let task = tauri::async_runtime::spawn(async move {
        loop {
            match stream.message().await {
                Ok(Some(chunk)) => {
                    emit_stream_event(
                        &app_handle,
                        event_name_for_task.as_str(),
                        RuntimeBridgeStreamEvent {
                            stream_id: stream_id_for_task.clone(),
                            event_type: "next",
                            payload_bytes_base64: Some(
                                base64::engine::general_purpose::STANDARD.encode(chunk),
                            ),
                            error: None,
                        },
                    );
                }
                Ok(None) => {
                    emit_stream_completed(
                        &app_handle,
                        event_name_for_task.as_str(),
                        stream_id_for_task.as_str(),
                    );
                    break;
                }
                Err(status) => {
                    let error = parse_bridge_error(bridge_status_error(status));
                    emit_stream_event(
                        &app_handle,
                        event_name_for_task.as_str(),
                        RuntimeBridgeStreamEvent {
                            stream_id: stream_id_for_task.clone(),
                            event_type: "error",
                            payload_bytes_base64: None,
                            error: Some(error),
                        },
                    );
                    emit_stream_completed(
                        &app_handle,
                        event_name_for_task.as_str(),
                        stream_id_for_task.as_str(),
                    );
                    break;
                }
            }
        }
        let mut guard = stream_registry()
            .lock()
            .expect("runtime stream registry lock poisoned");
        guard.remove(stream_id_for_task.as_str());
    });

    register_stream_task(stream_id.as_str(), task)?;

    Ok(RuntimeBridgeStreamOpenResult { stream_id })
}

async fn open_protected_desktop_stream(
    app: &AppHandle,
    payload: &RuntimeBridgeStreamOpenPayload,
    request_bytes: Vec<u8>,
) -> Result<RuntimeBridgeStreamOpenResult, String> {
    let timeout = payload
        .timeout_ms
        .filter(|value| *value > 0)
        .map(std::time::Duration::from_millis);
    let mut receiver = super::service_control::open_protected_desktop_stream(
        payload.method_id.as_str(),
        request_bytes,
        timeout,
    )
    .await?;
    let stream_id = resolve_stream_id(payload)?;
    let event_name = super::stream_event_name_with_namespace(
        payload.event_namespace.as_deref().unwrap_or(""),
        stream_id.as_str(),
    );
    let app_handle = app.clone();
    let stream_id_for_task = stream_id.clone();
    let event_name_for_task = event_name.clone();
    let task = tauri::async_runtime::spawn(async move {
        while let Some(next) = receiver.recv().await {
            match next {
                Ok(chunk) => emit_stream_event(
                    &app_handle,
                    event_name_for_task.as_str(),
                    RuntimeBridgeStreamEvent {
                        stream_id: stream_id_for_task.clone(),
                        event_type: "next",
                        payload_bytes_base64: Some(
                            base64::engine::general_purpose::STANDARD.encode(chunk),
                        ),
                        error: None,
                    },
                ),
                Err(error) => {
                    emit_stream_event(
                        &app_handle,
                        event_name_for_task.as_str(),
                        RuntimeBridgeStreamEvent {
                            stream_id: stream_id_for_task.clone(),
                            event_type: "error",
                            payload_bytes_base64: None,
                            error: Some(RuntimeBridgeStreamError {
                                reason_code: error.reason_code().to_string(),
                                action_hint: "retry_verified_desktop_control_operation".to_string(),
                                trace_id: String::new(),
                                retryable: error.retryable(),
                                message: error.reason_code().to_string(),
                            }),
                        },
                    );
                    break;
                }
            }
        }
        emit_stream_completed(
            &app_handle,
            event_name_for_task.as_str(),
            stream_id_for_task.as_str(),
        );
        let mut guard = stream_registry()
            .lock()
            .expect("runtime stream registry lock poisoned");
        guard.remove(stream_id_for_task.as_str());
    });
    register_stream_task(stream_id.as_str(), task)?;
    Ok(RuntimeBridgeStreamOpenResult { stream_id })
}

pub fn close_all_streams() {
    let mut guard = stream_registry()
        .lock()
        .expect("runtime stream registry lock poisoned");
    for (_, handle) in guard.drain() {
        handle.abort();
    }
}

pub fn close_stream(payload: &RuntimeBridgeStreamClosePayload) -> Result<(), String> {
    let stream_id = payload.stream_id.trim();
    if stream_id.is_empty() {
        return Err(standard_shell_error(
            "invalid-payload",
            "runtime-stream-close-stream-id-missing",
            "Pass a non-empty streamId.",
            "tauri",
            None,
        ));
    }

    let mut guard = stream_registry()
        .lock()
        .expect("runtime stream registry lock poisoned");
    if let Some(handle) = guard.remove(stream_id) {
        handle.abort();
        return Ok(());
    }
    Err(standard_shell_error(
        "not-found",
        "runtime-stream-close-stream-not-found",
        "Open a stream before closing it.",
        "tauri",
        None,
    ))
}

#[cfg(test)]
mod tests {
    use super::{
        close_stream, decode_request_bytes, protected_desktop_stream_method, register_stream_task,
        stream_registry, validate_stream_method,
    };
    use crate::runtime_bridge::{RuntimeBridgeStreamClosePayload, RuntimeBridgeStreamOpenPayload};
    use serde_json::Value;
    use std::sync::{Mutex, MutexGuard, OnceLock};

    fn registry_test_guard() -> MutexGuard<'static, ()> {
        static REGISTRY_TEST_LOCK: OnceLock<Mutex<()>> = OnceLock::new();
        REGISTRY_TEST_LOCK
            .get_or_init(|| Mutex::new(()))
            .lock()
            .expect("runtime stream registry test lock poisoned")
    }

    fn payload(method_id: &str, request_bytes_base64: &str) -> RuntimeBridgeStreamOpenPayload {
        RuntimeBridgeStreamOpenPayload {
            method_id: method_id.to_string(),
            stream_id: None,
            request_bytes_base64: request_bytes_base64.to_string(),
            metadata: None,
            authorization: None,
            protected_access_token: None,
            app_session: None,
            timeout_ms: None,
            event_namespace: None,
        }
    }

    fn close_payload(stream_id: &str) -> RuntimeBridgeStreamClosePayload {
        RuntimeBridgeStreamClosePayload {
            stream_id: stream_id.to_string(),
        }
    }

    fn assert_standard_shell_error(error: String, code: &str) {
        let parsed: Value = serde_json::from_str(error.as_str()).expect("standard shell json");
        assert_eq!(parsed.get("code").and_then(Value::as_str), Some(code));
        assert_eq!(parsed.get("source").and_then(Value::as_str), Some("tauri"));
    }

    #[test]
    fn validate_stream_method_rejects_unknown_method() {
        let result = validate_stream_method("/nimi.runtime.v1.RuntimeAiService/Nope");
        assert!(result
            .err()
            .unwrap_or_default()
            .contains("RUNTIME_BRIDGE_METHOD_FORBIDDEN"));
    }

    #[test]
    fn validate_stream_method_rejects_unary_method() {
        let result = validate_stream_method("/nimi.runtime.v1.RuntimeAiService/ExecuteScenario");
        assert!(result
            .err()
            .unwrap_or_default()
            .contains("RUNTIME_BRIDGE_METHOD_UNARY_ONLY"));
    }

    #[test]
    fn generated_machine_and_account_streams_use_protected_transport() {
        for method_id in [
            "/nimi.runtime.v1.RuntimeAiService/StreamScenario",
            "/nimi.runtime.v1.RuntimeAppService/SubscribeAppMessages",
            "/nimi.runtime.v1.RuntimeAgentService/SubscribeAgentEvents",
        ] {
            assert!(protected_desktop_stream_method(method_id));
            assert!(validate_stream_method(method_id).is_ok());
        }
        for method_id in [
            "/nimi.runtime.v1.RuntimeLocalService/WatchLocalTransfers",
            "/nimi.runtime.v1.RuntimeAuditService/SubscribeRuntimeHealthEvents",
        ] {
            assert!(protected_desktop_stream_method(method_id));
            assert!(validate_stream_method(method_id).is_ok());
        }
    }

    #[test]
    fn decode_request_bytes_rejects_invalid_base64() {
        let result = decode_request_bytes(&payload(
            "/nimi.runtime.v1.RuntimeAiService/StreamScenario",
            "!!!",
        ));
        assert!(result
            .err()
            .unwrap_or_default()
            .contains("RUNTIME_BRIDGE_REQUEST_DECODE_FAILED"));
    }

    #[test]
    fn register_stream_task_rejects_when_registry_limit_is_reached() {
        let _registry_guard = registry_test_guard();
        let mut guard = stream_registry()
            .lock()
            .expect("runtime stream registry lock poisoned");
        guard.clear();
        for index in 0..super::MAX_OPEN_STREAMS {
            guard.insert(
                format!("existing-{index}"),
                tauri::async_runtime::spawn(async {}),
            );
        }
        drop(guard);

        let result = register_stream_task("overflow", tauri::async_runtime::spawn(async {}));

        assert!(result
            .err()
            .unwrap_or_default()
            .contains("RUNTIME_BRIDGE_STREAM_LIMIT_EXCEEDED"));

        let mut guard = stream_registry()
            .lock()
            .expect("runtime stream registry lock poisoned");
        for (_, handle) in guard.drain() {
            handle.abort();
        }
    }

    #[test]
    fn close_stream_rejects_blank_stream_id() {
        let error = close_stream(&close_payload("   ")).expect_err("blank stream id rejects");

        assert_standard_shell_error(error, "invalid-payload");
    }

    #[test]
    fn close_stream_rejects_unknown_stream_id() {
        let _registry_guard = registry_test_guard();
        stream_registry()
            .lock()
            .expect("runtime stream registry lock poisoned")
            .clear();

        let error =
            close_stream(&close_payload("missing-stream")).expect_err("missing stream id rejects");

        assert_standard_shell_error(error, "not-found");
    }
}
