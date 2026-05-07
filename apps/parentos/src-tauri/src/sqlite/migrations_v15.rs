use std::collections::HashSet;

use rusqlite::Connection;

/// Schema v15: cut over from the legacy `wear-daily` / `retention-wear` daily
/// checkin model to the new wear-gap interval stream defined by
/// `orthodontic-contract.md#PO-ORTHO-005a`.
///
/// Three independent steps, each idempotent:
///
/// 1. **Create `orthodontic_unwear_intervals`** — one row per "未戴时段". A
///    partial unique index (`endAt IS NULL`) enforces "at most one open
///    interval per applianceId" at the storage layer; the command layer also
///    enforces this on insert (PO-ORTHO-005a).
/// 2. **Drop legacy `orthodontic_checkins` rows** with `checkinType IN ('wear-daily', 'retention-wear')`.
///    Pre-launch cutover; no data is preserved (PO-ORTHO-005b).
/// 3. **Drop legacy columns** `actualWearHours`, `prescribedHours`,
///    `complianceBucket` from `orthodontic_checkins`. SQLite 3.35+ supports
///    `ALTER TABLE ... DROP COLUMN`; rusqlite ships SQLite 3.40+. Each DROP is
///    guarded by a `PRAGMA table_info` probe so repair replays are safe on
///    pre-stamped or partially-applied databases.
///
/// Idempotency: every step is safe to replay. Step 1 uses `CREATE ... IF NOT
/// EXISTS`. Step 2 is a `DELETE WHERE` with a value predicate. Step 3 probes
/// for column presence before issuing each DROP.
pub(super) fn apply_v15(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(ORTHODONTIC_UNWEAR_INTERVALS_SQL)
        .map_err(|e| format!("migration v15 create orthodontic_unwear_intervals failed: {e}"))?;

    if orthodontic_checkins_table_exists(conn)? {
        conn.execute(
            "DELETE FROM orthodontic_checkins WHERE checkinType IN ('wear-daily', 'retention-wear')",
            [],
        )
        .map_err(|e| format!("migration v15 purge legacy checkin rows failed: {e}"))?;

        let existing = existing_orthodontic_checkins_columns(conn)?;
        for (column, sql) in DROP_COLUMN_STATEMENTS {
            if !existing.contains(*column) {
                continue;
            }
            conn.execute(sql, []).map_err(|e| {
                format!("migration v15 drop orthodontic_checkins.{column} failed: {e}")
            })?;
        }
    }

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
            "migration v15 check orthodontic_checkins exists failed: {err}"
        )),
    })
}

fn existing_orthodontic_checkins_columns(conn: &Connection) -> Result<HashSet<String>, String> {
    let mut stmt = conn
        .prepare("PRAGMA table_info(orthodontic_checkins)")
        .map_err(|e| format!("migration v15 prepare table_info failed: {e}"))?;
    let rows = stmt
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|e| format!("migration v15 query table_info failed: {e}"))?;
    let mut out = HashSet::new();
    for row in rows {
        out.insert(row.map_err(|e| format!("migration v15 read column name failed: {e}"))?);
    }
    Ok(out)
}

const DROP_COLUMN_STATEMENTS: &[(&str, &str)] = &[
    (
        "actualWearHours",
        "ALTER TABLE orthodontic_checkins DROP COLUMN actualWearHours",
    ),
    (
        "prescribedHours",
        "ALTER TABLE orthodontic_checkins DROP COLUMN prescribedHours",
    ),
    (
        "complianceBucket",
        "ALTER TABLE orthodontic_checkins DROP COLUMN complianceBucket",
    ),
];

const ORTHODONTIC_UNWEAR_INTERVALS_SQL: &str = "
    CREATE TABLE IF NOT EXISTS orthodontic_unwear_intervals (
        intervalId   TEXT PRIMARY KEY NOT NULL,
        childId      TEXT NOT NULL REFERENCES children(childId) ON DELETE CASCADE,
        caseId       TEXT NOT NULL REFERENCES orthodontic_cases(caseId) ON DELETE CASCADE,
        applianceId  TEXT NOT NULL REFERENCES orthodontic_appliances(applianceId) ON DELETE CASCADE,
        startAt      TEXT NOT NULL,
        endAt        TEXT,
        reason       TEXT,
        notes        TEXT,
        createdAt    TEXT NOT NULL,
        updatedAt    TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_unwear_appliance_start
        ON orthodontic_unwear_intervals (applianceId, startAt);
    CREATE INDEX IF NOT EXISTS idx_unwear_child_start
        ON orthodontic_unwear_intervals (childId, startAt);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_unwear_open_interval
        ON orthodontic_unwear_intervals (applianceId)
        WHERE endAt IS NULL;
";
