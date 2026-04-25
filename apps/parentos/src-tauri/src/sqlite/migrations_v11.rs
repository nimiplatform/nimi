use std::collections::HashSet;

use rusqlite::Connection;

/// Schema v11: extend `custom_todos` with recurrence + reminder fields so
/// user-created todos can repeat and surface in-app reminders.
///
/// Adds two nullable columns:
///
/// - `recurrenceRule`          TEXT — JSON blob encoding the repeat rule
///                             (`{"preset":"daily"|"weekly"|"monthly"|"yearly"|"custom","interval":n,"unit":"day|week|month|year","weekdays":[0..6]}`)
/// - `reminderOffsetMinutes`   INTEGER — minutes before `dueDate` to raise an in-app reminder
///
/// Idempotency: each ALTER is guarded by a `PRAGMA table_info(custom_todos)` probe
/// so repair replays do not fail on pre-stamped databases.
///
/// Literal ALTER strings are kept here rather than constructed at runtime so that the
/// spec-consistency check can scan this source file and confirm every local-storage.yaml
/// column has a matching migration.
pub(super) fn apply_v11(conn: &Connection) -> Result<(), String> {
    // `custom_todos` is created by migration v6. On a broken-install repair path the
    // stamped schema version can jump over v6, so the table may not yet exist here;
    // `repair_missing_tables` will call us again after v6 has (idempotently) created
    // it. Skip the ALTER in that case.
    if !custom_todos_table_exists(conn)? {
        return Ok(());
    }
    let existing = existing_custom_todos_columns(conn)?;
    for (column, sql) in ADD_COLUMN_STATEMENTS {
        if existing.contains(*column) {
            continue;
        }
        conn.execute(sql, [])
            .map_err(|e| format!("migration v11 add custom_todos.{column} failed: {e}"))?;
    }
    Ok(())
}

fn custom_todos_table_exists(conn: &Connection) -> Result<bool, String> {
    conn.query_row(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='custom_todos'",
        [],
        |_| Ok(true),
    )
    .or_else(|err| match err {
        rusqlite::Error::QueryReturnedNoRows => Ok(false),
        _ => Err(format!("migration v11 check custom_todos exists failed: {err}")),
    })
}

const ADD_COLUMN_STATEMENTS: &[(&str, &str)] = &[
    (
        "recurrenceRule",
        "ALTER TABLE custom_todos ADD COLUMN recurrenceRule TEXT",
    ),
    (
        "reminderOffsetMinutes",
        "ALTER TABLE custom_todos ADD COLUMN reminderOffsetMinutes INTEGER",
    ),
];

fn existing_custom_todos_columns(conn: &Connection) -> Result<HashSet<String>, String> {
    let mut stmt = conn
        .prepare("PRAGMA table_info(custom_todos)")
        .map_err(|e| format!("migration v11 prepare table_info failed: {e}"))?;
    let rows = stmt
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|e| format!("migration v11 query table_info failed: {e}"))?;
    let mut out = HashSet::new();
    for row in rows {
        out.insert(row.map_err(|e| format!("migration v11 read column name failed: {e}"))?);
    }
    Ok(out)
}
