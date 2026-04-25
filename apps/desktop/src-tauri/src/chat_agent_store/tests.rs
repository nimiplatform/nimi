use super::*;
use crate::test_support::with_env;
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

fn sample_target_snapshot(agent_id: &str) -> ChatAgentTargetSnapshot {
    ChatAgentTargetSnapshot {
        agent_id: agent_id.to_string(),
        display_name: "Agent One".to_string(),
        handle: "~agent-one".to_string(),
        avatar_url: Some("https://example.com/avatar.png".to_string()),
        world_id: Some("world-1".to_string()),
        world_name: Some("OASIS".to_string()),
        bio: Some("Helpful agent".to_string()),
        ownership_type: Some("WORLD_OWNED".to_string()),
    }
}

#[test]
fn chat_agent_db_path_stays_under_nimi_data_dir() {
    let home = temp_home("db-path");
    with_env(&[("HOME", home.to_str())], || {
        let path = super::db::db_path().expect("db path");
        assert_eq!(
            path,
            crate::desktop_paths::resolve_nimi_data_dir()
                .expect("nimi data dir")
                .join("chat-agent")
                .join("main.db")
        );
    });
}

#[test]
fn chat_agent_open_db_initializes_schema_idempotently() {
    let home = temp_home("schema");
    with_env(&[("HOME", home.to_str())], || {
        let path = crate::desktop_paths::resolve_nimi_data_dir()
            .expect("nimi data dir")
            .join("chat-agent")
            .join("main.db");
        fs::create_dir_all(path.parent().expect("parent")).expect("create parent");
        let conn = Connection::open(&path).expect("open");
        super::schema::init_schema(&conn).expect("init schema");
        super::schema::init_schema(&conn).expect("init schema again");

        let version: i64 = conn
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .expect("user_version");
        assert_eq!(version, CHAT_AGENT_DB_SCHEMA_VERSION);
    });
}

#[test]
fn chat_agent_store_round_trip_thread_message_and_draft() {
    let home = temp_home("roundtrip");
    with_env(&[("HOME", home.to_str())], || {
        let path = crate::desktop_paths::resolve_nimi_data_dir()
            .expect("nimi data dir")
            .join("chat-agent")
            .join("main.db");
        fs::create_dir_all(path.parent().expect("parent")).expect("create parent");
        let conn = Connection::open(&path).expect("open");
        super::schema::init_schema(&conn).expect("init schema");

        let thread = create_thread(
            &conn,
            &ChatAgentCreateThreadInput {
                id: "thread-agent-001".to_string(),
                agent_id: "agent-001".to_string(),
                title: "Agent One".to_string(),
                created_at_ms: 100,
                updated_at_ms: 120,
                last_message_at_ms: None,
                archived_at_ms: None,
                target_snapshot: sample_target_snapshot("agent-001"),
            },
        )
        .expect("create thread");
        assert_eq!(thread.agent_id, "agent-001");

        let message = create_message(
            &conn,
            &ChatAgentCreateMessageInput {
                id: "message-001".to_string(),
                thread_id: thread.id.clone(),
                role: ChatAgentMessageRole::User,
                status: ChatAgentMessageStatus::Complete,
                kind: ChatAgentMessageKind::Text,
                content_text: "hello".to_string(),
                reasoning_text: Some("thinking".to_string()),
                error: None,
                trace_id: Some("trace-001".to_string()),
                parent_message_id: None,
                media_url: None,
                media_mime_type: None,
                artifact_id: None,
                metadata_json: None,
                created_at_ms: 130,
                updated_at_ms: 130,
            },
        )
        .expect("create message");
        assert_eq!(message.trace_id.as_deref(), Some("trace-001"));
        assert_eq!(message.reasoning_text.as_deref(), Some("thinking"));

        let draft = put_draft(
            &conn,
            &ChatAgentPutDraftInput {
                thread_id: thread.id.clone(),
                text: "draft".to_string(),
                updated_at_ms: 140,
            },
        )
        .expect("put draft");
        assert_eq!(draft.text, "draft");

        let threads = list_threads(&conn).expect("list threads");
        assert_eq!(threads.len(), 1);
        assert_eq!(threads[0].target_snapshot.handle, "~agent-one");

        let bundle = get_thread_bundle(&conn, &thread.id)
            .expect("bundle")
            .expect("bundle present");
        assert_eq!(bundle.messages.len(), 1);
        assert_eq!(bundle.messages[0].content_text, "hello");
        assert_eq!(
            bundle.messages[0].reasoning_text.as_deref(),
            Some("thinking")
        );
        assert_eq!(bundle.draft.expect("draft").text, "draft");
    });
}

#[test]
fn chat_agent_store_rejects_missing_thread_reuses_duplicate_agent_and_invalid_json() {
    let home = temp_home("errors");
    with_env(&[("HOME", home.to_str())], || {
        let path = crate::desktop_paths::resolve_nimi_data_dir()
            .expect("nimi data dir")
            .join("chat-agent")
            .join("main.db");
        fs::create_dir_all(path.parent().expect("parent")).expect("create parent");
        let conn = Connection::open(&path).expect("open");
        super::schema::init_schema(&conn).expect("init schema");

        let create_missing_thread_message = create_message(
            &conn,
            &ChatAgentCreateMessageInput {
                id: "message-orphan".to_string(),
                thread_id: "missing-thread".to_string(),
                role: ChatAgentMessageRole::User,
                status: ChatAgentMessageStatus::Complete,
                kind: ChatAgentMessageKind::Text,
                content_text: "hello".to_string(),
                reasoning_text: None,
                error: None,
                trace_id: None,
                parent_message_id: None,
                media_url: None,
                media_mime_type: None,
                artifact_id: None,
                metadata_json: None,
                created_at_ms: 100,
                updated_at_ms: 100,
            },
        )
        .expect_err("missing thread should fail");
        assert!(create_missing_thread_message.contains("missing referenced thread"));

        let created = create_thread(
            &conn,
            &ChatAgentCreateThreadInput {
                id: "thread-agent-dup".to_string(),
                agent_id: "agent-dup".to_string(),
                title: "Agent Dup".to_string(),
                created_at_ms: 100,
                updated_at_ms: 120,
                last_message_at_ms: None,
                archived_at_ms: None,
                target_snapshot: sample_target_snapshot("agent-dup"),
            },
        )
        .expect("create thread");
        assert_eq!(created.id, "thread-agent-dup");

        let duplicate_agent = create_thread(
            &conn,
            &ChatAgentCreateThreadInput {
                id: "thread-agent-dup-2".to_string(),
                agent_id: "agent-dup".to_string(),
                title: "Agent Dup Updated".to_string(),
                created_at_ms: 101,
                updated_at_ms: 121,
                last_message_at_ms: None,
                archived_at_ms: None,
                target_snapshot: ChatAgentTargetSnapshot {
                    display_name: "Agent Dup Updated".to_string(),
                    ..sample_target_snapshot("agent-dup")
                },
            },
        )
        .expect("duplicate agent should reuse existing thread");
        assert_eq!(duplicate_agent.id, "thread-agent-dup");
        assert_eq!(duplicate_agent.title, "Agent Dup Updated");
        assert_eq!(
            duplicate_agent.target_snapshot.display_name,
            "Agent Dup Updated"
        );

        conn.execute(
            r#"
            UPDATE agent_threads
            SET target_snapshot_json = ?2
            WHERE id = ?1
            "#,
            params!["thread-agent-dup", "{bad-json"],
        )
        .expect("insert bad json");
        let bundle_error =
            get_thread_bundle(&conn, "thread-agent-dup").expect_err("bad json should fail");
        assert!(bundle_error.contains("invalid JSON"));
    });
}

#[test]
fn chat_agent_draft_put_overwrites_and_delete_clears() {
    let home = temp_home("draft");
    with_env(&[("HOME", home.to_str())], || {
        let path = crate::desktop_paths::resolve_nimi_data_dir()
            .expect("nimi data dir")
            .join("chat-agent")
            .join("main.db");
        fs::create_dir_all(path.parent().expect("parent")).expect("create parent");
        let conn = Connection::open(&path).expect("open");
        super::schema::init_schema(&conn).expect("init schema");

        let thread = create_thread(
            &conn,
            &ChatAgentCreateThreadInput {
                id: "thread-agent-draft".to_string(),
                agent_id: "agent-draft".to_string(),
                title: "Agent Draft".to_string(),
                created_at_ms: 100,
                updated_at_ms: 120,
                last_message_at_ms: None,
                archived_at_ms: None,
                target_snapshot: sample_target_snapshot("agent-draft"),
            },
        )
        .expect("create thread");

        let first = put_draft(
            &conn,
            &ChatAgentPutDraftInput {
                thread_id: thread.id.clone(),
                text: "draft-1".to_string(),
                updated_at_ms: 130,
            },
        )
        .expect("first draft");
        assert_eq!(first.text, "draft-1");

        let second = put_draft(
            &conn,
            &ChatAgentPutDraftInput {
                thread_id: thread.id.clone(),
                text: "draft-2".to_string(),
                updated_at_ms: 140,
            },
        )
        .expect("second draft");
        assert_eq!(second.text, "draft-2");

        delete_draft(&conn, &thread.id).expect("delete draft");
        assert!(get_draft(&conn, &thread.id).expect("get draft").is_none());
    });
}

#[test]
fn chat_agent_delete_message_and_delete_thread_remove_local_history() {
    let home = temp_home("delete-history");
    with_env(&[("HOME", home.to_str())], || {
        let path = crate::desktop_paths::resolve_nimi_data_dir()
            .expect("nimi data dir")
            .join("chat-agent")
            .join("main.db");
        fs::create_dir_all(path.parent().expect("parent")).expect("create parent");
        let conn = Connection::open(&path).expect("open");
        super::schema::init_schema(&conn).expect("init schema");

        let first_thread = create_thread(
            &conn,
            &ChatAgentCreateThreadInput {
                id: "thread-agent-delete-1".to_string(),
                agent_id: "agent-delete-1".to_string(),
                title: "Agent Delete One".to_string(),
                created_at_ms: 100,
                updated_at_ms: 120,
                last_message_at_ms: Some(130),
                archived_at_ms: None,
                target_snapshot: sample_target_snapshot("agent-delete-1"),
            },
        )
        .expect("create first thread");
        let second_thread = create_thread(
            &conn,
            &ChatAgentCreateThreadInput {
                id: "thread-agent-delete-2".to_string(),
                agent_id: "agent-delete-2".to_string(),
                title: "Agent Delete Two".to_string(),
                created_at_ms: 200,
                updated_at_ms: 220,
                last_message_at_ms: Some(230),
                archived_at_ms: None,
                target_snapshot: sample_target_snapshot("agent-delete-2"),
            },
        )
        .expect("create second thread");

        conn.execute(
            r#"
            INSERT INTO agent_messages (
              id, thread_id, role, status, kind, content_text, reasoning_text, error_code, error_message,
              trace_id, parent_message_id, media_url, media_mime_type, artifact_id, metadata_json,
              created_at_ms, updated_at_ms
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, ?7, ?8)
            "#,
            params![
                "message-delete-1",
                &first_thread.id,
                "user",
                "complete",
                "text",
                "hello",
                130_i64,
                130_i64,
            ],
        )
        .expect("insert first message");
        conn.execute(
            r#"
            INSERT INTO agent_messages (
              id, thread_id, role, status, kind, content_text, reasoning_text, error_code, error_message,
              trace_id, parent_message_id, media_url, media_mime_type, artifact_id, metadata_json,
              created_at_ms, updated_at_ms
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, ?7, ?8)
            "#,
            params![
                "message-delete-2",
                &second_thread.id,
                "user",
                "complete",
                "text",
                "hi",
                230_i64,
                230_i64,
            ],
        )
        .expect("insert second message");
        put_draft(
            &conn,
            &ChatAgentPutDraftInput {
                thread_id: first_thread.id.clone(),
                text: "draft".to_string(),
                updated_at_ms: 140,
            },
        )
        .expect("put first draft");
        conn.execute(
            r#"
            INSERT INTO agent_turns (
              id, thread_id, role, status, provider_mode, trace_id, prompt_trace_id,
              started_at_ms, completed_at_ms, aborted_at_ms
            ) VALUES (?1, ?2, ?3, ?4, ?5, NULL, NULL, ?6, NULL, NULL)
            "#,
            params![
                "turn-delete-1",
                &first_thread.id,
                "assistant",
                "completed",
                "agent-local-chat-v1",
                150_i64,
            ],
        )
        .expect("insert turn");

        delete_thread(&conn, &first_thread.id).expect("delete first thread");
        let remaining_threads = list_threads(&conn).expect("list remaining threads");
        assert_eq!(remaining_threads.len(), 1);
        assert_eq!(remaining_threads[0].id, second_thread.id);
        assert!(get_thread_bundle(&conn, &first_thread.id)
            .expect("deleted bundle lookup")
            .is_none());

        let deleted_message_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM agent_messages WHERE thread_id = ?1",
                params![&first_thread.id],
                |row| row.get(0),
            )
            .expect("deleted message count");
        assert_eq!(deleted_message_count, 0);
        let deleted_draft_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM agent_thread_drafts WHERE thread_id = ?1",
                params![&first_thread.id],
                |row| row.get(0),
            )
            .expect("deleted draft count");
        assert_eq!(deleted_draft_count, 0);
        let deleted_turn_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM agent_turns WHERE thread_id = ?1",
                params![&first_thread.id],
                |row| row.get(0),
            )
            .expect("deleted turn count");
        assert_eq!(deleted_turn_count, 0);

        let bundle_after_message_delete =
            delete_message(&conn, "message-delete-2").expect("delete second thread message");
        assert!(bundle_after_message_delete.messages.is_empty());
        assert_eq!(bundle_after_message_delete.thread.last_message_at_ms, None);

        delete_thread(&conn, &second_thread.id).expect("delete second thread");
        let thread_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM agent_threads", [], |row| row.get(0))
            .expect("thread count");
        assert_eq!(thread_count, 0);
    });
}

include!("tests_turn_projection.rs");

#[test]
fn chat_agent_store_rejects_multi_text_beat_assistant_turns() {
    let home = temp_home("single-message-hardcut");
    with_env(&[("HOME", home.to_str())], || {
        let path = crate::desktop_paths::resolve_nimi_data_dir()
            .expect("nimi data dir")
            .join("chat-agent")
            .join("main.db");
        fs::create_dir_all(path.parent().expect("parent")).expect("create parent");
        let mut conn = Connection::open(&path).expect("open");
        super::schema::init_schema(&conn).expect("init schema");

        let thread = create_thread(
            &conn,
            &ChatAgentCreateThreadInput {
                id: "thread-single-message-hardcut".to_string(),
                agent_id: "agent-single-message-hardcut".to_string(),
                title: "Agent Single Message".to_string(),
                created_at_ms: 100,
                updated_at_ms: 100,
                last_message_at_ms: None,
                archived_at_ms: None,
                target_snapshot: sample_target_snapshot("agent-single-message-hardcut"),
            },
        )
        .expect("create thread");

        let result = commit_turn_result(
            &mut conn,
            &ChatAgentCommitTurnResultInput {
                thread_id: thread.id.clone(),
                turn: ChatAgentTurnRecordInput {
                    id: "turn-multi-text".to_string(),
                    thread_id: thread.id.clone(),
                    role: ChatAgentTurnRole::Assistant,
                    status: ChatAgentTurnStatus::Completed,
                    provider_mode: "agent-local-chat-v1".to_string(),
                    trace_id: Some("trace-turn-multi-text".to_string()),
                    prompt_trace_id: Some("prompt-trace-multi-text".to_string()),
                    started_at_ms: 200,
                    completed_at_ms: Some(260),
                    aborted_at_ms: None,
                },
                beats: vec![
                    ChatAgentTurnBeatInput {
                        id: "beat-text-001".to_string(),
                        turn_id: "turn-multi-text".to_string(),
                        beat_index: 0,
                        modality: ChatAgentBeatModality::Text,
                        status: ChatAgentBeatStatus::Delivered,
                        text_shadow: Some("first beat".to_string()),
                        artifact_id: None,
                        mime_type: Some("text/plain".to_string()),
                        media_url: None,
                        projection_message_id: Some("message-text-001".to_string()),
                        created_at_ms: 210,
                        delivered_at_ms: Some(220),
                    },
                    ChatAgentTurnBeatInput {
                        id: "beat-text-002".to_string(),
                        turn_id: "turn-multi-text".to_string(),
                        beat_index: 1,
                        modality: ChatAgentBeatModality::Text,
                        status: ChatAgentBeatStatus::Delivered,
                        text_shadow: Some("second beat".to_string()),
                        artifact_id: None,
                        mime_type: Some("text/plain".to_string()),
                        media_url: None,
                        projection_message_id: Some("message-text-002".to_string()),
                        created_at_ms: 230,
                        delivered_at_ms: Some(260),
                    },
                ],
                interaction_snapshot: None,
                relation_memory_slots: vec![],
                recall_entries: vec![],
                projection: ChatAgentProjectionCommitInput {
                    thread: ChatAgentUpdateThreadMetadataInput {
                        id: thread.id.clone(),
                        title: "Agent Single Message".to_string(),
                        updated_at_ms: 260,
                        last_message_at_ms: Some(260),
                        archived_at_ms: None,
                        target_snapshot: sample_target_snapshot("agent-single-message-hardcut"),
                    },
                    messages: vec![
                        ChatAgentProjectionMessageInput {
                            id: "message-text-001".to_string(),
                            thread_id: thread.id.clone(),
                            role: ChatAgentMessageRole::Assistant,
                            status: ChatAgentMessageStatus::Complete,
                            kind: ChatAgentMessageKind::Text,
                            content_text: "first beat".to_string(),
                            reasoning_text: None,
                            error: None,
                            trace_id: Some("trace-turn-multi-text".to_string()),
                            parent_message_id: None,
                            media_url: None,
                            media_mime_type: None,
                            artifact_id: None,
                            metadata_json: None,
                            created_at_ms: 210,
                            updated_at_ms: 220,
                        },
                        ChatAgentProjectionMessageInput {
                            id: "message-text-002".to_string(),
                            thread_id: thread.id.clone(),
                            role: ChatAgentMessageRole::Assistant,
                            status: ChatAgentMessageStatus::Complete,
                            kind: ChatAgentMessageKind::Text,
                            content_text: "second beat".to_string(),
                            reasoning_text: None,
                            error: None,
                            trace_id: Some("trace-turn-multi-text".to_string()),
                            parent_message_id: Some("message-text-001".to_string()),
                            media_url: None,
                            media_mime_type: None,
                            artifact_id: None,
                            metadata_json: None,
                            created_at_ms: 230,
                            updated_at_ms: 260,
                        },
                    ],
                    draft: None,
                    clear_draft: true,
                },
            },
        );

        assert_eq!(
            result.expect_err("multi-text assistant turn must fail closed"),
            "assistant turns admit at most one text beat per turn"
        );
    });
}

#[test]
fn chat_agent_store_rejects_tail_cancel_scope() {
    let home = temp_home("tail-cancel-hardcut");
    with_env(&[("HOME", home.to_str())], || {
        let path = crate::desktop_paths::resolve_nimi_data_dir()
            .expect("nimi data dir")
            .join("chat-agent")
            .join("main.db");
        fs::create_dir_all(path.parent().expect("parent")).expect("create parent");
        let mut conn = Connection::open(&path).expect("open");
        super::schema::init_schema(&conn).expect("init schema");

        let result = cancel_turn(
            &mut conn,
            &ChatAgentCancelTurnInput {
                thread_id: "thread-missing".to_string(),
                turn_id: "turn-missing".to_string(),
                scope: "tail".to_string(),
                aborted_at_ms: 1,
            },
        );

        assert_eq!(
            result.expect_err("tail cancel scope must fail closed"),
            "scope tail is not admitted after the single-message hard cut"
        );
    });
}
