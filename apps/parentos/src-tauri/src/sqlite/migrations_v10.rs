use std::collections::HashSet;

use rusqlite::Connection;

/// Schema v10: introduce per-kind progression timestamp columns on
/// `reminder_states` per `reminder-interaction-contract.md#PO-REMI-004`.
///
/// Adds 8 new columns scoped by reminder `kind`:
///
/// - `acknowledgedAt`             — guide-kind terminal signal
/// - `reflectedAt`                — guide-kind optional reflection marker
/// - `practiceStartedAt`          — practice-kind entry signal
/// - `practiceLastAt`             — practice-kind most recent log_practice event
/// - `practiceCount`              — monotonic practice engagement count (INTEGER NOT NULL DEFAULT 0)
/// - `practiceHabituatedAt`       — practice-kind terminal habituation marker
/// - `consultedAt`                — consult-kind terminal signal; written by advisor on AI first reply (PO-REMI-007)
/// - `consultationConversationId` — FK to ai_conversations.conversationId; paired atomically with consultedAt
///
/// Plus an index on (childId, consultationConversationId) so the advisor writeback can
/// locate the owning reminder_states row quickly.
///
/// Idempotency: each ALTER is guarded by a `PRAGMA table_info(reminder_states)` probe
/// so repair replays do not fail on pre-stamped databases. `CREATE INDEX IF NOT EXISTS`
/// is inherently idempotent.
///
/// Literal ALTER strings are kept here rather than constructed at runtime so that the
/// spec-consistency check (scripts/check-parentos-spec-consistency.ts) can scan this
/// source file and confirm every local-storage.yaml column has a matching migration.
pub(super) fn apply_v10(conn: &Connection) -> Result<(), String> {
    add_progression_columns(conn)?;
    create_consultation_index(conn)?;
    Ok(())
}

const ADD_COLUMN_STATEMENTS: &[(&str, &str)] = &[
    (
        "acknowledgedAt",
        "ALTER TABLE reminder_states ADD COLUMN acknowledgedAt TEXT",
    ),
    (
        "reflectedAt",
        "ALTER TABLE reminder_states ADD COLUMN reflectedAt TEXT",
    ),
    (
        "practiceStartedAt",
        "ALTER TABLE reminder_states ADD COLUMN practiceStartedAt TEXT",
    ),
    (
        "practiceLastAt",
        "ALTER TABLE reminder_states ADD COLUMN practiceLastAt TEXT",
    ),
    (
        "practiceCount",
        "ALTER TABLE reminder_states ADD COLUMN practiceCount INTEGER NOT NULL DEFAULT 0",
    ),
    (
        "practiceHabituatedAt",
        "ALTER TABLE reminder_states ADD COLUMN practiceHabituatedAt TEXT",
    ),
    (
        "consultedAt",
        "ALTER TABLE reminder_states ADD COLUMN consultedAt TEXT",
    ),
    (
        "consultationConversationId",
        "ALTER TABLE reminder_states ADD COLUMN consultationConversationId TEXT",
    ),
];

fn add_progression_columns(conn: &Connection) -> Result<(), String> {
    let existing = existing_reminder_states_columns(conn)?;
    for (column, sql) in ADD_COLUMN_STATEMENTS {
        if existing.contains(*column) {
            continue;
        }
        conn.execute(sql, []).map_err(|e| {
            format!("migration v10 add reminder_states.{column} failed: {e}")
        })?;
    }
    Ok(())
}

fn create_consultation_index(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "CREATE INDEX IF NOT EXISTS idx_reminder_states_child_conversation
            ON reminder_states (childId, consultationConversationId);",
    )
    .map_err(|e| format!("migration v10 create consultation index failed: {e}"))
}

fn existing_reminder_states_columns(conn: &Connection) -> Result<HashSet<String>, String> {
    let mut stmt = conn
        .prepare("PRAGMA table_info(reminder_states)")
        .map_err(|e| format!("migration v10 prepare table_info failed: {e}"))?;
    let rows = stmt
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|e| format!("migration v10 query table_info failed: {e}"))?;
    let mut out = HashSet::new();
    for row in rows {
        out.insert(row.map_err(|e| format!("migration v10 read column name failed: {e}"))?);
    }
    Ok(out)
}
