use super::{
    create_message, create_thread, delete_draft, get_draft, get_thread_bundle, list_threads,
    open_db, put_draft, update_message, update_thread_metadata, ChatAiCreateMessageInput,
    ChatAiCreateThreadInput, ChatAiDeleteDraftInput, ChatAiDraftRecord, ChatAiMessageRecord,
    ChatAiPutDraftInput, ChatAiThreadBundle, ChatAiThreadLookupPayload, ChatAiThreadRecord,
    ChatAiThreadSummary, ChatAiUpdateMessageInput, ChatAiUpdateThreadMetadataInput,
};

#[tauri::command]
pub(crate) fn chat_ai_list_threads() -> Result<Vec<ChatAiThreadSummary>, String> {
    let conn = open_db()?;
    list_threads(&conn)
}

#[tauri::command]
pub(crate) fn chat_ai_get_thread_bundle(
    payload: ChatAiThreadLookupPayload,
) -> Result<Option<ChatAiThreadBundle>, String> {
    let conn = open_db()?;
    get_thread_bundle(&conn, &payload.thread_id)
}

#[tauri::command]
pub(crate) fn chat_ai_create_thread(
    payload: ChatAiCreateThreadInput,
) -> Result<ChatAiThreadRecord, String> {
    let conn = open_db()?;
    create_thread(&conn, &payload)
}

#[tauri::command]
pub(crate) fn chat_ai_update_thread_metadata(
    payload: ChatAiUpdateThreadMetadataInput,
) -> Result<ChatAiThreadRecord, String> {
    let conn = open_db()?;
    update_thread_metadata(&conn, &payload)
}

#[tauri::command]
pub(crate) fn chat_ai_create_message(
    payload: ChatAiCreateMessageInput,
) -> Result<ChatAiMessageRecord, String> {
    let conn = open_db()?;
    create_message(&conn, &payload)
}

#[tauri::command]
pub(crate) fn chat_ai_update_message(
    payload: ChatAiUpdateMessageInput,
) -> Result<ChatAiMessageRecord, String> {
    let conn = open_db()?;
    update_message(&conn, &payload)
}

#[tauri::command]
pub(crate) fn chat_ai_get_draft(
    payload: ChatAiThreadLookupPayload,
) -> Result<Option<ChatAiDraftRecord>, String> {
    let conn = open_db()?;
    get_draft(&conn, &payload.thread_id)
}

#[tauri::command]
pub(crate) fn chat_ai_put_draft(payload: ChatAiPutDraftInput) -> Result<ChatAiDraftRecord, String> {
    let conn = open_db()?;
    put_draft(&conn, &payload)
}

#[tauri::command]
pub(crate) fn chat_ai_delete_draft(payload: ChatAiDeleteDraftInput) -> Result<(), String> {
    let conn = open_db()?;
    delete_draft(&conn, &payload.thread_id)
}
