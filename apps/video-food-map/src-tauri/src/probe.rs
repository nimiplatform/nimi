use std::env;
use std::path::Path;
use std::process::Command;
use std::time::Duration;

use chrono::{TimeZone, Utc};
use reqwest::blocking::Client;
use reqwest::header::{
    ACCEPT, ACCEPT_LANGUAGE, HeaderMap, HeaderValue, ORIGIN, REFERER, USER_AGENT,
};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use url::Url;

const GEOCODER_PROVIDER: &str = "amap";
const AMAP_GEOCODE_ENDPOINT: &str = "https://restapi.amap.com/v3/geocode/geo";
const AMAP_PLACE_TEXT_ENDPOINT: &str = "https://restapi.amap.com/v3/place/text";
const BILIBILI_CREATOR_PROFILE_ENDPOINT: &str = "https://api.bilibili.com/x/space/acc/info";
const BILIBILI_CREATOR_DYNAMIC_VIDEO_LIST_ENDPOINT: &str =
    "https://api.bilibili.com/x/polymer/web-dynamic/desktop/v1/feed/space";
const BILIBILI_VIDEO_PAGE_URL: &str = "https://www.bilibili.com/video/";
const BILIBILI_CREATOR_PAGE_URL: &str = "https://space.bilibili.com/";
const BILIBILI_REFERER: &str = "https://www.bilibili.com/";
const BILIBILI_ORIGIN: &str = "https://www.bilibili.com";
const BILIBILI_BROWSER_USER_AGENT: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36";
const BILIBILI_ACCEPT: &str = "application/json, text/plain, */*";
const BILIBILI_ACCEPT_LANGUAGE: &str = "zh-CN,zh;q=0.9,en;q=0.8";
const BILIBILI_CREATOR_RECENT_VIDEO_LIMIT: usize = 12;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProbeMetadata {
    pub bvid: String,
    pub aid: String,
    pub cid: String,
    pub title: String,
    pub owner_mid: String,
    pub owner_name: String,
    pub duration_sec: f64,
    pub description: String,
    pub tags: Vec<String>,
    pub canonical_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProbeExtractionCoverage {
    pub state: String,
    pub processed_segment_count: i64,
    pub processed_duration_sec: f64,
    pub total_duration_sec: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProbeSavedFiles {
    pub metadata_json: String,
    pub transcript_text: String,
    pub extraction_raw_text: String,
    pub extraction_json: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProbeCommentClue {
    pub comment_id: String,
    pub author_name: String,
    pub message: String,
    pub like_count: i64,
    pub published_at: String,
    pub matched_venue_names: Vec<String>,
    pub address_hint: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProbeResult {
    pub metadata: ProbeMetadata,
    pub audio_source_url: String,
    pub selected_stt_model: String,
    pub selected_text_model: String,
    pub raw_comment_count: i64,
    pub comment_clues: Vec<ProbeCommentClue>,
    pub extraction_coverage: ProbeExtractionCoverage,
    pub transcript: String,
    pub extraction_raw: String,
    pub extraction_json: Option<Value>,
    pub output_dir: String,
    pub saved_files: ProbeSavedFiles,
}

#[derive(Debug, Clone)]
pub struct GeocodeOutcome {
    pub provider: String,
    pub status: String,
    pub query: String,
    pub latitude: Option<f64>,
    pub longitude: Option<f64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatorVideoCandidate {
    pub bvid: String,
    pub title: String,
    pub canonical_url: String,
    pub published_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatorVideoFeed {
    pub creator_mid: String,
    pub creator_name: String,
    pub source_url: String,
    pub videos: Vec<CreatorVideoCandidate>,
}

#[derive(Debug, Deserialize)]
struct BilibiliApiEnvelope<T> {
    code: i64,
    message: Option<String>,
    data: Option<T>,
}

#[derive(Debug, Deserialize)]
struct BilibiliCreatorProfileData {
    name: Option<String>,
}

#[derive(Debug, Deserialize)]
struct BilibiliCreatorDynamicFeedData {
    items: Option<Vec<BilibiliCreatorDynamicItem>>,
}

#[derive(Debug, Deserialize)]
struct BilibiliCreatorDynamicItem {
    #[serde(rename = "type")]
    item_type: Option<String>,
    modules: Option<Vec<BilibiliCreatorDynamicModule>>,
}

#[derive(Debug, Deserialize)]
struct BilibiliCreatorDynamicModule {
    module_author: Option<BilibiliCreatorDynamicAuthorModule>,
    module_dynamic: Option<BilibiliCreatorDynamicContentModule>,
}

#[derive(Debug, Deserialize)]
struct BilibiliCreatorDynamicAuthorModule {
    pub_ts: Option<i64>,
    user: Option<BilibiliCreatorDynamicAuthorUser>,
}

#[derive(Debug, Deserialize)]
struct BilibiliCreatorDynamicAuthorUser {
    name: Option<String>,
}

#[derive(Debug, Deserialize)]
struct BilibiliCreatorDynamicContentModule {
    dyn_archive: Option<BilibiliCreatorDynamicArchive>,
}

#[derive(Debug, Deserialize)]
struct BilibiliCreatorDynamicArchive {
    bvid: Option<String>,
    title: Option<String>,
}

#[derive(Debug, Deserialize)]
struct AmapGeocodeRow {
    location: String,
}

#[derive(Debug, Deserialize)]
struct AmapGeocodeResponse {
    status: String,
    geocodes: Option<Vec<AmapGeocodeRow>>,
}

#[derive(Debug, Deserialize)]
struct AmapPlacePoi {
    location: String,
}

#[derive(Debug, Deserialize)]
struct AmapPlaceSearchResponse {
    status: String,
    pois: Option<Vec<AmapPlacePoi>>,
}

fn spawn_probe_command(url: &str) -> Result<String, String> {
    let repo_root = crate::script_runner::repo_root()?;
    let command_path = crate::script_runner::best_command_path()?;
    let script_path =
        repo_root.join("apps/video-food-map/scripts/run-bilibili-food-video-probe.mts");
    let grpc_addr = crate::runtime_daemon::ensure_running()?;
    let settings_json = serde_json::to_string(
        &crate::settings::load_settings().unwrap_or_default(),
    )
    .map_err(|error| format!("failed to encode video-food-map settings for probe: {error}"))?;
    let output = Command::new(&command_path)
        .arg(script_path.as_os_str())
        .arg("--url")
        .arg(url)
        .current_dir(&repo_root)
        .env("PATH", crate::script_runner::normalize_path_env())
        .env("NIMI_RUNTIME_GRPC_ADDR", grpc_addr)
        .env("NIMI_VIDEO_FOOD_MAP_SETTINGS_JSON", settings_json)
        .output()
        .map_err(|error| format!("failed to start probe command: {error}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        return Err(format!(
            "probe command failed with status {}.\nstdout={}\nstderr={}",
            output.status,
            stdout.trim(),
            stderr.trim(),
        ));
    }

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

pub fn run_probe(url: &str) -> Result<ProbeResult, String> {
    let stdout = spawn_probe_command(url)?;
    serde_json::from_str::<ProbeResult>(&stdout)
        .map_err(|error| format!("probe returned invalid json: {error}"))
}

pub fn extract_bvid_hint(url: &str) -> String {
    let chars: Vec<char> = url.chars().collect();
    for index in 0..chars.len() {
        if chars[index] != 'B' {
            continue;
        }
        if chars.get(index + 1) != Some(&'V') {
            continue;
        }
        let mut end = index + 2;
        while end < chars.len() && chars[end].is_ascii_alphanumeric() {
            end += 1;
        }
        if end > index + 2 {
            return chars[index..end].iter().collect();
        }
    }
    String::new()
}

fn normalize_bvid_hint(value: &str) -> String {
    value.trim().to_string()
}

fn normalize_bilibili_creator_mid(value: &str) -> String {
    value
        .chars()
        .filter(|char| char.is_ascii_digit())
        .collect::<String>()
}

fn parse_creator_mid_from_url(url: &Url) -> String {
    if let Some(mid) = url
        .query_pairs()
        .find(|(key, _)| key == "mid")
        .map(|(_, value)| normalize_bilibili_creator_mid(&value))
        .filter(|value| !value.is_empty())
    {
        return mid;
    }

    let host = url.host_str().unwrap_or_default().to_ascii_lowercase();
    let segments = url
        .path_segments()
        .map(|segments| segments.collect::<Vec<_>>())
        .unwrap_or_default();

    if host == "space.bilibili.com" {
        return segments
            .first()
            .map(|segment| normalize_bilibili_creator_mid(segment))
            .filter(|value| !value.is_empty())
            .unwrap_or_default();
    }

    if (host == "www.bilibili.com" || host == "m.bilibili.com" || host == "bilibili.com")
        && segments.first() == Some(&"space")
    {
        return segments
            .get(1)
            .map(|segment| normalize_bilibili_creator_mid(segment))
            .filter(|value| !value.is_empty())
            .unwrap_or_default();
    }

    String::new()
}

pub fn extract_bilibili_creator_mid(input: &str) -> String {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    if trimmed.chars().all(|char| char.is_ascii_digit()) {
        return trimmed.to_string();
    }
    let Ok(parsed) = Url::parse(trimmed) else {
        return String::new();
    };
    parse_creator_mid_from_url(&parsed)
}

pub fn canonicalize_bilibili_creator_url(input: &str) -> Result<String, String> {
    let mid = extract_bilibili_creator_mid(input);
    if mid.is_empty() {
        return Err(
            "现在只支持标准的 Bilibili 博主主页链接，例如 https://space.bilibili.com/123456"
                .to_string(),
        );
    }
    Ok(format!("{BILIBILI_CREATOR_PAGE_URL}{mid}"))
}

fn published_at_to_iso(timestamp: i64) -> String {
    Utc.timestamp_opt(timestamp, 0)
        .single()
        .map(|value| value.to_rfc3339_opts(chrono::SecondsFormat::Secs, true))
        .unwrap_or_default()
}

fn request_json_with_referer<T: DeserializeOwned>(
    client: &Client,
    url: &str,
    referer: &str,
) -> Result<T, String> {
    client
        .get(url)
        .header(REFERER, referer)
        .header(ORIGIN, BILIBILI_ORIGIN)
        .send()
        .map_err(|error| format!("request failed: {error}"))?
        .error_for_status()
        .map_err(|error| format!("request returned non-success status: {error}"))?
        .json::<T>()
        .map_err(|error| format!("response decode failed: {error}"))
}

fn normalize_bilibili_api_message(raw: &str) -> String {
    let normalized = raw.trim();
    match normalized {
        "-352" => "风控校验失败".to_string(),
        "-799" => "请求过于频繁，请稍后再试".to_string(),
        _ => normalized.to_string(),
    }
}

fn prime_bilibili_creator_session(client: &Client, source_url: &str) -> Result<(), String> {
    client
        .get(source_url)
        .send()
        .map_err(|error| format!("request failed: {error}"))?
        .error_for_status()
        .map_err(|error| format!("request returned non-success status: {error}"))?;
    Ok(())
}

fn extract_creator_videos_from_dynamic_items(
    items: &[BilibiliCreatorDynamicItem],
) -> (Option<String>, Vec<CreatorVideoCandidate>) {
    let mut creator_name: Option<String> = None;
    let mut videos = Vec::new();

    for item in items {
        if item.item_type.as_deref() != Some("DYNAMIC_TYPE_AV") {
            continue;
        }

        let mut published_at: Option<i64> = None;
        let mut item_creator_name: Option<String> = None;
        let mut bvid = String::new();
        let mut title = String::new();

        for module in item.modules.as_ref().into_iter().flatten() {
            if let Some(author) = &module.module_author {
                if published_at.is_none() {
                    published_at = author.pub_ts;
                }
                if item_creator_name.is_none() {
                    item_creator_name = author
                        .user
                        .as_ref()
                        .and_then(|user| user.name.as_ref())
                        .map(|value| value.trim().to_string())
                        .filter(|value| !value.is_empty());
                }
            }

            if let Some(dynamic) = &module.module_dynamic {
                if let Some(archive) = &dynamic.dyn_archive {
                    bvid = normalize_bvid_hint(&archive.bvid.clone().unwrap_or_default());
                    title = archive.title.clone().unwrap_or_default().trim().to_string();
                }
            }
        }

        if creator_name.is_none() {
            creator_name = item_creator_name.clone();
        }
        if bvid.is_empty() {
            continue;
        }

        videos.push(CreatorVideoCandidate {
            canonical_url: format!("{BILIBILI_VIDEO_PAGE_URL}{bvid}/"),
            bvid,
            title,
            published_at: published_at_to_iso(published_at.unwrap_or_default()),
        });
    }

    (creator_name, videos)
}

fn load_creator_dynamic_feed_items(
    client: &Client,
    creator_mid: &str,
    canonical_source_url: &str,
) -> Result<Vec<BilibiliCreatorDynamicItem>, String> {
    let mut last_items = Vec::new();

    for attempt in 0..2 {
        prime_bilibili_creator_session(client, canonical_source_url)?;
        let response = request_json_with_referer::<BilibiliApiEnvelope<BilibiliCreatorDynamicFeedData>>(
            client,
            &format!(
                "{BILIBILI_CREATOR_DYNAMIC_VIDEO_LIST_ENDPOINT}?host_mid={creator_mid}"
            ),
            canonical_source_url,
        )?;

        if response.code != 0 {
            return Err(format!(
                "拉取博主视频列表失败：{}",
                normalize_bilibili_api_message(
                    &response
                        .message
                        .unwrap_or_else(|| "unknown error".to_string())
                )
            ));
        }

        let items = response
            .data
            .and_then(|data| data.items)
            .unwrap_or_default();
        if !items.is_empty() {
            return Ok(items);
        }
        last_items = items;

        if attempt == 0 {
            std::thread::sleep(Duration::from_millis(350));
        }
    }

    if last_items.is_empty() {
        return Err("拉取博主视频列表失败：暂时没有拿到公开视频，可能是平台临时限频，请稍后再试".to_string());
    }

    Ok(last_items)
}

pub fn load_bilibili_creator_video_feed(source_url: &str) -> Result<CreatorVideoFeed, String> {
    let creator_mid = extract_bilibili_creator_mid(source_url);
    if creator_mid.is_empty() {
        return Err(
            "现在只支持标准的 Bilibili 博主主页链接，例如 https://space.bilibili.com/123456"
                .to_string(),
        );
    }
    let canonical_source_url = canonicalize_bilibili_creator_url(source_url)?;

    let client = build_http_client()?;
    prime_bilibili_creator_session(&client, &canonical_source_url)?;

    let profile_response = request_json_with_referer::<BilibiliApiEnvelope<BilibiliCreatorProfileData>>(
        &client,
        &format!("{BILIBILI_CREATOR_PROFILE_ENDPOINT}?mid={creator_mid}"),
        &canonical_source_url,
    )?;
    let profile_name = if profile_response.code == 0 {
        profile_response
            .data
            .and_then(|data| data.name)
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
    } else {
        None
    };

    let items = load_creator_dynamic_feed_items(&client, &creator_mid, &canonical_source_url)?;
    let (feed_creator_name, mut videos) = extract_creator_videos_from_dynamic_items(&items);
    if videos.is_empty() {
        return Err(
            "拉取博主视频列表失败：暂时没有拿到可同步的视频，可能是平台临时限频，请稍后再试"
                .to_string(),
        );
    }
    videos.truncate(BILIBILI_CREATOR_RECENT_VIDEO_LIMIT);
    let creator_name = profile_name
        .or(feed_creator_name)
        .unwrap_or_else(|| format!("博主 {creator_mid}"));

    Ok(CreatorVideoFeed {
        creator_mid: creator_mid.clone(),
        creator_name,
        source_url: canonical_source_url,
        videos,
    })
}

pub fn build_geocode_query(venue_name: &str, address_text: &str) -> String {
    let venue = venue_name.trim();
    let address = address_text.trim();
    if venue.is_empty() && address.is_empty() {
        return String::new();
    }
    if venue.is_empty() {
        return address.to_string();
    }
    if address.is_empty() {
        return venue.to_string();
    }
    address.to_string()
}

fn amap_web_key() -> String {
    env::var("NIMI_VIDEO_FOOD_MAP_AMAP_WEB_KEY")
        .ok()
        .unwrap_or_default()
        .trim()
        .to_string()
}

fn amap_default_city() -> String {
    env::var("NIMI_VIDEO_FOOD_MAP_AMAP_DEFAULT_CITY")
        .ok()
        .unwrap_or_default()
        .trim()
        .to_string()
}

fn build_http_client() -> Result<Client, String> {
    let mut default_headers = HeaderMap::new();
    default_headers.insert(ACCEPT, HeaderValue::from_static(BILIBILI_ACCEPT));
    default_headers.insert(
        ACCEPT_LANGUAGE,
        HeaderValue::from_static(BILIBILI_ACCEPT_LANGUAGE),
    );
    default_headers.insert(ORIGIN, HeaderValue::from_static(BILIBILI_ORIGIN));
    default_headers.insert(REFERER, HeaderValue::from_static(BILIBILI_REFERER));
    default_headers.insert(
        USER_AGENT,
        HeaderValue::from_static(BILIBILI_BROWSER_USER_AGENT),
    );

    reqwest::blocking::Client::builder()
        .cookie_store(true)
        .default_headers(default_headers)
        .build()
        .map_err(|error| format!("http client build failed: {error}"))
}

fn split_amap_location(raw: &str) -> (Option<f64>, Option<f64>) {
    let mut parts = raw.split(',');
    let longitude = parts
        .next()
        .and_then(|value| value.trim().parse::<f64>().ok());
    let latitude = parts
        .next()
        .and_then(|value| value.trim().parse::<f64>().ok());
    (latitude, longitude)
}

fn failed_outcome(query: &str) -> GeocodeOutcome {
    GeocodeOutcome {
        provider: GEOCODER_PROVIDER.to_string(),
        status: "failed".to_string(),
        query: query.to_string(),
        latitude: None,
        longitude: None,
    }
}

fn resolved_outcome(
    query: &str,
    city: &str,
    latitude: Option<f64>,
    longitude: Option<f64>,
) -> GeocodeOutcome {
    GeocodeOutcome {
        provider: GEOCODER_PROVIDER.to_string(),
        status: "resolved".to_string(),
        query: if city.is_empty() {
            query.to_string()
        } else {
            format!("{city} {query}")
        },
        latitude,
        longitude,
    }
}

fn place_search_keywords(venue_name: &str, address_text: &str, query: &str) -> String {
    let venue = venue_name.trim();
    let address = address_text.trim();
    if !venue.is_empty() && !address.is_empty() {
        return format!("{venue} {address}");
    }
    if !venue.is_empty() {
        return venue.to_string();
    }
    if !address.is_empty() {
        return address.to_string();
    }
    query.trim().to_string()
}

pub fn geocode_address(
    query: &str,
    venue_name: &str,
    address_text: &str,
    city_hint: &str,
) -> GeocodeOutcome {
    let normalized = query.trim();
    if normalized.is_empty() {
        return GeocodeOutcome {
            provider: GEOCODER_PROVIDER.to_string(),
            status: "skipped".to_string(),
            query: String::new(),
            latitude: None,
            longitude: None,
        };
    }

    let key = amap_web_key();
    if key.is_empty() {
        return failed_outcome(normalized);
    }

    let client = match build_http_client() {
        Ok(client) => client,
        Err(_) => return failed_outcome(normalized),
    };

    let city = {
        let explicit = city_hint.trim();
        if explicit.is_empty() {
            amap_default_city()
        } else {
            explicit.to_string()
        }
    };

    let response = client
        .get(AMAP_GEOCODE_ENDPOINT)
        .query(&[
            ("key", key.as_str()),
            ("address", normalized),
            ("output", "json"),
            ("city", city.as_str()),
        ])
        .send();

    let rows = match response.and_then(|result| result.error_for_status()) {
        Ok(response) => response.json::<AmapGeocodeResponse>(),
        Err(_) => return failed_outcome(normalized),
    };

    if let Ok(payload) = rows {
        let first = payload.geocodes.as_ref().and_then(|rows| rows.first());
        let (latitude, longitude) = first
            .map(|row| split_amap_location(&row.location))
            .unwrap_or((None, None));
        if payload.status.trim() == "1" && latitude.is_some() && longitude.is_some() {
            return resolved_outcome(normalized, &city, latitude, longitude);
        }
    }

    let keywords = place_search_keywords(venue_name, address_text, normalized);
    if keywords.is_empty() {
        return failed_outcome(normalized);
    }

    let place_response = client
        .get(AMAP_PLACE_TEXT_ENDPOINT)
        .query(&[
            ("key", key.as_str()),
            ("keywords", keywords.as_str()),
            ("city", city.as_str()),
            ("offset", "5"),
            ("page", "1"),
            ("extensions", "base"),
            ("output", "json"),
        ])
        .send();

    let pois = match place_response.and_then(|result| result.error_for_status()) {
        Ok(response) => response.json::<AmapPlaceSearchResponse>(),
        Err(_) => return failed_outcome(&keywords),
    };

    match pois {
        Ok(payload) => {
            let first = payload.pois.as_ref().and_then(|rows| rows.first());
            let (latitude, longitude) = first
                .map(|row| split_amap_location(&row.location))
                .unwrap_or((None, None));
            if payload.status.trim() == "1" && latitude.is_some() && longitude.is_some() {
                return resolved_outcome(&keywords, &city, latitude, longitude);
            }
            failed_outcome(&keywords)
        }
        Err(_) => failed_outcome(&keywords),
    }
}

pub fn path_display(path: &Path) -> String {
    path.display().to_string()
}

#[cfg(test)]
mod tests {
    use super::{
        canonicalize_bilibili_creator_url, extract_bilibili_creator_mid,
        extract_creator_videos_from_dynamic_items, BilibiliApiEnvelope,
        BilibiliCreatorDynamicFeedData,
    };

    #[test]
    fn extracts_creator_mid_from_standard_space_url() {
        assert_eq!(
            extract_bilibili_creator_mid(
                "https://space.bilibili.com/946974?spm_id_from=333.337.0.0"
            ),
            "946974"
        );
    }

    #[test]
    fn extracts_creator_mid_from_mobile_space_url() {
        assert_eq!(
            extract_bilibili_creator_mid("https://m.bilibili.com/space/12345678"),
            "12345678"
        );
    }

    #[test]
    fn canonicalizes_creator_url_to_space_domain() {
        assert_eq!(
            canonicalize_bilibili_creator_url("https://www.bilibili.com/space/12345678").unwrap(),
            "https://space.bilibili.com/12345678"
        );
    }

    #[test]
    fn rejects_non_creator_urls_for_creator_sync() {
        assert!(
            canonicalize_bilibili_creator_url("https://www.bilibili.com/video/BV1xx411c7mD/")
                .is_err()
        );
    }

    #[test]
    fn extracts_recent_videos_from_dynamic_feed_items() {
        let payload = serde_json::from_str::<BilibiliApiEnvelope<BilibiliCreatorDynamicFeedData>>(
            r#"{
              "code": 0,
              "data": {
                "items": [
                  {
                    "type": "DYNAMIC_TYPE_AV",
                    "modules": [
                      {
                        "module_author": {
                          "pub_ts": 1775556001,
                          "user": { "name": "JASON刘雨鑫" }
                        }
                      },
                      {
                        "module_dynamic": {
                          "dyn_archive": {
                            "bvid": "BV1en97B3E84",
                            "title": "湖北襄阳，开在巷子里的人气牛杂，尝尝怎么样"
                          }
                        }
                      }
                    ]
                  }
                ]
              }
            }"#,
        )
        .expect("dynamic feed should parse");

        let items = payload.data.and_then(|data| data.items).unwrap_or_default();
        let (creator_name, videos) = extract_creator_videos_from_dynamic_items(&items);

        assert_eq!(creator_name.as_deref(), Some("JASON刘雨鑫"));
        assert_eq!(videos.len(), 1);
        assert_eq!(videos[0].bvid, "BV1en97B3E84");
        assert_eq!(
            videos[0].canonical_url,
            "https://www.bilibili.com/video/BV1en97B3E84/"
        );
        assert_eq!(videos[0].title, "湖北襄阳，开在巷子里的人气牛杂，尝尝怎么样");
    }
}
