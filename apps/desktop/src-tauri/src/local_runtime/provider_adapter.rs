use super::reason_codes::LOCAL_AI_ADAPTER_MISMATCH;
use super::types::{
    LocalAiProviderAdapterKind, LocalAiProviderHints, LocalAiProviderLocalHints,
    LocalAiProviderNexaHints,
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
    if normalized == "localai" || normalized == "nexa" {
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
    hints
        .and_then(|value| value.localai.as_ref())
        .and_then(|local| local.preferred_adapter.clone())
}

pub fn localai_backend_hint_for_capability(capability: &str) -> Option<String> {
    match normalize_capability(capability).as_str() {
        "stt" => Some("whisper.cpp".to_string()),
        "image" => Some("stablediffusion.cpp".to_string()),
        "video" => Some("video".to_string()),
        _ => None,
    }
}

pub fn localai_backend_hint_for_model(model_id: &str, capability: &str) -> Option<String> {
    let normalized = model_id.trim().to_ascii_lowercase();
    if normalized.is_empty() {
        return localai_backend_hint_for_capability(capability);
    }
    if capability.eq_ignore_ascii_case("stt")
        && (normalized.contains("whisper")
            || normalized.contains("moonshine")
            || normalized.contains("transcrib"))
    {
        return Some("whisper.cpp".to_string());
    }
    if capability.eq_ignore_ascii_case("image")
        && (normalized.contains("stable-diffusion")
            || normalized.contains("stablediffusion")
            || normalized.contains("diffusion")
            || normalized.contains("flux"))
    {
        return Some("stablediffusion.cpp".to_string());
    }
    if capability.eq_ignore_ascii_case("video")
        && (normalized.contains("ltx")
            || normalized.contains("wan")
            || normalized.contains("video"))
    {
        return Some("video-native".to_string());
    }
    localai_backend_hint_for_capability(capability)
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

pub fn probe_model_matches_capability_for_provider(
    provider: &str,
    model_id: &str,
    capability: &str,
) -> bool {
    let normalized_provider = normalize_provider(Some(provider));
    if normalized_provider == "nexa" {
        return nexa_probe_model_matches_capability(model_id, capability);
    }
    localai_probe_model_matches_capability(model_id, capability)
}

pub fn infer_backend_hint_for_provider(
    provider: &str,
    capability: &str,
    model_id: Option<&str>,
) -> Option<String> {
    let normalized_provider = normalize_provider(Some(provider));
    if normalized_provider == "nexa" {
        return None;
    }
    model_id
        .and_then(|value| localai_backend_hint_for_model(value, capability))
        .or_else(|| localai_backend_hint_for_capability(capability))
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
        });
    }

    let backend = localai_backend_hint_for_capability(capability)?;
    Some(LocalAiProviderHints {
        localai: Some(LocalAiProviderLocalHints {
            backend: Some(backend),
            preferred_adapter: Some(default_adapter_for_capability(capability)),
            whisper_variant: None,
            stablediffusion_pipeline: None,
            video_backend: None,
        }),
        nexa: None,
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
    true
}

pub fn default_policy_gate_for_provider(provider: &str) -> Option<String> {
    let normalized_provider = normalize_provider(Some(provider));
    if normalized_provider == "nexa" {
        return Some("CPU_GPU_ONLY_LICENSE_GATED_NPU".to_string());
    }
    None
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
