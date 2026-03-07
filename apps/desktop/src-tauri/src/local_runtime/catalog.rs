use std::collections::{HashMap, HashSet};
use std::time::Duration;

use serde::Deserialize;

use super::hf_source::hf_download_base_url;
use super::import_validator::{normalize_and_validate_capabilities, validate_loopback_endpoint};
use super::provider_adapter::{
    default_provider_hints_for_provider_capability, provider_from_engine,
};
use super::service_artifacts::find_service_artifact;
use super::types::{
    slugify_local_model_id, LocalAiCatalogItemDescriptor, LocalAiEngineRuntimeMode,
    LocalAiInstallPlanDescriptor, LocalAiProviderHints, LocalAiVerifiedModelDescriptor,
    DEFAULT_LOCAL_RUNTIME_ENDPOINT,
};
use super::verified_models::{find_verified_model, verified_model_list};

fn hf_api_base_url() -> String {
    format!("{}/api/models", hf_download_base_url())
}

const HF_SEARCH_TIMEOUT_SECS: u64 = 20;
const HF_SEARCH_LIMIT_MIN: usize = 1;
const HF_SEARCH_LIMIT_MAX: usize = 80;

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

#[derive(Debug, Deserialize)]
struct HfSearchModel {
    #[serde(default)]
    id: String,
    #[serde(default)]
    pipeline_tag: Option<String>,
    #[serde(default)]
    tags: Vec<String>,
    #[serde(default)]
    downloads: Option<u64>,
    #[serde(default)]
    likes: Option<u64>,
    #[serde(default)]
    sha: Option<String>,
    #[serde(default)]
    last_modified: Option<String>,
}

#[derive(Debug, Deserialize)]
struct HfModelDetails {
    #[serde(default)]
    id: String,
    #[serde(default)]
    sha: Option<String>,
    #[serde(default)]
    pipeline_tag: Option<String>,
    #[serde(default)]
    tags: Vec<String>,
    #[serde(default)]
    siblings: Vec<HfModelSibling>,
}

#[derive(Debug, Deserialize)]
struct HfModelSibling {
    #[serde(default)]
    rfilename: String,
    #[serde(default)]
    lfs: Option<HfModelLfs>,
}

#[derive(Debug, Deserialize)]
struct HfModelLfs {
    #[serde(default)]
    sha256: Option<String>,
}

fn normalize_non_empty(value: Option<&str>) -> Option<String> {
    let normalized = value.unwrap_or_default().trim();
    if normalized.is_empty() {
        None
    } else {
        Some(normalized.to_string())
    }
}

fn normalize_install_limit(value: usize) -> usize {
    value.clamp(HF_SEARCH_LIMIT_MIN, HF_SEARCH_LIMIT_MAX)
}

fn runtime_mode_for_engine(engine: &str) -> LocalAiEngineRuntimeMode {
    let _ = engine;
    LocalAiEngineRuntimeMode::Supervised
}

fn service_artifact_preflight_port(service_identity: &str) -> Option<u16> {
    let artifact = find_service_artifact(service_identity)?;
    artifact.preflight.iter().find_map(|rule| {
        if !rule.check.trim().eq_ignore_ascii_case("port-available") {
            return None;
        }
        rule.params
            .as_ref()
            .and_then(|value| value.get("port"))
            .and_then(|value| value.as_u64())
            .and_then(|value| u16::try_from(value).ok())
            .filter(|value| *value > 0)
    })
}

fn default_endpoint_for_engine(engine: &str) -> String {
    let port = service_artifact_preflight_port(engine);
    if let Some(port) = port {
        return format!("http://127.0.0.1:{port}/v1");
    }
    DEFAULT_LOCAL_RUNTIME_ENDPOINT.to_string()
}

fn infer_engine(repo: &str, tags: &[String], capabilities: &[String]) -> String {
    let normalized_repo = repo.trim().to_ascii_lowercase();
    let joined_tags = tags.join(" ").to_ascii_lowercase();

    if normalized_repo.contains("nexa")
        || joined_tags.contains("nexa")
        || joined_tags.contains("npu")
        || joined_tags.contains("rerank")
        || joined_tags.contains("diarize")
        || capabilities.iter().any(|item| item == "rerank")
    {
        return "nexa".to_string();
    }

    if normalized_repo.contains("localai")
        || joined_tags.contains("localai")
        || normalized_repo.contains("whisper")
        || normalized_repo.contains("stable-diffusion")
        || capabilities.iter().any(|item| {
            item == "chat"
                || item == "embedding"
                || item == "stt"
                || item == "tts"
                || item == "image"
                || item == "video"
        })
    {
        return "localai".to_string();
    }
    "localai".to_string()
}

fn provider_hints_for_capabilities(
    capabilities: &[String],
    engine: &str,
) -> Option<LocalAiProviderHints> {
    let provider = provider_from_engine(engine);
    for capability in capabilities {
        if let Some(hints) =
            default_provider_hints_for_provider_capability(provider.as_str(), capability.as_str())
        {
            return Some(hints);
        }
    }
    None
}

fn normalize_hf_repo_slug(input: &str) -> Option<String> {
    let raw = input.trim();
    if raw.is_empty() {
        return None;
    }

    let candidate = if let Some(stripped) = raw.strip_prefix("hf://") {
        stripped
    } else if let Some((_, suffix)) = raw.split_once("huggingface.co/") {
        suffix
    } else {
        // Try mirror host extraction.
        let base = hf_download_base_url();
        let mirror_host = base
            .strip_prefix("https://")
            .or_else(|| base.strip_prefix("http://"))
            .unwrap_or("");
        if !mirror_host.is_empty() && mirror_host != "huggingface.co" {
            if let Some((_, suffix)) = raw.split_once(&format!("{mirror_host}/")) {
                suffix
            } else {
                raw
            }
        } else {
            raw
        }
    };

    let candidate = candidate
        .split(['?', '#'])
        .next()
        .unwrap_or(candidate)
        .trim_matches('/');
    if candidate.is_empty() {
        return None;
    }

    if let Some((prefix, _)) = candidate.split_once("/resolve/") {
        return Some(prefix.trim_matches('/').to_string());
    }

    let parts = candidate.split('/').collect::<Vec<_>>();
    if parts.len() < 2 {
        return None;
    }

    Some(format!("{}/{}", parts[0], parts[1]))
}

fn infer_capabilities(pipeline_tag: Option<&str>, tags: &[String]) -> Vec<String> {
    let mut output = Vec::<String>::new();

    let push_unique = |values: &mut Vec<String>, capability: &str| {
        if !values.iter().any(|item| item == capability) {
            values.push(capability.to_string());
        }
    };

    let pipeline = pipeline_tag.unwrap_or_default().trim().to_ascii_lowercase();
    if pipeline == "text-generation"
        || pipeline == "text2text-generation"
        || pipeline == "chatal"
        || pipeline == "chat-completion"
    {
        push_unique(&mut output, "chat");
    }
    if pipeline == "text-to-image" || pipeline == "image-to-image" {
        push_unique(&mut output, "image");
    }
    if pipeline == "text-to-video" || pipeline == "image-to-video" || pipeline == "video-generation"
    {
        push_unique(&mut output, "video");
    }
    if pipeline == "text-to-speech" || pipeline == "text-to-audio" || pipeline == "audio-to-audio" {
        push_unique(&mut output, "tts");
    }
    if pipeline == "automatic-speech-recognition"
        || pipeline == "speech-to-text"
        || pipeline == "audio-to-text"
    {
        push_unique(&mut output, "stt");
    }
    if pipeline == "feature-extraction" || pipeline == "sentence-similarity" {
        push_unique(&mut output, "embedding");
    }

    for tag in tags {
        let normalized = tag.trim().to_ascii_lowercase();
        if normalized.contains("text-generation")
            || normalized.contains("chat")
            || normalized.contains("instruct")
        {
            push_unique(&mut output, "chat");
        }
        if normalized.contains("text-to-image") || normalized.contains("image-generation") {
            push_unique(&mut output, "image");
        }
        if normalized.contains("text-to-video") || normalized.contains("video-generation") {
            push_unique(&mut output, "video");
        }
        if normalized.contains("text-to-speech") || normalized.contains("tts") {
            push_unique(&mut output, "tts");
        }
        if normalized.contains("speech-to-text")
            || normalized.contains("asr")
            || normalized.contains("stt")
        {
            push_unique(&mut output, "stt");
        }
        if normalized.contains("embedding") || normalized.contains("feature-extraction") {
            push_unique(&mut output, "embedding");
        }
    }

    if output.is_empty() {
        output.push("chat".to_string());
    }

    output
}

fn match_catalog_query(item: &LocalAiCatalogItemDescriptor, query: &str) -> bool {
    let normalized = query.trim().to_ascii_lowercase();
    if normalized.is_empty() {
        return true;
    }

    item.model_id
        .to_ascii_lowercase()
        .contains(normalized.as_str())
        || item.repo.to_ascii_lowercase().contains(normalized.as_str())
        || item
            .title
            .to_ascii_lowercase()
            .contains(normalized.as_str())
        || item
            .description
            .to_ascii_lowercase()
            .contains(normalized.as_str())
        || item
            .tags
            .iter()
            .any(|tag| tag.to_ascii_lowercase().contains(normalized.as_str()))
}

fn match_catalog_capability(item: &LocalAiCatalogItemDescriptor, capability: &str) -> bool {
    let normalized = capability.trim().to_ascii_lowercase();
    if normalized.is_empty() {
        return true;
    }
    item.capabilities.iter().any(|value| value == &normalized)
}

fn normalize_search_query(query: Option<&str>) -> String {
    query
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "llama gguf".to_string())
}

fn hf_user_agent() -> String {
    std::env::var("NIMI_LOCAL_AI_HF_USER_AGENT")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "nimi-desktop/0.1 local-ai-runtime".to_string())
}

fn build_hf_client() -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(HF_SEARCH_TIMEOUT_SECS))
        .build()
        .map_err(|error| {
            format!("LOCAL_AI_CATALOG_HTTP_CLIENT_FAILED: failed to create HF API client: {error}")
        })
}

fn fetch_hf_search_models(query: &str, limit: usize) -> Result<Vec<HfSearchModel>, String> {
    let client = build_hf_client()?;
    let api_base = hf_api_base_url();
    let response = client
        .get(&api_base)
        .query(&[
            ("search", query),
            ("limit", &limit.to_string()),
            ("full", "true"),
            ("sort", "downloads"),
            ("direction", "-1"),
        ])
        .header(reqwest::header::USER_AGENT, hf_user_agent())
        .send()
        .map_err(|error| {
            format!("LOCAL_AI_CATALOG_HF_SEARCH_FAILED: huggingface search request failed: {error}")
        })?;

    if !response.status().is_success() {
        return Err(format!(
            "LOCAL_AI_CATALOG_HF_SEARCH_FAILED: huggingface search status={} query={} ",
            response.status().as_u16(),
            query
        ));
    }

    let body = response.text().map_err(|error| {
        format!(
            "LOCAL_AI_CATALOG_HF_SEARCH_FAILED: failed to read huggingface search payload: {error}"
        )
    })?;
    serde_json::from_str::<Vec<HfSearchModel>>(body.as_str()).map_err(|error| {
        format!("LOCAL_AI_CATALOG_HF_SEARCH_FAILED: invalid huggingface search payload: {error}")
    })
}

fn fetch_hf_model_details(repo: &str) -> Result<HfModelDetails, String> {
    let client = build_hf_client()?;
    let api_base = hf_api_base_url();
    let repo_encoded = repo.replace('/', "%2F");
    let url = format!("{api_base}/{repo_encoded}");
    let response = client
        .get(url)
        .query(&[("full", "true")])
        .header(reqwest::header::USER_AGENT, hf_user_agent())
        .send()
        .map_err(|error| {
            format!(
                "LOCAL_AI_INSTALL_PLAN_RESOLVE_FAILED: huggingface model details request failed: {error}"
            )
        })?;

    if !response.status().is_success() {
        return Err(format!(
            "LOCAL_AI_INSTALL_PLAN_RESOLVE_FAILED: huggingface model details status={} repo={repo}",
            response.status().as_u16(),
        ));
    }

    let body = response.text().map_err(|error| {
        format!(
            "LOCAL_AI_INSTALL_PLAN_RESOLVE_FAILED: failed to read huggingface model details payload: {error}"
        )
    })?;
    serde_json::from_str::<HfModelDetails>(body.as_str()).map_err(|error| {
        format!(
            "LOCAL_AI_INSTALL_PLAN_RESOLVE_FAILED: invalid huggingface model details payload: {error}"
        )
    })
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
    }
}

fn hf_search_to_catalog_item(item: HfSearchModel) -> Option<LocalAiCatalogItemDescriptor> {
    let repo = normalize_hf_repo_slug(item.id.as_str())?;
    let title = repo.split('/').nth(1).unwrap_or(repo.as_str()).to_string();
    let capabilities = infer_capabilities(item.pipeline_tag.as_deref(), &item.tags);
    let engine = infer_engine(repo.as_str(), &item.tags, &capabilities);
    let endpoint = default_endpoint_for_engine(engine.as_str());
    let provider_hints = provider_hints_for_capabilities(capabilities.as_slice(), engine.as_str());

    Some(LocalAiCatalogItemDescriptor {
        item_id: format!("hf:{repo}"),
        source: "huggingface".to_string(),
        title,
        description: format!(
            "Hugging Face catalog model ({})",
            item.pipeline_tag
                .clone()
                .unwrap_or_else(|| "pipeline:unknown".to_string())
        ),
        model_id: repo.clone(),
        repo,
        revision: item.sha.unwrap_or_else(|| "main".to_string()),
        template_id: None,
        capabilities,
        engine_runtime_mode: runtime_mode_for_engine(engine.as_str()),
        engine,
        install_kind: "hf-catalog-resolve-required".to_string(),
        install_available: true,
        endpoint: Some(endpoint),
        provider_hints,
        entry: None,
        files: Vec::new(),
        license: None,
        hashes: HashMap::new(),
        tags: item.tags,
        downloads: item.downloads,
        likes: item.likes,
        last_modified: item.last_modified,
        verified: false,
    })
}

fn normalize_hf_file_path(value: &str) -> Option<String> {
    let normalized = value.trim().replace('\\', "/");
    if normalized.is_empty() {
        return None;
    }
    if normalized.starts_with('/') {
        return None;
    }
    if normalized.split('/').any(|segment| segment == "..") {
        return None;
    }
    Some(normalized)
}

fn select_entry_file(
    siblings: &[HfModelSibling],
    manual_entry: Option<&str>,
    engine: &str,
) -> Option<String> {
    if let Some(entry) = normalize_hf_file_path(manual_entry.unwrap_or_default()) {
        return Some(entry);
    }

    let mut candidates = siblings
        .iter()
        .filter_map(|item| normalize_hf_file_path(item.rfilename.as_str()))
        .collect::<Vec<_>>();

    if candidates.is_empty() {
        return None;
    }

    if engine.trim().eq_ignore_ascii_case("localai") {
        if let Some(found) = candidates
            .iter()
            .find(|item| item.to_ascii_lowercase().ends_with(".gguf"))
        {
            return Some(found.clone());
        }
        if let Some(found) = candidates
            .iter()
            .find(|item| item == &&"model.safetensors".to_string())
        {
            return Some(found.clone());
        }
        if let Some(found) = candidates
            .iter()
            .find(|item| item.to_ascii_lowercase().ends_with(".safetensors"))
        {
            return Some(found.clone());
        }
    }

    candidates.sort();
    candidates.into_iter().next()
}

fn select_install_files(
    siblings: &[HfModelSibling],
    entry: &str,
    manual_files: Option<&[String]>,
) -> Vec<String> {
    if let Some(raw_files) = manual_files {
        let mut seen = HashSet::<String>::new();
        let mut output = Vec::<String>::new();
        if seen.insert(entry.to_string()) {
            output.push(entry.to_string());
        }
        for file in raw_files {
            if let Some(normalized) = normalize_hf_file_path(file.as_str()) {
                if seen.insert(normalized.clone()) {
                    output.push(normalized);
                }
            }
        }
        return output;
    }

    let preferred_files = [
        "config.json",
        "generation_config.json",
        "tokenizer.json",
        "tokenizer.model",
        "tokenizer_config.json",
        "merges.txt",
        "vocab.json",
        "preprocessor_config.json",
    ];

    let sibling_files = siblings
        .iter()
        .filter_map(|item| normalize_hf_file_path(item.rfilename.as_str()))
        .collect::<Vec<_>>();

    let mut seen = HashSet::<String>::new();
    let mut output = Vec::<String>::new();
    if seen.insert(entry.to_string()) {
        output.push(entry.to_string());
    }

    for preferred in preferred_files {
        if sibling_files.iter().any(|item| item == preferred) && seen.insert(preferred.to_string())
        {
            output.push(preferred.to_string());
        }
    }

    for file in sibling_files {
        if output.len() >= 12 {
            break;
        }
        if seen.insert(file.clone()) {
            output.push(file);
        }
    }

    output
}

fn resolve_hashes_for_files(
    siblings: &[HfModelSibling],
    files: &[String],
    manual_hashes: Option<&HashMap<String, String>>,
) -> HashMap<String, String> {
    let mut output = HashMap::<String, String>::new();

    if let Some(raw_hashes) = manual_hashes {
        for (key, value) in raw_hashes {
            let normalized_key = key.trim();
            let normalized_hash = value.trim();
            if normalized_key.is_empty() || normalized_hash.is_empty() {
                continue;
            }
            output.insert(normalized_key.to_string(), normalized_hash.to_string());
        }
    }

    for file in files {
        if output.contains_key(file) {
            continue;
        }
        let matched = siblings.iter().find(|item| item.rfilename.trim() == file);
        let Some(hash) = matched
            .and_then(|item| item.lfs.as_ref())
            .and_then(|lfs| lfs.sha256.as_ref())
            .map(|value| value.trim())
            .filter(|value| !value.is_empty())
        else {
            continue;
        };
        output.insert(file.clone(), format!("sha256:{hash}"));
    }

    output
}

fn infer_license(tags: &[String], manual: Option<&str>) -> String {
    if let Some(manual_value) = normalize_non_empty(manual) {
        return manual_value;
    }

    for tag in tags {
        if let Some((prefix, suffix)) = tag.split_once(':') {
            if prefix.trim().eq_ignore_ascii_case("license") {
                let value = suffix.trim();
                if !value.is_empty() {
                    return value.to_string();
                }
            }
        }
    }

    "unknown".to_string()
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
        input.files.as_deref(),
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
    })
}

#[cfg(test)]
mod tests {
    use super::{
        hf_api_base_url, infer_capabilities, infer_engine, infer_license, match_catalog_capability,
        match_catalog_query, normalize_hf_file_path, normalize_hf_repo_slug,
        normalize_install_limit, normalize_search_query, runtime_mode_for_engine,
        select_entry_file, HfModelSibling,
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
