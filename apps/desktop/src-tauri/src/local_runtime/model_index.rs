use std::cmp::Ordering;
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;

use reqwest::blocking::Client;
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use super::model_registry::list_models;
use super::recommendation::{build_catalog_recommendation, build_recommendation_candidate};
use super::store::runtime_root_dir;
use super::types::{
    now_iso_timestamp, LocalAiDeviceProfile, LocalAiInstallRequest,
    LocalAiRecommendationActionState, LocalAiRecommendationDescriptor,
    LocalAiRecommendationFeedCapability, LocalAiRecommendationFeedSource,
    LocalAiRecommendationFeedCacheState, LocalAiRecommendationFeedDescriptor,
    LocalAiRecommendationFeedEntryDescriptor, LocalAiRecommendationFeedItemDescriptor,
    LocalAiRecommendationInstalledState, LocalAiRecommendationTier, LocalAiModelRecord,
    LocalAiRecommendationConfidence, LocalAiHostSupportClass, LocalAiRecommendationFormat,
};
use super::verified_models::verified_model_list;

const MODEL_INDEX_BASE_URL_ENV: &str = "NIMI_MODEL_INDEX_BASE_URL";
const MODEL_INDEX_CACHE_FILE: &str = "model-index-feed-cache.json";
const DEFAULT_PAGE_SIZE: usize = 40;
const MAX_PAGE_SIZE: usize = 80;
const FETCH_TIMEOUT_SECS: u64 = 15;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RemoteModelFile {
    path: String,
    size_bytes: u64,
    sha256: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RemoteInstallEntry {
    entry_id: String,
    format: String,
    entry: String,
    #[serde(default)]
    files: Vec<RemoteModelFile>,
    total_size_bytes: u64,
    sha256: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RemoteModelEntry {
    repo: String,
    revision: String,
    title: String,
    description: Option<String>,
    #[serde(default)]
    capabilities: Vec<String>,
    #[serde(default)]
    tags: Vec<String>,
    #[serde(default)]
    formats: Vec<String>,
    downloads: Option<u64>,
    likes: Option<u64>,
    last_modified: Option<String>,
    #[serde(default)]
    entries: Vec<RemoteInstallEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RemoteLeaderboardResponse {
    schema_version: String,
    generated_at: String,
    capability: String,
    page: usize,
    page_size: usize,
    total: usize,
    #[serde(default)]
    items: Vec<RemoteModelEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct ModelIndexCacheRecord {
    fetched_at: String,
    #[serde(default)]
    feeds: HashMap<String, RemoteLeaderboardResponse>,
}

fn normalize_capability(value: Option<&str>) -> String {
    let normalized = value.unwrap_or("chat").trim().to_ascii_lowercase();
    match normalized.as_str() {
        "image" | "video" => normalized,
        _ => "chat".to_string(),
    }
}

fn feed_capability(capability: &str) -> LocalAiRecommendationFeedCapability {
    match capability {
        "image" => LocalAiRecommendationFeedCapability::Image,
        "video" => LocalAiRecommendationFeedCapability::Video,
        _ => LocalAiRecommendationFeedCapability::Chat,
    }
}

fn recommendation_format(value: &str) -> Option<LocalAiRecommendationFormat> {
    match value.trim().to_ascii_lowercase().as_str() {
        "gguf" => Some(LocalAiRecommendationFormat::Gguf),
        "safetensors" => Some(LocalAiRecommendationFormat::Safetensors),
        _ => None,
    }
}

fn normalize_page_size(value: Option<usize>) -> usize {
    value.unwrap_or(DEFAULT_PAGE_SIZE).clamp(1, MAX_PAGE_SIZE)
}

fn resolve_model_index_base_url() -> Option<String> {
    std::env::var(MODEL_INDEX_BASE_URL_ENV)
        .ok()
        .map(|value| value.trim().trim_end_matches('/').to_string())
        .filter(|value| !value.is_empty())
}

fn cache_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(runtime_root_dir(app)?.join(MODEL_INDEX_CACHE_FILE))
}

fn load_cache(app: &AppHandle) -> Option<ModelIndexCacheRecord> {
    let path = cache_path(app).ok()?;
    let raw = fs::read_to_string(path).ok()?;
    serde_json::from_str::<ModelIndexCacheRecord>(&raw).ok()
}

fn save_cache(app: &AppHandle, cache: &ModelIndexCacheRecord) -> Result<(), String> {
    let path = cache_path(app)?;
    let serialized = serde_json::to_string_pretty(cache)
        .map_err(|error| format!("MODEL_INDEX_CACHE_SERIALIZE_FAILED: {error}"))?;
    fs::write(path, serialized).map_err(|error| format!("MODEL_INDEX_CACHE_WRITE_FAILED: {error}"))
}

fn build_client() -> Result<Client, String> {
    Client::builder()
        .timeout(std::time::Duration::from_secs(FETCH_TIMEOUT_SECS))
        .build()
        .map_err(|error| format!("MODEL_INDEX_HTTP_CLIENT_FAILED: {error}"))
}

fn fetch_leaderboard(
    base_url: &str,
    capability: &str,
    page_size: usize,
) -> Result<RemoteLeaderboardResponse, String> {
    let client = build_client()?;
    let url = format!(
        "{base_url}/leaderboard?capability={capability}&page=1&pageSize={page_size}"
    );
    let response = client
        .get(url.as_str())
        .send()
        .map_err(|error| format!("MODEL_INDEX_FEED_FETCH_FAILED: {error}"))?;
    if !response.status().is_success() {
        return Err(format!(
            "MODEL_INDEX_FEED_HTTP_STATUS: status={} capability={capability}",
            response.status()
        ));
    }
    response
        .json::<RemoteLeaderboardResponse>()
        .map_err(|error| format!("MODEL_INDEX_FEED_DECODE_FAILED: {error}"))
}

fn cached_feed_for_capability(
    cache: Option<&ModelIndexCacheRecord>,
    capability: &str,
) -> Option<(RemoteLeaderboardResponse, LocalAiRecommendationFeedCacheState)> {
    cache.and_then(|cache| {
        cache
            .feeds
            .get(capability)
            .cloned()
            .map(|feed| (feed, LocalAiRecommendationFeedCacheState::Stale))
    })
}

fn resolve_remote_or_cached_feed<F>(
    base_url: Option<&str>,
    capability: &str,
    page_size: usize,
    cache: Option<&ModelIndexCacheRecord>,
    fetcher: F,
) -> Option<(RemoteLeaderboardResponse, LocalAiRecommendationFeedCacheState)>
where
    F: Fn(&str, &str, usize) -> Result<RemoteLeaderboardResponse, String>,
{
    if let Some(base_url) = base_url {
        return match fetcher(base_url, capability, page_size) {
            Ok(feed) => Some((feed, LocalAiRecommendationFeedCacheState::Fresh)),
            Err(_) => cached_feed_for_capability(cache, capability),
        };
    }
    cached_feed_for_capability(cache, capability)
}

fn preferred_engine_for_capability(capability: &str) -> String {
    if capability.eq_ignore_ascii_case("image") || capability.eq_ignore_ascii_case("video") {
        return "nimi_media".to_string();
    }
    "localai".to_string()
}

fn entry_files(entry: &RemoteInstallEntry) -> Vec<String> {
    entry.files.iter().map(|file| file.path.clone()).collect()
}

fn entry_hashes(entry: &RemoteInstallEntry) -> HashMap<String, String> {
    entry.files
        .iter()
        .filter_map(|file| {
            file.sha256
                .as_ref()
                .map(|hash| (file.path.clone(), hash.clone()))
        })
        .collect()
}

fn installed_state_for_item(
    item: &RemoteModelEntry,
    installed_models: &[LocalAiModelRecord],
) -> LocalAiRecommendationInstalledState {
    if let Some(model) = installed_models
        .iter()
        .find(|model| model.source.repo.eq_ignore_ascii_case(item.repo.as_str()))
    {
        return LocalAiRecommendationInstalledState {
            installed: true,
            local_model_id: Some(model.local_model_id.clone()),
            status: Some(model.status.clone()),
        };
    }
    LocalAiRecommendationInstalledState {
        installed: false,
        local_model_id: None,
        status: None,
    }
}

fn verified_for_item(item: &RemoteModelEntry) -> bool {
    verified_model_list().into_iter().any(|model| {
        model.repo.eq_ignore_ascii_case(item.repo.as_str())
            || model.model_id.eq_ignore_ascii_case(item.repo.as_str())
    })
}

fn recommendation_sort_key(
    recommendation: Option<&LocalAiRecommendationDescriptor>,
    verified: bool,
    source_rank: usize,
) -> (u8, u8, u8, u8, usize) {
    let tier_rank = match recommendation.and_then(|item| item.tier.clone()) {
        Some(LocalAiRecommendationTier::Recommended) => 0,
        Some(LocalAiRecommendationTier::Runnable) => 1,
        Some(LocalAiRecommendationTier::Tight) => 2,
        Some(LocalAiRecommendationTier::NotRecommended) => 3,
        None => 4,
    };
    let host_rank = match recommendation.and_then(|item| item.host_support_class.clone()) {
        Some(LocalAiHostSupportClass::SupportedSupervised) => 0,
        Some(LocalAiHostSupportClass::AttachedOnly) => 1,
        Some(LocalAiHostSupportClass::Unsupported) => 2,
        None => 3,
    };
    let confidence_rank = match recommendation.and_then(|item| item.confidence.clone()) {
        Some(LocalAiRecommendationConfidence::High) => 0,
        Some(LocalAiRecommendationConfidence::Medium) => 1,
        Some(LocalAiRecommendationConfidence::Low) => 2,
        None => 3,
    };
    let verified_rank = if verified { 0 } else { 1 };
    (tier_rank, host_rank, confidence_rank, verified_rank, source_rank)
}

fn compare_feed_items(
    left: &LocalAiRecommendationFeedItemDescriptor,
    left_rank: usize,
    right: &LocalAiRecommendationFeedItemDescriptor,
    right_rank: usize,
) -> Ordering {
    recommendation_sort_key(left.recommendation.as_ref(), left.verified, left_rank)
        .cmp(&recommendation_sort_key(
            right.recommendation.as_ref(),
            right.verified,
            right_rank,
        ))
        .then_with(|| left.title.to_ascii_lowercase().cmp(&right.title.to_ascii_lowercase()))
}

fn build_feed_item(
    item: &RemoteModelEntry,
    capability: &str,
    profile: &LocalAiDeviceProfile,
    installed_models: &[LocalAiModelRecord],
    source_rank: usize,
) -> LocalAiRecommendationFeedItemDescriptor {
    let preferred_engine = preferred_engine_for_capability(capability);
    let entries = item
        .entries
        .iter()
        .filter_map(|entry| {
            Some(LocalAiRecommendationFeedEntryDescriptor {
                entry_id: entry.entry_id.clone(),
                format: recommendation_format(entry.format.as_str())?,
                entry: entry.entry.clone(),
                files: entry_files(entry),
                total_size_bytes: entry.total_size_bytes,
                sha256: entry.sha256.clone(),
            })
        })
        .collect::<Vec<_>>();

    let mut best_recommendation = None::<LocalAiRecommendationDescriptor>;
    let mut best_entry = item.entries.first().cloned();
    for entry in &item.entries {
        let fallback_entries = item
            .entries
            .iter()
            .filter(|candidate| candidate.entry_id != entry.entry_id)
            .map(|candidate| candidate.entry.clone())
            .collect::<Vec<_>>();
        let Some(candidate) = build_recommendation_candidate(
            item.repo.as_str(),
            item.repo.as_str(),
            item.title.as_str(),
            item.capabilities.as_slice(),
            preferred_engine.as_str(),
            Some(entry.entry.as_str()),
            Some(entry.total_size_bytes),
            Some(entry.total_size_bytes),
            fallback_entries,
            item.tags.as_slice(),
        ) else {
            continue;
        };
        let recommendation = build_catalog_recommendation(&candidate, profile);
        let better = match (&best_recommendation, &recommendation) {
            (None, Some(_)) => true,
            (Some(left), Some(right)) => recommendation_sort_key(Some(right), false, source_rank)
                < recommendation_sort_key(Some(left), false, source_rank),
            _ => false,
        };
        if better {
            best_entry = Some(entry.clone());
            best_recommendation = recommendation;
        }
    }

    let chosen_entry_name = best_recommendation
        .as_ref()
        .and_then(|recommendation| recommendation.recommended_entry.clone())
        .or_else(|| best_entry.as_ref().map(|entry| entry.entry.clone()));
    let chosen_entry = item
        .entries
        .iter()
        .find(|entry| Some(entry.entry.clone()) == chosen_entry_name)
        .or(best_entry.as_ref())
        .cloned();

    let installed_state = installed_state_for_item(item, installed_models);
    let verified = verified_for_item(item);
    let action_state = LocalAiRecommendationActionState {
        can_review_install_plan: !installed_state.installed && chosen_entry.is_some(),
        can_open_variants: item.entries.len() > 1,
        can_open_local_model: installed_state.installed,
    };
    let install_payload = if let Some(entry) = chosen_entry.clone() {
        LocalAiInstallRequest {
            model_id: item.repo.clone(),
            repo: item.repo.clone(),
            revision: Some(item.revision.clone()),
            capabilities: Some(item.capabilities.clone()),
            engine: Some(preferred_engine.clone()),
            entry: Some(entry.entry.clone()),
            files: Some(entry_files(&entry)),
            license: None,
            hashes: Some(entry_hashes(&entry)),
            endpoint: None,
            provider_hints: None,
            engine_config: None,
        }
    } else {
        LocalAiInstallRequest {
            model_id: item.repo.clone(),
            repo: item.repo.clone(),
            revision: Some(item.revision.clone()),
            capabilities: Some(item.capabilities.clone()),
            engine: Some(preferred_engine.clone()),
            entry: None,
            files: None,
            license: None,
            hashes: None,
            endpoint: None,
            provider_hints: None,
            engine_config: None,
        }
    };

    LocalAiRecommendationFeedItemDescriptor {
        item_id: format!("model-index:{}:{}", capability, item.repo),
        source: LocalAiRecommendationFeedSource::ModelIndex,
        repo: item.repo.clone(),
        revision: item.revision.clone(),
        title: item.title.clone(),
        description: item.description.clone(),
        capabilities: item.capabilities.clone(),
        tags: item.tags.clone(),
        formats: item
            .formats
            .iter()
            .filter_map(|format| recommendation_format(format.as_str()))
            .collect(),
        downloads: item.downloads,
        likes: item.likes,
        last_modified: item.last_modified.clone(),
        preferred_engine,
        verified,
        entries,
        recommendation: best_recommendation,
        installed_state,
        action_state,
        install_payload,
    }
}

fn materialize_feed_descriptor(
    feed: &RemoteLeaderboardResponse,
    cache_state: LocalAiRecommendationFeedCacheState,
    capability: &str,
    device_profile: LocalAiDeviceProfile,
    installed_models: &[LocalAiModelRecord],
) -> LocalAiRecommendationFeedDescriptor {
    let mut items = feed
        .items
        .iter()
        .enumerate()
        .map(|(index, item)| {
            build_feed_item(
                item,
                capability,
                &device_profile,
                installed_models,
                index,
            )
        })
        .collect::<Vec<_>>();
    items.sort_by(|left, right| {
        let left_rank = feed
            .items
            .iter()
            .position(|item| left.repo == item.repo)
            .unwrap_or(usize::MAX);
        let right_rank = feed
            .items
            .iter()
            .position(|item| right.repo == item.repo)
            .unwrap_or(usize::MAX);
        compare_feed_items(left, left_rank, right, right_rank)
    });

    LocalAiRecommendationFeedDescriptor {
        device_profile,
        active_capability: feed_capability(capability),
        generated_at: Some(feed.generated_at.clone()),
        cache_state,
        items,
    }
}

pub fn load_recommendation_feed(
    app: &AppHandle,
    capability: Option<&str>,
    page_size: Option<usize>,
) -> Result<LocalAiRecommendationFeedDescriptor, String> {
    let normalized_capability = normalize_capability(capability);
    let normalized_page_size = normalize_page_size(page_size);
    let device_profile = super::device_profile::collect_device_profile(app);
    let installed_models = list_models(app).unwrap_or_default();
    let cache = load_cache(app);
    let base_url = resolve_model_index_base_url();
    let remote = resolve_remote_or_cached_feed(
        base_url.as_deref(),
        normalized_capability.as_str(),
        normalized_page_size,
        cache.as_ref(),
        fetch_leaderboard,
    );

    if let Some((feed, LocalAiRecommendationFeedCacheState::Fresh)) = remote.as_ref() {
        let mut next_cache = cache.unwrap_or_default();
        next_cache.fetched_at = now_iso_timestamp();
        next_cache
            .feeds
            .insert(normalized_capability.clone(), feed.clone());
        let _ = save_cache(app, &next_cache);
    }

    let Some((feed, cache_state)) = remote else {
        return Ok(LocalAiRecommendationFeedDescriptor {
            device_profile,
            active_capability: feed_capability(normalized_capability.as_str()),
            generated_at: None,
            cache_state: LocalAiRecommendationFeedCacheState::Empty,
            items: Vec::new(),
        });
    };
    Ok(materialize_feed_descriptor(
        &feed,
        cache_state,
        normalized_capability.as_str(),
        device_profile,
        installed_models.as_slice(),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::local_runtime::types::{
        LocalAiGpuProfile, LocalAiMemoryModel, LocalAiNpuProfile, LocalAiPythonProfile,
        LocalAiPortAvailability, LocalAiRecommendationFeedSource,
    };

    fn profile_fixture() -> LocalAiDeviceProfile {
        LocalAiDeviceProfile {
            os: "darwin".to_string(),
            arch: "arm64".to_string(),
            total_ram_bytes: 64 * 1024 * 1024 * 1024,
            available_ram_bytes: 48 * 1024 * 1024 * 1024,
            gpu: LocalAiGpuProfile {
                available: true,
                vendor: Some("Apple".to_string()),
                model: Some("M4 Max".to_string()),
                total_vram_bytes: None,
                available_vram_bytes: None,
                memory_model: LocalAiMemoryModel::Unified,
            },
            python: LocalAiPythonProfile {
                available: false,
                version: None,
            },
            npu: LocalAiNpuProfile {
                available: false,
                ready: false,
                vendor: None,
                runtime: None,
                detail: None,
            },
            disk_free_bytes: 0,
            ports: vec![LocalAiPortAvailability {
                port: 1234,
                available: true,
            }],
        }
    }

    fn chat_item(repo: &str, title: &str, entry: &str, size_bytes: u64) -> RemoteModelEntry {
        RemoteModelEntry {
            repo: repo.to_string(),
            revision: "main".to_string(),
            title: title.to_string(),
            description: None,
            capabilities: vec!["chat".to_string()],
            tags: vec!["chat".to_string(), "gguf".to_string()],
            formats: vec!["gguf".to_string()],
            downloads: Some(100),
            likes: Some(10),
            last_modified: Some("2026-03-17T10:00:00Z".to_string()),
            entries: vec![RemoteInstallEntry {
                entry_id: format!("gguf:{entry}"),
                format: "gguf".to_string(),
                entry: entry.to_string(),
                files: vec![RemoteModelFile {
                    path: entry.to_string(),
                    size_bytes,
                    sha256: Some(format!("sha256:{entry}")),
                }],
                total_size_bytes: size_bytes,
                sha256: Some(format!("sha256:{entry}")),
            }],
        }
    }

    #[test]
    fn recommendation_sort_key_prefers_better_tier() {
        let higher = LocalAiRecommendationDescriptor {
            source: crate::local_runtime::types::LocalAiRecommendationSource::Llmfit,
            format: None,
            tier: Some(LocalAiRecommendationTier::Recommended),
            host_support_class: Some(LocalAiHostSupportClass::SupportedSupervised),
            confidence: Some(LocalAiRecommendationConfidence::High),
            reason_codes: vec!["a".to_string()],
            recommended_entry: None,
            fallback_entries: Vec::new(),
            suggested_artifacts: Vec::new(),
            suggested_notes: Vec::new(),
            baseline: None,
        };
        let lower = LocalAiRecommendationDescriptor {
            tier: Some(LocalAiRecommendationTier::Tight),
            ..higher.clone()
        };
        assert!(
            recommendation_sort_key(Some(&higher), false, 0)
                < recommendation_sort_key(Some(&lower), false, 0)
        );
    }

    #[test]
    fn build_feed_item_marks_variants_and_install_payload() {
        let item = RemoteModelEntry {
            repo: "Qwen/Qwen2.5-7B-Instruct-GGUF".to_string(),
            revision: "main".to_string(),
            title: "Qwen2.5 7B".to_string(),
            description: None,
            capabilities: vec!["chat".to_string()],
            tags: vec!["gguf".to_string()],
            formats: vec!["gguf".to_string()],
            downloads: Some(10),
            likes: Some(1),
            last_modified: None,
            entries: vec![
                RemoteInstallEntry {
                    entry_id: "q4".to_string(),
                    format: "gguf".to_string(),
                    entry: "model-Q4_K_M.gguf".to_string(),
                    files: vec![RemoteModelFile {
                        path: "model-Q4_K_M.gguf".to_string(),
                        size_bytes: 4 * 1024 * 1024 * 1024,
                        sha256: None,
                    }],
                    total_size_bytes: 4 * 1024 * 1024 * 1024,
                    sha256: None,
                },
                RemoteInstallEntry {
                    entry_id: "q8".to_string(),
                    format: "gguf".to_string(),
                    entry: "model-Q8_0.gguf".to_string(),
                    files: vec![RemoteModelFile {
                        path: "model-Q8_0.gguf".to_string(),
                        size_bytes: 8 * 1024 * 1024 * 1024,
                        sha256: None,
                    }],
                    total_size_bytes: 8 * 1024 * 1024 * 1024,
                    sha256: None,
                },
            ],
        };
        let feed_item = build_feed_item(&item, "chat", &profile_fixture(), &[], 0);
        assert!(feed_item.action_state.can_open_variants);
        assert!(feed_item.action_state.can_review_install_plan);
        assert_eq!(feed_item.install_payload.repo, item.repo);
        assert_eq!(
            feed_item.install_payload.entry.as_deref(),
            feed_item
                .recommendation
                .as_ref()
                .and_then(|item| item.recommended_entry.as_deref())
        );
    }

    #[test]
    fn resolve_remote_or_cached_feed_prefers_fresh_fetch_and_falls_back_to_stale_cache() {
        let cached = ModelIndexCacheRecord {
            fetched_at: "2026-03-17T09:00:00Z".to_string(),
            feeds: HashMap::from([(
                "chat".to_string(),
                RemoteLeaderboardResponse {
                    schema_version: "2.0.0".to_string(),
                    generated_at: "2026-03-17T09:00:00Z".to_string(),
                    capability: "chat".to_string(),
                    page: 1,
                    page_size: 24,
                    total: 1,
                    items: vec![chat_item(
                        "cached/model",
                        "Cached Model",
                        "cached-q4.gguf",
                        4_000_000_000,
                    )],
                },
            )]),
        };

        let fresh = resolve_remote_or_cached_feed(
            Some("https://example.com"),
            "chat",
            24,
            Some(&cached),
            |_, _, _| {
                Ok(RemoteLeaderboardResponse {
                    schema_version: "2.0.0".to_string(),
                    generated_at: "2026-03-17T10:00:00Z".to_string(),
                    capability: "chat".to_string(),
                    page: 1,
                    page_size: 24,
                    total: 1,
                    items: vec![chat_item(
                        "fresh/model",
                        "Fresh Model",
                        "fresh-q4.gguf",
                        3_000_000_000,
                    )],
                })
            },
        )
        .expect("fresh feed");
        assert_eq!(fresh.1, LocalAiRecommendationFeedCacheState::Fresh);
        assert_eq!(fresh.0.items[0].repo, "fresh/model");

        let stale = resolve_remote_or_cached_feed(
            Some("https://example.com"),
            "chat",
            24,
            Some(&cached),
            |_, _, _| Err("network".to_string()),
        )
        .expect("stale fallback");
        assert_eq!(stale.1, LocalAiRecommendationFeedCacheState::Stale);
        assert_eq!(stale.0.items[0].repo, "cached/model");
    }

    #[test]
    fn resolve_remote_or_cached_feed_returns_none_without_source_or_cache() {
        let resolved = resolve_remote_or_cached_feed(None, "chat", 24, None, |_, _, _| {
            Ok(RemoteLeaderboardResponse {
                schema_version: "2.0.0".to_string(),
                generated_at: "2026-03-17T10:00:00Z".to_string(),
                capability: "chat".to_string(),
                page: 1,
                page_size: 24,
                total: 0,
                items: Vec::new(),
            })
        });

        assert!(resolved.is_none());
    }

    #[test]
    fn materialize_feed_descriptor_sorts_by_recommendation_then_source_rank() {
        let feed = RemoteLeaderboardResponse {
            schema_version: "2.0.0".to_string(),
            generated_at: "2026-03-17T10:00:00Z".to_string(),
            capability: "chat".to_string(),
            page: 1,
            page_size: 24,
            total: 2,
            items: vec![
                chat_item("repo/large", "Large", "large-q8.gguf", 96_000_000_000),
                chat_item("repo/small", "Small", "small-q4.gguf", 4_000_000_000),
            ],
        };

        let descriptor = materialize_feed_descriptor(
            &feed,
            LocalAiRecommendationFeedCacheState::Fresh,
            "chat",
            profile_fixture(),
            &[],
        );

        assert_eq!(descriptor.cache_state, LocalAiRecommendationFeedCacheState::Fresh);
        assert_eq!(
            descriptor.active_capability,
            LocalAiRecommendationFeedCapability::Chat
        );
        assert_eq!(descriptor.items[0].repo, "repo/small");
        assert_eq!(descriptor.items[1].repo, "repo/large");
        assert_eq!(
            descriptor.items[0].recommendation.as_ref().and_then(|item| item.tier.clone()),
            Some(LocalAiRecommendationTier::Tight)
        );
        assert_eq!(
            descriptor.items[1].recommendation.as_ref().and_then(|item| item.tier.clone()),
            Some(LocalAiRecommendationTier::NotRecommended)
        );
    }

    #[test]
    fn feed_descriptor_serializes_enum_contract_values() {
        let feed = RemoteLeaderboardResponse {
            schema_version: "2.0.0".to_string(),
            generated_at: "2026-03-17T10:00:00Z".to_string(),
            capability: "chat".to_string(),
            page: 1,
            page_size: 24,
            total: 1,
            items: vec![chat_item("repo/chat", "Chat", "chat-q4.gguf", 4_000_000_000)],
        };

        let descriptor = materialize_feed_descriptor(
            &feed,
            LocalAiRecommendationFeedCacheState::Fresh,
            "chat",
            profile_fixture(),
            &[],
        );
        let payload = serde_json::to_value(&descriptor).expect("serialize feed");

        assert_eq!(payload["activeCapability"], "chat");
        assert_eq!(payload["cacheState"], "fresh");
        assert_eq!(payload["items"][0]["source"], "model-index");
        assert_eq!(payload["items"][0]["entries"][0]["format"], "gguf");
        assert_eq!(descriptor.items[0].source, LocalAiRecommendationFeedSource::ModelIndex);
    }
}
