use super::{get_thread_bundle, open_db, ChatAgentThreadBundle, ChatAgentThreadLookupPayload};

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
pub(crate) async fn chat_agent_get_thread_bundle(
    payload: ChatAgentThreadLookupPayload,
) -> Result<Option<ChatAgentThreadBundle>, String> {
    run_chat_agent_store(move || {
        let conn = open_db()?;
        get_thread_bundle(&conn, &payload.thread_id)
    })
    .await
}
