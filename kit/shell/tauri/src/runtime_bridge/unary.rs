use base64::Engine;
use prost::Message;
use serde::Serialize;
use std::collections::HashMap;
use tonic::client::Grpc;

use super::channel_pool;
use super::codec::RawBytesCodec;
use super::error_map::bridge_error;
use super::error_map::bridge_status_error;
use super::metadata;
use super::RuntimeBridgeUnaryPayload;

const EXECUTE_SCENARIO_METHOD_ID: &str = "/nimi.runtime.v1.RuntimeAiService/ExecuteScenario";
const TEXT_GENERATE_ROUTE_DESCRIBE_EXTENSION_NAMESPACE: &str =
    "nimi.scenario.text_generate.route_describe";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeBridgeUnaryResult {
    pub response_bytes_base64: String,
    pub response_metadata: Option<HashMap<String, String>>,
}

pub fn build_unary_payload<Request>(
    method_id: &str,
    request: Request,
    timeout_ms: Option<u64>,
) -> RuntimeBridgeUnaryPayload
where
    Request: Message,
{
    RuntimeBridgeUnaryPayload {
        method_id: method_id.to_string(),
        request_bytes_base64: base64::engine::general_purpose::STANDARD
            .encode(request.encode_to_vec()),
        metadata: None,
        authorization: None,
        protected_access_token: None,
        app_session: None,
        timeout_ms,
    }
}

pub fn build_unary_payload_with_metadata<Request>(
    method_id: &str,
    request: Request,
    metadata: super::RuntimeBridgeMetadata,
    timeout_ms: Option<u64>,
) -> RuntimeBridgeUnaryPayload
where
    Request: Message,
{
    RuntimeBridgeUnaryPayload {
        metadata: Some(metadata),
        ..build_unary_payload(method_id, request, timeout_ms)
    }
}

pub fn decode_unary_result<Response>(
    method_id: &str,
    result: &RuntimeBridgeUnaryResult,
) -> Result<Response, String>
where
    Response: Message + Default,
{
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(result.response_bytes_base64.trim())
        .map_err(|_| format!("{method_id} response could not be decoded"))?;
    Response::decode(bytes.as_slice())
        .map_err(|error| format!("{method_id} response was invalid: {error}"))
}

pub async fn invoke_unary_typed<Request, Response>(
    method_id: &str,
    request: Request,
    timeout_ms: Option<u64>,
) -> Result<Response, String>
where
    Request: Message,
    Response: Message + Default,
{
    let payload = build_unary_payload(method_id, request, timeout_ms);
    let result = super::runtime_bridge_unary(payload).await?;
    decode_unary_result(method_id, &result)
}

pub async fn invoke_unary_typed_with_metadata<Request, Response>(
    method_id: &str,
    request: Request,
    metadata: super::RuntimeBridgeMetadata,
    timeout_ms: Option<u64>,
) -> Result<Response, String>
where
    Request: Message,
    Response: Message + Default,
{
    let payload = build_unary_payload_with_metadata(method_id, request, metadata, timeout_ms);
    let result = super::runtime_bridge_unary(payload).await?;
    decode_unary_result(method_id, &result)
}

fn extract_response_metadata(
    response: &tonic::Response<Vec<u8>>,
) -> Option<HashMap<String, String>> {
    let keys = [
        "x-nimi-runtime-version",
        "x-nimi-voice-catalog-source",
        "x-nimi-voice-catalog-version",
        "x-nimi-voice-count",
        "x-nimi-route-describe-result",
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

fn runtime_bridge_debug_enabled() -> bool {
    std::env::var("NIMI_RUNTIME_BRIDGE_DEBUG").ok().as_deref() == Some("1")
}

fn response_metadata_keys(response: &tonic::Response<Vec<u8>>) -> Vec<String> {
    response
        .metadata()
        .keys()
        .map(|key| match key {
            tonic::metadata::KeyRef::Ascii(name) => name.as_str().to_string(),
            tonic::metadata::KeyRef::Binary(name) => name.as_str().to_string(),
        })
        .collect()
}

fn debug_log_execute_scenario_route_describe_request(method_id: &str, request_bytes: &[u8]) {
    if !runtime_bridge_debug_enabled() || method_id.trim() != EXECUTE_SCENARIO_METHOD_ID {
        return;
    }
    match super::generated::ExecuteScenarioRequest::decode(request_bytes) {
        Ok(request) => {
            let has_route_describe_probe = request.extensions.iter().any(|extension| {
                extension.namespace.trim() == TEXT_GENERATE_ROUTE_DESCRIBE_EXTENSION_NAMESPACE
            });
            eprintln!(
                "runtime_bridge_debug method=ExecuteScenario extension_count={} has_text_generate_route_describe={}",
                request.extensions.len(),
                has_route_describe_probe,
            );
        }
        Err(error) => {
            eprintln!(
                "runtime_bridge_debug method=ExecuteScenario request_decode_error={}",
                error
            );
        }
    }
}

fn debug_log_unary_response_metadata(method_id: &str, response: &tonic::Response<Vec<u8>>) {
    if !runtime_bridge_debug_enabled() || method_id.trim() != EXECUTE_SCENARIO_METHOD_ID {
        return;
    }
    let keys = response_metadata_keys(response);
    let has_route_describe_header = response
        .metadata()
        .contains_key(route_describe_response_header_key());
    eprintln!(
        "runtime_bridge_debug method=ExecuteScenario response_metadata_keys={} has_route_describe_header={}",
        keys.join(","),
        has_route_describe_header,
    );
}

fn debug_log_unary_status_error(method_id: &str, status: &tonic::Status) {
    if !runtime_bridge_debug_enabled() || method_id.trim() != EXECUTE_SCENARIO_METHOD_ID {
        return;
    }
    eprintln!(
        "runtime_bridge_debug method=ExecuteScenario status_error_code={:?} status_error_message={}",
        status.code(),
        status.message()
    );
}

fn route_describe_response_header_key() -> &'static str {
    "x-nimi-route-describe-result"
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
    debug_log_execute_scenario_route_describe_request(payload.method_id.as_str(), &request_bytes);
    let path = tonic::codegen::http::uri::PathAndQuery::from_maybe_shared(
        payload.method_id.trim().to_string(),
    )
    .map_err(|_| bridge_error("RUNTIME_BRIDGE_METHOD_INVALID", payload.method_id.as_str()))?;
    let channel =
        channel_pool::shared_unary_channel(super::daemon_manager::grpc_addr().as_str()).await?;
    let mut grpc = Grpc::new(channel);

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
        .unary(request, path, RawBytesCodec)
        .await
        .map_err(|status| {
            debug_log_unary_status_error(payload.method_id.as_str(), &status);
            bridge_status_error(status)
        })?;
    debug_log_unary_response_metadata(payload.method_id.as_str(), &response);
    let response_metadata = extract_response_metadata(&response);
    Ok(RuntimeBridgeUnaryResult {
        response_bytes_base64: base64::engine::general_purpose::STANDARD
            .encode(response.into_inner()),
        response_metadata,
    })
}

#[cfg(test)]
mod tests {
    use base64::Engine;
    use prost::Message;

    use super::{
        build_unary_payload, build_unary_payload_with_metadata, decode_request_bytes,
        decode_unary_result, invoke_unary, validate_unary_method, RuntimeBridgeUnaryResult,
    };
    use crate::runtime_bridge::{generated, RuntimeBridgeMetadata, RuntimeBridgeUnaryPayload};

    fn payload(method_id: &str, request_bytes_base64: &str) -> RuntimeBridgeUnaryPayload {
        RuntimeBridgeUnaryPayload {
            method_id: method_id.to_string(),
            request_bytes_base64: request_bytes_base64.to_string(),
            metadata: None,
            authorization: None,
            protected_access_token: None,
            app_session: None,
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
        let result = validate_unary_method("/nimi.runtime.v1.RuntimeAiService/StreamScenario");
        assert!(result
            .err()
            .unwrap_or_default()
            .contains("RUNTIME_BRIDGE_METHOD_STREAM_ONLY"));
    }

    #[test]
    fn decode_request_bytes_rejects_invalid_base64() {
        let result = decode_request_bytes(&payload(
            "/nimi.runtime.v1.RuntimeAiService/ExecuteScenario",
            "!!!",
        ));
        assert!(result
            .err()
            .unwrap_or_default()
            .contains("RUNTIME_BRIDGE_REQUEST_DECODE_FAILED"));
    }

    #[test]
    fn extract_response_metadata_keeps_route_describe_header() {
        let mut response = tonic::Response::new(Vec::<u8>::new());
        response.metadata_mut().insert(
            "x-nimi-route-describe-result",
            tonic::metadata::MetadataValue::try_from("route-payload").expect("metadata value"),
        );
        let extracted = super::extract_response_metadata(&response).expect("response metadata");
        assert_eq!(
            extracted
                .get("x-nimi-route-describe-result")
                .map(String::as_str),
            Some("route-payload")
        );
    }

    #[test]
    fn unary_typed_helpers_round_trip_generated_messages() {
        let request = generated::GetAccountSessionStatusRequest { caller: None };
        let payload = build_unary_payload(
            "/nimi.runtime.v1.RuntimeAccountService/GetAccountSessionStatus",
            request,
            Some(42),
        );
        assert_eq!(
            payload.method_id,
            "/nimi.runtime.v1.RuntimeAccountService/GetAccountSessionStatus"
        );
        assert_eq!(payload.timeout_ms, Some(42));
        assert_eq!(
            payload.request_bytes_base64.trim(),
            "",
            "protobuf default requests encode to an empty payload"
        );

        let response = generated::GetAccountSessionStatusResponse {
            state: generated::AccountSessionState::Authenticated as i32,
            reason_code: generated::ReasonCode::ActionExecuted as i32,
            ..Default::default()
        };
        let result = RuntimeBridgeUnaryResult {
            response_bytes_base64: base64::engine::general_purpose::STANDARD
                .encode(response.encode_to_vec()),
            response_metadata: None,
        };
        let decoded: generated::GetAccountSessionStatusResponse = decode_unary_result(
            "/nimi.runtime.v1.RuntimeAccountService/GetAccountSessionStatus",
            &result,
        )
        .expect("decode response");
        assert_eq!(
            decoded.state,
            generated::AccountSessionState::Authenticated as i32
        );
    }

    #[test]
    fn unary_payload_helper_preserves_explicit_metadata() {
        let payload = build_unary_payload_with_metadata(
            "/nimi.runtime.v1.RuntimeAppService/GetAppStorage",
            generated::GetAppStorageRequest {
                app_id: "nimi.avatar".to_string(),
            },
            RuntimeBridgeMetadata {
                app_id: Some("nimi.desktop".to_string()),
                caller_kind: Some("desktop-core".to_string()),
                caller_id: Some("desktop.avatar-handoff".to_string()),
                surface_id: Some("desktop.avatar".to_string()),
                ..Default::default()
            },
            Some(5_000),
        );
        let metadata = payload.metadata.expect("metadata");
        assert_eq!(metadata.app_id.as_deref(), Some("nimi.desktop"));
        assert_eq!(
            metadata.caller_id.as_deref(),
            Some("desktop.avatar-handoff")
        );
        assert_eq!(payload.timeout_ms, Some(5_000));
    }

    #[tokio::test]
    async fn invoke_unary_rejects_invalid_base64_before_network() {
        let result = invoke_unary(&payload(
            "/nimi.runtime.v1.RuntimeAiService/ExecuteScenario",
            "!!!",
        ))
        .await;
        assert!(result
            .err()
            .unwrap_or_default()
            .contains("RUNTIME_BRIDGE_REQUEST_DECODE_FAILED"));
    }
}
