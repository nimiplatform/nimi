use std::collections::HashMap;

use serde_json::json;

use super::types::LocalAiVerifiedModelDescriptor;

const VERIFIED_TEMPLATE_ID_Z_IMAGE_TURBO: &str = "verified.image.z_image_turbo";
const VERIFIED_TEMPLATE_ID_QWEN3_TTS_VOICEDESIGN: &str = "verified.qwen3-tts-12hz-1.7b-voicedesign";

fn z_image_turbo_hashes() -> HashMap<String, String> {
    HashMap::from([(
        "z_image_turbo-Q4_K_M.gguf".to_string(),
        "sha256:745ec270db042409fde084d6b5cfccabf214a7fe5a494edf994a391125656afd".to_string(),
    )])
}

fn z_image_turbo_descriptor() -> LocalAiVerifiedModelDescriptor {
    let files = vec!["z_image_turbo-Q4_K_M.gguf".to_string()];
    let image_engine = if std::env::consts::OS == "windows" {
        "nimi_media"
    } else {
        "localai"
    };
    let image_endpoint = if image_engine == "nimi_media" {
        "http://127.0.0.1:8321/v1"
    } else {
        "http://127.0.0.1:1234/v1"
    };
    LocalAiVerifiedModelDescriptor {
        template_id: VERIFIED_TEMPLATE_ID_Z_IMAGE_TURBO.to_string(),
        title: "Z-Image Turbo (GGUF)".to_string(),
        description: "Recommended verified local image main model for dynamic workflow assembly"
            .to_string(),
        install_kind: "download".to_string(),
        model_id: "local/z_image_turbo".to_string(),
        repo: "jayn7/Z-Image-Turbo-GGUF".to_string(),
        revision: "main".to_string(),
        capabilities: vec!["image".to_string()],
        engine: image_engine.to_string(),
        entry: "z_image_turbo-Q4_K_M.gguf".to_string(),
        files: files.clone(),
        license: "apache-2.0".to_string(),
        hashes: z_image_turbo_hashes(),
        endpoint: image_endpoint.to_string(),
        file_count: files.len(),
        total_size_bytes: Some(4_981_532_736),
        tags: vec![
            "image".to_string(),
            "verified".to_string(),
            "recommended".to_string(),
            "z-image".to_string(),
        ],
        engine_config: Some(json!({
            "backend": "stablediffusion-ggml",
            "cfg_scale": 1,
            "options": [
                "diffusion_model",
                "offload_params_to_cpu:true"
            ],
            "step": 25
        })),
    }
}

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
            "sha256:f1b90b4513f3b34c62851049e2492d7b4c5940daf1276f89c82b8ef04127f3aa".to_string(),
        ),
        (
            "merges.txt".to_string(),
            "sha256:599bab54075088774b1733fde865d5bd747cbcc7a547c5bc12610e874e26f5e3".to_string(),
        ),
        (
            "model.safetensors".to_string(),
            "sha256:391e8db219f292c515297cdceeb43e4eae67cdde35fa57e79a6a8a532fca0522".to_string(),
        ),
        (
            "preprocessor_config.json".to_string(),
            "sha256:efdde1022ea9d76928bf7a9cd53139138f5ba2e466e837f08f6105ab1af1c119".to_string(),
        ),
        (
            "tokenizer_config.json".to_string(),
            "sha256:dc3c31c3bdaedd5016382bb3cbe07323026775ad51f5a4fb564505992ae4a670".to_string(),
        ),
        (
            "vocab.json".to_string(),
            "sha256:ca10d7e9fb3ed18575dd1e277a2579c16d108e32f27439684afa0e10b1440910".to_string(),
        ),
        (
            "speech_tokenizer/config.json".to_string(),
            "sha256:ee65bb901c876664ab8707c487157aa1a6ee57c65969b28fb5ec9dc211e68167".to_string(),
        ),
        (
            "speech_tokenizer/configuration.json".to_string(),
            "sha256:6bc26d64eb5024b4d1dab5a52371958b429256d6c9d59787f1f5294a54e0cebd".to_string(),
        ),
        (
            "speech_tokenizer/model.safetensors".to_string(),
            "sha256:836b7b357f5ea43e889936a3709af68dfe3751881acefe4ecf0dbd30ba571258".to_string(),
        ),
        (
            "speech_tokenizer/preprocessor_config.json".to_string(),
            "sha256:fcb3805e597e786d4067706e602f6688524640f8d3396790e2e09b5942fcbdfb".to_string(),
        ),
    ])
}

fn qwen3_tts_voicedesign_descriptor() -> LocalAiVerifiedModelDescriptor {
    let files = qwen3_tts_voicedesign_files();
    LocalAiVerifiedModelDescriptor {
        template_id: VERIFIED_TEMPLATE_ID_QWEN3_TTS_VOICEDESIGN.to_string(),
        title: "Qwen3-TTS-12Hz-1.7B-VoiceDesign".to_string(),
        description: "Qwen VoiceDesign local TTS model for LocalAI managed runtime.".to_string(),
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
        engine_config: None,
    }
}

pub fn verified_model_list() -> Vec<LocalAiVerifiedModelDescriptor> {
    vec![
        z_image_turbo_descriptor(),
        qwen3_tts_voicedesign_descriptor(),
    ]
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
    use super::{
        find_verified_model, verified_model_list, VERIFIED_TEMPLATE_ID_QWEN3_TTS_VOICEDESIGN,
        VERIFIED_TEMPLATE_ID_Z_IMAGE_TURBO,
    };

    #[test]
    fn verified_model_registry_contains_expected_entries() {
        let rows = verified_model_list();
        assert!(!rows.is_empty());
        assert!(rows
            .iter()
            .any(|item| item.template_id == VERIFIED_TEMPLATE_ID_Z_IMAGE_TURBO));
        assert!(rows
            .iter()
            .any(|item| item.template_id == VERIFIED_TEMPLATE_ID_QWEN3_TTS_VOICEDESIGN));
    }

    #[test]
    fn find_verified_model_returns_descriptor_by_template_id() {
        let found = find_verified_model(VERIFIED_TEMPLATE_ID_Z_IMAGE_TURBO);
        assert!(found.is_some());
        let descriptor = found.expect("descriptor");
        let expected_engine = if std::env::consts::OS == "windows" {
            "nimi_media"
        } else {
            "localai"
        };
        assert_eq!(descriptor.engine, expected_engine);
        assert_eq!(descriptor.capabilities, vec!["image".to_string()]);
        assert!(descriptor
            .files
            .contains(&"z_image_turbo-Q4_K_M.gguf".to_string()));
        assert_eq!(descriptor.file_count, descriptor.files.len());
        assert!(descriptor.tags.iter().any(|tag| tag == "recommended"));
    }

    #[test]
    fn find_verified_model_returns_qwen_voice_design_by_template_id() {
        let found = find_verified_model(VERIFIED_TEMPLATE_ID_QWEN3_TTS_VOICEDESIGN);
        assert!(found.is_some());
        let descriptor = found.expect("descriptor");
        assert_eq!(descriptor.engine, "localai");
        assert_eq!(descriptor.capabilities, vec!["tts".to_string()]);
        assert!(descriptor.files.contains(&"model.safetensors".to_string()));
    }

    #[test]
    fn verified_model_has_all_required_fields_per_k_local_010() {
        for model in verified_model_list() {
            assert!(
                !model.template_id.trim().is_empty(),
                "template_id empty for {}",
                model.model_id
            );
            assert!(
                !model.title.trim().is_empty(),
                "title empty for {}",
                model.model_id
            );
            assert!(!model.model_id.trim().is_empty(), "model_id empty");
            assert!(
                !model.repo.trim().is_empty(),
                "repo empty for {}",
                model.model_id
            );
            assert!(
                !model.revision.trim().is_empty(),
                "revision empty for {}",
                model.model_id
            );
            assert!(
                !model.capabilities.is_empty(),
                "capabilities empty for {}",
                model.model_id
            );
            assert!(
                !model.engine.trim().is_empty(),
                "engine empty for {}",
                model.model_id
            );
            assert!(
                !model.entry.trim().is_empty(),
                "entry empty for {}",
                model.model_id
            );
            assert!(
                !model.files.is_empty(),
                "files empty for {}",
                model.model_id
            );
            assert!(
                !model.license.trim().is_empty(),
                "license empty for {}",
                model.model_id
            );
            assert!(
                !model.hashes.is_empty(),
                "hashes empty for {}",
                model.model_id
            );
            assert!(
                !model.endpoint.trim().is_empty(),
                "endpoint empty for {}",
                model.model_id
            );
        }
    }

    #[test]
    fn verified_model_hashes_cover_all_files() {
        for model in verified_model_list() {
            for file in &model.files {
                assert!(
                    model.hashes.contains_key(file),
                    "hash missing for file {} in model {}",
                    file,
                    model.model_id
                );
            }
        }
    }

    #[test]
    fn verified_model_entry_is_in_files_list() {
        for model in verified_model_list() {
            assert!(
                model.files.contains(&model.entry),
                "entry {} not in files list for model {}",
                model.entry,
                model.model_id
            );
        }
    }

    #[test]
    fn find_verified_model_returns_none_for_unknown_template() {
        assert!(find_verified_model("nonexistent").is_none());
    }
}
