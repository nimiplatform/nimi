use serde::Serialize;
use tonic::{Code, Status};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeBridgeErrorPayload {
    pub reason_code: String,
    pub action_hint: String,
    pub trace_id: String,
    pub retryable: bool,
    pub message: String,
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
}

fn parse_json_object(input: &str) -> Option<serde_json::Value> {
    let parsed = serde_json::from_str::<serde_json::Value>(input).ok()?;
    if parsed.is_object() {
        Some(parsed)
    } else {
        None
    }
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

    let reason_code = parsed
        .get("reasonCode")
        .or_else(|| parsed.get("reason_code"))
        .and_then(|value| value.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    let action_hint = parsed
        .get("actionHint")
        .or_else(|| parsed.get("action_hint"))
        .and_then(|value| value.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    let trace_id = parsed
        .get("traceId")
        .or_else(|| parsed.get("trace_id"))
        .and_then(|value| value.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    let retryable = parsed.get("retryable").and_then(|value| value.as_bool());
    let normalized_message = parsed
        .get("message")
        .and_then(|value| value.as_str())
        .unwrap_or(trimmed)
        .trim();
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
        .and_then(|value| value.to_str().ok())
        .map(|value| value.trim().to_string())
        .unwrap_or_default()
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

pub fn bridge_error(code: &str, message: &str) -> String {
    encode(RuntimeBridgeErrorPayload {
        reason_code: normalize_reason_code(code),
        action_hint: "check_runtime_bridge_logs".to_string(),
        trace_id: String::new(),
        retryable: false,
        message: message.trim().to_string(),
    })
}

pub fn bridge_status_error(status: Status) -> String {
    let structured = parse_structured_status_payload(status.message());
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
    let fallback_reason_code = format!("RUNTIME_GRPC_{}", grpc_code_reason_suffix(status.code()));
    let normalized_reason_code = if reason_code == "RUNTIME_BRIDGE_UNKNOWN" {
        fallback_reason_code
    } else {
        reason_code
    };
    let retryable_by_status = matches!(
        status.code(),
        Code::Unavailable | Code::DeadlineExceeded | Code::ResourceExhausted | Code::Aborted
    );
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
    })
}

#[cfg(test)]
mod tests {
    use serde_json::Value;
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
}
