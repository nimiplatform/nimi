use std::fs;
use std::io::Write;
use std::path::PathBuf;

use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use serde::{Deserialize, Serialize};

const TESTER_IMAGE_HISTORY_FILE: &str = "tester-image-history.json";
pub(crate) const TESTER_WORLD_TOUR_CACHE_REL: &str = ".nimi/cache/worldlabs/world-tour";

fn push_search_path(paths: &mut Vec<PathBuf>, candidate: PathBuf) {
    if candidate.as_os_str().is_empty() {
        return;
    }
    if !paths.iter().any(|existing| existing == &candidate) {
        paths.push(candidate);
    }
}

fn push_with_ancestors(paths: &mut Vec<PathBuf>, start: PathBuf, levels: usize) {
    let mut current = start;
    for _ in 0..=levels {
        push_search_path(paths, current.clone());
        if !current.pop() {
            break;
        }
    }
}

pub(crate) fn tester_world_tour_search_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    if let Ok(current) = std::env::current_dir() {
        push_with_ancestors(&mut roots, current, 8);
    }
    if let Ok(pwd) = std::env::var("PWD") {
        let trimmed = pwd.trim();
        if !trimmed.is_empty() {
            push_with_ancestors(&mut roots, PathBuf::from(trimmed), 8);
        }
    }
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(parent) = exe_path.parent() {
            push_with_ancestors(&mut roots, parent.to_path_buf(), 8);
        }
    }
    push_with_ancestors(&mut roots, PathBuf::from(env!("CARGO_MANIFEST_DIR")), 4);
    roots
}

fn tester_image_history_path() -> Result<PathBuf, String> {
    let data_dir = crate::desktop_paths::resolve_nimi_data_dir()?;
    Ok(data_dir.join(TESTER_IMAGE_HISTORY_FILE))
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TesterImageHistorySavePayload {
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
    for root in tester_world_tour_search_roots() {
        let candidate = root.join(TESTER_WORLD_TOUR_CACHE_REL);
        if candidate.exists() {
            return candidate
                .canonicalize()
                .map_err(|e| format!("解析 tester world-tour cache 根目录失败: {e}"));
        }
    }
    Err("未找到 tester world-tour cache 根目录".to_string())
}

pub(crate) fn resolve_tester_fixture_path(path: &str) -> Result<PathBuf, String> {
    let requested = PathBuf::from(path);
    if requested.is_absolute() {
        return requested
            .canonicalize()
            .map_err(|e| format!("解析 fixture 文件路径失败: {e}"));
    }
    for root in tester_world_tour_search_roots() {
        let candidate = root.join(&requested);
        if candidate.exists() {
            return candidate
                .canonicalize()
                .map_err(|e| format!("解析 fixture 文件路径失败: {e}"));
        }
    }
    std::env::current_dir()
        .map_err(|e| format!("读取当前目录失败: {e}"))?
        .join(requested)
        .canonicalize()
        .map_err(|e| format!("解析 fixture 文件路径失败: {e}"))
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
pub fn tester_fixture_read_file(
    payload: TesterFixtureReadFilePayload,
) -> Result<TesterFixtureReadFileResponse, String> {
    let root = tester_world_tour_cache_root()?;
    let canonical = resolve_tester_fixture_path(&payload.path)?;
    if !canonical.starts_with(&root) {
        return Err(format!("fixture 文件超出允许目录: {}", canonical.display()));
    }
    let bytes = fs::read(&canonical)
        .map_err(|e| format!("读取 fixture 文件失败 ({}): {e}", canonical.display()))?;
    Ok(TesterFixtureReadFileResponse {
        base64: BASE64_STANDARD.encode(bytes),
    })
}

#[cfg(test)]
mod tests {
    use super::{resolve_tester_fixture_path, tester_world_tour_cache_root};
    use crate::test_support::with_env;
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
    fn cache_root_resolves_from_pwd_ancestors() {
        let root = temp_dir("cache-root");
        let workspace = root.join("workspace");
        let nested = workspace.join("apps").join("desktop");
        let cache_root = workspace
            .join(".nimi")
            .join("cache")
            .join("worldlabs")
            .join("world-tour");
        fs::create_dir_all(&nested).expect("create nested dir");
        fs::create_dir_all(&cache_root).expect("create cache root");

        with_env(
            &[("PWD", workspace.to_str()), ("HOME", root.to_str())],
            || {
                let previous = std::env::current_dir().expect("current dir");
                std::env::set_current_dir(&nested).expect("set current dir");
                let resolved = tester_world_tour_cache_root().expect("resolve cache root");
                std::env::set_current_dir(previous).expect("restore current dir");
                assert_eq!(
                    resolved,
                    cache_root.canonicalize().expect("canonical cache root")
                );
            },
        );
    }

    #[test]
    fn relative_fixture_path_resolves_from_pwd_root() {
        let root = temp_dir("fixture-path");
        let workspace = root.join("workspace");
        let nested = workspace.join("apps").join("desktop");
        let fixture = workspace
            .join(".nimi")
            .join("cache")
            .join("worldlabs")
            .join("world-tour")
            .join("latest")
            .join("fixture-manifest.json");
        fs::create_dir_all(nested).expect("create nested dir");
        fs::create_dir_all(fixture.parent().expect("fixture parent"))
            .expect("create fixture parent");
        fs::write(&fixture, "{}").expect("write fixture");

        with_env(
            &[("PWD", workspace.to_str()), ("HOME", root.to_str())],
            || {
                let previous = std::env::current_dir().expect("current dir");
                std::env::set_current_dir(workspace.join("apps")).expect("set current dir");
                let resolved = resolve_tester_fixture_path(
                    ".nimi/cache/worldlabs/world-tour/latest/fixture-manifest.json",
                )
                .expect("resolve fixture");
                std::env::set_current_dir(previous).expect("restore current dir");
                assert_eq!(resolved, fixture.canonicalize().expect("canonical fixture"));
            },
        );
    }
}
