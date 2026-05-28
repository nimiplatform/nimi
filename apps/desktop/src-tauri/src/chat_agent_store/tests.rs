use super::*;
use crate::test_support::with_product_data_home;
use rusqlite::{params, Connection};
use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

fn temp_home(prefix: &str) -> PathBuf {
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("time")
        .as_nanos();
    let dir = std::env::temp_dir().join(format!("nimi-chat-agent-{prefix}-{unique}"));
    fs::create_dir_all(&dir).expect("create temp home");
    dir
}

fn sample_local_agent_ref(owner_user_id: &str, realm_agent_id: &str) -> String {
    format!("local-agent:{owner_user_id}:{realm_agent_id}")
}

fn sample_target_snapshot(
    owner_user_id: &str,
    realm_agent_id: &str,
) -> ChatAgentTargetSnapshot {
    ChatAgentTargetSnapshot {
        owner_user_id: owner_user_id.to_string(),
        realm_agent_id: realm_agent_id.to_string(),
        local_agent_ref: sample_local_agent_ref(owner_user_id, realm_agent_id),
        display_name: "Agent One".to_string(),
        handle: "~agent-one".to_string(),
        avatar_url: Some("https://example.com/avatar.png".to_string()),
        world_id: Some("world-1".to_string()),
        world_name: Some("OASIS".to_string()),
        bio: Some("Helpful agent".to_string()),
        ownership_type: Some("WORLD_OWNED".to_string()),
    }
}

fn chat_agent_db_path() -> PathBuf {
    crate::desktop_paths::resolve_nimi_data_dir()
        .expect("nimi data dir")
        .join("chat-agent")
        .join("main.db")
}

fn open_test_db() -> Connection {
    let path = chat_agent_db_path();
    fs::create_dir_all(path.parent().expect("parent")).expect("create parent");
    let conn = Connection::open(&path).expect("open");
    super::schema::init_schema(&conn).expect("init schema");
    conn
}

fn table_exists(conn: &Connection, table_name: &str) -> bool {
    conn.query_row(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?1 LIMIT 1",
        params![table_name],
        |_| Ok(()),
    )
    .is_ok()
}

fn insert_thread_raw(
    conn: &Connection,
    id: &str,
    owner_user_id: &str,
    realm_agent_id: &str,
) {
    let target = sample_target_snapshot(owner_user_id, realm_agent_id);
    conn.execute(
        r#"
        INSERT INTO agent_threads (
          id,
          local_agent_ref,
          owner_user_id,
          realm_agent_id,
          title,
          created_at_ms,
          updated_at_ms,
          last_message_at_ms,
          target_snapshot_json
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
        "#,
        params![
            id,
            target.local_agent_ref,
            owner_user_id,
            realm_agent_id,
            target.display_name,
            100_i64,
            120_i64,
            Option::<i64>::None,
            serde_json::to_string(&target).expect("target json"),
        ],
    )
    .expect("insert thread");
}

#[test]
fn chat_agent_db_path_stays_under_nimi_data_dir() {
    let home = temp_home("db-path");
    with_product_data_home(&home, || {
        let path = super::db::db_path().expect("db path");
        assert_eq!(path, chat_agent_db_path());
    });
}

#[test]
fn chat_agent_open_db_initializes_read_only_projection_cache_schema() {
    let home = temp_home("schema");
    with_product_data_home(&home, || {
        let conn = open_test_db();
        super::schema::init_schema(&conn).expect("init schema again");

        let version: i64 = conn
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .expect("user_version");
        assert_eq!(version, CHAT_AGENT_DB_SCHEMA_VERSION);

        assert_eq!(table_exists(&conn, "agent_threads"), true);
        assert_eq!(table_exists(&conn, "agent_messages"), true);
        assert_eq!(table_exists(&conn, "agent_turns"), false);
        assert_eq!(table_exists(&conn, "agent_turn_beats"), false);
    });
}

#[test]
fn chat_agent_store_reads_existing_projection_cache_bundle() {
    let home = temp_home("read-bundle");
    with_product_data_home(&home, || {
        let conn = open_test_db();
        insert_thread_raw(&conn, "thread-agent-001", "user-1", "agent-001");
        conn.execute(
            r#"
            INSERT INTO agent_messages (
              id,
              thread_id,
              role,
              status,
              kind,
              content_text,
              reasoning_text,
              error_code,
              error_message,
              trace_id,
              parent_message_id,
              media_url,
              media_mime_type,
              artifact_id,
              metadata_json,
              created_at_ms,
              updated_at_ms
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)
            "#,
            params![
                "message-1",
                "thread-agent-001",
                "assistant",
                "complete",
                "text",
                "hello",
                Option::<String>::None,
                Option::<String>::None,
                Option::<String>::None,
                "trace-1",
                Option::<String>::None,
                Option::<String>::None,
                Option::<String>::None,
                Option::<String>::None,
                Option::<String>::None,
                110_i64,
                120_i64,
            ],
        )
        .expect("insert message");

        let bundle = get_thread_bundle(&conn, "thread-agent-001")
            .expect("bundle")
            .expect("bundle present");
        assert_eq!(bundle.thread.realm_agent_id, "agent-001");
        assert_eq!(bundle.messages.len(), 1);
        assert_eq!(bundle.messages[0].content_text, "hello");
    });
}

#[test]
fn chat_agent_store_rejects_invalid_legacy_projection_json() {
    let home = temp_home("bad-json");
    with_product_data_home(&home, || {
        let conn = open_test_db();
        insert_thread_raw(&conn, "thread-agent-bad-json", "user-1", "agent-bad-json");
        conn.execute(
            r#"
            UPDATE agent_threads
            SET target_snapshot_json = ?2
            WHERE id = ?1
            "#,
            params!["thread-agent-bad-json", "{bad-json"],
        )
        .expect("insert bad json");
        let bundle_error = get_thread_bundle(&conn, "thread-agent-bad-json")
            .expect_err("bad json should fail");
        assert!(bundle_error.contains("invalid JSON"));
    });
}
