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
    let normalized = message.trim();
    let lowered = normalized.to_ascii_lowercase();
    if [
        "authorization:",
        "authorization=",
        "bearer ",
        "api_key=",
        "api-key=",
        "apikey=",
        "access_token=",
        "refresh_token=",
        "client_secret=",
        "password=",
    ]
    .iter()
    .any(|marker| lowered.contains(marker))
    {
        return "runtime error detail redacted".to_string();
    }
    if lowered.contains("c:\\users\\")
        || normalized.contains("/Users/")
        || normalized.contains("/home/")
        || normalized.contains("/root/")
    {
        return "runtime error path redacted".to_string();
    }
    normalized.chars().take(2048).collect()
}

#[derive(Debug, Clone, Default)]
struct StructuredStatusPayload {
    message: String,
}

#[derive(Debug, Clone, Default)]
struct StructuredErrorInfo {
    reason_code: String,
    action_hint: String,
    trace_id: String,
    retryable: Option<bool>,
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
        message: normalized_message,
    })
}

fn extract_trace_id_from_status(status: &Status) -> String {
    status
        .metadata()
        .get("x-nimi-trace-id")
        .or_else(|| status.metadata().get("trace-id"))
        .or_else(|| status.metadata().get("x-trace-id"))
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|value| {
            !value.is_empty() && value.len() <= 128 && !value.chars().any(char::is_control)
        })
        .map(str::to_string)
        .unwrap_or_default()
}

// @nimi-authority: rule.nimi.runtime.rpc-foundations.r005
fn extract_error_info(status: &Status) -> Option<StructuredErrorInfo> {
    const ERROR_INFO_TYPE_URL: &str = "type.googleapis.com/google.rpc.ErrorInfo";
    const ERROR_INFO_DOMAIN: &str = "nimi.runtime.v1";
    const PUBLIC_DETAIL_KEYS: [&str; 4] = [
        "capability",
        "diagnostic_stage",
        "failure_stage",
        "local_development_reason_code",
    ];
    let details_bytes = status.details();
    if details_bytes.is_empty() {
        return None;
    }
    let decoded = GoogleRpcStatus::decode(details_bytes).ok()?;
    if decoded.code != status.code() as i32 {
        return None;
    }
    let mut result: Option<StructuredErrorInfo> = None;
    for detail in decoded.details {
        if detail.type_url.trim() != ERROR_INFO_TYPE_URL {
            continue;
        }
        let info = GoogleRpcErrorInfo::decode(detail.value.as_slice()).ok()?;
        if info.domain.trim() != ERROR_INFO_DOMAIN {
            continue;
        }
        if result.is_some() || !valid_runtime_reason(info.reason.as_str()) {
            return None;
        }
        let action_hint = bounded_metadata_value(&info.metadata, "action_hint", 256)?;
        let trace_id = bounded_metadata_value(&info.metadata, "trace_id", 128)?;
        let retryable = match info.metadata.get("retryable") {
            None => None,
            Some(value) if value == "true" => Some(true),
            Some(value) if value == "false" => Some(false),
            Some(_) => return None,
        };
        let mut object = Map::new();
        for key in PUBLIC_DETAIL_KEYS {
            let Some(value) = info.metadata.get(key) else {
                continue;
            };
            let normalized = value.trim();
            if normalized.is_empty()
                || normalized != value
                || normalized.len() > 2048
                || normalized.chars().any(char::is_control)
            {
                return None;
            }
            object.insert(key.to_string(), Value::String(normalized.to_string()));
        }
        result = Some(StructuredErrorInfo {
            reason_code: info.reason,
            action_hint,
            trace_id,
            retryable,
            details: (!object.is_empty()).then_some(Value::Object(object)),
        });
    }
    result
}

fn valid_runtime_reason(value: &str) -> bool {
    if value.is_empty() || value.len() > 128 {
        return false;
    }
    let mut chars = value.chars();
    matches!(chars.next(), Some(first) if first.is_ascii_uppercase())
        && chars.all(|ch| ch.is_ascii_uppercase() || ch.is_ascii_digit() || ch == '_')
}

fn bounded_metadata_value(
    metadata: &HashMap<String, String>,
    key: &str,
    max_len: usize,
) -> Option<String> {
    let Some(value) = metadata.get(key) else {
        return Some(String::new());
    };
    let normalized = value.trim();
    if normalized.is_empty()
        || normalized != value
        || normalized.len() > max_len
        || normalized.chars().any(char::is_control)
    {
        return None;
    }
    Some(normalized.to_string())
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

fn is_retryable_transport_cancel(status: &Status, has_owner_reason: bool) -> bool {
    if status.code() != Code::Cancelled || has_owner_reason {
        return false;
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
    let status_payload = parse_structured_status_payload(status.message());
    let error_info = extract_error_info(&status);
    let retryable_transport_cancel = is_retryable_transport_cancel(&status, error_info.is_some());
    let status_message = sanitize_error_message(status.message());
    let retryable_unknown_transport = status.code() == Code::Unknown
        && status_message
            .to_ascii_lowercase()
            .contains("transport error");
    let fallback_reason_code = if retryable_transport_cancel || retryable_unknown_transport {
        "RUNTIME_GRPC_UNAVAILABLE".to_string()
    } else {
        format!("RUNTIME_GRPC_{}", grpc_code_reason_suffix(status.code()))
    };
    let reason_code = error_info
        .as_ref()
        .map(|value| value.reason_code.clone())
        .unwrap_or(fallback_reason_code);
    let retryable_by_status = matches!(
        status.code(),
        Code::Unavailable | Code::DeadlineExceeded | Code::ResourceExhausted | Code::Aborted
    ) || retryable_transport_cancel
        || retryable_unknown_transport;
    let retryable = error_info
        .as_ref()
        .and_then(|value| value.retryable)
        .unwrap_or(retryable_by_status);
    let action_hint = error_info
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
    let trace_id = error_info
        .as_ref()
        .map(|value| value.trace_id.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| extract_trace_id_from_status(&status));
    let details = error_info.and_then(|value| value.details);
    let message = status_payload
        .as_ref()
        .map(|value| value.message.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or(status_message);

    encode(RuntimeBridgeErrorPayload {
        reason_code,
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
    fn bridge_status_error_does_not_infer_reason_from_message_prefix() {
        let payload = parse_json(bridge_status_error(Status::new(
            Code::Unavailable,
            "AI_PROVIDER_TIMEOUT: upstream timed out",
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
    fn bridge_status_error_does_not_trust_message_details() {
        let payload = parse_json(bridge_status_error(Status::new(
            Code::Unavailable,
            "{\"reasonCode\":\"AI_PROVIDER_UNAVAILABLE\",\"actionHint\":\"check_provider_endpoint_or_local_runtime_health\",\"message\":\"provider request failed\",\"details\":{\"provider_message\":\"dial tcp 127.0.0.1:8321: connect: connection refused\",\"operation\":\"scenario_job\"}}",
        )));
        assert_eq!(
            payload.get("reasonCode").and_then(Value::as_str),
            Some("RUNTIME_GRPC_UNAVAILABLE")
        );
        assert!(payload.get("details").is_none());
        assert_eq!(
            payload.get("message").and_then(Value::as_str),
            Some("provider request failed")
        );
    }

    #[test]
    fn bridge_status_error_prioritizes_error_info_and_drops_provider_payload() {
        let rich_status = super::GoogleRpcStatus {
            code: Code::Unavailable as i32,
            message: "{\"reasonCode\":\"AI_INPUT_INVALID\",\"actionHint\":\"trust_status_text\",\"message\":\"provider request failed\"}".to_string(),
            details: vec![prost_types::Any {
                type_url: "type.googleapis.com/google.rpc.ErrorInfo".to_string(),
                value: super::GoogleRpcErrorInfo {
                    reason: "AI_PROVIDER_UNAVAILABLE".to_string(),
                    domain: "nimi.runtime.v1".to_string(),
                    metadata: HashMap::from([
                        ("provider_message".to_string(), "Authorization: Bearer provider-secret".to_string()),
                        ("action_hint".to_string(), "check_provider_endpoint".to_string()),
                        ("trace_id".to_string(), "trace-error-info".to_string()),
                        ("retryable".to_string(), "true".to_string()),
                        ("diagnostic_stage".to_string(), "provider_dispatch".to_string()),
                    ]),
                }
                .encode_to_vec(),
            }],
        }
        .encode_to_vec();
        let payload = parse_json(bridge_status_error(Status::with_details(
            Code::Unavailable,
            "{\"reasonCode\":\"AI_INPUT_INVALID\",\"actionHint\":\"trust_status_text\",\"message\":\"provider request failed\"}",
            rich_status.into(),
        )));
        assert_eq!(
            payload.get("reasonCode").and_then(Value::as_str),
            Some("AI_PROVIDER_UNAVAILABLE")
        );
        assert_eq!(
            payload.get("actionHint").and_then(Value::as_str),
            Some("check_provider_endpoint")
        );
        assert_eq!(
            payload.get("traceId").and_then(Value::as_str),
            Some("trace-error-info")
        );
        assert_eq!(
            payload.get("retryable").and_then(Value::as_bool),
            Some(true)
        );
        let details = payload
            .get("details")
            .and_then(Value::as_object)
            .expect("details object");
        assert_eq!(
            details.get("diagnostic_stage").and_then(Value::as_str),
            Some("provider_dispatch")
        );
        assert!(details.get("provider_message").is_none());
        assert!(!payload.to_string().contains("provider-secret"));
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
    fn bridge_status_error_ignores_trace_id_from_status_text() {
        let payload = parse_json(bridge_status_error(Status::new(
            Code::Internal,
            "{\"reasonCode\":\"AI_PROVIDER_TIMEOUT\",\"traceId\":\"trace-structured\",\"retryable\":true}",
        )));

        assert_eq!(payload.get("traceId").and_then(Value::as_str), Some(""));
        assert_eq!(
            payload.get("reasonCode").and_then(Value::as_str),
            Some("RUNTIME_GRPC_INTERNAL")
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
    fn bridge_status_error_ignores_reason_alias_in_status_text() {
        let payload = parse_json(bridge_status_error(Status::new(
            Code::Internal,
            "{\"reason\":\"AI_PROVIDER_INTERNAL\",\"actionHint\":\"check_provider_logs\"}",
        )));
        assert_eq!(
            payload.get("reasonCode").and_then(Value::as_str),
            Some("RUNTIME_GRPC_INTERNAL")
        );
        assert_eq!(
            payload.get("actionHint").and_then(Value::as_str),
            Some("check_request_and_app_auth")
        );
    }

    #[test]
    fn bridge_status_error_ignores_nested_machine_fields_in_status_text() {
        let payload = parse_json(bridge_status_error(Status::new(
            Code::Unavailable,
            "{\"error\":{\"reasonCode\":\"AI_PROVIDER_TIMEOUT\",\"traceId\":\"trace-nested\",\"retryable\":true}}",
        )));
        assert_eq!(
            payload.get("reasonCode").and_then(Value::as_str),
            Some("RUNTIME_GRPC_UNAVAILABLE")
        );
        assert_eq!(payload.get("traceId").and_then(Value::as_str), Some(""));
        assert_eq!(
            payload.get("retryable").and_then(Value::as_bool),
            Some(true)
        );
    }

    #[test]
    fn bridge_status_error_ignores_retryable_in_status_text() {
        let payload = parse_json(bridge_status_error(Status::new(
            Code::PermissionDenied,
            "{\"reasonCode\":\"APP_MODE_SCOPE_FORBIDDEN\",\"retryable\":\"false\"}",
        )));
        assert_eq!(
            payload.get("reasonCode").and_then(Value::as_str),
            Some("RUNTIME_GRPC_PERMISSION_DENIED")
        );
        assert_eq!(
            payload.get("retryable").and_then(Value::as_bool),
            Some(false)
        );
    }
}
