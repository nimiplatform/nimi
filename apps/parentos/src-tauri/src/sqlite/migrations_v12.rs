use rusqlite::Connection;

/// Schema v12: introduce `vision_followup_settings` for the per-child vision
/// follow-up cadence configured under /profile/vision.
///
/// The table is keyed by `childId` (one row per child), with `cadenceMonths`
/// storing the recurring cadence and `customNextDate` overriding ONLY the
/// next visit. Absence of a row = system-recommended default cadence.
///
/// Cascade-on-delete with `children` keeps the row count bounded with the
/// child profile lifecycle.
///
/// Idempotency: the entire migration is `CREATE TABLE IF NOT EXISTS`, so it
/// is safe for `repair_missing_tables` to replay on every boot.
pub(super) fn apply_v12(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(VISION_FOLLOWUP_SETTINGS_SQL)
        .map_err(|e| format!("migration v12 create vision_followup_settings failed: {e}"))?;
    Ok(())
}

const VISION_FOLLOWUP_SETTINGS_SQL: &str = "
    CREATE TABLE IF NOT EXISTS vision_followup_settings (
        childId        TEXT PRIMARY KEY REFERENCES children(childId) ON DELETE CASCADE,
        cadenceMonths  INTEGER NOT NULL DEFAULT 3,
        customNextDate TEXT,
        createdAt      TEXT NOT NULL,
        updatedAt      TEXT NOT NULL
    );
";
