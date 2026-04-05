use rusqlite::{params, Connection, Error as SqlError, OptionalExtension};

mod commands;
mod db;
mod schema;
mod types;

pub(crate) use commands::*;
pub(crate) use db::open_db;
pub(crate) use types::*;

fn normalize_required_string(value: &str, field_name: &str) -> Result<String, String> {
    let normalized = value.trim();
    if normalized.is_empty() {
        return Err(format!("{field_name} must not be empty"));
    }
    Ok(normalized.to_string())
}

fn normalize_optional_string(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(|text| text.to_string())
}

fn require_non_negative_ms(value: i64, field_name: &str) -> Result<i64, String> {
    if value < 0 {
        return Err(format!("{field_name} must be a non-negative integer"));
    }
    Ok(value)
}

fn normalize_target_snapshot(
    snapshot: &ChatAgentTargetSnapshot,
) -> Result<ChatAgentTargetSnapshot, String> {
    Ok(ChatAgentTargetSnapshot {
        agent_id: normalize_required_string(&snapshot.agent_id, "targetSnapshot.agentId")?,
        display_name: normalize_required_string(
            &snapshot.display_name,
            "targetSnapshot.displayName",
        )?,
        handle: normalize_required_string(&snapshot.handle, "targetSnapshot.handle")?,
        avatar_url: normalize_optional_string(snapshot.avatar_url.as_deref()),
        world_id: normalize_optional_string(snapshot.world_id.as_deref()),
        world_name: normalize_optional_string(snapshot.world_name.as_deref()),
        bio: normalize_optional_string(snapshot.bio.as_deref()),
        ownership_type: normalize_optional_string(snapshot.ownership_type.as_deref()),
    })
}

fn message_role_to_db_value(value: ChatAgentMessageRole) -> &'static str {
    match value {
        ChatAgentMessageRole::System => "system",
        ChatAgentMessageRole::User => "user",
        ChatAgentMessageRole::Assistant => "assistant",
    }
}

fn message_status_to_db_value(value: ChatAgentMessageStatus) -> &'static str {
    match value {
        ChatAgentMessageStatus::Pending => "pending",
        ChatAgentMessageStatus::Complete => "complete",
        ChatAgentMessageStatus::Error => "error",
    }
}

fn parse_message_role(value: &str) -> Result<ChatAgentMessageRole, String> {
    match value {
        "system" => Ok(ChatAgentMessageRole::System),
        "user" => Ok(ChatAgentMessageRole::User),
        "assistant" => Ok(ChatAgentMessageRole::Assistant),
        other => Err(format!("chat_agent message role is invalid: {other}")),
    }
}

fn parse_message_status(value: &str) -> Result<ChatAgentMessageStatus, String> {
    match value {
        "pending" => Ok(ChatAgentMessageStatus::Pending),
        "complete" => Ok(ChatAgentMessageStatus::Complete),
        "error" => Ok(ChatAgentMessageStatus::Error),
        other => Err(format!("chat_agent message status is invalid: {other}")),
    }
}

fn normalize_message_error(
    error: Option<&ChatAgentMessageError>,
) -> Result<Option<ChatAgentMessageError>, String> {
    error
        .map(|value| {
            Ok(ChatAgentMessageError {
                code: normalize_optional_string(value.code.as_deref()),
                message: normalize_required_string(&value.message, "error.message")?,
            })
        })
        .transpose()
}

fn serialize_json_value<T: serde::Serialize>(
    value: &T,
    field_name: &str,
) -> Result<String, String> {
    serde_json::to_string(value).map_err(|error| format!("serialize {field_name} failed: {error}"))
}

fn parse_json_required<T: serde::de::DeserializeOwned>(
    raw: String,
    field_name: &str,
) -> Result<T, String> {
    serde_json::from_str::<T>(&raw)
        .map_err(|error| format!("{field_name} contains invalid JSON: {error}"))
}

fn map_sql_error(context: &str, error: SqlError) -> String {
    match error {
        SqlError::SqliteFailure(code, message) => {
            if code.extended_code == rusqlite::ffi::SQLITE_CONSTRAINT_PRIMARYKEY
                || code.extended_code == rusqlite::ffi::SQLITE_CONSTRAINT_UNIQUE
            {
                return format!("{context}: duplicate primary key or unique value");
            }
            if code.extended_code == rusqlite::ffi::SQLITE_CONSTRAINT_FOREIGNKEY {
                return format!("{context}: missing referenced thread");
            }
            format!("{context}: {}", message.unwrap_or_else(|| code.to_string()))
        }
        other => format!("{context}: {other}"),
    }
}

fn thread_record_from_row(
    row: &rusqlite::Row<'_>,
) -> Result<ChatAgentThreadRecord, rusqlite::Error> {
    let target_snapshot_json: String = row.get(7)?;
    let target_snapshot = parse_json_required::<ChatAgentTargetSnapshot>(
        target_snapshot_json,
        "agent_threads.target_snapshot_json",
    )
    .map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(
            7,
            rusqlite::types::Type::Text,
            Box::new(std::io::Error::new(std::io::ErrorKind::InvalidData, error)),
        )
    })?;
    Ok(ChatAgentThreadRecord {
        id: row.get(0)?,
        agent_id: row.get(1)?,
        title: row.get(2)?,
        created_at_ms: row.get(3)?,
        updated_at_ms: row.get(4)?,
        last_message_at_ms: row.get(5)?,
        archived_at_ms: row.get(6)?,
        target_snapshot,
    })
}

fn message_record_from_row(
    row: &rusqlite::Row<'_>,
) -> Result<ChatAgentMessageRecord, rusqlite::Error> {
    let role_raw: String = row.get(2)?;
    let role = parse_message_role(&role_raw).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(
            2,
            rusqlite::types::Type::Text,
            Box::new(std::io::Error::new(std::io::ErrorKind::InvalidData, error)),
        )
    })?;
    let status_raw: String = row.get(3)?;
    let status = parse_message_status(&status_raw).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(
            3,
            rusqlite::types::Type::Text,
            Box::new(std::io::Error::new(std::io::ErrorKind::InvalidData, error)),
        )
    })?;
    let reasoning_text: Option<String> = row.get(5)?;
    let error_code: Option<String> = row.get(6)?;
    let error_message: Option<String> = row.get(7)?;
    let error = match (error_code, error_message) {
        (None, None) => None,
        (Some(code), Some(message)) => Some(ChatAgentMessageError {
            code: Some(code),
            message,
        }),
        (None, Some(message)) => Some(ChatAgentMessageError {
            code: None,
            message,
        }),
        (Some(_), None) => {
            return Err(rusqlite::Error::FromSqlConversionFailure(
                6,
                rusqlite::types::Type::Text,
                Box::new(std::io::Error::new(
                    std::io::ErrorKind::InvalidData,
                    "agent_messages.error_code/error_message mismatch",
                )),
            ))
        }
    };
    Ok(ChatAgentMessageRecord {
        id: row.get(0)?,
        thread_id: row.get(1)?,
        role,
        status,
        content_text: row.get(4)?,
        reasoning_text,
        error,
        trace_id: row.get(8)?,
        parent_message_id: row.get(9)?,
        created_at_ms: row.get(10)?,
        updated_at_ms: row.get(11)?,
    })
}

fn draft_record_from_row(row: &rusqlite::Row<'_>) -> Result<ChatAgentDraftRecord, rusqlite::Error> {
    Ok(ChatAgentDraftRecord {
        thread_id: row.get(0)?,
        text: row.get(1)?,
        updated_at_ms: row.get(2)?,
    })
}

fn summarize_thread(record: ChatAgentThreadRecord) -> ChatAgentThreadSummary {
    ChatAgentThreadSummary {
        id: record.id,
        agent_id: record.agent_id,
        title: record.title,
        updated_at_ms: record.updated_at_ms,
        last_message_at_ms: record.last_message_at_ms,
        archived_at_ms: record.archived_at_ms,
        target_snapshot: record.target_snapshot,
    }
}

pub(crate) fn list_threads(conn: &Connection) -> Result<Vec<ChatAgentThreadSummary>, String> {
    let mut statement = conn
        .prepare(
            r#"
            SELECT
              id,
              agent_id,
              title,
              created_at_ms,
              updated_at_ms,
              last_message_at_ms,
              archived_at_ms,
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
              agent_id,
              title,
              created_at_ms,
              updated_at_ms,
              last_message_at_ms,
              archived_at_ms,
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
              content_text,
              reasoning_text,
              error_code,
              error_message,
              trace_id,
              parent_message_id,
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

    let draft = conn
        .query_row(
            r#"
            SELECT thread_id, draft_text, updated_at_ms
            FROM agent_thread_drafts
            WHERE thread_id = ?1
            "#,
            params![&thread.id],
            draft_record_from_row,
        )
        .optional()
        .map_err(|error| format!("query chat_agent draft failed: {error}"))?;

    Ok(Some(ChatAgentThreadBundle {
        thread,
        messages,
        draft,
    }))
}

pub(crate) fn create_thread(
    conn: &Connection,
    input: &ChatAgentCreateThreadInput,
) -> Result<ChatAgentThreadRecord, String> {
    let id = normalize_required_string(&input.id, "id")?;
    let agent_id = normalize_required_string(&input.agent_id, "agentId")?;
    let title = normalize_required_string(&input.title, "title")?;
    let created_at_ms = require_non_negative_ms(input.created_at_ms, "createdAtMs")?;
    let updated_at_ms = require_non_negative_ms(input.updated_at_ms, "updatedAtMs")?;
    let last_message_at_ms = input
        .last_message_at_ms
        .map(|value| require_non_negative_ms(value, "lastMessageAtMs"))
        .transpose()?;
    let archived_at_ms = input
        .archived_at_ms
        .map(|value| require_non_negative_ms(value, "archivedAtMs"))
        .transpose()?;
    let target_snapshot = normalize_target_snapshot(&input.target_snapshot)?;
    if target_snapshot.agent_id != agent_id {
        return Err("targetSnapshot.agentId must match agentId".to_string());
    }
    conn.execute(
        r#"
        INSERT INTO agent_threads (
          id,
          agent_id,
          title,
          created_at_ms,
          updated_at_ms,
          last_message_at_ms,
          archived_at_ms,
          target_snapshot_json
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
        "#,
        params![
            id,
            agent_id,
            title,
            created_at_ms,
            updated_at_ms,
            last_message_at_ms,
            archived_at_ms,
            serialize_json_value(&target_snapshot, "targetSnapshot")?,
        ],
    )
    .map_err(|error| map_sql_error("create chat_agent thread failed", error))?;
    get_thread_bundle(conn, &input.id)?
        .map(|bundle| bundle.thread)
        .ok_or_else(|| "create chat_agent thread failed: missing thread after insert".to_string())
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
    let archived_at_ms = input
        .archived_at_ms
        .map(|value| require_non_negative_ms(value, "archivedAtMs"))
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
              archived_at_ms = ?5,
              agent_id = ?6,
              target_snapshot_json = ?7
            WHERE id = ?1
            "#,
            params![
                id,
                title,
                updated_at_ms,
                last_message_at_ms,
                archived_at_ms,
                target_snapshot.agent_id,
                serialize_json_value(&target_snapshot, "targetSnapshot")?,
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

pub(crate) fn create_message(
    conn: &Connection,
    input: &ChatAgentCreateMessageInput,
) -> Result<ChatAgentMessageRecord, String> {
    let id = normalize_required_string(&input.id, "id")?;
    let thread_id = normalize_required_string(&input.thread_id, "threadId")?;
    let content_text = input.content_text.trim().to_string();
    let error = normalize_message_error(input.error.as_ref())?;
    let created_at_ms = require_non_negative_ms(input.created_at_ms, "createdAtMs")?;
    let updated_at_ms = require_non_negative_ms(input.updated_at_ms, "updatedAtMs")?;
    conn.execute(
        r#"
        INSERT INTO agent_messages (
          id,
          thread_id,
          role,
          status,
          content_text,
          reasoning_text,
          error_code,
          error_message,
          trace_id,
          parent_message_id,
          created_at_ms,
          updated_at_ms
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
        "#,
        params![
            id,
            thread_id,
            message_role_to_db_value(input.role),
            message_status_to_db_value(input.status),
            content_text,
            normalize_optional_string(input.reasoning_text.as_deref()),
            error.as_ref().and_then(|item| item.code.clone()),
            error.as_ref().map(|item| item.message.clone()),
            normalize_optional_string(input.trace_id.as_deref()),
            normalize_optional_string(input.parent_message_id.as_deref()),
            created_at_ms,
            updated_at_ms,
        ],
    )
    .map_err(|error| map_sql_error("create chat_agent message failed", error))?;
    conn.query_row(
        r#"
        SELECT
          id,
          thread_id,
          role,
          status,
          content_text,
          reasoning_text,
          error_code,
          error_message,
          trace_id,
          parent_message_id,
          created_at_ms,
          updated_at_ms
        FROM agent_messages
        WHERE id = ?1
        "#,
        params![input.id],
        message_record_from_row,
    )
    .map_err(|error| format!("query chat_agent created message failed: {error}"))
}

pub(crate) fn update_message(
    conn: &Connection,
    input: &ChatAgentUpdateMessageInput,
) -> Result<ChatAgentMessageRecord, String> {
    let id = normalize_required_string(&input.id, "id")?;
    let content_text = input.content_text.trim().to_string();
    let error = normalize_message_error(input.error.as_ref())?;
    let updated_at_ms = require_non_negative_ms(input.updated_at_ms, "updatedAtMs")?;
    let changed = conn
        .execute(
            r#"
            UPDATE agent_messages
            SET
              status = ?2,
              content_text = ?3,
              reasoning_text = ?4,
              error_code = ?5,
              error_message = ?6,
              trace_id = ?7,
              updated_at_ms = ?8
            WHERE id = ?1
            "#,
            params![
                id,
                message_status_to_db_value(input.status),
                content_text,
                normalize_optional_string(input.reasoning_text.as_deref()),
                error.as_ref().and_then(|item| item.code.clone()),
                error.as_ref().map(|item| item.message.clone()),
                normalize_optional_string(input.trace_id.as_deref()),
                updated_at_ms,
            ],
        )
        .map_err(|error| map_sql_error("update chat_agent message failed", error))?;
    if changed == 0 {
        return Err("update chat_agent message failed: message not found".to_string());
    }
    conn.query_row(
        r#"
        SELECT
          id,
          thread_id,
          role,
          status,
          content_text,
          reasoning_text,
          error_code,
          error_message,
          trace_id,
          parent_message_id,
          created_at_ms,
          updated_at_ms
        FROM agent_messages
        WHERE id = ?1
        "#,
        params![input.id],
        message_record_from_row,
    )
    .map_err(|error| format!("query chat_agent updated message failed: {error}"))
}

pub(crate) fn get_draft(
    conn: &Connection,
    thread_id: &str,
) -> Result<Option<ChatAgentDraftRecord>, String> {
    let thread_id = normalize_required_string(thread_id, "threadId")?;
    conn.query_row(
        r#"
        SELECT thread_id, draft_text, updated_at_ms
        FROM agent_thread_drafts
        WHERE thread_id = ?1
        "#,
        params![thread_id],
        draft_record_from_row,
    )
    .optional()
    .map_err(|error| format!("query chat_agent draft failed: {error}"))
}

pub(crate) fn put_draft(
    conn: &Connection,
    input: &ChatAgentPutDraftInput,
) -> Result<ChatAgentDraftRecord, String> {
    let thread_id = normalize_required_string(&input.thread_id, "threadId")?;
    let updated_at_ms = require_non_negative_ms(input.updated_at_ms, "updatedAtMs")?;
    let text = input.text.to_string();
    conn.execute(
        r#"
        INSERT INTO agent_thread_drafts (thread_id, draft_text, updated_at_ms)
        VALUES (?1, ?2, ?3)
        ON CONFLICT(thread_id) DO UPDATE SET
          draft_text = excluded.draft_text,
          updated_at_ms = excluded.updated_at_ms
        "#,
        params![thread_id, text, updated_at_ms],
    )
    .map_err(|error| map_sql_error("put chat_agent draft failed", error))?;
    get_draft(conn, &input.thread_id)?
        .ok_or_else(|| "put chat_agent draft failed: missing draft after write".to_string())
}

pub(crate) fn delete_draft(conn: &Connection, thread_id: &str) -> Result<(), String> {
    let thread_id = normalize_required_string(thread_id, "threadId")?;
    conn.execute(
        "DELETE FROM agent_thread_drafts WHERE thread_id = ?1",
        params![thread_id],
    )
    .map_err(|error| map_sql_error("delete chat_agent draft failed", error))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::with_env;
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_home(prefix: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("nimi-chat-agent-{prefix}-{unique}"));
        fs::create_dir_all(&dir).expect("create temp home");
        dir
    }

    fn sample_target_snapshot(agent_id: &str) -> ChatAgentTargetSnapshot {
        ChatAgentTargetSnapshot {
            agent_id: agent_id.to_string(),
            display_name: "Agent One".to_string(),
            handle: "~agent-one".to_string(),
            avatar_url: Some("https://example.com/avatar.png".to_string()),
            world_id: Some("world-1".to_string()),
            world_name: Some("OASIS".to_string()),
            bio: Some("Helpful agent".to_string()),
            ownership_type: Some("WORLD_OWNED".to_string()),
        }
    }

    #[test]
    fn chat_agent_db_path_stays_under_nimi_data_dir() {
        let home = temp_home("db-path");
        with_env(&[("HOME", home.to_str())], || {
            let path = super::db::db_path().expect("db path");
            assert_eq!(
                path,
                crate::desktop_paths::resolve_nimi_data_dir()
                    .expect("nimi data dir")
                    .join("chat-agent")
                    .join("main.db")
            );
        });
    }

    #[test]
    fn chat_agent_open_db_initializes_schema_idempotently() {
        let home = temp_home("schema");
        with_env(&[("HOME", home.to_str())], || {
            let path = crate::desktop_paths::resolve_nimi_data_dir()
                .expect("nimi data dir")
                .join("chat-agent")
                .join("main.db");
            fs::create_dir_all(path.parent().expect("parent")).expect("create parent");
            let conn = Connection::open(&path).expect("open");
            super::schema::init_schema(&conn).expect("init schema");
            super::schema::init_schema(&conn).expect("init schema again");

            let version: i64 = conn
                .query_row("PRAGMA user_version", [], |row| row.get(0))
                .expect("user_version");
            assert_eq!(version, CHAT_AGENT_DB_SCHEMA_VERSION);
        });
    }

    #[test]
    fn chat_agent_store_round_trip_thread_message_and_draft() {
        let home = temp_home("roundtrip");
        with_env(&[("HOME", home.to_str())], || {
            let path = crate::desktop_paths::resolve_nimi_data_dir()
                .expect("nimi data dir")
                .join("chat-agent")
                .join("main.db");
            fs::create_dir_all(path.parent().expect("parent")).expect("create parent");
            let conn = Connection::open(&path).expect("open");
            super::schema::init_schema(&conn).expect("init schema");

            let thread = create_thread(
                &conn,
                &ChatAgentCreateThreadInput {
                    id: "thread-agent-001".to_string(),
                    agent_id: "agent-001".to_string(),
                    title: "Agent One".to_string(),
                    created_at_ms: 100,
                    updated_at_ms: 120,
                    last_message_at_ms: None,
                    archived_at_ms: None,
                    target_snapshot: sample_target_snapshot("agent-001"),
                },
            )
            .expect("create thread");
            assert_eq!(thread.agent_id, "agent-001");

            let message = create_message(
                &conn,
                &ChatAgentCreateMessageInput {
                    id: "message-001".to_string(),
                    thread_id: thread.id.clone(),
                    role: ChatAgentMessageRole::User,
                    status: ChatAgentMessageStatus::Complete,
                    content_text: "hello".to_string(),
                    reasoning_text: Some("thinking".to_string()),
                    error: None,
                    trace_id: Some("trace-001".to_string()),
                    parent_message_id: None,
                    created_at_ms: 130,
                    updated_at_ms: 130,
                },
            )
            .expect("create message");
            assert_eq!(message.trace_id.as_deref(), Some("trace-001"));
            assert_eq!(message.reasoning_text.as_deref(), Some("thinking"));

            let draft = put_draft(
                &conn,
                &ChatAgentPutDraftInput {
                    thread_id: thread.id.clone(),
                    text: "draft".to_string(),
                    updated_at_ms: 140,
                },
            )
            .expect("put draft");
            assert_eq!(draft.text, "draft");

            let threads = list_threads(&conn).expect("list threads");
            assert_eq!(threads.len(), 1);
            assert_eq!(threads[0].target_snapshot.handle, "~agent-one");

            let bundle = get_thread_bundle(&conn, &thread.id)
                .expect("bundle")
                .expect("bundle present");
            assert_eq!(bundle.messages.len(), 1);
            assert_eq!(bundle.messages[0].content_text, "hello");
            assert_eq!(
                bundle.messages[0].reasoning_text.as_deref(),
                Some("thinking")
            );
            assert_eq!(bundle.draft.expect("draft").text, "draft");
        });
    }

    #[test]
    fn chat_agent_store_rejects_missing_thread_duplicate_agent_and_invalid_json() {
        let home = temp_home("errors");
        with_env(&[("HOME", home.to_str())], || {
            let path = crate::desktop_paths::resolve_nimi_data_dir()
                .expect("nimi data dir")
                .join("chat-agent")
                .join("main.db");
            fs::create_dir_all(path.parent().expect("parent")).expect("create parent");
            let conn = Connection::open(&path).expect("open");
            super::schema::init_schema(&conn).expect("init schema");

            let create_missing_thread_message = create_message(
                &conn,
                &ChatAgentCreateMessageInput {
                    id: "message-orphan".to_string(),
                    thread_id: "missing-thread".to_string(),
                    role: ChatAgentMessageRole::User,
                    status: ChatAgentMessageStatus::Complete,
                    content_text: "hello".to_string(),
                    reasoning_text: None,
                    error: None,
                    trace_id: None,
                    parent_message_id: None,
                    created_at_ms: 100,
                    updated_at_ms: 100,
                },
            )
            .expect_err("missing thread should fail");
            assert!(create_missing_thread_message.contains("missing referenced thread"));

            create_thread(
                &conn,
                &ChatAgentCreateThreadInput {
                    id: "thread-agent-dup".to_string(),
                    agent_id: "agent-dup".to_string(),
                    title: "Agent Dup".to_string(),
                    created_at_ms: 100,
                    updated_at_ms: 120,
                    last_message_at_ms: None,
                    archived_at_ms: None,
                    target_snapshot: sample_target_snapshot("agent-dup"),
                },
            )
            .expect("create thread");

            let duplicate_agent = create_thread(
                &conn,
                &ChatAgentCreateThreadInput {
                    id: "thread-agent-dup-2".to_string(),
                    agent_id: "agent-dup".to_string(),
                    title: "Agent Dup 2".to_string(),
                    created_at_ms: 101,
                    updated_at_ms: 121,
                    last_message_at_ms: None,
                    archived_at_ms: None,
                    target_snapshot: sample_target_snapshot("agent-dup"),
                },
            )
            .expect_err("duplicate agent");
            assert!(duplicate_agent.contains("duplicate primary key"));

            conn.execute(
                r#"
                UPDATE agent_threads
                SET target_snapshot_json = ?2
                WHERE id = ?1
                "#,
                params!["thread-agent-dup", "{bad-json"],
            )
            .expect("insert bad json");
            let bundle_error =
                get_thread_bundle(&conn, "thread-agent-dup").expect_err("bad json should fail");
            assert!(bundle_error.contains("invalid JSON"));
        });
    }

    #[test]
    fn chat_agent_draft_put_overwrites_and_delete_clears() {
        let home = temp_home("draft");
        with_env(&[("HOME", home.to_str())], || {
            let path = crate::desktop_paths::resolve_nimi_data_dir()
                .expect("nimi data dir")
                .join("chat-agent")
                .join("main.db");
            fs::create_dir_all(path.parent().expect("parent")).expect("create parent");
            let conn = Connection::open(&path).expect("open");
            super::schema::init_schema(&conn).expect("init schema");

            let thread = create_thread(
                &conn,
                &ChatAgentCreateThreadInput {
                    id: "thread-agent-draft".to_string(),
                    agent_id: "agent-draft".to_string(),
                    title: "Agent Draft".to_string(),
                    created_at_ms: 100,
                    updated_at_ms: 120,
                    last_message_at_ms: None,
                    archived_at_ms: None,
                    target_snapshot: sample_target_snapshot("agent-draft"),
                },
            )
            .expect("create thread");

            let first = put_draft(
                &conn,
                &ChatAgentPutDraftInput {
                    thread_id: thread.id.clone(),
                    text: "draft-1".to_string(),
                    updated_at_ms: 130,
                },
            )
            .expect("first draft");
            assert_eq!(first.text, "draft-1");

            let second = put_draft(
                &conn,
                &ChatAgentPutDraftInput {
                    thread_id: thread.id.clone(),
                    text: "draft-2".to_string(),
                    updated_at_ms: 140,
                },
            )
            .expect("second draft");
            assert_eq!(second.text, "draft-2");

            delete_draft(&conn, &thread.id).expect("delete draft");
            assert!(get_draft(&conn, &thread.id).expect("get draft").is_none());
        });
    }
}
