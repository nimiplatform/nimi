pub fn upsert_external_agent_token_record(
    conn: &Connection,
    record: &ExternalAgentTokenRecordPayload,
) -> Result<(), String> {
    if !validate_rfc3339(&record.issued_at) {
        return Err(format!("issued_at 格式无效: {}", record.issued_at));
    }
    if !validate_rfc3339(&record.expires_at) {
        return Err(format!("expires_at 格式无效: {}", record.expires_at));
    }
    if let Some(revoked_at) = &record.revoked_at {
        if !validate_rfc3339(revoked_at) {
            return Err(format!("revoked_at 格式无效: {revoked_at}"));
        }
    }
    let actions_text = serde_json::to_string(&record.actions)
        .map_err(|error| format!("序列化 token actions 失败: {error}"))?;
    let scopes_text = serde_json::to_string(&record.scopes)
        .map_err(|error| format!("序列化 token scopes 失败: {error}"))?;
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
    .map_err(|error| format!("写入 external agent token 失败: {error}"))?;
    Ok(())
}

pub fn revoke_external_agent_token_record(
    conn: &Connection,
    token_id: &str,
    revoked_at: &str,
) -> Result<bool, String> {
    if !validate_rfc3339(revoked_at) {
        return Err(format!("revoked_at 格式无效: {revoked_at}"));
    }
    let changed = conn
        .execute(
            r#"
            UPDATE external_agent_tokens
            SET revoked_at = ?2
            WHERE token_id = ?1
            "#,
            params![token_id, revoked_at],
        )
        .map_err(|error| format!("吊销 external agent token 失败: {error}"))?;
    Ok(changed > 0)
}

fn parse_external_agent_token_actions_json(text: &str) -> Result<Vec<String>, String> {
    serde_json::from_str::<Vec<String>>(text)
        .map_err(|error| format!("EXTERNAL_AGENT_TOKEN_ACTIONS_JSON_INVALID: {error}"))
}

fn parse_external_agent_token_scopes_json(
    text: &str,
) -> Result<Vec<RuntimeExternalAgentActionScope>, String> {
    serde_json::from_str::<Vec<RuntimeExternalAgentActionScope>>(text)
        .map_err(|error| format!("EXTERNAL_AGENT_TOKEN_SCOPES_JSON_INVALID: {error}"))
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
        .map_err(|error| format!("查询 external agent token 失败: {error}"))?;

    let mut rows = statement
        .query(params![token_id])
        .map_err(|error| format!("执行 external agent token 查询失败: {error}"))?;
    if let Some(row) = rows
        .next()
        .map_err(|error| format!("读取 external agent token 失败: {error}"))?
    {
        let actions_text: String = row
            .get(4)
            .map_err(|error| format!("读取 external agent token actions 失败: {error}"))?;
        let actions = parse_external_agent_token_actions_json(&actions_text)?;
        let scopes_text: String = row
            .get(5)
            .map_err(|error| format!("读取 external agent token scopes 失败: {error}"))?;
        let scopes = parse_external_agent_token_scopes_json(&scopes_text)?;
        return Ok(Some(ExternalAgentTokenRecordPayload {
            token_id: row
                .get(0)
                .map_err(|error| format!("读取 external agent token token_id 失败: {error}"))?,
            principal_id: row
                .get(1)
                .map_err(|error| format!("读取 external agent token principal_id 失败: {error}"))?,
            mode: row
                .get(2)
                .map_err(|error| format!("读取 external agent token mode 失败: {error}"))?,
            subject_account_id: row.get(3).map_err(|error| {
                format!("读取 external agent token subject_account_id 失败: {error}")
            })?,
            actions,
            scopes,
            issuer: row
                .get(6)
                .map_err(|error| format!("读取 external agent token issuer 失败: {error}"))?,
            issued_at: row
                .get(7)
                .map_err(|error| format!("读取 external agent token issued_at 失败: {error}"))?,
            expires_at: row
                .get(8)
                .map_err(|error| format!("读取 external agent token expires_at 失败: {error}"))?,
            revoked_at: row
                .get(9)
                .map_err(|error| format!("读取 external agent token revoked_at 失败: {error}"))?,
        }));
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
        .map_err(|error| format!("查询 external agent token 列表失败: {error}"))?;

    let mut rows = statement
        .query(params![normalized_limit])
        .map_err(|error| format!("执行 external agent token 列表查询失败: {error}"))?;
    let mut records = Vec::new();
    while let Some(row) = rows
        .next()
        .map_err(|error| format!("读取 external agent token 列表失败: {error}"))?
    {
        let actions_text: String = row
            .get(4)
            .map_err(|error| format!("读取 external agent token actions 失败: {error}"))?;
        let actions = parse_external_agent_token_actions_json(&actions_text)?;
        let scopes_text: String = row
            .get(5)
            .map_err(|error| format!("读取 external agent token scopes 失败: {error}"))?;
        let scopes = parse_external_agent_token_scopes_json(&scopes_text)?;
        records.push(ExternalAgentTokenRecordPayload {
            token_id: row
                .get(0)
                .map_err(|error| format!("读取 external agent token token_id 失败: {error}"))?,
            principal_id: row
                .get(1)
                .map_err(|error| format!("读取 external agent token principal_id 失败: {error}"))?,
            mode: row
                .get(2)
                .map_err(|error| format!("读取 external agent token mode 失败: {error}"))?,
            subject_account_id: row.get(3).map_err(|error| {
                format!("读取 external agent token subject_account_id 失败: {error}")
            })?,
            actions,
            scopes,
            issuer: row
                .get(6)
                .map_err(|error| format!("读取 external agent token issuer 失败: {error}"))?,
            issued_at: row
                .get(7)
                .map_err(|error| format!("读取 external agent token issued_at 失败: {error}"))?,
            expires_at: row
                .get(8)
                .map_err(|error| format!("读取 external agent token expires_at 失败: {error}"))?,
            revoked_at: row
                .get(9)
                .map_err(|error| format!("读取 external agent token revoked_at 失败: {error}"))?,
        });
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
        return Err(format!("updated_at 格式无效: {updated_at}"));
    }
    conn.execute(
        r#"
        INSERT INTO runtime_kv_store (key, value, updated_at)
        VALUES (?1, ?2, ?3)
        ON CONFLICT(key) DO UPDATE SET
          value = excluded.value,
          updated_at = excluded.updated_at
        "#,
        params![key, value, updated_at],
    )
    .map_err(|error| format!("写入 runtime kv 失败: {error}"))?;
    Ok(())
}

pub fn get_runtime_kv(conn: &Connection, key: &str) -> Result<Option<String>, String> {
    let mut statement = conn
        .prepare(
            r#"
            SELECT value
            FROM runtime_kv_store
            WHERE key = ?1
            LIMIT 1
            "#,
        )
        .map_err(|error| format!("查询 runtime kv 失败: {error}"))?;
    let mut rows = statement
        .query(params![key])
        .map_err(|error| format!("执行 runtime kv 查询失败: {error}"))?;
    if let Some(row) = rows
        .next()
        .map_err(|error| format!("读取 runtime kv 查询结果失败: {error}"))?
    {
        let value: String = row
            .get(0)
            .map_err(|error| format!("读取 runtime kv value 失败: {error}"))?;
        return Ok(Some(value));
    }
    Ok(None)
}

#[cfg(test)]
mod external_agent_token_kv_tests {
    use super::*;

    fn test_conn() -> Connection {
        let conn = Connection::open_in_memory().expect("open in-memory db");
        init_schema(&conn).expect("init schema");
        conn
    }

    fn sample_token() -> ExternalAgentTokenRecordPayload {
        ExternalAgentTokenRecordPayload {
            token_id: "token-1".to_string(),
            principal_id: "principal-1".to_string(),
            mode: "delegated".to_string(),
            subject_account_id: "account-1".to_string(),
            actions: vec!["action.message.send".to_string()],
            scopes: vec![RuntimeExternalAgentActionScope {
                action_id: "action.message.send".to_string(),
                ops: vec!["verify".to_string()],
            }],
            issuer: "local".to_string(),
            issued_at: "2026-05-08T00:00:00Z".to_string(),
            expires_at: "2026-05-09T00:00:00Z".to_string(),
            revoked_at: None,
        }
    }

    #[test]
    fn token_record_read_fails_closed_on_invalid_actions_json() {
        let conn = test_conn();
        upsert_external_agent_token_record(&conn, &sample_token()).expect("insert token");
        conn.execute(
            "UPDATE external_agent_tokens SET actions = ?1 WHERE token_id = ?2",
            params!["not-json", "token-1"],
        )
        .expect("corrupt actions");

        let err = get_external_agent_token_record(&conn, "token-1").expect_err("invalid actions");
        assert!(err.contains("EXTERNAL_AGENT_TOKEN_ACTIONS_JSON_INVALID"));
        let list_err = list_external_agent_token_records(&conn, 10).expect_err("invalid actions");
        assert!(list_err.contains("EXTERNAL_AGENT_TOKEN_ACTIONS_JSON_INVALID"));
    }

    #[test]
    fn token_record_read_fails_closed_on_invalid_scopes_json() {
        let conn = test_conn();
        upsert_external_agent_token_record(&conn, &sample_token()).expect("insert token");
        conn.execute(
            "UPDATE external_agent_tokens SET scopes = ?1 WHERE token_id = ?2",
            params!["not-json", "token-1"],
        )
        .expect("corrupt scopes");

        let err = get_external_agent_token_record(&conn, "token-1").expect_err("invalid scopes");
        assert!(err.contains("EXTERNAL_AGENT_TOKEN_SCOPES_JSON_INVALID"));
        let list_err = list_external_agent_token_records(&conn, 10).expect_err("invalid scopes");
        assert!(list_err.contains("EXTERNAL_AGENT_TOKEN_SCOPES_JSON_INVALID"));
    }

    #[test]
    fn token_record_read_preserves_valid_actions_and_scopes() {
        let conn = test_conn();
        upsert_external_agent_token_record(&conn, &sample_token()).expect("insert token");

        let token = get_external_agent_token_record(&conn, "token-1")
            .expect("read token")
            .expect("token exists");
        assert_eq!(token.actions, vec!["action.message.send"]);
        assert_eq!(token.scopes.len(), 1);
        assert_eq!(token.scopes[0].action_id, "action.message.send");
        assert_eq!(token.scopes[0].ops, vec!["verify"]);

        let tokens = list_external_agent_token_records(&conn, 10).expect("list tokens");
        assert_eq!(tokens.len(), 1);
        assert_eq!(tokens[0].token_id, "token-1");
    }
}
