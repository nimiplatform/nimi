use std::fs;
use std::io::{BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use tauri::path::BaseDirectory;
use tauri::{AppHandle, Manager};

const RELEASE_MANIFEST_FILE: &str = "desktop-release-manifest.json";
const CURRENT_RUNTIME_STATE_FILE: &str = "current.json";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopReleaseInfo {
    pub desktop_version: String,
    pub runtime_version: String,
    pub channel: String,
    pub commit: String,
    pub built_at: String,
    pub runtime_ready: bool,
    pub runtime_staged_path: Option<String>,
    pub runtime_last_error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopReleaseManifest {
    pub desktop_version: String,
    pub runtime_version: String,
    pub channel: String,
    pub commit: String,
    pub runtime_archive_path: String,
    pub runtime_sha256: String,
    pub runtime_binary_path: String,
    pub built_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CurrentRuntimeState {
    version: String,
    binary_path: String,
    switched_at: String,
}

#[derive(Debug, Clone, Default)]
struct DesktopReleaseState {
    manifest: Option<DesktopReleaseManifest>,
    staged_binary_path: Option<PathBuf>,
    runtime_reported_version: Option<String>,
    runtime_last_error: Option<String>,
}

fn release_state() -> &'static Mutex<DesktopReleaseState> {
    static STATE: OnceLock<Mutex<DesktopReleaseState>> = OnceLock::new();
    STATE.get_or_init(|| Mutex::new(DesktopReleaseState::default()))
}

fn bridge_error(code: &str, message: &str) -> String {
    format!("{code}: {message}")
}

fn now_iso_string() -> String {
    let now = chrono::Utc::now();
    now.to_rfc3339()
}

fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_millis())
        .unwrap_or(0)
}

fn read_manifest_from_path(path: &Path) -> Result<DesktopReleaseManifest, String> {
    let raw = fs::read_to_string(path).map_err(|error| {
        bridge_error(
            "DESKTOP_RELEASE_MANIFEST_READ_FAILED",
            format!("failed to read {}: {error}", path.display()).as_str(),
        )
    })?;
    serde_json::from_str::<DesktopReleaseManifest>(&raw).map_err(|error| {
        bridge_error(
            "DESKTOP_RELEASE_MANIFEST_PARSE_FAILED",
            format!("failed to parse {}: {error}", path.display()).as_str(),
        )
    })
}

fn fallback_manifest_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("resources")
        .join(RELEASE_MANIFEST_FILE)
}

fn resource_manifest_path(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .resolve(RELEASE_MANIFEST_FILE, BaseDirectory::Resource)
        .ok()
}

fn manifest_path(app: &AppHandle) -> PathBuf {
    resource_manifest_path(app)
        .filter(|path| path.exists())
        .unwrap_or_else(fallback_manifest_path)
}

fn read_manifest(app: &AppHandle) -> Result<DesktopReleaseManifest, String> {
    let manifest = read_manifest_from_path(manifest_path(app).as_path())?;
    validate_release_manifest(&manifest)?;
    Ok(manifest)
}

fn validate_release_manifest(manifest: &DesktopReleaseManifest) -> Result<(), String> {
    let desktop_version = manifest.desktop_version.trim();
    let runtime_version = manifest.runtime_version.trim();
    let expected_version = env!("CARGO_PKG_VERSION");

    if desktop_version.is_empty() {
        return Err(bridge_error(
            "DESKTOP_RELEASE_VERSION_MISSING",
            "desktopVersion is empty",
        ));
    }
    if runtime_version.is_empty() {
        return Err(bridge_error(
            "DESKTOP_RELEASE_RUNTIME_VERSION_MISSING",
            "runtimeVersion is empty",
        ));
    }
    if desktop_version != runtime_version {
        return Err(bridge_error(
            "DESKTOP_RELEASE_VERSION_MISMATCH",
            format!(
                "desktopVersion {} does not match runtimeVersion {}",
                desktop_version, runtime_version
            )
            .as_str(),
        ));
    }
    if desktop_version != expected_version {
        return Err(bridge_error(
            "DESKTOP_RELEASE_VERSION_OUT_OF_SYNC",
            format!(
                "desktopVersion {} does not match packaged desktop version {}",
                desktop_version, expected_version
            )
            .as_str(),
        ));
    }
    if manifest.channel.trim().is_empty() {
        return Err(bridge_error(
            "DESKTOP_RELEASE_CHANNEL_MISSING",
            "channel is empty",
        ));
    }
    if manifest.runtime_binary_path.trim().is_empty() {
        return Err(bridge_error(
            "DESKTOP_RELEASE_RUNTIME_BINARY_PATH_MISSING",
            "runtimeBinaryPath is empty",
        ));
    }
    Ok(())
}

fn resolve_resource_path(app: &AppHandle, relative_path: &str) -> Result<PathBuf, String> {
    let trimmed = relative_path.trim();
    if trimmed.is_empty() {
        return Err(bridge_error(
            "DESKTOP_RELEASE_RESOURCE_PATH_INVALID",
            "runtime archive path is empty",
        ));
    }
    if let Ok(path) = app.path().resolve(trimmed, BaseDirectory::Resource) {
        if path.exists() {
            return Ok(path);
        }
    }
    let fallback = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("resources")
        .join(trimmed);
    if fallback.exists() {
        return Ok(fallback);
    }
    Err(bridge_error(
        "DESKTOP_RELEASE_RESOURCE_MISSING",
        format!("resource not found: {trimmed}").as_str(),
    ))
}

fn runtime_root_dir() -> Result<PathBuf, String> {
    let root = crate::desktop_paths::resolve_nimi_dir()?.join("runtime");
    fs::create_dir_all(&root).map_err(|error| {
        bridge_error(
            "DESKTOP_RUNTIME_ROOT_CREATE_FAILED",
            format!("failed to create runtime root {}: {error}", root.display()).as_str(),
        )
    })?;
    Ok(root)
}

fn runtime_versions_dir() -> Result<PathBuf, String> {
    let path = runtime_root_dir()?.join("versions");
    fs::create_dir_all(&path).map_err(|error| {
        bridge_error(
            "DESKTOP_RUNTIME_VERSIONS_CREATE_FAILED",
            format!("failed to create versions dir {}: {error}", path.display()).as_str(),
        )
    })?;
    Ok(path)
}

fn runtime_staging_dir() -> Result<PathBuf, String> {
    let path = runtime_root_dir()?.join("staging");
    fs::create_dir_all(&path).map_err(|error| {
        bridge_error(
            "DESKTOP_RUNTIME_STAGING_CREATE_FAILED",
            format!("failed to create staging dir {}: {error}", path.display()).as_str(),
        )
    })?;
    Ok(path)
}

fn current_runtime_state_path() -> Result<PathBuf, String> {
    Ok(runtime_root_dir()?.join(CURRENT_RUNTIME_STATE_FILE))
}

fn write_current_runtime_state(state: &CurrentRuntimeState) -> Result<(), String> {
    let path = current_runtime_state_path()?;
    let payload = serde_json::to_string_pretty(state).map_err(|error| {
        bridge_error(
            "DESKTOP_RUNTIME_CURRENT_STATE_SERIALIZE_FAILED",
            error.to_string().as_str(),
        )
    })?;
    fs::write(&path, payload).map_err(|error| {
        bridge_error(
            "DESKTOP_RUNTIME_CURRENT_STATE_WRITE_FAILED",
            format!("failed to write {}: {error}", path.display()).as_str(),
        )
    })
}

fn sha256_hex(path: &Path) -> Result<String, String> {
    let file = fs::File::open(path).map_err(|error| {
        bridge_error(
            "DESKTOP_RUNTIME_ARCHIVE_OPEN_FAILED",
            format!("failed to open {}: {error}", path.display()).as_str(),
        )
    })?;
    let mut reader = BufReader::new(file);
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 8192];
    loop {
        let read = reader.read(&mut buffer).map_err(|error| {
            bridge_error(
                "DESKTOP_RUNTIME_ARCHIVE_HASH_FAILED",
                format!("failed to hash {}: {error}", path.display()).as_str(),
            )
        })?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

fn extract_zip_to_dir(archive_path: &Path, target_dir: &Path) -> Result<(), String> {
    let file = fs::File::open(archive_path).map_err(|error| {
        bridge_error(
            "DESKTOP_RUNTIME_ARCHIVE_OPEN_FAILED",
            format!("failed to open archive {}: {error}", archive_path.display()).as_str(),
        )
    })?;
    let mut zip = zip::ZipArchive::new(file).map_err(|error| {
        bridge_error(
            "DESKTOP_RUNTIME_ARCHIVE_PARSE_FAILED",
            format!("failed to parse archive {}: {error}", archive_path.display()).as_str(),
        )
    })?;
    for index in 0..zip.len() {
        let mut entry = zip.by_index(index).map_err(|error| {
            bridge_error(
                "DESKTOP_RUNTIME_ARCHIVE_ENTRY_FAILED",
                format!("failed to read archive entry {index}: {error}").as_str(),
            )
        })?;
        let Some(enclosed_path) = entry.enclosed_name().map(|path| path.to_path_buf()) else {
            continue;
        };
        let output_path = target_dir.join(enclosed_path);
        if entry.name().ends_with('/') {
            fs::create_dir_all(&output_path).map_err(|error| {
                bridge_error(
                    "DESKTOP_RUNTIME_ARCHIVE_DIR_CREATE_FAILED",
                    format!("failed to create {}: {error}", output_path.display()).as_str(),
                )
            })?;
            continue;
        }
        if let Some(parent) = output_path.parent() {
            fs::create_dir_all(parent).map_err(|error| {
                bridge_error(
                    "DESKTOP_RUNTIME_ARCHIVE_DIR_CREATE_FAILED",
                    format!("failed to create {}: {error}", parent.display()).as_str(),
                )
            })?;
        }
        let mut output = fs::File::create(&output_path).map_err(|error| {
            bridge_error(
                "DESKTOP_RUNTIME_ARCHIVE_WRITE_FAILED",
                format!("failed to create {}: {error}", output_path.display()).as_str(),
            )
        })?;
        std::io::copy(&mut entry, &mut output).map_err(|error| {
            bridge_error(
                "DESKTOP_RUNTIME_ARCHIVE_WRITE_FAILED",
                format!("failed to write {}: {error}", output_path.display()).as_str(),
            )
        })?;
    }
    Ok(())
}

#[cfg(unix)]
fn set_executable(path: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    let metadata = fs::metadata(path).map_err(|error| {
        bridge_error(
            "DESKTOP_RUNTIME_BINARY_METADATA_FAILED",
            format!("failed to read {} metadata: {error}", path.display()).as_str(),
        )
    })?;
    let mut permissions = metadata.permissions();
    permissions.set_mode(0o755);
    fs::set_permissions(path, permissions).map_err(|error| {
        bridge_error(
            "DESKTOP_RUNTIME_BINARY_PERMISSIONS_FAILED",
            format!("failed to mark {} executable: {error}", path.display()).as_str(),
        )
    })
}

#[cfg(not(unix))]
fn set_executable(_path: &Path) -> Result<(), String> {
    Ok(())
}

fn update_release_state(
    manifest: Option<DesktopReleaseManifest>,
    staged_binary_path: Option<PathBuf>,
    runtime_reported_version: Option<String>,
    runtime_last_error: Option<String>,
) {
    let mut guard = release_state()
        .lock()
        .expect("desktop release state lock poisoned");
    if manifest.is_some() {
        guard.manifest = manifest;
    }
    guard.staged_binary_path = staged_binary_path;
    guard.runtime_reported_version = runtime_reported_version;
    guard.runtime_last_error = runtime_last_error;
}

fn set_runtime_error(message: String) {
    let manifest = {
        release_state()
            .lock()
            .expect("desktop release state lock poisoned")
            .manifest
            .clone()
    };
    update_release_state(manifest, None, None, Some(message));
}

pub fn record_initialize_error(message: String) {
    set_runtime_error(message);
}

fn runtime_version_dir(version: &str) -> Result<PathBuf, String> {
    Ok(runtime_versions_dir()?.join(version))
}

fn cleanup_old_versions(current_version: &str) -> Result<(), String> {
    let versions_dir = runtime_versions_dir()?;
    let mut entries = fs::read_dir(&versions_dir)
        .map_err(|error| {
            bridge_error(
                "DESKTOP_RUNTIME_VERSIONS_READ_FAILED",
                format!("failed to read {}: {error}", versions_dir.display()).as_str(),
            )
        })?
        .filter_map(|entry| entry.ok())
        .filter(|entry| entry.file_type().map(|kind| kind.is_dir()).unwrap_or(false))
        .collect::<Vec<_>>();
    entries.sort_by_key(|entry| {
        entry
            .metadata()
            .and_then(|metadata| metadata.modified())
            .unwrap_or(SystemTime::UNIX_EPOCH)
    });
    let mut keep = entries
        .iter()
        .filter(|entry| entry.file_name() == current_version)
        .map(|entry| entry.path())
        .collect::<Vec<_>>();
    for entry in entries.iter().rev() {
        if keep.len() >= 2 {
            break;
        }
        if entry.file_name() == current_version {
            continue;
        }
        keep.push(entry.path());
    }
    for entry in entries {
        let path = entry.path();
        if keep.iter().any(|keep_path| keep_path == &path) {
            continue;
        }
        let _ = fs::remove_dir_all(path);
    }
    Ok(())
}

fn probe_runtime_binary_version(binary_path: &Path) -> Result<String, String> {
    let output = Command::new(binary_path)
        .args(["version", "--json"])
        .output()
        .map_err(|error| {
            bridge_error(
                "DESKTOP_RUNTIME_VERSION_PROBE_FAILED",
                format!(
                    "failed to execute bundled runtime version probe {}: {error}",
                    binary_path.display()
                )
                .as_str(),
            )
        })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        let detail = stderr.trim();
        let fallback = stdout.trim();
        let message = if !detail.is_empty() { detail } else { fallback };
        return Err(bridge_error(
            "DESKTOP_RUNTIME_VERSION_PROBE_EXIT_FAILED",
            format!(
                "bundled runtime version probe exited with status {} for {}: {}",
                output
                    .status
                    .code()
                    .map(|value| value.to_string())
                    .unwrap_or_else(|| "signal".to_string()),
                binary_path.display(),
                message
            )
            .as_str(),
        ));
    }

    let payload = serde_json::from_slice::<Value>(&output.stdout).map_err(|error| {
        bridge_error(
            "DESKTOP_RUNTIME_VERSION_PROBE_PARSE_FAILED",
            format!(
                "failed to parse bundled runtime version payload {}: {error}",
                binary_path.display()
            )
            .as_str(),
        )
    })?;
    let version = payload
        .get("nimi")
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            bridge_error(
                "DESKTOP_RUNTIME_VERSION_PROBE_MISSING",
                format!(
                    "bundled runtime version payload {} is missing `nimi`",
                    binary_path.display()
                )
                .as_str(),
            )
        })?;
    Ok(version.to_string())
}

fn validate_runtime_binary_version(
    manifest: &DesktopReleaseManifest,
    binary_path: &Path,
) -> Result<String, String> {
    let reported_version = probe_runtime_binary_version(binary_path)?;
    if reported_version != manifest.runtime_version {
        return Err(bridge_error(
            "DESKTOP_RUNTIME_VERSION_REPORT_MISMATCH",
            format!(
                "bundled runtime {} reported version {} but manifest requires {}",
                binary_path.display(),
                reported_version,
                manifest.runtime_version
            )
            .as_str(),
        ));
    }
    Ok(reported_version)
}

fn stage_runtime_archive(
    manifest: &DesktopReleaseManifest,
    archive_path: &Path,
) -> Result<(PathBuf, String), String> {
    if manifest.runtime_sha256.trim().is_empty() {
        return Err(bridge_error(
            "DESKTOP_RUNTIME_ARCHIVE_SHA_MISSING",
            "runtime archive sha256 is empty",
        ));
    }
    let actual_sha = sha256_hex(archive_path)?;
    if actual_sha != manifest.runtime_sha256.to_ascii_lowercase() {
        return Err(bridge_error(
            "DESKTOP_RUNTIME_ARCHIVE_SHA_MISMATCH",
            format!(
                "runtime archive sha mismatch: expected {}, got {}",
                manifest.runtime_sha256, actual_sha
            )
            .as_str(),
        ));
    }

    let version_dir = runtime_version_dir(manifest.runtime_version.as_str())?;
    let target_binary = version_dir.join(manifest.runtime_binary_path.as_str());
    if target_binary.exists() {
        set_executable(&target_binary)?;
        let reported_version = validate_runtime_binary_version(manifest, &target_binary)?;
        write_current_runtime_state(&CurrentRuntimeState {
            version: manifest.runtime_version.clone(),
            binary_path: target_binary.display().to_string(),
            switched_at: now_iso_string(),
        })?;
        let _ = cleanup_old_versions(manifest.runtime_version.as_str());
        return Ok((target_binary, reported_version));
    }

    let staging_dir =
        runtime_staging_dir()?.join(format!("{}-{}", manifest.runtime_version, now_ms()));
    if staging_dir.exists() {
        let _ = fs::remove_dir_all(&staging_dir);
    }
    fs::create_dir_all(&staging_dir).map_err(|error| {
        bridge_error(
            "DESKTOP_RUNTIME_STAGING_CREATE_FAILED",
            format!("failed to create {}: {error}", staging_dir.display()).as_str(),
        )
    })?;
    extract_zip_to_dir(archive_path, &staging_dir)?;
    let staged_binary = staging_dir.join(manifest.runtime_binary_path.as_str());
    if !staged_binary.exists() {
        return Err(bridge_error(
            "DESKTOP_RUNTIME_BINARY_MISSING",
            format!("missing staged runtime binary {}", staged_binary.display()).as_str(),
        ));
    }
    set_executable(&staged_binary)?;
    let reported_version = match validate_runtime_binary_version(manifest, &staged_binary) {
        Ok(value) => value,
        Err(error) => {
            let _ = fs::remove_dir_all(&staging_dir);
            return Err(error);
        }
    };
    if version_dir.exists() {
        let _ = fs::remove_dir_all(&version_dir);
    }
    if let Some(parent) = version_dir.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            bridge_error(
                "DESKTOP_RUNTIME_VERSIONS_CREATE_FAILED",
                format!("failed to create {}: {error}", parent.display()).as_str(),
            )
        })?;
    }
    fs::rename(&staging_dir, &version_dir).map_err(|error| {
        bridge_error(
            "DESKTOP_RUNTIME_STAGE_PROMOTE_FAILED",
            format!(
                "failed to promote {} to {}: {error}",
                staging_dir.display(),
                version_dir.display()
            )
            .as_str(),
        )
    })?;
    let promoted_binary = version_dir.join(manifest.runtime_binary_path.as_str());
    set_executable(&promoted_binary)?;
    write_current_runtime_state(&CurrentRuntimeState {
        version: manifest.runtime_version.clone(),
        binary_path: promoted_binary.display().to_string(),
        switched_at: now_iso_string(),
    })?;
    let _ = cleanup_old_versions(manifest.runtime_version.as_str());
    Ok((promoted_binary, reported_version))
}

pub fn initialize(app: &AppHandle) -> Result<DesktopReleaseInfo, String> {
    let manifest = read_manifest(app)?;
    update_release_state(Some(manifest.clone()), None, None, None);
    let runtime_result = if std::env::var("NIMI_RUNTIME_BRIDGE_MODE")
        .ok()
        .map(|value| value.trim().eq_ignore_ascii_case("runtime"))
        .unwrap_or(false)
    {
        Ok(None)
    } else if manifest.runtime_archive_path.trim().is_empty() {
        Err(bridge_error(
            "DESKTOP_RUNTIME_ARCHIVE_MISSING",
            "desktop release manifest is missing runtime archive path",
        ))
    } else {
        let archive_path = resolve_resource_path(app, manifest.runtime_archive_path.as_str())?;
        stage_runtime_archive(&manifest, archive_path.as_path()).map(Some)
    };

    match runtime_result {
        Ok(staged_runtime) => {
            let (staged_binary_path, runtime_reported_version) = match staged_runtime {
                Some((path, version)) => (Some(path), Some(version)),
                None => (None, None),
            };
            update_release_state(
                Some(manifest.clone()),
                staged_binary_path.clone(),
                runtime_reported_version,
                None,
            );
            Ok(DesktopReleaseInfo {
                desktop_version: manifest.desktop_version,
                runtime_version: manifest.runtime_version,
                channel: manifest.channel,
                commit: manifest.commit,
                built_at: manifest.built_at,
                runtime_ready: staged_binary_path.is_some(),
                runtime_staged_path: staged_binary_path.map(|path| path.display().to_string()),
                runtime_last_error: None,
            })
        }
        Err(error) => {
            set_runtime_error(error.clone());
            Err(error)
        }
    }
}

pub fn release_info() -> Result<DesktopReleaseInfo, String> {
    let guard = release_state()
        .lock()
        .expect("desktop release state lock poisoned");
    if let Some(error) = &guard.runtime_last_error {
        return Err(error.clone());
    }
    if let Some(manifest) = &guard.manifest {
        return Ok(DesktopReleaseInfo {
            desktop_version: manifest.desktop_version.clone(),
            runtime_version: manifest.runtime_version.clone(),
            channel: manifest.channel.clone(),
            commit: manifest.commit.clone(),
            built_at: manifest.built_at.clone(),
            runtime_ready: guard.staged_binary_path.is_some(),
            runtime_staged_path: guard
                .staged_binary_path
                .as_ref()
                .map(|path| path.display().to_string()),
            runtime_last_error: guard.runtime_last_error.clone(),
        });
    }
    Err(bridge_error(
        "DESKTOP_RELEASE_INFO_UNAVAILABLE",
        "desktop release metadata is unavailable",
    ))
}

pub fn staged_runtime_binary_path() -> Option<PathBuf> {
    release_state()
        .lock()
        .expect("desktop release state lock poisoned")
        .staged_binary_path
        .clone()
}

pub fn runtime_last_error() -> Option<String> {
    release_state()
        .lock()
        .expect("desktop release state lock poisoned")
        .runtime_last_error
        .clone()
}

pub fn current_release_version() -> Option<String> {
    release_state()
        .lock()
        .expect("desktop release state lock poisoned")
        .manifest
        .as_ref()
        .map(|manifest| manifest.desktop_version.clone())
}

#[cfg(test)]
pub(crate) fn reset_test_state() {
    let mut guard = release_state()
        .lock()
        .expect("desktop release state lock poisoned");
    *guard = DesktopReleaseState::default();
}

#[cfg(test)]
pub(crate) fn set_test_release_version(version: &str) {
    let mut guard = release_state()
        .lock()
        .expect("desktop release state lock poisoned");
    guard.manifest = Some(DesktopReleaseManifest {
        desktop_version: version.to_string(),
        runtime_version: version.to_string(),
        channel: "stable".to_string(),
        commit: "test".to_string(),
        runtime_archive_path: "runtime/test/nimi-runtime.zip".to_string(),
        runtime_sha256: "sha256".to_string(),
        runtime_binary_path: "bin/nimi".to_string(),
        built_at: "2026-03-15T00:00:00Z".to_string(),
    });
    guard.runtime_last_error = None;
}

#[tauri::command]
pub fn desktop_release_info_get() -> Result<DesktopReleaseInfo, String> {
    release_info()
}

#[cfg(test)]
mod tests {
    use super::{
        cleanup_old_versions, current_runtime_state_path, release_info, reset_test_state,
        runtime_version_dir, sha256_hex, stage_runtime_archive, validate_release_manifest,
        DesktopReleaseManifest,
    };
    use std::collections::HashMap;
    use std::fs;
    use std::io::Write;
    use std::path::{Path, PathBuf};
    use std::sync::{Mutex, OnceLock};
    use std::time::{SystemTime, UNIX_EPOCH};

    fn env_lock() -> &'static Mutex<()> {
        static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
        LOCK.get_or_init(|| Mutex::new(()))
    }

    fn with_env(updates: &[(&str, Option<&str>)], run: impl FnOnce()) {
        let _guard = env_lock().lock().expect("env lock");
        let mut previous = HashMap::<String, Option<String>>::new();
        for (key, value) in updates {
            previous.insert((*key).to_string(), std::env::var(key).ok());
            match value {
                Some(next) => std::env::set_var(key, next),
                None => std::env::remove_var(key),
            }
        }
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(run));
        for (key, value) in previous {
            match value {
                Some(prev) => std::env::set_var(key, prev),
                None => std::env::remove_var(key),
            }
        }
        if let Err(payload) = result {
            std::panic::resume_unwind(payload);
        }
    }

    fn temp_home(prefix: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("nimi-desktop-release-{prefix}-{unique}"));
        fs::create_dir_all(&dir).expect("create temp dir");
        dir
    }

    fn write_runtime_zip(path: &Path, binary_relative_path: &str, content: &[u8]) {
        let file = fs::File::create(path).expect("create zip");
        let mut zip = zip::ZipWriter::new(file);
        let options: zip::write::FileOptions<'_, ()> = zip::write::FileOptions::default();
        zip.start_file(binary_relative_path.replace('\\', "/"), options)
            .expect("start file");
        zip.write_all(content).expect("write zip entry");
        zip.finish().expect("finish zip");
    }

    fn test_binary_relative_path() -> &'static str {
        if cfg!(windows) {
            "bin/nimi.cmd"
        } else {
            "bin/nimi"
        }
    }

    fn runtime_probe_fixture(version: &str) -> Vec<u8> {
        if cfg!(windows) {
            format!(
                "@echo off\r\nif \"%1\"==\"version\" if \"%2\"==\"--json\" (\r\n  echo {{\"nimi\":\"{version}\"}}\r\n  exit /b 0\r\n)\r\nexit /b 9\r\n"
            )
            .into_bytes()
        } else {
            format!(
                "#!/bin/sh\nif [ \"$1\" = \"version\" ] && [ \"$2\" = \"--json\" ]; then\n  printf '%s\\n' '{{\"nimi\":\"{version}\"}}'\n  exit 0\nfi\nexit 9\n"
            )
            .into_bytes()
        }
    }

    fn test_manifest_with_sha(
        archive_path: &Path,
        runtime_version: &str,
        runtime_sha256: String,
    ) -> DesktopReleaseManifest {
        DesktopReleaseManifest {
            desktop_version: runtime_version.to_string(),
            runtime_version: runtime_version.to_string(),
            channel: "stable".to_string(),
            commit: "test".to_string(),
            runtime_archive_path: archive_path.display().to_string(),
            runtime_sha256,
            runtime_binary_path: test_binary_relative_path().to_string(),
            built_at: "2026-01-01T00:00:00.000Z".to_string(),
        }
    }

    fn test_manifest(archive_path: &Path, runtime_version: &str) -> DesktopReleaseManifest {
        test_manifest_with_sha(
            archive_path,
            runtime_version,
            sha256_hex(archive_path).expect("archive sha"),
        )
    }

    #[test]
    fn validate_release_manifest_rejects_mismatched_versions() {
        let archive = PathBuf::from("runtime.zip");
        let mut manifest = test_manifest_with_sha(&archive, "9.9.9", "deadbeef".to_string());
        manifest.runtime_version = "9.9.8".to_string();

        let error = validate_release_manifest(&manifest).err().unwrap_or_default();
        assert!(error.contains("DESKTOP_RELEASE_VERSION_MISMATCH"));
    }

    #[test]
    fn validate_release_manifest_rejects_packaged_version_drift() {
        let archive = PathBuf::from("runtime.zip");
        let manifest = test_manifest_with_sha(&archive, "9.9.9", "deadbeef".to_string());

        let error = validate_release_manifest(&manifest).err().unwrap_or_default();
        assert!(error.contains("DESKTOP_RELEASE_VERSION_OUT_OF_SYNC"));
    }

    #[test]
    fn validate_release_manifest_accepts_current_package_version() {
        let archive = PathBuf::from("runtime.zip");
        let manifest =
            test_manifest_with_sha(&archive, env!("CARGO_PKG_VERSION"), "deadbeef".to_string());

        assert!(validate_release_manifest(&manifest).is_ok());
    }

    #[test]
    fn stage_runtime_archive_extracts_runtime_and_writes_current_state() {
        let home = temp_home("extracts");
        let archive = home.join("runtime.zip");
        write_runtime_zip(
            &archive,
            test_binary_relative_path(),
            runtime_probe_fixture("1.2.3").as_slice(),
        );
        let manifest = test_manifest(&archive, "1.2.3");

        with_env(&[("HOME", home.to_str())], || {
            let (staged, version) = stage_runtime_archive(&manifest, &archive).expect("stage runtime");
            assert!(staged.exists());
            assert_eq!(version, "1.2.3");

            let current_state = fs::read_to_string(current_runtime_state_path().expect("current state path"))
                .expect("read current state");
            assert!(current_state.contains("\"version\": \"1.2.3\""));
            assert!(current_state.contains(staged.display().to_string().as_str()));
        });
    }

    #[test]
    fn stage_runtime_archive_reuses_existing_runtime_and_refreshes_current_state() {
        let home = temp_home("reuses");
        let archive = home.join("runtime.zip");
        write_runtime_zip(
            &archive,
            test_binary_relative_path(),
            runtime_probe_fixture("2.0.0").as_slice(),
        );
        let manifest = test_manifest(&archive, "2.0.0");

        with_env(&[("HOME", home.to_str())], || {
            let version_dir = runtime_version_dir("2.0.0").expect("version dir");
            fs::create_dir_all(version_dir.join("bin")).expect("create bin dir");
            let existing_binary = version_dir.join(test_binary_relative_path());
            fs::write(&existing_binary, runtime_probe_fixture("2.0.0")).expect("write existing runtime");

            let (staged, version) = stage_runtime_archive(&manifest, &archive).expect("reuse runtime");
            assert_eq!(staged, existing_binary);
            assert_eq!(version, "2.0.0");

            let current_state = fs::read_to_string(current_runtime_state_path().expect("current state path"))
                .expect("read current state");
            assert!(current_state.contains("\"version\": \"2.0.0\""));
            assert!(current_state.contains(existing_binary.display().to_string().as_str()));
        });
    }

    #[test]
    fn stage_runtime_archive_rejects_sha_mismatch() {
        let home = temp_home("sha-mismatch");
        let archive = home.join("runtime.zip");
        write_runtime_zip(
            &archive,
            test_binary_relative_path(),
            runtime_probe_fixture("3.0.0").as_slice(),
        );
        let mut manifest = test_manifest(&archive, "3.0.0");
        manifest.runtime_sha256 = "deadbeef".to_string();

        with_env(&[("HOME", home.to_str())], || {
            let error = stage_runtime_archive(&manifest, &archive)
                .err()
                .unwrap_or_default();
            assert!(error.contains("DESKTOP_RUNTIME_ARCHIVE_SHA_MISMATCH"));
        });
    }

    #[test]
    fn stage_runtime_archive_rejects_runtime_version_mismatch() {
        let home = temp_home("version-mismatch");
        let archive = home.join("runtime.zip");
        write_runtime_zip(
            &archive,
            test_binary_relative_path(),
            runtime_probe_fixture("4.0.1").as_slice(),
        );
        let manifest = test_manifest(&archive, "4.0.0");

        with_env(&[("HOME", home.to_str())], || {
            let error = stage_runtime_archive(&manifest, &archive)
                .err()
                .unwrap_or_default();
            assert!(error.contains("DESKTOP_RUNTIME_VERSION_REPORT_MISMATCH"));
        });
    }

    #[test]
    fn cleanup_old_versions_keeps_current_and_most_recent_previous() {
        let home = temp_home("cleanup");
        with_env(&[("HOME", home.to_str())], || {
            for version in ["1.0.0", "1.1.0", "1.2.0"] {
                let dir = runtime_version_dir(version).expect("version dir");
                fs::create_dir_all(&dir).expect("create version dir");
                std::thread::sleep(std::time::Duration::from_millis(5));
            }
            cleanup_old_versions("1.2.0").expect("cleanup old versions");

            assert!(!runtime_version_dir("1.0.0").expect("v1").exists());
            assert!(runtime_version_dir("1.1.0").expect("v2").exists());
            assert!(runtime_version_dir("1.2.0").expect("v3").exists());
        });
    }

    #[test]
    fn release_info_fails_close_after_initialize_error() {
        reset_test_state();
        super::record_initialize_error("DESKTOP_RUNTIME_ARCHIVE_MISSING: no archive".to_string());
        let error = release_info().err().unwrap_or_default();
        assert!(error.contains("DESKTOP_RUNTIME_ARCHIVE_MISSING"));
        reset_test_state();
    }
}
