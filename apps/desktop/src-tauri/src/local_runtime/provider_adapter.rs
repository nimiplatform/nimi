use super::reason_codes::LOCAL_AI_ADAPTER_MISMATCH;
use super::types::{
    LocalAiProviderAdapterKind, LocalAiProviderHints, LocalAiProviderLlamaHints,
    LocalAiProviderMediaHints, LocalAiProviderSidecarHints, LocalAiProviderSpeechHints,
};

fn normalize_capability(value: &str) -> String {
    value.trim().to_ascii_lowercase()
}

pub fn normalize_provider(value: Option<&str>) -> String {
    let normalized = value
        .map(|item| item.trim().to_ascii_lowercase())
        .unwrap_or_default();
    match normalized.as_str() {
        "" => "llama".to_string(),
        other => other.to_string(),
    }
}

pub fn provider_from_engine(engine: &str) -> String {
    let normalized = engine.trim().to_ascii_lowercase();
    match normalized.as_str() {
        "" => "llama".to_string(),
        value if value.starts_with("llama") => "llama".to_string(),
        value if value.starts_with("speech") => "speech".to_string(),
        value if value.starts_with("media") => "media".to_string(),
        value if value.starts_with("sidecar") => "sidecar".to_string(),
        value => value.to_string(),
    }
}

pub fn default_adapter_for_capability(capability: &str) -> LocalAiProviderAdapterKind {
    match normalize_capability(capability).as_str() {
        "chat" | "embedding" => LocalAiProviderAdapterKind::OpenaiCompatAdapter,
        "image" | "video" => LocalAiProviderAdapterKind::MediaNativeAdapter,
        "stt"
        | "tts"
        | "audio.transcribe"
        | "audio.synthesize"
        | "voice_workflow.tts_v2v"
        | "voice_workflow.tts_t2v" => {
            LocalAiProviderAdapterKind::SpeechNativeAdapter
        }
        "music" => LocalAiProviderAdapterKind::SidecarMusicAdapter,
        _ => LocalAiProviderAdapterKind::LlamaNativeAdapter,
    }
}

pub fn default_adapter_for_provider_capability(
    provider: &str,
    capability: &str,
) -> LocalAiProviderAdapterKind {
    match normalize_provider(Some(provider)).as_str() {
        "media" => LocalAiProviderAdapterKind::MediaNativeAdapter,
        "speech" => LocalAiProviderAdapterKind::SpeechNativeAdapter,
        "sidecar" => LocalAiProviderAdapterKind::SidecarMusicAdapter,
        _ => default_adapter_for_capability(capability),
    }
}

fn hint_preferred_adapter(
    provider: &str,
    hints: Option<&LocalAiProviderHints>,
) -> Option<LocalAiProviderAdapterKind> {
    match normalize_provider(Some(provider)).as_str() {
        "media" => hints
            .and_then(|value| value.media.as_ref())
            .and_then(|media| media.preferred_adapter.clone()),
        "speech" => hints
            .and_then(|value| value.speech.as_ref())
            .and_then(|speech| speech.preferred_adapter.clone()),
        "sidecar" => hints
            .and_then(|value| value.sidecar.as_ref())
            .and_then(|sidecar| sidecar.preferred_adapter.clone()),
        _ => hints
            .and_then(|value| value.llama.as_ref())
            .and_then(|llama| llama.preferred_adapter.clone()),
    }
}

fn llama_probe_model_matches_capability(model_id: &str, capability: &str) -> bool {
    let normalized = model_id.trim().to_ascii_lowercase();
    if normalized.is_empty() {
        return false;
    }
    match capability.to_ascii_lowercase().as_str() {
        "chat" | "embedding" => true,
        "stt" | "audio.transcribe" => {
            normalized.contains("whisper") || normalized.contains("transcrib")
        }
        _ => true,
    }
}

fn media_probe_model_matches_capability(model_id: &str, capability: &str) -> bool {
    let normalized = model_id.trim().to_ascii_lowercase();
    if normalized.is_empty() {
        return false;
    }
    match capability.to_ascii_lowercase().as_str() {
        "image" => {
            normalized.contains("flux")
                || normalized.contains("image")
                || normalized.contains("diffusion")
        }
        "video" => normalized.contains("wan") || normalized.contains("video"),
        _ => false,
    }
}

fn speech_probe_model_matches_capability(model_id: &str, capability: &str) -> bool {
    let normalized = model_id.trim().to_ascii_lowercase();
    if normalized.is_empty() {
        return false;
    }
    match capability.to_ascii_lowercase().as_str() {
        "stt" | "audio.transcribe" => {
            normalized.contains("whisper")
                || normalized.contains("stt")
                || normalized.contains("transcrib")
        }
        "tts" | "audio.synthesize" | "voice_workflow.tts_v2v" | "voice_workflow.tts_t2v" => {
            normalized.contains("kokoro")
                || normalized.contains("qwen3")
                || normalized.contains("tts")
                || normalized.contains("voice")
                || normalized.contains("speech")
        }
        _ => false,
    }
}

pub fn probe_model_matches_capability_for_provider(
    provider: &str,
    model_id: &str,
    capability: &str,
) -> bool {
    match normalize_provider(Some(provider)).as_str() {
        "media" => media_probe_model_matches_capability(model_id, capability),
        "speech" => speech_probe_model_matches_capability(model_id, capability),
        _ => llama_probe_model_matches_capability(model_id, capability),
    }
}

pub fn infer_backend_hint_for_provider(
    provider: &str,
    capability: &str,
    model_id: Option<&str>,
) -> Option<String> {
    let normalized_provider = normalize_provider(Some(provider));
    let normalized_model = model_id.unwrap_or_default().trim().to_ascii_lowercase();
    match (
        normalized_provider.as_str(),
        normalize_capability(capability).as_str(),
    ) {
        ("speech", "stt") | ("speech", "audio.transcribe")
            if normalized_model.contains("whisper") =>
        {
            Some("whispercpp".to_string())
        }
        ("speech", "stt") | ("speech", "audio.transcribe")
            if normalized_model.contains("qwen3-asr") =>
        {
            Some("qwen3_asr".to_string())
        }
        ("speech", "tts")
        | ("speech", "audio.synthesize")
        | ("speech", "voice_workflow.tts_v2v")
        | ("speech", "voice_workflow.tts_t2v")
            if normalized_model.contains("kokoro") =>
        {
            Some("kokoro".to_string())
        }
        ("speech", "tts")
        | ("speech", "audio.synthesize")
        | ("speech", "voice_workflow.tts_v2v")
        | ("speech", "voice_workflow.tts_t2v")
            if normalized_model.contains("qwen3-tts") =>
        {
            Some("qwen3_tts".to_string())
        }
        ("media", "image") if normalized_model.contains("flux") => Some("sdcpp".to_string()),
        ("media", "video") if normalized_model.contains("wan") => Some("sdcpp".to_string()),
        _ => None,
    }
}

pub fn default_provider_hints_for_provider_capability(
    provider: &str,
    capability: &str,
) -> Option<LocalAiProviderHints> {
    let normalized_provider = normalize_provider(Some(provider));
    match normalized_provider.as_str() {
        "media" => Some(LocalAiProviderHints {
            llama: None,
            media: Some(LocalAiProviderMediaHints {
                backend: None,
                preferred_adapter: Some(default_adapter_for_provider_capability(
                    provider, capability,
                )),
                family: None,
                image_driver: None,
                video_driver: None,
                device: None,
                fallback_driver: None,
                fallback_reason: None,
                policy_gate: None,
            }),
            speech: None,
            sidecar: None,
            extra: None,
        }),
        "speech" => Some(LocalAiProviderHints {
            llama: None,
            media: None,
            speech: Some(LocalAiProviderSpeechHints {
                backend: None,
                preferred_adapter: Some(default_adapter_for_provider_capability(
                    provider, capability,
                )),
                family: None,
                driver: None,
                device: None,
                voice_workflow_driver: None,
                policy_gate: None,
            }),
            sidecar: None,
            extra: None,
        }),
        "sidecar" => Some(LocalAiProviderHints {
            llama: None,
            media: None,
            speech: None,
            sidecar: Some(LocalAiProviderSidecarHints {
                preferred_adapter: Some(LocalAiProviderAdapterKind::SidecarMusicAdapter),
                backend: None,
            }),
            extra: None,
        }),
        _ => Some(LocalAiProviderHints {
            llama: Some(LocalAiProviderLlamaHints {
                backend: None,
                preferred_adapter: Some(default_adapter_for_provider_capability(
                    provider, capability,
                )),
                multimodal_projector: None,
            }),
            media: None,
            speech: None,
            sidecar: None,
            extra: None,
        }),
    }
}

pub fn provider_backend_hint_from_hints(
    provider: &str,
    hints: Option<&LocalAiProviderHints>,
) -> Option<String> {
    match normalize_provider(Some(provider)).as_str() {
        "media" => hints
            .and_then(|value| value.media.as_ref())
            .and_then(|media| media.backend.clone().or_else(|| media.image_driver.clone())),
        "speech" => hints
            .and_then(|value| value.speech.as_ref())
            .and_then(|speech| speech.backend.clone().or_else(|| speech.driver.clone())),
        "sidecar" => hints
            .and_then(|value| value.sidecar.as_ref())
            .and_then(|sidecar| sidecar.backend.clone()),
        _ => hints
            .and_then(|value| value.llama.as_ref())
            .and_then(|llama| llama.backend.clone()),
    }
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
    match normalize_provider(Some(provider)).as_str() {
        "media" => {
            if current.media.is_none() {
                current.media = Some(LocalAiProviderMediaHints::default());
            }
            if let Some(media) = current.media.as_mut() {
                if media.backend.is_none() {
                    media.backend = Some(backend_value);
                }
            }
        }
        "speech" => {
            if current.speech.is_none() {
                current.speech = Some(LocalAiProviderSpeechHints::default());
            }
            if let Some(speech) = current.speech.as_mut() {
                if speech.backend.is_none() {
                    speech.backend = Some(backend_value);
                }
            }
        }
        "sidecar" => {
            if current.sidecar.is_none() {
                current.sidecar = Some(LocalAiProviderSidecarHints::default());
            }
            if let Some(sidecar) = current.sidecar.as_mut() {
                if sidecar.backend.is_none() {
                    sidecar.backend = Some(backend_value);
                }
            }
        }
        _ => {
            if current.llama.is_none() {
                current.llama = Some(LocalAiProviderLlamaHints::default());
            }
            if let Some(llama) = current.llama.as_mut() {
                if llama.backend.is_none() {
                    llama.backend = Some(backend_value);
                }
            }
        }
    }
}

pub fn adapter_supports_capability(adapter: &LocalAiProviderAdapterKind, capability: &str) -> bool {
    match normalize_capability(capability).as_str() {
        "image" | "video" => matches!(adapter, LocalAiProviderAdapterKind::MediaNativeAdapter),
        "stt"
        | "tts"
        | "audio.transcribe"
        | "audio.synthesize"
        | "voice_workflow.tts_v2v"
        | "voice_workflow.tts_t2v" => {
            matches!(adapter, LocalAiProviderAdapterKind::SpeechNativeAdapter)
        }
        "music" => matches!(adapter, LocalAiProviderAdapterKind::SidecarMusicAdapter),
        _ => matches!(
            adapter,
            LocalAiProviderAdapterKind::OpenaiCompatAdapter
                | LocalAiProviderAdapterKind::LlamaNativeAdapter
        ),
    }
}

pub fn adapter_supports_capability_for_provider(
    provider: &str,
    adapter: &LocalAiProviderAdapterKind,
    capability: &str,
) -> bool {
    let normalized_provider = normalize_provider(Some(provider));
    match normalized_provider.as_str() {
        "media" => {
            matches!(adapter, LocalAiProviderAdapterKind::MediaNativeAdapter)
                && matches!(normalize_capability(capability).as_str(), "image" | "video")
        }
        "speech" => {
            matches!(adapter, LocalAiProviderAdapterKind::SpeechNativeAdapter)
                && matches!(
                    normalize_capability(capability).as_str(),
                    "stt"
                        | "tts"
                        | "audio.transcribe"
                        | "audio.synthesize"
                        | "voice_workflow.tts_v2v"
                        | "voice_workflow.tts_t2v"
                )
        }
        "sidecar" => {
            matches!(adapter, LocalAiProviderAdapterKind::SidecarMusicAdapter)
                && normalize_capability(capability) == "music"
        }
        _ => adapter_supports_capability(adapter, capability),
    }
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
    match normalize_provider(Some(provider)).as_str() {
        "media" => matches!(normalize_capability(capability).as_str(), "image" | "video"),
        "speech" => matches!(
            normalize_capability(capability).as_str(),
            "stt"
                | "tts"
                | "audio.transcribe"
                | "audio.synthesize"
                | "voice_workflow.tts_v2v"
                | "voice_workflow.tts_t2v"
        ),
        "sidecar" => matches!(normalize_capability(capability).as_str(), "music"),
        _ => true,
    }
}

pub fn default_policy_gate_for_provider(provider: &str) -> Option<String> {
    match normalize_provider(Some(provider)).as_str() {
        "media" => Some("media.host.unsupported".to_string()),
        "speech" => Some("speech.host.unsupported".to_string()),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::{
        adapter_supports_capability_for_provider, default_provider_hints_for_provider_capability,
        infer_backend_hint_for_provider, provider_available_for_capability,
        with_provider_backend_hint,
    };
    use crate::local_runtime::types::LocalAiProviderAdapterKind;

    #[test]
    fn default_media_hints_do_not_synthesize_driver_or_family() {
        let hints =
            default_provider_hints_for_provider_capability("media", "image").expect("media hints");
        let media = hints.media.expect("media payload");
        assert!(media.backend.is_none());
        assert!(media.family.is_none());
    }

    #[test]
    fn infer_backend_hint_only_emits_runtime_known_drivers() {
        assert_eq!(
            infer_backend_hint_for_provider("media", "image", Some("flux.1-schnell")),
            Some("sdcpp".to_string())
        );
        assert_eq!(
            infer_backend_hint_for_provider("speech", "stt", Some("qwen3-asr-0.6b")),
            Some("qwen3_asr".to_string())
        );
        assert_eq!(
            infer_backend_hint_for_provider(
                "speech",
                "voice_workflow.tts_t2v",
                Some("qwen3-tts-12hz-1.7b-voicedesign")
            ),
            Some("qwen3_tts".to_string())
        );
    }

    #[test]
    fn with_provider_backend_hint_preserves_runtime_metadata_only() {
        let mut hints = default_provider_hints_for_provider_capability("speech", "tts");
        with_provider_backend_hint("speech", &mut hints, Some("qwen3_tts".to_string()), "tts");
        let speech = hints
            .and_then(|value| value.speech)
            .expect("speech payload");
        assert_eq!(speech.backend.as_deref(), Some("qwen3_tts"));
        assert!(speech.family.is_none());
    }

    #[test]
    fn speech_provider_admits_local_workflow_capabilities() {
        assert!(provider_available_for_capability(
            "speech",
            "voice_workflow.tts_t2v"
        ));
        assert!(adapter_supports_capability_for_provider(
            "speech",
            &LocalAiProviderAdapterKind::SpeechNativeAdapter,
            "voice_workflow.tts_v2v"
        ));
        assert_eq!(
            infer_backend_hint_for_provider("speech", "voice_workflow.tts_t2v", Some("qwen3-tts")),
            Some("qwen3_tts".to_string())
        );
    }
}
