use super::{
    create_message, create_thread, delete_draft, get_draft, get_thread_bundle, list_threads,
    open_db, put_draft, update_message, update_thread_metadata, ChatAiCreateMessageInput,
    ChatAiCreateThreadInput, ChatAiDraftRecord, ChatAiMessageRecord, ChatAiPutDraftInput,
    ChatAiStoragePayload, ChatAiThreadBundle, ChatAiThreadLookupPayload, ChatAiThreadRecord,
    ChatAiThreadSummary, ChatAiUpdateMessageInput, ChatAiUpdateThreadMetadataInput,
};
use crate::runtime_bridge::generated::{AppStorageProjection, AppStorageState};
use rusqlite::Connection;
use std::path::PathBuf;

const DESKTOP_APP_ID: &str = "nimi.desktop";
const CHAT_AI_STORAGE_CALLER_ID: &str = "desktop.chat-ai-store";
const CHAT_AI_STORAGE_SURFACE_ID: &str = "desktop.chat-ai";
const CHAT_AI_STORAGE_TIMEOUT_MS: u64 = 5_000;

async fn run_chat_ai_store<T, F>(operation: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(operation)
        .await
        .map_err(|error| format!("CHAT_AI_STORE_TASK_JOIN_FAILED: {error}"))?
}

pub(crate) fn chat_ai_data_root_from_projection(
    projection: &AppStorageProjection,
) -> Result<String, String> {
    if projection.app_id != DESKTOP_APP_ID {
        return Err(format!(
            "chat_ai storage projection expected {DESKTOP_APP_ID}, got {}",
            projection.app_id
        ));
    }
    if projection.state != AppStorageState::Ready as i32 {
        return Err(format!(
            "chat_ai storage projection requires Runtime ready state, got {}",
            projection.state
        ));
    }
    let data_root = projection.durable_data_root.trim();
    if data_root.is_empty() {
        return Err("chat_ai storage projection requires durableDataRoot".to_string());
    }
    if !PathBuf::from(data_root).is_absolute() {
        return Err(
            "chat_ai storage durableDataRoot must be an absolute Runtime-projected path"
                .to_string(),
        );
    }
    Ok(data_root.to_string())
}

async fn resolve_chat_ai_storage_root() -> Result<String, String> {
    let request = crate::runtime_bridge::generated::GetAppStorageRequest {
        app_id: DESKTOP_APP_ID.to_string(),
    };
    let response: crate::runtime_bridge::generated::GetAppStorageResponse =
        crate::runtime_bridge::invoke_unary_typed_with_metadata(
            nimi_shell_tauri::capabilities::runtime::RUNTIME_APP_GET_APP_STORAGE_METHOD_ID,
            request,
            crate::runtime_bridge::RuntimeBridgeMetadata {
                app_id: Some(DESKTOP_APP_ID.to_string()),
                caller_kind: Some("desktop-core".to_string()),
                caller_id: Some(CHAT_AI_STORAGE_CALLER_ID.to_string()),
                surface_id: Some(CHAT_AI_STORAGE_SURFACE_ID.to_string()),
                ..Default::default()
            },
            Some(CHAT_AI_STORAGE_TIMEOUT_MS),
        )
        .await?;
    let projection = response
        .projection
        .ok_or_else(|| "GetAppStorage response missing projection".to_string())?;
    chat_ai_data_root_from_projection(&projection)
}

async fn run_chat_ai_store_with_db<T, F>(operation: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce(&Connection) -> Result<T, String> + Send + 'static,
{
    let storage_root = resolve_chat_ai_storage_root().await?;
    run_chat_ai_store(move || {
        let conn = open_db(&storage_root)?;
        operation(&conn)
    })
    .await
}

#[tauri::command]
pub(crate) async fn chat_ai_list_threads(
    _payload: ChatAiStoragePayload,
) -> Result<Vec<ChatAiThreadSummary>, String> {
    run_chat_ai_store_with_db(list_threads).await
}

#[tauri::command]
pub(crate) async fn chat_ai_get_thread_bundle(
    payload: ChatAiThreadLookupPayload,
) -> Result<Option<ChatAiThreadBundle>, String> {
    run_chat_ai_store_with_db(move |conn| get_thread_bundle(conn, &payload.thread_id)).await
}

#[tauri::command]
pub(crate) async fn chat_ai_create_thread(
    payload: ChatAiCreateThreadInput,
) -> Result<ChatAiThreadRecord, String> {
    run_chat_ai_store_with_db(move |conn| create_thread(conn, &payload)).await
}

#[tauri::command]
pub(crate) async fn chat_ai_update_thread_metadata(
    payload: ChatAiUpdateThreadMetadataInput,
) -> Result<ChatAiThreadRecord, String> {
    run_chat_ai_store_with_db(move |conn| update_thread_metadata(conn, &payload)).await
}

#[tauri::command]
pub(crate) async fn chat_ai_create_message(
    payload: ChatAiCreateMessageInput,
) -> Result<ChatAiMessageRecord, String> {
    run_chat_ai_store_with_db(move |conn| create_message(conn, &payload)).await
}

#[tauri::command]
pub(crate) async fn chat_ai_update_message(
    payload: ChatAiUpdateMessageInput,
) -> Result<ChatAiMessageRecord, String> {
    run_chat_ai_store_with_db(move |conn| update_message(conn, &payload)).await
}

#[tauri::command]
pub(crate) async fn chat_ai_get_draft(
    payload: ChatAiThreadLookupPayload,
) -> Result<Option<ChatAiDraftRecord>, String> {
    run_chat_ai_store_with_db(move |conn| get_draft(conn, &payload.thread_id)).await
}

#[tauri::command]
pub(crate) async fn chat_ai_put_draft(
    payload: ChatAiPutDraftInput,
) -> Result<ChatAiDraftRecord, String> {
    run_chat_ai_store_with_db(move |conn| put_draft(conn, &payload)).await
}

#[tauri::command]
pub(crate) async fn chat_ai_delete_draft(payload: ChatAiThreadLookupPayload) -> Result<(), String> {
    run_chat_ai_store_with_db(move |conn| delete_draft(conn, &payload.thread_id)).await
}
