use super::*;

#[test]
fn migration_v3_rejects_dismissed_reminder_with_unknown_rule_id() {
    let conn = Connection::open_in_memory().expect("open in-memory db");
    conn.execute_batch("PRAGMA foreign_keys=ON;")
        .expect("enable foreign keys");
    conn.execute_batch(V1_SCHEMA_SQL)
        .expect("create existing schema");
    conn.execute_batch(
        "CREATE TABLE _schema_version (
            version INTEGER NOT NULL,
            applied_at TEXT NOT NULL
        );",
    )
    .expect("create schema version table");
    conn.execute(
        "INSERT INTO _schema_version (version, applied_at) VALUES (?1, ?2)",
        params![2i64, "2026-01-01T00:00:00.000Z"],
    )
    .expect("seed schema version");
    seed_family_and_child(&conn);
    conn.execute(
        "INSERT INTO reminder_states (stateId, childId, ruleId, status, activatedAt, completedAt, dismissedAt, dismissReason, repeatIndex, nextTriggerAt, snoozedUntil, scheduledDate, notApplicable, plannedForDate, surfaceRank, lastSurfacedAt, surfaceCount, notes, createdAt, updatedAt) VALUES (?1, ?2, ?3, ?4, NULL, NULL, ?5, ?6, 0, NULL, NULL, NULL, 0, NULL, NULL, NULL, 0, NULL, ?7, ?7)",
        params![
            "state-unknown",
            "child-1",
            "PO-REM-UNK-999",
            "dismissed",
            "2026-01-10T00:00:00.000Z",
            "legacy-dismissed",
            "2026-01-10T00:00:00.000Z"
        ],
    )
    .expect("insert dismissed reminder state");

    let error = run_migrations(&conn).expect_err("migration should fail on unknown rule id");
    assert!(
        error.contains("unknown ruleId 'PO-REM-UNK-999'"),
        "unexpected error: {error}"
    );
}

#[test]
fn migration_repairs_missing_tables_for_version_5_db() {
    let conn = Connection::open_in_memory().expect("open in-memory db");
    conn.execute_batch("PRAGMA foreign_keys=ON;")
        .expect("enable foreign keys");
    conn.execute_batch(V1_SCHEMA_SQL)
        .expect("create baseline schema");
    conn.execute_batch(
        "CREATE TABLE _schema_version (
            version INTEGER NOT NULL,
            applied_at TEXT NOT NULL
        );",
    )
    .expect("create schema version table");
    conn.execute(
        "INSERT INTO _schema_version (version, applied_at) VALUES (?1, ?2)",
        params![5i64, "2026-01-01T00:00:00.000Z"],
    )
    .expect("seed schema version");
    conn.execute_batch(
        r#"
        DROP TABLE sleep_records;
        DROP TABLE attachments;
        DROP TABLE growth_reports;
        DROP TABLE dental_records;
        DROP TABLE allergy_records;
        "#,
    )
    .expect("drop tables introduced after older pre-release builds");

    run_migrations(&conn).expect("repair missing tables");
    seed_family_and_child(&conn);

    conn.execute(
        "INSERT INTO sleep_records (recordId, childId, sleepDate, bedtime, wakeTime, durationMinutes, quality, ageMonths, createdAt) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params!["sleep-1", "child-1", "2026-02-01", "2026-02-01T21:00:00.000Z", "2026-02-02T07:00:00.000Z", 600, "good", 24, "2026-02-02T08:00:00.000Z"],
    )
    .expect("insert repaired sleep record");

    for table_name in [
        "sleep_records",
        "attachments",
        "growth_reports",
        "dental_records",
        "allergy_records",
    ] {
        let exists: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
                params![table_name],
                |row| row.get(0),
            )
            .expect("query repaired table existence");
        assert_eq!(exists, 1, "expected repaired table {table_name} to exist");
    }

    conn.execute(
        "INSERT INTO growth_reports (reportId, childId, reportType, periodStart, periodEnd, ageMonthsStart, ageMonthsEnd, content, generatedAt, createdAt) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)",
        params![
            "report-1",
            "child-1",
            "quarterly-letter",
            "2026-01-01T00:00:00.000Z",
            "2026-03-31T23:59:59.000Z",
            24,
            26,
            "{\"format\":\"structured-local\",\"version\":1}",
            "2026-04-01T00:00:00.000Z",
        ],
    )
    .expect("insert repaired growth report");

    conn.execute(
        "INSERT INTO dental_records (recordId, childId, eventType, eventDate, ageMonths, createdAt) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params!["dental-1", "child-1", "checkup", "2026-04-01", 24, "2026-04-01T00:00:00.000Z"],
    )
    .expect("insert repaired dental record");

    conn.execute(
        "INSERT INTO allergy_records (recordId, childId, allergen, category, severity, status, createdAt, updatedAt) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)",
        params!["allergy-1", "child-1", "egg", "food", "mild", "active", "2026-04-01T00:00:00.000Z"],
    )
    .expect("insert repaired allergy record");
}

#[test]
fn migration_repairs_version_5_db_with_legacy_reminder_state_columns() {
    let conn = Connection::open_in_memory().expect("open in-memory db");
    conn.execute_batch("PRAGMA foreign_keys=ON;")
        .expect("enable foreign keys");
    conn.execute_batch(V1_SCHEMA_SQL)
        .expect("create baseline schema");
    conn.execute_batch(
        "CREATE TABLE _schema_version (
            version INTEGER NOT NULL,
            applied_at TEXT NOT NULL
        );",
    )
    .expect("create schema version table");
    conn.execute(
        "INSERT INTO _schema_version (version, applied_at) VALUES (?1, ?2)",
        params![5i64, "2026-01-01T00:00:00.000Z"],
    )
    .expect("seed schema version");

    conn.execute_batch(
        r#"
        DROP TABLE reminder_states;
        CREATE TABLE reminder_states (
            stateId       TEXT PRIMARY KEY NOT NULL,
            childId       TEXT NOT NULL REFERENCES children(childId) ON DELETE CASCADE,
            ruleId        TEXT NOT NULL,
            status        TEXT NOT NULL,
            activatedAt   TEXT,
            completedAt   TEXT,
            dismissedAt   TEXT,
            dismissReason TEXT,
            repeatIndex   INTEGER NOT NULL DEFAULT 0,
            nextTriggerAt TEXT,
            notes         TEXT,
            createdAt     TEXT NOT NULL,
            updatedAt     TEXT NOT NULL,
            UNIQUE (childId, ruleId, repeatIndex)
        );
        CREATE INDEX idx_reminder_child_status ON reminder_states (childId, status);
        CREATE INDEX idx_reminder_next_trigger ON reminder_states (nextTriggerAt);
        "#,
    )
    .expect("create legacy reminder_states schema");

    run_migrations(&conn).expect("repair legacy reminder_states columns");

    for column_name in [
        "snoozedUntil",
        "scheduledDate",
        "notApplicable",
        "plannedForDate",
        "surfaceRank",
        "lastSurfacedAt",
        "surfaceCount",
    ] {
        let exists = conn
            .query_row(
                "SELECT COUNT(*) FROM pragma_table_info('reminder_states') WHERE name = ?1",
                params![column_name],
                |row| row.get::<_, i64>(0),
            )
            .expect("query reminder_states column");
        assert_eq!(exists, 1, "expected repaired column {column_name} to exist");
    }

    for index_name in [
        "idx_reminder_child_plan",
        "idx_reminder_child_snooze",
        "idx_reminder_child_schedule",
    ] {
        let exists = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name = ?1",
                params![index_name],
                |row| row.get::<_, i64>(0),
            )
            .expect("query reminder_states index");
        assert_eq!(exists, 1, "expected repaired index {index_name} to exist");
    }
}

#[test]
fn migration_v7_adds_keepsake_metadata_columns_to_existing_journal_entries() {
    let conn = Connection::open_in_memory().expect("open in-memory db");
    conn.execute_batch("PRAGMA foreign_keys=ON;")
        .expect("enable foreign keys");
    conn.execute_batch(V1_SCHEMA_SQL)
        .expect("create baseline schema");
    conn.execute_batch(
        "CREATE TABLE _schema_version (
            version INTEGER NOT NULL,
            applied_at TEXT NOT NULL
        );",
    )
    .expect("create schema version table");
    conn.execute(
        "INSERT INTO _schema_version (version, applied_at) VALUES (?1, ?2)",
        params![6i64, "2026-01-01T00:00:00.000Z"],
    )
    .expect("seed schema version");

    run_migrations(&conn).expect("run migrations");

    let keepsake_title_exists: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM pragma_table_info('journal_entries') WHERE name = 'keepsakeTitle'",
            [],
            |row| row.get(0),
        )
        .expect("query keepsakeTitle column");
    let keepsake_reason_exists: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM pragma_table_info('journal_entries') WHERE name = 'keepsakeReason'",
            [],
            |row| row.get(0),
        )
        .expect("query keepsakeReason column");

    assert_eq!(keepsake_title_exists, 1);
    assert_eq!(keepsake_reason_exists, 1);
}
