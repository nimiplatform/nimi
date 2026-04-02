#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod db;
mod db_queries;
mod desktop_paths;
mod probe;
mod runtime_daemon;
mod script_runner;
mod settings;

use std::env;
use std::path::PathBuf;
use std::thread;

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
    let import_id = queued.id.clone();
    thread::spawn(move || {
        let _ = db::set_import_stage(&import_id, "resolving");
        match probe::run_probe(&trimmed) {
            Ok(result) => {
                let _ = db::set_import_stage(&import_id, "geocoding");
                if let Err(error) = db::complete_import_by_id(&import_id, &trimmed, &result) {
                    let _ = db::mark_import_failed_by_id(&import_id, &error);
                }
            }
            Err(error) => {
                let friendly = explain_import_error(&error);
                let _ = db::mark_import_failed_by_id(&import_id, &friendly);
            }
        }
    });
    Ok(queued)
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

fn main() {
    load_dotenv_files();
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            video_food_map_snapshot,
            video_food_map_settings_get,
            video_food_map_settings_set,
            video_food_map_runtime_options_get,
            video_food_map_import_video,
            video_food_map_set_venue_confirmation,
            video_food_map_toggle_venue_favorite,
        ])
        .run(tauri::generate_context!())
        .expect("error running video-food-map");
}

#[cfg(test)]
mod tests {
    use super::explain_import_error;

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
}
