use base64::Engine;
use serde::Serialize;
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};
use tonic::client::Grpc;

use super::channel_pool;
use super::codec::RawBytesCodec;
use super::error_map::{bridge_error, bridge_status_error};
use super::metadata;
use super::{RuntimeBridgeStreamClosePayload, RuntimeBridgeStreamOpenPayload};

static STREAM_COUNTER: AtomicU64 = AtomicU64::new(1);
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

fn validate_stream_method(method_id: &str) -> Result<(), String> {
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

fn next_stream_id() -> String {
    let counter = STREAM_COUNTER.fetch_add(1, Ordering::Relaxed);
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    format!("runtime-stream-{}-{}", now, counter)
}

pub async fn open_stream(
    app: &AppHandle,
    payload: &RuntimeBridgeStreamOpenPayload,
) -> Result<RuntimeBridgeStreamOpenResult, String> {
    validate_stream_method(payload.method_id.as_str())?;

    let request_bytes = decode_request_bytes(payload)?;
    let path = tonic::codegen::http::uri::PathAndQuery::from_maybe_shared(
        payload.method_id.trim().to_string(),
    )
    .map_err(|_| bridge_error("RUNTIME_BRIDGE_METHOD_INVALID", payload.method_id.as_str()))?;
    let channel = channel_pool::shared_channel(super::daemon_manager::grpc_addr().as_str()).await?;
    let mut grpc = Grpc::new(channel);
    let mut request = tonic::Request::new(request_bytes);
    metadata::apply_metadata(
        &mut request,
        payload.metadata.as_ref(),
        payload.method_id.as_str(),
    )?;
    if let Some(timeout_ms) = payload.timeout_ms {
        request.set_timeout(std::time::Duration::from_millis(timeout_ms.max(1)));
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

    let stream_id = next_stream_id();
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

    {
        let mut guard = stream_registry()
            .lock()
            .expect("runtime stream registry lock poisoned");
        guard.insert(stream_id.clone(), task);
    }

    Ok(RuntimeBridgeStreamOpenResult { stream_id })
}

pub fn close_stream(payload: &RuntimeBridgeStreamClosePayload) {
    let mut guard = stream_registry()
        .lock()
        .expect("runtime stream registry lock poisoned");
    if let Some(handle) = guard.remove(payload.stream_id.as_str()) {
        handle.abort();
    }
}

#[cfg(test)]
mod tests {
    use super::{decode_request_bytes, validate_stream_method};
    use crate::runtime_bridge::RuntimeBridgeStreamOpenPayload;

    fn payload(method_id: &str, request_bytes_base64: &str) -> RuntimeBridgeStreamOpenPayload {
        RuntimeBridgeStreamOpenPayload {
            method_id: method_id.to_string(),
            request_bytes_base64: request_bytes_base64.to_string(),
            metadata: None,
            timeout_ms: None,
            event_namespace: None,
        }
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
        let result = validate_stream_method("/nimi.runtime.v1.RuntimeAiService/Generate");
        assert!(result
            .err()
            .unwrap_or_default()
            .contains("RUNTIME_BRIDGE_METHOD_UNARY_ONLY"));
    }

    #[test]
    fn decode_request_bytes_rejects_invalid_base64() {
        let result = decode_request_bytes(&payload(
            "/nimi.runtime.v1.RuntimeAiService/StreamGenerate",
            "!!!",
        ));
        assert!(result
            .err()
            .unwrap_or_default()
            .contains("RUNTIME_BRIDGE_REQUEST_DECODE_FAILED"));
    }
}
