pub fn append_runtime_audit(
    conn: &Connection,
    record: &RuntimeAuditRecordPayload,
) -> Result<(), String> {
    if !validate_rfc3339(&record.occurred_at) {
        return Err(format!("occurred_at 格式无效: {}", record.occurred_at));
    }

    let reason_codes_text = record
        .reason_codes
        .as_ref()
        .map(|items| serde_json::to_string(items).unwrap_or_else(|_| "[]".to_string()));
    let payload_text = record
        .payload
        .as_ref()
        .map(|value| serde_json::to_string(value).unwrap_or_else(|_| "{}".to_string()));

    conn.execute(
        r#"
        INSERT INTO runtime_audit_records (
          id, mod_id, stage, event_type, decision, reason_codes, payload, occurred_at
        )
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
        "#,
        params![
            record.id,
            record.mod_id,
            record.stage,
            record.event_type,
            record.decision,
            reason_codes_text,
            payload_text,
            record.occurred_at
        ],
    )
    .map_err(|error| format!("写入 runtime audit 失败: {error}"))?;
    Ok(())
}

pub fn query_runtime_audit(
    conn: &Connection,
    filter: Option<RuntimeAuditFilter>,
) -> Result<Vec<RuntimeAuditRecordPayload>, String> {
    let normalized = filter.unwrap_or(RuntimeAuditFilter {
        mod_id: None,
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
            SELECT id, mod_id, stage, event_type, decision, reason_codes, payload, occurred_at
            FROM runtime_audit_records
            WHERE (?1 IS NULL OR mod_id = ?1)
              AND (?2 IS NULL OR stage = ?2)
              AND (?3 IS NULL OR event_type = ?3)
              AND (?4 IS NULL OR occurred_at >= ?4)
              AND (?5 IS NULL OR occurred_at <= ?5)
            ORDER BY occurred_at DESC
            LIMIT ?6
            "#,
        )
        .map_err(|error| format!("查询 runtime audit 失败: {error}"))?;

    let rows = statement
        .query_map(
            params![
                normalized.mod_id,
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
                    mod_id: row.get(1)?,
                    stage: row.get(2)?,
                    event_type: row.get(3)?,
                    decision: row.get(4)?,
                    reason_codes,
                    payload,
                    occurred_at: row.get(7)?,
                })
            },
        )
        .map_err(|error| format!("解析 runtime audit 失败: {error}"))?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("收集 runtime audit 失败: {error}"))
}

#[cfg(test)]
mod runtime_audit_ledger_tests {
    use super::*;

    fn test_record(id: &str, decision: &str) -> RuntimeAuditRecordPayload {
        RuntimeAuditRecordPayload {
            id: id.to_string(),
            mod_id: Some("mod.codegen".to_string()),
            stage: Some("preflight".to_string()),
            event_type: "runtime_mod_preflight".to_string(),
            decision: Some(decision.to_string()),
            reason_codes: Some(vec!["TEST".to_string()]),
            payload: None,
            occurred_at: "2026-05-07T00:00:00Z".to_string(),
        }
    }

    #[test]
    fn append_runtime_audit_is_append_only_for_existing_ids() {
        let conn = Connection::open_in_memory().expect("open in-memory db");
        init_schema(&conn).expect("init schema");

        append_runtime_audit(&conn, &test_record("audit-1", "ALLOW")).expect("append audit");
        let duplicate = append_runtime_audit(&conn, &test_record("audit-1", "DENY"));

        assert!(duplicate.is_err());
        let records = query_runtime_audit(&conn, None).expect("query audit");
        assert_eq!(records.len(), 1);
        assert_eq!(records[0].decision.as_deref(), Some("ALLOW"));
    }
}

pub fn put_action_execution_ledger_record(
    conn: &Connection,
    record: &RuntimeActionExecutionLedgerRecordPayload,
) -> Result<(), String> {
    if !validate_rfc3339(&record.occurred_at) {
        return Err(format!("occurred_at 格式无效: {}", record.occurred_at));
    }
    if record.execution_id.trim().is_empty()
        || record.action_id.trim().is_empty()
        || record.principal_id.trim().is_empty()
        || record.phase.trim().is_empty()
        || record.status.trim().is_empty()
        || record.trace_id.trim().is_empty()
    {
        return Err("execution/action/principal/phase/status/trace 不能为空".to_string());
    }
    let payload_text = record
        .payload
        .as_ref()
        .map(|value| serde_json::to_string(value).unwrap_or_else(|_| "{}".to_string()));
    conn.execute(
        r#"
        INSERT INTO action_execution_ledger (
          ledger_id, execution_id, action_id, principal_id, phase, status, trace_id, reason_code, payload, occurred_at
        )
        VALUES (lower(hex(randomblob(16))), ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
        "#,
        params![
            record.execution_id,
            record.action_id,
            record.principal_id,
            record.phase,
            record.status,
            record.trace_id,
            record.reason_code,
            payload_text,
            record.occurred_at
        ],
    )
    .map_err(|error| format!("写入 action execution ledger 失败: {error}"))?;
    Ok(())
}

pub fn query_action_execution_ledger(
    conn: &Connection,
    filter: Option<RuntimeActionExecutionLedgerFilter>,
) -> Result<Vec<RuntimeActionExecutionLedgerRecordPayload>, String> {
    let normalized = filter.unwrap_or(RuntimeActionExecutionLedgerFilter {
        action_id: None,
        principal_id: None,
        phase: None,
        status: None,
        trace_id: None,
        from: None,
        to: None,
        limit: Some(200),
    });
    let limit = normalized.limit.unwrap_or(200).clamp(1, 2000) as i64;
    let mut statement = conn
        .prepare(
            r#"
            SELECT execution_id, action_id, principal_id, phase, status, trace_id, reason_code, payload, occurred_at
            FROM action_execution_ledger
            WHERE (?1 IS NULL OR action_id = ?1)
              AND (?2 IS NULL OR principal_id = ?2)
              AND (?3 IS NULL OR phase = ?3)
              AND (?4 IS NULL OR status = ?4)
              AND (?5 IS NULL OR trace_id = ?5)
              AND (?6 IS NULL OR occurred_at >= ?6)
              AND (?7 IS NULL OR occurred_at <= ?7)
            ORDER BY occurred_at DESC
            LIMIT ?8
            "#,
        )
        .map_err(|error| format!("查询 action execution ledger 失败: {error}"))?;

    let rows = statement
        .query_map(
            params![
                normalized.action_id,
                normalized.principal_id,
                normalized.phase,
                normalized.status,
                normalized.trace_id,
                normalized.from,
                normalized.to,
                limit
            ],
            |row| {
                let payload_text: Option<String> = row.get(7)?;
                let payload = payload_text
                    .and_then(|text| serde_json::from_str::<serde_json::Value>(&text).ok());
                Ok(RuntimeActionExecutionLedgerRecordPayload {
                    execution_id: row.get(0)?,
                    action_id: row.get(1)?,
                    principal_id: row.get(2)?,
                    phase: row.get(3)?,
                    status: row.get(4)?,
                    trace_id: row.get(5)?,
                    reason_code: row.get(6)?,
                    payload,
                    occurred_at: row.get(8)?,
                })
            },
        )
        .map_err(|error| format!("解析 action execution ledger 失败: {error}"))?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("收集 action execution ledger 失败: {error}"))
}
