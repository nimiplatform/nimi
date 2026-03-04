pub fn purge_action_execution_ledger(conn: &Connection, before: &str) -> Result<usize, String> {
    if !validate_rfc3339(before) {
        return Err(format!("before 格式无效: {before}"));
    }
    conn.execute(
        r#"
        DELETE FROM action_execution_ledger
        WHERE occurred_at < ?1
        "#,
        params![before],
    )
    .map_err(|error| format!("清理 action execution ledger 失败: {error}"))
}

pub fn put_action_idempotency_record(
    conn: &Connection,
    record: &RuntimeActionIdempotencyRecordPayload,
) -> Result<(), String> {
    if !validate_rfc3339(&record.occurred_at) {
        return Err(format!("occurred_at 格式无效: {}", record.occurred_at));
    }
    if record.input_digest.trim().is_empty() {
        return Err("input_digest 不能为空".to_string());
    }
    let response_text = serde_json::to_string(&record.response)
        .map_err(|error| format!("序列化 action idempotency response 失败: {error}"))?;
    conn.execute(
        r#"
        INSERT INTO action_idempotency_records (
          principal_id, action_id, idempotency_key, input_digest, response, occurred_at
        )
        VALUES (?1, ?2, ?3, ?4, ?5, ?6)
        ON CONFLICT(principal_id, action_id, idempotency_key) DO UPDATE SET
          input_digest = excluded.input_digest,
          response = excluded.response,
          occurred_at = excluded.occurred_at
        "#,
        params![
            record.principal_id,
            record.action_id,
            record.idempotency_key,
            record.input_digest,
            response_text,
            record.occurred_at
        ],
    )
    .map_err(|error| format!("写入 action idempotency 失败: {error}"))?;
    Ok(())
}

pub fn get_action_idempotency_record(
    conn: &Connection,
    principal_id: &str,
    action_id: &str,
    idempotency_key: &str,
) -> Result<Option<RuntimeActionIdempotencyRecordPayload>, String> {
    let mut statement = conn
        .prepare(
            r#"
            SELECT principal_id, action_id, idempotency_key, input_digest, response, occurred_at
            FROM action_idempotency_records
            WHERE principal_id = ?1
              AND action_id = ?2
              AND idempotency_key = ?3
            LIMIT 1
            "#,
        )
        .map_err(|error| format!("查询 action idempotency 失败: {error}"))?;

    let mut rows = statement
        .query(params![principal_id, action_id, idempotency_key])
        .map_err(|error| format!("执行 action idempotency 查询失败: {error}"))?;
    if let Some(row) = rows
        .next()
        .map_err(|error| format!("读取 action idempotency 查询结果失败: {error}"))?
    {
        let response_text: String = row
            .get(4)
            .map_err(|error| format!("读取 action idempotency response 失败: {error}"))?;
        let response = serde_json::from_str::<serde_json::Value>(&response_text)
            .map_err(|error| format!("解析 action idempotency response 失败: {error}"))?;
        return Ok(Some(RuntimeActionIdempotencyRecordPayload {
            principal_id: row
                .get(0)
                .map_err(|error| format!("读取 action idempotency principal_id 失败: {error}"))?,
            action_id: row
                .get(1)
                .map_err(|error| format!("读取 action idempotency action_id 失败: {error}"))?,
            idempotency_key: row
                .get(2)
                .map_err(|error| format!("读取 action idempotency key 失败: {error}"))?,
            input_digest: row
                .get(3)
                .map_err(|error| format!("读取 action idempotency input_digest 失败: {error}"))?,
            response,
            occurred_at: row
                .get(5)
                .map_err(|error| format!("读取 action idempotency occurred_at 失败: {error}"))?,
        }));
    }
    Ok(None)
}

pub fn purge_action_idempotency_records(conn: &Connection, before: &str) -> Result<usize, String> {
    if !validate_rfc3339(before) {
        return Err(format!("before 格式无效: {before}"));
    }
    conn.execute(
        r#"
        DELETE FROM action_idempotency_records
        WHERE occurred_at < ?1
        "#,
        params![before],
    )
    .map_err(|error| format!("清理 action idempotency 失败: {error}"))
}

pub fn put_action_verify_ticket(
    conn: &Connection,
    ticket: &RuntimeActionVerifyTicketPayload,
) -> Result<(), String> {
    if !validate_rfc3339(&ticket.issued_at) {
        return Err(format!("issued_at 格式无效: {}", ticket.issued_at));
    }
    if !validate_rfc3339(&ticket.expires_at) {
        return Err(format!("expires_at 格式无效: {}", ticket.expires_at));
    }
    if ticket.ticket_id.trim().is_empty() {
        return Err("ticket_id 不能为空".to_string());
    }
    if ticket.principal_id.trim().is_empty() || ticket.action_id.trim().is_empty() {
        return Err("principal_id/action_id 不能为空".to_string());
    }
    if ticket.trace_id.trim().is_empty() || ticket.input_digest.trim().is_empty() {
        return Err("trace_id/input_digest 不能为空".to_string());
    }
    conn.execute(
        r#"
        INSERT INTO action_verify_tickets (
          ticket_id, principal_id, action_id, trace_id, input_digest, issued_at, expires_at
        )
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
        ON CONFLICT(ticket_id) DO UPDATE SET
          principal_id = excluded.principal_id,
          action_id = excluded.action_id,
          trace_id = excluded.trace_id,
          input_digest = excluded.input_digest,
          issued_at = excluded.issued_at,
          expires_at = excluded.expires_at
        "#,
        params![
            ticket.ticket_id,
            ticket.principal_id,
            ticket.action_id,
            ticket.trace_id,
            ticket.input_digest,
            ticket.issued_at,
            ticket.expires_at
        ],
    )
    .map_err(|error| format!("写入 action verify ticket 失败: {error}"))?;
    Ok(())
}

pub fn get_action_verify_ticket(
    conn: &Connection,
    ticket_id: &str,
) -> Result<Option<RuntimeActionVerifyTicketPayload>, String> {
    let mut statement = conn
        .prepare(
            r#"
            SELECT ticket_id, principal_id, action_id, trace_id, input_digest, issued_at, expires_at
            FROM action_verify_tickets
            WHERE ticket_id = ?1
            LIMIT 1
            "#,
        )
        .map_err(|error| format!("查询 action verify ticket 失败: {error}"))?;

    let mut rows = statement
        .query(params![ticket_id])
        .map_err(|error| format!("执行 action verify ticket 查询失败: {error}"))?;

    if let Some(row) = rows
        .next()
        .map_err(|error| format!("读取 action verify ticket 查询结果失败: {error}"))?
    {
        return Ok(Some(RuntimeActionVerifyTicketPayload {
            ticket_id: row
                .get(0)
                .map_err(|error| format!("读取 ticket_id 失败: {error}"))?,
            principal_id: row
                .get(1)
                .map_err(|error| format!("读取 principal_id 失败: {error}"))?,
            action_id: row
                .get(2)
                .map_err(|error| format!("读取 action_id 失败: {error}"))?,
            trace_id: row
                .get(3)
                .map_err(|error| format!("读取 trace_id 失败: {error}"))?,
            input_digest: row
                .get(4)
                .map_err(|error| format!("读取 input_digest 失败: {error}"))?,
            issued_at: row
                .get(5)
                .map_err(|error| format!("读取 issued_at 失败: {error}"))?,
            expires_at: row
                .get(6)
                .map_err(|error| format!("读取 expires_at 失败: {error}"))?,
        }));
    }
    Ok(None)
}

pub fn delete_action_verify_ticket(conn: &Connection, ticket_id: &str) -> Result<usize, String> {
    conn.execute(
        r#"
        DELETE FROM action_verify_tickets
        WHERE ticket_id = ?1
        "#,
        params![ticket_id],
    )
    .map_err(|error| format!("删除 action verify ticket 失败: {error}"))
}

pub fn purge_action_verify_tickets(conn: &Connection, before: &str) -> Result<usize, String> {
    if !validate_rfc3339(before) {
        return Err(format!("before 格式无效: {before}"));
    }
    conn.execute(
        r#"
        DELETE FROM action_verify_tickets
        WHERE expires_at < ?1
        "#,
        params![before],
    )
    .map_err(|error| format!("清理 action verify tickets 失败: {error}"))
}

