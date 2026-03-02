use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;

use tauri::AppHandle;

use super::types::LocalAiRuntimeState;

const NIMI_ROOT_DIR: &str = ".nimi";
const LOCAL_AI_RUNTIME_MODELS_DIR: &str = "models";
const LOCAL_AI_RUNTIME_STATE_FILE: &str = "state.json";

pub fn runtime_root_dir(_app: &AppHandle) -> Result<PathBuf, String> {
    let home = dirs::home_dir()
        .ok_or_else(|| "无法获取用户 home 目录".to_string())?;
    let dir = home.join(NIMI_ROOT_DIR);
    fs::create_dir_all(&dir).map_err(|error| format!("创建 ~/.nimi/ 目录失败: {error}"))?;
    Ok(dir)
}

pub fn runtime_models_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let root = runtime_root_dir(app)?;
    let models_dir = root.join(LOCAL_AI_RUNTIME_MODELS_DIR);
    fs::create_dir_all(&models_dir).map_err(|error| format!("创建 models 目录失败: {error}"))?;
    Ok(models_dir)
}

pub fn runtime_state_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(runtime_root_dir(app)?.join(LOCAL_AI_RUNTIME_STATE_FILE))
}

pub fn load_state(app: &AppHandle) -> Result<LocalAiRuntimeState, String> {
    let path = runtime_state_path(app)?;
    if !path.exists() {
        return Ok(LocalAiRuntimeState::default());
    }
    let raw = fs::read_to_string(&path).map_err(|error| {
        format!(
            "读取 Local AI Runtime state 失败 ({}): {error}",
            path.display()
        )
    })?;
    let parsed = serde_json::from_str::<LocalAiRuntimeState>(&raw).map_err(|error| {
        format!(
            "解析 Local AI Runtime state 失败 ({}): {error}",
            path.display()
        )
    })?;
    Ok(parsed)
}

pub fn save_state(app: &AppHandle, state: &LocalAiRuntimeState) -> Result<(), String> {
    let path = runtime_state_path(app)?;
    let serialized = serde_json::to_string_pretty(state)
        .map_err(|error| format!("序列化 Local AI Runtime state 失败: {error}"))?;
    serde_json::from_str::<LocalAiRuntimeState>(&serialized)
        .map_err(|error| format!("写入前校验 Local AI Runtime state JSON 失败: {error}"))?;
    let temp_path = path.with_extension("json.tmp");

    let write_result: Result<(), String> = (|| {
        let mut file = OpenOptions::new()
            .create(true)
            .truncate(true)
            .write(true)
            .open(&temp_path)
            .map_err(|error| {
                format!(
                    "创建 Local AI Runtime 临时 state 失败 ({}): {error}",
                    temp_path.display()
                )
            })?;
        file.write_all(serialized.as_bytes()).map_err(|error| {
            format!(
                "写入 Local AI Runtime 临时 state 失败 ({}): {error}",
                temp_path.display()
            )
        })?;
        file.flush().map_err(|error| {
            format!(
                "刷新 Local AI Runtime 临时 state 失败 ({}): {error}",
                temp_path.display()
            )
        })?;
        file.sync_all().map_err(|error| {
            format!(
                "同步 Local AI Runtime 临时 state 失败 ({}): {error}",
                temp_path.display()
            )
        })?;
        drop(file);

        if let Err(rename_error) = fs::rename(&temp_path, &path) {
            if path.exists() {
                fs::remove_file(&path).map_err(|error| {
                    format!(
                        "替换 Local AI Runtime state 失败，删除旧文件失败 ({}): {error}",
                        path.display()
                    )
                })?;
                fs::rename(&temp_path, &path).map_err(|error| {
                    format!(
                        "提交 Local AI Runtime state 失败 ({} -> {}): {error}",
                        temp_path.display(),
                        path.display()
                    )
                })?;
            } else {
                return Err(format!(
                    "提交 Local AI Runtime state 失败 ({} -> {}): {rename_error}",
                    temp_path.display(),
                    path.display()
                ));
            }
        }

        Ok(())
    })();

    if let Err(error) = write_result {
        if temp_path.exists() {
            let _ = fs::remove_file(&temp_path);
        }
        return Err(error);
    }

    Ok(())
}
