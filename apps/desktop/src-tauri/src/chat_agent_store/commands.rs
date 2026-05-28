use super::{
    commit_turn_result, create_thread, get_thread_bundle, list_threads, open_db,
    ChatAgentCommitTurnResult, ChatAgentCommitTurnResultInput,
    ChatAgentCreateThreadInput, ChatAgentThreadBundle, ChatAgentThreadLookupPayload,
    ChatAgentThreadRecord, ChatAgentThreadSummary,
};

async fn run_chat_agent_store<T, F>(operation: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(operation)
        .await
        .map_err(|error| format!("CHAT_AGENT_STORE_TASK_JOIN_FAILED: {error}"))?
}

#[tauri::command]
pub(crate) async fn chat_agent_list_threads() -> Result<Vec<ChatAgentThreadSummary>, String> {
    run_chat_agent_store(|| {
        let conn = open_db()?;
        list_threads(&conn)
    })
    .await
}

#[tauri::command]
pub(crate) async fn chat_agent_get_thread_bundle(
    payload: ChatAgentThreadLookupPayload,
) -> Result<Option<ChatAgentThreadBundle>, String> {
    run_chat_agent_store(move || {
        let conn = open_db()?;
        get_thread_bundle(&conn, &payload.thread_id)
    })
    .await
}

#[tauri::command]
pub(crate) async fn chat_agent_create_thread(
    payload: ChatAgentCreateThreadInput,
) -> Result<ChatAgentThreadRecord, String> {
    run_chat_agent_store(move || {
        let conn = open_db()?;
        create_thread(&conn, &payload)
    })
    .await
}

#[tauri::command]
pub(crate) async fn chat_agent_commit_turn_result(
    payload: ChatAgentCommitTurnResultInput,
) -> Result<ChatAgentCommitTurnResult, String> {
    run_chat_agent_store(move || {
        let mut conn = open_db()?;
        commit_turn_result(&mut conn, &payload)
    })
    .await
}
