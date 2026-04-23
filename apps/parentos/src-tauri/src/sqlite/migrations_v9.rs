use rusqlite::{params, Connection};

/// Schema v9: introduce the three-layer orthodontic model.
///
/// - `orthodontic_cases`      — one row per treatment course (source of truth for stage).
/// - `orthodontic_appliances` — one row per appliance instance (source of truth for status, prescribed wear, review cadence).
/// - `orthodontic_checkins`   — high-frequency parent checkins. Only the four admitted checkinTypes are admitted.
///
/// Plus repair steps:
///
/// 1. Remove synthetic `dental-auto-*` reminder_states rows written by pre-contract code. These are NOT in the compiled catalog, so they trigger PO-TIME-007 fail-close. We delete them; Phase 1 authority replaced the synthetic ids with admitted `PO-DEN-FOLLOWUP-*` rules.
/// 2. Conditional legacy stitching for historical `ortho-start` dental rows: only run when rows exist. Creates an `unknown-legacy` orthodontic_cases entry per child so the new UI has a home for the old data.
pub(super) fn apply_v9(conn: &Connection) -> Result<(), String> {
    create_orthodontic_tables(conn)?;
    purge_synthetic_dental_reminder_states(conn)?;
    repair_legacy_ortho_start_rows(conn)?;
    Ok(())
}

fn create_orthodontic_tables(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS orthodontic_cases (
            caseId               TEXT PRIMARY KEY NOT NULL,
            childId              TEXT NOT NULL REFERENCES children(childId) ON DELETE CASCADE,
            caseType             TEXT NOT NULL,
            stage                TEXT NOT NULL,
            startedAt            TEXT NOT NULL,
            plannedEndAt         TEXT,
            actualEndAt          TEXT,
            primaryIssues        TEXT,
            providerName         TEXT,
            providerInstitution  TEXT,
            nextReviewDate       TEXT,
            notes                TEXT,
            createdAt            TEXT NOT NULL,
            updatedAt            TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_ortho_cases_child_stage
            ON orthodontic_cases (childId, stage);
        CREATE INDEX IF NOT EXISTS idx_ortho_cases_child_started
            ON orthodontic_cases (childId, startedAt);

        CREATE TABLE IF NOT EXISTS orthodontic_appliances (
            applianceId            TEXT PRIMARY KEY NOT NULL,
            caseId                 TEXT NOT NULL REFERENCES orthodontic_cases(caseId) ON DELETE CASCADE,
            childId                TEXT NOT NULL REFERENCES children(childId) ON DELETE CASCADE,
            applianceType          TEXT NOT NULL,
            status                 TEXT NOT NULL,
            startedAt              TEXT NOT NULL,
            endedAt                TEXT,
            prescribedHoursPerDay  INTEGER,
            prescribedActivations  INTEGER,
            completedActivations   INTEGER NOT NULL DEFAULT 0,
            reviewIntervalDays     INTEGER,
            lastReviewAt           TEXT,
            nextReviewDate         TEXT,
            pauseReason            TEXT,
            notes                  TEXT,
            createdAt              TEXT NOT NULL,
            updatedAt              TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_ortho_appl_case_status
            ON orthodontic_appliances (caseId, status);
        CREATE INDEX IF NOT EXISTS idx_ortho_appl_child_status
            ON orthodontic_appliances (childId, status);
        CREATE INDEX IF NOT EXISTS idx_ortho_appl_child_next_review
            ON orthodontic_appliances (childId, nextReviewDate);

        CREATE TABLE IF NOT EXISTS orthodontic_checkins (
            checkinId          TEXT PRIMARY KEY NOT NULL,
            childId            TEXT NOT NULL REFERENCES children(childId) ON DELETE CASCADE,
            caseId             TEXT NOT NULL REFERENCES orthodontic_cases(caseId) ON DELETE CASCADE,
            applianceId        TEXT NOT NULL REFERENCES orthodontic_appliances(applianceId) ON DELETE CASCADE,
            checkinType        TEXT NOT NULL,
            checkinDate        TEXT NOT NULL,
            actualWearHours    REAL,
            prescribedHours    REAL,
            complianceBucket   TEXT,
            activationIndex    INTEGER,
            alignerIndex       INTEGER,
            notes              TEXT,
            createdAt          TEXT NOT NULL,
            updatedAt          TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_ortho_checkin_child_date
            ON orthodontic_checkins (childId, checkinDate);
        CREATE INDEX IF NOT EXISTS idx_ortho_checkin_appliance_date
            ON orthodontic_checkins (applianceId, checkinDate);
        CREATE INDEX IF NOT EXISTS idx_ortho_checkin_appliance_type_date
            ON orthodontic_checkins (applianceId, checkinType, checkinDate);
        -- Partial uniqueness for the daily-cadence checkin types. aligner-change
        -- and expander-activation may legitimately repeat within a day.
        CREATE UNIQUE INDEX IF NOT EXISTS uniq_ortho_checkin_daily
            ON orthodontic_checkins (applianceId, checkinType, checkinDate)
            WHERE checkinType IN ('wear-daily', 'retention-wear');
        "#,
    )
    .map_err(|e| format!("migration v9 create orthodontic tables failed: {e}"))
}

fn purge_synthetic_dental_reminder_states(conn: &Connection) -> Result<(), String> {
    // Pre-contract code synthesized ruleIds like "dental-auto-cleaning-2026-04-01".
    // These are not in the compiled reminder catalog and now trip the PO-TIME-007
    // fail-close invariant. Delete them so the UI stays usable; the replacement
    // admitted rules (PO-DEN-FOLLOWUP-*) are declared in orthodontic-protocols.yaml.
    conn.execute(
        "DELETE FROM reminder_states WHERE ruleId LIKE 'dental-auto-%'",
        [],
    )
    .map_err(|e| format!("migration v9 purge synthetic reminder_states failed: {e}"))?;
    Ok(())
}

fn repair_legacy_ortho_start_rows(conn: &Connection) -> Result<(), String> {
    // Only run the legacy stitch when we can actually find rows that need it.
    // This matches the Phase 0 pre-check: the ortho-start event type was writable
    // through the old dental form before the Rust validator tightened in 2026-04-17.
    // Local dev DBs from that window may have rows; fresh installs must not have
    // a synthetic unknown-legacy case fabricated for them.
    //
    // Guard: dental_records may not exist yet when v9 runs during a repair of a
    // DB whose prior state dropped it. Subsequent repair_missing_tables pass will
    // recreate dental_records; it will be empty, so there is nothing to stitch.
    let dental_exists: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'dental_records'",
            [],
            |row| row.get(0),
        )
        .map_err(|e| format!("migration v9 check dental_records existence failed: {e}"))?;
    if dental_exists == 0 {
        return Ok(());
    }

    let mut stmt = conn
        .prepare(
            "SELECT childId, MIN(eventDate), COUNT(*) FROM dental_records
             WHERE eventType = 'ortho-start'
             GROUP BY childId",
        )
        .map_err(|e| format!("migration v9 prepare ortho-start scan failed: {e}"))?;
    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)?,
            ))
        })
        .map_err(|e| format!("migration v9 scan ortho-start rows failed: {e}"))?;

    let now = current_iso_datetime(conn)?;
    for row in rows {
        let (child_id, earliest_event_date, _count) =
            row.map_err(|e| format!("migration v9 read ortho-start row failed: {e}"))?;

        // Skip if the child already has any orthodontic_cases row (idempotent replay).
        let existing: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM orthodontic_cases WHERE childId = ?1",
                params![child_id],
                |row| row.get(0),
            )
            .map_err(|e| format!("migration v9 check existing case failed: {e}"))?;
        if existing > 0 {
            continue;
        }

        // Deterministic legacy caseId so re-running the migration stays idempotent.
        // Admitted exception to the PO-ORTHO-002 ULID guidance (documented in
        // orthodontic-contract.md under the legacy-stitch note).
        let case_id = format!("legacy-ortho-case-{child_id}");
        let started_at = earliest_event_date;
        conn.execute(
            "INSERT INTO orthodontic_cases
                (caseId, childId, caseType, stage, startedAt, plannedEndAt, actualEndAt,
                 primaryIssues, providerName, providerInstitution, nextReviewDate, notes,
                 createdAt, updatedAt)
             VALUES (?1, ?2, 'unknown-legacy', 'active', ?3, NULL, NULL,
                     NULL, NULL, NULL, NULL,
                     '从 ortho-start 历史记录回补生成的占位疗程；请确认 caseType 并补充装置信息',
                     ?4, ?4)",
            params![case_id, child_id, started_at, now],
        )
        .map_err(|e| format!("migration v9 insert legacy case failed: {e}"))?;
    }

    Ok(())
}

fn current_iso_datetime(conn: &Connection) -> Result<String, String> {
    conn.query_row("SELECT strftime('%Y-%m-%dT%H:%M:%fZ', 'now')", [], |row| {
        row.get::<_, String>(0)
    })
    .map_err(|e| format!("migration v9 fetch now() failed: {e}"))
}
