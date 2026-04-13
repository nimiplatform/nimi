use rusqlite::Connection;

/// v2: ensure tables added after initial v1 deployment exist for databases
/// that already ran v1 before these tables were introduced.
pub(super) fn apply_v2(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS medical_events (
            eventId    TEXT PRIMARY KEY NOT NULL,
            childId    TEXT NOT NULL REFERENCES children(childId) ON DELETE CASCADE,
            eventType  TEXT NOT NULL,
            title      TEXT NOT NULL,
            eventDate  TEXT NOT NULL,
            endDate    TEXT,
            ageMonths  INTEGER NOT NULL,
            severity   TEXT,
            result     TEXT,
            hospital   TEXT,
            medication TEXT,
            dosage     TEXT,
            notes      TEXT,
            photoPath  TEXT,
            createdAt  TEXT NOT NULL,
            updatedAt  TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_medical_child_date ON medical_events (childId, eventDate);
        CREATE INDEX IF NOT EXISTS idx_medical_child_type ON medical_events (childId, eventType);

        CREATE TABLE IF NOT EXISTS tanner_assessments (
            assessmentId         TEXT PRIMARY KEY NOT NULL,
            childId              TEXT NOT NULL REFERENCES children(childId) ON DELETE CASCADE,
            assessedAt           TEXT NOT NULL,
            ageMonths            INTEGER NOT NULL,
            breastOrGenitalStage INTEGER,
            pubicHairStage       INTEGER,
            assessedBy           TEXT,
            notes                TEXT,
            createdAt            TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_tanner_child_date ON tanner_assessments (childId, assessedAt);

        CREATE TABLE IF NOT EXISTS fitness_assessments (
            assessmentId     TEXT PRIMARY KEY NOT NULL,
            childId          TEXT NOT NULL REFERENCES children(childId) ON DELETE CASCADE,
            assessedAt       TEXT NOT NULL,
            ageMonths        INTEGER NOT NULL,
            assessmentSource TEXT,
            run50m           REAL,
            run800m          REAL,
            run1000m         REAL,
            run50x8          REAL,
            sitAndReach      REAL,
            standingLongJump REAL,
            sitUps           INTEGER,
            pullUps          INTEGER,
            ropeSkipping     INTEGER,
            vitalCapacity    INTEGER,
            footArchStatus   TEXT,
            overallGrade     TEXT,
            notes            TEXT,
            createdAt        TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_fitness_child_date ON fitness_assessments (childId, assessedAt);
    "#,
    )
    .map_err(|e| format!("migration v2 failed: {e}"))
}
