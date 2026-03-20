use super::super::reason_codes::{
    normalize_local_ai_reason_code, LOCAL_AI_PROVIDER_INTERNAL_ERROR,
};
use super::super::types::{
    LocalAiDeviceProfile, LocalAiServiceArtifact, LocalAiServiceArtifactType,
    DEFAULT_LOCAL_ENDPOINT,
};

pub(super) fn normalize_non_empty(value: Option<&str>) -> Option<String> {
    value
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty())
}

pub(super) fn managed_provider_strategy(_provider: &str) -> Option<()> {
    None
}

pub(super) fn bootstrap_marker_provider(_marker: &str) -> Option<&'static str> {
    None
}

pub(super) fn parse_version_parts(version: &str) -> Option<(u32, u32)> {
    let mut iter = version
        .trim()
        .split('.')
        .map(|item| item.trim().parse::<u32>().ok());
    let major = iter.next().flatten()?;
    let minor = iter.next().flatten().unwrap_or(0);
    Some((major, minor))
}

pub(super) fn port_available(profile: &LocalAiDeviceProfile, port: u16) -> bool {
    profile
        .ports
        .iter()
        .find(|item| item.port == port)
        .map(|item| item.available)
        .unwrap_or(false)
}

fn preflight_port_hint(artifact: &LocalAiServiceArtifact) -> Option<u16> {
    artifact.preflight.iter().find_map(|rule| {
        if !rule.check.trim().eq_ignore_ascii_case("port-available") {
            return None;
        }
        rule.params
            .as_ref()
            .and_then(|value| value.get("port"))
            .and_then(|value| value.as_u64())
            .and_then(|value| u16::try_from(value).ok())
            .filter(|value| *value > 0)
    })
}

pub(super) fn default_loopback_endpoint_for_artifact(artifact: &LocalAiServiceArtifact) -> String {
    if let Some(port) = preflight_port_hint(artifact) {
        return format!("http://127.0.0.1:{port}/v1");
    }
    match artifact.engine.trim().to_ascii_lowercase().as_str() {
        "speech" => "http://127.0.0.1:8330".to_string(),
        "media" => "http://127.0.0.1:8321".to_string(),
        "sidecar" => "http://127.0.0.1:8340".to_string(),
        _ => DEFAULT_LOCAL_ENDPOINT.to_string(),
    }
}

pub(super) fn resolve_effective_endpoint(
    artifact: &LocalAiServiceArtifact,
    endpoint: Option<&str>,
) -> Option<String> {
    let explicit = normalize_non_empty(endpoint);
    if explicit.is_some() {
        return explicit;
    }
    if artifact.artifact_type == LocalAiServiceArtifactType::AttachedEndpoint {
        return None;
    }
    Some(default_loopback_endpoint_for_artifact(artifact))
}

fn is_loopback_host(host: &str) -> bool {
    host.eq_ignore_ascii_case("localhost") || host == "127.0.0.1" || host == "::1"
}

pub(super) fn is_loopback_endpoint(endpoint: &str) -> bool {
    let normalized = endpoint.trim();
    if normalized.is_empty() {
        return false;
    }
    if let Ok(url) = reqwest::Url::parse(normalized) {
        return url.host_str().map(is_loopback_host).unwrap_or(false);
    }
    false
}

pub(super) fn build_service_health_url(
    endpoint: &str,
    health_endpoint: &str,
) -> Result<String, String> {
    let endpoint = normalize_non_empty(Some(endpoint)).ok_or_else(|| {
        "LOCAL_AI_SERVICE_ENDPOINT_REQUIRED: service endpoint is missing".to_string()
    })?;
    let health_endpoint = normalize_non_empty(Some(health_endpoint)).ok_or_else(|| {
        "LOCAL_AI_SERVICE_HEALTH_ENDPOINT_REQUIRED: service health endpoint is missing".to_string()
    })?;
    if let Ok(url) = reqwest::Url::parse(health_endpoint.as_str()) {
        return Ok(url.to_string());
    }
    let mut url = reqwest::Url::parse(endpoint.as_str()).map_err(|error| {
        format!("LOCAL_AI_SERVICE_ENDPOINT_INVALID: invalid service endpoint URL: {error}")
    })?;
    if health_endpoint.starts_with('/') {
        url.set_path(health_endpoint.as_str());
        url.set_query(None);
        url.set_fragment(None);
        return Ok(url.to_string());
    }

    let joined_path = format!(
        "{}/{}",
        url.path().trim_end_matches('/'),
        health_endpoint.trim_start_matches('/')
    );
    url.set_path(joined_path.as_str());
    url.set_query(None);
    url.set_fragment(None);
    Ok(url.to_string())
}

pub(super) fn maybe_authenticate_request(
    request: reqwest::blocking::RequestBuilder,
    _service_id: &str,
) -> reqwest::blocking::RequestBuilder {
    request
}

pub(super) fn normalize_managed_error(error: String, fallback: &str) -> String {
    let reason = normalize_local_ai_reason_code(error.as_str(), fallback);
    format!("{reason}: {error}")
}

pub fn is_managed_service(_service_id: &str) -> bool {
    false
}

pub fn start_managed_service(_service_id: &str, _endpoint: &str) -> Result<Option<String>, String> {
    Ok(None)
}

pub fn stop_managed_service(_service_id: &str) -> Result<Option<String>, String> {
    Ok(None)
}

#[allow(dead_code)]
pub(super) fn provider_internal_error(error: String) -> String {
    normalize_managed_error(error, LOCAL_AI_PROVIDER_INTERNAL_ERROR)
}
