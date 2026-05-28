#[test]
fn chat_agent_projection_cache_commit_turn_round_trip() {
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
                },
            },
        )
        .expect("commit turn result");

        assert_eq!(committed.turn.id, "turn-001");
        assert_eq!(committed.beats.len(), 1);
        assert_eq!(committed.bundle.messages.len(), 1);
        assert_eq!(committed.bundle.messages[0].content_text, "first beat");

        let bundle = get_thread_bundle(&conn, &thread.id)
            .expect("bundle after commit")
            .expect("bundle present");
        assert_eq!(bundle.messages.len(), 1);
        assert_eq!(bundle.messages[0].status, ChatAgentMessageStatus::Pending);
        assert_eq!(bundle.messages[0].content_text, "first beat");
    });
}
