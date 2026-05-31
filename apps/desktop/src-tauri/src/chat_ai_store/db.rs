use super::schema::init_schema;
use nimi_shell_tauri::runtime_app_storage;
use rusqlite::Connection;
use std::path::PathBuf;
use std::time::Duration;

pub(crate) const CHAT_AI_DIR_NAME: &str = "chat-ai";
pub(crate) const CHAT_AI_DB_FILE_NAME: &str = "main.db";

pub(crate) fn db_path(storage_root: &str) -> Result<PathBuf, String> {
    runtime_app_storage::scoped_storage_child(
        storage_root,
        "desktop Nimi Chat data root",
        PathBuf::from(CHAT_AI_DIR_NAME).join(CHAT_AI_DB_FILE_NAME),
    )
}

pub(crate) fn open_db(storage_root: &str) -> Result<Connection, String> {
    let path = db_path(storage_root)?;
    let conn = Connection::open(&path)
        .map_err(|error| format!("无法打开 chat_ai SQLite ({}): {error}", path.display()))?;
    conn.pragma_update(None, "journal_mode", "WAL")
        .map_err(|error| format!("开启 chat_ai WAL 失败: {error}"))?;
    conn.pragma_update(None, "foreign_keys", "ON")
        .map_err(|error| format!("开启 chat_ai foreign_keys 失败: {error}"))?;
    conn.busy_timeout(Duration::from_millis(5_000))
        .map_err(|error| format!("设置 chat_ai busy_timeout 失败: {error}"))?;
    init_schema(&conn)?;
    Ok(conn)
}
