use std::collections::HashMap;

use serde_json::json;

use super::types::{LocalAiArtifactKind, LocalAiVerifiedArtifactDescriptor};

fn z_image_vae_descriptor() -> LocalAiVerifiedArtifactDescriptor {
    LocalAiVerifiedArtifactDescriptor {
        template_id: "verified.artifact.z_image.vae".to_string(),
        title: "Z-Image AE VAE".to_string(),
        description: "Recommended verified companion VAE for LocalAI Z-Image workflows".to_string(),
        artifact_id: "local/z_image_ae".to_string(),
        kind: LocalAiArtifactKind::Vae,
        engine: "localai".to_string(),
        entry: "vae/diffusion_pytorch_model.safetensors".to_string(),
        files: vec!["vae/diffusion_pytorch_model.safetensors".to_string()],
        license: "tongyi".to_string(),
        repo: "Tongyi-MAI/Z-Image-Turbo".to_string(),
        revision: "main".to_string(),
        hashes: HashMap::new(),
        file_count: 1,
        total_size_bytes: Some(0),
        tags: vec![
            "image".to_string(),
            "verified".to_string(),
            "recommended".to_string(),
            "z-image".to_string(),
            "vae".to_string(),
        ],
        metadata: Some(json!({
            "family": "z-image",
            "format": "safetensors"
        })),
    }
}

fn z_image_qwen_descriptor() -> LocalAiVerifiedArtifactDescriptor {
    LocalAiVerifiedArtifactDescriptor {
        template_id: "verified.artifact.z_image.qwen3_4b".to_string(),
        title: "Qwen3 4B Companion LLM".to_string(),
        description: "Recommended verified companion LLM for LocalAI Z-Image workflows".to_string(),
        artifact_id: "local/qwen3_4b_companion".to_string(),
        kind: LocalAiArtifactKind::Llm,
        engine: "localai".to_string(),
        entry: "Qwen3-4B-Q4_K_M.gguf".to_string(),
        files: vec!["Qwen3-4B-Q4_K_M.gguf".to_string()],
        license: "qwen".to_string(),
        repo: "Qwen/Qwen3-4B-GGUF".to_string(),
        revision: "main".to_string(),
        hashes: HashMap::new(),
        file_count: 1,
        total_size_bytes: Some(0),
        tags: vec![
            "image".to_string(),
            "verified".to_string(),
            "recommended".to_string(),
            "z-image".to_string(),
            "llm".to_string(),
        ],
        metadata: Some(json!({
            "family": "z-image",
            "format": "gguf"
        })),
    }
}

pub fn verified_artifact_list() -> Vec<LocalAiVerifiedArtifactDescriptor> {
    vec![z_image_vae_descriptor(), z_image_qwen_descriptor()]
}

pub fn find_verified_artifact(template_id: &str) -> Option<LocalAiVerifiedArtifactDescriptor> {
    let normalized = template_id.trim();
    if normalized.is_empty() {
        return None;
    }
    verified_artifact_list()
        .into_iter()
        .find(|item| item.template_id == normalized)
}

#[cfg(test)]
mod tests {
    use super::{find_verified_artifact, verified_artifact_list};

    #[test]
    fn verified_artifact_registry_contains_z_image_entries() {
        let rows = verified_artifact_list();
        assert!(rows.iter().any(|item| item.template_id == "verified.artifact.z_image.vae"));
        assert!(rows.iter().any(|item| item.template_id == "verified.artifact.z_image.qwen3_4b"));
    }

    #[test]
    fn find_verified_artifact_returns_descriptor_by_template_id() {
        let descriptor = find_verified_artifact("verified.artifact.z_image.vae").expect("descriptor");
        assert_eq!(descriptor.artifact_id, "local/z_image_ae");
        assert_eq!(descriptor.engine, "localai");
    }
}
