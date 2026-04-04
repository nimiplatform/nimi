pub mod migrations;
pub mod queries;

use rusqlite::Connection;
use std::path::PathBuf;
use std::sync::Mutex;

use crate::desktop_paths;

static DB_CONN: std::sync::OnceLock<Mutex<Connection>> = std::sync::OnceLock::new();

const DB_FILE_NAME: &str = "parentos.db";

pub fn resolve_db_path() -> Result<PathBuf, String> {
    let data_dir = desktop_paths::resolve_nimi_data_dir()?;
    Ok(data_dir.join(DB_FILE_NAME))
}

fn open_connection() -> Result<Connection, String> {
    let db_path = resolve_db_path()?;
    let conn = Connection::open(&db_path)
        .map_err(|e| format!("failed to open parentos db at {}: {e}", db_path.display()))?;
    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")
        .map_err(|e| format!("failed to set pragmas: {e}"))?;
    migrations::run_migrations(&conn)?;
    Ok(conn)
}

pub fn get_conn() -> Result<&'static Mutex<Connection>, String> {
    if let Some(conn) = DB_CONN.get() {
        return Ok(conn);
    }

    let conn = Mutex::new(open_connection()?);
    let _ = DB_CONN.set(conn);

    DB_CONN
        .get()
        .ok_or_else(|| "failed to initialize parentos sqlite connection".to_string())
}

#[tauri::command]
pub fn db_init() -> Result<String, String> {
    get_conn()?;
    Ok(resolve_db_path()?.display().to_string())
}
