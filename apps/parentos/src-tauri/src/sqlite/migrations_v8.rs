use rusqlite::Connection;

pub(super) fn apply_v8(conn: &Connection) -> Result<(), String> {
    // Add outdoorGoalMinutes column to children table
    add_column_if_missing(
        conn,
        "children",
        "outdoorGoalMinutes",
        "ALTER TABLE children ADD COLUMN outdoorGoalMinutes INTEGER;",
    )?;

    // Create outdoor_records table
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS outdoor_records (
            recordId TEXT PRIMARY KEY NOT NULL,
            childId TEXT NOT NULL REFERENCES children(childId) ON DELETE CASCADE,
            activityDate TEXT NOT NULL,
            durationMinutes INTEGER NOT NULL,
            note TEXT,
            createdAt TEXT NOT NULL,
            updatedAt TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_outdoor_records_child_date
            ON outdoor_records (childId, activityDate);
        CREATE INDEX IF NOT EXISTS idx_outdoor_records_child_created
            ON outdoor_records (childId, createdAt);",
    )
    .map_err(|e| format!("migration v8 outdoor_records: {e}"))?;

    Ok(())
}

fn has_column(conn: &Connection, table: &str, column: &str) -> Result<bool, String> {
    let pragma = format!("PRAGMA table_info({table})");
    let mut stmt = conn
        .prepare(&pragma)
        .map_err(|e| format!("migration v8 prepare table_info({table}): {e}"))?;
    let rows = stmt
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|e| format!("migration v8 query table_info({table}): {e}"))?;

    for row in rows {
        let name = row.map_err(|e| format!("migration v8 read table_info({table}): {e}"))?;
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
        .map_err(|e| format!("migration v8 add column {table}.{column} failed: {e}"))
}
