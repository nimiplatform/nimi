use super::codec::{
    map_sql_error, normalize_required_string, normalize_target_snapshot, require_non_negative_ms,
};
use super::rows::{message_record_from_row, thread_record_from_row};
use super::types::*;
use rusqlite::{params, Connection, OptionalExtension};

fn summarize_thread(record: ChatAgentThreadRecord) -> ChatAgentThreadSummary {
    ChatAgentThreadSummary {
        id: record.id,
        local_agent_ref: record.local_agent_ref,
        owner_user_id: record.owner_user_id,
        realm_agent_id: record.realm_agent_id,
        title: record.title,
        updated_at_ms: record.updated_at_ms,
        last_message_at_ms: record.last_message_at_ms,
        target_snapshot: record.target_snapshot,
    }
}

pub(crate) fn list_threads(conn: &Connection) -> Result<Vec<ChatAgentThreadSummary>, String> {
    let mut statement = conn
        .prepare(
            r#"
            SELECT
              id,
              local_agent_ref,
              owner_user_id,
              realm_agent_id,
              title,
              created_at_ms,
              updated_at_ms,
              last_message_at_ms,
              target_snapshot_json
            FROM agent_threads
            ORDER BY updated_at_ms DESC, id DESC
            "#,
        )
        .map_err(|error| format!("prepare chat_agent list_threads failed: {error}"))?;
    let rows = statement
        .query_map([], thread_record_from_row)
        .map_err(|error| format!("query chat_agent list_threads failed: {error}"))?;
    let mut result = Vec::new();
    for row in rows {
        let record = row.map_err(|error| format!("decode chat_agent thread failed: {error}"))?;
        result.push(summarize_thread(record));
    }
    Ok(result)
}

pub(crate) fn get_thread_bundle(
    conn: &Connection,
    thread_id: &str,
) -> Result<Option<ChatAgentThreadBundle>, String> {
    let thread_id = normalize_required_string(thread_id, "threadId")?;
    let thread = conn
        .query_row(
            r#"
            SELECT
              id,
              local_agent_ref,
              owner_user_id,
              realm_agent_id,
              title,
              created_at_ms,
              updated_at_ms,
              last_message_at_ms,
              target_snapshot_json
            FROM agent_threads
            WHERE id = ?1
            "#,
            params![thread_id],
            thread_record_from_row,
        )
        .optional()
        .map_err(|error| format!("query chat_agent thread failed: {error}"))?;
    let Some(thread) = thread else {
        return Ok(None);
    };

    let mut message_statement = conn
        .prepare(
            r#"
            SELECT
              id,
              thread_id,
              role,
              status,
              kind,
              content_text,
              reasoning_text,
              error_code,
              error_message,
              trace_id,
              parent_message_id,
              media_url,
              media_mime_type,
              artifact_id,
              metadata_json,
              created_at_ms,
              updated_at_ms
            FROM agent_messages
            WHERE thread_id = ?1
            ORDER BY created_at_ms ASC, id ASC
            "#,
        )
        .map_err(|error| {
            format!("prepare chat_agent get_thread_bundle messages failed: {error}")
        })?;
    let message_rows = message_statement
        .query_map(params![&thread.id], message_record_from_row)
        .map_err(|error| format!("query chat_agent messages failed: {error}"))?;
    let mut messages = Vec::new();
    for row in message_rows {
        messages.push(row.map_err(|error| format!("decode chat_agent message failed: {error}"))?);
    }

    Ok(Some(ChatAgentThreadBundle {
        thread,
        messages,
    }))
}

fn get_thread_record_by_local_agent_ref(
    conn: &Connection,
    local_agent_ref: &str,
) -> Result<Option<ChatAgentThreadRecord>, String> {
    conn.query_row(
        r#"
        SELECT
          id,
          local_agent_ref,
          owner_user_id,
          realm_agent_id,
          title,
          created_at_ms,
          updated_at_ms,
          last_message_at_ms,
          target_snapshot_json
        FROM agent_threads
        WHERE local_agent_ref = ?1
        "#,
        params![local_agent_ref],
        thread_record_from_row,
    )
    .optional()
    .map_err(|error| format!("query chat_agent thread by local agent ref failed: {error}"))
}

pub(crate) fn create_thread(
    conn: &Connection,
    input: &ChatAgentCreateThreadInput,
) -> Result<ChatAgentThreadRecord, String> {
    let id = normalize_required_string(&input.id, "id")?;
    let (owner_user_id, realm_agent_id, local_agent_ref) =
        super::codec::normalize_local_agent_identity(
            &input.owner_user_id,
            &input.realm_agent_id,
            &input.local_agent_ref,
            "localAgentIdentity",
        )?;
    let title = normalize_required_string(&input.title, "title")?;
    let created_at_ms = require_non_negative_ms(input.created_at_ms, "createdAtMs")?;
    let updated_at_ms = require_non_negative_ms(input.updated_at_ms, "updatedAtMs")?;
    let last_message_at_ms = input
        .last_message_at_ms
        .map(|value| require_non_negative_ms(value, "lastMessageAtMs"))
        .transpose()?;
    let target_snapshot = normalize_target_snapshot(&input.target_snapshot)?;
    if target_snapshot.owner_user_id != owner_user_id
        || target_snapshot.realm_agent_id != realm_agent_id
        || target_snapshot.local_agent_ref != local_agent_ref
    {
        return Err("targetSnapshot local identity must match thread local identity".to_string());
    }
    let target_snapshot_json =
        super::codec::serialize_json_value(&target_snapshot, "targetSnapshot")?;
    match conn.execute(
        r#"
        INSERT INTO agent_threads (
          id,
          local_agent_ref,
          owner_user_id,
          realm_agent_id,
          title,
          created_at_ms,
          updated_at_ms,
          last_message_at_ms,
          target_snapshot_json
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
        "#,
        params![
            id,
            local_agent_ref,
            owner_user_id,
            realm_agent_id,
            title,
            created_at_ms,
            updated_at_ms,
            last_message_at_ms,
            target_snapshot_json,
        ],
    ) {
        Ok(_) => get_thread_bundle(conn, &input.id)?
            .map(|bundle| bundle.thread)
            .ok_or_else(|| {
                "create chat_agent thread failed: missing thread after insert".to_string()
            }),
        Err(error) => {
            let is_duplicate_agent = matches!(
                &error,
                rusqlite::Error::SqliteFailure(code, _)
                    if code.extended_code == rusqlite::ffi::SQLITE_CONSTRAINT_UNIQUE
            );
            if !is_duplicate_agent {
                return Err(map_sql_error("create chat_agent thread failed", error));
            }

            let existing = get_thread_record_by_local_agent_ref(conn, &local_agent_ref)?.ok_or_else(|| {
                "create chat_agent thread failed: duplicate localAgentRef without existing thread"
                    .to_string()
            })?;
            conn.execute(
                r#"
                UPDATE agent_threads
                SET
                  title = ?2,
                  target_snapshot_json = ?3
                WHERE id = ?1
                "#,
                params![&existing.id, title, target_snapshot_json],
            )
            .map_err(|update_error| {
                map_sql_error("create chat_agent thread failed", update_error)
            })?;
            get_thread_bundle(conn, &existing.id)?
                .map(|bundle| bundle.thread)
                .ok_or_else(|| {
                    "create chat_agent thread failed: missing thread after reuse".to_string()
                })
        }
    }
}

pub(crate) fn update_thread_metadata(
    conn: &Connection,
    input: &ChatAgentUpdateThreadMetadataInput,
) -> Result<ChatAgentThreadRecord, String> {
    let id = normalize_required_string(&input.id, "id")?;
    let title = normalize_required_string(&input.title, "title")?;
    let updated_at_ms = require_non_negative_ms(input.updated_at_ms, "updatedAtMs")?;
    let last_message_at_ms = input
        .last_message_at_ms
        .map(|value| require_non_negative_ms(value, "lastMessageAtMs"))
        .transpose()?;
    let target_snapshot = normalize_target_snapshot(&input.target_snapshot)?;
    let changed = conn
        .execute(
            r#"
            UPDATE agent_threads
            SET
              title = ?2,
              updated_at_ms = ?3,
              last_message_at_ms = ?4,
              local_agent_ref = ?5,
              owner_user_id = ?6,
              realm_agent_id = ?7,
              target_snapshot_json = ?8
            WHERE id = ?1
            "#,
            params![
                id,
                title,
                updated_at_ms,
                last_message_at_ms,
                target_snapshot.local_agent_ref,
                target_snapshot.owner_user_id,
                target_snapshot.realm_agent_id,
                super::codec::serialize_json_value(&target_snapshot, "targetSnapshot")?,
            ],
        )
        .map_err(|error| map_sql_error("update chat_agent thread failed", error))?;
    if changed == 0 {
        return Err("update chat_agent thread failed: thread not found".to_string());
    }
    get_thread_bundle(conn, &input.id)?
        .map(|bundle| bundle.thread)
        .ok_or_else(|| "update chat_agent thread failed: missing thread after update".to_string())
}

pub(crate) fn delete_thread(conn: &Connection, thread_id: &str) -> Result<(), String> {
    let thread_id = normalize_required_string(thread_id, "threadId")?;
    conn.execute(
        "DELETE FROM agent_threads WHERE id = ?1",
        params![thread_id],
    )
    .map_err(|error| map_sql_error("delete chat_agent thread failed", error))?;
    Ok(())
}
