use std::net::IpAddr;

use url::Url;

use super::super::types::{normalize_non_empty, DEFAULT_LOCAL_ENDPOINT};

const SUPPORTED_CAPABILITIES: [&str; 10] = [
    "chat",
    "image",
    "image.generate",
    "video",
    "video.generate",
    "tts",
    "audio.synthesize",
    "stt",
    "audio.transcribe",
    "embedding",
];

pub(super) const MODEL_MANIFEST_FILE_NAME: &str = "model.manifest.json";
pub(super) const ARTIFACT_MANIFEST_FILE_NAME: &str = "artifact.manifest.json";

pub(super) fn err(code: &str, message: impl AsRef<str>) -> String {
    format!("{code}: {}", message.as_ref())
}

pub(super) fn normalize_manifest_hash(value: &str) -> String {
    value
        .trim()
        .to_ascii_lowercase()
        .trim_start_matches("sha256:")
        .to_string()
}

pub(crate) fn normalize_and_validate_capabilities(
    capabilities: &[String],
) -> Result<Vec<String>, String> {
    let mut output = Vec::<String>::new();
    for raw in capabilities {
        let normalized = raw.trim().to_ascii_lowercase();
        if normalized.is_empty() {
            continue;
        }
        if !SUPPORTED_CAPABILITIES.contains(&normalized.as_str()) {
            return Err(err(
                "LOCAL_AI_MODEL_CAPABILITY_INVALID",
                format!(
                    "capability 不受支持: {normalized}，仅允许 {}",
                    SUPPORTED_CAPABILITIES.join(", ")
                ),
            ));
        }
        if !output.iter().any(|item| item == &normalized) {
            output.push(normalized);
        }
    }

    if output.is_empty() {
        return Err(err(
            "LOCAL_AI_MODEL_CAPABILITY_EMPTY",
            "capabilities 不能为空",
        ));
    }

    Ok(output)
}

pub(crate) fn validate_loopback_endpoint(endpoint: &str) -> Result<String, String> {
    let normalized = normalize_non_empty(endpoint, DEFAULT_LOCAL_ENDPOINT);
    let parsed = Url::parse(normalized.as_str()).map_err(|error| {
        err(
            "LOCAL_AI_ENDPOINT_INVALID",
            format!("endpoint 不是合法 URL: {error}"),
        )
    })?;

    let scheme = parsed.scheme().to_ascii_lowercase();
    if scheme != "http" && scheme != "https" {
        return Err(err(
            "LOCAL_AI_ENDPOINT_SCHEME_INVALID",
            format!("endpoint 协议仅允许 http/https，当前为: {scheme}"),
        ));
    }

    let host = parsed.host_str().unwrap_or("").trim();
    let normalized_host = host.trim_matches(|ch| ch == '[' || ch == ']');
    if normalized_host.is_empty() {
        return Err(err("LOCAL_AI_ENDPOINT_HOST_MISSING", "endpoint 缺少 host"));
    }

    if normalized_host.eq_ignore_ascii_case("localhost") {
        return Ok(normalized);
    }

    let parsed_ip = normalized_host.parse::<IpAddr>().map_err(|_| {
        err(
            "LOCAL_AI_ENDPOINT_NOT_LOOPBACK",
            format!("endpoint host 仅允许 loopback，当前为: {host}"),
        )
    })?;

    if !parsed_ip.is_loopback() {
        return Err(err(
            "LOCAL_AI_ENDPOINT_NOT_LOOPBACK",
            format!("endpoint host 仅允许 loopback，当前为: {host}"),
        ));
    }

    Ok(normalized)
}
