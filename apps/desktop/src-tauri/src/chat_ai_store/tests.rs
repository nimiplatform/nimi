use super::*;
use crate::test_support::with_env;
use rusqlite::{params, Connection};
use serde_json::Map as JsonMap;
use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

fn temp_home(prefix: &str) -> PathBuf {
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("time")
        .as_nanos();
    let dir = std::env::temp_dir().join(format!("nimi-chat-ai-{prefix}-{unique}"));
    fs::create_dir_all(&dir).expect("create temp home");
    dir
}

fn sample_content(text: &str) -> ChatAiMessageContent {
    ChatAiMessageContent {
        parts: vec![ChatAiMessagePart::Text(ChatAiMessagePartText {
            text: text.to_string(),
        })],
        tool_calls: Vec::new(),
        attachments: Vec::new(),
        metadata: JsonMap::new(),
    }
}

fn ai_thread_columns(conn: &Connection) -> Vec<String> {
    let mut statement = conn
        .prepare("PRAGMA table_info(ai_threads)")
        .expect("prepare table_info");
    let rows = statement
        .query_map([], |row| row.get::<_, String>(1))
        .expect("query table_info");
    rows.map(|row| row.expect("column name")).collect()
}

#[test]
fn chat_ai_db_path_stays_under_nimi_data_dir() {
    let home = temp_home("db-path");
    with_env(&[("HOME", home.to_str())], || {
        let path = super::db::db_path().expect("db path");
        assert_eq!(
            path,
            crate::desktop_paths::resolve_nimi_data_dir()
                .expect("nimi data dir")
                .join("chat-ai")
                .join("main.db")
        );
    });
}

#[test]
fn chat_ai_open_db_initializes_schema_idempotently() {
    let home = temp_home("schema");
    with_env(&[("HOME", home.to_str())], || {
        let path = crate::desktop_paths::resolve_nimi_data_dir()
            .expect("nimi data dir")
            .join("chat-ai")
            .join("main.db");
        fs::create_dir_all(path.parent().expect("parent")).expect("create parent");
        let conn = Connection::open(&path).expect("open");
        super::schema::init_schema(&conn).expect("init schema");
        super::schema::init_schema(&conn).expect("init schema again");

        let version: i64 = conn
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .expect("user_version");
        assert_eq!(version, CHAT_AI_DB_SCHEMA_VERSION);
        assert_eq!(
            ai_thread_columns(&conn),
            vec![
                "id",
                "title",
                "created_at_ms",
                "updated_at_ms",
                "last_message_at_ms",
                "archived_at_ms",
            ]
        );

        let schema_version_json: String = conn
            .query_row(
                "SELECT value_json FROM ai_store_meta WHERE key = 'schemaVersion'",
                [],
                |row| row.get(0),
            )
            .expect("schema version meta");
        assert_eq!(
            schema_version_json,
            format!(r#"{{"version":{CHAT_AI_DB_SCHEMA_VERSION}}}"#)
        );
    });
}

#[test]
fn chat_ai_schema_migrates_legacy_thread_route_columns_and_preserves_data() {
    let home = temp_home("legacy-route-columns");
    with_env(&[("HOME", home.to_str())], || {
        let path = crate::desktop_paths::resolve_nimi_data_dir()
            .expect("nimi data dir")
            .join("chat-ai")
            .join("main.db");
        fs::create_dir_all(path.parent().expect("parent")).expect("create parent");
        let conn = Connection::open(&path).expect("open");

        conn.execute_batch(
            r#"
            PRAGMA user_version = 1;
            CREATE TABLE ai_threads (
              id TEXT PRIMARY KEY,
              title TEXT NOT NULL,
              created_at_ms INTEGER NOT NULL,
              updated_at_ms INTEGER NOT NULL,
              last_message_at_ms INTEGER,
              archived_at_ms INTEGER,
              route_kind TEXT NOT NULL,
              connector_id TEXT,
              provider TEXT,
              model_id TEXT,
              route_binding_json TEXT
            );
            INSERT INTO ai_threads (
              id,
              title,
              created_at_ms,
              updated_at_ms,
              last_message_at_ms,
              archived_at_ms,
              route_kind,
              connector_id,
              provider,
              model_id,
              route_binding_json
            ) VALUES (
              'thread-legacy-001',
              'Legacy AI thread',
              100,
              120,
              120,
              NULL,
              'local',
              'connector-legacy',
              'provider-legacy',
              'model-legacy',
              '{\"binding\":\"legacy\"}'
            );
            "#,
        )
        .expect("seed legacy schema");

        super::schema::init_schema(&conn).expect("init schema");

        let columns = ai_thread_columns(&conn);
        assert_eq!(
            columns,
            vec![
                "id",
                "title",
                "created_at_ms",
                "updated_at_ms",
                "last_message_at_ms",
                "archived_at_ms",
            ]
        );
        let thread = get_thread_bundle(&conn, "thread-legacy-001")
            .expect("bundle")
            .expect("thread");
        assert_eq!(thread.thread.title, "Legacy AI thread");
        assert_eq!(thread.thread.last_message_at_ms, Some(120));

        let version: i64 = conn
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .expect("user_version");
        assert_eq!(version, CHAT_AI_DB_SCHEMA_VERSION);
    });
}

#[test]
fn chat_ai_store_round_trip_thread_message_and_draft() {
    let home = temp_home("roundtrip");
    with_env(&[("HOME", home.to_str())], || {
        let path = crate::desktop_paths::resolve_nimi_data_dir()
            .expect("nimi data dir")
            .join("chat-ai")
            .join("main.db");
        fs::create_dir_all(path.parent().expect("parent")).expect("create parent");
        let conn = Connection::open(&path).expect("open");
        super::schema::init_schema(&conn).expect("init schema");

        let thread = create_thread(
            &conn,
            &ChatAiCreateThreadInput {
                id: "thread-ai-001".to_string(),
                title: "AI thread".to_string(),
                created_at_ms: 100,
                updated_at_ms: 120,
                last_message_at_ms: None,
                archived_at_ms: None,
            },
        )
        .expect("create thread");
        assert_eq!(thread.id, "thread-ai-001");

        let message = create_message(
            &conn,
            &ChatAiCreateMessageInput {
                id: "message-001".to_string(),
                thread_id: thread.id.clone(),
                role: ChatAiMessageRole::User,
                status: ChatAiMessageStatus::Complete,
                content_text: "hello".to_string(),
                content: sample_content("hello"),
                error: None,
                trace_id: Some("trace-001".to_string()),
                parent_message_id: None,
                created_at_ms: 130,
                updated_at_ms: 130,
            },
        )
        .expect("create message");
        assert_eq!(message.trace_id.as_deref(), Some("trace-001"));

        let draft = put_draft(
            &conn,
            &ChatAiPutDraftInput {
                thread_id: thread.id.clone(),
                text: "draft".to_string(),
                attachments: vec![ChatAiAttachment {
                    attachment_id: "attachment-001".to_string(),
                    name: "note.txt".to_string(),
                    mime_type: "text/plain".to_string(),
                    size_bytes: 42,
                }],
                updated_at_ms: 140,
            },
        )
        .expect("put draft");
        assert_eq!(draft.attachments.len(), 1);

        let threads = list_threads(&conn).expect("list threads");
        assert_eq!(threads.len(), 1);

        let bundle = get_thread_bundle(&conn, &thread.id)
            .expect("bundle")
            .expect("bundle present");
        assert_eq!(bundle.messages.len(), 1);
        assert_eq!(bundle.messages[0].content.parts.len(), 1);
        assert_eq!(bundle.draft.expect("draft").text, "draft");
    });
}

#[test]
fn chat_ai_store_allows_empty_pending_assistant_placeholder_content() {
    let home = temp_home("empty-placeholder");
    with_env(&[("HOME", home.to_str())], || {
        let path = crate::desktop_paths::resolve_nimi_data_dir()
            .expect("nimi data dir")
            .join("chat-ai")
            .join("main.db");
        fs::create_dir_all(path.parent().expect("parent")).expect("create parent");
        let conn = Connection::open(&path).expect("open");
        super::schema::init_schema(&conn).expect("init schema");

        let thread = create_thread(
            &conn,
            &ChatAiCreateThreadInput {
                id: "thread-ai-placeholder".to_string(),
                title: "AI thread".to_string(),
                created_at_ms: 100,
                updated_at_ms: 120,
                last_message_at_ms: None,
                archived_at_ms: None,
            },
        )
        .expect("create thread");

        let user_message = create_message(
            &conn,
            &ChatAiCreateMessageInput {
                id: "message-user".to_string(),
                thread_id: thread.id.clone(),
                role: ChatAiMessageRole::User,
                status: ChatAiMessageStatus::Complete,
                content_text: "hello".to_string(),
                content: sample_content("hello"),
                error: None,
                trace_id: None,
                parent_message_id: None,
                created_at_ms: 130,
                updated_at_ms: 130,
            },
        )
        .expect("create user message");

        let assistant_placeholder = create_message(
            &conn,
            &ChatAiCreateMessageInput {
                id: "message-assistant".to_string(),
                thread_id: thread.id.clone(),
                role: ChatAiMessageRole::Assistant,
                status: ChatAiMessageStatus::Pending,
                content_text: "".to_string(),
                content: sample_content(""),
                error: None,
                trace_id: None,
                parent_message_id: Some(user_message.id.clone()),
                created_at_ms: 131,
                updated_at_ms: 131,
            },
        )
        .expect("create assistant placeholder");
        assert_eq!(assistant_placeholder.content.parts.len(), 1);
        match &assistant_placeholder.content.parts[0] {
            ChatAiMessagePart::Text(value) => assert_eq!(value.text, ""),
        }

        let updated_placeholder = update_message(
            &conn,
            &ChatAiUpdateMessageInput {
                id: assistant_placeholder.id.clone(),
                status: ChatAiMessageStatus::Error,
                content_text: "".to_string(),
                content: sample_content(""),
                error: Some(ChatAiMessageError {
                    code: Some("RUNTIME_CALL_FAILED".to_string()),
                    message: "failed".to_string(),
                }),
                trace_id: None,
                updated_at_ms: 132,
            },
        )
        .expect("update assistant placeholder");
        match &updated_placeholder.content.parts[0] {
            ChatAiMessagePart::Text(value) => assert_eq!(value.text, ""),
        }
    });
}

#[test]
fn chat_ai_store_rejects_missing_thread_duplicate_id_and_invalid_json() {
    let home = temp_home("errors");
    with_env(&[("HOME", home.to_str())], || {
        let path = crate::desktop_paths::resolve_nimi_data_dir()
            .expect("nimi data dir")
            .join("chat-ai")
            .join("main.db");
        fs::create_dir_all(path.parent().expect("parent")).expect("create parent");
        let conn = Connection::open(&path).expect("open");
        super::schema::init_schema(&conn).expect("init schema");

        let create_missing_thread_message = create_message(
            &conn,
            &ChatAiCreateMessageInput {
                id: "message-orphan".to_string(),
                thread_id: "missing-thread".to_string(),
                role: ChatAiMessageRole::User,
                status: ChatAiMessageStatus::Complete,
                content_text: "hello".to_string(),
                content: sample_content("hello"),
                error: None,
                trace_id: None,
                parent_message_id: None,
                created_at_ms: 100,
                updated_at_ms: 100,
            },
        )
        .expect_err("missing thread should fail");
        assert!(create_missing_thread_message.contains("missing referenced thread"));

        create_thread(
            &conn,
            &ChatAiCreateThreadInput {
                id: "thread-ai-dup".to_string(),
                title: "AI thread".to_string(),
                created_at_ms: 100,
                updated_at_ms: 120,
                last_message_at_ms: None,
                archived_at_ms: None,
            },
        )
        .expect("create thread");
        let duplicate = create_thread(
            &conn,
            &ChatAiCreateThreadInput {
                id: "thread-ai-dup".to_string(),
                title: "AI thread 2".to_string(),
                created_at_ms: 101,
                updated_at_ms: 121,
                last_message_at_ms: None,
                archived_at_ms: None,
            },
        )
        .expect("duplicate thread should reuse existing record");
        assert_eq!(duplicate.id, "thread-ai-dup");
        assert_eq!(duplicate.title, "AI thread");
        assert_eq!(duplicate.created_at_ms, 100);
        assert_eq!(duplicate.updated_at_ms, 120);

        conn.execute(
            r#"
            INSERT INTO ai_messages (
              id, thread_id, role, status, content_text, content_json, error_code, error_message,
              trace_id, parent_message_id, created_at_ms, updated_at_ms
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL, NULL, NULL, NULL, ?7, ?8)
            "#,
            params![
                "message-bad-json",
                "thread-ai-dup",
                "assistant",
                "complete",
                "bad",
                "{bad-json",
                200_i64,
                200_i64,
            ],
        )
        .expect("insert bad json");
        let bundle_error =
            get_thread_bundle(&conn, "thread-ai-dup").expect_err("bad json should fail");
        assert!(bundle_error.contains("invalid JSON"));
    });
}

#[test]
fn chat_ai_draft_put_overwrites_and_delete_clears() {
    let home = temp_home("draft");
    with_env(&[("HOME", home.to_str())], || {
        let path = crate::desktop_paths::resolve_nimi_data_dir()
            .expect("nimi data dir")
            .join("chat-ai")
            .join("main.db");
        fs::create_dir_all(path.parent().expect("parent")).expect("create parent");
        let conn = Connection::open(&path).expect("open");
        super::schema::init_schema(&conn).expect("init schema");

        create_thread(
            &conn,
            &ChatAiCreateThreadInput {
                id: "thread-draft-001".to_string(),
                title: "AI thread".to_string(),
                created_at_ms: 100,
                updated_at_ms: 120,
                last_message_at_ms: None,
                archived_at_ms: None,
            },
        )
        .expect("create thread");

        put_draft(
            &conn,
            &ChatAiPutDraftInput {
                thread_id: "thread-draft-001".to_string(),
                text: "draft-1".to_string(),
                attachments: Vec::new(),
                updated_at_ms: 200,
            },
        )
        .expect("draft 1");
        let updated = put_draft(
            &conn,
            &ChatAiPutDraftInput {
                thread_id: "thread-draft-001".to_string(),
                text: "draft-2".to_string(),
                attachments: Vec::new(),
                updated_at_ms: 210,
            },
        )
        .expect("draft 2");
        assert_eq!(updated.text, "draft-2");
        delete_draft(&conn, "thread-draft-001").expect("delete draft");
        assert!(get_draft(&conn, "thread-draft-001")
            .expect("get draft")
            .is_none());
    });
}
