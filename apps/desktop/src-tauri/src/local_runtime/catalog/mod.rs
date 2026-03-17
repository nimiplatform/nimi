use super::import_validator::{normalize_and_validate_capabilities, validate_loopback_endpoint};
use super::recommendation::{build_catalog_recommendation, build_recommendation_candidate};
use super::types::{
    slugify_local_model_id, CatalogVariantDescriptor, LocalAiCatalogItemDescriptor,
    LocalAiDeviceProfile, LocalAiInstallPlanDescriptor, LocalAiVerifiedModelDescriptor,
};
use super::verified_models::{find_verified_model, verified_model_list};
use std::collections::HashMap;

mod huggingface;
mod shared;

pub use self::huggingface::list_repo_catalog_variants;
use self::huggingface::{
    fetch_hf_model_details, fetch_hf_search_models, hf_search_to_catalog_item, infer_capabilities,
    infer_license, known_total_size_bytes, match_catalog_capability, match_catalog_query,
    normalize_hf_repo_slug, normalize_search_query, resolve_hashes_for_files, select_entry_file,
    select_install_files, sibling_size_bytes,
};
#[cfg(test)]
use self::huggingface::{hf_api_base_url, normalize_hf_file_path, HfModelSibling};
use self::shared::{
    default_endpoint_for_engine, infer_engine, install_available_for_engine,
    normalize_install_limit, normalize_non_empty, provider_hints_for_capabilities,
    runtime_mode_for_engine,
};

include!("install_plan.rs");

#[derive(Debug, Clone, Default)]
pub struct LocalAiCatalogResolveInput {
    pub item_id: Option<String>,
    pub source: Option<String>,
    pub template_id: Option<String>,
    pub model_id: Option<String>,
    pub repo: Option<String>,
    pub revision: Option<String>,
    pub capabilities: Option<Vec<String>>,
    pub engine: Option<String>,
    pub entry: Option<String>,
    pub files: Option<Vec<String>>,
    pub license: Option<String>,
    pub hashes: Option<HashMap<String, String>>,
    pub endpoint: Option<String>,
}
fn verified_descriptor_to_catalog_item(
    descriptor: LocalAiVerifiedModelDescriptor,
    profile: &LocalAiDeviceProfile,
) -> LocalAiCatalogItemDescriptor {
    let engine_runtime_mode = runtime_mode_for_engine(descriptor.engine.as_str(), profile);
    let endpoint = descriptor.endpoint.clone();
    let provider_hints = provider_hints_for_capabilities(
        descriptor.capabilities.as_slice(),
        descriptor.engine.as_str(),
        profile,
    );
    let install_available = install_available_for_engine(
        descriptor.engine.as_str(),
        &engine_runtime_mode,
        Some(endpoint.as_str()),
        profile,
    );
    let recommendation = build_recommendation_candidate(
        descriptor.model_id.as_str(),
        descriptor.repo.as_str(),
        descriptor.title.as_str(),
        descriptor.capabilities.as_slice(),
        descriptor.engine.as_str(),
        Some(descriptor.entry.as_str()),
        descriptor.total_size_bytes,
        descriptor.total_size_bytes,
        descriptor
            .files
            .iter()
            .filter(|entry| *entry != &descriptor.entry)
            .cloned()
            .collect::<Vec<_>>(),
        descriptor.tags.as_slice(),
    );
    let recommendation =
        recommendation.and_then(|candidate| build_catalog_recommendation(&candidate, profile));
    LocalAiCatalogItemDescriptor {
        item_id: format!("verified:{}", descriptor.template_id),
        source: "verified".to_string(),
        title: descriptor.title,
        description: descriptor.description,
        model_id: descriptor.model_id,
        repo: descriptor.repo,
        revision: descriptor.revision,
        template_id: Some(descriptor.template_id),
        capabilities: descriptor.capabilities,
        engine_runtime_mode,
        engine: descriptor.engine,
        install_kind: descriptor.install_kind,
        install_available,
        endpoint: Some(endpoint),
        provider_hints,
        entry: Some(descriptor.entry),
        files: descriptor.files,
        license: Some(descriptor.license),
        hashes: descriptor.hashes,
        tags: descriptor.tags,
        downloads: None,
        likes: None,
        last_modified: None,
        verified: true,
        engine_config: descriptor.engine_config,
        recommendation,
    }
}

pub fn search_catalog(
    query: Option<&str>,
    capability: Option<&str>,
    limit: usize,
    profile: &LocalAiDeviceProfile,
) -> Result<Vec<LocalAiCatalogItemDescriptor>, String> {
    let normalized_query = normalize_search_query(query);
    let normalized_capability = normalize_non_empty(capability);
    let normalized_limit = normalize_install_limit(limit);

    let mut merged = verified_model_list()
        .into_iter()
        .map(|descriptor| verified_descriptor_to_catalog_item(descriptor, profile))
        .collect::<Vec<_>>();

    let hf_rows = fetch_hf_search_models(normalized_query.as_str(), normalized_limit * 2)?;
    merged.extend(
        hf_rows
            .into_iter()
            .filter_map(|item| hf_search_to_catalog_item(item, profile)),
    );

    let mut filtered = merged
        .into_iter()
        .filter(|item| match_catalog_query(item, normalized_query.as_str()))
        .filter(|item| {
            if let Some(capability_filter) = normalized_capability.as_ref() {
                return match_catalog_capability(item, capability_filter.as_str());
            }
            true
        })
        .collect::<Vec<_>>();

    filtered.sort_by(|left, right| {
        let left_rank = if left.verified { 0 } else { 1 };
        let right_rank = if right.verified { 0 } else { 1 };
        if left_rank != right_rank {
            return left_rank.cmp(&right_rank);
        }

        left.title
            .to_ascii_lowercase()
            .cmp(&right.title.to_ascii_lowercase())
    });

    if filtered.len() > normalized_limit {
        filtered.truncate(normalized_limit);
    }

    for item in filtered.iter_mut() {
        hydrate_catalog_item_for_recommendation(item, profile)?;
    }

    Ok(filtered)
}

pub fn list_catalog_variants(
    repo: &str,
    profile: &LocalAiDeviceProfile,
) -> Result<Vec<CatalogVariantDescriptor>, String> {
    let details = fetch_hf_model_details(repo)?;
    let capabilities = normalize_and_validate_capabilities(&infer_capabilities(
        details.pipeline_tag.as_deref(),
        &details.tags,
    ))?;
    let engine = infer_engine(repo, &details.tags, &capabilities);
    list_repo_catalog_variants(
        repo,
        details.id.as_str(),
        details.id.as_str(),
        capabilities.as_slice(),
        engine.as_str(),
        profile,
        details.tags.as_slice(),
    )
}

#[cfg(test)]
mod tests {
    use super::{
        hf_api_base_url, infer_capabilities, infer_engine, infer_license, match_catalog_capability,
        match_catalog_query, normalize_hf_file_path, normalize_hf_repo_slug,
        normalize_install_limit, normalize_search_query, runtime_mode_for_engine,
        select_entry_file, select_install_files, HfModelSibling,
    };
    use crate::local_runtime::types::{
        LocalAiCatalogItemDescriptor, LocalAiDeviceProfile, LocalAiEngineRuntimeMode,
        LocalAiGpuProfile, LocalAiMemoryModel, LocalAiNpuProfile, LocalAiPythonProfile,
    };
    use std::collections::HashMap;

    fn profile_fixture() -> LocalAiDeviceProfile {
        LocalAiDeviceProfile {
            os: "linux".to_string(),
            arch: "amd64".to_string(),
            total_ram_bytes: 16 * 1024 * 1024 * 1024,
            available_ram_bytes: 12 * 1024 * 1024 * 1024,
            gpu: LocalAiGpuProfile {
                available: true,
                vendor: Some("nvidia".to_string()),
                model: Some("RTX".to_string()),
                total_vram_bytes: Some(12 * 1024 * 1024 * 1024),
                available_vram_bytes: Some(10 * 1024 * 1024 * 1024),
                memory_model: LocalAiMemoryModel::Discrete,
            },
            python: LocalAiPythonProfile {
                available: true,
                version: Some("3.11.0".to_string()),
            },
            npu: LocalAiNpuProfile {
                available: false,
                ready: false,
                vendor: None,
                runtime: None,
                detail: None,
            },
            disk_free_bytes: 0,
            ports: Vec::new(),
        }
    }

    fn sibling(name: &str) -> HfModelSibling {
        HfModelSibling {
            rfilename: name.to_string(),
            lfs: None,
        }
    }

    fn catalog_item_fixture(
        model_id: &str,
        caps: &[&str],
        verified: bool,
    ) -> LocalAiCatalogItemDescriptor {
        LocalAiCatalogItemDescriptor {
            item_id: format!("test:{model_id}"),
            source: "test".to_string(),
            title: model_id.split('/').last().unwrap_or(model_id).to_string(),
            description: "test model".to_string(),
            model_id: model_id.to_string(),
            repo: model_id.to_string(),
            revision: "main".to_string(),
            template_id: None,
            capabilities: caps.iter().map(|c| c.to_string()).collect(),
            engine: "llama".to_string(),
            engine_runtime_mode: LocalAiEngineRuntimeMode::Supervised,
            install_kind: "test".to_string(),
            install_available: true,
            endpoint: Some("http://127.0.0.1:1234/v1".to_string()),
            provider_hints: None,
            entry: Some("model.gguf".to_string()),
            files: vec![],
            license: Some("apache-2.0".to_string()),
            hashes: HashMap::new(),
            tags: vec![],
            downloads: None,
            likes: None,
            last_modified: None,
            verified,
            engine_config: None,
            recommendation: None,
        }
    }

    // --- existing tests ---

    #[test]
    fn normalize_hf_repo_slug_supports_protocol_and_url() {
        assert_eq!(
            normalize_hf_repo_slug("hf://Qwen/Qwen2.5-7B-Instruct-GGUF"),
            Some("Qwen/Qwen2.5-7B-Instruct-GGUF".to_string())
        );
        assert_eq!(
            normalize_hf_repo_slug(
                "https://huggingface.co/Qwen/Qwen2.5-7B-Instruct-GGUF/resolve/main/model.gguf"
            ),
            Some("Qwen/Qwen2.5-7B-Instruct-GGUF".to_string())
        );
    }

    #[test]
    fn infer_capabilities_defaults_to_chat() {
        let capabilities = infer_capabilities(None, &[]);
        assert_eq!(capabilities, vec!["chat".to_string()]);
    }

    #[test]
    fn infer_engine_prefers_llama_for_gguf() {
        let capabilities = vec!["chat".to_string()];
        let engine = infer_engine(
            "Qwen/Qwen2.5-7B-Instruct-GGUF",
            &vec!["gguf".to_string()],
            &capabilities,
        );
        assert_eq!(engine, "llama");
    }

    #[test]
    fn runtime_mode_maps_llama_to_supervised() {
        assert_eq!(
            runtime_mode_for_engine("llama", &profile_fixture()),
            LocalAiEngineRuntimeMode::Supervised
        );
    }

    // --- K-LOCAL-023 infer_capabilities full mapping ---

    #[test]
    fn infer_capabilities_text_generation_maps_to_chat() {
        let caps = infer_capabilities(Some("text-generation"), &[]);
        assert_eq!(caps, vec!["chat"]);
    }

    #[test]
    fn infer_capabilities_text2text_generation_maps_to_chat() {
        let caps = infer_capabilities(Some("text2text-generation"), &[]);
        assert_eq!(caps, vec!["chat"]);
    }

    #[test]
    fn infer_capabilities_text_to_image_maps_to_image() {
        let caps = infer_capabilities(Some("text-to-image"), &[]);
        assert_eq!(caps, vec!["image"]);
    }

    #[test]
    fn infer_capabilities_image_to_image_maps_to_image() {
        let caps = infer_capabilities(Some("image-to-image"), &[]);
        assert_eq!(caps, vec!["image"]);
    }

    #[test]
    fn infer_capabilities_text_to_video_maps_to_video() {
        let caps = infer_capabilities(Some("text-to-video"), &[]);
        assert_eq!(caps, vec!["video"]);
    }

    #[test]
    fn infer_capabilities_text_to_speech_maps_to_tts() {
        let caps = infer_capabilities(Some("text-to-speech"), &[]);
        assert_eq!(caps, vec!["tts"]);
    }

    #[test]
    fn infer_capabilities_text_to_audio_maps_to_tts() {
        let caps = infer_capabilities(Some("text-to-audio"), &[]);
        assert_eq!(caps, vec!["tts"]);
    }

    #[test]
    fn infer_capabilities_asr_maps_to_stt() {
        let caps = infer_capabilities(Some("automatic-speech-recognition"), &[]);
        assert_eq!(caps, vec!["stt"]);
    }

    #[test]
    fn infer_capabilities_feature_extraction_maps_to_embedding() {
        let caps = infer_capabilities(Some("feature-extraction"), &[]);
        assert_eq!(caps, vec!["embedding"]);
    }

    #[test]
    fn infer_capabilities_sentence_similarity_maps_to_embedding() {
        let caps = infer_capabilities(Some("sentence-similarity"), &[]);
        assert_eq!(caps, vec!["embedding"]);
    }

    #[test]
    fn infer_capabilities_unknown_pipeline_falls_back_to_chat() {
        let caps = infer_capabilities(Some("zero-shot-classification"), &[]);
        assert_eq!(caps, vec!["chat"]);
    }

    #[test]
    fn infer_capabilities_tags_enrich_result() {
        let tags = vec!["tts".to_string(), "chat".to_string()];
        let caps = infer_capabilities(None, &tags);
        assert!(caps.contains(&"tts".to_string()));
        assert!(caps.contains(&"chat".to_string()));
        assert_eq!(caps.len(), 2);
    }

    #[test]
    fn infer_capabilities_combined_pipeline_and_tags_dedup() {
        let tags = vec!["chat".to_string()];
        let caps = infer_capabilities(Some("text-generation"), &tags);
        assert_eq!(caps, vec!["chat"]);
    }

    // --- K-LOCAL-026 normalize_hf_file_path ---

    #[test]
    fn normalize_hf_file_path_rejects_absolute_path() {
        assert_eq!(normalize_hf_file_path("/etc/passwd"), None);
    }

    #[test]
    fn normalize_hf_file_path_rejects_parent_traversal() {
        assert_eq!(normalize_hf_file_path("../../etc/shadow"), None);
    }

    #[test]
    fn normalize_hf_file_path_converts_backslash() {
        assert_eq!(
            normalize_hf_file_path("subdir\\model.bin"),
            Some("subdir/model.bin".to_string())
        );
    }

    #[test]
    fn normalize_hf_file_path_rejects_empty() {
        assert_eq!(normalize_hf_file_path(""), None);
    }

    #[test]
    fn normalize_hf_file_path_accepts_nested_relative() {
        assert_eq!(
            normalize_hf_file_path("speech_tokenizer/model.safetensors"),
            Some("speech_tokenizer/model.safetensors".to_string())
        );
    }

    // --- K-LOCAL-027 select_entry_file ---

    #[test]
    fn select_entry_file_prefers_gguf_for_llama() {
        let siblings = vec![
            sibling("config.json"),
            sibling("model.safetensors"),
            sibling("weights.gguf"),
        ];
        let entry = select_entry_file(&siblings, None, "llama");
        assert_eq!(entry, Some("weights.gguf".to_string()));
    }

    #[test]
    fn select_entry_file_prefers_model_safetensors_when_no_gguf() {
        let siblings = vec![sibling("config.json"), sibling("model.safetensors")];
        let entry = select_entry_file(&siblings, None, "llama");
        assert_eq!(entry, Some("model.safetensors".to_string()));
    }

    #[test]
    fn select_entry_file_falls_back_to_any_safetensors() {
        let siblings = vec![sibling("config.json"), sibling("weights.safetensors")];
        let entry = select_entry_file(&siblings, None, "llama");
        assert_eq!(entry, Some("weights.safetensors".to_string()));
    }

    #[test]
    fn select_entry_file_uses_manual_entry_when_provided() {
        let siblings = vec![sibling("config.json"), sibling("model.safetensors")];
        let entry = select_entry_file(&siblings, Some("custom.bin"), "llama");
        assert_eq!(entry, Some("custom.bin".to_string()));
    }

    #[test]
    fn select_entry_file_returns_none_for_empty_siblings() {
        let entry = select_entry_file(&[], None, "llama");
        assert_eq!(entry, None);
    }

    #[test]
    fn select_install_files_uses_only_manual_gguf_variant_for_llama() {
        let siblings = vec![
            sibling("config.json"),
            sibling("tokenizer.json"),
            sibling("Qwen_Qwen3.5-0.8B-Q8_0.gguf"),
            sibling("Qwen_Qwen3.5-0.8B-Q4_K_M.gguf"),
        ];
        let files = select_install_files(
            &siblings,
            "Qwen_Qwen3.5-0.8B-Q8_0.gguf",
            Some("Qwen_Qwen3.5-0.8B-Q8_0.gguf"),
            None,
            "llama",
        );
        assert_eq!(files, vec!["Qwen_Qwen3.5-0.8B-Q8_0.gguf".to_string()]);
    }

    #[test]
    fn select_install_files_keeps_default_companion_files_without_manual_variant() {
        let siblings = vec![
            sibling("config.json"),
            sibling("tokenizer.json"),
            sibling("Qwen_Qwen3.5-0.8B-Q8_0.gguf"),
            sibling("Qwen_Qwen3.5-0.8B-Q4_K_M.gguf"),
        ];
        let files = select_install_files(
            &siblings,
            "Qwen_Qwen3.5-0.8B-Q8_0.gguf",
            None,
            None,
            "llama",
        );
        assert_eq!(
            files,
            vec![
                "Qwen_Qwen3.5-0.8B-Q8_0.gguf".to_string(),
                "config.json".to_string(),
                "tokenizer.json".to_string(),
                "Qwen_Qwen3.5-0.8B-Q4_K_M.gguf".to_string(),
            ]
        );
    }

    // --- K-LOCAL-021 match_catalog_query / match_catalog_capability ---

    #[test]
    fn match_catalog_query_empty_query_matches_all() {
        let item = catalog_item_fixture("Qwen/Qwen2.5", &["chat"], false);
        assert!(match_catalog_query(&item, ""));
    }

    #[test]
    fn match_catalog_query_matches_model_id_case_insensitive() {
        let item = catalog_item_fixture("Qwen/Qwen2.5", &["chat"], false);
        assert!(match_catalog_query(&item, "qwen"));
    }

    #[test]
    fn match_catalog_capability_empty_matches_all() {
        let item = catalog_item_fixture("test/model", &["chat"], false);
        assert!(match_catalog_capability(&item, ""));
    }

    #[test]
    fn match_catalog_capability_exact_match() {
        let item = catalog_item_fixture("test/model", &["chat", "embedding"], false);
        assert!(match_catalog_capability(&item, "embedding"));
    }

    #[test]
    fn match_catalog_capability_no_match() {
        let item = catalog_item_fixture("test/model", &["chat"], false);
        assert!(!match_catalog_capability(&item, "video"));
    }

    // --- helper functions ---

    #[test]
    fn normalize_install_limit_clamps_to_range() {
        assert_eq!(normalize_install_limit(0), 1);
        assert_eq!(normalize_install_limit(100), 80);
        assert_eq!(normalize_install_limit(50), 50);
    }

    #[test]
    fn normalize_search_query_defaults_to_llama() {
        assert_eq!(normalize_search_query(None), "llama gguf");
        assert_eq!(normalize_search_query(Some("")), "llama gguf");
        assert_eq!(normalize_search_query(Some("  ")), "llama gguf");
    }

    #[test]
    fn infer_license_extracts_from_tags() {
        let tags = vec!["license:apache-2.0".to_string()];
        assert_eq!(infer_license(&tags, None), "apache-2.0");
    }

    #[test]
    fn infer_license_manual_overrides_tags() {
        let tags = vec!["license:apache-2.0".to_string()];
        assert_eq!(infer_license(&tags, Some("mit")), "mit");
    }

    #[test]
    fn infer_license_defaults_to_unknown() {
        assert_eq!(infer_license(&[], None), "unknown");
    }

    #[test]
    fn infer_engine_hard_cuts_legacy_npu_tags_to_llama() {
        let tags = vec!["npu".to_string()];
        let caps = vec!["chat".to_string()];
        let engine = infer_engine("org/model", &tags, &caps);
        assert_eq!(engine, "llama");
    }

    #[test]
    fn infer_engine_llama_for_chat() {
        let caps = vec!["chat".to_string()];
        let engine = infer_engine("org/model", &[], &caps);
        assert_eq!(engine, "llama");
    }

    // --- hf_api_base_url ---

    #[test]
    fn hf_api_base_url_ends_with_api_models() {
        let url = hf_api_base_url();
        assert!(
            url.ends_with("/api/models"),
            "hf_api_base_url must end with /api/models, got: {url}"
        );
    }
}
