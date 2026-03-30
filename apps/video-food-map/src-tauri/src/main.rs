#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod db;
mod desktop_paths;
mod probe;
mod runtime_daemon;

fn explain_import_error(error: &str) -> String {
    let normalized = error.trim();
    if normalized.contains("AI_PROVIDER_UNAVAILABLE")
        || normalized.contains("connector")
        || normalized.contains("credential")
    {
        return "本地 runtime 还没配好云端解析能力。请先在 runtime 里配置可用的云 connector 和密钥，再回来导入。".to_string();
    }
    if normalized.contains("AI_MODEL_NOT_FOUND") || normalized.contains("model not found") {
        return "本地 runtime 里没找到可用的转写或提取模型，请检查 runtime 的模型配置。".to_string();
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
fn video_food_map_import_video(url: String) -> Result<db::ImportRecord, String> {
    let trimmed = url.trim().to_string();
    if trimmed.is_empty() {
        return Err("video url is required".to_string());
    }

    let bvid_hint = probe::extract_bvid_hint(&trimmed);
    match probe::run_probe(&trimmed) {
        Ok(result) => db::import_video(&trimmed, &bvid_hint, &result),
        Err(error) => {
            let friendly = explain_import_error(&error);
            let _ = db::mark_import_failed(&trimmed, &bvid_hint, &friendly);
            Err(friendly)
        }
    }
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            video_food_map_snapshot,
            video_food_map_import_video,
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
        let message = explain_import_error("unable to extract BVID from input: https://example.com/video/123");
        assert!(message.contains("Bilibili"));
        assert!(message.contains("BV"));
    }
}
