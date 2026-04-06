use super::{
    cancel_turn, commit_turn_result, create_message, create_thread, delete_draft, get_draft,
    get_thread_bundle, list_threads, load_turn_context, open_db, put_draft, rebuild_projection,
    update_message, update_thread_metadata, ChatAgentCancelTurnInput, ChatAgentCommitTurnResult,
    ChatAgentCommitTurnResultInput, ChatAgentCreateMessageInput, ChatAgentCreateThreadInput,
    ChatAgentDeleteDraftInput, ChatAgentDraftRecord, ChatAgentLoadTurnContextInput,
    ChatAgentMessageRecord, ChatAgentProjectionRebuildResult, ChatAgentPutDraftInput,
    ChatAgentThreadBundle, ChatAgentThreadLookupPayload, ChatAgentThreadRecord,
    ChatAgentThreadSummary, ChatAgentTurnContext, ChatAgentTurnRecord, ChatAgentUpdateMessageInput,
    ChatAgentUpdateThreadMetadataInput,
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

#[tauri::command]
pub(crate) fn chat_agent_load_turn_context(
    payload: ChatAgentLoadTurnContextInput,
) -> Result<ChatAgentTurnContext, String> {
    let conn = open_db()?;
    load_turn_context(&conn, &payload)
}

#[tauri::command]
pub(crate) fn chat_agent_commit_turn_result(
    payload: ChatAgentCommitTurnResultInput,
) -> Result<ChatAgentCommitTurnResult, String> {
    let mut conn = open_db()?;
    commit_turn_result(&mut conn, &payload)
}

#[tauri::command]
pub(crate) fn chat_agent_cancel_turn(
    payload: ChatAgentCancelTurnInput,
) -> Result<ChatAgentTurnRecord, String> {
    let mut conn = open_db()?;
    cancel_turn(&mut conn, &payload)
}

#[tauri::command]
pub(crate) fn chat_agent_rebuild_projection(
    payload: ChatAgentThreadLookupPayload,
) -> Result<ChatAgentProjectionRebuildResult, String> {
    let mut conn = open_db()?;
    rebuild_projection(&mut conn, &payload.thread_id)
}
