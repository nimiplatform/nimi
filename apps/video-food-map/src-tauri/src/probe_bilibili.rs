use std::thread;
use std::time::Duration;

use chrono::{TimeZone, Utc};
use reqwest::blocking::Client;
use reqwest::header::{ORIGIN, REFERER};
use serde::de::DeserializeOwned;
use serde::Deserialize;
use url::Url;

use super::{CreatorVideoCandidate, CreatorVideoFeed};
use super::probe_client::{build_http_client, BILIBILI_ORIGIN};

const BILIBILI_CREATOR_PROFILE_ENDPOINT: &str = "https://api.bilibili.com/x/space/acc/info";
const BILIBILI_CREATOR_DYNAMIC_VIDEO_LIST_ENDPOINT: &str =
    "https://api.bilibili.com/x/polymer/web-dynamic/desktop/v1/feed/space";
const BILIBILI_VIDEO_PAGE_URL: &str = "https://www.bilibili.com/video/";
const BILIBILI_CREATOR_PAGE_URL: &str = "https://space.bilibili.com/";
const BILIBILI_CREATOR_RECENT_VIDEO_LIMIT: usize = 12;

#[derive(Debug, Deserialize)]
pub(crate) struct BilibiliApiEnvelope<T> {
    pub(crate) code: i64,
    pub(crate) message: Option<String>,
    pub(crate) data: Option<T>,
}

#[derive(Debug, Deserialize)]
struct BilibiliCreatorProfileData {
    name: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct BilibiliCreatorDynamicFeedData {
    pub(crate) items: Option<Vec<BilibiliCreatorDynamicItem>>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct BilibiliCreatorDynamicItem {
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

pub(crate) fn extract_creator_videos_from_dynamic_items(
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
        let response =
            request_json_with_referer::<BilibiliApiEnvelope<BilibiliCreatorDynamicFeedData>>(
                client,
                &format!("{BILIBILI_CREATOR_DYNAMIC_VIDEO_LIST_ENDPOINT}?host_mid={creator_mid}"),
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
            thread::sleep(Duration::from_millis(350));
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

    let profile_response =
        request_json_with_referer::<BilibiliApiEnvelope<BilibiliCreatorProfileData>>(
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
