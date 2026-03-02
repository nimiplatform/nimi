use std::collections::HashMap;

use super::types::LocalAiVerifiedModelDescriptor;

const VERIFIED_TEMPLATE_ID_QWEN3_TTS_VOICEDESIGN: &str = "verified.qwen3-tts-12hz-1.7b-voicedesign";

fn qwen3_tts_voicedesign_files() -> Vec<String> {
    vec![
        "config.json",
        "generation_config.json",
        "merges.txt",
        "model.safetensors",
        "preprocessor_config.json",
        "tokenizer_config.json",
        "vocab.json",
        "speech_tokenizer/config.json",
        "speech_tokenizer/configuration.json",
        "speech_tokenizer/model.safetensors",
        "speech_tokenizer/preprocessor_config.json",
    ]
    .into_iter()
    .map(|item| item.to_string())
    .collect::<Vec<_>>()
}

fn qwen3_tts_voicedesign_hashes() -> HashMap<String, String> {
    HashMap::from([
        (
            "config.json".to_string(),
            "sha256:aecd2cc4c1fe9edef1cb7ca7c401685a43879ad43f3f9e883f1c6760b61731e0".to_string(),
        ),
        (
            "generation_config.json".to_string(),
            "sha256:f1b90b4513f3b34c62851049e2492d7b4c5940daf1276f89c82b8ef04127f3aa"
                .to_string(),
        ),
        (
            "merges.txt".to_string(),
            "sha256:599bab54075088774b1733fde865d5bd747cbcc7a547c5bc12610e874e26f5e3"
                .to_string(),
        ),
        (
            "model.safetensors".to_string(),
            "sha256:391e8db219f292c515297cdceeb43e4eae67cdde35fa57e79a6a8a532fca0522"
                .to_string(),
        ),
        (
            "preprocessor_config.json".to_string(),
            "sha256:efdde1022ea9d76928bf7a9cd53139138f5ba2e466e837f08f6105ab1af1c119"
                .to_string(),
        ),
        (
            "tokenizer_config.json".to_string(),
            "sha256:dc3c31c3bdaedd5016382bb3cbe07323026775ad51f5a4fb564505992ae4a670"
                .to_string(),
        ),
        (
            "vocab.json".to_string(),
            "sha256:ca10d7e9fb3ed18575dd1e277a2579c16d108e32f27439684afa0e10b1440910"
                .to_string(),
        ),
        (
            "speech_tokenizer/config.json".to_string(),
            "sha256:ee65bb901c876664ab8707c487157aa1a6ee57c65969b28fb5ec9dc211e68167"
                .to_string(),
        ),
        (
            "speech_tokenizer/configuration.json".to_string(),
            "sha256:6bc26d64eb5024b4d1dab5a52371958b429256d6c9d59787f1f5294a54e0cebd"
                .to_string(),
        ),
        (
            "speech_tokenizer/model.safetensors".to_string(),
            "sha256:836b7b357f5ea43e889936a3709af68dfe3751881acefe4ecf0dbd30ba571258"
                .to_string(),
        ),
        (
            "speech_tokenizer/preprocessor_config.json".to_string(),
            "sha256:fcb3805e597e786d4067706e602f6688524640f8d3396790e2e09b5942fcbdfb"
                .to_string(),
        ),
    ])
}

fn qwen3_tts_voicedesign_descriptor() -> LocalAiVerifiedModelDescriptor {
    let files = qwen3_tts_voicedesign_files();
    LocalAiVerifiedModelDescriptor {
        template_id: VERIFIED_TEMPLATE_ID_QWEN3_TTS_VOICEDESIGN.to_string(),
        title: "Qwen3-TTS-12Hz-1.7B-VoiceDesign".to_string(),
        description:
            "Qwen VoiceDesign local TTS model for LocalAI managed runtime.".to_string(),
        install_kind: "verified-hf-multi-file".to_string(),
        model_id: "Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign".to_string(),
        repo: "Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign".to_string(),
        revision: "main".to_string(),
        capabilities: vec!["tts".to_string()],
        engine: "localai".to_string(),
        entry: "model.safetensors".to_string(),
        files: files.clone(),
        license: "apache-2.0".to_string(),
        hashes: qwen3_tts_voicedesign_hashes(),
        endpoint: "http://127.0.0.1:1234/v1".to_string(),
        file_count: files.len(),
        total_size_bytes: Some(4_520_159_099),
        tags: vec![
            "tts".to_string(),
            "voice-design".to_string(),
            "verified".to_string(),
            "localai".to_string(),
        ],
    }
}

pub fn verified_model_list() -> Vec<LocalAiVerifiedModelDescriptor> {
    vec![qwen3_tts_voicedesign_descriptor()]
}

pub fn find_verified_model(template_id: &str) -> Option<LocalAiVerifiedModelDescriptor> {
    let normalized = template_id.trim();
    if normalized.is_empty() {
        return None;
    }
    verified_model_list()
        .into_iter()
        .find(|item| item.template_id == normalized)
}

#[cfg(test)]
mod tests {
    use super::{find_verified_model, verified_model_list, VERIFIED_TEMPLATE_ID_QWEN3_TTS_VOICEDESIGN};

    #[test]
    fn verified_model_registry_contains_qwen_voice_design() {
        let rows = verified_model_list();
        assert!(!rows.is_empty());
        assert!(rows.iter().any(|item| item.template_id == VERIFIED_TEMPLATE_ID_QWEN3_TTS_VOICEDESIGN));
    }

    #[test]
    fn find_verified_model_returns_descriptor_by_template_id() {
        let found = find_verified_model(VERIFIED_TEMPLATE_ID_QWEN3_TTS_VOICEDESIGN);
        assert!(found.is_some());
        let descriptor = found.expect("descriptor");
        assert_eq!(descriptor.engine, "localai");
        assert_eq!(descriptor.capabilities, vec!["tts".to_string()]);
        assert!(descriptor.files.contains(&"model.safetensors".to_string()));
        assert_eq!(descriptor.file_count, descriptor.files.len());
    }
}
