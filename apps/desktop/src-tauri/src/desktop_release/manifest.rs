use std::fs;
use std::path::{Path, PathBuf};

use tauri::path::BaseDirectory;
use tauri::{AppHandle, Manager};

use super::{bridge_error, DesktopReleaseManifest, RELEASE_MANIFEST_FILE};

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

pub(super) fn read_manifest(app: &AppHandle) -> Result<DesktopReleaseManifest, String> {
    let manifest = read_manifest_from_path(manifest_path(app).as_path())?;
    validate_release_manifest(&manifest)?;
    Ok(manifest)
}

pub(super) fn validate_release_manifest(manifest: &DesktopReleaseManifest) -> Result<(), String> {
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

pub(super) fn resolve_resource_path(
    app: &AppHandle,
    relative_path: &str,
) -> Result<PathBuf, String> {
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
