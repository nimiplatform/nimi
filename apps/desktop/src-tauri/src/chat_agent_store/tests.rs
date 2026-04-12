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
fn chat_agent_store_rejects_missing_thread_duplicate_agent_and_invalid_json() {
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

        create_thread(
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

        let duplicate_agent = create_thread(
            &conn,
            &ChatAgentCreateThreadInput {
                id: "thread-agent-dup-2".to_string(),
                agent_id: "agent-dup".to_string(),
                title: "Agent Dup 2".to_string(),
                created_at_ms: 101,
                updated_at_ms: 121,
                last_message_at_ms: None,
                archived_at_ms: None,
                target_snapshot: sample_target_snapshot("agent-dup"),
            },
        )
        .expect_err("duplicate agent");
        assert!(duplicate_agent.contains("duplicate primary key"));

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

#[test]
fn chat_agent_truth_source_commit_context_cancel_and_rebuild_projection_round_trip() {
    let home = temp_home("truth-source");
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
                id: "thread-truth-source".to_string(),
                agent_id: "agent-truth-source".to_string(),
                title: "Agent Truth".to_string(),
                created_at_ms: 100,
                updated_at_ms: 100,
                last_message_at_ms: None,
                archived_at_ms: None,
                target_snapshot: sample_target_snapshot("agent-truth-source"),
            },
        )
        .expect("create thread");

        put_draft(
            &conn,
            &ChatAgentPutDraftInput {
                thread_id: thread.id.clone(),
                text: "stale draft".to_string(),
                updated_at_ms: 150,
            },
        )
        .expect("seed draft");

        let committed = commit_turn_result(
            &mut conn,
            &ChatAgentCommitTurnResultInput {
                thread_id: thread.id.clone(),
                turn: ChatAgentTurnRecordInput {
                    id: "turn-001".to_string(),
                    thread_id: thread.id.clone(),
                    role: ChatAgentTurnRole::Assistant,
                    status: ChatAgentTurnStatus::Completed,
                    provider_mode: "agent-local-chat-v1".to_string(),
                    trace_id: Some("trace-turn-001".to_string()),
                    prompt_trace_id: Some("prompt-trace-001".to_string()),
                    started_at_ms: 200,
                    completed_at_ms: Some(260),
                    aborted_at_ms: None,
                },
                beats: vec![
                    ChatAgentTurnBeatInput {
                        id: "beat-001".to_string(),
                        turn_id: "turn-001".to_string(),
                        beat_index: 0,
                        modality: ChatAgentBeatModality::Text,
                        status: ChatAgentBeatStatus::Sealed,
                        text_shadow: Some("first beat".to_string()),
                        artifact_id: None,
                        mime_type: Some("text/plain".to_string()),
                        media_url: None,
                        projection_message_id: Some("message-001".to_string()),
                        created_at_ms: 210,
                        delivered_at_ms: Some(220),
                    },
                    ChatAgentTurnBeatInput {
                        id: "beat-002".to_string(),
                        turn_id: "turn-001".to_string(),
                        beat_index: 1,
                        modality: ChatAgentBeatModality::Text,
                        status: ChatAgentBeatStatus::Delivered,
                        text_shadow: Some("tail beat".to_string()),
                        artifact_id: None,
                        mime_type: Some("text/plain".to_string()),
                        media_url: None,
                        projection_message_id: Some("message-002".to_string()),
                        created_at_ms: 230,
                        delivered_at_ms: Some(260),
                    },
                ],
                interaction_snapshot: Some(ChatAgentInteractionSnapshotInput {
                    thread_id: thread.id.clone(),
                    version: 1,
                    relationship_state: "warm".to_string(),
                    emotional_temperature: 0.6,
                    assistant_commitments_json: serde_json::json!({ "promises": ["follow-up"] }),
                    user_prefs_json: serde_json::json!({ "style": "concise" }),
                    open_loops_json: serde_json::json!(["send summary"]),
                    updated_at_ms: 261,
                }),
                relation_memory_slots: vec![ChatAgentRelationMemorySlotInput {
                    id: "memory-001".to_string(),
                    thread_id: thread.id.clone(),
                    slot_type: "preference".to_string(),
                    summary: "User prefers concise answers".to_string(),
                    source_turn_id: Some("turn-001".to_string()),
                    source_beat_id: Some("beat-002".to_string()),
                    score: 0.9,
                    updated_at_ms: 262,
                }],
                recall_entries: vec![ChatAgentRecallEntryInput {
                    id: "recall-001".to_string(),
                    thread_id: thread.id.clone(),
                    source_turn_id: Some("turn-001".to_string()),
                    source_beat_id: Some("beat-002".to_string()),
                    summary: "Summarize the delivery plan".to_string(),
                    search_text: "delivery plan summary".to_string(),
                    updated_at_ms: 263,
                }],
                projection: ChatAgentProjectionCommitInput {
                    thread: ChatAgentUpdateThreadMetadataInput {
                        id: thread.id.clone(),
                        title: "Agent Truth".to_string(),
                        updated_at_ms: 260,
                        last_message_at_ms: Some(260),
                        archived_at_ms: None,
                        target_snapshot: sample_target_snapshot("agent-truth-source"),
                    },
                    messages: vec![
                        ChatAgentProjectionMessageInput {
                            id: "message-001".to_string(),
                            thread_id: thread.id.clone(),
                            role: ChatAgentMessageRole::Assistant,
                            status: ChatAgentMessageStatus::Pending,
                            kind: ChatAgentMessageKind::Text,
                            content_text: "first beat".to_string(),
                            reasoning_text: None,
                            error: None,
                            trace_id: Some("trace-turn-001".to_string()),
                            parent_message_id: None,
                            media_url: None,
                            media_mime_type: None,
                            artifact_id: None,
                            metadata_json: None,
                            created_at_ms: 210,
                            updated_at_ms: 220,
                        },
                        ChatAgentProjectionMessageInput {
                            id: "message-002".to_string(),
                            thread_id: thread.id.clone(),
                            role: ChatAgentMessageRole::Assistant,
                            status: ChatAgentMessageStatus::Complete,
                            kind: ChatAgentMessageKind::Text,
                            content_text: "tail beat".to_string(),
                            reasoning_text: None,
                            error: None,
                            trace_id: Some("trace-turn-001".to_string()),
                            parent_message_id: Some("message-001".to_string()),
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
        )
        .expect("commit turn result");

        assert_eq!(committed.turn.id, "turn-001");
        assert_eq!(committed.beats.len(), 2);
        assert_eq!(committed.bundle.messages.len(), 2);
        assert!(committed.bundle.draft.is_none());
        assert_eq!(committed.bundle.messages[1].content_text, "tail beat");
        assert_eq!(
            committed
                .interaction_snapshot
                .as_ref()
                .map(|item| item.version),
            Some(1)
        );
        assert_eq!(committed.relation_memory_slots.len(), 1);
        assert_eq!(committed.recall_entries.len(), 1);
        assert!(committed.projection_version.starts_with("truth:"));

        let context = load_turn_context(
            &conn,
            &ChatAgentLoadTurnContextInput {
                thread_id: thread.id.clone(),
                recent_turn_limit: Some(8),
                relation_memory_limit: Some(8),
                recall_limit: Some(8),
            },
        )
        .expect("load turn context");
        assert_eq!(context.recent_turns.len(), 1);
        assert_eq!(context.recent_turns[0].provider_mode, "agent-local-chat-v1");
        assert_eq!(context.recent_beats.len(), 2);
        assert_eq!(
            context.recent_beats[0].projection_message_id.as_deref(),
            Some("message-001")
        );
        assert_eq!(context.relation_memory_slots.len(), 1);
        assert_eq!(context.recall_entries.len(), 1);
        assert!(context.draft.is_none());
        assert_eq!(context.projection_version, committed.projection_version);

        conn.execute(
            "DELETE FROM agent_messages WHERE thread_id = ?1",
            params![&thread.id],
        )
        .expect("delete projection messages");
        let emptied_bundle = get_thread_bundle(&conn, &thread.id)
            .expect("bundle after delete")
            .expect("bundle present");
        assert!(emptied_bundle.messages.is_empty());

        let rebuilt = rebuild_projection(&mut conn, &thread.id).expect("rebuild projection");
        assert_eq!(rebuilt.bundle.messages.len(), 2);
        assert_eq!(
            rebuilt.bundle.messages[0].status,
            ChatAgentMessageStatus::Pending
        );
        assert_eq!(
            rebuilt.bundle.messages[1].status,
            ChatAgentMessageStatus::Complete
        );
        assert_eq!(rebuilt.bundle.messages[1].content_text, "tail beat");

        let canceled = cancel_turn(
            &mut conn,
            &ChatAgentCancelTurnInput {
                thread_id: thread.id.clone(),
                turn_id: "turn-001".to_string(),
                scope: "tail".to_string(),
                aborted_at_ms: 280,
            },
        )
        .expect("cancel turn");
        assert_eq!(canceled.status, ChatAgentTurnStatus::Canceled);
        assert_eq!(canceled.aborted_at_ms, Some(280));

        let post_cancel_context = load_turn_context(
            &conn,
            &ChatAgentLoadTurnContextInput {
                thread_id: thread.id.clone(),
                recent_turn_limit: Some(8),
                relation_memory_limit: Some(8),
                recall_limit: Some(8),
            },
        )
        .expect("load context after cancel");
        assert_eq!(
            post_cancel_context.recent_turns[0].status,
            ChatAgentTurnStatus::Canceled
        );
    });
}
