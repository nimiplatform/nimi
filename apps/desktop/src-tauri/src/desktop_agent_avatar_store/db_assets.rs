use super::db_queries::read_resource_record;
use super::db_support::{mime_type_for_resource, normalize_resource_relative_path};
use super::types::*;
use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use rusqlite::Connection;
use std::fs;
use std::path::{Path, PathBuf};
use url::Url;

pub(super) fn read_resource_asset_impl(
    conn: &Connection,
    resource_id: &str,
) -> Result<DesktopAgentAvatarResourceAssetPayload, String> {
    let record = read_resource_record(conn, resource_id)?
        .ok_or_else(|| format!("desktop agent avatar resource not found: {resource_id}"))?;
    let path = Url::parse(&record.file_url)
        .ok()
        .and_then(|url| url.to_file_path().ok())
        .unwrap_or_else(|| PathBuf::from(record.file_url.as_str()));
    let bytes = fs::read(&path).map_err(|error| {
        format!(
            "failed to read desktop agent avatar asset ({}): {error}",
            path.display()
        )
    })?;
    Ok(DesktopAgentAvatarResourceAssetPayload {
        mime_type: mime_type_for_resource(record.kind, &path).to_string(),
        base64: BASE64_STANDARD.encode(bytes),
    })
}

pub(super) fn read_relative_resource_asset_impl(
    conn: &Connection,
    resource_id: &str,
    relative_path: &str,
) -> Result<DesktopAgentAvatarResourceAssetPayload, String> {
    let record = read_resource_record(conn, resource_id)?
        .ok_or_else(|| format!("desktop agent avatar resource not found: {resource_id}"))?;
    let normalized_relative_path = normalize_resource_relative_path(relative_path)?;
    let base_dir = Url::parse(&record.file_url)
        .ok()
        .and_then(|url| url.to_file_path().ok())
        .and_then(|path| path.parent().map(Path::to_path_buf))
        .unwrap_or_else(|| PathBuf::from(record.stored_path.as_str()));
    let path = base_dir.join(&normalized_relative_path);
    if !path.starts_with(&record.stored_path) {
        return Err("relativePath must stay within the imported avatar resource".to_string());
    }
    let bytes = fs::read(&path).map_err(|error| {
        format!(
            "failed to read desktop agent avatar dependency ({}): {error}",
            path.display()
        )
    })?;
    Ok(DesktopAgentAvatarResourceAssetPayload {
        mime_type: mime_type_for_resource(record.kind, &path).to_string(),
        base64: BASE64_STANDARD.encode(bytes),
    })
}
