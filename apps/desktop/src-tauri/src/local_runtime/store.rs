use std::cmp::Ordering;
use std::collections::HashMap;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

use tauri::AppHandle;

use super::types::{
    default_logical_model_id, is_runnable_asset_kind, LocalAiDownloadSessionRecord,
    LocalAiDownloadState, LocalAiRuntimeState,
};

const LOCAL_AI_RUNTIME_MODELS_DIR: &str = "models";
const LOCAL_AI_RUNTIME_STATE_FILE: &str = "state.json";
static STATE_SAVE_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

fn state_save_lock() -> &'static Mutex<()> {
    STATE_SAVE_LOCK.get_or_init(|| Mutex::new(()))
}

pub fn runtime_root_dir(_app: &AppHandle) -> Result<PathBuf, String> {
    let dir = crate::desktop_paths::resolve_nimi_data_dir()?;
    fs::create_dir_all(&dir)
        .map_err(|error| format!("创建 nimi_data_dir 目录失败 ({}): {error}", dir.display()))?;
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

fn load_state_from_path(path: &Path) -> Result<LocalAiRuntimeState, String> {
    if !path.exists() {
        return Ok(LocalAiRuntimeState::default());
    }
    let raw = fs::read_to_string(path).map_err(|error| {
        format!(
            "读取 Local AI Runtime state 失败 ({}): {error}",
            path.display()
        )
    })?;
    let mut parsed = serde_json::from_str::<LocalAiRuntimeState>(&raw).map_err(|error| {
        format!(
            "解析 Local AI Runtime state 失败 ({}): {error}",
            path.display()
        )
    })?;
    sanitize_legacy_runtime_state(&mut parsed);
    for asset in &mut parsed.assets {
        if is_runnable_asset_kind(&asset.kind) && asset.logical_model_id.is_empty() {
            asset.logical_model_id = default_logical_model_id(&asset.asset_id);
        }
    }
    Ok(parsed)
}

fn is_legacy_local_runtime_value(value: &str) -> bool {
    let normalized = value.trim().to_ascii_lowercase();
    if normalized.is_empty() {
        return false;
    }
    normalized.contains("localai")
        || normalized.contains("nexa")
        || normalized.contains("nimi_media")
        || normalized.contains("localsidecar")
}

fn rebuild_capability_index(state: &mut LocalAiRuntimeState) {
    let mut index = HashMap::<String, Vec<String>>::new();
    for asset in &state.assets {
        if !is_runnable_asset_kind(&asset.kind)
            || asset.status == super::types::LocalAiAssetStatus::Removed
        {
            continue;
        }
        let local_asset_id = asset.local_asset_id.trim();
        if local_asset_id.is_empty() {
            continue;
        }
        for capability in &asset.capabilities {
            let normalized = capability.trim().to_ascii_lowercase();
            if normalized.is_empty() {
                continue;
            }
            let bucket = index.entry(normalized).or_default();
            if !bucket.iter().any(|item| item == local_asset_id) {
                bucket.push(local_asset_id.to_string());
            }
        }
    }
    state.capability_index = index;
}

fn sanitize_legacy_runtime_state(state: &mut LocalAiRuntimeState) {
    state.assets.retain(|asset| {
        !is_legacy_local_runtime_value(asset.engine.as_str())
            && !is_legacy_local_runtime_value(asset.asset_id.as_str())
            && !asset
                .preferred_engine
                .as_deref()
                .is_some_and(is_legacy_local_runtime_value)
            && !asset
                .fallback_engines
                .iter()
                .any(|engine| is_legacy_local_runtime_value(engine.as_str()))
    });

    state.services.retain(|service| {
        !is_legacy_local_runtime_value(service.engine.as_str())
            && !is_legacy_local_runtime_value(service.service_id.as_str())
    });

    let valid_service_ids = state
        .services
        .iter()
        .map(|service| service.service_id.trim().to_ascii_lowercase())
        .collect::<Vec<_>>();
    state.capability_matrix.retain(|entry| {
        valid_service_ids
            .iter()
            .any(|service_id| service_id == &entry.service_id.trim().to_ascii_lowercase())
            && !is_legacy_local_runtime_value(entry.provider.as_str())
            && !entry
                .model_engine
                .as_deref()
                .is_some_and(is_legacy_local_runtime_value)
    });

    rebuild_capability_index(state);
}

pub fn load_state(app: &AppHandle) -> Result<LocalAiRuntimeState, String> {
    let path = runtime_state_path(app)?;
    load_state_from_path(&path)
}

fn download_phase_rank(phase: &str) -> u8 {
    match phase.trim().to_ascii_lowercase().as_str() {
        "download" => 1,
        "verify" => 2,
        "upsert" => 3,
        _ => 0,
    }
}

fn download_state_rank(state: &LocalAiDownloadState) -> u8 {
    match state {
        LocalAiDownloadState::Queued => 1,
        LocalAiDownloadState::Running => 2,
        LocalAiDownloadState::Paused => 3,
        LocalAiDownloadState::Completed => 4,
        LocalAiDownloadState::Failed => 5,
        LocalAiDownloadState::Cancelled => 6,
    }
}

fn compare_download_records(
    left: &LocalAiDownloadSessionRecord,
    right: &LocalAiDownloadSessionRecord,
) -> Ordering {
    left.updated_at
        .cmp(&right.updated_at)
        .then_with(|| {
            download_phase_rank(left.phase.as_str()).cmp(&download_phase_rank(right.phase.as_str()))
        })
        .then_with(|| left.bytes_received.cmp(&right.bytes_received))
        .then_with(|| {
            left.bytes_total
                .unwrap_or(0)
                .cmp(&right.bytes_total.unwrap_or(0))
        })
        .then_with(|| download_state_rank(&left.state).cmp(&download_state_rank(&right.state)))
}

fn merge_download_records(
    current: &[LocalAiDownloadSessionRecord],
    incoming: &[LocalAiDownloadSessionRecord],
) -> Vec<LocalAiDownloadSessionRecord> {
    let mut merged = HashMap::<String, LocalAiDownloadSessionRecord>::new();
    for record in current.iter().chain(incoming.iter()) {
        let key = record.install_session_id.clone();
        match merged.get(&key) {
            Some(existing) if compare_download_records(existing, record) != Ordering::Less => {}
            _ => {
                merged.insert(key, record.clone());
            }
        }
    }
    let mut rows = merged.into_values().collect::<Vec<_>>();
    rows.sort_by(|left, right| {
        left.created_at
            .cmp(&right.created_at)
            .then_with(|| left.install_session_id.cmp(&right.install_session_id))
    });
    rows
}

fn merge_state_for_save(
    current: &LocalAiRuntimeState,
    incoming: &LocalAiRuntimeState,
) -> LocalAiRuntimeState {
    let mut merged = incoming.clone();
    merged.downloads = merge_download_records(&current.downloads, &incoming.downloads);
    merged
}

fn save_state_to_path(path: &Path, state: &LocalAiRuntimeState) -> Result<(), String> {
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

        if let Err(rename_error) = fs::rename(&temp_path, path) {
            if path.exists() {
                fs::remove_file(path).map_err(|error| {
                    format!(
                        "替换 Local AI Runtime state 失败，删除旧文件失败 ({}): {error}",
                        path.display()
                    )
                })?;
                fs::rename(&temp_path, path).map_err(|error| {
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

pub fn save_state(app: &AppHandle, state: &LocalAiRuntimeState) -> Result<(), String> {
    let path = runtime_state_path(app)?;
    let _lock = state_save_lock()
        .lock()
        .map_err(|_| "获取 Local AI Runtime state 保存锁失败".to_string())?;
    let merged = match load_state_from_path(&path) {
        Ok(current) => merge_state_for_save(&current, state),
        Err(_) => state.clone(),
    };
    save_state_to_path(&path, &merged)
}

#[cfg(test)]
#[path = "store_tests.rs"]
mod store_tests;
