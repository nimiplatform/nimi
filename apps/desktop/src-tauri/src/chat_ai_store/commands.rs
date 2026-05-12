use super::{
    create_message, create_thread, delete_draft, get_draft, get_thread_bundle, list_threads,
    open_db, put_draft, update_message, update_thread_metadata, ChatAiCreateMessageInput,
    ChatAiCreateThreadInput, ChatAiDeleteDraftInput, ChatAiDraftRecord, ChatAiMessageRecord,
    ChatAiPutDraftInput, ChatAiThreadBundle, ChatAiThreadLookupPayload, ChatAiThreadRecord,
    ChatAiThreadSummary, ChatAiUpdateMessageInput, ChatAiUpdateThreadMetadataInput,
};

async fn run_chat_ai_store<T, F>(operation: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(operation)
        .await
        .map_err(|error| format!("CHAT_AI_STORE_TASK_JOIN_FAILED: {error}"))?
}

#[tauri::command]
pub(crate) async fn chat_ai_list_threads() -> Result<Vec<ChatAiThreadSummary>, String> {
    run_chat_ai_store(|| {
        let conn = open_db()?;
        list_threads(&conn)
    })
    .await
}

#[tauri::command]
pub(crate) async fn chat_ai_get_thread_bundle(
    payload: ChatAiThreadLookupPayload,
) -> Result<Option<ChatAiThreadBundle>, String> {
    run_chat_ai_store(move || {
        let conn = open_db()?;
        get_thread_bundle(&conn, &payload.thread_id)
    })
    .await
}

#[tauri::command]
pub(crate) async fn chat_ai_create_thread(
    payload: ChatAiCreateThreadInput,
) -> Result<ChatAiThreadRecord, String> {
    run_chat_ai_store(move || {
        let conn = open_db()?;
        create_thread(&conn, &payload)
    })
    .await
}

#[tauri::command]
pub(crate) async fn chat_ai_update_thread_metadata(
    payload: ChatAiUpdateThreadMetadataInput,
) -> Result<ChatAiThreadRecord, String> {
    run_chat_ai_store(move || {
        let conn = open_db()?;
        update_thread_metadata(&conn, &payload)
    })
    .await
}

#[tauri::command]
pub(crate) async fn chat_ai_create_message(
    payload: ChatAiCreateMessageInput,
) -> Result<ChatAiMessageRecord, String> {
    run_chat_ai_store(move || {
        let conn = open_db()?;
        create_message(&conn, &payload)
    })
    .await
}

#[tauri::command]
pub(crate) async fn chat_ai_update_message(
    payload: ChatAiUpdateMessageInput,
) -> Result<ChatAiMessageRecord, String> {
    run_chat_ai_store(move || {
        let conn = open_db()?;
        update_message(&conn, &payload)
    })
    .await
}

#[tauri::command]
pub(crate) async fn chat_ai_get_draft(
    payload: ChatAiThreadLookupPayload,
) -> Result<Option<ChatAiDraftRecord>, String> {
    run_chat_ai_store(move || {
        let conn = open_db()?;
        get_draft(&conn, &payload.thread_id)
    })
    .await
}

#[tauri::command]
pub(crate) async fn chat_ai_put_draft(
    payload: ChatAiPutDraftInput,
) -> Result<ChatAiDraftRecord, String> {
    run_chat_ai_store(move || {
        let conn = open_db()?;
        put_draft(&conn, &payload)
    })
    .await
}

#[tauri::command]
pub(crate) async fn chat_ai_delete_draft(payload: ChatAiDeleteDraftInput) -> Result<(), String> {
    run_chat_ai_store(move || {
        let conn = open_db()?;
        delete_draft(&conn, &payload.thread_id)
    })
    .await
}
