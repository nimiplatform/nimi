pub const LOCAL_AI_SERVICE_UNREACHABLE: &str = "LOCAL_AI_SERVICE_UNREACHABLE";
pub const LOCAL_AI_AUTH_FAILED: &str = "LOCAL_AI_AUTH_FAILED";
pub const LOCAL_AI_CAPABILITY_MISSING: &str = "LOCAL_AI_CAPABILITY_MISSING";
pub const LOCAL_AI_PROVIDER_INTERNAL_ERROR: &str = "LOCAL_AI_PROVIDER_INTERNAL_ERROR";
pub const LOCAL_AI_PROVIDER_TIMEOUT: &str = "LOCAL_AI_PROVIDER_TIMEOUT";
pub const LOCAL_AI_ADAPTER_MISMATCH: &str = "LOCAL_AI_ADAPTER_MISMATCH";

pub const LOCAL_AI_REASON_CODES: [&str; 6] = [
    LOCAL_AI_SERVICE_UNREACHABLE,
    LOCAL_AI_AUTH_FAILED,
    LOCAL_AI_CAPABILITY_MISSING,
    LOCAL_AI_PROVIDER_INTERNAL_ERROR,
    LOCAL_AI_PROVIDER_TIMEOUT,
    LOCAL_AI_ADAPTER_MISMATCH,
];

pub fn normalize_local_ai_reason_code(error: &str, fallback: &str) -> String {
    let normalized = error.trim();
    if normalized.is_empty() {
        return fallback.to_string();
    }

    let prefix = normalized
        .split(':')
        .next()
        .map(|item| item.trim())
        .unwrap_or_default();
    if LOCAL_AI_REASON_CODES.iter().any(|code| code == &prefix) {
        return prefix.to_string();
    }

    let lowered = normalized.to_ascii_lowercase();
    if lowered.contains("timeout") {
        return LOCAL_AI_PROVIDER_TIMEOUT.to_string();
    }
    if lowered.contains("401") || lowered.contains("403") || lowered.contains("auth") {
        return LOCAL_AI_AUTH_FAILED.to_string();
    }
    if lowered.contains("404") || lowered.contains("capability") || lowered.contains("missing") {
        return LOCAL_AI_CAPABILITY_MISSING.to_string();
    }
    if lowered.contains("500") || lowered.contains("502") || lowered.contains("503") {
        return LOCAL_AI_PROVIDER_INTERNAL_ERROR.to_string();
    }
    if lowered.contains("mismatch") {
        return LOCAL_AI_ADAPTER_MISMATCH.to_string();
    }
    LOCAL_AI_SERVICE_UNREACHABLE.to_string()
}

pub fn extract_reason_code(error: &str, fallback: &str) -> String {
    let candidate = error
        .split(':')
        .next()
        .map(|value| value.trim())
        .unwrap_or_default();
    if candidate.is_empty() {
        fallback.to_string()
    } else {
        candidate.to_string()
    }
}
