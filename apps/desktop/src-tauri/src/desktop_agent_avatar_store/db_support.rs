use super::types::*;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use url::Url;

pub(super) const AVATAR_ROOT_DIR_NAME: &str = "avatar-resources";
pub(super) const AVATAR_MANAGED_RESOURCES_DIR: &str = "resources";
pub(super) const AVATAR_DB_FILE_NAME: &str = "registry.db";
pub(super) const AVATAR_DB_SCHEMA_VERSION: i64 = 1;

pub(super) fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}

pub(super) fn normalize_required_string(value: &str, field_name: &str) -> Result<String, String> {
    let normalized = value.trim();
    if normalized.is_empty() {
        return Err(format!("{field_name} must not be empty"));
    }
    Ok(normalized.to_string())
}

pub(super) fn normalize_optional_string(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(|text| text.to_string())
}

pub(super) fn require_non_negative_ms(value: i64, field_name: &str) -> Result<i64, String> {
    if value < 0 {
        return Err(format!("{field_name} must be a non-negative integer"));
    }
    Ok(value)
}

pub(super) fn normalize_source_path(path: &str, field_name: &str) -> Result<PathBuf, String> {
    let normalized = normalize_required_string(path, field_name)?;
    let candidate = PathBuf::from(normalized);
    if !candidate.is_absolute() {
        return Err(format!("{field_name} must be an absolute path"));
    }
    let canonical = std::fs::canonicalize(&candidate).map_err(|error| {
        format!(
            "failed to resolve {field_name} ({}): {error}",
            candidate.display()
        )
    })?;
    Ok(crate::desktop_paths::normalize_desktop_absolute_path(
        &canonical,
    ))
}

pub(super) fn resource_root_dir() -> Result<PathBuf, String> {
    let root = crate::desktop_paths::resolve_nimi_data_dir()?.join(AVATAR_ROOT_DIR_NAME);
    fs::create_dir_all(root.join(AVATAR_MANAGED_RESOURCES_DIR)).map_err(|error| {
        format!(
            "failed to create avatar resource root ({}): {error}",
            root.display()
        )
    })?;
    Ok(root)
}

pub(super) fn db_path() -> Result<PathBuf, String> {
    Ok(resource_root_dir()?.join(AVATAR_DB_FILE_NAME))
}

pub(super) fn kind_to_db(value: DesktopAgentAvatarResourceKind) -> &'static str {
    match value {
        DesktopAgentAvatarResourceKind::Vrm => "vrm",
        DesktopAgentAvatarResourceKind::Live2d => "live2d",
    }
}

pub(super) fn parse_kind(value: &str) -> Result<DesktopAgentAvatarResourceKind, String> {
    match value {
        "vrm" => Ok(DesktopAgentAvatarResourceKind::Vrm),
        "live2d" => Ok(DesktopAgentAvatarResourceKind::Live2d),
        other => Err(format!("desktop agent avatar kind is invalid: {other}")),
    }
}

pub(super) fn status_to_db(value: DesktopAgentAvatarResourceStatus) -> &'static str {
    match value {
        DesktopAgentAvatarResourceStatus::Ready => "ready",
        DesktopAgentAvatarResourceStatus::Invalid => "invalid",
        DesktopAgentAvatarResourceStatus::Missing => "missing",
    }
}

pub(super) fn parse_status(value: &str) -> Result<DesktopAgentAvatarResourceStatus, String> {
    match value {
        "ready" => Ok(DesktopAgentAvatarResourceStatus::Ready),
        "invalid" => Ok(DesktopAgentAvatarResourceStatus::Invalid),
        "missing" => Ok(DesktopAgentAvatarResourceStatus::Missing),
        other => Err(format!("desktop agent avatar status is invalid: {other}")),
    }
}

pub(super) fn slugify_segment(value: &str) -> String {
    let mut result = String::with_capacity(value.len());
    let mut last_dash = false;
    for character in value.chars() {
        let next = character.to_ascii_lowercase();
        if next.is_ascii_alphanumeric() {
            result.push(next);
            last_dash = false;
        } else if !last_dash {
            result.push('-');
            last_dash = true;
        }
    }
    result.trim_matches('-').to_string()
}

pub(super) fn generate_resource_id(seed: &str) -> String {
    let slug = slugify_segment(seed);
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    if slug.is_empty() {
        format!("avatar-{stamp}")
    } else {
        format!("{slug}-{stamp}")
    }
}

pub(super) fn copy_file(source: &Path, destination: &Path) -> Result<(), String> {
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "failed to create import directory ({}): {error}",
                parent.display()
            )
        })?;
    }
    fs::copy(source, destination).map_err(|error| {
        format!(
            "failed to copy avatar resource file from {} to {}: {error}",
            source.display(),
            destination.display()
        )
    })?;
    Ok(())
}

pub(super) fn copy_directory_recursive(source: &Path, destination: &Path) -> Result<(), String> {
    fs::create_dir_all(destination).map_err(|error| {
        format!(
            "failed to create import directory ({}): {error}",
            destination.display()
        )
    })?;
    for entry in fs::read_dir(source).map_err(|error| {
        format!(
            "failed to read source directory ({}): {error}",
            source.display()
        )
    })? {
        let entry =
            entry.map_err(|error| format!("failed to read source directory entry: {error}"))?;
        let file_type = entry.file_type().map_err(|error| {
            format!(
                "failed to inspect source entry {}: {error}",
                entry.path().display()
            )
        })?;
        if file_type.is_symlink() {
            return Err(format!(
                "symbolic links are not supported for avatar import ({})",
                entry.path().display()
            ));
        }
        let destination_path = destination.join(entry.file_name());
        if file_type.is_dir() {
            copy_directory_recursive(&entry.path(), &destination_path)?;
        } else if file_type.is_file() {
            copy_file(&entry.path(), &destination_path)?;
        }
    }
    Ok(())
}

pub(super) fn file_url_from_path(path: &Path) -> Result<String, String> {
    Url::from_file_path(path)
        .map(|url| url.to_string())
        .map_err(|_| {
            format!(
                "failed to convert avatar path to file URL ({})",
                path.display()
            )
        })
}

pub(super) fn derive_resource_record(
    resource_id: String,
    kind: DesktopAgentAvatarResourceKind,
    display_name: String,
    source_filename: String,
    resource_relative_dir: String,
    entry_relative_path: String,
    poster_relative_path: Option<String>,
    imported_at_ms: i64,
    updated_at_ms: i64,
    status: DesktopAgentAvatarResourceStatus,
) -> Result<DesktopAgentAvatarResourceRecord, String> {
    let root = resource_root_dir()?;
    let stored_path = root.join(&resource_relative_dir);
    let entry_path = stored_path.join(&entry_relative_path);
    let poster_path = poster_relative_path
        .as_ref()
        .map(|value| stored_path.join(value));
    let derived_status = if entry_path.exists() {
        status
    } else {
        DesktopAgentAvatarResourceStatus::Missing
    };
    Ok(DesktopAgentAvatarResourceRecord {
        resource_id,
        kind,
        display_name,
        source_filename,
        stored_path: stored_path.display().to_string(),
        file_url: file_url_from_path(&entry_path)?,
        poster_path: poster_path.map(|value| value.display().to_string()),
        imported_at_ms,
        updated_at_ms,
        status: derived_status,
    })
}

pub(super) fn mime_type_for_resource(
    kind: DesktopAgentAvatarResourceKind,
    path: &Path,
) -> &'static str {
    match kind {
        DesktopAgentAvatarResourceKind::Vrm => "model/gltf-binary",
        DesktopAgentAvatarResourceKind::Live2d => match path
            .extension()
            .and_then(|value| value.to_str())
            .map(|value| value.to_ascii_lowercase())
            .as_deref()
        {
            Some("json") => "application/json",
            Some("moc3") => "application/octet-stream",
            Some("png") => "image/png",
            Some("jpg") | Some("jpeg") => "image/jpeg",
            _ => "application/octet-stream",
        },
    }
}

pub(super) fn normalize_resource_relative_path(value: &str) -> Result<String, String> {
    let normalized = normalize_required_string(value, "relativePath")?;
    if normalized.starts_with('/') || normalized.starts_with('\\') {
        return Err("relativePath must stay within the imported avatar resource".to_string());
    }
    let candidate = Path::new(&normalized);
    if candidate
        .components()
        .any(|component| matches!(component, std::path::Component::ParentDir))
    {
        return Err(
            "relativePath must not traverse outside the imported avatar resource".to_string(),
        );
    }
    Ok(normalized.replace('\\', "/"))
}
