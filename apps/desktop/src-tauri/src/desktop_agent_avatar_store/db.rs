use super::types::*;
use rusqlite::{params, Connection, OptionalExtension};
use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use url::Url;

const AVATAR_ROOT_DIR_NAME: &str = "avatar-resources";
const AVATAR_MANAGED_RESOURCES_DIR: &str = "resources";
const AVATAR_DB_FILE_NAME: &str = "registry.db";
const AVATAR_DB_SCHEMA_VERSION: i64 = 1;

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}

fn normalize_required_string(value: &str, field_name: &str) -> Result<String, String> {
    let normalized = value.trim();
    if normalized.is_empty() {
        return Err(format!("{field_name} must not be empty"));
    }
    Ok(normalized.to_string())
}

fn normalize_optional_string(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(|text| text.to_string())
}

fn require_non_negative_ms(value: i64, field_name: &str) -> Result<i64, String> {
    if value < 0 {
        return Err(format!("{field_name} must be a non-negative integer"));
    }
    Ok(value)
}

fn normalize_source_path(path: &str, field_name: &str) -> Result<PathBuf, String> {
    let normalized = normalize_required_string(path, field_name)?;
    let candidate = PathBuf::from(normalized);
    if !candidate.is_absolute() {
        return Err(format!("{field_name} must be an absolute path"));
    }
    let canonical = std::fs::canonicalize(&candidate)
        .map_err(|error| format!("failed to resolve {field_name} ({}): {error}", candidate.display()))?;
    Ok(crate::desktop_paths::normalize_desktop_absolute_path(&canonical))
}

fn resource_root_dir() -> Result<PathBuf, String> {
    let root = crate::desktop_paths::resolve_nimi_data_dir()?.join(AVATAR_ROOT_DIR_NAME);
    fs::create_dir_all(root.join(AVATAR_MANAGED_RESOURCES_DIR))
        .map_err(|error| format!("failed to create avatar resource root ({}): {error}", root.display()))?;
    Ok(root)
}

fn db_path() -> Result<PathBuf, String> {
    Ok(resource_root_dir()?.join(AVATAR_DB_FILE_NAME))
}

pub(crate) fn open_db() -> Result<Connection, String> {
    let path = db_path()?;
    let conn = Connection::open(&path)
        .map_err(|error| format!("failed to open desktop agent avatar db ({}): {error}", path.display()))?;
    conn.pragma_update(None, "journal_mode", "WAL")
        .map_err(|error| format!("failed to enable avatar db WAL: {error}"))?;
    conn.pragma_update(None, "foreign_keys", "ON")
        .map_err(|error| format!("failed to enable avatar db foreign_keys: {error}"))?;
    conn.busy_timeout(Duration::from_millis(5_000))
        .map_err(|error| format!("failed to set avatar db busy_timeout: {error}"))?;
    init_schema(&conn)?;
    Ok(conn)
}

fn init_schema(conn: &Connection) -> Result<(), String> {
    conn.pragma_update(None, "user_version", AVATAR_DB_SCHEMA_VERSION)
        .map_err(|error| format!("failed to set avatar db user_version: {error}"))?;
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS desktop_agent_avatar_resources (
          resource_id TEXT PRIMARY KEY,
          kind TEXT NOT NULL,
          display_name TEXT NOT NULL,
          source_filename TEXT NOT NULL,
          resource_relative_dir TEXT NOT NULL,
          entry_relative_path TEXT NOT NULL,
          poster_relative_path TEXT,
          imported_at_ms INTEGER NOT NULL,
          updated_at_ms INTEGER NOT NULL,
          status TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_desktop_agent_avatar_resources_updated
          ON desktop_agent_avatar_resources(updated_at_ms DESC, resource_id DESC);

        CREATE TABLE IF NOT EXISTS desktop_agent_avatar_bindings (
          agent_id TEXT PRIMARY KEY,
          resource_id TEXT NOT NULL REFERENCES desktop_agent_avatar_resources(resource_id) ON DELETE CASCADE,
          updated_at_ms INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_desktop_agent_avatar_bindings_resource
          ON desktop_agent_avatar_bindings(resource_id, updated_at_ms DESC, agent_id ASC);
        "#,
    )
    .map_err(|error| format!("failed to initialize desktop agent avatar schema: {error}"))?;
    Ok(())
}

fn kind_to_db(value: DesktopAgentAvatarResourceKind) -> &'static str {
    match value {
        DesktopAgentAvatarResourceKind::Vrm => "vrm",
        DesktopAgentAvatarResourceKind::Live2d => "live2d",
    }
}

fn parse_kind(value: &str) -> Result<DesktopAgentAvatarResourceKind, String> {
    match value {
        "vrm" => Ok(DesktopAgentAvatarResourceKind::Vrm),
        "live2d" => Ok(DesktopAgentAvatarResourceKind::Live2d),
        other => Err(format!("desktop agent avatar kind is invalid: {other}")),
    }
}

fn status_to_db(value: DesktopAgentAvatarResourceStatus) -> &'static str {
    match value {
        DesktopAgentAvatarResourceStatus::Ready => "ready",
        DesktopAgentAvatarResourceStatus::Invalid => "invalid",
        DesktopAgentAvatarResourceStatus::Missing => "missing",
    }
}

fn parse_status(value: &str) -> Result<DesktopAgentAvatarResourceStatus, String> {
    match value {
        "ready" => Ok(DesktopAgentAvatarResourceStatus::Ready),
        "invalid" => Ok(DesktopAgentAvatarResourceStatus::Invalid),
        "missing" => Ok(DesktopAgentAvatarResourceStatus::Missing),
        other => Err(format!("desktop agent avatar status is invalid: {other}")),
    }
}

fn slugify_segment(value: &str) -> String {
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

fn generate_resource_id(seed: &str) -> String {
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

fn copy_file(source: &Path, destination: &Path) -> Result<(), String> {
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("failed to create import directory ({}): {error}", parent.display()))?;
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

fn copy_directory_recursive(source: &Path, destination: &Path) -> Result<(), String> {
    fs::create_dir_all(destination)
        .map_err(|error| format!("failed to create import directory ({}): {error}", destination.display()))?;
    for entry in fs::read_dir(source)
        .map_err(|error| format!("failed to read source directory ({}): {error}", source.display()))?
    {
        let entry = entry.map_err(|error| format!("failed to read source directory entry: {error}"))?;
        let file_type = entry
            .file_type()
            .map_err(|error| format!("failed to inspect source entry {}: {error}", entry.path().display()))?;
        if file_type.is_symlink() {
            return Err(format!("symbolic links are not supported for avatar import ({})", entry.path().display()));
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

fn file_url_from_path(path: &Path) -> Result<String, String> {
    Url::from_file_path(path)
        .map(|url| url.to_string())
        .map_err(|_| format!("failed to convert avatar path to file URL ({})", path.display()))
}

fn derive_resource_record(
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
    let poster_path = poster_relative_path.as_ref().map(|value| stored_path.join(value));
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

fn read_resource_record(
    conn: &Connection,
    resource_id: &str,
) -> Result<Option<DesktopAgentAvatarResourceRecord>, String> {
    let normalized_id = normalize_required_string(resource_id, "resourceId")?;
    conn.query_row(
        r#"
        SELECT
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
        FROM desktop_agent_avatar_resources
        WHERE resource_id = ?1
        "#,
        params![normalized_id],
        |row| {
            let kind_raw: String = row.get(1)?;
            let status_raw: String = row.get(9)?;
            derive_resource_record(
                row.get(0)?,
                parse_kind(&kind_raw).map_err(|error| {
                    rusqlite::Error::FromSqlConversionFailure(
                        1,
                        rusqlite::types::Type::Text,
                        Box::new(std::io::Error::new(std::io::ErrorKind::InvalidData, error)),
                    )
                })?,
                row.get(2)?,
                row.get(3)?,
                row.get(4)?,
                row.get(5)?,
                row.get(6)?,
                row.get(7)?,
                row.get(8)?,
                parse_status(&status_raw).map_err(|error| {
                    rusqlite::Error::FromSqlConversionFailure(
                        9,
                        rusqlite::types::Type::Text,
                        Box::new(std::io::Error::new(std::io::ErrorKind::InvalidData, error)),
                    )
                })?,
            )
            .map_err(|error| {
                rusqlite::Error::FromSqlConversionFailure(
                    4,
                    rusqlite::types::Type::Text,
                    Box::new(std::io::Error::new(std::io::ErrorKind::InvalidData, error)),
                )
            })
        },
    )
    .optional()
    .map_err(|error| format!("failed to query desktop agent avatar resource: {error}"))
}

fn list_resources_impl(conn: &Connection) -> Result<Vec<DesktopAgentAvatarResourceRecord>, String> {
    let mut statement = conn
        .prepare(
            r#"
            SELECT
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
            FROM desktop_agent_avatar_resources
            ORDER BY updated_at_ms DESC, resource_id DESC
            "#,
        )
        .map_err(|error| format!("failed to prepare desktop agent avatar resource list: {error}"))?;
    let rows = statement
        .query_map([], |row| {
            let kind_raw: String = row.get(1)?;
            let status_raw: String = row.get(9)?;
            derive_resource_record(
                row.get(0)?,
                parse_kind(&kind_raw).map_err(|error| {
                    rusqlite::Error::FromSqlConversionFailure(
                        1,
                        rusqlite::types::Type::Text,
                        Box::new(std::io::Error::new(std::io::ErrorKind::InvalidData, error)),
                    )
                })?,
                row.get(2)?,
                row.get(3)?,
                row.get(4)?,
                row.get(5)?,
                row.get(6)?,
                row.get(7)?,
                row.get(8)?,
                parse_status(&status_raw).map_err(|error| {
                    rusqlite::Error::FromSqlConversionFailure(
                        9,
                        rusqlite::types::Type::Text,
                        Box::new(std::io::Error::new(std::io::ErrorKind::InvalidData, error)),
                    )
                })?,
            )
            .map_err(|error| {
                rusqlite::Error::FromSqlConversionFailure(
                    4,
                    rusqlite::types::Type::Text,
                    Box::new(std::io::Error::new(std::io::ErrorKind::InvalidData, error)),
                )
            })
        })
        .map_err(|error| format!("failed to query desktop agent avatar resources: {error}"))?;
    let mut resources = Vec::new();
    for row in rows {
        resources.push(row.map_err(|error| format!("failed to decode desktop agent avatar resource: {error}"))?);
    }
    Ok(resources)
}

fn get_binding_impl(
    conn: &Connection,
    agent_id: &str,
) -> Result<Option<DesktopAgentAvatarBindingRecord>, String> {
    let normalized_agent_id = normalize_required_string(agent_id, "agentId")?;
    conn.query_row(
        r#"
        SELECT agent_id, resource_id, updated_at_ms
        FROM desktop_agent_avatar_bindings
        WHERE agent_id = ?1
        "#,
        params![normalized_agent_id],
        |row| {
            Ok(DesktopAgentAvatarBindingRecord {
                agent_id: row.get(0)?,
                resource_id: row.get(1)?,
                updated_at_ms: row.get(2)?,
            })
        },
    )
    .optional()
    .map_err(|error| format!("failed to query desktop agent avatar binding: {error}"))
}

fn set_binding_impl(
    conn: &Connection,
    payload: &DesktopAgentAvatarBindingSetPayload,
) -> Result<DesktopAgentAvatarBindingRecord, String> {
    let agent_id = normalize_required_string(&payload.agent_id, "agentId")?;
    let resource_id = normalize_required_string(&payload.resource_id, "resourceId")?;
    let updated_at_ms = require_non_negative_ms(payload.updated_at_ms, "updatedAtMs")?;
    if read_resource_record(conn, &resource_id)?.is_none() {
        return Err("desktop agent avatar binding failed: resource not found".to_string());
    }
    conn.execute(
        r#"
        INSERT INTO desktop_agent_avatar_bindings (agent_id, resource_id, updated_at_ms)
        VALUES (?1, ?2, ?3)
        ON CONFLICT(agent_id) DO UPDATE SET
          resource_id = excluded.resource_id,
          updated_at_ms = excluded.updated_at_ms
        "#,
        params![agent_id, resource_id, updated_at_ms],
    )
    .map_err(|error| format!("desktop agent avatar binding failed: {error}"))?;
    get_binding_impl(conn, &payload.agent_id)?
        .ok_or_else(|| "desktop agent avatar binding failed: binding missing after write".to_string())
}

fn clear_binding_impl(conn: &Connection, agent_id: &str) -> Result<bool, String> {
    let normalized_agent_id = normalize_required_string(agent_id, "agentId")?;
    let changed = conn
        .execute(
            "DELETE FROM desktop_agent_avatar_bindings WHERE agent_id = ?1",
            params![normalized_agent_id],
        )
        .map_err(|error| format!("failed to clear desktop agent avatar binding: {error}"))?;
    Ok(changed > 0)
}

fn resolve_display_name(candidate: Option<&str>, fallback: &str) -> String {
    normalize_optional_string(candidate).unwrap_or_else(|| fallback.to_string())
}

fn import_vrm_impl(
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
    let imported_at_ms = require_non_negative_ms(payload.imported_at_ms.unwrap_or_else(now_ms), "importedAtMs")?;
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
    let binding = if let Some(agent_id) = normalize_optional_string(payload.bind_agent_id.as_deref()) {
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

fn find_live2d_entry_relative_path(source_root: &Path) -> Result<String, String> {
    let mut stack = vec![source_root.to_path_buf()];
    while let Some(next) = stack.pop() {
        let entries = fs::read_dir(&next)
            .map_err(|error| format!("failed to read Live2D source directory ({}): {error}", next.display()))?;
        for entry in entries {
            let entry = entry.map_err(|error| format!("failed to read Live2D source entry: {error}"))?;
            let file_type = entry
                .file_type()
                .map_err(|error| format!("failed to inspect Live2D entry {}: {error}", entry.path().display()))?;
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
                let relative = path
                    .strip_prefix(source_root)
                    .map_err(|error| format!("failed to resolve Live2D relative entry path: {error}"))?;
                return Ok(relative.to_string_lossy().replace('\\', "/"));
            }
        }
    }
    Err("Live2D import requires a runtime directory containing a *.model3.json entry".to_string())
}

fn import_live2d_impl(
    conn: &Connection,
    payload: &DesktopAgentAvatarImportLive2dPayload,
) -> Result<DesktopAgentAvatarImportResult, String> {
    let source_path = normalize_source_path(&payload.source_path, "sourcePath")?;
    let (source_root, entry_relative_path, source_filename, default_display_name) = if source_path.is_dir() {
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
        (source_path.clone(), entry_relative_path, source_filename, display_name)
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
        (source_root, entry_relative_path, file_name.to_string(), default_display_name)
    } else {
        return Err("sourcePath must point to a Live2D runtime directory or *.model3.json file".to_string());
    };

    let display_name = resolve_display_name(payload.display_name.as_deref(), &default_display_name);
    let imported_at_ms = require_non_negative_ms(payload.imported_at_ms.unwrap_or_else(now_ms), "importedAtMs")?;
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
    let binding = if let Some(agent_id) = normalize_optional_string(payload.bind_agent_id.as_deref()) {
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

fn delete_resource_impl(conn: &Connection, resource_id: &str) -> Result<bool, String> {
    let resource = match read_resource_record(conn, resource_id)? {
        Some(record) => record,
        None => return Ok(false),
    };
    let changed = conn
        .execute(
            "DELETE FROM desktop_agent_avatar_resources WHERE resource_id = ?1",
            params![resource.resource_id],
        )
        .map_err(|error| format!("failed to delete desktop agent avatar resource: {error}"))?;
    if changed == 0 {
        return Ok(false);
    }
    let stored_path = PathBuf::from(resource.stored_path);
    if stored_path.exists() {
        fs::remove_dir_all(&stored_path)
            .map_err(|error| format!("failed to remove imported avatar resource directory ({}): {error}", stored_path.display()))?;
    }
    Ok(true)
}

pub(crate) fn import_vrm(
    conn: &Connection,
    payload: &DesktopAgentAvatarImportVrmPayload,
) -> Result<DesktopAgentAvatarImportResult, String> {
    import_vrm_impl(conn, payload)
}

pub(crate) fn import_live2d(
    conn: &Connection,
    payload: &DesktopAgentAvatarImportLive2dPayload,
) -> Result<DesktopAgentAvatarImportResult, String> {
    import_live2d_impl(conn, payload)
}

pub(crate) fn list_resources(
    conn: &Connection,
) -> Result<Vec<DesktopAgentAvatarResourceRecord>, String> {
    list_resources_impl(conn)
}

pub(crate) fn delete_resource(
    conn: &Connection,
    resource_id: &str,
) -> Result<bool, String> {
    delete_resource_impl(conn, resource_id)
}

pub(crate) fn get_binding(
    conn: &Connection,
    agent_id: &str,
) -> Result<Option<DesktopAgentAvatarBindingRecord>, String> {
    get_binding_impl(conn, agent_id)
}

pub(crate) fn set_binding(
    conn: &Connection,
    payload: &DesktopAgentAvatarBindingSetPayload,
) -> Result<DesktopAgentAvatarBindingRecord, String> {
    set_binding_impl(conn, payload)
}

fn mime_type_for_resource(kind: DesktopAgentAvatarResourceKind, path: &Path) -> &'static str {
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

pub(crate) fn read_resource_asset(
    conn: &Connection,
    resource_id: &str,
) -> Result<DesktopAgentAvatarResourceAssetPayload, String> {
    let record = read_resource_record(conn, resource_id)?
        .ok_or_else(|| format!("desktop agent avatar resource not found: {resource_id}"))?;
    let path = Url::parse(&record.file_url)
        .ok()
        .and_then(|url| url.to_file_path().ok())
        .unwrap_or_else(|| PathBuf::from(record.file_url.as_str()));
    let bytes = fs::read(&path)
        .map_err(|error| format!("failed to read desktop agent avatar asset ({}): {error}", path.display()))?;
    Ok(DesktopAgentAvatarResourceAssetPayload {
        mime_type: mime_type_for_resource(record.kind, &path).to_string(),
        base64: BASE64_STANDARD.encode(bytes),
    })
}

pub(crate) fn clear_binding(conn: &Connection, agent_id: &str) -> Result<bool, String> {
    clear_binding_impl(conn, agent_id)
}
