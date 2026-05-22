use rusqlite::Connection;

/// Schema v22: admit the `posture_assessments` retained-stateful table
/// (`profile-contract.md#PO-PROF-019`).
///
/// Posture / body-alignment review is admitted as an independent
/// retained-owner stateful domain. Its records are discrete dated
/// assessments (a parent or clinician observation snapshot), not
/// value-at-time PO-HREC metrics, so they keep their own canonical table
/// rather than being folded into `health_record_events`.
///
/// The table cascades on the parent `children` row so child deletion sweeps
/// posture history without orphans (AGENTS.md Privacy Boundary / PIPL).
///
/// Idempotent via `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS`;
/// re-running under `repair_missing_tables` replay is a no-op.
pub(super) fn apply_v22(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(POSTURE_ASSESSMENTS_DDL)
        .map_err(|e| format!("migration v22: posture_assessments DDL failed: {e}"))?;
    Ok(())
}

const POSTURE_ASSESSMENTS_DDL: &str = "
    CREATE TABLE IF NOT EXISTS posture_assessments (
        assessmentId TEXT PRIMARY KEY NOT NULL,
        childId      TEXT NOT NULL REFERENCES children(childId) ON DELETE CASCADE,
        assessedAt   TEXT NOT NULL,
        ageMonths    INTEGER NOT NULL,
        source       TEXT,
        shoulder     TEXT,
        scapula      TEXT,
        hip          TEXT,
        leg          TEXT,
        heel         TEXT,
        neck         TEXT,
        pelvis       TEXT,
        knee         TEXT,
        adam         TEXT,
        cobbAngle    REAL,
        notes        TEXT,
        photoPaths   TEXT,
        createdAt    TEXT NOT NULL,
        updatedAt    TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_posture_child_date
        ON posture_assessments (childId, assessedAt);
";

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn bootstrap(conn: &Connection) {
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        conn.execute_batch(
            "CREATE TABLE children (childId TEXT PRIMARY KEY);
             INSERT INTO children(childId) VALUES('child-1');",
        )
        .unwrap();
    }

    #[test]
    fn applies_clean() {
        let conn = Connection::open_in_memory().unwrap();
        bootstrap(&conn);
        apply_v22(&conn).expect("v22 should apply cleanly");
        conn.execute(
            "INSERT INTO posture_assessments
             (assessmentId, childId, assessedAt, ageMonths, source, shoulder, scapula, hip,
              leg, heel, neck, pelvis, knee, adam, cobbAngle, notes, photoPaths, createdAt, updatedAt)
             VALUES ('pa-1','child-1','2026-05-21',66,'parent','0',NULL,NULL,NULL,NULL,NULL,NULL,
                     NULL,NULL,NULL,NULL,NULL,'2026-05-21T00:00:00Z','2026-05-21T00:00:00Z')",
            [],
        )
        .expect("insert posture assessment row");
    }

    #[test]
    fn replay_is_no_op() {
        let conn = Connection::open_in_memory().unwrap();
        bootstrap(&conn);
        apply_v22(&conn).expect("first apply");
        apply_v22(&conn).expect("second apply must be idempotent");
        apply_v22(&conn).expect("third apply must be idempotent");
    }

    #[test]
    fn child_delete_cascades_into_posture_assessments() {
        let conn = Connection::open_in_memory().unwrap();
        bootstrap(&conn);
        apply_v22(&conn).expect("v22 apply");
        conn.execute(
            "INSERT INTO posture_assessments
             (assessmentId, childId, assessedAt, ageMonths, createdAt, updatedAt)
             VALUES ('pa-1','child-1','2026-05-21',66,'2026-05-21T00:00:00Z','2026-05-21T00:00:00Z')",
            [],
        )
        .unwrap();
        conn.execute("DELETE FROM children WHERE childId = 'child-1'", [])
            .unwrap();
        let remaining: i64 = conn
            .query_row("SELECT COUNT(*) FROM posture_assessments", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(remaining, 0, "child delete must cascade into posture_assessments");
    }
}
