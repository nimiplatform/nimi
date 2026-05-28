use std::sync::atomic::{AtomicBool, Ordering};

use serde::Deserialize;

use super::{
    cancel_turn, commit_turn_result, create_thread, delete_draft, delete_message, delete_thread,
    get_draft, get_thread_bundle, list_threads, open_db, put_draft, rebuild_projection,
    update_thread_metadata, ChatAgentCancelTurnInput, ChatAgentCommitTurnResult,
    ChatAgentCommitTurnResultInput, ChatAgentCreateThreadInput, ChatAgentDeleteDraftInput,
    ChatAgentDraftRecord, ChatAgentMessageLookupPayload, ChatAgentProjectionRebuildResult,
    ChatAgentPutDraftInput, ChatAgentThreadBundle, ChatAgentThreadLookupPayload,
    ChatAgentThreadRecord, ChatAgentThreadSummary, ChatAgentTurnRecord,
    ChatAgentUpdateThreadMetadataInput,
};

const CHAT_AGENT_OFFLINE_L2_WRITE_DENIED: &str = "CHAT_AGENT_OFFLINE_L2_WRITE_DENIED";

static CHAT_AGENT_L2_READ_ONLY: AtomicBool = AtomicBool::new(false);

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ChatAgentOfflineTierPayload {
    tier: String,
}

fn set_chat_agent_l2_read_only(enabled: bool) {
    CHAT_AGENT_L2_READ_ONLY.store(enabled, Ordering::SeqCst);
}

fn ensure_chat_agent_writes_allowed() -> Result<(), String> {
    if CHAT_AGENT_L2_READ_ONLY.load(Ordering::SeqCst) {
        return Err(format!(
            "{CHAT_AGENT_OFFLINE_L2_WRITE_DENIED}: chat-agent local store writes are disabled in offline L2"
        ));
    }
    Ok(())
}

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
pub(crate) fn chat_agent_set_offline_tier(
    payload: ChatAgentOfflineTierPayload,
) -> Result<(), String> {
    set_chat_agent_l2_read_only(payload.tier.trim().eq_ignore_ascii_case("L2"));
    Ok(())
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
        ensure_chat_agent_writes_allowed()?;
        let conn = open_db()?;
        create_thread(&conn, &payload)
    })
    .await
}

#[tauri::command]
pub(crate) async fn chat_agent_update_thread_metadata(
    payload: ChatAgentUpdateThreadMetadataInput,
) -> Result<ChatAgentThreadRecord, String> {
    run_chat_agent_store(move || {
        ensure_chat_agent_writes_allowed()?;
        let conn = open_db()?;
        update_thread_metadata(&conn, &payload)
    })
    .await
}

#[tauri::command]
pub(crate) async fn chat_agent_get_draft(
    payload: ChatAgentThreadLookupPayload,
) -> Result<Option<ChatAgentDraftRecord>, String> {
    run_chat_agent_store(move || {
        let conn = open_db()?;
        get_draft(&conn, &payload.thread_id)
    })
    .await
}

#[tauri::command]
pub(crate) async fn chat_agent_put_draft(
    payload: ChatAgentPutDraftInput,
) -> Result<ChatAgentDraftRecord, String> {
    run_chat_agent_store(move || {
        ensure_chat_agent_writes_allowed()?;
        let conn = open_db()?;
        put_draft(&conn, &payload)
    })
    .await
}

#[tauri::command]
pub(crate) async fn chat_agent_delete_draft(
    payload: ChatAgentDeleteDraftInput,
) -> Result<(), String> {
    run_chat_agent_store(move || {
        ensure_chat_agent_writes_allowed()?;
        let conn = open_db()?;
        delete_draft(&conn, &payload.thread_id)
    })
    .await
}

#[tauri::command]
pub(crate) async fn chat_agent_delete_thread(
    payload: ChatAgentThreadLookupPayload,
) -> Result<(), String> {
    run_chat_agent_store(move || {
        ensure_chat_agent_writes_allowed()?;
        let conn = open_db()?;
        delete_thread(&conn, &payload.thread_id)
    })
    .await
}

#[tauri::command]
pub(crate) async fn chat_agent_delete_message(
    payload: ChatAgentMessageLookupPayload,
) -> Result<ChatAgentThreadBundle, String> {
    run_chat_agent_store(move || {
        ensure_chat_agent_writes_allowed()?;
        let conn = open_db()?;
        delete_message(&conn, &payload.message_id)
    })
    .await
}

#[tauri::command]
pub(crate) async fn chat_agent_commit_turn_result(
    payload: ChatAgentCommitTurnResultInput,
) -> Result<ChatAgentCommitTurnResult, String> {
    run_chat_agent_store(move || {
        ensure_chat_agent_writes_allowed()?;
        let mut conn = open_db()?;
        commit_turn_result(&mut conn, &payload)
    })
    .await
}

#[tauri::command]
pub(crate) async fn chat_agent_cancel_turn(
    payload: ChatAgentCancelTurnInput,
) -> Result<ChatAgentTurnRecord, String> {
    run_chat_agent_store(move || {
        ensure_chat_agent_writes_allowed()?;
        let mut conn = open_db()?;
        cancel_turn(&mut conn, &payload)
    })
    .await
}

#[tauri::command]
pub(crate) async fn chat_agent_rebuild_projection(
    payload: ChatAgentThreadLookupPayload,
) -> Result<ChatAgentProjectionRebuildResult, String> {
    run_chat_agent_store(move || {
        ensure_chat_agent_writes_allowed()?;
        let mut conn = open_db()?;
        rebuild_projection(&mut conn, &payload.thread_id)
    })
    .await
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;

    use super::{
        chat_agent_set_offline_tier, ensure_chat_agent_writes_allowed, ChatAgentOfflineTierPayload,
        CHAT_AGENT_OFFLINE_L2_WRITE_DENIED,
    };

    static OFFLINE_GUARD_TEST_LOCK: Mutex<()> = Mutex::new(());

    #[test]
    fn offline_l2_guard_blocks_chat_agent_store_writes() {
        let _guard = OFFLINE_GUARD_TEST_LOCK.lock().expect("test lock");
        chat_agent_set_offline_tier(ChatAgentOfflineTierPayload {
            tier: "L2".to_string(),
        })
        .expect("set L2");

        let error = ensure_chat_agent_writes_allowed().expect_err("L2 must reject writes");
        assert!(error.contains(CHAT_AGENT_OFFLINE_L2_WRITE_DENIED));

        chat_agent_set_offline_tier(ChatAgentOfflineTierPayload {
            tier: "L0".to_string(),
        })
        .expect("clear L2");
        ensure_chat_agent_writes_allowed().expect("L0 allows writes");
    }

    #[test]
    fn offline_l2_guard_treats_non_l2_tiers_as_write_enabled() {
        let _guard = OFFLINE_GUARD_TEST_LOCK.lock().expect("test lock");
        chat_agent_set_offline_tier(ChatAgentOfflineTierPayload {
            tier: "L1".to_string(),
        })
        .expect("set L1");
        ensure_chat_agent_writes_allowed().expect("L1 allows writes");

        chat_agent_set_offline_tier(ChatAgentOfflineTierPayload {
            tier: " L2 ".to_string(),
        })
        .expect("set L2 with whitespace");
        assert!(ensure_chat_agent_writes_allowed().is_err());

        chat_agent_set_offline_tier(ChatAgentOfflineTierPayload {
            tier: "L0".to_string(),
        })
        .expect("reset L0");
    }
}
