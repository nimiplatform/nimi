use std::fs;
use std::io::{BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::SystemTime;

use serde_json::Value;
use sha2::{Digest, Sha256};

use super::{
    bridge_error, now_iso_string, now_ms, DesktopReleaseManifest,
};
use super::runtime_paths::{
    runtime_staging_dir, runtime_versions_dir, write_current_runtime_state, CurrentRuntimeState,
};

pub(super) fn sha256_hex(path: &Path) -> Result<String, String> {
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

pub(super) fn runtime_version_dir(version: &str) -> Result<PathBuf, String> {
    Ok(runtime_versions_dir()?.join(version))
}

pub(super) fn cleanup_old_versions(current_version: &str) -> Result<(), String> {
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

pub(super) fn stage_runtime_archive(
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
