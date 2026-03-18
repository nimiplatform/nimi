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
        let actions = serde_json::from_str::<Vec<String>>(&actions_text).unwrap_or_default();
        let scopes_text: String = row
            .get(5)
            .map_err(|error| format!("读取 external agent token scopes 失败: {error}"))?;
        let scopes = serde_json::from_str::<Vec<RuntimeExternalAgentActionScope>>(&scopes_text)
            .unwrap_or_default();
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

    let rows = statement
        .query_map(params![normalized_limit], |row| {
            let actions_text: String = row.get(4)?;
            let actions = serde_json::from_str::<Vec<String>>(&actions_text).unwrap_or_default();
            let scopes_text: String = row.get(5)?;
            let scopes = serde_json::from_str::<Vec<RuntimeExternalAgentActionScope>>(&scopes_text)
                .unwrap_or_default();
            Ok(ExternalAgentTokenRecordPayload {
                token_id: row.get(0)?,
                principal_id: row.get(1)?,
                mode: row.get(2)?,
                subject_account_id: row.get(3)?,
                actions,
                scopes,
                issuer: row.get(6)?,
                issued_at: row.get(7)?,
                expires_at: row.get(8)?,
                revoked_at: row.get(9)?,
            })
        })
        .map_err(|error| format!("解析 external agent token 列表失败: {error}"))?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("收集 external agent token 列表失败: {error}"))
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
