use base64::Engine;
use serde::Serialize;
use std::collections::HashMap;
use tonic::client::Grpc;

use super::channel_pool;
use super::codec::RawBytesCodec;
use super::error_map::bridge_error;
use super::error_map::bridge_status_error;
use super::metadata;
use super::RuntimeBridgeUnaryPayload;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeBridgeUnaryResult {
    pub response_bytes_base64: String,
    pub response_metadata: Option<HashMap<String, String>>,
}

fn extract_response_metadata(response: &tonic::Response<Vec<u8>>) -> Option<HashMap<String, String>> {
    let keys = [
        "x-nimi-runtime-version",
        "x-nimi-voice-catalog-source",
        "x-nimi-voice-catalog-version",
        "x-nimi-voice-count",
    ];
    let mut out: HashMap<String, String> = HashMap::new();
    for key in keys {
        if let Some(value) = response.metadata().get(key) {
            if let Ok(as_str) = value.to_str() {
                let normalized = as_str.trim();
                if !normalized.is_empty() {
                    out.insert(key.to_string(), normalized.to_string());
                }
            }
        }
    }
    if out.is_empty() {
        None
    } else {
        Some(out)
    }
}

fn decode_request_bytes(payload: &RuntimeBridgeUnaryPayload) -> Result<Vec<u8>, String> {
    base64::engine::general_purpose::STANDARD
        .decode(payload.request_bytes_base64.trim())
        .map_err(|_| {
            bridge_error(
                "RUNTIME_BRIDGE_REQUEST_DECODE_FAILED",
                "invalid requestBytesBase64",
            )
        })
}

fn validate_unary_method(method_id: &str) -> Result<(), String> {
    if !super::is_allowlisted_method(method_id) {
        return Err(bridge_error("RUNTIME_BRIDGE_METHOD_FORBIDDEN", method_id));
    }
    if super::is_stream_method(method_id) {
        return Err(bridge_error("RUNTIME_BRIDGE_METHOD_STREAM_ONLY", method_id));
    }
    Ok(())
}

pub async fn invoke_unary(
    payload: &RuntimeBridgeUnaryPayload,
) -> Result<RuntimeBridgeUnaryResult, String> {
    validate_unary_method(payload.method_id.as_str())?;

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
        payload.authorization.as_deref(),
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
        .unary(request, path, RawBytesCodec)
        .await
        .map_err(bridge_status_error)?;
    let response_metadata = extract_response_metadata(&response);
    Ok(RuntimeBridgeUnaryResult {
        response_bytes_base64: base64::engine::general_purpose::STANDARD
            .encode(response.into_inner()),
        response_metadata,
    })
}

#[cfg(test)]
mod tests {
    use super::{decode_request_bytes, invoke_unary, validate_unary_method};
    use crate::runtime_bridge::RuntimeBridgeUnaryPayload;

    fn payload(method_id: &str, request_bytes_base64: &str) -> RuntimeBridgeUnaryPayload {
        RuntimeBridgeUnaryPayload {
            method_id: method_id.to_string(),
            request_bytes_base64: request_bytes_base64.to_string(),
            metadata: None,
            authorization: None,
            timeout_ms: None,
        }
    }

    #[test]
    fn validate_unary_method_rejects_unknown_method() {
        let result = validate_unary_method("/nimi.runtime.v1.RuntimeAiService/Nope");
        assert!(result
            .err()
            .unwrap_or_default()
            .contains("RUNTIME_BRIDGE_METHOD_FORBIDDEN"));
    }

    #[test]
    fn validate_unary_method_rejects_stream_method() {
        let result = validate_unary_method("/nimi.runtime.v1.RuntimeAiService/StreamGenerate");
        assert!(result
            .err()
            .unwrap_or_default()
            .contains("RUNTIME_BRIDGE_METHOD_STREAM_ONLY"));
    }

    #[test]
    fn decode_request_bytes_rejects_invalid_base64() {
        let result = decode_request_bytes(&payload(
            "/nimi.runtime.v1.RuntimeAiService/Generate",
            "!!!",
        ));
        assert!(result
            .err()
            .unwrap_or_default()
            .contains("RUNTIME_BRIDGE_REQUEST_DECODE_FAILED"));
    }

    #[tokio::test]
    async fn invoke_unary_rejects_invalid_base64_before_network() {
        let result = invoke_unary(&payload(
            "/nimi.runtime.v1.RuntimeAiService/Generate",
            "!!!",
        ))
        .await;
        assert!(result
            .err()
            .unwrap_or_default()
            .contains("RUNTIME_BRIDGE_REQUEST_DECODE_FAILED"));
    }
}
