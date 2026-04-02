use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use super::engine_pack_download::download_and_prepare_bundle;

const LLAMA_ENGINE_PACK_SUBDIR: &str = "engine-packs/llama-cpp";
pub(super) const GITHUB_RELEASE_API: &str =
    "https://api.github.com/repos/ggml-org/llama.cpp/releases/latest";
const BUNDLE_MANIFEST_FILE_NAME: &str = "bundle-manifest.json";

#[derive(Debug, Clone)]
pub struct EnginePackBootstrapResult {
    pub binary_path: String,
    pub downloaded: bool,
    pub source_url: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(super) struct GithubReleasePayload {
    #[serde(default)]
    pub(super) assets: Vec<GithubReleaseAsset>,
}

#[derive(Debug, Deserialize)]
pub(super) struct GithubReleaseAsset {
    #[serde(default)]
    pub(super) name: String,
    #[serde(default)]
    pub(super) browser_download_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct EnginePackBundleManifest {
    binary_name: String,
    runtime_files: Vec<String>,
}

pub(super) fn now_nanos() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos()
}

pub(super) fn binary_name() -> &'static str {
    #[cfg(target_os = "windows")]
    {
        "llama-server.exe"
    }
    #[cfg(not(target_os = "windows"))]
    {
        "llama-server"
    }
}

pub(super) fn platform_id() -> String {
    format!("{}-{}", std::env::consts::OS, std::env::consts::ARCH)
}

pub(super) fn runtime_root_path() -> Result<PathBuf, String> {
    let value = std::env::var("NIMI_LOCAL_AI_RUNTIME_ROOT")
        .ok()
        .map(|item| item.trim().to_string())
        .unwrap_or_default();
    if value.is_empty() {
        return Err(
            "LOCAL_AI_ENGINE_PACK_RUNTIME_ROOT_MISSING: NIMI_LOCAL_AI_RUNTIME_ROOT is not configured"
                .to_string(),
        );
    }
    Ok(PathBuf::from(value))
}

fn cache_bundle_dir_path() -> Result<PathBuf, String> {
    let runtime_root = runtime_root_path()?;
    Ok(runtime_root
        .join(LLAMA_ENGINE_PACK_SUBDIR)
        .join(platform_id()))
}

fn ensure_cache_bundle_dir() -> Result<PathBuf, String> {
    let cache_dir = cache_bundle_dir_path()?;
    fs::create_dir_all(&cache_dir).map_err(|error| {
        format!(
            "LOCAL_AI_ENGINE_PACK_CACHE_DIR_FAILED: failed to create cache directory ({}): {error}",
            cache_dir.display()
        )
    })?;
    Ok(cache_dir)
}

fn bundle_manifest_path(bundle_dir: &Path) -> PathBuf {
    bundle_dir.join(BUNDLE_MANIFEST_FILE_NAME)
}

fn is_missing_cache_dir(error: &std::io::Error) -> bool {
    error.kind() == std::io::ErrorKind::NotFound
}

fn normalize_bundle_relative_path(root: &Path, path: &Path) -> Result<String, String> {
    let relative = path.strip_prefix(root).map_err(|error| {
        format!(
            "LOCAL_AI_ENGINE_PACK_BUNDLE_INVALID: failed to normalize runtime file path ({}): {error}",
            path.display()
        )
    })?;
    let normalized = relative
        .to_string_lossy()
        .replace('\\', "/")
        .trim_matches('/')
        .to_string();
    if normalized.is_empty() || normalized == BUNDLE_MANIFEST_FILE_NAME {
        return Err(format!(
            "LOCAL_AI_ENGINE_PACK_BUNDLE_INVALID: invalid runtime file path ({}): {}",
            root.display(),
            path.display()
        ));
    }
    Ok(normalized)
}

fn collect_bundle_runtime_files(root: &Path) -> Result<Vec<String>, String> {
    fn walk(root: &Path, current: &Path, output: &mut Vec<String>) -> Result<(), String> {
        let entries = fs::read_dir(current).map_err(|error| {
            format!(
                "LOCAL_AI_ENGINE_PACK_BUNDLE_INVALID: failed to read bundle directory ({}): {error}",
                current.display()
            )
        })?;
        for entry in entries {
            let entry = entry.map_err(|error| {
                format!(
                    "LOCAL_AI_ENGINE_PACK_BUNDLE_INVALID: failed to read bundle entry ({}): {error}",
                    current.display()
                )
            })?;
            let path = entry.path();
            let file_type = fs::symlink_metadata(&path).map_err(|error| {
                format!(
                    "LOCAL_AI_ENGINE_PACK_BUNDLE_INVALID: failed to stat bundle entry ({}): {error}",
                    path.display()
                )
            })?;
            if file_type.is_dir() {
                walk(root, path.as_path(), output)?;
                continue;
            }
            let entry_name = entry.file_name();
            if entry_name
                .to_string_lossy()
                .eq_ignore_ascii_case(BUNDLE_MANIFEST_FILE_NAME)
            {
                continue;
            }
            let relative = normalize_bundle_relative_path(root, path.as_path())?;
            output.push(relative);
        }
        Ok(())
    }

    let mut runtime_files = Vec::<String>::new();
    if !root.exists() {
        return Ok(runtime_files);
    }
    walk(root, root, &mut runtime_files)?;
    runtime_files.sort();
    runtime_files.dedup();
    Ok(runtime_files)
}

fn write_bundle_manifest(bundle_dir: &Path) -> Result<(), String> {
    let manifest = EnginePackBundleManifest {
        binary_name: binary_name().to_string(),
        runtime_files: collect_bundle_runtime_files(bundle_dir)?,
    };
    let bytes = serde_json::to_vec_pretty(&manifest).map_err(|error| {
        format!("LOCAL_AI_ENGINE_PACK_BUNDLE_INVALID: failed to encode bundle manifest: {error}")
    })?;
    fs::write(bundle_manifest_path(bundle_dir), bytes).map_err(|error| {
        format!(
            "LOCAL_AI_ENGINE_PACK_CACHE_WRITE_FAILED: failed to write bundle manifest ({}): {error}",
            bundle_manifest_path(bundle_dir).display()
        )
    })
}

fn read_bundle_manifest(bundle_dir: &Path) -> Result<EnginePackBundleManifest, String> {
    let manifest_path = bundle_manifest_path(bundle_dir);
    let bytes = fs::read(&manifest_path).map_err(|error| {
        format!(
            "LOCAL_AI_ENGINE_PACK_BUNDLE_INVALID: failed to read bundle manifest ({}): {error}",
            manifest_path.display()
        )
    })?;
    serde_json::from_slice::<EnginePackBundleManifest>(&bytes).map_err(|error| {
        format!(
            "LOCAL_AI_ENGINE_PACK_BUNDLE_INVALID: invalid bundle manifest ({}): {error}",
            manifest_path.display()
        )
    })
}

fn remove_path_if_exists(path: &Path) -> Result<(), String> {
    match fs::symlink_metadata(path) {
        Ok(metadata) => {
            if metadata.file_type().is_dir() && !metadata.file_type().is_symlink() {
                fs::remove_dir_all(path).map_err(|error| {
                    format!(
                        "LOCAL_AI_ENGINE_PACK_CACHE_WRITE_FAILED: failed to remove existing directory ({}): {error}",
                        path.display()
                    )
                })?
            } else {
                fs::remove_file(path).map_err(|error| {
                    format!(
                        "LOCAL_AI_ENGINE_PACK_CACHE_WRITE_FAILED: failed to remove existing file ({}): {error}",
                        path.display()
                    )
                })?
            }
            Ok(())
        }
        Err(error) if is_missing_cache_dir(&error) => Ok(()),
        Err(error) => Err(format!(
            "LOCAL_AI_ENGINE_PACK_CACHE_WRITE_FAILED: failed to inspect existing path ({}): {error}",
            path.display()
        )),
    }
}

#[cfg(unix)]
fn copy_symlink(source: &Path, destination: &Path) -> Result<(), String> {
    use std::os::unix::fs as unix_fs;

    let target = fs::read_link(source).map_err(|error| {
        format!(
            "LOCAL_AI_ENGINE_PACK_CACHE_WRITE_FAILED: failed to read symbolic link ({}): {error}",
            source.display()
        )
    })?;
    remove_path_if_exists(destination)?;
    unix_fs::symlink(&target, destination).map_err(|error| {
        format!(
            "LOCAL_AI_ENGINE_PACK_CACHE_WRITE_FAILED: failed to copy symbolic link ({} -> {}): {error}",
            source.display(),
            destination.display()
        )
    })
}

#[cfg(windows)]
fn copy_symlink(source: &Path, destination: &Path) -> Result<(), String> {
    use std::os::windows::fs as windows_fs;

    let target = fs::read_link(source).map_err(|error| {
        format!(
            "LOCAL_AI_ENGINE_PACK_CACHE_WRITE_FAILED: failed to read symbolic link ({}): {error}",
            source.display()
        )
    })?;
    remove_path_if_exists(destination)?;
    let metadata = fs::metadata(source).map_err(|error| {
        format!(
            "LOCAL_AI_ENGINE_PACK_CACHE_WRITE_FAILED: failed to inspect symbolic link target ({}): {error}",
            source.display()
        )
    })?;
    if metadata.is_dir() {
        windows_fs::symlink_dir(&target, destination)
    } else {
        windows_fs::symlink_file(&target, destination)
    }
    .map_err(|error| {
        format!(
            "LOCAL_AI_ENGINE_PACK_CACHE_WRITE_FAILED: failed to copy symbolic link ({} -> {}): {error}",
            source.display(),
            destination.display()
        )
    })
}

#[cfg(not(any(unix, windows)))]
fn copy_symlink(source: &Path, destination: &Path) -> Result<(), String> {
    let target_metadata = fs::metadata(source).map_err(|error| {
        format!(
            "LOCAL_AI_ENGINE_PACK_CACHE_WRITE_FAILED: failed to inspect symbolic link target ({}): {error}",
            source.display()
        )
    })?;
    if target_metadata.is_dir() {
        copy_bundle_directory(source, destination)
    } else {
        remove_path_if_exists(destination)?;
        fs::copy(source, destination).map_err(|error| {
            format!(
                "LOCAL_AI_ENGINE_PACK_CACHE_WRITE_FAILED: failed to copy bundle file ({} -> {}): {error}",
                source.display(),
                destination.display()
            )
        })?;
        Ok(())
    }
}

fn copy_bundle_directory(source_dir: &Path, destination_dir: &Path) -> Result<(), String> {
    fs::create_dir_all(destination_dir).map_err(|error| {
        format!(
            "LOCAL_AI_ENGINE_PACK_CACHE_WRITE_FAILED: failed to create bundle directory ({}): {error}",
            destination_dir.display()
        )
    })?;
    let entries = fs::read_dir(source_dir).map_err(|error| {
        format!(
            "LOCAL_AI_ENGINE_PACK_CACHE_WRITE_FAILED: failed to read bundle directory ({}): {error}",
            source_dir.display()
        )
    })?;
    for entry in entries {
        let entry = entry.map_err(|error| {
            format!(
                "LOCAL_AI_ENGINE_PACK_CACHE_WRITE_FAILED: failed to read bundle entry ({}): {error}",
                source_dir.display()
            )
        })?;
        let source_path = entry.path();
        let destination_path = destination_dir.join(entry.file_name());
        let metadata = fs::symlink_metadata(&source_path).map_err(|error| {
            format!(
                "LOCAL_AI_ENGINE_PACK_CACHE_WRITE_FAILED: failed to stat bundle entry ({}): {error}",
                source_path.display()
            )
        })?;
        let file_type = metadata.file_type();
        if file_type.is_symlink() {
            copy_symlink(source_path.as_path(), destination_path.as_path())?;
            continue;
        }
        if file_type.is_dir() {
            copy_bundle_directory(source_path.as_path(), destination_path.as_path())?;
            continue;
        }
        remove_path_if_exists(destination_path.as_path())?;
        fs::copy(&source_path, &destination_path).map_err(|error| {
            format!(
                "LOCAL_AI_ENGINE_PACK_CACHE_WRITE_FAILED: failed to copy bundle file ({} -> {}): {error}",
                source_path.display(),
                destination_path.display()
            )
        })?;
        let copied_name = destination_path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or_default();
        if copied_name.eq_ignore_ascii_case(binary_name()) {
            ensure_executable(destination_path.as_path())?;
        }
    }
    Ok(())
}

pub(super) fn copy_bundle_to_cache(source_bundle_dir: &Path, cache_dir: &Path) -> Result<PathBuf, String> {
    remove_path_if_exists(cache_dir)?;
    fs::create_dir_all(cache_dir).map_err(|error| {
        format!(
            "LOCAL_AI_ENGINE_PACK_CACHE_DIR_FAILED: failed to recreate cache directory ({}): {error}",
            cache_dir.display()
        )
    })?;
    copy_bundle_directory(source_bundle_dir, cache_dir)?;
    write_bundle_manifest(cache_dir)?;
    Ok(cache_dir.join(binary_name()))
}

fn validate_bundle_dir(bundle_dir: &Path) -> Result<PathBuf, String> {
    let manifest = read_bundle_manifest(bundle_dir)?;
    let binary_path = bundle_dir.join(binary_name());
    if !binary_path.exists() {
        return Err(format!(
            "LOCAL_AI_ENGINE_PACK_BUNDLE_INVALID: missing bundled binary ({})",
            binary_path.display()
        ));
    }
    if !manifest.binary_name.eq_ignore_ascii_case(binary_name()) {
        return Err(format!(
            "LOCAL_AI_ENGINE_PACK_BUNDLE_INVALID: bundle binary mismatch: expected={}, actual={}",
            binary_name(),
            manifest.binary_name
        ));
    }
    if manifest.runtime_files.is_empty() {
        return Err(
            "LOCAL_AI_ENGINE_PACK_BUNDLE_INVALID: bundle manifest runtime_files is empty"
                .to_string(),
        );
    }
    for relative_path in manifest.runtime_files {
        let normalized = relative_path.trim().trim_matches('/');
        if normalized.is_empty() {
            return Err(
                "LOCAL_AI_ENGINE_PACK_BUNDLE_INVALID: bundle manifest contains empty runtime file path"
                    .to_string(),
            );
        }
        let runtime_path = bundle_dir.join(normalized);
        fs::metadata(&runtime_path).map_err(|error| {
            format!(
                "LOCAL_AI_ENGINE_PACK_BUNDLE_INVALID: missing bundled runtime file ({}): {error}",
                runtime_path.display()
            )
        })?;
    }
    Ok(binary_path)
}

pub fn resolve_existing_llama_cpp_binary() -> Result<Option<String>, String> {
    if let Some(override_path) = env_override_binary_path() {
        if Path::new(&override_path).exists() {
            return Ok(Some(override_path));
        }
        return Ok(None);
    }

    let cache_dir = match cache_bundle_dir_path() {
        Ok(path) => path,
        Err(error) if error.contains("LOCAL_AI_ENGINE_PACK_RUNTIME_ROOT_MISSING") => {
            return Ok(None);
        }
        Err(error) => return Err(error),
    };
    let binary_path = cache_dir.join(binary_name());
    let manifest_path = bundle_manifest_path(&cache_dir);
    let cache_exists = match fs::symlink_metadata(&cache_dir) {
        Ok(_) => true,
        Err(error) if is_missing_cache_dir(&error) => false,
        Err(error) => {
            return Err(format!(
                "LOCAL_AI_ENGINE_PACK_BUNDLE_INVALID: failed to stat cache directory ({}): {error}",
                cache_dir.display()
            ))
        }
    };
    if !cache_exists {
        return Ok(None);
    }
    let binary_exists = binary_path.exists();
    let manifest_exists = manifest_path.exists();
    if !binary_exists && !manifest_exists {
        let mut entries = fs::read_dir(&cache_dir).map_err(|error| {
            format!(
                "LOCAL_AI_ENGINE_PACK_BUNDLE_INVALID: failed to inspect cache directory ({}): {error}",
                cache_dir.display()
            )
        })?;
        if entries.next().is_none() {
            return Ok(None);
        }
        return Err(format!(
            "LOCAL_AI_ENGINE_PACK_BUNDLE_INVALID: cache directory contains unexpected files without bundle metadata ({})",
            cache_dir.display()
        ));
    }
    validate_bundle_dir(&cache_dir).map(|path| Some(path.to_string_lossy().to_string()))
}

fn normalize_non_empty(input: Option<&str>) -> Option<String> {
    let normalized = input.unwrap_or_default().trim();
    if normalized.is_empty() {
        None
    } else {
        Some(normalized.to_string())
    }
}

fn env_override_binary_path() -> Option<String> {
    normalize_non_empty(std::env::var("NIMI_LLAMA_CPP_BIN").ok().as_deref())
}

pub(super) fn env_download_url() -> Option<String> {
    normalize_non_empty(std::env::var("NIMI_LLAMA_CPP_PACK_URL").ok().as_deref())
}

pub(super) fn env_expected_sha256() -> Option<String> {
    normalize_non_empty(std::env::var("NIMI_LLAMA_CPP_PACK_SHA256").ok().as_deref()).map(|value| {
        value
            .to_ascii_lowercase()
            .trim_start_matches("sha256:")
            .to_string()
    })
}

pub(super) fn github_user_agent() -> String {
    std::env::var("NIMI_LOCAL_AI_HF_USER_AGENT")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "nimi-desktop/0.1 local-ai-runtime".to_string())
}

#[cfg(unix)]
pub(super) fn ensure_executable(path: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    let metadata = fs::metadata(path).map_err(|error| {
        format!(
            "LOCAL_AI_ENGINE_PACK_CHMOD_FAILED: failed to stat binary ({}): {error}",
            path.display()
        )
    })?;
    let mut permissions = metadata.permissions();
    permissions.set_mode(0o755);
    fs::set_permissions(path, permissions).map_err(|error| {
        format!(
            "LOCAL_AI_ENGINE_PACK_CHMOD_FAILED: failed to chmod binary ({}): {error}",
            path.display()
        )
    })
}

#[cfg(not(unix))]
pub(super) fn ensure_executable(_path: &Path) -> Result<(), String> {
    Ok(())
}

pub fn ensure_llama_cpp_binary() -> Result<EnginePackBootstrapResult, String> {
    if let Some(override_path) = env_override_binary_path() {
        let path = PathBuf::from(override_path.as_str());
        if !path.exists() {
            return Err(format!(
                "LOCAL_AI_ENGINE_PACK_OVERRIDE_NOT_FOUND: override binary not found: {}",
                path.display()
            ));
        }
        return Ok(EnginePackBootstrapResult {
            binary_path: path.to_string_lossy().to_string(),
            downloaded: false,
            source_url: None,
        });
    }

    let cache_dir = ensure_cache_bundle_dir()?;
    match resolve_existing_llama_cpp_binary() {
        Ok(Some(binary_path)) => {
            return Ok(EnginePackBootstrapResult {
                binary_path,
                downloaded: false,
                source_url: None,
            });
        }
        Ok(None) => {}
        Err(_) => {
            remove_path_if_exists(&cache_dir)?;
            fs::create_dir_all(&cache_dir).map_err(|error| {
                format!(
                    "LOCAL_AI_ENGINE_PACK_CACHE_DIR_FAILED: failed to recreate cache directory ({}): {error}",
                    cache_dir.display()
                )
            })?;
        }
    }

    let (binary_path, source_url) = download_and_prepare_bundle(cache_dir.as_path())?;
    Ok(EnginePackBootstrapResult {
        binary_path: binary_path.to_string_lossy().to_string(),
        downloaded: true,
        source_url: Some(source_url),
    })
}

#[cfg(test)]
mod tests {
    use super::{
        binary_name, bundle_manifest_path, cache_bundle_dir_path,
        collect_bundle_runtime_files, copy_bundle_to_cache, now_nanos,
        resolve_existing_llama_cpp_binary, write_bundle_manifest,
    };
    use crate::local_runtime::engine_pack_download::asset_score;
    use std::fs;
    use std::path::PathBuf;
    use std::sync::{Mutex, OnceLock};

    fn env_lock() -> &'static Mutex<()> {
        static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
        LOCK.get_or_init(|| Mutex::new(()))
    }

    fn temp_dir(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("nimi-engine-pack-{label}-{}", now_nanos()));
        fs::create_dir_all(&dir).expect("create temp test dir");
        dir
    }

    #[test]
    fn asset_scoring_prefers_llama_server_name() {
        let binary_asset = format!("llama-server-{}", std::env::consts::OS);
        let archive_asset = format!(
            "llama-{}-{}.zip",
            std::env::consts::OS,
            std::env::consts::ARCH
        );
        assert!(asset_score(binary_asset.as_str()) > asset_score(archive_asset.as_str()));
    }

    #[test]
    fn binary_name_is_not_empty() {
        assert!(!binary_name().trim().is_empty());
    }

    #[test]
    fn copy_bundle_to_cache_preserves_runtime_files_and_writes_manifest() {
        let _guard = env_lock().lock().expect("lock env");
        let source_dir = temp_dir("source");
        let cache_dir = temp_dir("cache");
        let binary = source_dir.join(binary_name());
        let dylib = source_dir.join("libmtmd.0.dylib");
        fs::write(&binary, b"#!/bin/sh\n").expect("write fake binary");
        fs::write(&dylib, b"runtime-dependency").expect("write fake dylib");
        #[cfg(unix)]
        std::os::unix::fs::symlink("libmtmd.0.dylib", source_dir.join("libmtmd.dylib"))
            .expect("write fake symlink");

        let copied_binary =
            copy_bundle_to_cache(source_dir.as_path(), cache_dir.as_path()).expect("copy bundle");
        assert!(copied_binary.exists());
        assert!(cache_dir.join("libmtmd.0.dylib").exists());
        #[cfg(unix)]
        {
            let copied_link = cache_dir.join("libmtmd.dylib");
            assert!(fs::symlink_metadata(&copied_link)
                .expect("stat copied symlink")
                .file_type()
                .is_symlink());
        }
        assert!(bundle_manifest_path(cache_dir.as_path()).exists());
        let runtime_files = collect_bundle_runtime_files(cache_dir.as_path())
            .expect("collect copied runtime files");
        assert!(runtime_files.iter().any(|item| item == binary_name()));
        assert!(runtime_files.iter().any(|item| item == "libmtmd.0.dylib"));
        #[cfg(unix)]
        assert!(runtime_files.iter().any(|item| item == "libmtmd.dylib"));
        let _ = fs::remove_dir_all(source_dir);
        let _ = fs::remove_dir_all(cache_dir);
    }

    #[test]
    fn resolve_existing_binary_rejects_partial_cached_bundle() {
        let _guard = env_lock().lock().expect("lock env");
        let runtime_root = temp_dir("runtime-root");
        std::env::set_var(
            "NIMI_LOCAL_AI_RUNTIME_ROOT",
            runtime_root.display().to_string(),
        );
        std::env::remove_var("NIMI_LLAMA_CPP_BIN");
        let cache_dir = cache_bundle_dir_path().expect("cache bundle dir path");
        fs::create_dir_all(&cache_dir).expect("create cache dir");
        fs::write(cache_dir.join(binary_name()), b"#!/bin/sh\n").expect("write cached binary");

        let error =
            resolve_existing_llama_cpp_binary().expect_err("partial cached bundle should fail");
        assert!(error.contains("LOCAL_AI_ENGINE_PACK_BUNDLE_INVALID"));

        let _ = fs::remove_dir_all(runtime_root);
        std::env::remove_var("NIMI_LOCAL_AI_RUNTIME_ROOT");
    }

    #[test]
    fn resolve_existing_binary_accepts_manifest_complete_bundle() {
        let _guard = env_lock().lock().expect("lock env");
        let runtime_root = temp_dir("runtime-root-valid");
        std::env::set_var(
            "NIMI_LOCAL_AI_RUNTIME_ROOT",
            runtime_root.display().to_string(),
        );
        std::env::remove_var("NIMI_LLAMA_CPP_BIN");
        let cache_dir = cache_bundle_dir_path().expect("cache bundle dir path");
        fs::create_dir_all(&cache_dir).expect("create cache dir");
        fs::write(cache_dir.join(binary_name()), b"#!/bin/sh\n").expect("write cached binary");
        fs::write(cache_dir.join("libmtmd.0.dylib"), b"runtime-dependency")
            .expect("write cached dylib");
        write_bundle_manifest(cache_dir.as_path()).expect("write bundle manifest");

        let resolved =
            resolve_existing_llama_cpp_binary().expect("valid bundle should resolve cleanly");
        assert_eq!(
            resolved.as_deref(),
            Some(cache_dir.join(binary_name()).to_string_lossy().as_ref())
        );

        let _ = fs::remove_dir_all(runtime_root);
        std::env::remove_var("NIMI_LOCAL_AI_RUNTIME_ROOT");
    }
}
