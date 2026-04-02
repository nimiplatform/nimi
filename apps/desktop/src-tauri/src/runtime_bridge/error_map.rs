use prost::Message;
use serde::Serialize;
use serde_json::{Map, Value};
use std::collections::HashMap;
use tonic::{Code, Status};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeBridgeErrorPayload {
    pub reason_code: String,
    pub action_hint: String,
    pub trace_id: String,
    pub retryable: bool,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<Value>,
}

fn encode(payload: RuntimeBridgeErrorPayload) -> String {
    serde_json::to_string(&payload).unwrap_or_else(|_| {
        format!(
            "{{\"reasonCode\":\"{}\",\"actionHint\":\"{}\",\"traceId\":\"\",\"retryable\":{},\"message\":\"{}\"}}",
            payload.reason_code, payload.action_hint, payload.retryable, payload.message
        )
    })
}

fn normalize_reason_code(value: &str) -> String {
    let normalized = value.trim();
    if normalized.is_empty() {
        return "RUNTIME_BRIDGE_UNKNOWN".to_string();
    }
    normalized.to_ascii_uppercase()
}

fn sanitize_error_message(message: &str) -> String {
    let trimmed = message.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    let lowered = trimmed.to_ascii_lowercase();
    if lowered.contains("x-nimi-provider-api-key")
        || lowered.contains("provider_api_key")
        || lowered.contains("\"providerapikey\"")
    {
        return "[REDACTED_PROVIDER_API_KEY]".to_string();
    }
    trimmed.to_string()
}

#[derive(Debug, Clone, Default)]
struct StructuredStatusPayload {
    reason_code: String,
    action_hint: String,
    trace_id: String,
    retryable: Option<bool>,
    message: String,
    details: Option<Value>,
}

#[derive(Clone, PartialEq, ::prost::Message)]
struct GoogleRpcStatus {
    #[prost(int32, tag = "1")]
    code: i32,
    #[prost(string, tag = "2")]
    message: String,
    #[prost(message, repeated, tag = "3")]
    details: Vec<prost_types::Any>,
}

#[derive(Clone, PartialEq, ::prost::Message)]
struct GoogleRpcErrorInfo {
    #[prost(string, tag = "1")]
    reason: String,
    #[prost(string, tag = "2")]
    domain: String,
    #[prost(map = "string, string", tag = "3")]
    metadata: HashMap<String, String>,
}

fn parse_json_object(input: &str) -> Option<serde_json::Value> {
    let parsed = serde_json::from_str::<serde_json::Value>(input).ok()?;
    if parsed.is_object() {
        Some(parsed)
    } else {
        None
    }
}

fn read_string_from_candidates(candidates: &[&serde_json::Value], keys: &[&str]) -> String {
    for candidate in candidates {
        for key in keys {
            if let Some(value) = candidate.get(*key).and_then(|raw| raw.as_str()) {
                let normalized = value.trim();
                if !normalized.is_empty() {
                    return normalized.to_string();
                }
            }
        }
    }
    String::new()
}

fn read_retryable_from_candidates(candidates: &[&serde_json::Value]) -> Option<bool> {
    for candidate in candidates {
        if let Some(value) = candidate.get("retryable") {
            if let Some(flag) = value.as_bool() {
                return Some(flag);
            }
            if let Some(text) = value.as_str() {
                match text.trim().to_ascii_lowercase().as_str() {
                    "true" => return Some(true),
                    "false" => return Some(false),
                    _ => {}
                }
            }
        }
    }
    None
}

fn sanitize_json_value(value: &Value) -> Value {
    match value {
        Value::String(text) => Value::String(sanitize_error_message(text)),
        Value::Array(items) => Value::Array(items.iter().map(sanitize_json_value).collect()),
        Value::Object(object) => {
            let sanitized = object
                .iter()
                .map(|(key, value)| (key.clone(), sanitize_json_value(value)))
                .collect::<Map<String, Value>>();
            Value::Object(sanitized)
        }
        _ => value.clone(),
    }
}

fn read_details_from_candidates(candidates: &[&serde_json::Value]) -> Option<Value> {
    for candidate in candidates {
        if let Some(value) = candidate.get("details") {
            if value.is_object() {
                return Some(sanitize_json_value(value));
            }
        }
    }
    None
}

fn parse_structured_status_payload(message: &str) -> Option<StructuredStatusPayload> {
    let trimmed = message.trim();
    if trimmed.is_empty() {
        return None;
    }

    let parsed = parse_json_object(trimmed).or_else(|| {
        let start = trimmed.find('{')?;
        let end = trimmed.rfind('}')?;
        if end <= start {
            return None;
        }
        parse_json_object(&trimmed[start..=end])
    })?;

    let nested_error = parsed.get("error").filter(|value| value.is_object());
    let mut candidates: Vec<&serde_json::Value> = vec![&parsed];
    if let Some(error_payload) = nested_error {
        candidates.push(error_payload);
    }

    let reason_code =
        read_string_from_candidates(&candidates, &["reasonCode", "reason_code", "reason"]);
    let action_hint = read_string_from_candidates(&candidates, &["actionHint", "action_hint"]);
    let trace_id = read_string_from_candidates(&candidates, &["traceId", "trace_id"]);
    let retryable = read_retryable_from_candidates(&candidates);
    let details = read_details_from_candidates(&candidates);
    let normalized_message = read_string_from_candidates(&candidates, &["message"]);
    let normalized_message = if normalized_message.is_empty() {
        trimmed.to_string()
    } else {
        normalized_message
    };
    let normalized_message = sanitize_error_message(normalized_message.as_ref());

    if reason_code.is_empty()
        && action_hint.is_empty()
        && trace_id.is_empty()
        && retryable.is_none()
    {
        return None;
    }

    Some(StructuredStatusPayload {
        reason_code,
        action_hint,
        trace_id,
        retryable,
        message: normalized_message,
        details,
    })
}

fn extract_runtime_reason_code(message: &str) -> Option<String> {
    let trimmed = message.trim();
    if trimmed.is_empty() {
        return None;
    }

    if trimmed
        .chars()
        .all(|ch| ch.is_ascii_uppercase() || ch.is_ascii_digit() || ch == '_')
    {
        return Some(trimmed.to_string());
    }

    if let Some((prefix, _)) = trimmed.split_once(':') {
        let candidate = prefix.trim();
        if candidate
            .chars()
            .all(|ch| ch.is_ascii_uppercase() || ch.is_ascii_digit() || ch == '_')
        {
            return Some(candidate.to_string());
        }
    }

    None
}

fn extract_trace_id_from_status(
    status: &Status,
    structured: Option<&StructuredStatusPayload>,
) -> String {
    if let Some(value) = structured {
        if !value.trace_id.trim().is_empty() {
            return value.trace_id.trim().to_string();
        }
    }

    status
        .metadata()
        .get("x-nimi-trace-id")
        .or_else(|| status.metadata().get("trace-id"))
        .or_else(|| status.metadata().get("x-trace-id"))
        .and_then(|value| value.to_str().ok())
        .map(|value| value.trim().to_string())
        .unwrap_or_default()
}

fn extract_error_info_details(status: &Status) -> Option<Value> {
    const ERROR_INFO_TYPE_URL: &str = "type.googleapis.com/google.rpc.ErrorInfo";
    const ERROR_INFO_DOMAIN: &str = "nimi.runtime.v1";
    let details_bytes = status.details();
    if details_bytes.is_empty() {
        return None;
    }
    let decoded = GoogleRpcStatus::decode(details_bytes).ok()?;
    let mut object = Map::new();
    for detail in decoded.details {
        if detail.type_url.trim() != ERROR_INFO_TYPE_URL {
            continue;
        }
        let Ok(info) = GoogleRpcErrorInfo::decode(detail.value.as_slice()) else {
            continue;
        };
        if info.domain.trim() != ERROR_INFO_DOMAIN {
            continue;
        }
        for (key, value) in info.metadata {
            let normalized_key = key.trim();
            if normalized_key.is_empty()
                || normalized_key == "action_hint"
                || normalized_key == "trace_id"
                || normalized_key == "retryable"
            {
                continue;
            }
            let normalized_value = sanitize_error_message(value.as_str());
            if normalized_value.is_empty() {
                continue;
            }
            object.insert(normalized_key.to_string(), Value::String(normalized_value));
        }
    }
    if object.is_empty() {
        None
    } else {
        Some(Value::Object(object))
    }
}

fn merge_details(primary: Option<Value>, secondary: Option<Value>) -> Option<Value> {
    match (primary, secondary) {
        (None, None) => None,
        (Some(value), None) | (None, Some(value)) => Some(value),
        (Some(Value::Object(mut left)), Some(Value::Object(right))) => {
            for (key, value) in right {
                left.entry(key).or_insert(value);
            }
            Some(Value::Object(left))
        }
        (Some(value), Some(_)) => Some(value),
    }
}

fn grpc_code_reason_suffix(code: Code) -> &'static str {
    match code {
        Code::Ok => "OK",
        Code::Cancelled => "CANCELLED",
        Code::Unknown => "UNKNOWN",
        Code::InvalidArgument => "INVALID_ARGUMENT",
        Code::DeadlineExceeded => "DEADLINE_EXCEEDED",
        Code::NotFound => "NOT_FOUND",
        Code::AlreadyExists => "ALREADY_EXISTS",
        Code::PermissionDenied => "PERMISSION_DENIED",
        Code::ResourceExhausted => "RESOURCE_EXHAUSTED",
        Code::FailedPrecondition => "FAILED_PRECONDITION",
        Code::Aborted => "ABORTED",
        Code::OutOfRange => "OUT_OF_RANGE",
        Code::Unimplemented => "UNIMPLEMENTED",
        Code::Internal => "INTERNAL",
        Code::Unavailable => "UNAVAILABLE",
        Code::DataLoss => "DATA_LOSS",
        Code::Unauthenticated => "UNAUTHENTICATED",
    }
}

fn is_retryable_transport_cancel(
    status: &Status,
    structured: Option<&StructuredStatusPayload>,
) -> bool {
    if status.code() != Code::Cancelled {
        return false;
    }
    if let Some(value) = structured {
        if !value.reason_code.trim().is_empty() {
            return false;
        }
    }
    let lowered = sanitize_error_message(status.message()).to_ascii_lowercase();
    lowered.contains("h2 protocol error")
        || lowered.contains("http2 error")
        || lowered.contains("transport error")
}

pub fn bridge_error(code: &str, message: &str) -> String {
    encode(RuntimeBridgeErrorPayload {
        reason_code: normalize_reason_code(code),
        action_hint: "check_runtime_bridge_logs".to_string(),
        trace_id: String::new(),
        retryable: false,
        message: sanitize_error_message(message),
        details: None,
    })
}

pub fn bridge_status_error(status: Status) -> String {
    let structured = parse_structured_status_payload(status.message());
    let retryable_transport_cancel = is_retryable_transport_cancel(&status, structured.as_ref());
    let structured_reason = structured
        .as_ref()
        .map(|value| value.reason_code.trim().to_string())
        .unwrap_or_default();
    let extracted_reason = extract_runtime_reason_code(status.message()).unwrap_or_default();
    let reason_input = if !structured_reason.is_empty() {
        structured_reason
    } else if !extracted_reason.is_empty() {
        extracted_reason
    } else if status.code() == Code::Ok {
        "RUNTIME_BRIDGE_UNKNOWN".to_string()
    } else {
        String::new()
    };
    let reason_code = normalize_reason_code(reason_input.as_str());
    let fallback_reason_code = if retryable_transport_cancel {
        "RUNTIME_GRPC_UNAVAILABLE".to_string()
    } else {
        format!("RUNTIME_GRPC_{}", grpc_code_reason_suffix(status.code()))
    };
    let normalized_reason_code = if reason_code == "RUNTIME_BRIDGE_UNKNOWN" {
        fallback_reason_code
    } else {
        reason_code
    };
    let retryable_by_status = matches!(
        status.code(),
        Code::Unavailable | Code::DeadlineExceeded | Code::ResourceExhausted | Code::Aborted
    ) || retryable_transport_cancel;
    let retryable = structured
        .as_ref()
        .and_then(|value| value.retryable)
        .unwrap_or(retryable_by_status);
    let action_hint = structured
        .as_ref()
        .map(|value| value.action_hint.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| {
            if retryable {
                "retry_or_restart_runtime"
            } else {
                "check_request_and_app_auth"
            }
            .to_string()
        });
    let trace_id = extract_trace_id_from_status(&status, structured.as_ref());
    let details = merge_details(
        structured.as_ref().and_then(|value| value.details.clone()),
        extract_error_info_details(&status),
    );
    let message = structured
        .as_ref()
        .map(|value| value.message.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| sanitize_error_message(status.message()));

    encode(RuntimeBridgeErrorPayload {
        reason_code: normalized_reason_code,
        action_hint,
        trace_id,
        retryable,
        message,
        details,
    })
}

#[cfg(test)]
mod tests {
    use prost::Message;
    use serde_json::Value;
    use std::collections::HashMap;
    use tonic::metadata::{MetadataMap, MetadataValue};
    use tonic::{Code, Status};

    use super::{bridge_error, bridge_status_error};

    fn parse_json(value: String) -> Value {
        serde_json::from_str(value.as_str()).expect("error payload must be valid json")
    }

    #[test]
    fn bridge_error_normalizes_reason_code() {
        let payload = parse_json(bridge_error("runtime_bridge_failed", "boom"));
        assert_eq!(
            payload.get("reasonCode").and_then(Value::as_str),
            Some("RUNTIME_BRIDGE_FAILED")
        );
        assert_eq!(
            payload.get("actionHint").and_then(Value::as_str),
            Some("check_runtime_bridge_logs")
        );
        assert_eq!(
            payload.get("retryable").and_then(Value::as_bool),
            Some(false)
        );
        assert_eq!(payload.get("message").and_then(Value::as_str), Some("boom"));
    }

    #[test]
    fn bridge_status_error_uses_runtime_reason_prefix() {
        let payload = parse_json(bridge_status_error(Status::new(
            Code::Unavailable,
            "AI_PROVIDER_TIMEOUT: upstream timed out",
        )));
        assert_eq!(
            payload.get("reasonCode").and_then(Value::as_str),
            Some("AI_PROVIDER_TIMEOUT")
        );
        assert_eq!(
            payload.get("retryable").and_then(Value::as_bool),
            Some(true)
        );
        assert_eq!(
            payload.get("actionHint").and_then(Value::as_str),
            Some("retry_or_restart_runtime")
        );
    }

    #[test]
    fn bridge_status_error_preserves_structured_details() {
        let payload = parse_json(bridge_status_error(Status::new(
            Code::Unavailable,
            "{\"reasonCode\":\"AI_PROVIDER_UNAVAILABLE\",\"actionHint\":\"check_provider_endpoint_or_local_runtime_health\",\"message\":\"provider request failed\",\"details\":{\"provider_message\":\"dial tcp 127.0.0.1:8321: connect: connection refused\"}}",
        )));
        assert_eq!(
            payload.get("reasonCode").and_then(Value::as_str),
            Some("AI_PROVIDER_UNAVAILABLE")
        );
        let details = payload.get("details").and_then(Value::as_object).expect("details object");
        assert_eq!(
            details.get("provider_message").and_then(Value::as_str),
            Some("dial tcp 127.0.0.1:8321: connect: connection refused")
        );
    }

    #[test]
    fn bridge_status_error_extracts_error_info_metadata_details() {
        let rich_status = super::GoogleRpcStatus {
            code: Code::Unavailable as i32,
            message: "{\"reasonCode\":\"AI_PROVIDER_UNAVAILABLE\",\"actionHint\":\"check_provider_endpoint_or_local_runtime_health\",\"message\":\"provider request failed\"}".to_string(),
            details: vec![prost_types::Any {
                type_url: "type.googleapis.com/google.rpc.ErrorInfo".to_string(),
                value: super::GoogleRpcErrorInfo {
                    reason: "AI_PROVIDER_UNAVAILABLE".to_string(),
                    domain: "nimi.runtime.v1".to_string(),
                    metadata: HashMap::from([
                        ("provider_message".to_string(), "dial tcp 127.0.0.1:8321: connect: connection refused".to_string()),
                        ("action_hint".to_string(), "check_provider_endpoint_or_local_runtime_health".to_string()),
                    ]),
                }
                .encode_to_vec(),
            }],
        }
        .encode_to_vec();
        let payload = parse_json(bridge_status_error(Status::with_details(
            Code::Unavailable,
            "{\"reasonCode\":\"AI_PROVIDER_UNAVAILABLE\",\"actionHint\":\"check_provider_endpoint_or_local_runtime_health\",\"message\":\"provider request failed\"}",
            rich_status.into(),
        )));
        let details = payload.get("details").and_then(Value::as_object).expect("details object");
        assert_eq!(
            details.get("provider_message").and_then(Value::as_str),
            Some("dial tcp 127.0.0.1:8321: connect: connection refused")
        );
        assert!(details.get("action_hint").is_none());
    }

    #[test]
    fn bridge_status_error_falls_back_to_grpc_code() {
        let payload = parse_json(bridge_status_error(Status::new(
            Code::PermissionDenied,
            "permission denied",
        )));
        assert_eq!(
            payload.get("reasonCode").and_then(Value::as_str),
            Some("RUNTIME_GRPC_PERMISSION_DENIED")
        );
        assert_eq!(
            payload.get("retryable").and_then(Value::as_bool),
            Some(false)
        );
        assert_eq!(
            payload.get("actionHint").and_then(Value::as_str),
            Some("check_request_and_app_auth")
        );
    }

    #[test]
    fn bridge_status_error_formats_deadline_exceeded_with_underscore() {
        let payload = parse_json(bridge_status_error(Status::new(
            Code::DeadlineExceeded,
            "deadline hit",
        )));
        assert_eq!(
            payload.get("reasonCode").and_then(Value::as_str),
            Some("RUNTIME_GRPC_DEADLINE_EXCEEDED")
        );
    }

    #[test]
    fn bridge_status_error_normalizes_transport_cancel_to_retryable_unavailable() {
        let payload = parse_json(bridge_status_error(Status::new(
            Code::Cancelled,
            "h2 protocol error: http2 error",
        )));
        assert_eq!(
            payload.get("reasonCode").and_then(Value::as_str),
            Some("RUNTIME_GRPC_UNAVAILABLE")
        );
        assert_eq!(
            payload.get("retryable").and_then(Value::as_bool),
            Some(true)
        );
        assert_eq!(
            payload.get("actionHint").and_then(Value::as_str),
            Some("retry_or_restart_runtime")
        );
    }

    #[test]
    fn bridge_status_error_extracts_trace_id_from_structured_payload() {
        let payload = parse_json(bridge_status_error(Status::new(
            Code::Internal,
            "{\"reasonCode\":\"AI_PROVIDER_TIMEOUT\",\"traceId\":\"trace-structured\",\"retryable\":true}",
        )));

        assert_eq!(
            payload.get("traceId").and_then(Value::as_str),
            Some("trace-structured")
        );
        assert_eq!(
            payload.get("reasonCode").and_then(Value::as_str),
            Some("AI_PROVIDER_TIMEOUT")
        );
    }

    #[test]
    fn bridge_status_error_extracts_trace_id_from_metadata() {
        let mut metadata = MetadataMap::new();
        metadata.insert(
            "x-nimi-trace-id",
            MetadataValue::try_from("trace-metadata").expect("valid metadata"),
        );
        let status = Status::with_metadata(Code::Unavailable, "upstream unavailable", metadata);

        let payload = parse_json(bridge_status_error(status));
        assert_eq!(
            payload.get("traceId").and_then(Value::as_str),
            Some("trace-metadata")
        );
        assert_eq!(
            payload.get("reasonCode").and_then(Value::as_str),
            Some("RUNTIME_GRPC_UNAVAILABLE")
        );
    }

    #[test]
    fn bridge_status_error_redacts_provider_api_key_in_message() {
        let payload = parse_json(bridge_status_error(Status::new(
            Code::InvalidArgument,
            "{\"reasonCode\":\"AI_INPUT_INVALID\",\"message\":\"x-nimi-provider-api-key=sk-test-secret\"}",
        )));
        assert_eq!(
            payload.get("message").and_then(Value::as_str),
            Some("[REDACTED_PROVIDER_API_KEY]")
        );
    }

    #[test]
    fn bridge_status_error_accepts_reason_alias_field() {
        let payload = parse_json(bridge_status_error(Status::new(
            Code::Internal,
            "{\"reason\":\"AI_PROVIDER_INTERNAL\",\"actionHint\":\"check_provider_logs\"}",
        )));
        assert_eq!(
            payload.get("reasonCode").and_then(Value::as_str),
            Some("AI_PROVIDER_INTERNAL")
        );
        assert_eq!(
            payload.get("actionHint").and_then(Value::as_str),
            Some("check_provider_logs")
        );
    }

    #[test]
    fn bridge_status_error_reads_nested_error_payload() {
        let payload = parse_json(bridge_status_error(Status::new(
            Code::Unavailable,
            "{\"error\":{\"reasonCode\":\"AI_PROVIDER_TIMEOUT\",\"traceId\":\"trace-nested\",\"retryable\":true}}",
        )));
        assert_eq!(
            payload.get("reasonCode").and_then(Value::as_str),
            Some("AI_PROVIDER_TIMEOUT")
        );
        assert_eq!(
            payload.get("traceId").and_then(Value::as_str),
            Some("trace-nested")
        );
        assert_eq!(
            payload.get("retryable").and_then(Value::as_bool),
            Some(true)
        );
    }

    #[test]
    fn bridge_status_error_parses_string_retryable() {
        let payload = parse_json(bridge_status_error(Status::new(
            Code::PermissionDenied,
            "{\"reasonCode\":\"APP_MODE_SCOPE_FORBIDDEN\",\"retryable\":\"false\"}",
        )));
        assert_eq!(
            payload.get("reasonCode").and_then(Value::as_str),
            Some("APP_MODE_SCOPE_FORBIDDEN")
        );
        assert_eq!(
            payload.get("retryable").and_then(Value::as_bool),
            Some(false)
        );
    }
}
