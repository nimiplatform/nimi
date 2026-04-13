use std::collections::HashMap;

use rusqlite::{params, Connection};
use serde::Deserialize;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReminderRuleCatalog {
    rules: Vec<ReminderRulePriorityRecord>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReminderRulePriorityRecord {
    rule_id: String,
    priority: String,
}

pub(super) fn apply_v3(conn: &Connection) -> Result<(), String> {
    add_column_if_missing(
        conn,
        "reminder_states",
        "snoozedUntil",
        "ALTER TABLE reminder_states ADD COLUMN snoozedUntil TEXT;",
    )?;
    add_column_if_missing(
        conn,
        "reminder_states",
        "scheduledDate",
        "ALTER TABLE reminder_states ADD COLUMN scheduledDate TEXT;",
    )?;
    add_column_if_missing(
        conn,
        "reminder_states",
        "notApplicable",
        "ALTER TABLE reminder_states ADD COLUMN notApplicable INTEGER NOT NULL DEFAULT 0;",
    )?;
    add_column_if_missing(
        conn,
        "reminder_states",
        "plannedForDate",
        "ALTER TABLE reminder_states ADD COLUMN plannedForDate TEXT;",
    )?;
    add_column_if_missing(
        conn,
        "reminder_states",
        "surfaceRank",
        "ALTER TABLE reminder_states ADD COLUMN surfaceRank INTEGER;",
    )?;
    add_column_if_missing(
        conn,
        "reminder_states",
        "lastSurfacedAt",
        "ALTER TABLE reminder_states ADD COLUMN lastSurfacedAt TEXT;",
    )?;
    add_column_if_missing(
        conn,
        "reminder_states",
        "surfaceCount",
        "ALTER TABLE reminder_states ADD COLUMN surfaceCount INTEGER NOT NULL DEFAULT 0;",
    )?;

    conn.execute_batch(
        r#"
        CREATE INDEX IF NOT EXISTS idx_reminder_child_plan ON reminder_states (childId, plannedForDate, surfaceRank);
        CREATE INDEX IF NOT EXISTS idx_reminder_child_snooze ON reminder_states (childId, snoozedUntil);
        CREATE INDEX IF NOT EXISTS idx_reminder_child_schedule ON reminder_states (childId, scheduledDate);
        "#,
    )
    .map_err(|e| format!("migration v3 indexes failed: {e}"))?;

    migrate_dismissed_reminder_states(conn)
}

fn migrate_dismissed_reminder_states(conn: &Connection) -> Result<(), String> {
    let priority_by_rule = load_reminder_rule_priorities()?;

    let mut stmt = conn
        .prepare("SELECT stateId, ruleId FROM reminder_states WHERE status = 'dismissed'")
        .map_err(|e| format!("migration v3 prepare dismissed reminder rows failed: {e}"))?;
    let rows = stmt
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|e| format!("migration v3 query dismissed reminder rows failed: {e}"))?;

    for row in rows {
        let (state_id, rule_id) =
            row.map_err(|e| format!("migration v3 read dismissed reminder row failed: {e}"))?;
        let priority = priority_by_rule.get(&rule_id).map(String::as_str).ok_or_else(|| {
            format!(
                "migration v3: dismissed reminder_state references unknown ruleId '{rule_id}' (stateId={state_id})"
            )
        })?;
        if matches!(priority, "P0" | "P1") {
            conn.execute(
                "UPDATE reminder_states SET status = 'active', snoozedUntil = date('now', '+14 day'), dismissReason = NULL, dismissedAt = NULL, updatedAt = datetime('now') WHERE stateId = ?1",
                params![state_id],
            )
            .map_err(|e| format!("migration v3 migrate dismissed->snoozed for {rule_id} failed: {e}"))?;
        } else {
            conn.execute(
                "UPDATE reminder_states SET status = 'active', notApplicable = 1, dismissReason = NULL, dismissedAt = NULL, updatedAt = datetime('now') WHERE stateId = ?1",
                params![state_id],
            )
            .map_err(|e| format!("migration v3 migrate dismissed->notApplicable for {rule_id} failed: {e}"))?;
        }
    }

    Ok(())
}

fn load_reminder_rule_priorities() -> Result<HashMap<String, String>, String> {
    let catalog: ReminderRuleCatalog = serde_yaml::from_str(include_str!(
        "../../../spec/kernel/tables/reminder-rules.yaml",
    ))
    .map_err(|e| format!("migration v3 parse reminder-rules.yaml failed: {e}"))?;

    Ok(catalog
        .rules
        .into_iter()
        .map(|rule| (rule.rule_id, rule.priority))
        .collect())
}

fn has_column(conn: &Connection, table: &str, column: &str) -> Result<bool, String> {
    let pragma = format!("PRAGMA table_info({table})");
    let mut stmt = conn
        .prepare(&pragma)
        .map_err(|e| format!("migration v3 prepare table_info({table}): {e}"))?;
    let rows = stmt
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|e| format!("migration v3 query table_info({table}): {e}"))?;

    for row in rows {
        let name = row.map_err(|e| format!("migration v3 read table_info({table}): {e}"))?;
        if name == column {
            return Ok(true);
        }
    }

    Ok(false)
}

fn add_column_if_missing(
    conn: &Connection,
    table: &str,
    column: &str,
    ddl: &str,
) -> Result<(), String> {
    if has_column(conn, table, column)? {
        return Ok(());
    }

    conn.execute_batch(ddl)
        .map_err(|e| format!("migration v3 add column {table}.{column} failed: {e}"))
}
