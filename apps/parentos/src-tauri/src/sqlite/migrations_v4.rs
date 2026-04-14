use rusqlite::Connection;

/// v4: ensure sleep_records table exists for databases created before it was
/// added to the V1 schema.
pub(super) fn apply_v4(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS sleep_records (
            recordId        TEXT PRIMARY KEY NOT NULL,
            childId         TEXT NOT NULL REFERENCES children(childId) ON DELETE CASCADE,
            sleepDate       TEXT NOT NULL,
            bedtime         TEXT,
            wakeTime        TEXT,
            durationMinutes INTEGER,
            napCount        INTEGER,
            napMinutes      INTEGER,
            quality         TEXT,
            ageMonths       INTEGER NOT NULL,
            notes           TEXT,
            createdAt       TEXT NOT NULL,
            UNIQUE (childId, sleepDate)
        );
        CREATE INDEX IF NOT EXISTS idx_sleep_child_age ON sleep_records (childId, ageMonths);
        "#,
    )
    .map_err(|e| format!("migration v4 failed: {e}"))
}
