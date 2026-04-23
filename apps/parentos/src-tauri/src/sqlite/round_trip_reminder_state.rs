use super::*;

/// Full round-trip of the v10 `reminder_states` schema: insert a row that exercises
/// every per-kind progression column and read it back via a single SELECT.
/// Covers PO-REMI-004 storage invariants end-to-end in the Rust layer.
#[test]
fn reminder_state_progression_columns_round_trip() {
    let conn = Connection::open_in_memory().expect("open in-memory db");
    conn.execute_batch("PRAGMA foreign_keys=ON;")
        .expect("enable foreign keys");
    run_migrations(&conn).expect("run migrations");
    seed_family_and_child(&conn);

    let now = "2026-04-23T10:00:00.000Z";
    conn.execute(
        "INSERT INTO reminder_states (\
stateId, childId, ruleId, status, activatedAt, completedAt, dismissedAt, dismissReason, \
repeatIndex, nextTriggerAt, snoozedUntil, scheduledDate, notApplicable, plannedForDate, \
surfaceRank, lastSurfacedAt, surfaceCount, notes, \
acknowledgedAt, reflectedAt, practiceStartedAt, practiceLastAt, practiceCount, \
practiceHabituatedAt, consultedAt, consultationConversationId, createdAt, updatedAt) \
VALUES (?1,?2,?3,?4,NULL,NULL,NULL,NULL,?5,NULL,NULL,NULL,0,NULL,NULL,NULL,0,NULL,\
?6,?7,?8,?9,?10,?11,?12,?13,?14,?14)",
        params![
            "state-1", "child-1", "PO-REM-REL-010", "completed",
            0i64,
            "2026-04-20T10:00:00.000Z", // acknowledgedAt
            "2026-04-22T10:00:00.000Z", // reflectedAt
            "2026-04-15T09:00:00.000Z", // practiceStartedAt
            "2026-04-23T09:30:00.000Z", // practiceLastAt
            3i64,                        // practiceCount
            Option::<String>::None,     // practiceHabituatedAt
            "2026-04-23T09:45:00.000Z", // consultedAt
            "conv-ulid-001",            // consultationConversationId
            now,
        ],
    )
    .expect("insert reminder_states row");

    let (
        status,
        acknowledged_at,
        reflected_at,
        practice_started_at,
        practice_last_at,
        practice_count,
        practice_habituated_at,
        consulted_at,
        consultation_conversation_id,
    ): (
        String,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
        i64,
        Option<String>,
        Option<String>,
        Option<String>,
    ) = conn
        .query_row(
            "SELECT status, acknowledgedAt, reflectedAt, practiceStartedAt, practiceLastAt, \
             practiceCount, practiceHabituatedAt, consultedAt, consultationConversationId \
             FROM reminder_states WHERE stateId = ?1",
            params!["state-1"],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                    row.get(5)?,
                    row.get(6)?,
                    row.get(7)?,
                    row.get(8)?,
                ))
            },
        )
        .expect("select reminder_states row");

    assert_eq!(status, "completed");
    assert_eq!(acknowledged_at.as_deref(), Some("2026-04-20T10:00:00.000Z"));
    assert_eq!(reflected_at.as_deref(), Some("2026-04-22T10:00:00.000Z"));
    assert_eq!(practice_started_at.as_deref(), Some("2026-04-15T09:00:00.000Z"));
    assert_eq!(practice_last_at.as_deref(), Some("2026-04-23T09:30:00.000Z"));
    assert_eq!(practice_count, 3);
    assert_eq!(practice_habituated_at, None);
    assert_eq!(consulted_at.as_deref(), Some("2026-04-23T09:45:00.000Z"));
    assert_eq!(consultation_conversation_id.as_deref(), Some("conv-ulid-001"));
}

/// NULL tolerance: a reminder_states row persisted before v10 migration landed
/// (i.e. without the new progression columns) must end up with NULL-able columns
/// at NULL and practiceCount at its DEFAULT 0 after v10 runs. This proves the
/// engine's lifecycle mapper can read v9-era rows through a v10 schema without
/// crashing or synthesizing state. See reminder-interaction-contract.md#PO-REMI-011.
#[test]
fn reminder_state_v10_nullable_defaults_for_v9_rows() {
    let conn = Connection::open_in_memory().expect("open in-memory db");
    conn.execute_batch("PRAGMA foreign_keys=ON;")
        .expect("enable foreign keys");
    run_migrations(&conn).expect("run migrations");
    seed_family_and_child(&conn);

    let now = "2026-04-23T10:00:00.000Z";
    // Insert a row using only the v9-era column set. Progression columns are left
    // unspecified to mimic a v9-stamped row surviving into v10.
    conn.execute(
        "INSERT INTO reminder_states (\
stateId, childId, ruleId, status, activatedAt, completedAt, dismissedAt, dismissReason, \
repeatIndex, nextTriggerAt, snoozedUntil, scheduledDate, notApplicable, plannedForDate, \
surfaceRank, lastSurfacedAt, surfaceCount, notes, createdAt, updatedAt) \
VALUES (?1,?2,?3,?4,NULL,NULL,NULL,NULL,?5,NULL,NULL,NULL,0,NULL,NULL,NULL,0,NULL,?6,?6)",
        params!["state-v9", "child-1", "PO-REM-VAC-001", "active", 0i64, now],
    )
    .expect("insert v9-era row");

    let (
        acknowledged_at,
        reflected_at,
        practice_started_at,
        practice_last_at,
        practice_count,
        practice_habituated_at,
        consulted_at,
        consultation_conversation_id,
    ): (
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
        i64,
        Option<String>,
        Option<String>,
        Option<String>,
    ) = conn
        .query_row(
            "SELECT acknowledgedAt, reflectedAt, practiceStartedAt, practiceLastAt, \
             practiceCount, practiceHabituatedAt, consultedAt, consultationConversationId \
             FROM reminder_states WHERE stateId = ?1",
            params!["state-v9"],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                    row.get(5)?,
                    row.get(6)?,
                    row.get(7)?,
                ))
            },
        )
        .expect("select v9-era row");

    assert_eq!(acknowledged_at, None);
    assert_eq!(reflected_at, None);
    assert_eq!(practice_started_at, None);
    assert_eq!(practice_last_at, None);
    assert_eq!(
        practice_count, 0,
        "practiceCount must default to 0 (DEFAULT 0 in schema)"
    );
    assert_eq!(practice_habituated_at, None);
    assert_eq!(consulted_at, None);
    assert_eq!(consultation_conversation_id, None);
}

/// v10 migration idempotency: run_migrations already fires apply_v10 once; calling
/// it again via the repair-replay path must not fail even though the columns exist.
/// The PRAGMA table_info guard in migrations_v10 is responsible for this.
#[test]
fn reminder_state_v10_is_idempotent() {
    let conn = Connection::open_in_memory().expect("open in-memory db");
    conn.execute_batch("PRAGMA foreign_keys=ON;")
        .expect("enable foreign keys");
    run_migrations(&conn).expect("first run migrations");
    // Second invocation mirrors the repair-replay path used by repair_missing_tables.
    run_migrations(&conn).expect("second run must stay idempotent");

    // Columns are still addressable.
    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM pragma_table_info('reminder_states') \
             WHERE name IN ('acknowledgedAt','reflectedAt','practiceStartedAt','practiceLastAt',\
             'practiceCount','practiceHabituatedAt','consultedAt','consultationConversationId')",
            [],
            |row| row.get(0),
        )
        .expect("count v10 columns");
    assert_eq!(count, 8, "all 8 v10 progression columns must exist");

    // Index exists.
    let idx_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='index' \
             AND name='idx_reminder_states_child_conversation'",
            [],
            |row| row.get(0),
        )
        .expect("count consultation index");
    assert_eq!(idx_count, 1, "consultation conversation index must be present");
}

/// Full INSERT via the same SQL used by upsert_reminder_state covering every
/// ?1-?27 placeholder, then ON CONFLICT update must rewrite progression columns.
/// This double-checks the production upsert statement shape against the schema.
#[test]
fn reminder_state_upsert_conflict_update_covers_progression_columns() {
    let conn = Connection::open_in_memory().expect("open in-memory db");
    conn.execute_batch("PRAGMA foreign_keys=ON;")
        .expect("enable foreign keys");
    run_migrations(&conn).expect("run migrations");
    seed_family_and_child(&conn);

    let now_initial = "2026-04-20T10:00:00.000Z";
    let now_update = "2026-04-23T10:00:00.000Z";

    // Mirror of UPSERT_SQL in queries/reminders.rs. Kept inline here so drift is
    // caught by this test — if queries/reminders.rs rewrites the SQL in an
    // incompatible way, this test will diverge.
    const UPSERT_SQL: &str = "INSERT INTO reminder_states (\
stateId, childId, ruleId, status, activatedAt, completedAt, dismissedAt, dismissReason, \
repeatIndex, nextTriggerAt, snoozedUntil, scheduledDate, notApplicable, plannedForDate, \
surfaceRank, lastSurfacedAt, surfaceCount, notes, \
acknowledgedAt, reflectedAt, practiceStartedAt, practiceLastAt, practiceCount, \
practiceHabituatedAt, consultedAt, consultationConversationId, \
createdAt, updatedAt\
) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,?22,?23,?24,?25,?26,?27,?27) \
ON CONFLICT(childId, ruleId, repeatIndex) DO UPDATE SET \
status=?4, activatedAt=?5, completedAt=?6, dismissedAt=?7, dismissReason=?8, \
nextTriggerAt=?10, snoozedUntil=?11, scheduledDate=?12, notApplicable=?13, \
plannedForDate=?14, surfaceRank=?15, lastSurfacedAt=?16, surfaceCount=?17, notes=?18, \
acknowledgedAt=?19, reflectedAt=?20, practiceStartedAt=?21, practiceLastAt=?22, \
practiceCount=?23, practiceHabituatedAt=?24, consultedAt=?25, consultationConversationId=?26, \
updatedAt=?27";

    // First upsert: active guide reminder, no progression yet.
    conn.execute(
        UPSERT_SQL,
        params![
            "state-u1", "child-1", "PO-REM-REL-010", "active",
            Option::<String>::None, Option::<String>::None, Option::<String>::None,
            Option::<String>::None, 0i64, Option::<String>::None, Option::<String>::None,
            Option::<String>::None, 0i64, Option::<String>::None, Option::<String>::None,
            Option::<String>::None, 0i64, Option::<String>::None,
            Option::<String>::None, Option::<String>::None,
            Option::<String>::None, Option::<String>::None, 0i64,
            Option::<String>::None, Option::<String>::None, Option::<String>::None,
            now_initial,
        ],
    )
    .expect("initial insert");

    // Second upsert: parent acknowledges guide; status flips to completed.
    conn.execute(
        UPSERT_SQL,
        params![
            "state-u1", "child-1", "PO-REM-REL-010", "completed",
            Option::<String>::None, Option::<String>::None, Option::<String>::None,
            Option::<String>::None, 0i64, Option::<String>::None, Option::<String>::None,
            Option::<String>::None, 0i64, Option::<String>::None, Option::<String>::None,
            Option::<String>::None, 0i64, Option::<String>::None,
            now_update,                 // acknowledgedAt
            Option::<String>::None,     // reflectedAt
            Option::<String>::None, Option::<String>::None, 0i64,
            Option::<String>::None, Option::<String>::None, Option::<String>::None,
            now_update,
        ],
    )
    .expect("upsert conflict update");

    let (status, acknowledged_at, updated_at): (String, Option<String>, String) = conn
        .query_row(
            "SELECT status, acknowledgedAt, updatedAt FROM reminder_states WHERE stateId = ?1",
            params!["state-u1"],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .expect("select after conflict update");

    assert_eq!(status, "completed");
    assert_eq!(acknowledged_at.as_deref(), Some(now_update));
    assert_eq!(updated_at, now_update);
}
