use super::db_support::{
    derive_resource_record, normalize_required_string, parse_kind, parse_status,
    validate_local_agent_ref,
};
use super::types::*;
use rusqlite::{params, Connection, OptionalExtension};
use std::fs;
use std::path::PathBuf;

pub(super) fn read_resource_record(
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

pub(super) fn list_resources_impl(
    conn: &Connection,
) -> Result<Vec<DesktopAgentAvatarResourceRecord>, String> {
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
        .map_err(|error| {
            format!("failed to prepare desktop agent avatar resource list: {error}")
        })?;
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
        resources.push(
            row.map_err(|error| {
                format!("failed to decode desktop agent avatar resource: {error}")
            })?,
        );
    }
    Ok(resources)
}

pub(super) fn get_binding_impl(
    conn: &Connection,
    owner_user_id: &str,
    realm_agent_id: &str,
    local_agent_ref: &str,
) -> Result<Option<DesktopAgentAvatarBindingRecord>, String> {
    let (owner_user_id, realm_agent_id, local_agent_ref) =
        validate_local_agent_ref(owner_user_id, realm_agent_id, local_agent_ref)?;
    conn.query_row(
        r#"
        SELECT owner_user_id, realm_agent_id, local_agent_ref, resource_id, updated_at_ms
        FROM desktop_agent_avatar_bindings
        WHERE local_agent_ref = ?1
        "#,
        params![local_agent_ref],
        |row| {
            Ok(DesktopAgentAvatarBindingRecord {
                owner_user_id: row.get(0)?,
                realm_agent_id: row.get(1)?,
                local_agent_ref: row.get(2)?,
                resource_id: row.get(3)?,
                updated_at_ms: row.get(4)?,
            })
        },
    )
    .optional()
    .map_err(|error| format!("failed to query desktop agent avatar binding: {error}"))
}

pub(super) fn set_binding_impl(
    conn: &Connection,
    payload: &DesktopAgentAvatarBindingSetPayload,
) -> Result<DesktopAgentAvatarBindingRecord, String> {
    let (owner_user_id, realm_agent_id, local_agent_ref) = validate_local_agent_ref(
        &payload.owner_user_id,
        &payload.realm_agent_id,
        &payload.local_agent_ref,
    )?;
    let resource_id = normalize_required_string(&payload.resource_id, "resourceId")?;
    if read_resource_record(conn, &resource_id)?.is_none() {
        return Err("desktop agent avatar binding failed: resource not found".to_string());
    }
    conn.execute(
        r#"
        INSERT INTO desktop_agent_avatar_bindings (
          local_agent_ref,
          owner_user_id,
          realm_agent_id,
          resource_id,
          updated_at_ms
        )
        VALUES (?1, ?2, ?3, ?4, ?5)
        ON CONFLICT(local_agent_ref) DO UPDATE SET
          owner_user_id = excluded.owner_user_id,
          realm_agent_id = excluded.realm_agent_id,
          resource_id = excluded.resource_id,
          updated_at_ms = excluded.updated_at_ms
        "#,
        params![
            local_agent_ref,
            owner_user_id,
            realm_agent_id,
            resource_id,
            payload.updated_at_ms
        ],
    )
    .map_err(|error| format!("desktop agent avatar binding failed: {error}"))?;
    get_binding_impl(
        conn,
        &payload.owner_user_id,
        &payload.realm_agent_id,
        &payload.local_agent_ref,
    )?
    .ok_or_else(|| {
            "desktop agent avatar binding failed: binding missing after write".to_string()
        })
}

pub(super) fn clear_binding_impl(
    conn: &Connection,
    owner_user_id: &str,
    realm_agent_id: &str,
    local_agent_ref: &str,
) -> Result<bool, String> {
    let (_, _, local_agent_ref) =
        validate_local_agent_ref(owner_user_id, realm_agent_id, local_agent_ref)?;
    let changed = conn
        .execute(
            "DELETE FROM desktop_agent_avatar_bindings WHERE local_agent_ref = ?1",
            params![local_agent_ref],
        )
        .map_err(|error| format!("failed to clear desktop agent avatar binding: {error}"))?;
    Ok(changed > 0)
}

pub(super) fn delete_resource_impl(conn: &Connection, resource_id: &str) -> Result<bool, String> {
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
        fs::remove_dir_all(&stored_path).map_err(|error| {
            format!(
                "failed to remove imported avatar resource directory ({}): {error}",
                stored_path.display()
            )
        })?;
    }
    Ok(true)
}
