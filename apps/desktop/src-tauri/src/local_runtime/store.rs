use std::cmp::Ordering;
use std::collections::HashMap;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

use tauri::AppHandle;

use super::types::{LocalAiDownloadSessionRecord, LocalAiDownloadState, LocalAiRuntimeState};

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
    let parsed = serde_json::from_str::<LocalAiRuntimeState>(&raw).map_err(|error| {
        format!(
            "解析 Local AI Runtime state 失败 ({}): {error}",
            path.display()
        )
    })?;
    Ok(parsed)
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
mod tests {
    use super::{load_state_from_path, save_state_to_path};
    use crate::local_runtime::types::{
        LocalAiDownloadSessionRecord, LocalAiDownloadState, LocalAiInstallRequest,
        LocalAiModelRecord, LocalAiModelSource, LocalAiModelStatus, LocalAiRuntimeState,
    };
    use std::collections::HashMap;
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn unique_temp_dir(prefix: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let path = std::env::temp_dir().join(format!("nimi-store-{prefix}-{nanos}"));
        let _ = fs::remove_dir_all(&path);
        fs::create_dir_all(&path).expect("create temp dir");
        path
    }

    fn model_fixture(local_model_id: &str) -> LocalAiModelRecord {
        LocalAiModelRecord {
            local_model_id: local_model_id.to_string(),
            model_id: format!("hf:test/{local_model_id}"),
            capabilities: vec!["chat".to_string()],
            engine: "localai".to_string(),
            entry: "model.gguf".to_string(),
            license: "apache-2.0".to_string(),
            source: LocalAiModelSource {
                repo: "hf://test/model".to_string(),
                revision: "main".to_string(),
            },
            hashes: HashMap::from([("model.gguf".to_string(), "sha256:abc".to_string())]),
            endpoint: "http://127.0.0.1:1234/v1".to_string(),
            status: LocalAiModelStatus::Installed,
            installed_at: "2026-01-01T00:00:00.000Z".to_string(),
            updated_at: "2026-01-01T00:00:00.000Z".to_string(),
            health_detail: None,
            engine_config: None,
        }
    }

    fn download_fixture(
        install_session_id: &str,
        phase: &str,
        state: LocalAiDownloadState,
        bytes_received: u64,
        updated_at: &str,
    ) -> LocalAiDownloadSessionRecord {
        LocalAiDownloadSessionRecord {
            install_session_id: install_session_id.to_string(),
            model_id: "hf:test/model".to_string(),
            local_model_id: "hf:test-model".to_string(),
            request: LocalAiInstallRequest {
                model_id: "hf:test/model".to_string(),
                repo: "test/model".to_string(),
                revision: Some("main".to_string()),
                capabilities: Some(vec!["chat".to_string()]),
                engine: Some("llama-cpp".to_string()),
                entry: Some("model.gguf".to_string()),
                files: Some(vec!["model.gguf".to_string()]),
                license: Some("apache-2.0".to_string()),
                hashes: Some(HashMap::from([(
                    "model.gguf".to_string(),
                    "sha256:abc".to_string(),
                )])),
                endpoint: Some("http://127.0.0.1:1234/v1".to_string()),
                provider_hints: None,
                engine_config: None,
            },
            install_metadata: None,
            phase: phase.to_string(),
            state,
            bytes_received,
            bytes_total: Some(4_710_000_000),
            speed_bytes_per_sec: Some(12_345.0),
            eta_seconds: Some(42.0),
            message: Some("progress".to_string()),
            reason_code: None,
            retryable: true,
            created_at: "2026-01-01T00:00:00.000Z".to_string(),
            updated_at: updated_at.to_string(),
        }
    }

    #[test]
    fn save_and_load_state_roundtrip() {
        let temp = unique_temp_dir("roundtrip");
        let state_path = temp.join("state.json");
        let state = LocalAiRuntimeState {
            version: 11,
            models: vec![model_fixture("model-a"), model_fixture("model-b")],
            capability_index: HashMap::new(),
            capability_matrix: Vec::new(),
            services: Vec::new(),
            downloads: Vec::new(),
            audits: Vec::new(),
        };
        save_state_to_path(&state_path, &state).expect("save state");
        let loaded = load_state_from_path(&state_path).expect("load state");
        assert_eq!(loaded.version, state.version);
        assert_eq!(loaded.models.len(), 2);
        assert_eq!(loaded.models[0].local_model_id, "model-a");
        assert_eq!(loaded.models[1].local_model_id, "model-b");
        let _ = fs::remove_dir_all(&temp);
    }

    #[test]
    fn save_state_atomic_leaves_no_temp_file() {
        let temp = unique_temp_dir("atomic");
        let state_path = temp.join("state.json");
        let state = LocalAiRuntimeState::default();
        save_state_to_path(&state_path, &state).expect("save state");
        let temp_file = state_path.with_extension("json.tmp");
        assert!(!temp_file.exists(), "temp file should be cleaned up");
        let _ = fs::remove_dir_all(&temp);
    }

    #[test]
    fn load_state_returns_default_when_file_missing() {
        let temp = unique_temp_dir("missing");
        let state_path = temp.join("nonexistent.json");
        let state = load_state_from_path(&state_path).expect("default state");
        assert_eq!(state.version, LocalAiRuntimeState::default().version);
        assert!(state.models.is_empty());
        let _ = fs::remove_dir_all(&temp);
    }

    #[test]
    fn load_state_rejects_invalid_json() {
        let temp = unique_temp_dir("invalid");
        let state_path = temp.join("state.json");
        fs::write(&state_path, "not json").expect("write invalid json");
        let result = load_state_from_path(&state_path);
        assert!(result.is_err());
        let _ = fs::remove_dir_all(&temp);
    }

    #[test]
    fn merge_state_for_save_preserves_downloads_missing_from_incoming_state() {
        let current = LocalAiRuntimeState {
            version: 11,
            models: vec![],
            capability_index: HashMap::new(),
            capability_matrix: Vec::new(),
            services: Vec::new(),
            downloads: vec![download_fixture(
                "install-1",
                "verify",
                LocalAiDownloadState::Running,
                4_600_000_000,
                "2026-01-01T00:00:05.000Z",
            )],
            audits: Vec::new(),
        };
        let incoming = LocalAiRuntimeState {
            version: 11,
            models: vec![model_fixture("model-a")],
            capability_index: HashMap::new(),
            capability_matrix: Vec::new(),
            services: Vec::new(),
            downloads: Vec::new(),
            audits: Vec::new(),
        };

        let merged = super::merge_state_for_save(&current, &incoming);

        assert_eq!(merged.models.len(), 1);
        assert_eq!(merged.downloads.len(), 1);
        assert_eq!(merged.downloads[0].install_session_id, "install-1");
        assert_eq!(merged.downloads[0].phase, "verify");
    }

    #[test]
    fn merge_state_for_save_prefers_newer_download_record() {
        let current = LocalAiRuntimeState {
            version: 11,
            models: vec![],
            capability_index: HashMap::new(),
            capability_matrix: Vec::new(),
            services: Vec::new(),
            downloads: vec![download_fixture(
                "install-1",
                "verify",
                LocalAiDownloadState::Running,
                4_600_000_000,
                "2026-01-01T00:00:05.000Z",
            )],
            audits: Vec::new(),
        };
        let incoming = LocalAiRuntimeState {
            version: 11,
            models: vec![],
            capability_index: HashMap::new(),
            capability_matrix: Vec::new(),
            services: Vec::new(),
            downloads: vec![download_fixture(
                "install-1",
                "download",
                LocalAiDownloadState::Running,
                1_000_000,
                "2026-01-01T00:00:03.000Z",
            )],
            audits: Vec::new(),
        };

        let merged = super::merge_state_for_save(&current, &incoming);

        assert_eq!(merged.downloads.len(), 1);
        assert_eq!(merged.downloads[0].phase, "verify");
        assert_eq!(merged.downloads[0].bytes_received, 4_600_000_000);
    }

    #[test]
    fn merge_state_for_save_breaks_same_timestamp_ties_with_progress() {
        let current = LocalAiRuntimeState {
            version: 11,
            models: vec![],
            capability_index: HashMap::new(),
            capability_matrix: Vec::new(),
            services: Vec::new(),
            downloads: vec![download_fixture(
                "install-1",
                "verify",
                LocalAiDownloadState::Running,
                4_600_000_000,
                "2026-01-01T00:00:05.000Z",
            )],
            audits: Vec::new(),
        };
        let incoming = LocalAiRuntimeState {
            version: 11,
            models: vec![],
            capability_index: HashMap::new(),
            capability_matrix: Vec::new(),
            services: Vec::new(),
            downloads: vec![download_fixture(
                "install-1",
                "download",
                LocalAiDownloadState::Running,
                1_000_000,
                "2026-01-01T00:00:05.000Z",
            )],
            audits: Vec::new(),
        };

        let merged = super::merge_state_for_save(&current, &incoming);

        assert_eq!(merged.downloads.len(), 1);
        assert_eq!(merged.downloads[0].phase, "verify");
        assert_eq!(merged.downloads[0].bytes_received, 4_600_000_000);
    }
}
