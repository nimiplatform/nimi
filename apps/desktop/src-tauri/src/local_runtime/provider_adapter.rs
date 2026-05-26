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
        | "voice_workflow.voice_clone"
        | "voice_workflow.voice_design" => LocalAiProviderAdapterKind::SpeechNativeAdapter,
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

#[cfg(test)]
mod tests {
    use super::default_provider_hints_for_provider_capability;

    #[test]
    fn default_media_hints_do_not_synthesize_driver_or_family() {
        let hints =
            default_provider_hints_for_provider_capability("media", "image").expect("media hints");
        let media = hints.media.expect("media payload");
        assert!(media.backend.is_none());
        assert!(media.family.is_none());
    }
}
