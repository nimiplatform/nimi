use std::collections::HashMap;

use super::types::{
    LocalAiNodeContract, LocalAiPreflightRule, LocalAiServiceArtifact, LocalAiServiceArtifactType,
    LocalAiServiceHealthSpec, LocalAiServiceInstallSpec, LocalAiServiceProcessSpec,
};

fn empty_env() -> HashMap<String, String> {
    HashMap::new()
}

fn qwen_tts_python_service_artifact() -> LocalAiServiceArtifact {
    LocalAiServiceArtifact {
        service_id: "qwen-tts-python".to_string(),
        artifact_type: LocalAiServiceArtifactType::PythonEnv,
        engine: "speech".to_string(),
        install: LocalAiServiceInstallSpec {
            requirements: vec![
                "qwen-tts".to_string(),
                "fastapi".to_string(),
                "uvicorn[standard]".to_string(),
                "soundfile".to_string(),
            ],
            bootstrap: Some("python-venv".to_string()),
            binary_url: None,
        },
        preflight: vec![
            LocalAiPreflightRule {
                check: "python-version".to_string(),
                reason_code: "LOCAL_AI_QWEN_PYTHON_REQUIRED".to_string(),
                params: Some(serde_json::json!({ "minVersion": "3.10" })),
            },
            LocalAiPreflightRule {
                check: "endpoint-loopback".to_string(),
                reason_code: "LOCAL_AI_QWEN_ENDPOINT_NOT_LOOPBACK".to_string(),
                params: None,
            },
        ],
        process: LocalAiServiceProcessSpec {
            entry: "python".to_string(),
            args: vec![
                "${GATEWAY_SCRIPT}".to_string(),
                "--host".to_string(),
                "${HOST}".to_string(),
                "--port".to_string(),
                "${PORT}".to_string(),
                "--model-dir".to_string(),
                "${MODEL_DIR}".to_string(),
                "--model-id".to_string(),
                "${MODEL_ID}".to_string(),
                "--log-level".to_string(),
                "warning".to_string(),
            ],
            env: empty_env(),
            model_binding: Some("resolved-bundle".to_string()),
        },
        health: LocalAiServiceHealthSpec {
            endpoint: "/v1/models".to_string(),
            capability_probe_endpoint: Some("/v1/models".to_string()),
            interval_ms: 30_000,
            timeout_ms: 4_000,
        },
        nodes: vec![LocalAiNodeContract {
            node_id: "voice_workflow.tts_t2v.qwen3tts".to_string(),
            title: "Qwen3 TTS Voice Design".to_string(),
            capability: "voice_workflow.tts_t2v".to_string(),
            api_path: "/v1/voice/design".to_string(),
            input_schema: Some(serde_json::json!({
                "text": "string",
                "voiceId": "string?",
                "providerHints": "object?"
            })),
            output_schema: Some(serde_json::json!({
                "audioBase64": "string",
                "mimeType": "string"
            })),
        }],
    }
}

pub fn service_artifact_registry() -> Vec<LocalAiServiceArtifact> {
    vec![qwen_tts_python_service_artifact()]
}

pub fn find_service_artifact(service_id: &str) -> Option<LocalAiServiceArtifact> {
    let normalized = service_id.trim();
    if normalized.is_empty() {
        return None;
    }
    service_artifact_registry().into_iter().find(|item| {
        item.service_id.eq_ignore_ascii_case(normalized)
            || item.engine.eq_ignore_ascii_case(normalized)
    })
}

#[cfg(test)]
mod tests {
    use super::{find_service_artifact, service_artifact_registry};

    #[test]
    fn service_artifact_registry_contains_only_runtime_native_host_artifacts() {
        let artifacts = service_artifact_registry();
        assert_eq!(artifacts.len(), 1);
        assert_eq!(artifacts[0].service_id, "qwen-tts-python");
        assert_eq!(artifacts[0].engine, "speech");
    }

    #[test]
    fn qwen_service_artifact_uses_speech_native_contract() {
        let artifact =
            find_service_artifact("qwen-tts-python").expect("qwen-tts-python artifact");
        assert_eq!(artifact.health.endpoint, "/v1/models");
        assert!(artifact
            .nodes
            .iter()
            .any(|node| node.api_path == "/v1/voice/design"));
    }
}
