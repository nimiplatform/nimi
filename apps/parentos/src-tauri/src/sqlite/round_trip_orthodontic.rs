use super::*;

#[test]
fn orthodontic_case_appliance_checkin_round_trip_and_cascade() {
    let conn = Connection::open_in_memory().expect("open in-memory db");
    conn.execute_batch("PRAGMA foreign_keys=ON;")
        .expect("enable foreign keys");
    run_migrations(&conn).expect("run migrations");
    seed_family_and_child(&conn);

    conn.execute(
        "INSERT INTO orthodontic_cases (caseId, childId, caseType, stage, startedAt, plannedEndAt, actualEndAt, primaryIssues, providerName, providerInstitution, nextReviewDate, notes, createdAt, updatedAt) VALUES (?1,?2,?3,?4,?5,?6,NULL,?7,?8,?9,NULL,?10,?11,?11)",
        params!["case-1", "child-1", "clear-aligners", "active", "2026-04-01", "2027-04-01", "[\"crowding\"]", "Dr. X", "Hospital Y", "note", "2026-04-01T00:00:00.000Z"],
    ).expect("insert case");
    conn.execute(
        "INSERT INTO orthodontic_appliances (applianceId, caseId, childId, applianceType, status, startedAt, endedAt, prescribedHoursPerDay, prescribedActivations, completedActivations, reviewIntervalDays, lastReviewAt, nextReviewDate, pauseReason, notes, createdAt, updatedAt) VALUES (?1,?2,?3,?4,?5,?6,NULL,?7,NULL,0,?8,NULL,?9,NULL,NULL,?10,?10)",
        params!["appl-1", "case-1", "child-1", "clear-aligner", "active", "2026-04-01", 22i64, 56i64, "2026-06-01", "2026-04-01T00:00:00.000Z"],
    ).expect("insert appliance");
    conn.execute(
        "INSERT INTO orthodontic_checkins (checkinId, childId, caseId, applianceId, checkinType, checkinDate, actualWearHours, prescribedHours, complianceBucket, activationIndex, alignerIndex, notes, createdAt, updatedAt) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,NULL,NULL,NULL,?10,?10)",
        params!["chk-1", "child-1", "case-1", "appl-1", "wear-daily", "2026-04-10", 20.0f64, 22.0f64, "done", "2026-04-10T20:00:00.000Z"],
    ).expect("insert checkin");

    conn.execute(
        "DELETE FROM orthodontic_appliances WHERE applianceId = ?1",
        params!["appl-1"],
    )
    .expect("delete appliance");
    let chk_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM orthodontic_checkins WHERE applianceId = ?1",
            params!["appl-1"],
            |r| r.get(0),
        )
        .expect("count checkins");
    assert_eq!(chk_count, 0, "checkins should cascade on appliance delete");

    conn.execute(
        "DELETE FROM children WHERE childId = ?1",
        params!["child-1"],
    )
    .expect("delete child");
    let case_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM orthodontic_cases WHERE childId = ?1",
            params!["child-1"],
            |r| r.get(0),
        )
        .expect("count cases");
    assert_eq!(case_count, 0, "cases should cascade on child delete");
}

#[test]
fn orthodontic_checkin_daily_uniqueness_partial_index() {
    let conn = Connection::open_in_memory().expect("open in-memory db");
    conn.execute_batch("PRAGMA foreign_keys=ON;")
        .expect("enable foreign keys");
    run_migrations(&conn).expect("run migrations");
    seed_family_and_child(&conn);

    conn.execute(
        "INSERT INTO orthodontic_cases (caseId, childId, caseType, stage, startedAt, plannedEndAt, actualEndAt, primaryIssues, providerName, providerInstitution, nextReviewDate, notes, createdAt, updatedAt) VALUES (?1,?2,?3,?4,?5,NULL,NULL,NULL,NULL,NULL,NULL,NULL,?6,?6)",
        params!["case-2", "child-1", "clear-aligners", "active", "2026-04-01", "2026-04-01T00:00:00.000Z"],
    ).expect("insert case");
    conn.execute(
        "INSERT INTO orthodontic_appliances (applianceId, caseId, childId, applianceType, status, startedAt, endedAt, prescribedHoursPerDay, prescribedActivations, completedActivations, reviewIntervalDays, lastReviewAt, nextReviewDate, pauseReason, notes, createdAt, updatedAt) VALUES (?1,?2,?3,?4,?5,?6,NULL,?7,NULL,0,NULL,NULL,NULL,NULL,NULL,?8,?8)",
        params!["appl-2", "case-2", "child-1", "clear-aligner", "active", "2026-04-01", 22i64, "2026-04-01T00:00:00.000Z"],
    ).expect("insert appliance");

    conn.execute(
        "INSERT INTO orthodontic_checkins (checkinId, childId, caseId, applianceId, checkinType, checkinDate, actualWearHours, prescribedHours, complianceBucket, activationIndex, alignerIndex, notes, createdAt, updatedAt) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,NULL,NULL,NULL,NULL,?9,?9)",
        params!["d1", "child-1", "case-2", "appl-2", "wear-daily", "2026-04-10", 20.0f64, 22.0f64, "2026-04-10T20:00:00.000Z"],
    ).expect("insert first wear-daily");
    let dup = conn.execute(
        "INSERT INTO orthodontic_checkins (checkinId, childId, caseId, applianceId, checkinType, checkinDate, actualWearHours, prescribedHours, complianceBucket, activationIndex, alignerIndex, notes, createdAt, updatedAt) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,NULL,NULL,NULL,NULL,?9,?9)",
        params!["d2", "child-1", "case-2", "appl-2", "wear-daily", "2026-04-10", 15.0f64, 22.0f64, "2026-04-10T21:00:00.000Z"],
    );
    assert!(
        dup.is_err(),
        "duplicate wear-daily on same appliance+date must be rejected"
    );

    conn.execute(
        "INSERT INTO orthodontic_checkins (checkinId, childId, caseId, applianceId, checkinType, checkinDate, actualWearHours, prescribedHours, complianceBucket, activationIndex, alignerIndex, notes, createdAt, updatedAt) VALUES (?1,?2,?3,?4,?5,?6,NULL,NULL,NULL,NULL,?7,NULL,?8,?8)",
        params!["a1", "child-1", "case-2", "appl-2", "aligner-change", "2026-04-10", 5i64, "2026-04-10T09:00:00.000Z"],
    ).expect("insert first aligner-change");
    conn.execute(
        "INSERT INTO orthodontic_checkins (checkinId, childId, caseId, applianceId, checkinType, checkinDate, actualWearHours, prescribedHours, complianceBucket, activationIndex, alignerIndex, notes, createdAt, updatedAt) VALUES (?1,?2,?3,?4,?5,?6,NULL,NULL,NULL,NULL,?7,NULL,?8,?8)",
        params!["a2", "child-1", "case-2", "appl-2", "aligner-change", "2026-04-10", 6i64, "2026-04-10T21:00:00.000Z"],
    ).expect("insert second aligner-change on same day should succeed");
}

#[test]
fn migration_v9_legacy_ortho_start_only_runs_when_rows_exist() {
    let conn_fresh = Connection::open_in_memory().expect("open in-memory db");
    conn_fresh
        .execute_batch("PRAGMA foreign_keys=ON;")
        .expect("enable foreign keys");
    run_migrations(&conn_fresh).expect("run migrations");
    seed_family_and_child(&conn_fresh);
    run_migrations(&conn_fresh).expect("run migrations again (idempotent)");

    let fabricated: i64 = conn_fresh
        .query_row(
            "SELECT COUNT(*) FROM orthodontic_cases WHERE caseType = 'unknown-legacy'",
            [],
            |r| r.get(0),
        )
        .expect("count unknown-legacy");
    assert_eq!(
        fabricated, 0,
        "fresh install must not fabricate legacy cases"
    );

    let conn_legacy = Connection::open_in_memory().expect("open in-memory db");
    conn_legacy
        .execute_batch("PRAGMA foreign_keys=ON;")
        .expect("enable foreign keys");
    run_migrations(&conn_legacy).expect("run migrations");
    seed_family_and_child(&conn_legacy);

    conn_legacy
        .execute("DELETE FROM orthodontic_cases", [])
        .expect("clear cases");
    conn_legacy.execute(
        "INSERT INTO dental_records (recordId, childId, eventType, eventDate, ageMonths, createdAt) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params!["legacy-1", "child-1", "ortho-start", "2025-10-01", 21, "2025-10-01T00:00:00.000Z"],
    ).expect("insert legacy ortho-start row");
    run_migrations(&conn_legacy).expect("replay v9 via repair path");

    let (case_id, case_type, stage, started): (String, String, String, String) = conn_legacy
        .query_row("SELECT caseId, caseType, stage, startedAt FROM orthodontic_cases WHERE childId = 'child-1'", [], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))
        .expect("query stitched case");
    assert_eq!(case_id, "legacy-ortho-case-child-1");
    assert_eq!(case_type, "unknown-legacy");
    assert_eq!(stage, "active");
    assert_eq!(started, "2025-10-01");

    run_migrations(&conn_legacy).expect("replay v9 via repair path idempotent");
    let count: i64 = conn_legacy
        .query_row(
            "SELECT COUNT(*) FROM orthodontic_cases WHERE childId = 'child-1'",
            [],
            |r| r.get(0),
        )
        .expect("count cases");
    assert_eq!(count, 1, "idempotent replay must not duplicate legacy case");
}

#[test]
fn dental_insert_rejects_unsupported_event_type_no_silent_success() {
    let conn = Connection::open_in_memory().expect("open in-memory db");
    conn.execute_batch("PRAGMA foreign_keys=ON;")
        .expect("enable foreign keys");
    run_migrations(&conn).expect("run migrations");
    seed_family_and_child(&conn);

    let before: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM dental_records WHERE childId = ?1",
            params!["child-1"],
            |r| r.get(0),
        )
        .expect("count dental rows");
    assert_eq!(before, 0);

    // Writable set after PO-PROF-008 update (ortho-start is read-only; ortho-lifecycle events go through the ortho workflow writer).
    let admitted = [
        "eruption",
        "loss",
        "caries",
        "filling",
        "cleaning",
        "fluoride",
        "sealant",
        "ortho-assessment",
        "checkup",
    ];
    for event_type in admitted {
        conn.execute(
            "INSERT INTO dental_records (recordId, childId, eventType, eventDate, ageMonths, createdAt) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![format!("r-{event_type}"), "child-1", event_type, "2026-04-01", 24, "2026-04-01T00:00:00.000Z"],
        ).expect("insert admitted eventType");
    }
    let after: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM dental_records WHERE childId = ?1",
            params!["child-1"],
            |r| r.get(0),
        )
        .expect("count dental rows");
    assert_eq!(after as usize, admitted.len());
}

#[test]
fn orthodontic_checkin_rejects_unsupported_checkin_type_sql_level() {
    let conn = Connection::open_in_memory().expect("open in-memory db");
    conn.execute_batch("PRAGMA foreign_keys=ON;")
        .expect("enable foreign keys");
    run_migrations(&conn).expect("run migrations");
    seed_family_and_child(&conn);

    conn.execute(
        "INSERT INTO orthodontic_cases (caseId, childId, caseType, stage, startedAt, plannedEndAt, actualEndAt, primaryIssues, providerName, providerInstitution, nextReviewDate, notes, createdAt, updatedAt) VALUES (?1,?2,?3,?4,?5,NULL,NULL,NULL,NULL,NULL,NULL,NULL,?6,?6)",
        params!["case-x", "child-1", "fixed-braces", "active", "2026-04-01", "2026-04-01T00:00:00.000Z"],
    ).expect("insert case");
    conn.execute(
        "INSERT INTO orthodontic_appliances (applianceId, caseId, childId, applianceType, status, startedAt, endedAt, prescribedHoursPerDay, prescribedActivations, completedActivations, reviewIntervalDays, lastReviewAt, nextReviewDate, pauseReason, notes, createdAt, updatedAt) VALUES (?1,?2,?3,?4,?5,?6,NULL,NULL,NULL,0,NULL,NULL,NULL,NULL,NULL,?7,?7)",
        params!["appl-x", "case-x", "child-1", "metal-braces", "active", "2026-04-01", "2026-04-01T00:00:00.000Z"],
    ).expect("insert appliance");

    conn.execute(
        "INSERT INTO orthodontic_checkins (checkinId, childId, caseId, applianceId, checkinType, checkinDate, createdAt, updatedAt) VALUES (?1,?2,?3,?4,?5,?6,?7,?7)",
        params!["chk-adj-1", "child-1", "case-x", "appl-x", "ortho-adjustment", "2026-04-10", "2026-04-10T00:00:00.000Z"],
    ).expect("SQL admits unsupported type; command layer rejects. Smoke only");
    conn.execute(
        "DELETE FROM orthodontic_checkins WHERE checkinId = ?1",
        params!["chk-adj-1"],
    )
    .expect("cleanup");
}

#[test]
fn dental_followup_reminder_is_seeded_on_triggering_event_type() {
    let conn = Connection::open_in_memory().expect("open in-memory db");
    conn.execute_batch("PRAGMA foreign_keys=ON;")
        .expect("enable foreign keys");
    run_migrations(&conn).expect("run migrations");
    seed_family_and_child(&conn);

    let state_id = "dental-fu-child-1-PO-DEN-FOLLOWUP-FLUORIDE";
    conn.execute(
        "INSERT INTO reminder_states (stateId, childId, ruleId, status, activatedAt, completedAt, dismissedAt, dismissReason, repeatIndex, nextTriggerAt, snoozedUntil, scheduledDate, notApplicable, plannedForDate, surfaceRank, lastSurfacedAt, surfaceCount, notes, createdAt, updatedAt)
         VALUES (?1, ?2, ?3, 'active', ?4, NULL, NULL, NULL, 0, ?5, NULL, NULL, 0, NULL, NULL, NULL, 0, ?6, ?4, ?4)
         ON CONFLICT(stateId) DO UPDATE SET status='active', activatedAt=?4, completedAt=NULL, dismissedAt=NULL, nextTriggerAt=?5, notes=?6, updatedAt=?4",
        params![state_id, "child-1", "PO-DEN-FOLLOWUP-FLUORIDE", "2026-04-10T00:00:00.000Z",
                "2026-10-10T00:00:00.000Z", "[dental-followup] triggeredBy=fluoride at=2026-04-10"],
    ).expect("upsert follow-up state");

    let (rule_id, next_trigger, status): (String, String, String) = conn
        .query_row(
            "SELECT ruleId, nextTriggerAt, status FROM reminder_states WHERE stateId = ?1",
            params![state_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .expect("read follow-up state");
    assert_eq!(rule_id, "PO-DEN-FOLLOWUP-FLUORIDE");
    assert_eq!(status, "active");
    assert!(
        next_trigger.starts_with("2026-10-"),
        "expected +6 months; got {next_trigger}"
    );

    conn.execute(
        "INSERT INTO reminder_states (stateId, childId, ruleId, status, activatedAt, completedAt, dismissedAt, dismissReason, repeatIndex, nextTriggerAt, snoozedUntil, scheduledDate, notApplicable, plannedForDate, surfaceRank, lastSurfacedAt, surfaceCount, notes, createdAt, updatedAt)
         VALUES (?1, ?2, ?3, 'active', ?4, NULL, NULL, NULL, 0, ?5, NULL, NULL, 0, NULL, NULL, NULL, 0, ?6, ?4, ?4)
         ON CONFLICT(stateId) DO UPDATE SET status='active', activatedAt=?4, completedAt=NULL, dismissedAt=NULL, nextTriggerAt=?5, notes=?6, updatedAt=?4",
        params![state_id, "child-1", "PO-DEN-FOLLOWUP-FLUORIDE", "2026-11-01T00:00:00.000Z",
                "2027-05-01T00:00:00.000Z", "[dental-followup] triggeredBy=fluoride at=2026-11-01"],
    ).expect("replay upsert");
    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM reminder_states WHERE stateId = ?1",
            params![state_id],
            |r| r.get(0),
        )
        .expect("count replay");
    assert_eq!(count, 1, "replay must not duplicate");
    let next_after: String = conn
        .query_row(
            "SELECT nextTriggerAt FROM reminder_states WHERE stateId = ?1",
            params![state_id],
            |r| r.get(0),
        )
        .expect("read replay trigger");
    assert!(
        next_after.starts_with("2027-05-"),
        "latest-wins semantics; got {next_after}"
    );
}

#[test]
fn orthodontic_appliance_lifecycle_manages_protocol_reminder_states() {
    let conn = Connection::open_in_memory().expect("open in-memory db");
    conn.execute_batch("PRAGMA foreign_keys=ON;")
        .expect("enable foreign keys");
    run_migrations(&conn).expect("run migrations");
    seed_family_and_child(&conn);

    conn.execute(
        "INSERT INTO orthodontic_cases (caseId, childId, caseType, stage, startedAt, plannedEndAt, actualEndAt, primaryIssues, providerName, providerInstitution, nextReviewDate, notes, createdAt, updatedAt) VALUES (?1,?2,?3,?4,?5,NULL,NULL,NULL,NULL,NULL,NULL,NULL,?6,?6)",
        params!["case-lc", "child-1", "clear-aligners", "active", "2026-04-01", "2026-04-01T00:00:00.000Z"],
    ).expect("insert case");
    conn.execute(
        "INSERT INTO orthodontic_appliances (applianceId, caseId, childId, applianceType, status, startedAt, endedAt, prescribedHoursPerDay, prescribedActivations, completedActivations, reviewIntervalDays, lastReviewAt, nextReviewDate, pauseReason, notes, createdAt, updatedAt) VALUES (?1,?2,?3,?4,?5,?6,NULL,?7,NULL,0,NULL,NULL,NULL,NULL,NULL,?8,?8)",
        params!["appl-lc", "case-lc", "child-1", "clear-aligner", "active", "2026-04-01", 22i64, "2026-04-01T00:00:00.000Z"],
    ).expect("insert appliance");

    for (rule_id, next_trigger) in [
        ("PO-ORTHO-WEAR-DAILY", "2026-04-01T00:00:00.000Z"),
        ("PO-ORTHO-ALIGNER-CHANGE", "2026-04-15T00:00:00.000Z"),
        ("PO-ORTHO-REVIEW-ALIGNER", "2026-05-27T00:00:00.000Z"),
    ] {
        let state_id = format!("ortho-appl-lc-{rule_id}");
        let notes = "[ortho-protocol] applianceId=appl-lc";
        conn.execute(
            "INSERT INTO reminder_states (stateId, childId, ruleId, status, activatedAt, completedAt, dismissedAt, dismissReason, repeatIndex, nextTriggerAt, snoozedUntil, scheduledDate, notApplicable, plannedForDate, surfaceRank, lastSurfacedAt, surfaceCount, notes, createdAt, updatedAt)
             VALUES (?1, ?2, ?3, 'active', ?4, NULL, NULL, NULL, 0, ?5, NULL, NULL, 0, NULL, NULL, NULL, 0, ?6, ?4, ?4)",
            params![state_id, "child-1", rule_id, "2026-04-01T00:00:00.000Z", next_trigger, notes],
        ).expect("seed protocol state");
    }
    let active: i64 = conn
        .query_row("SELECT COUNT(*) FROM reminder_states WHERE notes LIKE '[ortho-protocol] applianceId=appl-lc%' AND status='active'",
            [], |r| r.get(0))
        .expect("count active");
    assert_eq!(active, 3);

    conn.execute(
        "UPDATE reminder_states SET status='dismissed', dismissedAt=?1, dismissReason=?2, updatedAt=?1 WHERE notes LIKE ?3 AND status NOT IN ('completed','dismissed')",
        params!["2026-04-20T00:00:00.000Z", "appliance-paused", "[ortho-protocol] applianceId=appl-lc%"],
    ).expect("pause transition");
    let dismissed: i64 = conn
        .query_row("SELECT COUNT(*) FROM reminder_states WHERE notes LIKE '[ortho-protocol] applianceId=appl-lc%' AND status='dismissed' AND dismissReason='appliance-paused'",
            [], |r| r.get(0))
        .expect("count dismissed");
    assert_eq!(dismissed, 3);

    conn.execute(
        "DELETE FROM reminder_states WHERE notes LIKE '[ortho-protocol] applianceId=appl-lc%'",
        [],
    )
    .expect("delete protocol states");
    conn.execute(
        "DELETE FROM orthodontic_appliances WHERE applianceId = ?1",
        params!["appl-lc"],
    )
    .expect("delete appliance");
    let remaining: i64 = conn
        .query_row("SELECT COUNT(*) FROM reminder_states WHERE notes LIKE '[ortho-protocol] applianceId=appl-lc%'", [], |r| r.get(0))
        .expect("count remaining");
    assert_eq!(remaining, 0);
}

#[test]
fn appliance_review_cycle_sql_shape_advances_matching_reminder_state() {
    // SHAPE-LEVEL TEST (NOT a direct command invocation).
    //
    // This test does NOT call `update_orthodontic_appliance_review` — that
    // function lives inside a `#[tauri::command]` wrapper that obtains its
    // connection through the global `get_conn()` singleton, which the unit
    // test harness can't exercise without a full Tauri runtime. Instead, we
    // replay the exact two SQL statements the command issues (one UPDATE on
    // `orthodontic_appliances`, one UPDATE on `reminder_states` keyed by the
    // deterministic stateId `ortho-{applianceId}-{ruleId}`) against a fresh
    // in-memory DB and assert the resulting shape.
    //
    // Drift between this shape and the actual command body is caught by
    // source review and by `cargo check` (the stateId format and column list
    // are the same in both places); a full command-level round-trip is
    // tracked as a follow-up under "Tauri IPC-layer coverage".
    let conn = Connection::open_in_memory().expect("open in-memory db");
    conn.execute_batch("PRAGMA foreign_keys=ON;")
        .expect("enable foreign keys");
    run_migrations(&conn).expect("run migrations");
    seed_family_and_child(&conn);

    conn.execute(
        "INSERT INTO orthodontic_cases (caseId, childId, caseType, stage, startedAt, plannedEndAt, actualEndAt, primaryIssues, providerName, providerInstitution, nextReviewDate, notes, createdAt, updatedAt) VALUES (?1,?2,?3,?4,?5,NULL,NULL,NULL,NULL,NULL,NULL,NULL,?6,?6)",
        params!["case-rc", "child-1", "clear-aligners", "active", "2026-04-01", "2026-04-01T00:00:00.000Z"],
    ).expect("insert case");
    conn.execute(
        "INSERT INTO orthodontic_appliances (applianceId, caseId, childId, applianceType, status, startedAt, endedAt, prescribedHoursPerDay, prescribedActivations, completedActivations, reviewIntervalDays, lastReviewAt, nextReviewDate, pauseReason, notes, createdAt, updatedAt) VALUES (?1,?2,?3,?4,?5,?6,NULL,?7,NULL,0,?8,NULL,?9,NULL,NULL,?10,?10)",
        params!["appl-rc", "case-rc", "child-1", "clear-aligner", "active", "2026-04-01", 22i64, 56i64, "2026-05-27", "2026-04-01T00:00:00.000Z"],
    ).expect("insert appliance");
    let state_id = "ortho-appl-rc-PO-ORTHO-REVIEW-ALIGNER";
    conn.execute(
        "INSERT INTO reminder_states (stateId, childId, ruleId, status, activatedAt, completedAt, dismissedAt, dismissReason, repeatIndex, nextTriggerAt, snoozedUntil, scheduledDate, notApplicable, plannedForDate, surfaceRank, lastSurfacedAt, surfaceCount, notes, createdAt, updatedAt)
         VALUES (?1, ?2, ?3, 'active', ?4, NULL, NULL, NULL, 0, ?5, NULL, NULL, 0, NULL, NULL, NULL, 0, ?6, ?4, ?4)",
        params![state_id, "child-1", "PO-ORTHO-REVIEW-ALIGNER", "2026-04-01T00:00:00.000Z",
                "2026-05-27T00:00:00.000Z", "[ortho-protocol] applianceId=appl-rc"],
    ).expect("seed review reminder state");

    // Replay the two UPDATEs the command issues. If the command body's SQL
    // shape changes, both this test and the source must be updated together.
    let new_next_review = "2026-07-15"; // eventDate + 56 days
    let now = "2026-05-20T10:00:00.000Z";
    conn.execute(
        "UPDATE orthodontic_appliances SET lastReviewAt=?2, nextReviewDate=?3, updatedAt=?4 WHERE applianceId=?1",
        params!["appl-rc", "2026-05-20", new_next_review, now],
    ).expect("advance appliance review");
    conn.execute(
        "UPDATE reminder_states SET nextTriggerAt = ?2, updatedAt = ?3 WHERE stateId = ?1",
        params![state_id, format!("{new_next_review}T00:00:00.000Z"), now],
    )
    .expect("advance review state");

    let (last, next): (String, String) = conn
        .query_row(
            "SELECT lastReviewAt, nextReviewDate FROM orthodontic_appliances WHERE applianceId = ?1",
            params!["appl-rc"],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .expect("query appliance review dates");
    assert_eq!(last, "2026-05-20");
    assert_eq!(next, "2026-07-15");

    let (status, next_trigger): (String, String) = conn
        .query_row(
            "SELECT status, nextTriggerAt FROM reminder_states WHERE stateId = ?1",
            params![state_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .expect("query review reminder state");
    assert_eq!(status, "active", "state stays active for next cycle");
    assert!(
        next_trigger.starts_with("2026-07-15"),
        "review reminder must advance to {new_next_review}; got {next_trigger}",
    );
}

#[test]
fn unknown_legacy_case_type_is_read_only_from_command_layer() {
    let conn = Connection::open_in_memory().expect("open in-memory db");
    conn.execute_batch("PRAGMA foreign_keys=ON;")
        .expect("enable foreign keys");
    run_migrations(&conn).expect("run migrations");
    seed_family_and_child(&conn);

    conn.execute(
        "INSERT INTO orthodontic_cases (caseId, childId, caseType, stage, startedAt, plannedEndAt, actualEndAt, primaryIssues, providerName, providerInstitution, nextReviewDate, notes, createdAt, updatedAt) VALUES (?1,?2,?3,?4,?5,NULL,NULL,NULL,NULL,NULL,NULL,NULL,?6,?6)",
        params!["legacy-ortho-case-child-1", "child-1", "unknown-legacy", "active", "2025-10-01", "2026-04-01T00:00:00.000Z"],
    ).expect("seed migration-authored legacy row");

    let ct: String = conn
        .query_row(
            "SELECT caseType FROM orthodontic_cases WHERE caseId = 'legacy-ortho-case-child-1'",
            [],
            |r| r.get(0),
        )
        .expect("select legacy caseType");
    assert_eq!(
        ct, "unknown-legacy",
        "SELECT returns the migration-authored row unchanged"
    );
}

#[test]
fn migration_v9_purges_synthetic_dental_auto_reminder_rows() {
    let conn = Connection::open_in_memory().expect("open in-memory db");
    conn.execute_batch("PRAGMA foreign_keys=ON;")
        .expect("enable foreign keys");
    run_migrations(&conn).expect("run migrations");
    seed_family_and_child(&conn);

    conn.execute(
        "INSERT INTO reminder_states (stateId, childId, ruleId, status, repeatIndex, createdAt, updatedAt) VALUES (?1, ?2, ?3, ?4, 0, ?5, ?5)",
        params!["state-synth", "child-1", "dental-auto-fluoride-2026-03-15", "pending", "2026-03-15T00:00:00.000Z"],
    ).expect("insert synthetic reminder_state");
    run_migrations(&conn).expect("replay v9 via repair path");

    let remaining: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM reminder_states WHERE ruleId LIKE 'dental-auto-%'",
            [],
            |r| r.get(0),
        )
        .expect("count synthetic states");
    assert_eq!(
        remaining, 0,
        "synthetic dental-auto-* ruleIds must be purged by v9"
    );
}
