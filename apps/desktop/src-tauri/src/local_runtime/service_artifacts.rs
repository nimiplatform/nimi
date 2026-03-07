use std::collections::HashMap;

use super::types::{
    LocalAiNodeContract, LocalAiPreflightRule, LocalAiServiceArtifact, LocalAiServiceArtifactType,
    LocalAiServiceHealthSpec, LocalAiServiceInstallSpec, LocalAiServiceProcessSpec,
};

fn empty_env() -> HashMap<String, String> {
    HashMap::new()
}

fn localai_service_artifact() -> LocalAiServiceArtifact {
    LocalAiServiceArtifact {
        service_id: "localai-openai-gateway".to_string(),
        artifact_type: LocalAiServiceArtifactType::Binary,
        engine: "localai".to_string(),
        install: LocalAiServiceInstallSpec {
            requirements: Vec::new(),
            bootstrap: Some("engine-pack:localai".to_string()),
            binary_url: None,
        },
        preflight: vec![
            LocalAiPreflightRule {
                check: "port-available".to_string(),
                reason_code: "LOCAL_AI_SERVICE_UNREACHABLE".to_string(),
                params: Some(serde_json::json!({ "port": 1234 })),
            },
            LocalAiPreflightRule {
                check: "disk-space".to_string(),
                reason_code: "LOCAL_AI_SERVICE_UNREACHABLE".to_string(),
                params: Some(serde_json::json!({ "minBytes": 536870912_u64 })),
            },
            LocalAiPreflightRule {
                check: "endpoint-loopback".to_string(),
                reason_code: "LOCAL_AI_SERVICE_UNREACHABLE".to_string(),
                params: None,
            },
        ],
        process: LocalAiServiceProcessSpec {
            entry: "local-ai".to_string(),
            args: vec!["run".to_string()],
            env: empty_env(),
            model_binding: None,
        },
        health: LocalAiServiceHealthSpec {
            endpoint: "/readyz".to_string(),
            capability_probe_endpoint: Some("/v1/models".to_string()),
            interval_ms: 30_000,
            timeout_ms: 4_000,
        },
        nodes: vec![
            LocalAiNodeContract {
                node_id: "chat.generate.localai".to_string(),
                title: "LocalAI Chat Generation".to_string(),
                capability: "chat".to_string(),
                api_path: "/v1/chat/completions".to_string(),
                input_schema: Some(serde_json::json!({
                    "messages": "chat[]",
                    "temperature": "number?",
                    "providerHints": "object?"
                })),
                output_schema: Some(serde_json::json!({
                    "text": "string",
                    "usage": "object?"
                })),
            },
            LocalAiNodeContract {
                node_id: "embedding.generate.localai".to_string(),
                title: "LocalAI Embedding".to_string(),
                capability: "embedding".to_string(),
                api_path: "/v1/embeddings".to_string(),
                input_schema: Some(serde_json::json!({
                    "input": "string|string[]",
                    "providerHints": "object?"
                })),
                output_schema: Some(serde_json::json!({
                    "embeddings": "number[][]"
                })),
            },
            LocalAiNodeContract {
                node_id: "speech.stt.localai".to_string(),
                title: "LocalAI Speech-to-Text".to_string(),
                capability: "stt".to_string(),
                api_path: "/v1/audio/transcriptions".to_string(),
                input_schema: Some(serde_json::json!({
                    "audioUri": "string?",
                    "audioBase64": "string?",
                    "providerHints": "object?"
                })),
                output_schema: Some(serde_json::json!({
                    "text": "string"
                })),
            },
            LocalAiNodeContract {
                node_id: "speech.tts.localai".to_string(),
                title: "LocalAI Text-to-Speech".to_string(),
                capability: "tts".to_string(),
                api_path: "/v1/audio/speech".to_string(),
                input_schema: Some(serde_json::json!({
                    "text": "string",
                    "voiceId": "string?",
                    "providerHints": "object?"
                })),
                output_schema: Some(serde_json::json!({
                    "audioUri": "string",
                    "mimeType": "string"
                })),
            },
            LocalAiNodeContract {
                node_id: "image.generate.localai".to_string(),
                title: "LocalAI Image Generation".to_string(),
                capability: "image".to_string(),
                api_path: "/v1/images/generations".to_string(),
                input_schema: Some(serde_json::json!({
                    "prompt": "string",
                    "size": "string?",
                    "providerHints": "object?"
                })),
                output_schema: Some(serde_json::json!({
                    "images": "object[]"
                })),
            },
            LocalAiNodeContract {
                node_id: "video.generate.localai".to_string(),
                title: "LocalAI Video Generation".to_string(),
                capability: "video".to_string(),
                api_path: "/v1/video/generations".to_string(),
                input_schema: Some(serde_json::json!({
                    "prompt": "string",
                    "durationSeconds": "number?",
                    "providerHints": "object?"
                })),
                output_schema: Some(serde_json::json!({
                    "videos": "object[]"
                })),
            },
        ],
    }
}

fn nexa_service_artifact() -> LocalAiServiceArtifact {
    LocalAiServiceArtifact {
        service_id: "nexa-openai-gateway".to_string(),
        artifact_type: LocalAiServiceArtifactType::Binary,
        engine: "nexa".to_string(),
        install: LocalAiServiceInstallSpec {
            requirements: Vec::new(),
            bootstrap: Some("engine-pack:nexa".to_string()),
            binary_url: None,
        },
        preflight: vec![
            LocalAiPreflightRule {
                check: "port-available".to_string(),
                reason_code: "LOCAL_AI_SERVICE_UNREACHABLE".to_string(),
                params: Some(serde_json::json!({ "port": 18181 })),
            },
            LocalAiPreflightRule {
                check: "disk-space".to_string(),
                reason_code: "LOCAL_AI_SERVICE_UNREACHABLE".to_string(),
                params: Some(serde_json::json!({ "minBytes": 536870912_u64 })),
            },
            LocalAiPreflightRule {
                check: "endpoint-loopback".to_string(),
                reason_code: "LOCAL_AI_SERVICE_UNREACHABLE".to_string(),
                params: None,
            },
        ],
        process: LocalAiServiceProcessSpec {
            entry: "nexa".to_string(),
            args: vec!["--skip-update".to_string(), "serve".to_string()],
            env: empty_env(),
            model_binding: None,
        },
        health: LocalAiServiceHealthSpec {
            endpoint: "/".to_string(),
            capability_probe_endpoint: Some("/v1/models".to_string()),
            interval_ms: 30_000,
            timeout_ms: 4_000,
        },
        nodes: vec![
            LocalAiNodeContract {
                node_id: "chat.generate.nexa".to_string(),
                title: "Nexa Chat Generation".to_string(),
                capability: "chat".to_string(),
                api_path: "/v1/chat/completions".to_string(),
                input_schema: Some(serde_json::json!({
                    "messages": "chat[]",
                    "temperature": "number?",
                    "providerHints": "object?"
                })),
                output_schema: Some(serde_json::json!({
                    "text": "string",
                    "usage": "object?"
                })),
            },
            LocalAiNodeContract {
                node_id: "embedding.generate.nexa".to_string(),
                title: "Nexa Embedding".to_string(),
                capability: "embedding".to_string(),
                api_path: "/v1/embeddings".to_string(),
                input_schema: Some(serde_json::json!({
                    "input": "string|string[]",
                    "providerHints": "object?"
                })),
                output_schema: Some(serde_json::json!({
                    "embeddings": "number[][]"
                })),
            },
            LocalAiNodeContract {
                node_id: "speech.stt.nexa".to_string(),
                title: "Nexa Speech-to-Text".to_string(),
                capability: "stt".to_string(),
                api_path: "/v1/audio/transcriptions".to_string(),
                input_schema: Some(serde_json::json!({
                    "audioUri": "string?",
                    "audioBase64": "string?",
                    "providerHints": "object?"
                })),
                output_schema: Some(serde_json::json!({
                    "text": "string"
                })),
            },
            LocalAiNodeContract {
                node_id: "speech.tts.nexa".to_string(),
                title: "Nexa Text-to-Speech".to_string(),
                capability: "tts".to_string(),
                api_path: "/v1/audio/speech".to_string(),
                input_schema: Some(serde_json::json!({
                    "text": "string",
                    "voiceId": "string?",
                    "providerHints": "object?"
                })),
                output_schema: Some(serde_json::json!({
                    "audioUri": "string",
                    "mimeType": "string"
                })),
            },
            LocalAiNodeContract {
                node_id: "image.generate.nexa".to_string(),
                title: "Nexa Image Generation".to_string(),
                capability: "image".to_string(),
                api_path: "/v1/images/generations".to_string(),
                input_schema: Some(serde_json::json!({
                    "prompt": "string",
                    "size": "string?",
                    "providerHints": "object?"
                })),
                output_schema: Some(serde_json::json!({
                    "images": "object[]"
                })),
            },
            LocalAiNodeContract {
                node_id: "rerank.nexa".to_string(),
                title: "Nexa Rerank".to_string(),
                capability: "rerank".to_string(),
                api_path: "/v1/reranking".to_string(),
                input_schema: Some(serde_json::json!({
                    "query": "string",
                    "documents": "string[]",
                    "providerHints": "object?"
                })),
                output_schema: Some(serde_json::json!({
                    "results": "object[]"
                })),
            },
            LocalAiNodeContract {
                node_id: "cv.nexa".to_string(),
                title: "Nexa Computer Vision".to_string(),
                capability: "cv".to_string(),
                api_path: "/v1/cv".to_string(),
                input_schema: Some(serde_json::json!({
                    "task": "string",
                    "imageUri": "string?",
                    "imageBase64": "string?",
                    "providerHints": "object?"
                })),
                output_schema: Some(serde_json::json!({
                    "result": "object"
                })),
            },
            LocalAiNodeContract {
                node_id: "diarize.nexa".to_string(),
                title: "Nexa Speaker Diarization".to_string(),
                capability: "diarize".to_string(),
                api_path: "/v1/audio/diarize".to_string(),
                input_schema: Some(serde_json::json!({
                    "audioUri": "string?",
                    "audioBase64": "string?",
                    "providerHints": "object?"
                })),
                output_schema: Some(serde_json::json!({
                    "segments": "object[]"
                })),
            },
        ],
    }
}

pub fn service_artifact_registry() -> Vec<LocalAiServiceArtifact> {
    vec![localai_service_artifact(), nexa_service_artifact()]
}

pub fn find_service_artifact(service_id: &str) -> Option<LocalAiServiceArtifact> {
    let normalized = service_id.trim().to_ascii_lowercase();
    service_artifact_registry().into_iter().find(|item| {
        item.service_id
            .trim()
            .eq_ignore_ascii_case(normalized.as_str())
            || item.engine.trim().eq_ignore_ascii_case(normalized.as_str())
    })
}
