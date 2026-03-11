use super::import_validator::{normalize_and_validate_capabilities, validate_loopback_endpoint};
use super::types::{
    slugify_local_model_id, LocalAiCatalogItemDescriptor, LocalAiInstallPlanDescriptor,
    LocalAiVerifiedModelDescriptor,
};
use super::verified_models::{find_verified_model, verified_model_list};
use std::collections::HashMap;

mod huggingface;
mod shared;

pub use self::huggingface::list_repo_gguf_variants;
use self::huggingface::{
    fetch_hf_model_details, fetch_hf_search_models, hf_search_to_catalog_item, infer_capabilities,
    infer_license, match_catalog_capability, match_catalog_query, normalize_hf_repo_slug,
    normalize_search_query, resolve_hashes_for_files, select_entry_file, select_install_files,
};
#[cfg(test)]
use self::huggingface::{hf_api_base_url, normalize_hf_file_path, HfModelSibling};
use self::shared::{
    default_endpoint_for_engine, infer_engine, normalize_install_limit, normalize_non_empty,
    provider_hints_for_capabilities, runtime_mode_for_engine,
};

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
) -> LocalAiCatalogItemDescriptor {
    let provider_hints = provider_hints_for_capabilities(
        descriptor.capabilities.as_slice(),
        descriptor.engine.as_str(),
    );
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
        engine_runtime_mode: runtime_mode_for_engine(descriptor.engine.as_str()),
        engine: descriptor.engine,
        install_kind: descriptor.install_kind,
        install_available: true,
        endpoint: Some(descriptor.endpoint),
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
    }
}

pub fn search_catalog(
    query: Option<&str>,
    capability: Option<&str>,
    limit: usize,
) -> Result<Vec<LocalAiCatalogItemDescriptor>, String> {
    let normalized_query = normalize_search_query(query);
    let normalized_capability = normalize_non_empty(capability);
    let normalized_limit = normalize_install_limit(limit);

    let mut merged = verified_model_list()
        .into_iter()
        .map(verified_descriptor_to_catalog_item)
        .collect::<Vec<_>>();

    let hf_rows = fetch_hf_search_models(normalized_query.as_str(), normalized_limit * 2)?;
    merged.extend(hf_rows.into_iter().filter_map(hf_search_to_catalog_item));

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

    Ok(filtered)
}

fn resolve_verified_plan(template_id: &str) -> Result<LocalAiInstallPlanDescriptor, String> {
    let descriptor = find_verified_model(template_id).ok_or_else(|| {
        format!("LOCAL_AI_INSTALL_PLAN_TEMPLATE_NOT_FOUND: templateId={template_id}")
    })?;
    let endpoint = validate_loopback_endpoint(descriptor.endpoint.as_str())?;
    let provider_hints = provider_hints_for_capabilities(
        descriptor.capabilities.as_slice(),
        descriptor.engine.as_str(),
    );

    Ok(LocalAiInstallPlanDescriptor {
        plan_id: format!("plan:verified:{}", descriptor.template_id),
        item_id: format!("verified:{}", descriptor.template_id),
        source: "verified".to_string(),
        template_id: Some(descriptor.template_id.clone()),
        model_id: descriptor.model_id,
        repo: descriptor.repo,
        revision: descriptor.revision,
        capabilities: descriptor.capabilities,
        engine_runtime_mode: runtime_mode_for_engine(descriptor.engine.as_str()),
        engine: descriptor.engine,
        install_kind: descriptor.install_kind,
        install_available: true,
        endpoint,
        provider_hints,
        entry: descriptor.entry,
        files: descriptor.files,
        license: descriptor.license,
        hashes: descriptor.hashes,
        warnings: Vec::new(),
        reason_code: None,
        engine_config: descriptor.engine_config,
    })
}

fn extract_template_id_from_input(input: &LocalAiCatalogResolveInput) -> Option<String> {
    if let Some(value) = normalize_non_empty(input.template_id.as_deref()) {
        return Some(value);
    }

    if let Some(item_id) = normalize_non_empty(input.item_id.as_deref()) {
        if let Some(stripped) = item_id.strip_prefix("verified:") {
            let template_id = stripped.trim();
            if !template_id.is_empty() {
                return Some(template_id.to_string());
            }
        }
    }

    None
}

fn extract_repo_from_input(input: &LocalAiCatalogResolveInput) -> Option<String> {
    if let Some(repo) = normalize_non_empty(input.repo.as_deref()) {
        return normalize_hf_repo_slug(repo.as_str());
    }

    if let Some(model_id) = normalize_non_empty(input.model_id.as_deref()) {
        if let Some(repo) = normalize_hf_repo_slug(model_id.as_str()) {
            return Some(repo);
        }
    }

    if let Some(item_id) = normalize_non_empty(input.item_id.as_deref()) {
        if let Some(stripped) = item_id.strip_prefix("hf:") {
            return normalize_hf_repo_slug(stripped);
        }
    }

    None
}

fn source_hint(input: &LocalAiCatalogResolveInput) -> String {
    normalize_non_empty(input.source.as_deref())
        .unwrap_or_else(|| "huggingface".to_string())
        .to_ascii_lowercase()
}

pub fn resolve_install_plan(
    input: LocalAiCatalogResolveInput,
) -> Result<LocalAiInstallPlanDescriptor, String> {
    let source = source_hint(&input);
    if source == "verified" {
        let template_id = extract_template_id_from_input(&input).ok_or_else(|| {
            "LOCAL_AI_INSTALL_PLAN_TEMPLATE_REQUIRED: templateId is required".to_string()
        })?;
        return resolve_verified_plan(template_id.as_str());
    }

    if let Some(template_id) = extract_template_id_from_input(&input) {
        return resolve_verified_plan(template_id.as_str());
    }

    let repo = extract_repo_from_input(&input).ok_or_else(|| {
        "LOCAL_AI_INSTALL_PLAN_REPO_REQUIRED: repo/modelId/itemId is required".to_string()
    })?;
    let model_details = fetch_hf_model_details(repo.as_str())?;

    let pipeline_tag = model_details.pipeline_tag.as_deref();
    let inferred_capabilities = infer_capabilities(pipeline_tag, &model_details.tags);
    let capabilities = if let Some(overrides) = input.capabilities.as_ref() {
        normalize_and_validate_capabilities(overrides)?
    } else {
        normalize_and_validate_capabilities(&inferred_capabilities)?
    };
    let engine = normalize_non_empty(input.engine.as_deref())
        .unwrap_or_else(|| infer_engine(repo.as_str(), &model_details.tags, &capabilities));
    let provider_hints = provider_hints_for_capabilities(capabilities.as_slice(), engine.as_str());
    let revision = normalize_non_empty(input.revision.as_deref())
        .or_else(|| model_details.sha.clone())
        .unwrap_or_else(|| "main".to_string());

    let entry = select_entry_file(
        &model_details.siblings,
        input.entry.as_deref(),
        engine.as_str(),
    )
    .unwrap_or_else(|| {
        input
            .entry
            .clone()
            .unwrap_or_else(|| "model.bin".to_string())
    });
    let files = select_install_files(
        &model_details.siblings,
        entry.as_str(),
        input.entry.as_deref(),
        input.files.as_deref(),
        engine.as_str(),
    );
    let hashes = resolve_hashes_for_files(&model_details.siblings, &files, input.hashes.as_ref());

    let endpoint_raw = normalize_non_empty(input.endpoint.as_deref())
        .unwrap_or_else(|| default_endpoint_for_engine(engine.as_str()));
    let endpoint = validate_loopback_endpoint(endpoint_raw.as_str())?;

    let mut warnings = Vec::<String>::new();
    if hashes.is_empty() {
        warnings.push("install plan does not include per-file hashes; runtime will verify downloaded files only when hashes are available".to_string());
    }

    let model_id = normalize_non_empty(input.model_id.as_deref())
        .or_else(|| normalize_non_empty(Some(model_details.id.as_str())))
        .unwrap_or_else(|| repo.clone());

    let license = infer_license(&model_details.tags, input.license.as_deref());

    Ok(LocalAiInstallPlanDescriptor {
        plan_id: format!("plan:hf:{}", slugify_local_model_id(model_id.as_str())),
        item_id: normalize_non_empty(input.item_id.as_deref())
            .unwrap_or_else(|| format!("hf:{repo}")),
        source: "huggingface".to_string(),
        template_id: None,
        model_id,
        repo,
        revision,
        capabilities,
        engine_runtime_mode: runtime_mode_for_engine(engine.as_str()),
        engine,
        install_kind: "hf-install-plan".to_string(),
        install_available: true,
        endpoint,
        provider_hints,
        entry,
        files,
        license,
        hashes,
        warnings,
        reason_code: None,
        engine_config: None,
    })
}

#[cfg(test)]
mod tests {
    use super::{
        hf_api_base_url, infer_capabilities, infer_engine, infer_license, match_catalog_capability,
        match_catalog_query, normalize_hf_file_path, normalize_hf_repo_slug,
        normalize_install_limit, normalize_search_query, runtime_mode_for_engine,
        select_entry_file, select_install_files, HfModelSibling,
    };
    use crate::local_runtime::types::{LocalAiCatalogItemDescriptor, LocalAiEngineRuntimeMode};
    use std::collections::HashMap;

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
            engine: "localai".to_string(),
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
    fn infer_engine_prefers_localai_for_gguf() {
        let capabilities = vec!["chat".to_string()];
        let engine = infer_engine(
            "Qwen/Qwen2.5-7B-Instruct-GGUF",
            &vec!["gguf".to_string()],
            &capabilities,
        );
        assert_eq!(engine, "localai");
    }

    #[test]
    fn runtime_mode_maps_localai_to_supervised() {
        assert_eq!(
            runtime_mode_for_engine("localai"),
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
    fn select_entry_file_prefers_gguf_for_localai() {
        let siblings = vec![
            sibling("config.json"),
            sibling("model.safetensors"),
            sibling("weights.gguf"),
        ];
        let entry = select_entry_file(&siblings, None, "localai");
        assert_eq!(entry, Some("weights.gguf".to_string()));
    }

    #[test]
    fn select_entry_file_prefers_model_safetensors_when_no_gguf() {
        let siblings = vec![sibling("config.json"), sibling("model.safetensors")];
        let entry = select_entry_file(&siblings, None, "localai");
        assert_eq!(entry, Some("model.safetensors".to_string()));
    }

    #[test]
    fn select_entry_file_falls_back_to_any_safetensors() {
        let siblings = vec![sibling("config.json"), sibling("weights.safetensors")];
        let entry = select_entry_file(&siblings, None, "localai");
        assert_eq!(entry, Some("weights.safetensors".to_string()));
    }

    #[test]
    fn select_entry_file_uses_manual_entry_when_provided() {
        let siblings = vec![sibling("config.json"), sibling("model.safetensors")];
        let entry = select_entry_file(&siblings, Some("custom.bin"), "localai");
        assert_eq!(entry, Some("custom.bin".to_string()));
    }

    #[test]
    fn select_entry_file_returns_none_for_empty_siblings() {
        let entry = select_entry_file(&[], None, "localai");
        assert_eq!(entry, None);
    }

    #[test]
    fn select_install_files_uses_only_manual_gguf_variant_for_localai() {
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
            "localai",
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
            "localai",
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
    fn infer_engine_nexa_for_npu_tags() {
        let tags = vec!["npu".to_string()];
        let caps = vec!["chat".to_string()];
        let engine = infer_engine("org/model", &tags, &caps);
        assert_eq!(engine, "nexa");
    }

    #[test]
    fn infer_engine_localai_for_chat() {
        let caps = vec!["chat".to_string()];
        let engine = infer_engine("org/model", &[], &caps);
        assert_eq!(engine, "localai");
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
