use super::db_assets::{read_relative_resource_asset_impl, read_resource_asset_impl};
use super::db_import::{import_live2d_impl, import_vrm_impl};
use super::db_queries::{
    clear_binding_impl, delete_resource_impl, get_binding_impl, list_resources_impl,
    set_binding_impl,
};
use super::db_support::{db_path, AVATAR_DB_SCHEMA_VERSION};
use super::types::*;
use rusqlite::Connection;
use std::time::Duration;

pub(crate) fn open_db() -> Result<Connection, String> {
    let path = db_path()?;
    let conn = Connection::open(&path).map_err(|error| {
        format!(
            "failed to open desktop agent avatar db ({}): {error}",
            path.display()
        )
    })?;
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

pub(crate) fn delete_resource(conn: &Connection, resource_id: &str) -> Result<bool, String> {
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

pub(crate) fn read_resource_asset(
    conn: &Connection,
    resource_id: &str,
) -> Result<DesktopAgentAvatarResourceAssetPayload, String> {
    read_resource_asset_impl(conn, resource_id)
}

pub(crate) fn read_relative_resource_asset(
    conn: &Connection,
    resource_id: &str,
    relative_path: &str,
) -> Result<DesktopAgentAvatarResourceAssetPayload, String> {
    read_relative_resource_asset_impl(conn, resource_id, relative_path)
}

pub(crate) fn clear_binding(conn: &Connection, agent_id: &str) -> Result<bool, String> {
    clear_binding_impl(conn, agent_id)
}
