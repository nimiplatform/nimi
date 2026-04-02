use reqwest::blocking::Client;

use super::model_index::{
    ModelIndexCacheRecord, RemoteLeaderboardResponse, FETCH_TIMEOUT_SECS,
};
use super::types::LocalAiRecommendationFeedCacheState;

pub(super) fn build_client() -> Result<Client, String> {
    Client::builder()
        .timeout(std::time::Duration::from_secs(FETCH_TIMEOUT_SECS))
        .build()
        .map_err(|error| format!("MODEL_INDEX_HTTP_CLIENT_FAILED: {error}"))
}

pub(super) fn fetch_leaderboard(
    base_url: &str,
    capability: &str,
    page_size: usize,
) -> Result<RemoteLeaderboardResponse, String> {
    let client = build_client()?;
    let url = format!("{base_url}/leaderboard?capability={capability}&page=1&pageSize={page_size}");
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

pub(super) fn cached_feed_for_capability(
    cache: Option<&ModelIndexCacheRecord>,
    capability: &str,
) -> Option<(
    RemoteLeaderboardResponse,
    LocalAiRecommendationFeedCacheState,
)> {
    cache.and_then(|cache| {
        cache
            .feeds
            .get(capability)
            .cloned()
            .map(|feed| (feed, LocalAiRecommendationFeedCacheState::Stale))
    })
}

pub(super) fn resolve_remote_or_cached_feed<F>(
    base_url: Option<&str>,
    capability: &str,
    page_size: usize,
    cache: Option<&ModelIndexCacheRecord>,
    fetcher: F,
) -> Option<(
    RemoteLeaderboardResponse,
    LocalAiRecommendationFeedCacheState,
)>
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
