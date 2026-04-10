use std::fs;
use std::io::Write;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

const TESTER_IMAGE_HISTORY_FILE: &str = "tester-image-history.json";

fn tester_image_history_path() -> Result<PathBuf, String> {
    let data_dir = crate::desktop_paths::resolve_nimi_data_dir()?;
    Ok(data_dir.join(TESTER_IMAGE_HISTORY_FILE))
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TesterImageHistorySavePayload {
    pub records_json: String,
}

#[tauri::command]
pub fn tester_image_history_load() -> Result<String, String> {
    let path = tester_image_history_path()?;
    if !path.exists() {
        return Ok("[]".to_string());
    }
    fs::read_to_string(&path).map_err(|e| format!("读取 tester image history 失败: {e}"))
}

#[tauri::command]
pub fn tester_image_history_save(payload: TesterImageHistorySavePayload) -> Result<(), String> {
    // Validate JSON before writing
    serde_json::from_str::<serde_json::Value>(&payload.records_json)
        .map_err(|e| format!("tester image history JSON 校验失败: {e}"))?;

    let path = tester_image_history_path()?;
    let temp_path = path.with_extension("json.tmp");

    let write_result: Result<(), String> = (|| {
        let mut file = fs::OpenOptions::new()
            .create(true)
            .truncate(true)
            .write(true)
            .open(&temp_path)
            .map_err(|e| format!("创建临时文件失败 ({}): {e}", temp_path.display()))?;
        file.write_all(payload.records_json.as_bytes())
            .map_err(|e| format!("写入临时文件失败: {e}"))?;
        file.flush()
            .map_err(|e| format!("刷新临时文件失败: {e}"))?;
        file.sync_all()
            .map_err(|e| format!("同步临时文件失败: {e}"))?;
        drop(file);

        if let Err(rename_err) = fs::rename(&temp_path, &path) {
            if path.exists() {
                fs::remove_file(&path)
                    .map_err(|e| format!("删除旧文件失败: {e}"))?;
                fs::rename(&temp_path, &path)
                    .map_err(|e| format!("提交文件失败: {e}"))?;
            } else {
                return Err(format!("提交文件失败: {rename_err}"));
            }
        }
        Ok(())
    })();

    if let Err(err) = write_result {
        if temp_path.exists() {
            let _ = fs::remove_file(&temp_path);
        }
        return Err(err);
    }

    Ok(())
}
