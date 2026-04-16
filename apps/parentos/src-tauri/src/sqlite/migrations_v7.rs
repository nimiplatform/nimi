use rusqlite::Connection;

pub(super) fn apply_v7(conn: &Connection) -> Result<(), String> {
    add_column_if_missing(
        conn,
        "journal_entries",
        "keepsakeTitle",
        "ALTER TABLE journal_entries ADD COLUMN keepsakeTitle TEXT;",
    )?;
    add_column_if_missing(
        conn,
        "journal_entries",
        "keepsakeReason",
        "ALTER TABLE journal_entries ADD COLUMN keepsakeReason TEXT;",
    )?;

    Ok(())
}

fn has_column(conn: &Connection, table: &str, column: &str) -> Result<bool, String> {
    let pragma = format!("PRAGMA table_info({table})");
    let mut stmt = conn
        .prepare(&pragma)
        .map_err(|e| format!("migration v7 prepare table_info({table}): {e}"))?;
    let rows = stmt
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|e| format!("migration v7 query table_info({table}): {e}"))?;

    for row in rows {
        let name = row.map_err(|e| format!("migration v7 read table_info({table}): {e}"))?;
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
        .map_err(|e| format!("migration v7 add column {table}.{column} failed: {e}"))
}
