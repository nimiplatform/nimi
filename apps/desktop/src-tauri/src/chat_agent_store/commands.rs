use super::{
    create_message, create_thread, delete_draft, get_draft, get_thread_bundle, list_threads,
    open_db, put_draft, update_message, update_thread_metadata, ChatAgentCreateMessageInput,
    ChatAgentCreateThreadInput, ChatAgentDeleteDraftInput, ChatAgentDraftRecord,
    ChatAgentMessageRecord, ChatAgentPutDraftInput, ChatAgentThreadBundle,
    ChatAgentThreadLookupPayload, ChatAgentThreadRecord, ChatAgentThreadSummary,
    ChatAgentUpdateMessageInput, ChatAgentUpdateThreadMetadataInput,
};

#[tauri::command]
pub(crate) fn chat_agent_list_threads() -> Result<Vec<ChatAgentThreadSummary>, String> {
    let conn = open_db()?;
    list_threads(&conn)
}

#[tauri::command]
pub(crate) fn chat_agent_get_thread_bundle(
    payload: ChatAgentThreadLookupPayload,
) -> Result<Option<ChatAgentThreadBundle>, String> {
    let conn = open_db()?;
    get_thread_bundle(&conn, &payload.thread_id)
}

#[tauri::command]
pub(crate) fn chat_agent_create_thread(
    payload: ChatAgentCreateThreadInput,
) -> Result<ChatAgentThreadRecord, String> {
    let conn = open_db()?;
    create_thread(&conn, &payload)
}

#[tauri::command]
pub(crate) fn chat_agent_update_thread_metadata(
    payload: ChatAgentUpdateThreadMetadataInput,
) -> Result<ChatAgentThreadRecord, String> {
    let conn = open_db()?;
    update_thread_metadata(&conn, &payload)
}

#[tauri::command]
pub(crate) fn chat_agent_create_message(
    payload: ChatAgentCreateMessageInput,
) -> Result<ChatAgentMessageRecord, String> {
    let conn = open_db()?;
    create_message(&conn, &payload)
}

#[tauri::command]
pub(crate) fn chat_agent_update_message(
    payload: ChatAgentUpdateMessageInput,
) -> Result<ChatAgentMessageRecord, String> {
    let conn = open_db()?;
    update_message(&conn, &payload)
}

#[tauri::command]
pub(crate) fn chat_agent_get_draft(
    payload: ChatAgentThreadLookupPayload,
) -> Result<Option<ChatAgentDraftRecord>, String> {
    let conn = open_db()?;
    get_draft(&conn, &payload.thread_id)
}

#[tauri::command]
pub(crate) fn chat_agent_put_draft(
    payload: ChatAgentPutDraftInput,
) -> Result<ChatAgentDraftRecord, String> {
    let conn = open_db()?;
    put_draft(&conn, &payload)
}

#[tauri::command]
pub(crate) fn chat_agent_delete_draft(payload: ChatAgentDeleteDraftInput) -> Result<(), String> {
    let conn = open_db()?;
    delete_draft(&conn, &payload.thread_id)
}
