use super::schema::init_schema;
use rusqlite::Connection;
use std::fs;
use std::path::Path;
use std::path::PathBuf;
use std::time::Duration;

pub(crate) const CHAT_AI_DIR_NAME: &str = "chat-ai";
pub(crate) const CHAT_AI_DB_FILE_NAME: &str = "main.db";

fn ensure_chat_ai_dir(base_dir: &Path) -> Result<PathBuf, String> {
    let chat_ai_dir = base_dir.join(CHAT_AI_DIR_NAME);
    fs::create_dir_all(&chat_ai_dir).map_err(|error| {
        format!(
            "无法创建 chat_ai 数据目录 ({}): {error}",
            chat_ai_dir.display()
        )
    })?;
    Ok(chat_ai_dir)
}

pub(crate) fn db_path() -> Result<PathBuf, String> {
    let base_dir = crate::desktop_paths::resolve_nimi_data_dir()?;
    Ok(ensure_chat_ai_dir(&base_dir)?.join(CHAT_AI_DB_FILE_NAME))
}

pub(crate) fn open_db() -> Result<Connection, String> {
    let path = db_path()?;
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
