use super::types::CHAT_AGENT_DB_SCHEMA_VERSION;
use rusqlite::{params, Connection, OptionalExtension};

pub(crate) fn init_schema(conn: &Connection) -> Result<(), String> {
    hard_reset_old_agent_thread_schema(conn)?;
    conn.pragma_update(None, "user_version", CHAT_AGENT_DB_SCHEMA_VERSION)
        .map_err(|error| format!("初始化 chat_agent user_version 失败: {error}"))?;
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS agent_threads (
          id TEXT PRIMARY KEY,
          local_agent_ref TEXT NOT NULL UNIQUE,
          owner_user_id TEXT NOT NULL,
          realm_agent_id TEXT NOT NULL,
          title TEXT NOT NULL,
          created_at_ms INTEGER NOT NULL,
          updated_at_ms INTEGER NOT NULL,
          last_message_at_ms INTEGER,
          archived_at_ms INTEGER,
          target_snapshot_json TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_agent_threads_updated ON agent_threads(updated_at_ms DESC, id DESC);

        CREATE TABLE IF NOT EXISTS agent_messages (
          id TEXT PRIMARY KEY,
          thread_id TEXT NOT NULL REFERENCES agent_threads(id) ON DELETE CASCADE,
          role TEXT NOT NULL,
          status TEXT NOT NULL,
          kind TEXT NOT NULL DEFAULT 'text',
          content_text TEXT NOT NULL,
          reasoning_text TEXT,
          error_code TEXT,
          error_message TEXT,
          trace_id TEXT,
          parent_message_id TEXT,
          media_url TEXT,
          media_mime_type TEXT,
          artifact_id TEXT,
          metadata_json TEXT,
          created_at_ms INTEGER NOT NULL,
          updated_at_ms INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_agent_messages_thread_created ON agent_messages(thread_id, created_at_ms ASC, id ASC);

        CREATE TABLE IF NOT EXISTS agent_thread_drafts (
          thread_id TEXT PRIMARY KEY REFERENCES agent_threads(id) ON DELETE CASCADE,
          draft_text TEXT NOT NULL,
          updated_at_ms INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS agent_turns (
          id TEXT PRIMARY KEY,
          thread_id TEXT NOT NULL REFERENCES agent_threads(id) ON DELETE CASCADE,
          role TEXT NOT NULL,
          status TEXT NOT NULL,
          provider_mode TEXT NOT NULL,
          trace_id TEXT,
          prompt_trace_id TEXT,
          started_at_ms INTEGER NOT NULL,
          completed_at_ms INTEGER,
          aborted_at_ms INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_agent_turns_thread_started ON agent_turns(thread_id, started_at_ms ASC, id ASC);

        CREATE TABLE IF NOT EXISTS agent_turn_beats (
          id TEXT PRIMARY KEY,
          turn_id TEXT NOT NULL REFERENCES agent_turns(id) ON DELETE CASCADE,
          beat_index INTEGER NOT NULL,
          modality TEXT NOT NULL,
          status TEXT NOT NULL,
          text_shadow TEXT,
          artifact_id TEXT,
          mime_type TEXT,
          media_url TEXT,
          projection_message_id TEXT,
          created_at_ms INTEGER NOT NULL,
          delivered_at_ms INTEGER
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_turn_beats_turn_index ON agent_turn_beats(turn_id, beat_index);

        CREATE TABLE IF NOT EXISTS agent_interaction_snapshots (
          thread_id TEXT NOT NULL REFERENCES agent_threads(id) ON DELETE CASCADE,
          version INTEGER NOT NULL,
          relationship_state TEXT NOT NULL,
          emotional_temperature REAL NOT NULL,
          assistant_commitments_json TEXT NOT NULL,
          user_prefs_json TEXT NOT NULL,
          open_loops_json TEXT NOT NULL,
          updated_at_ms INTEGER NOT NULL,
          PRIMARY KEY(thread_id, version)
        );
        CREATE INDEX IF NOT EXISTS idx_agent_interaction_snapshots_thread_version ON agent_interaction_snapshots(thread_id, version DESC);

        CREATE TABLE IF NOT EXISTS agent_store_meta (
          key TEXT PRIMARY KEY,
          value_json TEXT NOT NULL,
          updated_at_ms INTEGER NOT NULL
        );
        "#,
    )
    .map_err(|error| format!("初始化 chat_agent schema 失败: {error}"))?;

    ensure_required_columns(
        conn,
        "agent_threads",
        &[
            "id",
            "local_agent_ref",
            "owner_user_id",
            "realm_agent_id",
            "title",
            "created_at_ms",
            "updated_at_ms",
            "last_message_at_ms",
            "archived_at_ms",
            "target_snapshot_json",
        ],
    )?;
    add_nullable_text_column_if_missing(conn, "agent_messages", "reasoning_text")?;
    add_nullable_text_column_if_missing(conn, "agent_messages", "media_url")?;
    add_nullable_text_column_if_missing(conn, "agent_messages", "media_mime_type")?;
    add_nullable_text_column_if_missing(conn, "agent_messages", "artifact_id")?;
    add_nullable_text_column_if_missing(conn, "agent_messages", "metadata_json")?;
    add_text_column_with_default_if_missing(conn, "agent_messages", "kind", "'text'")?;
    ensure_required_columns(
        conn,
        "agent_messages",
        &[
            "id",
            "thread_id",
            "role",
            "status",
            "kind",
            "content_text",
            "reasoning_text",
            "error_code",
            "error_message",
            "trace_id",
            "parent_message_id",
            "media_url",
            "media_mime_type",
            "artifact_id",
            "metadata_json",
            "created_at_ms",
            "updated_at_ms",
        ],
    )?;
    ensure_required_columns(
        conn,
        "agent_thread_drafts",
        &["thread_id", "draft_text", "updated_at_ms"],
    )?;
    ensure_required_columns(
        conn,
        "agent_turns",
        &[
            "id",
            "thread_id",
            "role",
            "status",
            "provider_mode",
            "trace_id",
            "prompt_trace_id",
            "started_at_ms",
            "completed_at_ms",
            "aborted_at_ms",
        ],
    )?;
    add_nullable_text_column_if_missing(conn, "agent_turn_beats", "media_url")?;
    ensure_required_columns(
        conn,
        "agent_turn_beats",
        &[
            "id",
            "turn_id",
            "beat_index",
            "modality",
            "status",
            "text_shadow",
            "artifact_id",
            "mime_type",
            "media_url",
            "projection_message_id",
            "created_at_ms",
            "delivered_at_ms",
        ],
    )?;
    ensure_required_columns(
        conn,
        "agent_interaction_snapshots",
        &[
            "thread_id",
            "version",
            "relationship_state",
            "emotional_temperature",
            "assistant_commitments_json",
            "user_prefs_json",
            "open_loops_json",
            "updated_at_ms",
        ],
    )?;
    drop_retired_memory_tables(conn)?;
    ensure_required_columns(
        conn,
        "agent_store_meta",
        &["key", "value_json", "updated_at_ms"],
    )?;

    ensure_store_meta(
        conn,
        "schemaVersion",
        serde_json::json!({ "version": CHAT_AGENT_DB_SCHEMA_VERSION }),
        0,
    )?;
    Ok(())
}

fn drop_retired_memory_tables(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        r#"
        DROP TABLE IF EXISTS agent_recall_index;
        DROP TABLE IF EXISTS agent_relation_memory_slots;
        "#,
    )
    .map_err(|error| format!("删除 retired chat_agent memory tables 失败: {error}"))?;
    Ok(())
}

fn hard_reset_old_agent_thread_schema(conn: &Connection) -> Result<(), String> {
    if !table_exists(conn, "agent_threads")? {
        return Ok(());
    }
    let has_current_identity = has_column(conn, "agent_threads", "local_agent_ref")?
        && has_column(conn, "agent_threads", "owner_user_id")?
        && has_column(conn, "agent_threads", "realm_agent_id")?;
    if has_current_identity {
        return Ok(());
    }
    conn.execute_batch(
        r#"
        DROP TABLE IF EXISTS agent_recall_index;
        DROP TABLE IF EXISTS agent_relation_memory_slots;
        DROP TABLE IF EXISTS agent_interaction_snapshots;
        DROP TABLE IF EXISTS agent_turn_beats;
        DROP TABLE IF EXISTS agent_turns;
        DROP TABLE IF EXISTS agent_thread_drafts;
        DROP TABLE IF EXISTS agent_messages;
        DROP TABLE IF EXISTS agent_threads;
        DROP TABLE IF EXISTS agent_store_meta;
        "#,
    )
    .map_err(|error| format!("硬重建旧 chat_agent schema 失败: {error}"))?;
    Ok(())
}

fn add_text_column_with_default_if_missing(
    conn: &Connection,
    table_name: &str,
    column_name: &str,
    default_sql: &str,
) -> Result<(), String> {
    if has_column(conn, table_name, column_name)? {
        return Ok(());
    }
    conn.execute(
        format!(
            "ALTER TABLE {table_name} ADD COLUMN {column_name} TEXT NOT NULL DEFAULT {default_sql}"
        )
        .as_str(),
        [],
    )
    .map_err(|error| format!("为 {table_name} 添加列 {column_name} 失败: {error}"))?;
    Ok(())
}

fn add_nullable_text_column_if_missing(
    conn: &Connection,
    table_name: &str,
    column_name: &str,
) -> Result<(), String> {
    if has_column(conn, table_name, column_name)? {
        return Ok(());
    }
    conn.execute(
        format!("ALTER TABLE {table_name} ADD COLUMN {column_name} TEXT").as_str(),
        [],
    )
    .map_err(|error| format!("为 {table_name} 添加列 {column_name} 失败: {error}"))?;
    Ok(())
}

fn ensure_store_meta(
    conn: &Connection,
    key: &str,
    value_json: serde_json::Value,
    updated_at_ms: i64,
) -> Result<(), String> {
    conn.execute(
        r#"
        INSERT INTO agent_store_meta (key, value_json, updated_at_ms)
        VALUES (?1, ?2, ?3)
        ON CONFLICT(key) DO UPDATE SET
          value_json = excluded.value_json,
          updated_at_ms = excluded.updated_at_ms
        "#,
        params![
            key,
            serde_json::to_string(&value_json)
                .map_err(|error| format!("序列化 chat_agent store meta 失败: {error}"))?,
            updated_at_ms
        ],
    )
    .map_err(|error| format!("写入 chat_agent store meta 失败: {error}"))?;
    Ok(())
}

fn table_exists(conn: &Connection, table_name: &str) -> Result<bool, String> {
    let exists = conn
        .query_row(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?1",
            params![table_name],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|error| format!("查询 {table_name} 是否存在失败: {error}"))?;
    Ok(exists.is_some())
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
            "CHAT_AGENT_SCHEMA_MISMATCH: table={table_name} missing_columns={} actionHint=delete_local_chat_agent_db_and_restart",
            missing_columns.join(",")
        ));
    }
    Ok(())
}
