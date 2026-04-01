use std::collections::HashMap;

use serde_json::json;

use super::types::{LocalAiAssetKind, LocalAiVerifiedAssetDescriptor};

fn z_image_vae_descriptor() -> LocalAiVerifiedAssetDescriptor {
    LocalAiVerifiedAssetDescriptor {
        template_id: "verified.asset.z_image.vae".to_string(),
        title: "Z-Image AE VAE".to_string(),
        description: "Recommended verified dependency asset VAE for local media Z-Image workflows"
            .to_string(),
        asset_id: "local/z_image_ae".to_string(),
        kind: LocalAiAssetKind::Vae,
        logical_model_id: String::new(),
        capabilities: Vec::new(),
        engine: "media".to_string(),
        entry: "vae/diffusion_pytorch_model.safetensors".to_string(),
        files: vec!["vae/diffusion_pytorch_model.safetensors".to_string()],
        license: "tongyi".to_string(),
        repo: "Tongyi-MAI/Z-Image-Turbo".to_string(),
        revision: "main".to_string(),
        hashes: HashMap::new(),
        endpoint: String::new(),
        file_count: 1,
        total_size_bytes: Some(0),
        tags: vec![
            "image".to_string(),
            "verified".to_string(),
            "recommended".to_string(),
            "z-image".to_string(),
            "vae".to_string(),
        ],
        artifact_roles: Vec::new(),
        preferred_engine: Some("media".to_string()),
        fallback_engines: Vec::new(),
        engine_config: None,
        metadata: Some(json!({
            "family": "z-image",
            "format": "safetensors"
        })),
    }
}

fn z_image_qwen_descriptor() -> LocalAiVerifiedAssetDescriptor {
    LocalAiVerifiedAssetDescriptor {
        template_id: "verified.asset.z_image.qwen3_4b".to_string(),
        title: "Qwen3 4B Dependency Chat".to_string(),
        description: "Recommended verified dependency chat asset for local media Z-Image workflows"
            .to_string(),
        asset_id: "local/qwen3_4b_companion".to_string(),
        kind: LocalAiAssetKind::Chat,
        logical_model_id: "nimi/qwen3-4b-companion".to_string(),
        capabilities: vec!["chat".to_string()],
        engine: "llama".to_string(),
        entry: "Qwen3-4B-Q4_K_M.gguf".to_string(),
        files: vec!["Qwen3-4B-Q4_K_M.gguf".to_string()],
        license: "qwen".to_string(),
        repo: "Qwen/Qwen3-4B-GGUF".to_string(),
        revision: "main".to_string(),
        hashes: HashMap::new(),
        endpoint: "http://127.0.0.1:1234/v1".to_string(),
        file_count: 1,
        total_size_bytes: Some(0),
        tags: vec![
            "image".to_string(),
            "verified".to_string(),
            "recommended".to_string(),
            "z-image".to_string(),
            "chat".to_string(),
        ],
        artifact_roles: vec!["llm".to_string(), "tokenizer".to_string()],
        preferred_engine: Some("llama".to_string()),
        fallback_engines: Vec::new(),
        engine_config: None,
        metadata: Some(json!({
            "family": "z-image",
            "format": "gguf"
        })),
    }
}

pub fn verified_asset_list() -> Vec<LocalAiVerifiedAssetDescriptor> {
    vec![z_image_vae_descriptor(), z_image_qwen_descriptor()]
}

pub fn find_verified_asset(template_id: &str) -> Option<LocalAiVerifiedAssetDescriptor> {
    let normalized = template_id.trim();
    if normalized.is_empty() {
        return None;
    }
    verified_asset_list()
        .into_iter()
        .find(|item| item.template_id == normalized)
}

#[cfg(test)]
mod tests {
    use super::{find_verified_asset, verified_asset_list};

    #[test]
    fn verified_asset_registry_contains_z_image_entries() {
        let rows = verified_asset_list();
        assert!(rows
            .iter()
            .any(|item| item.template_id == "verified.asset.z_image.vae"));
        assert!(rows
            .iter()
            .any(|item| item.template_id == "verified.asset.z_image.qwen3_4b"));
    }

    #[test]
    fn find_verified_asset_returns_descriptor_by_template_id() {
        let descriptor = find_verified_asset("verified.asset.z_image.vae").expect("descriptor");
        assert_eq!(descriptor.asset_id, "local/z_image_ae");
        assert_eq!(descriptor.engine, "media");
    }
}
