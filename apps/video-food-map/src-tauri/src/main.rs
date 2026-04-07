#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod db;
mod db_queries;
mod desktop_paths;
mod probe;
mod runtime_daemon;
mod script_runner;
mod settings;

use serde::Serialize;
use std::env;
use std::path::PathBuf;
use std::thread;
use url::Url;

fn load_dotenv_files() {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let repo_root = match manifest_dir.join("../../..").canonicalize() {
        Ok(path) => path,
        Err(_) => return,
    };

    for path in [repo_root.join(".env"), repo_root.join(".env.local")] {
        let Ok(iter) = dotenvy::from_path_iter(&path) else {
            continue;
        };
        for item in iter.flatten() {
            let (key, value) = item;
            if key.starts_with("NIMI_") || key.starts_with("VITE_") {
                env::set_var(key, value);
            }
        }
    }
}

fn explain_import_error(error: &str) -> String {
    let normalized = error.trim();
    if normalized.contains("AI_PROVIDER_UNAVAILABLE")
        || normalized.contains("connector")
        || normalized.contains("credential")
    {
        return "本地 runtime 还没配好云端解析能力。请先在 runtime 里配置可用的云 connector 和密钥，再回来导入。".to_string();
    }
    if normalized.contains("AI_MODEL_NOT_FOUND") || normalized.contains("model not found") {
        return "本地 runtime 里没找到可用的转写或提取模型，请检查 runtime 的模型配置。"
            .to_string();
    }
    if normalized.contains("provider rejected request parameters")
        || normalized.contains("AI_MEDIA_OPTION_UNSUPPORTED")
    {
        return "音频已经送到云端了，但这次音频格式或参数没被接受。现在先保留这条记录，后面可以继续重试。".to_string();
    }
    if normalized.contains("AI_PROVIDER_ENDPOINT_FORBIDDEN")
        || normalized.contains("FAILED_PRECONDITION")
    {
        return "这条视频需要走云端语音转写，但你当前的 runtime 没放通这条云端入口。可以先换一条自带字幕的视频，或者回 runtime 里把这条云端转写能力配通。".to_string();
    }
    if normalized.contains("fetch failed") {
        return "视频音频拉取失败了。这通常是网络波动或视频源暂时不可用，过一会儿可以重试。"
            .to_string();
    }
    if normalized.contains("本地 runtime 启动失败")
        || normalized.contains("本地 runtime 没能在预期时间内启动完成")
        || normalized.contains("runtime mode requires")
    {
        return normalized.to_string();
    }
    if normalized.contains("unable to extract BVID") {
        return "暂时只支持 Bilibili 视频链接，请换一个包含 BV 号的链接再试。".to_string();
    }
    normalized.to_string()
}

fn validate_external_url(url: &Url) -> Result<(), String> {
    match url.scheme() {
        "http" | "https" => Ok(()),
        scheme => Err(format!("unsupported external url scheme: {scheme}")),
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CreatorSyncItem {
    bvid: String,
    title: String,
    canonical_url: String,
    published_at: String,
    status: String,
    import_id: Option<String>,
    message: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CreatorSyncResult {
    creator_mid: String,
    creator_name: String,
    source_url: String,
    scanned_count: usize,
    queued_count: usize,
    skipped_existing_count: usize,
    saved_sync: db::CreatorSyncRecord,
    items: Vec<CreatorSyncItem>,
}

fn is_active_import_status(status: &str) -> bool {
    matches!(status, "running" | "queued" | "resolving" | "geocoding")
}

fn spawn_import_job(import_id: String, source_url: String) {
    thread::spawn(move || {
        let _ = db::set_import_stage(&import_id, "resolving");
        match probe::run_probe(&source_url) {
            Ok(result) => {
                let _ = db::set_import_stage(&import_id, "geocoding");
                if let Err(error) = db::complete_import_by_id(&import_id, &source_url, &result) {
                    let _ = db::mark_import_failed_by_id(&import_id, &error);
                }
            }
            Err(error) => {
                let friendly = explain_import_error(&error);
                let _ = db::mark_import_failed_by_id(&import_id, &friendly);
            }
        }
    });
}

#[tauri::command]
fn video_food_map_snapshot() -> Result<db::Snapshot, String> {
    db::load_snapshot()
}

#[tauri::command]
fn video_food_map_settings_get() -> Result<settings::VideoFoodMapSettings, String> {
    settings::load_settings()
}

#[tauri::command]
fn video_food_map_settings_set(
    settings: settings::VideoFoodMapSettings,
) -> Result<settings::VideoFoodMapSettings, String> {
    settings::save_settings(&settings)
}

#[tauri::command]
fn video_food_map_runtime_options_get() -> Result<serde_json::Value, String> {
    settings::load_runtime_options()
}

#[tauri::command]
fn video_food_map_import_video(url: String) -> Result<db::ImportRecord, String> {
    let trimmed = url.trim().to_string();
    if trimmed.is_empty() {
        return Err("video url is required".to_string());
    }

    let bvid_hint = probe::extract_bvid_hint(&trimmed);
    let queued = db::queue_import(&trimmed, &bvid_hint)?;
    let should_start = queued.should_start;
    let import_id = queued.record.id.clone();
    if should_start {
        spawn_import_job(import_id, trimmed);
    }
    Ok(queued.record)
}

#[tauri::command]
fn video_food_map_import_creator(url: String) -> Result<CreatorSyncResult, String> {
    let trimmed = url.trim().to_string();
    if trimmed.is_empty() {
        return Err("creator url is required".to_string());
    }

    let feed = probe::load_bilibili_creator_video_feed(&trimmed)?;
    let mut items = Vec::with_capacity(feed.videos.len());
    let mut queued_count = 0usize;
    let mut skipped_existing_count = 0usize;

    for video in &feed.videos {
        if let Some(existing) = db::lookup_import_by_bvid(&video.bvid)? {
            skipped_existing_count += 1;
            items.push(CreatorSyncItem {
                bvid: video.bvid.clone(),
                title: video.title.clone(),
                canonical_url: video.canonical_url.clone(),
                published_at: video.published_at.clone(),
                status: "skipped_existing".to_string(),
                import_id: Some(existing.id),
                message: if is_active_import_status(&existing.status) {
                    "这条视频已经在处理中，本次同步先跳过。".to_string()
                } else {
                    "这条视频已经在库里了，本次同步不重复跑。".to_string()
                },
            });
            continue;
        }

        let queued = db::queue_import(&video.canonical_url, &video.bvid)?;
        let import_id = queued.record.id.clone();
        if queued.should_start {
            spawn_import_job(import_id.clone(), video.canonical_url.clone());
        }
        queued_count += 1;
        items.push(CreatorSyncItem {
            bvid: video.bvid.clone(),
            title: video.title.clone(),
            canonical_url: video.canonical_url.clone(),
            published_at: video.published_at.clone(),
            status: "queued".to_string(),
            import_id: Some(import_id),
            message: "已经加入导入队列，会沿用单条视频的现有解析流程。".to_string(),
        });
    }

    let saved_sync = db::save_creator_sync(
        &feed.creator_mid,
        &feed.creator_name,
        &feed.source_url,
        feed.videos.len(),
        queued_count,
        skipped_existing_count,
    )?;

    Ok(CreatorSyncResult {
        creator_mid: feed.creator_mid,
        creator_name: feed.creator_name,
        source_url: feed.source_url,
        scanned_count: feed.videos.len(),
        queued_count,
        skipped_existing_count,
        saved_sync,
        items,
    })
}

#[tauri::command]
fn video_food_map_retry_import(import_id: String) -> Result<db::ImportRecord, String> {
    let trimmed = import_id.trim().to_string();
    if trimmed.is_empty() {
        return Err("import id is required".to_string());
    }
    let queued = db::retry_import_by_id(&trimmed)?;
    let queued_id = queued.record.id.clone();
    let source_url = queued.record.source_url.clone();
    if queued.should_start {
        spawn_import_job(queued_id, source_url);
    }
    Ok(queued.record)
}

#[tauri::command]
fn video_food_map_set_venue_confirmation(
    venue_id: String,
    confirmed: bool,
) -> Result<db::ImportRecord, String> {
    let trimmed = venue_id.trim().to_string();
    if trimmed.is_empty() {
        return Err("venue id is required".to_string());
    }
    db::set_venue_confirmation(&trimmed, confirmed)
}

#[tauri::command]
fn video_food_map_toggle_venue_favorite(venue_id: String) -> Result<db::ImportRecord, String> {
    let trimmed = venue_id.trim().to_string();
    if trimmed.is_empty() {
        return Err("venue id is required".to_string());
    }
    db::toggle_venue_favorite(&trimmed)
}

#[tauri::command]
fn video_food_map_open_external_url(url: String) -> Result<bool, String> {
    let normalized = url.trim();
    if normalized.is_empty() {
        return Err("url is required".to_string());
    }
    let parsed = Url::parse(normalized).map_err(|error| error.to_string())?;
    validate_external_url(&parsed)?;
    webbrowser::open(parsed.as_str()).map_err(|error| error.to_string())?;
    Ok(true)
}

#[tauri::command]
fn video_food_map_start_window_drag(window: tauri::WebviewWindow) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    if window.is_fullscreen().unwrap_or(false) {
        return Ok(());
    }

    match std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        window.start_dragging().map_err(|error| error.to_string())
    })) {
        Ok(result) => result,
        Err(_) => Err("window drag unavailable".to_string()),
    }
}

fn main() {
    load_dotenv_files();
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            video_food_map_snapshot,
            video_food_map_settings_get,
            video_food_map_settings_set,
            video_food_map_runtime_options_get,
            video_food_map_import_video,
            video_food_map_import_creator,
            video_food_map_retry_import,
            video_food_map_set_venue_confirmation,
            video_food_map_toggle_venue_favorite,
            video_food_map_open_external_url,
            video_food_map_start_window_drag,
        ])
        .run(tauri::generate_context!())
        .expect("error running video-food-map");
}

#[cfg(test)]
mod tests {
    use super::{explain_import_error, is_active_import_status, validate_external_url};
    use url::Url;

    #[test]
    fn explains_missing_runtime_connector() {
        let message = explain_import_error("AI_PROVIDER_UNAVAILABLE: connector test failed");
        assert!(message.contains("runtime"));
        assert!(message.contains("connector"));
    }

    #[test]
    fn explains_invalid_bilibili_url() {
        let message = explain_import_error(
            "unable to extract BVID from input: https://example.com/video/123",
        );
        assert!(message.contains("Bilibili"));
        assert!(message.contains("BV"));
    }

    #[test]
    fn explains_provider_parameter_rejection() {
        let message = explain_import_error("stderr=provider rejected request parameters");
        assert!(message.contains("音频"));
        assert!(message.contains("云端"));
    }

    #[test]
    fn explains_provider_endpoint_forbidden() {
        let message = explain_import_error("FAILED_PRECONDITION: AI_PROVIDER_ENDPOINT_FORBIDDEN");
        assert!(message.contains("云端语音转写"));
        assert!(message.contains("runtime"));
    }

    #[test]
    fn accepts_http_and_https_external_urls() {
        assert!(validate_external_url(&Url::parse("https://uri.amap.com/marker").unwrap()).is_ok());
        assert!(validate_external_url(&Url::parse("http://example.com").unwrap()).is_ok());
    }

    #[test]
    fn active_import_status_matches_batch_skip_logic() {
        assert!(is_active_import_status("queued"));
        assert!(is_active_import_status("resolving"));
        assert!(is_active_import_status("geocoding"));
        assert!(!is_active_import_status("succeeded"));
        assert!(!is_active_import_status("failed"));
    }

    #[test]
    fn rejects_non_http_external_urls() {
        assert!(validate_external_url(&Url::parse("file:///tmp/test").unwrap()).is_err());
    }
}
