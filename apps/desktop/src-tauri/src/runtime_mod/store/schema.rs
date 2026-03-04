fn init_schema(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS runtime_audit_records (
          id TEXT PRIMARY KEY,
          mod_id TEXT,
          stage TEXT,
          event_type TEXT NOT NULL,
          decision TEXT,
          reason_codes TEXT,
          payload TEXT,
          occurred_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_runtime_audit_mod_time ON runtime_audit_records(mod_id, occurred_at);
        CREATE INDEX IF NOT EXISTS idx_runtime_audit_stage_time ON runtime_audit_records(stage, occurred_at);
        CREATE TABLE IF NOT EXISTS action_idempotency_records (
          principal_id TEXT NOT NULL,
          action_id TEXT NOT NULL,
          idempotency_key TEXT NOT NULL,
          input_digest TEXT NOT NULL,
          response TEXT NOT NULL,
          occurred_at TEXT NOT NULL,
          PRIMARY KEY (principal_id, action_id, idempotency_key)
        );
        CREATE INDEX IF NOT EXISTS idx_action_idempotency_time ON action_idempotency_records(occurred_at);
        CREATE TABLE IF NOT EXISTS action_verify_tickets (
          ticket_id TEXT PRIMARY KEY,
          principal_id TEXT NOT NULL,
          action_id TEXT NOT NULL,
          trace_id TEXT NOT NULL,
          input_digest TEXT NOT NULL,
          issued_at TEXT NOT NULL,
          expires_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_action_verify_tickets_principal ON action_verify_tickets(principal_id, action_id, expires_at);
        CREATE TABLE IF NOT EXISTS action_execution_ledger (
          ledger_id TEXT PRIMARY KEY,
          execution_id TEXT NOT NULL,
          action_id TEXT NOT NULL,
          principal_id TEXT NOT NULL,
          phase TEXT NOT NULL,
          status TEXT NOT NULL,
          trace_id TEXT NOT NULL,
          reason_code TEXT,
          payload TEXT,
          occurred_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_action_execution_ledger_action_time ON action_execution_ledger(action_id, occurred_at);
        CREATE INDEX IF NOT EXISTS idx_action_execution_ledger_execution_time ON action_execution_ledger(execution_id, occurred_at);
        CREATE INDEX IF NOT EXISTS idx_action_execution_ledger_principal_time ON action_execution_ledger(principal_id, occurred_at);
        CREATE TABLE IF NOT EXISTS action_audit_records (
          audit_id TEXT PRIMARY KEY,
          action_id TEXT NOT NULL,
          principal_id TEXT NOT NULL,
          trace_id TEXT NOT NULL,
          reason_code TEXT NOT NULL,
          payload TEXT,
          occurred_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_action_audit_records_trace_time ON action_audit_records(trace_id, occurred_at);
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
        CREATE TABLE IF NOT EXISTS runtime_kv_store (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        "#,
    )
    .map_err(|error| format!("初始化 runtime_mod schema 失败: {error}"))?;

    ensure_required_columns(
        conn,
        "action_idempotency_records",
        &[
            "principal_id",
            "action_id",
            "idempotency_key",
            "input_digest",
            "response",
            "occurred_at",
        ],
    )?;
    ensure_required_columns(
        conn,
        "external_agent_tokens",
        &[
            "token_id",
            "principal_id",
            "mode",
            "subject_account_id",
            "actions",
            "scopes",
            "issuer",
            "issued_at",
            "expires_at",
            "revoked_at",
        ],
    )?;
    ensure_required_columns(
        conn,
        "action_execution_ledger",
        &[
            "ledger_id",
            "execution_id",
            "action_id",
            "principal_id",
            "phase",
            "status",
            "trace_id",
            "reason_code",
            "payload",
            "occurred_at",
        ],
    )?;

    Ok(())
}

fn has_column(conn: &Connection, table_name: &str, column_name: &str) -> Result<bool, String> {
    let mut statement = conn
        .prepare(format!("PRAGMA table_info({table_name})").as_str())
        .map_err(|error| format!("读取 {table_name} schema 失败: {error}"))?;
    let mut rows = statement
        .query([])
        .map_err(|error| format!("查询 {table_name} schema 失败: {error}"))?;
    while let Some(row) = rows
        .next()
        .map_err(|error| format!("读取 {table_name} schema 行失败: {error}"))?
    {
        let name: String = row
            .get(1)
            .map_err(|error| format!("读取 {table_name} column name 失败: {error}"))?;
        if name == column_name {
            return Ok(true);
        }
    }
    Ok(false)
}

fn ensure_required_columns(
    conn: &Connection,
    table_name: &str,
    required_columns: &[&str],
) -> Result<(), String> {
    let mut missing_columns = Vec::new();
    for column_name in required_columns {
        if !has_column(conn, table_name, column_name)? {
            missing_columns.push(*column_name);
        }
    }
    if !missing_columns.is_empty() {
        return Err(format!(
            "RUNTIME_MOD_SCHEMA_MISMATCH: table={table_name} missing_columns={} actionHint=delete_local_runtime_mod_db_and_restart",
            missing_columns.join(",")
        ));
    }
    Ok(())
}

fn validate_rfc3339(s: &str) -> bool {
    // Basic RFC3339 validation: YYYY-MM-DDTHH:MM:SS
    s.len() >= 19
        && s.as_bytes().get(4) == Some(&b'-')
        && s.as_bytes().get(7) == Some(&b'-')
        && s.as_bytes().get(10) == Some(&b'T')
        && s.as_bytes().get(13) == Some(&b':')
}

