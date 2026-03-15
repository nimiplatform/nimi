use super::super::provider_adapter::{
    default_provider_hints_for_provider_capability, provider_from_engine,
};
use super::super::service_artifacts::find_service_artifact;
use super::super::types::{LocalAiEngineRuntimeMode, LocalAiProviderHints, DEFAULT_LOCAL_ENDPOINT};

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

pub(super) fn runtime_mode_for_engine(engine: &str) -> LocalAiEngineRuntimeMode {
    let _ = engine;
    LocalAiEngineRuntimeMode::Supervised
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
    let has_image_or_video = capabilities
        .iter()
        .any(|item| item == "image" || item == "video");

    if std::env::consts::OS == "windows" && has_image_or_video {
        return "nimi_media".to_string();
    }

    if normalized_repo.contains("nexa")
        || joined_tags.contains("nexa")
        || joined_tags.contains("npu")
        || joined_tags.contains("rerank")
        || joined_tags.contains("diarize")
        || capabilities.iter().any(|item| item == "rerank")
    {
        return "nexa".to_string();
    }

    if normalized_repo.contains("localai")
        || joined_tags.contains("localai")
        || normalized_repo.contains("whisper")
        || normalized_repo.contains("stable-diffusion")
        || capabilities.iter().any(|item| {
            item == "chat"
                || item == "embedding"
                || item == "stt"
                || item == "tts"
                || item == "image"
                || item == "video"
        })
    {
        return "localai".to_string();
    }
    "localai".to_string()
}

pub(super) fn provider_hints_for_capabilities(
    capabilities: &[String],
    engine: &str,
) -> Option<LocalAiProviderHints> {
    let provider = provider_from_engine(engine);
    for capability in capabilities {
        if let Some(hints) =
            default_provider_hints_for_provider_capability(provider.as_str(), capability.as_str())
        {
            return Some(hints);
        }
    }
    None
}
