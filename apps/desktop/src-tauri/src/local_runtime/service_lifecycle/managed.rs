use super::super::types::{
    LocalAiDeviceProfile, LocalAiServiceArtifact, LocalAiServiceArtifactType,
    DEFAULT_LOCAL_ENDPOINT,
};

pub(super) fn normalize_non_empty(value: Option<&str>) -> Option<String> {
    value
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty())
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
