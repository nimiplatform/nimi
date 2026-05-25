use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeAuditRecordPayload {
    pub id: String,
    pub source_id: Option<String>,
    pub stage: Option<String>,
    pub event_type: String,
    pub decision: Option<String>,
    pub reason_codes: Option<Vec<String>>,
    pub payload: Option<serde_json::Value>,
    pub occurred_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeAuditFilter {
    pub source_id: Option<String>,
    pub stage: Option<String>,
    pub event_type: Option<String>,
    pub from: Option<String>,
    pub to: Option<String>,
    pub limit: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalAgentStoredActionScope {
    pub action_id: String,
    pub ops: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalAgentTokenRecordPayload {
    pub token_id: String,
    pub principal_id: String,
    pub mode: String,
    pub subject_account_id: String,
    pub actions: Vec<String>,
    pub scopes: Vec<ExternalAgentStoredActionScope>,
    pub issuer: String,
    pub issued_at: String,
    pub expires_at: String,
    pub revoked_at: Option<String>,
}

fn validate_rfc3339(value: &str) -> bool {
    chrono::DateTime::parse_from_rfc3339(value).is_ok()
}

fn init_schema(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS external_agent_audit_records (
          id TEXT PRIMARY KEY,
          source_id TEXT,
          stage TEXT,
          event_type TEXT NOT NULL,
          decision TEXT,
          reason_codes TEXT,
          payload TEXT,
          occurred_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_external_agent_audit_source_time ON external_agent_audit_records(source_id, occurred_at);
        CREATE INDEX IF NOT EXISTS idx_external_agent_audit_stage_time ON external_agent_audit_records(stage, occurred_at);
        CREATE TABLE IF NOT EXISTS external_agent_tokens (
          token_id TEXT PRIMARY KEY,
          principal_id TEXT NOT NULL,
          mode TEXT NOT NULL,
          subject_account_id TEXT NOT NULL,
          actions TEXT NOT NULL,
          scopes TEXT NOT NULL DEFAULT '[]',
          issuer TEXT NOT NULL,
          issued_at TEXT NOT NULL,
          expires_at TEXT NOT NULL,
          revoked_at TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_external_agent_tokens_principal_time ON external_agent_tokens(principal_id, issued_at);
        CREATE INDEX IF NOT EXISTS idx_external_agent_tokens_expiry ON external_agent_tokens(expires_at);
        CREATE TABLE IF NOT EXISTS external_agent_kv_store (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        "#,
    )
    .map_err(|error| format!("EXTERNAL_AGENT_GATEWAY_SCHEMA_INIT_FAILED: {error}"))?;
    Ok(())
}

pub fn open_db(_app: &AppHandle) -> Result<Connection, String> {
    let base_dir = crate::desktop_paths::resolve_nimi_data_dir()?;
    std::fs::create_dir_all(&base_dir)
        .map_err(|error| format!("EXTERNAL_AGENT_GATEWAY_DATA_DIR_CREATE_FAILED: {error}"))?;
    let path = base_dir.join("external-agent-gateway.db");
    let conn = Connection::open(path)
        .map_err(|error| format!("EXTERNAL_AGENT_GATEWAY_DB_OPEN_FAILED: {error}"))?;
    init_schema(&conn)?;
    Ok(conn)
}

pub fn upsert_external_agent_token_record(
    conn: &Connection,
    record: &ExternalAgentTokenRecordPayload,
) -> Result<(), String> {
    if !validate_rfc3339(&record.issued_at) {
        return Err(format!("EXTERNAL_AGENT_TOKEN_ISSUED_AT_INVALID: {}", record.issued_at));
    }
    if !validate_rfc3339(&record.expires_at) {
        return Err(format!("EXTERNAL_AGENT_TOKEN_EXPIRES_AT_INVALID: {}", record.expires_at));
    }
    if let Some(revoked_at) = &record.revoked_at {
        if !validate_rfc3339(revoked_at) {
            return Err(format!("EXTERNAL_AGENT_TOKEN_REVOKED_AT_INVALID: {revoked_at}"));
        }
    }
    let actions_text = serde_json::to_string(&record.actions)
        .map_err(|error| format!("EXTERNAL_AGENT_TOKEN_ACTIONS_SERIALIZE_FAILED: {error}"))?;
    let scopes_text = serde_json::to_string(&record.scopes)
        .map_err(|error| format!("EXTERNAL_AGENT_TOKEN_SCOPES_SERIALIZE_FAILED: {error}"))?;
    conn.execute(
        r#"
        INSERT INTO external_agent_tokens (
          token_id, principal_id, mode, subject_account_id, actions, scopes, issuer, issued_at, expires_at, revoked_at
        )
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
        ON CONFLICT(token_id) DO UPDATE SET
          principal_id = excluded.principal_id,
          mode = excluded.mode,
          subject_account_id = excluded.subject_account_id,
          actions = excluded.actions,
          scopes = excluded.scopes,
          issuer = excluded.issuer,
          issued_at = excluded.issued_at,
          expires_at = excluded.expires_at,
          revoked_at = excluded.revoked_at
        "#,
        params![
            record.token_id,
            record.principal_id,
            record.mode,
            record.subject_account_id,
            actions_text,
            scopes_text,
            record.issuer,
            record.issued_at,
            record.expires_at,
            record.revoked_at
        ],
    )
    .map_err(|error| format!("EXTERNAL_AGENT_TOKEN_WRITE_FAILED: {error}"))?;
    Ok(())
}

pub fn revoke_external_agent_token_record(
    conn: &Connection,
    token_id: &str,
    revoked_at: &str,
) -> Result<bool, String> {
    if !validate_rfc3339(revoked_at) {
        return Err(format!("EXTERNAL_AGENT_TOKEN_REVOKED_AT_INVALID: {revoked_at}"));
    }
    let changed = conn
        .execute(
            "UPDATE external_agent_tokens SET revoked_at = ?2 WHERE token_id = ?1",
            params![token_id, revoked_at],
        )
        .map_err(|error| format!("EXTERNAL_AGENT_TOKEN_REVOKE_FAILED: {error}"))?;
    Ok(changed > 0)
}

fn parse_actions_json(text: &str) -> Result<Vec<String>, String> {
    serde_json::from_str::<Vec<String>>(text)
        .map_err(|error| format!("EXTERNAL_AGENT_TOKEN_ACTIONS_JSON_INVALID: {error}"))
}

fn parse_scopes_json(text: &str) -> Result<Vec<ExternalAgentStoredActionScope>, String> {
    serde_json::from_str::<Vec<ExternalAgentStoredActionScope>>(text)
        .map_err(|error| format!("EXTERNAL_AGENT_TOKEN_SCOPES_JSON_INVALID: {error}"))
}

fn token_from_row(row: &rusqlite::Row<'_>) -> Result<ExternalAgentTokenRecordPayload, String> {
    let actions_text: String = row
        .get(4)
        .map_err(|error| format!("EXTERNAL_AGENT_TOKEN_ACTIONS_READ_FAILED: {error}"))?;
    let scopes_text: String = row
        .get(5)
        .map_err(|error| format!("EXTERNAL_AGENT_TOKEN_SCOPES_READ_FAILED: {error}"))?;
    let actions = parse_actions_json(&actions_text)?;
    let scopes = parse_scopes_json(&scopes_text)?;
    Ok(ExternalAgentTokenRecordPayload {
        token_id: row
            .get(0)
            .map_err(|error| format!("EXTERNAL_AGENT_TOKEN_ID_READ_FAILED: {error}"))?,
        principal_id: row
            .get(1)
            .map_err(|error| format!("EXTERNAL_AGENT_TOKEN_PRINCIPAL_READ_FAILED: {error}"))?,
        mode: row
            .get(2)
            .map_err(|error| format!("EXTERNAL_AGENT_TOKEN_MODE_READ_FAILED: {error}"))?,
        subject_account_id: row
            .get(3)
            .map_err(|error| format!("EXTERNAL_AGENT_TOKEN_SUBJECT_READ_FAILED: {error}"))?,
        actions,
        scopes,
        issuer: row
            .get(6)
            .map_err(|error| format!("EXTERNAL_AGENT_TOKEN_ISSUER_READ_FAILED: {error}"))?,
        issued_at: row
            .get(7)
            .map_err(|error| format!("EXTERNAL_AGENT_TOKEN_ISSUED_AT_READ_FAILED: {error}"))?,
        expires_at: row
            .get(8)
            .map_err(|error| format!("EXTERNAL_AGENT_TOKEN_EXPIRES_AT_READ_FAILED: {error}"))?,
        revoked_at: row
            .get(9)
            .map_err(|error| format!("EXTERNAL_AGENT_TOKEN_REVOKED_AT_READ_FAILED: {error}"))?,
    })
}

pub fn get_external_agent_token_record(
    conn: &Connection,
    token_id: &str,
) -> Result<Option<ExternalAgentTokenRecordPayload>, String> {
    let mut statement = conn
        .prepare(
            r#"
            SELECT token_id, principal_id, mode, subject_account_id, actions, scopes, issuer, issued_at, expires_at, revoked_at
            FROM external_agent_tokens
            WHERE token_id = ?1
            LIMIT 1
            "#,
        )
        .map_err(|error| format!("EXTERNAL_AGENT_TOKEN_QUERY_FAILED: {error}"))?;
    let mut rows = statement
        .query(params![token_id])
        .map_err(|error| format!("EXTERNAL_AGENT_TOKEN_QUERY_EXEC_FAILED: {error}"))?;
    if let Some(row) = rows
        .next()
        .map_err(|error| format!("EXTERNAL_AGENT_TOKEN_ROW_READ_FAILED: {error}"))?
    {
        return token_from_row(row).map(Some);
    }
    Ok(None)
}

pub fn list_external_agent_token_records(
    conn: &Connection,
    limit: usize,
) -> Result<Vec<ExternalAgentTokenRecordPayload>, String> {
    let normalized_limit = limit.clamp(1, 1000) as i64;
    let mut statement = conn
        .prepare(
            r#"
            SELECT token_id, principal_id, mode, subject_account_id, actions, scopes, issuer, issued_at, expires_at, revoked_at
            FROM external_agent_tokens
            ORDER BY issued_at DESC
            LIMIT ?1
            "#,
        )
        .map_err(|error| format!("EXTERNAL_AGENT_TOKEN_LIST_QUERY_FAILED: {error}"))?;
    let mut rows = statement
        .query(params![normalized_limit])
        .map_err(|error| format!("EXTERNAL_AGENT_TOKEN_LIST_EXEC_FAILED: {error}"))?;
    let mut records = Vec::new();
    while let Some(row) = rows
        .next()
        .map_err(|error| format!("EXTERNAL_AGENT_TOKEN_LIST_ROW_READ_FAILED: {error}"))?
    {
        records.push(token_from_row(row)?);
    }
    Ok(records)
}

pub fn set_runtime_kv(
    conn: &Connection,
    key: &str,
    value: &str,
    updated_at: &str,
) -> Result<(), String> {
    if !validate_rfc3339(updated_at) {
        return Err(format!("EXTERNAL_AGENT_KV_UPDATED_AT_INVALID: {updated_at}"));
    }
    conn.execute(
        r#"
        INSERT INTO external_agent_kv_store (key, value, updated_at)
        VALUES (?1, ?2, ?3)
        ON CONFLICT(key) DO UPDATE SET
          value = excluded.value,
          updated_at = excluded.updated_at
        "#,
        params![key, value, updated_at],
    )
    .map_err(|error| format!("EXTERNAL_AGENT_KV_WRITE_FAILED: {error}"))?;
    Ok(())
}

pub fn get_runtime_kv(conn: &Connection, key: &str) -> Result<Option<String>, String> {
    let mut statement = conn
        .prepare("SELECT value FROM external_agent_kv_store WHERE key = ?1 LIMIT 1")
        .map_err(|error| format!("EXTERNAL_AGENT_KV_QUERY_FAILED: {error}"))?;
    let mut rows = statement
        .query(params![key])
        .map_err(|error| format!("EXTERNAL_AGENT_KV_QUERY_EXEC_FAILED: {error}"))?;
    if let Some(row) = rows
        .next()
        .map_err(|error| format!("EXTERNAL_AGENT_KV_ROW_READ_FAILED: {error}"))?
    {
        let value: String = row
            .get(0)
            .map_err(|error| format!("EXTERNAL_AGENT_KV_VALUE_READ_FAILED: {error}"))?;
        return Ok(Some(value));
    }
    Ok(None)
}

pub fn query_runtime_audit(
    conn: &Connection,
    filter: Option<RuntimeAuditFilter>,
) -> Result<Vec<RuntimeAuditRecordPayload>, String> {
    let normalized = filter.unwrap_or(RuntimeAuditFilter {
        source_id: None,
        stage: None,
        event_type: None,
        from: None,
        to: None,
        limit: Some(200),
    });
    let limit = normalized.limit.unwrap_or(200).clamp(1, 1000) as i64;
    let mut statement = conn
        .prepare(
            r#"
            SELECT id, source_id, stage, event_type, decision, reason_codes, payload, occurred_at
            FROM external_agent_audit_records
            WHERE (?1 IS NULL OR source_id = ?1)
              AND (?2 IS NULL OR stage = ?2)
              AND (?3 IS NULL OR event_type = ?3)
              AND (?4 IS NULL OR occurred_at >= ?4)
              AND (?5 IS NULL OR occurred_at <= ?5)
            ORDER BY occurred_at DESC
            LIMIT ?6
            "#,
        )
        .map_err(|error| format!("EXTERNAL_AGENT_AUDIT_QUERY_FAILED: {error}"))?;
    let rows = statement
        .query_map(
            params![
                normalized.source_id,
                normalized.stage,
                normalized.event_type,
                normalized.from,
                normalized.to,
                limit
            ],
            |row| {
                let reason_codes_text: Option<String> = row.get(5)?;
                let payload_text: Option<String> = row.get(6)?;
                let reason_codes = reason_codes_text
                    .and_then(|text| serde_json::from_str::<Vec<String>>(&text).ok());
                let payload = payload_text
                    .and_then(|text| serde_json::from_str::<serde_json::Value>(&text).ok());
                Ok(RuntimeAuditRecordPayload {
                    id: row.get(0)?,
                    source_id: row.get(1)?,
                    stage: row.get(2)?,
                    event_type: row.get(3)?,
                    decision: row.get(4)?,
                    reason_codes,
                    payload,
                    occurred_at: row.get(7)?,
                })
            },
        )
        .map_err(|error| format!("EXTERNAL_AGENT_AUDIT_QUERY_EXEC_FAILED: {error}"))?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("EXTERNAL_AGENT_AUDIT_COLLECT_FAILED: {error}"))
}
