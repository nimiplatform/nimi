use super::types::CHAT_AI_DB_SCHEMA_VERSION;
use rusqlite::{params, Connection};

const AI_THREAD_REQUIRED_COLUMNS: &[&str] = &[
    "id",
    "title",
    "created_at_ms",
    "updated_at_ms",
    "last_message_at_ms",
    "archived_at_ms",
];

const AI_THREAD_LEGACY_ROUTE_COLUMNS: &[&str] = &[
    "route_kind",
    "connector_id",
    "provider",
    "model_id",
    "route_binding_json",
];

pub(crate) fn init_schema(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS ai_threads (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          created_at_ms INTEGER NOT NULL,
          updated_at_ms INTEGER NOT NULL,
          last_message_at_ms INTEGER,
          archived_at_ms INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_ai_threads_updated ON ai_threads(updated_at_ms DESC, id DESC);
        CREATE INDEX IF NOT EXISTS idx_ai_threads_last_message ON ai_threads(last_message_at_ms DESC, id DESC);

        CREATE TABLE IF NOT EXISTS ai_messages (
          id TEXT PRIMARY KEY,
          thread_id TEXT NOT NULL REFERENCES ai_threads(id) ON DELETE CASCADE,
          role TEXT NOT NULL,
          status TEXT NOT NULL,
          content_text TEXT NOT NULL,
          content_json TEXT NOT NULL,
          error_code TEXT,
          error_message TEXT,
          trace_id TEXT,
          parent_message_id TEXT,
          created_at_ms INTEGER NOT NULL,
          updated_at_ms INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_ai_messages_thread_created ON ai_messages(thread_id, created_at_ms ASC, id ASC);
        CREATE INDEX IF NOT EXISTS idx_ai_messages_thread_updated ON ai_messages(thread_id, updated_at_ms ASC, id ASC);

        CREATE TABLE IF NOT EXISTS ai_thread_drafts (
          thread_id TEXT PRIMARY KEY REFERENCES ai_threads(id) ON DELETE CASCADE,
          draft_text TEXT NOT NULL,
          draft_attachments_json TEXT,
          updated_at_ms INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS ai_store_meta (
          key TEXT PRIMARY KEY,
          value_json TEXT NOT NULL,
          updated_at_ms INTEGER NOT NULL
        );
        "#,
    )
    .map_err(|error| format!("初始化 chat_ai schema 失败: {error}"))?;

    drop_legacy_route_columns_from_ai_threads(conn)?;

    ensure_required_columns(conn, "ai_threads", AI_THREAD_REQUIRED_COLUMNS)?;
    ensure_required_columns(
        conn,
        "ai_messages",
        &[
            "id",
            "thread_id",
            "role",
            "status",
            "content_text",
            "content_json",
            "error_code",
            "error_message",
            "trace_id",
            "parent_message_id",
            "created_at_ms",
            "updated_at_ms",
        ],
    )?;
    ensure_required_columns(
        conn,
        "ai_thread_drafts",
        &[
            "thread_id",
            "draft_text",
            "draft_attachments_json",
            "updated_at_ms",
        ],
    )?;
    ensure_required_columns(
        conn,
        "ai_store_meta",
        &["key", "value_json", "updated_at_ms"],
    )?;

    upsert_store_meta(
        conn,
        "schemaVersion",
        serde_json::json!({ "version": CHAT_AI_DB_SCHEMA_VERSION }),
        0,
    )?;
    conn.pragma_update(None, "user_version", CHAT_AI_DB_SCHEMA_VERSION)
        .map_err(|error| format!("初始化 chat_ai user_version 失败: {error}"))?;
    Ok(())
}

fn drop_legacy_route_columns_from_ai_threads(conn: &Connection) -> Result<(), String> {
    let mut legacy_columns_present = Vec::new();
    for column_name in AI_THREAD_LEGACY_ROUTE_COLUMNS {
        if has_column(conn, "ai_threads", column_name)? {
            legacy_columns_present.push(*column_name);
        }
    }
    if legacy_columns_present.is_empty() {
        return Ok(());
    }

    let mut migration_sql = String::from("BEGIN IMMEDIATE;");
    for column_name in &legacy_columns_present {
        migration_sql
            .push_str(format!("ALTER TABLE ai_threads DROP COLUMN {column_name};").as_str());
    }
    migration_sql.push_str("COMMIT;");

    if let Err(error) = conn.execute_batch(&migration_sql) {
        let _ = conn.execute_batch("ROLLBACK;");
        return Err(format!(
            "迁移 chat_ai ai_threads 删除兼容列失败: columns={} error={error}",
            legacy_columns_present.join(",")
        ));
    }
    Ok(())
}

fn upsert_store_meta(
    conn: &Connection,
    key: &str,
    value_json: serde_json::Value,
    updated_at_ms: i64,
) -> Result<(), String> {
    conn.execute(
        r#"
        INSERT INTO ai_store_meta (key, value_json, updated_at_ms)
        VALUES (?1, ?2, ?3)
        ON CONFLICT(key) DO UPDATE SET
          value_json = excluded.value_json,
          updated_at_ms = excluded.updated_at_ms
        "#,
        params![
            key,
            serde_json::to_string(&value_json)
                .map_err(|error| format!("序列化 chat_ai store meta 失败: {error}"))?,
            updated_at_ms
        ],
    )
    .map_err(|error| format!("写入 chat_ai store meta 失败: {error}"))?;
    Ok(())
}

fn has_column(conn: &Connection, table_name: &str, column_name: &str) -> Result<bool, String> {
    let mut statement = conn
        .prepare(format!("PRAGMA table_info({table_name})").as_str())
        .map_err(|error| format!("读取 {table_name} schema 失败: {error}"))?;
    let mut rows = statement
        .query([])
        .map_err(|error| format!("查询 {table_name} schema 失败: {error}"))?;
    while let Some(row) = rows
        .next()
        .map_err(|error| format!("读取 {table_name} schema 行失败: {error}"))?
    {
        let name: String = row
            .get(1)
            .map_err(|error| format!("读取 {table_name} column name 失败: {error}"))?;
        if name == column_name {
            return Ok(true);
        }
    }
    Ok(false)
}

fn ensure_required_columns(
    conn: &Connection,
    table_name: &str,
    required_columns: &[&str],
) -> Result<(), String> {
    let mut missing_columns = Vec::new();
    for column_name in required_columns {
        if !has_column(conn, table_name, column_name)? {
            missing_columns.push(*column_name);
        }
    }
    if !missing_columns.is_empty() {
        return Err(format!(
            "CHAT_AI_SCHEMA_MISMATCH: table={table_name} missing_columns={} actionHint=delete_local_chat_ai_db_and_restart",
            missing_columns.join(",")
        ));
    }
    Ok(())
}
