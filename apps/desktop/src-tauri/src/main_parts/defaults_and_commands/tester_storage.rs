use std::fs;
use std::io::Write;
use std::path::PathBuf;

use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use serde::{Deserialize, Serialize};

const TESTER_IMAGE_HISTORY_FILE: &str = "tester-image-history.json";
const TESTER_RUN_HISTORY_FILE: &str = "tester-run-history.json";
pub(crate) const TESTER_APP_ID: &str = "nimi.tester";
pub(crate) const TESTER_WORLD_TOUR_CACHE_REL: &str = "worldlabs/world-tour";

pub(crate) fn tester_app_root() -> Result<PathBuf, String> {
    let data_dir = crate::desktop_paths::resolve_nimi_data_dir()?;
    Ok(data_dir.join("apps").join(TESTER_APP_ID))
}

pub(crate) fn tester_app_data_root() -> Result<PathBuf, String> {
    let root = tester_app_root()?.join("data");
    fs::create_dir_all(&root).map_err(|error| {
        format!(
            "创建 Tester App data root 失败 ({}): {error}",
            root.display()
        )
    })?;
    root.canonicalize().map_err(|error| {
        format!(
            "解析 Tester App data root 失败 ({}): {error}",
            root.display()
        )
    })
}

pub(crate) fn tester_app_cache_root() -> Result<PathBuf, String> {
    let root = tester_app_root()?.join("cache");
    fs::create_dir_all(&root).map_err(|error| {
        format!(
            "创建 Tester App cache root 失败 ({}): {error}",
            root.display()
        )
    })?;
    root.canonicalize().map_err(|error| {
        format!(
            "解析 Tester App cache root 失败 ({}): {error}",
            root.display()
        )
    })
}

pub(crate) fn tester_app_tmp_root() -> Result<PathBuf, String> {
    let root = tester_app_root()?.join("tmp");
    fs::create_dir_all(&root).map_err(|error| {
        format!(
            "创建 Tester App tmp root 失败 ({}): {error}",
            root.display()
        )
    })?;
    root.canonicalize().map_err(|error| {
        format!(
            "解析 Tester App tmp root 失败 ({}): {error}",
            root.display()
        )
    })
}

pub(crate) fn tester_image_history_path() -> Result<PathBuf, String> {
    Ok(tester_app_data_root()?.join(TESTER_IMAGE_HISTORY_FILE))
}

pub(crate) fn tester_run_history_path() -> Result<PathBuf, String> {
    Ok(tester_app_data_root()?.join(TESTER_RUN_HISTORY_FILE))
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TesterImageHistorySavePayload {
    pub records_json: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TesterRunHistorySavePayload {
    pub records_json: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TesterFixtureReadFilePayload {
    pub path: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TesterFixtureReadFileResponse {
    pub base64: String,
}

pub(crate) fn tester_world_tour_cache_root() -> Result<PathBuf, String> {
    let root = tester_app_cache_root()?.join(TESTER_WORLD_TOUR_CACHE_REL);
    fs::create_dir_all(&root).map_err(|e| {
        format!(
            "创建 tester world-tour cache 根目录失败 ({}): {e}",
            root.display()
        )
    })?;
    root.canonicalize()
        .map_err(|e| format!("解析 tester world-tour cache 根目录失败: {e}"))
}

pub(crate) fn resolve_tester_fixture_path(path: &str) -> Result<PathBuf, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("fixture 文件路径不能为空".to_string());
    }
    let root = tester_world_tour_cache_root()?;
    let requested = PathBuf::from(trimmed);
    let candidate = if requested.is_absolute() {
        requested
    } else {
        root.join(requested)
    };
    let canonical = candidate
        .canonicalize()
        .map_err(|e| format!("解析 fixture 文件路径失败: {e}"))?;
    if !canonical.starts_with(&root) {
        return Err(format!(
            "fixture 文件超出 Tester App cache 根目录: {}",
            canonical.display()
        ));
    }
    Ok(canonical)
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
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| {
            format!(
                "创建 tester image history 目录失败 ({}): {e}",
                parent.display()
            )
        })?;
    }

    let write_result: Result<(), String> = (|| {
        let mut file = fs::OpenOptions::new()
            .create(true)
            .truncate(true)
            .write(true)
            .open(&temp_path)
            .map_err(|e| format!("创建临时文件失败 ({}): {e}", temp_path.display()))?;
        file.write_all(payload.records_json.as_bytes())
            .map_err(|e| format!("写入临时文件失败: {e}"))?;
        file.flush().map_err(|e| format!("刷新临时文件失败: {e}"))?;
        file.sync_all()
            .map_err(|e| format!("同步临时文件失败: {e}"))?;
        drop(file);

        if let Err(rename_err) = fs::rename(&temp_path, &path) {
            if path.exists() {
                fs::remove_file(&path).map_err(|e| format!("删除旧文件失败: {e}"))?;
                fs::rename(&temp_path, &path).map_err(|e| format!("提交文件失败: {e}"))?;
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

#[tauri::command]
pub fn tester_run_history_load() -> Result<String, String> {
    let path = tester_run_history_path()?;
    if !path.exists() {
        return Ok("{}".to_string());
    }
    fs::read_to_string(&path).map_err(|e| format!("读取 tester run history 失败: {e}"))
}

#[tauri::command]
pub fn tester_run_history_save(payload: TesterRunHistorySavePayload) -> Result<(), String> {
    serde_json::from_str::<serde_json::Value>(&payload.records_json)
        .map_err(|e| format!("tester run history JSON 校验失败: {e}"))?;

    let path = tester_run_history_path()?;
    let temp_path = path.with_extension("json.tmp");
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| {
            format!(
                "创建 tester run history 目录失败 ({}): {e}",
                parent.display()
            )
        })?;
    }

    let write_result: Result<(), String> = (|| {
        let mut file = fs::OpenOptions::new()
            .create(true)
            .truncate(true)
            .write(true)
            .open(&temp_path)
            .map_err(|e| {
                format!(
                    "创建 run history 临时文件失败 ({}): {e}",
                    temp_path.display()
                )
            })?;
        file.write_all(payload.records_json.as_bytes())
            .map_err(|e| format!("写入 run history 临时文件失败: {e}"))?;
        file.flush()
            .map_err(|e| format!("刷新 run history 临时文件失败: {e}"))?;
        file.sync_all()
            .map_err(|e| format!("同步 run history 临时文件失败: {e}"))?;
        drop(file);
        fs::rename(&temp_path, &path).map_err(|e| format!("提交 run history 文件失败: {e}"))?;
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

#[tauri::command]
pub fn tester_fixture_read_file(
    payload: TesterFixtureReadFilePayload,
) -> Result<TesterFixtureReadFileResponse, String> {
    let canonical = resolve_tester_fixture_path(&payload.path)?;
    let bytes = fs::read(&canonical)
        .map_err(|e| format!("读取 fixture 文件失败 ({}): {e}", canonical.display()))?;
    Ok(TesterFixtureReadFileResponse {
        base64: BASE64_STANDARD.encode(bytes),
    })
}

#[cfg(test)]
mod tests {
    use super::{
        resolve_tester_fixture_path, tester_app_tmp_root, tester_image_history_path,
        tester_run_history_path, tester_world_tour_cache_root,
    };
    use crate::test_support::with_product_data_home;
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_dir(prefix: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("nimi-tester-storage-{prefix}-{unique}"));
        fs::create_dir_all(&dir).expect("create temp dir");
        dir
    }

    #[test]
    fn app_storage_roots_resolve_under_selected_nimi_data() {
        let home = temp_dir("cache-root");
        with_product_data_home(&home, || {
            let data_root = home.join(".nimi").join("data");
            let canonical_data_root = data_root.canonicalize().expect("canonical data root");
            let cache_root = data_root
                .join("apps")
                .join("nimi.tester")
                .join("cache")
                .join("worldlabs")
                .join("world-tour");
            let resolved = tester_world_tour_cache_root().expect("resolve cache root");
            assert_eq!(
                resolved,
                cache_root.canonicalize().expect("canonical cache root")
            );
            assert_eq!(
                tester_image_history_path().expect("history path"),
                canonical_data_root
                    .join("apps")
                    .join("nimi.tester")
                    .join("data")
                    .join("tester-image-history.json")
            );
            assert_eq!(
                tester_run_history_path().expect("run history path"),
                canonical_data_root
                    .join("apps")
                    .join("nimi.tester")
                    .join("data")
                    .join("tester-run-history.json")
            );
            assert_eq!(
                tester_app_tmp_root().expect("tmp root"),
                canonical_data_root
                    .join("apps")
                    .join("nimi.tester")
                    .join("tmp")
                    .canonicalize()
                    .expect("canonical tmp root")
            );
        });
    }

    #[test]
    fn relative_fixture_path_resolves_from_tester_app_cache_root() {
        let home = temp_dir("fixture-path");
        with_product_data_home(&home, || {
            let fixture = home
                .join(".nimi")
                .join("data")
                .join("apps")
                .join("nimi.tester")
                .join("cache")
                .join("worldlabs")
                .join("world-tour")
                .join("latest")
                .join("fixture-manifest.json");
            fs::create_dir_all(fixture.parent().expect("fixture parent"))
                .expect("create fixture parent");
            fs::write(&fixture, "{}").expect("write fixture");
            let resolved = resolve_tester_fixture_path("latest/fixture-manifest.json")
                .expect("resolve fixture");
            assert_eq!(resolved, fixture.canonicalize().expect("canonical fixture"));
        });
    }

    #[test]
    fn fixture_path_rejects_escape_from_tester_app_cache_root() {
        let home = temp_dir("fixture-escape");
        with_product_data_home(&home, || {
            let outside = home.join("outside.json");
            fs::write(&outside, "{}").expect("write outside");
            let err = resolve_tester_fixture_path(outside.to_str().expect("outside path"))
                .expect_err("outside absolute path should fail");
            assert!(err.contains("Tester App cache"));
        });
    }
}
