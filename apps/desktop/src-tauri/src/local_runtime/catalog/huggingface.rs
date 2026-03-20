use std::collections::{HashMap, HashSet};
use std::time::Duration;

use serde::Deserialize;

use super::super::hf_source::hf_download_base_url;
use super::super::recommendation::recommend_variant_list;
use super::super::types::{
    CatalogVariantDescriptor, LocalAiCatalogItemDescriptor, LocalAiDeviceProfile,
};
use super::shared::{
    default_endpoint_for_engine, infer_engine, install_available_for_engine, normalize_non_empty,
    provider_hints_for_capabilities, runtime_mode_for_engine,
};

const HF_SEARCH_TIMEOUT_SECS: u64 = 20;

pub(super) fn hf_api_base_url() -> String {
    format!("{}/api/models", hf_download_base_url())
}

#[derive(Debug, Deserialize)]
pub(super) struct HfSearchModel {
    #[serde(default)]
    pub(super) id: String,
    #[serde(default)]
    pub(super) pipeline_tag: Option<String>,
    #[serde(default)]
    pub(super) tags: Vec<String>,
    #[serde(default)]
    pub(super) downloads: Option<u64>,
    #[serde(default)]
    pub(super) likes: Option<u64>,
    #[serde(default)]
    pub(super) sha: Option<String>,
    #[serde(default)]
    pub(super) last_modified: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(super) struct HfModelDetails {
    #[serde(default)]
    pub(super) id: String,
    #[serde(default)]
    pub(super) sha: Option<String>,
    #[serde(default)]
    pub(super) pipeline_tag: Option<String>,
    #[serde(default)]
    pub(super) tags: Vec<String>,
    #[serde(default)]
    pub(super) siblings: Vec<HfModelSibling>,
}

#[derive(Debug, Deserialize)]
pub(super) struct HfModelSibling {
    #[serde(default)]
    pub(super) rfilename: String,
    #[serde(default)]
    pub(super) lfs: Option<HfModelLfs>,
}

#[derive(Debug, Deserialize)]
pub(super) struct HfModelLfs {
    #[serde(default)]
    pub(super) sha256: Option<String>,
    #[serde(default)]
    pub(super) size: Option<u64>,
}

pub(super) fn normalize_hf_repo_slug(input: &str) -> Option<String> {
    let raw = input.trim();
    if raw.is_empty() {
        return None;
    }

    let candidate = if let Some(stripped) = raw.strip_prefix("hf://") {
        stripped
    } else if let Some((_, suffix)) = raw.split_once("huggingface.co/") {
        suffix
    } else {
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

pub(super) fn infer_capabilities(pipeline_tag: Option<&str>, tags: &[String]) -> Vec<String> {
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

pub(super) fn match_catalog_query(item: &LocalAiCatalogItemDescriptor, query: &str) -> bool {
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

pub(super) fn match_catalog_capability(
    item: &LocalAiCatalogItemDescriptor,
    capability: &str,
) -> bool {
    let normalized = capability.trim().to_ascii_lowercase();
    if normalized.is_empty() {
        return true;
    }
    item.capabilities.iter().any(|value| value == &normalized)
}

pub(super) fn normalize_search_query(query: Option<&str>) -> String {
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

pub(super) fn fetch_hf_search_models(
    query: &str,
    limit: usize,
) -> Result<Vec<HfSearchModel>, String> {
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

pub(super) fn fetch_hf_model_details(repo: &str) -> Result<HfModelDetails, String> {
    let client = build_hf_client()?;
    let api_base = hf_api_base_url();
    let url = format!("{api_base}/{repo}");
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

pub(super) fn hf_search_to_catalog_item(
    item: HfSearchModel,
    profile: &LocalAiDeviceProfile,
) -> Option<LocalAiCatalogItemDescriptor> {
    let repo = normalize_hf_repo_slug(item.id.as_str())?;
    let title = repo.split('/').nth(1).unwrap_or(repo.as_str()).to_string();
    let capabilities = infer_capabilities(item.pipeline_tag.as_deref(), &item.tags);
    let engine = infer_engine(repo.as_str(), &item.tags, &capabilities);
    let endpoint = default_endpoint_for_engine(engine.as_str());
    let engine_runtime_mode = runtime_mode_for_engine(engine.as_str(), profile);
    let provider_hints =
        provider_hints_for_capabilities(capabilities.as_slice(), engine.as_str(), profile);
    let install_available = install_available_for_engine(
        engine.as_str(),
        &engine_runtime_mode,
        Some(endpoint.as_str()),
        profile,
    );

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
        engine_runtime_mode,
        engine,
        install_kind: "hf-catalog-resolve-required".to_string(),
        install_available,
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
        engine_config: None,
        recommendation: None,
    })
}

pub(super) fn sibling_size_bytes(sibling: &HfModelSibling) -> Option<u64> {
    sibling.lfs.as_ref().and_then(|value| value.size)
}

pub(super) fn known_total_size_bytes(siblings: &[HfModelSibling], files: &[String]) -> Option<u64> {
    let mut total = 0_u64;
    let mut any = false;
    for file in files {
        let Some(size) = siblings
            .iter()
            .find(|item| item.rfilename.trim() == file)
            .and_then(sibling_size_bytes)
        else {
            continue;
        };
        total = total.saturating_add(size);
        any = true;
    }
    if any {
        Some(total)
    } else {
        None
    }
}

fn variant_format_for_entry(entry: &str) -> String {
    let normalized = entry.trim().to_ascii_lowercase();
    if normalized.ends_with(".gguf") {
        return "gguf".to_string();
    }
    if normalized.ends_with(".safetensors") {
        return "safetensors".to_string();
    }
    "unknown".to_string()
}

pub(super) fn normalize_hf_file_path(value: &str) -> Option<String> {
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

pub(super) fn select_entry_file(
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

    if engine.trim().eq_ignore_ascii_case("llama") {
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

pub(super) fn select_install_files(
    siblings: &[HfModelSibling],
    entry: &str,
    manual_entry: Option<&str>,
    manual_files: Option<&[String]>,
    engine: &str,
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

    let manual_entry_matches_selected_gguf =
        normalize_hf_file_path(manual_entry.unwrap_or_default()).as_deref() == Some(entry)
            && entry.to_ascii_lowercase().ends_with(".gguf")
            && engine.trim().eq_ignore_ascii_case("llama");
    if manual_entry_matches_selected_gguf {
        return vec![entry.to_string()];
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

pub(super) fn resolve_hashes_for_files(
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

pub(super) fn infer_license(tags: &[String], manual: Option<&str>) -> String {
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

pub fn list_repo_catalog_variants(
    repo: &str,
    model_id: &str,
    title: &str,
    capabilities: &[String],
    engine: &str,
    profile: &LocalAiDeviceProfile,
    tags: &[String],
) -> Result<Vec<CatalogVariantDescriptor>, String> {
    let details = fetch_hf_model_details(repo)?;
    let mut variants = Vec::<CatalogVariantDescriptor>::new();
    for sibling in &details.siblings {
        let name_lower = sibling.rfilename.to_ascii_lowercase();
        if !name_lower.ends_with(".gguf") && !name_lower.ends_with(".safetensors") {
            continue;
        }
        let (size_bytes, sha256) = match &sibling.lfs {
            Some(lfs) => (lfs.size, lfs.sha256.clone()),
            None => (None, None),
        };
        let entry = sibling.rfilename.clone();
        let files = select_install_files(
            &details.siblings,
            entry.as_str(),
            Some(entry.as_str()),
            None,
            engine,
        );
        variants.push(CatalogVariantDescriptor {
            filename: sibling.rfilename.clone(),
            entry,
            files,
            format: variant_format_for_entry(sibling.rfilename.as_str()),
            size_bytes,
            sha256,
            recommendation: None,
        });
    }
    variants.sort_by(|a, b| a.size_bytes.unwrap_or(0).cmp(&b.size_bytes.unwrap_or(0)));
    recommend_variant_list(
        model_id,
        repo,
        title,
        capabilities,
        engine,
        variants.as_mut_slice(),
        profile,
        tags,
    );
    Ok(variants)
}
