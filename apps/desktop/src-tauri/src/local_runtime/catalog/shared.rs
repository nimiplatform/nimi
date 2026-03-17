use super::super::provider_adapter::{
    default_provider_hints_for_provider_capability, provider_from_engine,
};
use super::super::recommendation::{
    add_host_support_to_provider_hints, auto_runtime_mode_for_engine,
    install_available_for_runtime_mode,
};
use super::super::service_artifacts::find_service_artifact;
use super::super::types::{
    default_preferred_engine_for_capabilities, normalize_local_engine, LocalAiDeviceProfile,
    LocalAiEngineRuntimeMode, LocalAiProviderHints, DEFAULT_LOCAL_ENDPOINT,
};

pub(super) const HF_SEARCH_LIMIT_MIN: usize = 1;
pub(super) const HF_SEARCH_LIMIT_MAX: usize = 80;

pub(super) fn normalize_non_empty(value: Option<&str>) -> Option<String> {
    let normalized = value.unwrap_or_default().trim();
    if normalized.is_empty() {
        None
    } else {
        Some(normalized.to_string())
    }
}

pub(super) fn normalize_install_limit(value: usize) -> usize {
    value.clamp(HF_SEARCH_LIMIT_MIN, HF_SEARCH_LIMIT_MAX)
}

pub(super) fn runtime_mode_for_engine(
    engine: &str,
    profile: &LocalAiDeviceProfile,
) -> LocalAiEngineRuntimeMode {
    auto_runtime_mode_for_engine(engine, profile)
}

pub(super) fn install_available_for_engine(
    engine: &str,
    runtime_mode: &LocalAiEngineRuntimeMode,
    endpoint: Option<&str>,
    profile: &LocalAiDeviceProfile,
) -> bool {
    install_available_for_runtime_mode(engine, runtime_mode, endpoint, profile)
}

fn service_artifact_preflight_port(service_identity: &str) -> Option<u16> {
    let artifact = find_service_artifact(service_identity)?;
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

pub(super) fn default_endpoint_for_engine(engine: &str) -> String {
    let port = service_artifact_preflight_port(engine);
    if let Some(port) = port {
        return format!("http://127.0.0.1:{port}/v1");
    }
    DEFAULT_LOCAL_ENDPOINT.to_string()
}

pub(super) fn infer_engine(repo: &str, tags: &[String], capabilities: &[String]) -> String {
    let normalized_repo = repo.trim().to_ascii_lowercase();
    let joined_tags = tags.join(" ").to_ascii_lowercase();
    if normalized_repo.contains("whisper")
        || normalized_repo.contains("kokoro")
        || normalized_repo.contains("qwen3-tts")
        || joined_tags.contains("speech")
        || joined_tags.contains("audio")
        || capabilities
            .iter()
            .any(|item| item == "stt" || item == "tts" || item == "audio.transcribe" || item == "audio.synthesize")
    {
        return "speech".to_string();
    }
    if normalized_repo.contains("flux")
        || normalized_repo.contains("wan")
        || normalized_repo.contains("diffusion")
        || joined_tags.contains("image")
        || joined_tags.contains("video")
    {
        return "media".to_string();
    }
    normalize_local_engine(
        default_preferred_engine_for_capabilities(capabilities).as_str(),
        capabilities,
    )
}

pub(super) fn provider_hints_for_capabilities(
    capabilities: &[String],
    engine: &str,
    profile: &LocalAiDeviceProfile,
) -> Option<LocalAiProviderHints> {
    let provider = provider_from_engine(engine);
    for capability in capabilities {
        if let Some(hints) =
            default_provider_hints_for_provider_capability(provider.as_str(), capability.as_str())
        {
            return add_host_support_to_provider_hints(Some(hints), engine, profile);
        }
    }
    add_host_support_to_provider_hints(None, engine, profile)
}
