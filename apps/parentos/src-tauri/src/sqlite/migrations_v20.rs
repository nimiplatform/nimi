use std::collections::HashSet;

use rusqlite::Connection;

/// Schema v20: add the four per-appliance fields introduced by the multi-
/// appliance orthodontic surface — `currentPhase` / `phaseStartedAt`
/// (PO-ORTHO-013), `activationIntervalDays` (PO-ORTHO-014), and
/// `nextReviewAgenda` (PO-ORTHO-015) — to `orthodontic_appliances`.
///
/// All four are nullable. Existing rows persisted under v9..v19 stay at NULL,
/// which the renderer treats as the admitted "not yet set" intermediate state
/// (PO-ORTHO-013); there is no backfill.
///
/// Idempotent: probes `PRAGMA table_info(orthodontic_appliances)` and only
/// adds columns that are not already present. Safe under
/// `repair_missing_tables` replay.
pub(super) fn apply_v20(conn: &Connection) -> Result<(), String> {
    if !orthodontic_appliances_table_exists(conn)? {
        return Ok(());
    }
    let existing = existing_orthodontic_appliances_columns(conn)?;
    for (column, ddl) in [
        ("currentPhase", "ALTER TABLE orthodontic_appliances ADD COLUMN currentPhase TEXT;"),
        ("phaseStartedAt", "ALTER TABLE orthodontic_appliances ADD COLUMN phaseStartedAt TEXT;"),
        ("activationIntervalDays", "ALTER TABLE orthodontic_appliances ADD COLUMN activationIntervalDays INTEGER;"),
        ("nextReviewAgenda", "ALTER TABLE orthodontic_appliances ADD COLUMN nextReviewAgenda TEXT;"),
    ] {
        if existing.contains(column) {
            continue;
        }
        conn.execute_batch(ddl)
            .map_err(|e| format!("migration v20 add orthodontic_appliances.{column} failed: {e}"))?;
    }
    Ok(())
}

fn orthodontic_appliances_table_exists(conn: &Connection) -> Result<bool, String> {
    conn.query_row(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='orthodontic_appliances'",
        [],
        |_| Ok(true),
    )
    .or_else(|err| match err {
        rusqlite::Error::QueryReturnedNoRows => Ok(false),
        _ => Err(format!(
            "migration v20 check orthodontic_appliances exists failed: {err}"
        )),
    })
}

fn existing_orthodontic_appliances_columns(conn: &Connection) -> Result<HashSet<String>, String> {
    let mut stmt = conn
        .prepare("PRAGMA table_info(orthodontic_appliances)")
        .map_err(|e| format!("migration v20 prepare table_info failed: {e}"))?;
    let rows = stmt
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|e| format!("migration v20 query table_info failed: {e}"))?;
    let mut out = HashSet::new();
    for row in rows {
        out.insert(row.map_err(|e| format!("migration v20 read column name failed: {e}"))?);
    }
    Ok(out)
}
