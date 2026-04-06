use std::env;
use std::path::Path;
use std::process::Command;

use chrono::{TimeZone, Utc};
use md5;
use reqwest::blocking::Client;
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use url::{form_urlencoded, Url};

const GEOCODER_PROVIDER: &str = "amap";
const AMAP_GEOCODE_ENDPOINT: &str = "https://restapi.amap.com/v3/geocode/geo";
const AMAP_PLACE_TEXT_ENDPOINT: &str = "https://restapi.amap.com/v3/place/text";
const BILIBILI_NAV_ENDPOINT: &str = "https://api.bilibili.com/x/web-interface/nav";
const BILIBILI_CREATOR_VIDEO_LIST_ENDPOINT: &str =
    "https://api.bilibili.com/x/space/wbi/arc/search";
const BILIBILI_VIDEO_PAGE_URL: &str = "https://www.bilibili.com/video/";
const BILIBILI_CREATOR_PAGE_URL: &str = "https://space.bilibili.com/";
const BILIBILI_REFERER: &str = "https://www.bilibili.com/";
const BILIBILI_CREATOR_RECENT_VIDEO_LIMIT: usize = 12;
const BILIBILI_WBI_MIXIN_KEY_INDEXES: [usize; 64] = [
    46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49, 33, 9, 42, 19, 29,
    28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25,
    54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52,
];

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
struct BilibiliNavData {
    wbi_img: Option<BilibiliWbiImage>,
}

#[derive(Debug, Deserialize)]
struct BilibiliWbiImage {
    img_url: String,
    sub_url: String,
}

#[derive(Debug, Deserialize)]
struct BilibiliCreatorVideoListData {
    list: Option<BilibiliCreatorVideoListPayload>,
}

#[derive(Debug, Deserialize)]
struct BilibiliCreatorVideoListPayload {
    vlist: Option<Vec<BilibiliCreatorVideoRow>>,
}

#[derive(Debug, Deserialize)]
struct BilibiliCreatorVideoRow {
    bvid: Option<String>,
    title: Option<String>,
    author: Option<String>,
    created: Option<i64>,
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
    value.trim().to_ascii_uppercase()
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

fn request_json<T: DeserializeOwned>(client: &Client, url: &str) -> Result<T, String> {
    client
        .get(url)
        .header("Referer", BILIBILI_REFERER)
        .send()
        .map_err(|error| format!("request failed: {error}"))?
        .error_for_status()
        .map_err(|error| format!("request returned non-success status: {error}"))?
        .json::<T>()
        .map_err(|error| format!("response decode failed: {error}"))
}

fn extract_wbi_token_key(value: &str) -> String {
    value
        .rsplit('/')
        .next()
        .unwrap_or_default()
        .split('.')
        .next()
        .unwrap_or_default()
        .trim()
        .to_string()
}

fn load_bilibili_wbi_mixin_key(client: &Client) -> Result<String, String> {
    let response =
        request_json::<BilibiliApiEnvelope<BilibiliNavData>>(client, BILIBILI_NAV_ENDPOINT)?;
    if response.code != 0 && response.code != -101 {
        return Err(format!(
            "failed to load bilibili nav data: {}",
            response
                .message
                .unwrap_or_else(|| "unknown error".to_string())
        ));
    }
    let data = response
        .data
        .ok_or_else(|| "bilibili nav response missing data".to_string())?;
    let wbi = data
        .wbi_img
        .ok_or_else(|| "bilibili nav response missing wbi image data".to_string())?;
    let img_key = extract_wbi_token_key(&wbi.img_url);
    let sub_key = extract_wbi_token_key(&wbi.sub_url);
    let combined = format!("{img_key}{sub_key}");
    let chars = combined.chars().collect::<Vec<_>>();
    let mut mixin = String::with_capacity(32);
    for index in BILIBILI_WBI_MIXIN_KEY_INDEXES {
        if let Some(char) = chars.get(index) {
            mixin.push(*char);
        }
        if mixin.len() >= 32 {
            break;
        }
    }
    if mixin.is_empty() {
        return Err("bilibili wbi mixin key is empty".to_string());
    }
    Ok(mixin)
}

fn build_signed_wbi_query(params: &[(&str, String)], mixin_key: &str) -> String {
    let mut pairs = params
        .iter()
        .map(|(key, value)| {
            (
                (*key).to_string(),
                value.replace(['!', '\'', '(', ')', '*'], ""),
            )
        })
        .collect::<Vec<_>>();
    pairs.push(("wts".to_string(), Utc::now().timestamp().to_string()));
    pairs.sort_by(|left, right| left.0.cmp(&right.0));
    let query = form_urlencoded::Serializer::new(String::new())
        .extend_pairs(
            pairs
                .iter()
                .map(|(key, value)| (key.as_str(), value.as_str())),
        )
        .finish();
    let digest = format!("{:x}", md5::compute(format!("{query}{mixin_key}")));
    format!("{query}&w_rid={digest}")
}

pub fn load_bilibili_creator_video_feed(source_url: &str) -> Result<CreatorVideoFeed, String> {
    let creator_mid = extract_bilibili_creator_mid(source_url);
    if creator_mid.is_empty() {
        return Err(
            "现在只支持标准的 Bilibili 博主主页链接，例如 https://space.bilibili.com/123456"
                .to_string(),
        );
    }

    let client = build_http_client()?;
    let mixin_key = load_bilibili_wbi_mixin_key(&client)?;
    let query = build_signed_wbi_query(
        &[
            ("mid", creator_mid.clone()),
            ("pn", "1".to_string()),
            ("ps", BILIBILI_CREATOR_RECENT_VIDEO_LIMIT.to_string()),
            ("order", "pubdate".to_string()),
            ("tid", "0".to_string()),
            ("keyword", String::new()),
        ],
        &mixin_key,
    );
    let response = request_json::<BilibiliApiEnvelope<BilibiliCreatorVideoListData>>(
        &client,
        &format!("{BILIBILI_CREATOR_VIDEO_LIST_ENDPOINT}?{query}"),
    )?;

    if response.code != 0 {
        return Err(format!(
            "拉取博主视频列表失败：{}",
            response
                .message
                .unwrap_or_else(|| "unknown error".to_string())
        ));
    }

    let rows = response
        .data
        .and_then(|data| data.list)
        .and_then(|list| list.vlist)
        .unwrap_or_default();
    let creator_name = rows
        .iter()
        .find_map(|row| row.author.as_ref())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| format!("博主 {creator_mid}"));
    let videos = rows
        .into_iter()
        .filter_map(|row| {
            let bvid = normalize_bvid_hint(&row.bvid.unwrap_or_default());
            if bvid.is_empty() {
                return None;
            }
            Some(CreatorVideoCandidate {
                canonical_url: format!("{BILIBILI_VIDEO_PAGE_URL}{bvid}/"),
                bvid,
                title: row.title.unwrap_or_default().trim().to_string(),
                published_at: published_at_to_iso(row.created.unwrap_or_default()),
            })
        })
        .collect::<Vec<_>>();

    Ok(CreatorVideoFeed {
        creator_mid: creator_mid.clone(),
        creator_name,
        source_url: canonicalize_bilibili_creator_url(source_url)?,
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
    reqwest::blocking::Client::builder()
        .user_agent("nimi-video-food-map/0.1 (local desktop app)")
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
        build_signed_wbi_query, canonicalize_bilibili_creator_url, extract_bilibili_creator_mid,
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
    fn signed_wbi_query_adds_timestamp_and_signature() {
        let query = build_signed_wbi_query(
            &[("mid", "123".to_string()), ("pn", "1".to_string())],
            "abcdefghijklmnopqrstuvwxyz123456",
        );
        assert!(query.contains("mid=123"));
        assert!(query.contains("pn=1"));
        assert!(query.contains("wts="));
        assert!(query.contains("w_rid="));
    }
}
