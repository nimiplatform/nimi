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

fn manifest_path(app: &AppHandle) -> PathBuf {
    app.path()
        .resolve(RELEASE_MANIFEST_FILE, BaseDirectory::Resource)
        .ok()
        .filter(|path| path.exists())
        .unwrap_or_else(fallback_manifest_path)
}

pub(super) fn read_manifest(app: &AppHandle) -> Result<DesktopReleaseManifest, String> {
    let manifest = read_manifest_from_path(manifest_path(app).as_path())?;
    validate_release_manifest(&manifest)?;
    Ok(manifest)
}

fn valid_release_text(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value.trim() == value
        && value
            .bytes()
            .all(|byte| (0x21..=0x7e).contains(&byte) && byte != b'/' && byte != b'\\')
}

pub(super) fn validate_release_manifest(manifest: &DesktopReleaseManifest) -> Result<(), String> {
    let expected_version = env!("CARGO_PKG_VERSION");
    if manifest.desktop_version != expected_version {
        return Err(bridge_error(
            "DESKTOP_RELEASE_VERSION_OUT_OF_SYNC",
            format!(
                "desktopVersion {} does not match packaged Desktop version {}",
                manifest.desktop_version, expected_version
            )
            .as_str(),
        ));
    }
    if !valid_release_text(&manifest.desktop_release_id) {
        return Err(bridge_error(
            "DESKTOP_RELEASE_ID_INVALID",
            "desktopReleaseId is not a bounded release identifier",
        ));
    }
    for (field, value) in [
        ("channel", manifest.channel.as_str()),
        ("commit", manifest.commit.as_str()),
    ] {
        if !valid_release_text(value) {
            return Err(bridge_error(
                "DESKTOP_RELEASE_FIELD_INVALID",
                format!("{field} is not a bounded release value").as_str(),
            ));
        }
    }
    chrono::DateTime::parse_from_rfc3339(&manifest.built_at).map_err(|_| {
        bridge_error(
            "DESKTOP_RELEASE_TIMESTAMP_INVALID",
            "builtAt is not an RFC 3339 timestamp",
        )
    })?;
    Ok(())
}
