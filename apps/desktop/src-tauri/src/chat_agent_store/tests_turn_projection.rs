#[test]
fn chat_agent_projection_cache_commit_context_cancel_and_rebuild_projection_round_trip() {
    let home = temp_home("projection-cache");
    with_product_data_home(&home, || {
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
                title: "Agent Projection".to_string(),
                updated_at_ms: 100,
                target_snapshot: ChatAgentTargetSnapshot {
                    display_name: "Agent Projection".to_string(),
                    ..sample_target_snapshot("agent-projection-cache")
                },
                ..sample_create_thread_input("thread-projection-cache", "user-1", "agent-projection-cache")
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
                    provider_mode: "runtime-agent-chat-v1".to_string(),
                    trace_id: Some("trace-turn-001".to_string()),
                    prompt_trace_id: Some("prompt-trace-001".to_string()),
                    started_at_ms: 200,
                    completed_at_ms: Some(260),
                    aborted_at_ms: None,
                },
                beats: vec![ChatAgentTurnBeatInput {
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
                }],
                projection: ChatAgentProjectionCommitInput {
                    thread: ChatAgentUpdateThreadMetadataInput {
                        id: thread.id.clone(),
                        title: "Agent Projection".to_string(),
                        updated_at_ms: 260,
                        last_message_at_ms: Some(260),
                        archived_at_ms: None,
                        target_snapshot: sample_target_snapshot("agent-projection-cache"),
                    },
                    messages: vec![ChatAgentProjectionMessageInput {
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
                    }],
                    draft: None,
                    clear_draft: true,
                },
            },
        )
        .expect("commit turn result");

        assert_eq!(committed.turn.id, "turn-001");
        assert_eq!(committed.beats.len(), 1);
        assert_eq!(committed.bundle.messages.len(), 1);
        assert!(committed.bundle.draft.is_none());
        assert_eq!(committed.bundle.messages[0].content_text, "first beat");
        assert!(committed.projection_version.starts_with("projection:"));

        let context = load_turn_context(
            &conn,
            &ChatAgentLoadTurnContextInput {
                thread_id: thread.id.clone(),
                recent_turn_limit: Some(8),
            },
        )
        .expect("load turn context");
        assert_eq!(context.recent_turns.len(), 1);
        assert_eq!(context.recent_turns[0].provider_mode, "runtime-agent-chat-v1");
        assert_eq!(context.recent_beats.len(), 1);
        assert_eq!(
            context.recent_beats[0].projection_message_id.as_deref(),
            Some("message-001")
        );
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
        assert_eq!(rebuilt.bundle.messages.len(), 1);
        assert_eq!(
            rebuilt.bundle.messages[0].status,
            ChatAgentMessageStatus::Pending
        );
        assert_eq!(rebuilt.bundle.messages[0].content_text, "first beat");

        let canceled = cancel_turn(
            &mut conn,
            &ChatAgentCancelTurnInput {
                thread_id: thread.id.clone(),
                turn_id: "turn-001".to_string(),
                scope: "turn".to_string(),
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
            },
        )
        .expect("load context after cancel");
        assert_eq!(
            post_cancel_context.recent_turns[0].status,
            ChatAgentTurnStatus::Canceled
        );
    });
}
