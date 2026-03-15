use super::reason_codes::LOCAL_AI_ADAPTER_MISMATCH;
use super::types::{
    LocalAiProviderAdapterKind, LocalAiProviderHints, LocalAiProviderLocalHints,
    LocalAiProviderNexaHints, LocalAiProviderNimiMediaHints,
};

fn normalize_capability(value: &str) -> String {
    value.trim().to_ascii_lowercase()
}

pub fn normalize_provider(value: Option<&str>) -> String {
    let normalized = value
        .map(|item| item.trim().to_ascii_lowercase())
        .unwrap_or_default();
    if normalized.is_empty() {
        return "localai".to_string();
    }
    if normalized == "localai" || normalized == "nexa" || normalized == "nimi_media" {
        return normalized;
    }
    normalized
}

pub fn provider_from_engine(engine: &str) -> String {
    let normalized = engine.trim().to_ascii_lowercase();
    if normalized.is_empty() {
        return "localai".to_string();
    }
    if normalized.starts_with("openai") || normalized.contains("openai-compatible") {
        return "localai".to_string();
    }
    if normalized.starts_with("nexa") {
        return "nexa".to_string();
    }
    if normalized.starts_with("nimi_media") || normalized.starts_with("nimimedia") {
        return "nimi_media".to_string();
    }
    if normalized.starts_with("localai") {
        return "localai".to_string();
    }
    normalized
}

pub fn default_adapter_for_capability(capability: &str) -> LocalAiProviderAdapterKind {
    match normalize_capability(capability).as_str() {
        "chat" | "embedding" => LocalAiProviderAdapterKind::OpenaiCompatAdapter,
        "stt" | "tts" | "image" | "video" => LocalAiProviderAdapterKind::LocalaiNativeAdapter,
        _ => LocalAiProviderAdapterKind::OpenaiCompatAdapter,
    }
}

pub fn default_adapter_for_provider_capability(
    provider: &str,
    capability: &str,
) -> LocalAiProviderAdapterKind {
    let normalized_provider = normalize_provider(Some(provider));
    if normalized_provider == "nexa" {
        return LocalAiProviderAdapterKind::NexaNativeAdapter;
    }
    if normalized_provider == "nimi_media" {
        return LocalAiProviderAdapterKind::NimiMediaNativeAdapter;
    }
    default_adapter_for_capability(capability)
}

fn hint_preferred_adapter(
    provider: &str,
    hints: Option<&LocalAiProviderHints>,
) -> Option<LocalAiProviderAdapterKind> {
    let normalized_provider = normalize_provider(Some(provider));
    if normalized_provider == "nexa" {
        return hints
            .and_then(|value| value.nexa.as_ref())
            .and_then(|nexa| nexa.preferred_adapter.clone());
    }
    if normalized_provider == "nimi_media" {
        return hints
            .and_then(|value| value.nimi_media.as_ref())
            .and_then(|nimi_media| nimi_media.preferred_adapter.clone());
    }
    hints
        .and_then(|value| value.localai.as_ref())
        .and_then(|local| local.preferred_adapter.clone())
}

fn localai_probe_model_matches_capability(model_id: &str, capability: &str) -> bool {
    let normalized = model_id.trim().to_ascii_lowercase();
    if normalized.is_empty() {
        return false;
    }

    match capability.to_ascii_lowercase().as_str() {
        "chat" | "embedding" => true,
        "stt" => {
            normalized.contains("whisper")
                || normalized.contains("moonshine")
                || normalized.contains("transcrib")
                || normalized.contains("stt")
        }
        "tts" => {
            normalized.contains("tts")
                || normalized.contains("speech")
                || normalized.contains("voice")
                || normalized.contains("kokoro")
        }
        "image" => {
            normalized.contains("stable-diffusion")
                || normalized.contains("stablediffusion")
                || normalized.contains("diffusion")
                || normalized.contains("flux")
                || normalized.contains("image")
        }
        "video" => {
            normalized.contains("video") || normalized.contains("ltx") || normalized.contains("wan")
        }
        _ => false,
    }
}

fn nexa_probe_model_matches_capability(model_id: &str, capability: &str) -> bool {
    let normalized = model_id.trim().to_ascii_lowercase();
    if normalized.is_empty() {
        return false;
    }

    match capability.to_ascii_lowercase().as_str() {
        "chat" | "embedding" => true,
        "stt" => {
            normalized.contains("asr")
                || normalized.contains("stt")
                || normalized.contains("transcrib")
                || normalized.contains("audio")
        }
        "tts" => {
            normalized.contains("tts")
                || normalized.contains("speech")
                || normalized.contains("voice")
        }
        "image" => {
            normalized.contains("image")
                || normalized.contains("vision")
                || normalized.contains("diffusion")
        }
        "rerank" => {
            normalized.contains("rerank")
                || normalized.contains("rank")
                || normalized.contains("bge-reranker")
        }
        "cv" => {
            normalized.contains("cv")
                || normalized.contains("vision")
                || normalized.contains("detector")
                || normalized.contains("segment")
        }
        "diarize" => {
            normalized.contains("diar")
                || normalized.contains("speaker")
                || normalized.contains("audio")
        }
        "video" => false,
        _ => false,
    }
}

fn nimi_media_probe_model_matches_capability(model_id: &str, capability: &str) -> bool {
    let normalized = model_id.trim().to_ascii_lowercase();
    if normalized.is_empty() {
        return false;
    }

    match capability.to_ascii_lowercase().as_str() {
        "image" => normalized.contains("flux") || normalized.contains("image"),
        "video" => normalized.contains("wan") || normalized.contains("video"),
        _ => false,
    }
}

pub fn probe_model_matches_capability_for_provider(
    provider: &str,
    model_id: &str,
    capability: &str,
) -> bool {
    let normalized_provider = normalize_provider(Some(provider));
    if normalized_provider == "nexa" {
        return nexa_probe_model_matches_capability(model_id, capability);
    }
    if normalized_provider == "nimi_media" {
        return nimi_media_probe_model_matches_capability(model_id, capability);
    }
    localai_probe_model_matches_capability(model_id, capability)
}

pub fn infer_backend_hint_for_provider(
    provider: &str,
    capability: &str,
    model_id: Option<&str>,
) -> Option<String> {
    let _ = (provider, capability, model_id);
    None
}

pub fn default_provider_hints_for_provider_capability(
    provider: &str,
    capability: &str,
) -> Option<LocalAiProviderHints> {
    let normalized_provider = normalize_provider(Some(provider));
    if normalized_provider == "nexa" {
        return Some(LocalAiProviderHints {
            localai: None,
            nexa: Some(LocalAiProviderNexaHints {
                backend: None,
                preferred_adapter: Some(default_adapter_for_provider_capability(
                    normalized_provider.as_str(),
                    capability,
                )),
                plugin_id: None,
                device_id: None,
                model_type: None,
                npu_mode: None,
                policy_gate: None,
                host_npu_ready: None,
                model_probe_has_npu_candidate: None,
                policy_gate_allows_npu: None,
                npu_usable: None,
                gate_reason: None,
                gate_detail: None,
            }),
            nimi_media: None,
            extra: None,
        });
    }

    if normalized_provider == "nimi_media" {
        return Some(LocalAiProviderHints {
            localai: None,
            nexa: None,
            nimi_media: Some(LocalAiProviderNimiMediaHints {
                preferred_adapter: Some(default_adapter_for_provider_capability(
                    normalized_provider.as_str(),
                    capability,
                )),
                driver: None,
                family: None,
            }),
            extra: None,
        });
    }
    Some(LocalAiProviderHints {
        localai: Some(LocalAiProviderLocalHints {
            backend: None,
            preferred_adapter: Some(default_adapter_for_capability(capability)),
            whisper_variant: None,
            stablediffusion_pipeline: None,
            video_backend: None,
        }),
        nexa: None,
        nimi_media: None,
        extra: None,
    })
}

pub fn provider_backend_hint_from_hints(
    provider: &str,
    hints: Option<&LocalAiProviderHints>,
) -> Option<String> {
    let normalized_provider = normalize_provider(Some(provider));
    if normalized_provider == "nexa" {
        return hints
            .and_then(|value| value.nexa.as_ref())
            .and_then(|nexa| nexa.backend.clone());
    }
    if normalized_provider == "nimi_media" {
        return hints
            .and_then(|value| value.nimi_media.as_ref())
            .and_then(|nimi_media| nimi_media.driver.clone());
    }
    hints
        .and_then(|value| value.localai.as_ref())
        .and_then(|local| local.backend.clone())
}

pub fn with_provider_backend_hint(
    provider: &str,
    hints: &mut Option<LocalAiProviderHints>,
    backend: Option<String>,
    capability: &str,
) {
    let Some(backend_value) = backend else {
        return;
    };
    let backend_value = backend_value.trim().to_string();
    if backend_value.is_empty() {
        return;
    }

    if hints.is_none() {
        *hints = default_provider_hints_for_provider_capability(provider, capability);
    }
    let Some(current) = hints.as_mut() else {
        return;
    };

    let normalized_provider = normalize_provider(Some(provider));
    if normalized_provider == "nexa" {
        if current.nexa.is_none() {
            current.nexa = Some(LocalAiProviderNexaHints::default());
        }
        if let Some(nexa) = current.nexa.as_mut() {
            if nexa.backend.is_none() {
                nexa.backend = Some(backend_value);
            }
        }
        return;
    }

    if normalized_provider == "nimi_media" {
        if current.nimi_media.is_none() {
            current.nimi_media = Some(LocalAiProviderNimiMediaHints::default());
        }
        if let Some(nimi_media) = current.nimi_media.as_mut() {
            if nimi_media.driver.is_none() {
                nimi_media.driver = Some(backend_value);
            }
        }
        return;
    }

    if current.localai.is_none() {
        current.localai = Some(LocalAiProviderLocalHints::default());
    }
    if let Some(local) = current.localai.as_mut() {
        if local.backend.is_none() {
            local.backend = Some(backend_value);
        }
    }
}

pub fn adapter_supports_capability(adapter: &LocalAiProviderAdapterKind, capability: &str) -> bool {
    let normalized = normalize_capability(capability);
    if normalized == "video" {
        return matches!(adapter, LocalAiProviderAdapterKind::LocalaiNativeAdapter);
    }
    true
}

fn nimi_media_adapter_supports_capability(capability: &str) -> bool {
    matches!(normalize_capability(capability).as_str(), "image" | "video")
}

fn nexa_adapter_supports_capability(capability: &str) -> bool {
    matches!(
        normalize_capability(capability).as_str(),
        "chat" | "embedding" | "stt" | "tts" | "image" | "rerank" | "cv" | "diarize"
    )
}

pub fn adapter_supports_capability_for_provider(
    provider: &str,
    adapter: &LocalAiProviderAdapterKind,
    capability: &str,
) -> bool {
    let normalized_provider = normalize_provider(Some(provider));
    let normalized_capability = normalize_capability(capability);

    if normalized_provider == "nexa" {
        if !nexa_adapter_supports_capability(capability) {
            return false;
        }
        return matches!(adapter, LocalAiProviderAdapterKind::NexaNativeAdapter);
    }

    if normalized_provider == "nimi_media" {
        if !nimi_media_adapter_supports_capability(capability) {
            return false;
        }
        return matches!(adapter, LocalAiProviderAdapterKind::NimiMediaNativeAdapter);
    }

    if normalized_provider == "localai" {
        return match normalized_capability.as_str() {
            "chat" | "embedding" => {
                matches!(adapter, LocalAiProviderAdapterKind::OpenaiCompatAdapter)
            }
            "stt" | "tts" | "image" | "video" => {
                matches!(adapter, LocalAiProviderAdapterKind::LocalaiNativeAdapter)
            }
            _ => true,
        };
    }
    adapter_supports_capability(adapter, capability)
}

pub fn resolve_adapter_for_provider(
    provider: &str,
    capability: &str,
    hints: Option<&LocalAiProviderHints>,
    requested: Option<LocalAiProviderAdapterKind>,
) -> Result<LocalAiProviderAdapterKind, String> {
    let preferred = requested
        .or_else(|| hint_preferred_adapter(provider, hints))
        .unwrap_or_else(|| default_adapter_for_provider_capability(provider, capability));
    if adapter_supports_capability_for_provider(provider, &preferred, capability) {
        return Ok(preferred);
    }
    Err(format!(
        "{}: provider={} capability={} adapter={:?}",
        LOCAL_AI_ADAPTER_MISMATCH,
        normalize_provider(Some(provider)),
        normalize_capability(capability),
        preferred
    ))
}

pub fn provider_available_for_capability(provider: &str, capability: &str) -> bool {
    let normalized_provider = normalize_provider(Some(provider));
    if normalized_provider == "nexa" {
        return matches!(
            normalize_capability(capability).as_str(),
            "chat" | "embedding" | "stt" | "tts" | "image" | "rerank" | "cv" | "diarize"
        );
    }
    if normalized_provider == "nimi_media" {
        return matches!(normalize_capability(capability).as_str(), "image" | "video");
    }
    true
}

pub fn default_policy_gate_for_provider(provider: &str) -> Option<String> {
    let normalized_provider = normalize_provider(Some(provider));
    if normalized_provider == "nexa" {
        return Some("CPU_GPU_ONLY_LICENSE_GATED_NPU".to_string());
    }
    None
}

#[cfg(test)]
mod tests {
    use super::{
        default_provider_hints_for_provider_capability, infer_backend_hint_for_provider,
        with_provider_backend_hint,
    };

    #[test]
    fn default_nimi_media_hints_do_not_synthesize_driver_or_family() {
        let hints = default_provider_hints_for_provider_capability("nimi_media", "image")
            .expect("nimi_media hints");
        let nimi_media = hints.nimi_media.expect("nimi_media payload");
        assert!(nimi_media.driver.is_none());
        assert!(nimi_media.family.is_none());
    }

    #[test]
    fn infer_backend_hint_does_not_guess_from_provider_or_model_name() {
        assert_eq!(
            infer_backend_hint_for_provider("nimi_media", "image", Some("flux.1-schnell")),
            None
        );
        assert_eq!(
            infer_backend_hint_for_provider("localai", "stt", Some("whisper-large-v3")),
            None
        );
    }

    #[test]
    fn with_provider_backend_hint_preserves_explicit_runtime_metadata_only() {
        let mut hints = default_provider_hints_for_provider_capability("nimi_media", "image");
        with_provider_backend_hint(
            "nimi_media",
            &mut hints,
            Some("runtime-driver".to_string()),
            "image",
        );
        let nimi_media = hints
            .and_then(|value| value.nimi_media)
            .expect("nimi_media payload");
        assert_eq!(nimi_media.driver.as_deref(), Some("runtime-driver"));
        assert!(nimi_media.family.is_none());
    }
}

fn parse_bool_env(value: Option<String>) -> Option<bool> {
    let normalized = value
        .map(|item| item.trim().to_ascii_lowercase())
        .unwrap_or_default();
    if normalized.is_empty() {
        return None;
    }
    if normalized == "1" || normalized == "true" || normalized == "yes" || normalized == "on" {
        return Some(true);
    }
    if normalized == "0" || normalized == "false" || normalized == "no" || normalized == "off" {
        return Some(false);
    }
    None
}

pub fn nexa_capability_requires_npu(capability: &str) -> bool {
    matches!(
        normalize_capability(capability).as_str(),
        "rerank" | "cv" | "diarize"
    )
}

pub fn nexa_model_has_npu_candidate(model_id: &str) -> bool {
    let normalized = model_id.trim().to_ascii_lowercase();
    if normalized.is_empty() {
        return false;
    }
    normalized.contains("npu")
        || normalized.contains("qnn")
        || normalized.contains("ane")
        || normalized.contains("hexagon")
        || normalized.contains("neural")
}

pub fn nexa_policy_gate_allows_npu() -> bool {
    let explicit_gate =
        parse_bool_env(std::env::var("NIMI_LOCAL_AI_NEXA_ENABLE_NPU").ok()).unwrap_or(false);
    if !explicit_gate {
        return false;
    }
    let license_present = std::env::var("NEXA_TOKEN")
        .ok()
        .map(|value| !value.trim().is_empty())
        .unwrap_or(false)
        || std::env::var("NIMI_LOCAL_AI_NEXA_LICENSE")
            .ok()
            .map(|value| !value.trim().is_empty())
            .unwrap_or(false);
    license_present
}
