pub mod migrations;
pub mod queries;

use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use rusqlite::Connection;

use crate::desktop_paths;

const SHIJI_DB_FILENAME: &str = "shiji.db";

static DB_CONNECTION: OnceLock<Mutex<Connection>> = OnceLock::new();

pub fn resolve_db_path() -> Result<PathBuf, String> {
    let data_dir = desktop_paths::resolve_nimi_data_dir()?;
    Ok(data_dir.join(SHIJI_DB_FILENAME))
}

fn open_connection() -> Result<Connection, String> {
    let db_path = resolve_db_path()?;
    let conn = Connection::open(&db_path)
        .map_err(|e| format!("failed to open shiji.db at {}: {e}", db_path.display()))?;
    // Enable WAL mode for better concurrent read/write
    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")
        .map_err(|e| format!("failed to configure SQLite pragmas: {e}"))?;
    Ok(conn)
}

pub fn with_db<F, T>(f: F) -> Result<T, String>
where
    F: FnOnce(&Connection) -> Result<T, rusqlite::Error>,
{
    let mutex = DB_CONNECTION.get().ok_or_else(|| "SQLite not initialized — call db_init first".to_string())?;
    let conn = mutex.lock().map_err(|e| format!("SQLite lock poisoned: {e}"))?;
    f(&conn).map_err(|e| format!("SQLite error: {e}"))
}

/// Tauri command: initialize SQLite (run migrations, expose to other commands).
/// Must be invoked once at app startup before any other sqlite commands.
#[tauri::command]
pub fn db_init() -> Result<(), String> {
    if DB_CONNECTION.get().is_some() {
        return Ok(());
    }
    let conn = open_connection()?;
    migrations::run_migrations(&conn)?;
    DB_CONNECTION
        .set(Mutex::new(conn))
        .map_err(|_| "DB_CONNECTION already initialized".to_string())?;
    Ok(())
}
