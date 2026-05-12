use std::collections::HashSet;

use rusqlite::Connection;

/// Schema v19: add `orthodontic_checkins.checkinAt` so PO-ORTHO-008 can anchor
/// per-cycle compliance math on the actual moment the event occurred, not the
/// 00:00 UTC of `checkinDate`.
///
/// `checkinAt` is a nullable ISO 8601 datetime. Existing rows persisted under
/// v9..v18 stay at NULL; the cycle-anchor consumer (`orthodontic-derive.ts`)
/// falls back to `checkinDate` at 00:00 UTC for those rows, matching legacy
/// behavior. New rows written via `insert_orthodontic_checkin` MUST supply a
/// `checkinAt` value (the command layer enforces a UTC-date-match with
/// `checkinDate`).
///
/// Idempotent: probes `PRAGMA table_info(orthodontic_checkins)` and skips the
/// ADD COLUMN when the column is already present. Safe under
/// `repair_missing_tables` replay.
pub(super) fn apply_v19(conn: &Connection) -> Result<(), String> {
    if !orthodontic_checkins_table_exists(conn)? {
        return Ok(());
    }
    let existing = existing_orthodontic_checkins_columns(conn)?;
    if existing.contains("checkinAt") {
        return Ok(());
    }
    conn.execute_batch("ALTER TABLE orthodontic_checkins ADD COLUMN checkinAt TEXT;")
        .map_err(|e| format!("migration v19 add orthodontic_checkins.checkinAt failed: {e}"))?;
    Ok(())
}

fn orthodontic_checkins_table_exists(conn: &Connection) -> Result<bool, String> {
    conn.query_row(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='orthodontic_checkins'",
        [],
        |_| Ok(true),
    )
    .or_else(|err| match err {
        rusqlite::Error::QueryReturnedNoRows => Ok(false),
        _ => Err(format!(
            "migration v19 check orthodontic_checkins exists failed: {err}"
        )),
    })
}

fn existing_orthodontic_checkins_columns(conn: &Connection) -> Result<HashSet<String>, String> {
    let mut stmt = conn
        .prepare("PRAGMA table_info(orthodontic_checkins)")
        .map_err(|e| format!("migration v19 prepare table_info failed: {e}"))?;
    let rows = stmt
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|e| format!("migration v19 query table_info failed: {e}"))?;
    let mut out = HashSet::new();
    for row in rows {
        out.insert(row.map_err(|e| format!("migration v19 read column name failed: {e}"))?);
    }
    Ok(out)
}
