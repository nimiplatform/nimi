use rusqlite::{params, Connection};
use serde::Deserialize;

#[path = "migrations_schema.rs"]
mod migrations_schema;

use migrations_schema::V1_SCHEMA_SQL;

const SCHEMA_VERSION: u32 = 3;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReminderRuleCatalog {
    rules: Vec<ReminderRulePriorityRecord>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReminderRulePriorityRecord {
    rule_id: String,
    priority: String,
}

pub fn run_migrations(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS _schema_version (
            version INTEGER NOT NULL,
            applied_at TEXT NOT NULL
        );",
    )
    .map_err(|e| format!("migration: failed to create _schema_version: {e}"))?;

    let current_version: u32 = conn
        .query_row(
            "SELECT COALESCE(MAX(version), 0) FROM _schema_version",
            [],
            |row| row.get(0),
        )
        .map_err(|e| format!("migration: failed to read schema version: {e}"))?;

    if current_version >= SCHEMA_VERSION {
        return Ok(());
    }

    if current_version < 1 {
        apply_v1(conn)?;
        conn.execute(
            "INSERT INTO _schema_version (version, applied_at) VALUES (?1, datetime('now'))",
            [&1i64],
        )
        .map_err(|e| format!("migration: failed to record v1: {e}"))?;
    }

    if current_version < 2 {
        apply_v2(conn)?;
        conn.execute(
            "INSERT INTO _schema_version (version, applied_at) VALUES (?1, datetime('now'))",
            [&2i64],
        )
        .map_err(|e| format!("migration: failed to record v2: {e}"))?;
    }

    if current_version < 3 {
        apply_v3(conn)?;
        conn.execute(
            "INSERT INTO _schema_version (version, applied_at) VALUES (?1, datetime('now'))",
            [&3i64],
        )
        .map_err(|e| format!("migration: failed to record v3: {e}"))?;
    }

    Ok(())
}

fn apply_v1(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(V1_SCHEMA_SQL)
    .map_err(|e| format!("migration v1 failed: {e}"))
}

/// v2: ensure tables added after initial v1 deployment exist for databases
/// that already ran v1 before these tables were introduced.
fn apply_v2(conn: &Connection) -> Result<(), String> {
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

fn has_column(conn: &Connection, table: &str, column: &str) -> Result<bool, String> {
    let pragma = format!("PRAGMA table_info({table})");
    let mut stmt = conn
        .prepare(&pragma)
        .map_err(|e| format!("migration v3 prepare table_info({table}): {e}"))?;
    let rows = stmt
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|e| format!("migration v3 query table_info({table}): {e}"))?;

    for row in rows {
        let name = row.map_err(|e| format!("migration v3 read table_info({table}): {e}"))?;
        if name == column {
            return Ok(true);
        }
    }

    Ok(false)
}

fn add_column_if_missing(conn: &Connection, table: &str, column: &str, ddl: &str) -> Result<(), String> {
    if has_column(conn, table, column)? {
        return Ok(());
    }

    conn.execute_batch(ddl)
        .map_err(|e| format!("migration v3 add column {table}.{column} failed: {e}"))
}

fn apply_v3(conn: &Connection) -> Result<(), String> {
    add_column_if_missing(
        conn,
        "reminder_states",
        "snoozedUntil",
        "ALTER TABLE reminder_states ADD COLUMN snoozedUntil TEXT;",
    )?;
    add_column_if_missing(
        conn,
        "reminder_states",
        "scheduledDate",
        "ALTER TABLE reminder_states ADD COLUMN scheduledDate TEXT;",
    )?;
    add_column_if_missing(
        conn,
        "reminder_states",
        "notApplicable",
        "ALTER TABLE reminder_states ADD COLUMN notApplicable INTEGER NOT NULL DEFAULT 0;",
    )?;
    add_column_if_missing(
        conn,
        "reminder_states",
        "plannedForDate",
        "ALTER TABLE reminder_states ADD COLUMN plannedForDate TEXT;",
    )?;
    add_column_if_missing(
        conn,
        "reminder_states",
        "surfaceRank",
        "ALTER TABLE reminder_states ADD COLUMN surfaceRank INTEGER;",
    )?;
    add_column_if_missing(
        conn,
        "reminder_states",
        "lastSurfacedAt",
        "ALTER TABLE reminder_states ADD COLUMN lastSurfacedAt TEXT;",
    )?;
    add_column_if_missing(
        conn,
        "reminder_states",
        "surfaceCount",
        "ALTER TABLE reminder_states ADD COLUMN surfaceCount INTEGER NOT NULL DEFAULT 0;",
    )?;

    conn.execute_batch(
        r#"
        CREATE INDEX IF NOT EXISTS idx_reminder_child_plan ON reminder_states (childId, plannedForDate, surfaceRank);
        CREATE INDEX IF NOT EXISTS idx_reminder_child_snooze ON reminder_states (childId, snoozedUntil);
        CREATE INDEX IF NOT EXISTS idx_reminder_child_schedule ON reminder_states (childId, scheduledDate);
        "#,
    )
    .map_err(|e| format!("migration v3 indexes failed: {e}"))?;

    let catalog: ReminderRuleCatalog = serde_yaml::from_str(include_str!(
        "../../../spec/kernel/tables/reminder-rules.yaml",
    ))
    .map_err(|e| format!("migration v3 parse reminder-rules.yaml failed: {e}"))?;
    let priority_by_rule = catalog
        .rules
        .into_iter()
        .map(|rule| (rule.rule_id, rule.priority))
        .collect::<std::collections::HashMap<_, _>>();

    let mut stmt = conn
        .prepare("SELECT stateId, ruleId FROM reminder_states WHERE status = 'dismissed'")
        .map_err(|e| format!("migration v3 prepare dismissed reminder rows failed: {e}"))?;
    let rows = stmt
        .query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))
        .map_err(|e| format!("migration v3 query dismissed reminder rows failed: {e}"))?;

    for row in rows {
        let (state_id, rule_id) =
            row.map_err(|e| format!("migration v3 read dismissed reminder row failed: {e}"))?;
        let priority = priority_by_rule
            .get(&rule_id)
            .map(String::as_str)
            .ok_or_else(|| format!("migration v3: dismissed reminder_state references unknown ruleId '{rule_id}' (stateId={state_id})"))?;
        if matches!(priority, "P0" | "P1") {
            conn.execute(
                "UPDATE reminder_states SET status = 'active', snoozedUntil = date('now', '+14 day'), dismissReason = NULL, dismissedAt = NULL, updatedAt = datetime('now') WHERE stateId = ?1",
                params![state_id],
            )
            .map_err(|e| format!("migration v3 migrate dismissed->snoozed for {rule_id} failed: {e}"))?;
        } else {
            conn.execute(
                "UPDATE reminder_states SET status = 'active', notApplicable = 1, dismissReason = NULL, dismissedAt = NULL, updatedAt = datetime('now') WHERE stateId = ?1",
                params![state_id],
            )
            .map_err(|e| format!("migration v3 migrate dismissed->notApplicable for {rule_id} failed: {e}"))?;
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{run_migrations, V1_SCHEMA_SQL};
    use rusqlite::{params, Connection};

    fn seed_family_and_child(conn: &Connection) {
        conn.execute(
            "INSERT INTO families (familyId, displayName, createdAt, updatedAt) VALUES (?1, ?2, ?3, ?3)",
            params!["family-1", "Test Family", "2026-01-01T00:00:00.000Z"],
        )
        .expect("insert family");

        conn.execute(
            "INSERT INTO children (childId, familyId, displayName, gender, birthDate, nurtureMode, createdAt, updatedAt) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)",
            params![
                "child-1",
                "family-1",
                "Mimi",
                "female",
                "2024-01-15",
                "balanced",
                "2026-01-01T00:00:00.000Z"
            ],
        )
        .expect("insert child");
    }

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
    fn child_profile_json_fields_round_trip_through_sqlite() {
        let conn = Connection::open_in_memory().expect("open in-memory db");
        conn.execute_batch("PRAGMA foreign_keys=ON;")
            .expect("enable foreign keys");
        run_migrations(&conn).expect("run migrations");
        seed_family_and_child(&conn);

        conn.execute(
            "UPDATE children SET nurtureMode = ?2, nurtureModeOverrides = ?3, recorderProfiles = ?4, allergies = ?5, medicalNotes = ?6, updatedAt = ?7 WHERE childId = ?1",
            params![
                "child-1",
                "advanced",
                "{\"sleep\":\"relaxed\"}",
                "[{\"id\":\"rec-1\",\"name\":\"Mom\"}]",
                "[\"egg\"]",
                "[\"watch sleep\"]",
                "2026-02-01T00:00:00.000Z"
            ],
        )
        .expect("update child json fields");

        let row = conn
            .query_row(
                "SELECT nurtureMode, nurtureModeOverrides, recorderProfiles, allergies, medicalNotes FROM children WHERE childId = ?1",
                params!["child-1"],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, Option<String>>(1)?,
                        row.get::<_, Option<String>>(2)?,
                        row.get::<_, Option<String>>(3)?,
                        row.get::<_, Option<String>>(4)?,
                    ))
                },
            )
            .expect("query child json fields");

        assert_eq!(row.0, "advanced");
        assert_eq!(row.1.as_deref(), Some("{\"sleep\":\"relaxed\"}"));
        assert_eq!(row.2.as_deref(), Some("[{\"id\":\"rec-1\",\"name\":\"Mom\"}]"));
        assert_eq!(row.3.as_deref(), Some("[\"egg\"]"));
        assert_eq!(row.4.as_deref(), Some("[\"watch sleep\"]"));

        conn.execute("DELETE FROM children WHERE childId = ?1", params!["child-1"])
            .expect("delete child");

        let remaining: i64 = conn
            .query_row("SELECT COUNT(*) FROM children WHERE childId = ?1", params!["child-1"], |row| row.get(0))
            .expect("count children");
        assert_eq!(remaining, 0);
    }

    #[test]
    fn journal_entry_structured_fields_round_trip_through_sqlite() {
        let conn = Connection::open_in_memory().expect("open in-memory db");
        conn.execute_batch("PRAGMA foreign_keys=ON;")
            .expect("enable foreign keys");
        run_migrations(&conn).expect("run migrations");
        seed_family_and_child(&conn);

        conn.execute(
            "INSERT INTO journal_entries (entryId, childId, contentType, textContent, recordedAt, ageMonths, observationMode, dimensionId, selectedTags, guidedAnswers, observationDuration, keepsake, recorderId, createdAt, updatedAt) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?14)",
            params![
                "entry-1",
                "child-1",
                "text",
                "Observed focused play.",
                "2026-02-01T00:00:00.000Z",
                24,
                "five-minute",
                "PO-OBS-CONC-001",
                "[\"focus\",\"blocks\"]",
                "{\"q1\":\"answer\"}",
                5,
                1,
                "rec-1",
                "2026-02-01T00:00:00.000Z"
            ],
        )
        .expect("insert journal entry");

        let row = conn
            .query_row(
                "SELECT observationMode, dimensionId, selectedTags, keepsake, recorderId FROM journal_entries WHERE entryId = ?1",
                params!["entry-1"],
                |row| {
                    Ok((
                        row.get::<_, Option<String>>(0)?,
                        row.get::<_, Option<String>>(1)?,
                        row.get::<_, Option<String>>(2)?,
                        row.get::<_, i64>(3)?,
                        row.get::<_, Option<String>>(4)?,
                    ))
                },
            )
            .expect("query journal entry");

        assert_eq!(row.0.as_deref(), Some("five-minute"));
        assert_eq!(row.1.as_deref(), Some("PO-OBS-CONC-001"));
        assert_eq!(row.2.as_deref(), Some("[\"focus\",\"blocks\"]"));
        assert_eq!(row.3, 1);
        assert_eq!(row.4.as_deref(), Some("rec-1"));
    }

    #[test]
    fn journal_entry_voice_and_mixed_content_round_trip_through_sqlite() {
        let conn = Connection::open_in_memory().expect("open in-memory db");
        conn.execute_batch("PRAGMA foreign_keys=ON;")
            .expect("enable foreign keys");
        run_migrations(&conn).expect("run migrations");
        seed_family_and_child(&conn);

        conn.execute(
            "INSERT INTO journal_entries (entryId, childId, contentType, voicePath, recordedAt, ageMonths, keepsake, createdAt, updatedAt) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)",
            params![
                "entry-voice",
                "child-1",
                "voice",
                "C:/voice/entry-voice.webm",
                "2026-02-01T00:00:00.000Z",
                24,
                0,
                "2026-02-01T00:00:00.000Z"
            ],
        )
        .expect("insert voice journal entry");

        conn.execute(
            "INSERT INTO journal_entries (entryId, childId, contentType, textContent, voicePath, recordedAt, ageMonths, keepsake, createdAt, updatedAt) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)",
            params![
                "entry-mixed",
                "child-1",
                "mixed",
                "Observed sharing during block play.",
                "C:/voice/entry-mixed.webm",
                "2026-02-02T00:00:00.000Z",
                24,
                1,
                "2026-02-02T00:00:00.000Z"
            ],
        )
        .expect("insert mixed journal entry");

        let voice_row = conn
            .query_row(
                "SELECT contentType, textContent, voicePath FROM journal_entries WHERE entryId = ?1",
                params!["entry-voice"],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, Option<String>>(1)?,
                        row.get::<_, Option<String>>(2)?,
                    ))
                },
            )
            .expect("query voice journal entry");

        let mixed_row = conn
            .query_row(
                "SELECT contentType, textContent, voicePath FROM journal_entries WHERE entryId = ?1",
                params!["entry-mixed"],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, Option<String>>(1)?,
                        row.get::<_, Option<String>>(2)?,
                    ))
                },
            )
            .expect("query mixed journal entry");

        assert_eq!(voice_row.0, "voice");
        assert_eq!(voice_row.1, None);
        assert_eq!(voice_row.2.as_deref(), Some("C:/voice/entry-voice.webm"));

        assert_eq!(mixed_row.0, "mixed");
        assert_eq!(mixed_row.1.as_deref(), Some("Observed sharing during block play."));
        assert_eq!(mixed_row.2.as_deref(), Some("C:/voice/entry-mixed.webm"));
    }

    #[test]
    fn deleting_a_child_cascades_to_journal_and_ai_records() {
        let conn = Connection::open_in_memory().expect("open in-memory db");
        conn.execute_batch("PRAGMA foreign_keys=ON;")
            .expect("enable foreign keys");
        run_migrations(&conn).expect("run migrations");
        seed_family_and_child(&conn);

        conn.execute(
            "INSERT INTO journal_entries (entryId, childId, contentType, recordedAt, ageMonths, keepsake, createdAt, updatedAt) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)",
            params![
                "entry-1",
                "child-1",
                "text",
                "2026-01-01T00:00:00.000Z",
                12,
                0,
                "2026-01-01T00:00:00.000Z"
            ],
        )
        .expect("insert journal entry");

        conn.execute(
            "INSERT INTO journal_tags (tagId, entryId, domain, tag, source, confidence, createdAt) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                "tag-1",
                "entry-1",
                "observation",
                "focus",
                "manual",
                1.0,
                "2026-01-01T00:00:00.000Z"
            ],
        )
        .expect("insert journal tag");

        conn.execute(
            "INSERT INTO ai_conversations (conversationId, childId, title, startedAt, lastMessageAt, messageCount, createdAt) VALUES (?1, ?2, ?3, ?4, ?4, ?5, ?4)",
            params!["conv-1", "child-1", "Check-in", "2026-01-01T00:00:00.000Z", 1],
        )
        .expect("insert conversation");

        conn.execute(
            "INSERT INTO ai_messages (messageId, conversationId, role, content, contextSnapshot, createdAt) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                "msg-1",
                "conv-1",
                "assistant",
                "hello",
                "{}",
                "2026-01-01T00:00:00.000Z"
            ],
        )
        .expect("insert ai message");

        conn.execute("DELETE FROM children WHERE childId = ?1", params!["child-1"])
            .expect("delete child");

        let journal_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM journal_entries", [], |row| row.get(0))
            .expect("count journal entries");
        let tag_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM journal_tags", [], |row| row.get(0))
            .expect("count journal tags");
        let conversation_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM ai_conversations", [], |row| row.get(0))
            .expect("count conversations");
        let message_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM ai_messages", [], |row| row.get(0))
            .expect("count messages");

        assert_eq!(journal_count, 0);
        assert_eq!(tag_count, 0);
        assert_eq!(conversation_count, 0);
        assert_eq!(message_count, 0);
    }

    #[test]
    fn growth_reports_round_trip_and_cascade_with_child_delete() {
        let conn = Connection::open_in_memory().expect("open in-memory db");
        conn.execute_batch("PRAGMA foreign_keys=ON;")
            .expect("enable foreign keys");
        run_migrations(&conn).expect("run migrations");
        seed_family_and_child(&conn);

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
                "2026-04-01T00:00:00.000Z"
            ],
        )
        .expect("insert growth report");

        let row = conn
            .query_row(
                "SELECT reportType, content, ageMonthsStart, ageMonthsEnd FROM growth_reports WHERE reportId = ?1",
                params!["report-1"],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, i64>(2)?,
                        row.get::<_, i64>(3)?,
                    ))
                },
            )
            .expect("query growth report");

        assert_eq!(row.0, "quarterly-letter");
        assert_eq!(row.1, "{\"format\":\"structured-local\",\"version\":1}");
        assert_eq!(row.2, 24);
        assert_eq!(row.3, 26);

        conn.execute("DELETE FROM children WHERE childId = ?1", params!["child-1"])
            .expect("delete child");

        let report_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM growth_reports", [], |row| row.get(0))
            .expect("count reports");
        assert_eq!(report_count, 0);
    }

    #[test]
    fn dental_record_round_trip_and_cascade_with_child_delete() {
        let conn = Connection::open_in_memory().expect("open in-memory db");
        conn.execute_batch("PRAGMA foreign_keys=ON;").expect("enable fk");
        run_migrations(&conn).expect("run migrations");
        seed_family_and_child(&conn);

        conn.execute(
            "INSERT INTO dental_records (recordId, childId, eventType, toothId, toothSet, eventDate, ageMonths, severity, notes, createdAt) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params!["dental-1", "child-1", "eruption", "51", "primary", "2024-07-15", 6, std::option::Option::<String>::None, "First tooth", "2026-01-01T00:00:00.000Z"],
        ).expect("insert dental record");

        let row = conn.query_row(
            "SELECT eventType, toothId, toothSet FROM dental_records WHERE recordId = ?1",
            params!["dental-1"],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?, row.get::<_, Option<String>>(2)?)),
        ).expect("query dental");
        assert_eq!(row.0, "eruption");
        assert_eq!(row.1.as_deref(), Some("51"));
        assert_eq!(row.2.as_deref(), Some("primary"));

        conn.execute("DELETE FROM children WHERE childId = ?1", params!["child-1"]).expect("delete child");
        let count: i64 = conn.query_row("SELECT COUNT(*) FROM dental_records", [], |row| row.get(0)).expect("count");
        assert_eq!(count, 0);
    }

    #[test]
    fn allergy_record_status_transition_round_trip() {
        let conn = Connection::open_in_memory().expect("open in-memory db");
        conn.execute_batch("PRAGMA foreign_keys=ON;").expect("enable fk");
        run_migrations(&conn).expect("run migrations");
        seed_family_and_child(&conn);

        conn.execute(
            "INSERT INTO allergy_records (recordId, childId, allergen, category, reactionType, severity, diagnosedAt, ageMonthsAtDiagnosis, status, confirmedBy, createdAt, updatedAt) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?11)",
            params!["allergy-1", "child-1", "牛奶蛋白", "food", "gastrointestinal", "moderate", "2024-06-01", 5, "active", "blood-test", "2026-01-01T00:00:00.000Z"],
        ).expect("insert allergy");

        conn.execute(
            "UPDATE allergy_records SET status = ?2, statusChangedAt = ?3, updatedAt = ?3 WHERE recordId = ?1",
            params!["allergy-1", "outgrown", "2026-03-01T00:00:00.000Z"],
        ).expect("update allergy status");

        let row = conn.query_row(
            "SELECT status, statusChangedAt FROM allergy_records WHERE recordId = ?1",
            params!["allergy-1"],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?)),
        ).expect("query allergy");
        assert_eq!(row.0, "outgrown");
        assert_eq!(row.1.as_deref(), Some("2026-03-01T00:00:00.000Z"));
    }

    #[test]
    fn sleep_record_upsert_on_duplicate_date() {
        let conn = Connection::open_in_memory().expect("open in-memory db");
        conn.execute_batch("PRAGMA foreign_keys=ON;").expect("enable fk");
        run_migrations(&conn).expect("run migrations");
        seed_family_and_child(&conn);

        conn.execute(
            "INSERT INTO sleep_records (recordId, childId, sleepDate, bedtime, wakeTime, durationMinutes, quality, ageMonths, createdAt) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params!["sleep-1", "child-1", "2026-02-01", "2026-02-01T21:00:00.000Z", "2026-02-02T07:00:00.000Z", 600, "good", 24, "2026-02-02T08:00:00.000Z"],
        ).expect("insert sleep");

        // Upsert same date
        conn.execute(
            "INSERT INTO sleep_records (recordId, childId, sleepDate, bedtime, wakeTime, durationMinutes, quality, ageMonths, createdAt) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9) ON CONFLICT(childId, sleepDate) DO UPDATE SET bedtime=excluded.bedtime, wakeTime=excluded.wakeTime, durationMinutes=excluded.durationMinutes, quality=excluded.quality",
            params!["sleep-2", "child-1", "2026-02-01", "2026-02-01T20:30:00.000Z", "2026-02-02T06:30:00.000Z", 600, "fair", 24, "2026-02-02T09:00:00.000Z"],
        ).expect("upsert sleep");

        let count: i64 = conn.query_row("SELECT COUNT(*) FROM sleep_records WHERE childId = ?1", params!["child-1"], |row| row.get(0)).expect("count");
        assert_eq!(count, 1);

        let quality: String = conn.query_row("SELECT quality FROM sleep_records WHERE childId = ?1 AND sleepDate = ?2", params!["child-1", "2026-02-01"], |row| row.get(0)).expect("query quality");
        assert_eq!(quality, "fair");
    }

    #[test]
    fn medical_event_round_trip_and_cascade_with_child_delete() {
        let conn = Connection::open_in_memory().expect("open in-memory db");
        conn.execute_batch("PRAGMA foreign_keys=ON;").expect("enable fk");
        run_migrations(&conn).expect("run migrations");
        seed_family_and_child(&conn);

        conn.execute(
            "INSERT INTO medical_events (eventId, childId, eventType, title, eventDate, ageMonths, severity, result, createdAt, updatedAt) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)",
            params!["med-1", "child-1", "checkup", "新生儿听力筛查", "2024-01-17", 0, std::option::Option::<String>::None, "pass", "2026-01-01T00:00:00.000Z"],
        ).expect("insert medical event");

        let row = conn.query_row(
            "SELECT eventType, title, result FROM medical_events WHERE eventId = ?1",
            params!["med-1"],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, Option<String>>(2)?)),
        ).expect("query medical event");
        assert_eq!(row.0, "checkup");
        assert_eq!(row.1, "新生儿听力筛查");
        assert_eq!(row.2.as_deref(), Some("pass"));

        conn.execute("DELETE FROM children WHERE childId = ?1", params!["child-1"]).expect("delete child");
        let count: i64 = conn.query_row("SELECT COUNT(*) FROM medical_events", [], |row| row.get(0)).expect("count");
        assert_eq!(count, 0);
    }

    #[test]
    fn tanner_assessment_stage_validation_round_trip() {
        let conn = Connection::open_in_memory().expect("open in-memory db");
        conn.execute_batch("PRAGMA foreign_keys=ON;").expect("enable fk");
        run_migrations(&conn).expect("run migrations");
        seed_family_and_child(&conn);

        conn.execute(
            "INSERT INTO tanner_assessments (assessmentId, childId, assessedAt, ageMonths, breastOrGenitalStage, pubicHairStage, assessedBy, createdAt) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params!["tanner-1", "child-1", "2032-01-15", 96, 2, 1, "physician", "2032-01-15T10:00:00.000Z"],
        ).expect("insert tanner");

        let row = conn.query_row(
            "SELECT breastOrGenitalStage, pubicHairStage, assessedBy FROM tanner_assessments WHERE assessmentId = ?1",
            params!["tanner-1"],
            |row| Ok((row.get::<_, Option<i64>>(0)?, row.get::<_, Option<i64>>(1)?, row.get::<_, Option<String>>(2)?)),
        ).expect("query tanner");
        assert_eq!(row.0, Some(2));
        assert_eq!(row.1, Some(1));
        assert_eq!(row.2.as_deref(), Some("physician"));
    }

    #[test]
    fn fitness_assessment_sparse_metrics_round_trip() {
        let conn = Connection::open_in_memory().expect("open in-memory db");
        conn.execute_batch("PRAGMA foreign_keys=ON;").expect("enable fk");
        run_migrations(&conn).expect("run migrations");
        seed_family_and_child(&conn);

        conn.execute(
            "INSERT INTO fitness_assessments (assessmentId, childId, assessedAt, ageMonths, assessmentSource, run50m, sitAndReach, sitUps, vitalCapacity, overallGrade, createdAt) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            params!["fitness-1", "child-1", "2031-09-15", 91, "school-pe", 9.5, 12.3, 35, 1800, "good", "2031-09-15T10:00:00.000Z"],
        ).expect("insert fitness");

        let row = conn.query_row(
            "SELECT run50m, sitAndReach, sitUps, vitalCapacity, run800m, pullUps FROM fitness_assessments WHERE assessmentId = ?1",
            params!["fitness-1"],
            |row| Ok((
                row.get::<_, Option<f64>>(0)?,
                row.get::<_, Option<f64>>(1)?,
                row.get::<_, Option<i64>>(2)?,
                row.get::<_, Option<i64>>(3)?,
                row.get::<_, Option<f64>>(4)?,
                row.get::<_, Option<i64>>(5)?,
            )),
        ).expect("query fitness");
        assert!((row.0.unwrap() - 9.5).abs() < 0.01);
        assert!((row.1.unwrap() - 12.3).abs() < 0.01);
        assert_eq!(row.2, Some(35));
        assert_eq!(row.3, Some(1800));
        assert_eq!(row.4, None); // sparse: not provided
        assert_eq!(row.5, None); // sparse: not provided
    }
}
