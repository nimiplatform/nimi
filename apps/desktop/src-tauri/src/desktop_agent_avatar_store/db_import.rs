use super::db_queries::{read_resource_record, set_binding_impl};
use super::db_support::{
    copy_directory_recursive, copy_file, generate_resource_id, kind_to_db,
    normalize_optional_string, normalize_source_path, now_ms, require_non_negative_ms,
    resource_root_dir, status_to_db, AVATAR_MANAGED_RESOURCES_DIR,
};
use super::types::*;
use rusqlite::{params, Connection};
use std::fs;
use std::path::Path;

fn resolve_display_name(candidate: Option<&str>, fallback: &str) -> String {
    normalize_optional_string(candidate).unwrap_or_else(|| fallback.to_string())
}

fn find_live2d_entry_relative_path(source_root: &Path) -> Result<String, String> {
    let mut stack = vec![source_root.to_path_buf()];
    while let Some(next) = stack.pop() {
        let entries = fs::read_dir(&next).map_err(|error| {
            format!(
                "failed to read Live2D source directory ({}): {error}",
                next.display()
            )
        })?;
        for entry in entries {
            let entry =
                entry.map_err(|error| format!("failed to read Live2D source entry: {error}"))?;
            let file_type = entry.file_type().map_err(|error| {
                format!(
                    "failed to inspect Live2D entry {}: {error}",
                    entry.path().display()
                )
            })?;
            if file_type.is_dir() {
                stack.push(entry.path());
                continue;
            }
            if !file_type.is_file() {
                continue;
            }
            let path = entry.path();
            let Some(filename) = path.file_name().and_then(|value| value.to_str()) else {
                continue;
            };
            if filename.ends_with(".model3.json") {
                let relative = path.strip_prefix(source_root).map_err(|error| {
                    format!("failed to resolve Live2D relative entry path: {error}")
                })?;
                return Ok(relative.to_string_lossy().replace('\\', "/"));
            }
        }
    }
    Err("Live2D import requires a runtime directory containing a *.model3.json entry".to_string())
}

pub(super) fn import_vrm_impl(
    conn: &Connection,
    payload: &DesktopAgentAvatarImportVrmPayload,
) -> Result<DesktopAgentAvatarImportResult, String> {
    let source_path = normalize_source_path(&payload.source_path, "sourcePath")?;
    if !source_path.is_file() {
        return Err("sourcePath must point to a VRM file".to_string());
    }
    let extension = source_path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.trim().to_ascii_lowercase())
        .unwrap_or_default();
    if extension != "vrm" {
        return Err("sourcePath must end with .vrm".to_string());
    }
    let source_filename = source_path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "sourcePath must have a valid filename".to_string())?
        .to_string();
    let display_name = resolve_display_name(
        payload.display_name.as_deref(),
        source_path
            .file_stem()
            .and_then(|value| value.to_str())
            .unwrap_or("VRM Avatar"),
    );
    let imported_at_ms = require_non_negative_ms(
        payload.imported_at_ms.unwrap_or_else(now_ms),
        "importedAtMs",
    )?;
    let resource_id = generate_resource_id(&display_name);
    let resource_relative_dir = format!("{}/{}", AVATAR_MANAGED_RESOURCES_DIR, resource_id);
    let entry_relative_path = source_filename.clone();
    let destination_dir = resource_root_dir()?.join(&resource_relative_dir);
    let destination_path = destination_dir.join(&entry_relative_path);
    copy_file(&source_path, &destination_path)?;

    conn.execute(
        r#"
        INSERT INTO desktop_agent_avatar_resources (
          resource_id,
          kind,
          display_name,
          source_filename,
          resource_relative_dir,
          entry_relative_path,
          poster_relative_path,
          imported_at_ms,
          updated_at_ms,
          status
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL, ?7, ?8, ?9)
        "#,
        params![
            resource_id,
            kind_to_db(DesktopAgentAvatarResourceKind::Vrm),
            display_name,
            source_filename,
            resource_relative_dir,
            entry_relative_path,
            imported_at_ms,
            imported_at_ms,
            status_to_db(DesktopAgentAvatarResourceStatus::Ready),
        ],
    )
    .map_err(|error| format!("failed to persist VRM avatar resource: {error}"))?;

    let resource = read_resource_record(conn, &resource_id)?
        .ok_or_else(|| "VRM avatar resource missing after import".to_string())?;
    let binding =
        if let Some(agent_id) = normalize_optional_string(payload.bind_agent_id.as_deref()) {
            Some(set_binding_impl(
                conn,
                &DesktopAgentAvatarBindingSetPayload {
                    agent_id,
                    resource_id: resource.resource_id.clone(),
                    updated_at_ms: imported_at_ms,
                },
            )?)
        } else {
            None
        };
    Ok(DesktopAgentAvatarImportResult { resource, binding })
}

pub(super) fn import_live2d_impl(
    conn: &Connection,
    payload: &DesktopAgentAvatarImportLive2dPayload,
) -> Result<DesktopAgentAvatarImportResult, String> {
    let source_path = normalize_source_path(&payload.source_path, "sourcePath")?;
    let (source_root, entry_relative_path, source_filename, default_display_name) = if source_path
        .is_dir()
    {
        let source_filename = source_path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("live2d")
            .to_string();
        let entry_relative_path = find_live2d_entry_relative_path(&source_path)?;
        let display_name = source_path
            .file_stem()
            .and_then(|value| value.to_str())
            .unwrap_or("Live2D Avatar")
            .to_string();
        (
            source_path.clone(),
            entry_relative_path,
            source_filename,
            display_name,
        )
    } else if source_path.is_file() {
        let file_name = source_path
            .file_name()
            .and_then(|value| value.to_str())
            .ok_or_else(|| "sourcePath must have a valid filename".to_string())?;
        if !file_name.ends_with(".model3.json") {
            return Err("Live2D import file path must point to a *.model3.json file".to_string());
        }
        let source_root = source_path
            .parent()
            .ok_or_else(|| "Live2D model path must have a parent directory".to_string())?
            .to_path_buf();
        let entry_relative_path = source_path
            .file_name()
            .and_then(|value| value.to_str())
            .ok_or_else(|| "sourcePath must have a valid filename".to_string())?
            .to_string();
        let default_display_name = source_path
            .file_stem()
            .and_then(|value| value.to_str())
            .unwrap_or("Live2D Avatar")
            .replace(".model3", "");
        (
            source_root,
            entry_relative_path,
            file_name.to_string(),
            default_display_name,
        )
    } else {
        return Err(
            "sourcePath must point to a Live2D runtime directory or *.model3.json file".to_string(),
        );
    };

    let display_name = resolve_display_name(payload.display_name.as_deref(), &default_display_name);
    let imported_at_ms = require_non_negative_ms(
        payload.imported_at_ms.unwrap_or_else(now_ms),
        "importedAtMs",
    )?;
    let resource_id = generate_resource_id(&display_name);
    let resource_relative_dir = format!("{}/{}", AVATAR_MANAGED_RESOURCES_DIR, resource_id);
    let destination_dir = resource_root_dir()?.join(&resource_relative_dir);
    copy_directory_recursive(&source_root, &destination_dir)?;

    conn.execute(
        r#"
        INSERT INTO desktop_agent_avatar_resources (
          resource_id,
          kind,
          display_name,
          source_filename,
          resource_relative_dir,
          entry_relative_path,
          poster_relative_path,
          imported_at_ms,
          updated_at_ms,
          status
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL, ?7, ?8, ?9)
        "#,
        params![
            resource_id,
            kind_to_db(DesktopAgentAvatarResourceKind::Live2d),
            display_name,
            source_filename,
            resource_relative_dir,
            entry_relative_path,
            imported_at_ms,
            imported_at_ms,
            status_to_db(DesktopAgentAvatarResourceStatus::Ready),
        ],
    )
    .map_err(|error| format!("failed to persist Live2D avatar resource: {error}"))?;

    let resource = read_resource_record(conn, &resource_id)?
        .ok_or_else(|| "Live2D avatar resource missing after import".to_string())?;
    let binding =
        if let Some(agent_id) = normalize_optional_string(payload.bind_agent_id.as_deref()) {
            Some(set_binding_impl(
                conn,
                &DesktopAgentAvatarBindingSetPayload {
                    agent_id,
                    resource_id: resource.resource_id.clone(),
                    updated_at_ms: imported_at_ms,
                },
            )?)
        } else {
            None
        };
    Ok(DesktopAgentAvatarImportResult { resource, binding })
}
