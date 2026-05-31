use super::{
    create_message, create_thread, delete_draft, get_draft, get_thread_bundle, list_threads,
    open_db, put_draft, update_message, update_thread_metadata, ChatAiCreateMessageInput,
    ChatAiCreateThreadInput, ChatAiDraftRecord, ChatAiMessageRecord, ChatAiPutDraftInput,
    ChatAiStorageEnvelope, ChatAiStoragePayload, ChatAiThreadBundle, ChatAiThreadLookupPayload,
    ChatAiThreadRecord, ChatAiThreadSummary, ChatAiUpdateMessageInput,
    ChatAiUpdateThreadMetadataInput,
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
pub(crate) async fn chat_ai_list_threads(
    payload: ChatAiStoragePayload,
) -> Result<Vec<ChatAiThreadSummary>, String> {
    run_chat_ai_store(move || {
        let conn = open_db(&payload.storage_root)?;
        list_threads(&conn)
    })
    .await
}

#[tauri::command]
pub(crate) async fn chat_ai_get_thread_bundle(
    payload: ChatAiStorageEnvelope<ChatAiThreadLookupPayload>,
) -> Result<Option<ChatAiThreadBundle>, String> {
    run_chat_ai_store(move || {
        let conn = open_db(&payload.storage_root)?;
        get_thread_bundle(&conn, &payload.input.thread_id)
    })
    .await
}

#[tauri::command]
pub(crate) async fn chat_ai_create_thread(
    payload: ChatAiStorageEnvelope<ChatAiCreateThreadInput>,
) -> Result<ChatAiThreadRecord, String> {
    run_chat_ai_store(move || {
        let conn = open_db(&payload.storage_root)?;
        create_thread(&conn, &payload.input)
    })
    .await
}

#[tauri::command]
pub(crate) async fn chat_ai_update_thread_metadata(
    payload: ChatAiStorageEnvelope<ChatAiUpdateThreadMetadataInput>,
) -> Result<ChatAiThreadRecord, String> {
    run_chat_ai_store(move || {
        let conn = open_db(&payload.storage_root)?;
        update_thread_metadata(&conn, &payload.input)
    })
    .await
}

#[tauri::command]
pub(crate) async fn chat_ai_create_message(
    payload: ChatAiStorageEnvelope<ChatAiCreateMessageInput>,
) -> Result<ChatAiMessageRecord, String> {
    run_chat_ai_store(move || {
        let conn = open_db(&payload.storage_root)?;
        create_message(&conn, &payload.input)
    })
    .await
}

#[tauri::command]
pub(crate) async fn chat_ai_update_message(
    payload: ChatAiStorageEnvelope<ChatAiUpdateMessageInput>,
) -> Result<ChatAiMessageRecord, String> {
    run_chat_ai_store(move || {
        let conn = open_db(&payload.storage_root)?;
        update_message(&conn, &payload.input)
    })
    .await
}

#[tauri::command]
pub(crate) async fn chat_ai_get_draft(
    payload: ChatAiStorageEnvelope<ChatAiThreadLookupPayload>,
) -> Result<Option<ChatAiDraftRecord>, String> {
    run_chat_ai_store(move || {
        let conn = open_db(&payload.storage_root)?;
        get_draft(&conn, &payload.input.thread_id)
    })
    .await
}

#[tauri::command]
pub(crate) async fn chat_ai_put_draft(
    payload: ChatAiStorageEnvelope<ChatAiPutDraftInput>,
) -> Result<ChatAiDraftRecord, String> {
    run_chat_ai_store(move || {
        let conn = open_db(&payload.storage_root)?;
        put_draft(&conn, &payload.input)
    })
    .await
}

#[tauri::command]
pub(crate) async fn chat_ai_delete_draft(
    payload: ChatAiStorageEnvelope<ChatAiThreadLookupPayload>,
) -> Result<(), String> {
    run_chat_ai_store(move || {
        let conn = open_db(&payload.storage_root)?;
        delete_draft(&conn, &payload.input.thread_id)
    })
    .await
}
