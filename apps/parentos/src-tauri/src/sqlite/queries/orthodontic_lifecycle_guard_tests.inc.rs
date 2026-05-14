#[cfg(test)]
mod lifecycle_guard_tests {
    use super::{
        assert_no_other_non_completed_case, assert_parent_case_accepts_appliance,
        derive_initial_review_schedule, next_repeat_index_for_seed,
        repair_protocol_state_after_checkin_delete,
    };
    use crate::sqlite::migrations::run_migrations;
    use rusqlite::{params, Connection};
    fn seed_family_and_child(conn: &Connection) {
        conn.execute(
            "INSERT INTO families (familyId, displayName, createdAt, updatedAt) VALUES (?1, ?2, ?3, ?3)",
            params!["family-1", "Test Family", "2026-04-01T00:00:00.000Z"],
        )
        .expect("insert family");
        conn.execute(
            "INSERT INTO children (childId, familyId, displayName, gender, birthDate, nurtureMode, createdAt, updatedAt) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)",
            params![
                "child-1",
                "family-1",
                "Test Child",
                "female",
                "2018-04-01",
                "balanced",
                "2026-04-01T00:00:00.000Z"
            ],
        )
        .expect("insert child");
    }
    #[test]
    fn initial_review_schedule_uses_yaml_default_or_override() {
        let derived = derive_initial_review_schedule("clear-aligner", "2026-04-01", None)
            .expect("derive default review schedule");
        assert_eq!(derived.0, Some(56));
        assert_eq!(derived.1.as_deref(), Some("2026-05-27"));
        let overridden = derive_initial_review_schedule("clear-aligner", "2026-04-01", Some(21))
            .expect("derive override review schedule");
        assert_eq!(overridden.0, Some(21));
        assert_eq!(overridden.1.as_deref(), Some("2026-04-22"));
    }
    #[test]
    fn parent_case_guard_rejects_cross_child_and_unknown_legacy() {
        let conn = Connection::open_in_memory().expect("open in-memory db");
        conn.execute_batch("PRAGMA foreign_keys=ON;")
            .expect("enable foreign keys");
        run_migrations(&conn).expect("run migrations");
        seed_family_and_child(&conn);
        conn.execute(
            "INSERT INTO children (childId, familyId, displayName, gender, birthDate, nurtureMode, createdAt, updatedAt) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)",
            params![
                "child-2",
                "family-1",
                "Second Child",
                "male",
                "2017-01-01",
                "balanced",
                "2026-04-01T00:00:00.000Z"
            ],
        )
        .expect("insert second child");
        conn.execute(
            "INSERT INTO orthodontic_cases (caseId, childId, caseType, stage, startedAt, createdAt, updatedAt) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)",
            params!["case-ok", "child-1", "clear-aligners", "active", "2026-04-01", "2026-04-01T00:00:00.000Z"],
        )
        .expect("insert normal case");
        conn.execute(
            "INSERT INTO orthodontic_cases (caseId, childId, caseType, stage, startedAt, createdAt, updatedAt) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)",
            params!["case-legacy", "child-1", "unknown-legacy", "active", "2026-04-01", "2026-04-01T00:00:00.000Z"],
        )
        .expect("insert legacy case");
        let cross_child = assert_parent_case_accepts_appliance(&conn, "case-ok", "child-2")
            .expect_err("cross-child insert must fail");
        assert!(cross_child.contains("does not match parent case.childId"));
        let legacy = assert_parent_case_accepts_appliance(&conn, "case-legacy", "child-1")
            .expect_err("unknown-legacy insert must fail");
        assert!(legacy.contains("unknown-legacy"));
    }
    #[test]
    fn deleting_expander_activation_recomputes_counter_and_reactivates_protocol_state() {
        let conn = Connection::open_in_memory().expect("open in-memory db");
        conn.execute_batch("PRAGMA foreign_keys=ON;")
            .expect("enable foreign keys");
        run_migrations(&conn).expect("run migrations");
        seed_family_and_child(&conn);
        conn.execute(
            "INSERT INTO orthodontic_cases (caseId, childId, caseType, stage, startedAt, createdAt, updatedAt) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)",
            params!["case-exp", "child-1", "early-intervention", "active", "2026-04-01", "2026-04-01T00:00:00.000Z"],
        )
        .expect("insert case");
        conn.execute(
            "INSERT INTO orthodontic_appliances (applianceId, caseId, childId, applianceType, status, startedAt, prescribedActivations, completedActivations, reviewIntervalDays, nextReviewDate, createdAt, updatedAt)
             VALUES (?1, ?2, ?3, 'expander', 'active', ?4, 2, 2, 42, '2026-05-13', ?5, ?5)",
            params!["appl-exp", "case-exp", "child-1", "2026-04-01", "2026-04-01T00:00:00.000Z"],
        )
        .expect("insert expander appliance");
        conn.execute(
            "INSERT INTO orthodontic_checkins (checkinId, childId, caseId, applianceId, checkinType, checkinDate, activationIndex, createdAt, updatedAt)
             VALUES (?1, ?2, ?3, ?4, 'expander-activation', '2026-04-02', 1, ?5, ?5)",
            params!["chk-1", "child-1", "case-exp", "appl-exp", "2026-04-02T09:00:00.000Z"],
        )
        .expect("insert first activation");
        conn.execute(
            "INSERT INTO orthodontic_checkins (checkinId, childId, caseId, applianceId, checkinType, checkinDate, activationIndex, createdAt, updatedAt)
             VALUES (?1, ?2, ?3, ?4, 'expander-activation', '2026-04-03', 2, ?5, ?5)",
            params!["chk-2", "child-1", "case-exp", "appl-exp", "2026-04-03T09:00:00.000Z"],
        )
        .expect("insert second activation");
        conn.execute(
            "INSERT INTO reminder_states (stateId, childId, ruleId, status, activatedAt, completedAt, dismissedAt, dismissReason, repeatIndex, nextTriggerAt, notApplicable, surfaceCount, notes, createdAt, updatedAt)
             VALUES (?1, ?2, 'PO-ORTHO-EXPANDER-ACTIVATION', 'completed', ?3, ?3, NULL, NULL, 0, '2026-04-04T00:00:00.000Z', 0, 0, ?4, ?3, ?3)",
            params![
                "ortho-appl-exp-PO-ORTHO-EXPANDER-ACTIVATION",
                "child-1",
                "2026-04-03T09:00:00.000Z",
                "[ortho-protocol] applianceId=appl-exp"
            ],
        )
        .expect("seed completed protocol state");
        conn.execute(
            "DELETE FROM orthodontic_checkins WHERE checkinId = 'chk-2'",
            [],
        )
        .expect("delete latest activation");
        repair_protocol_state_after_checkin_delete(
            &conn,
            "appl-exp",
            "expander-activation",
            "2026-04-10T00:00:00.000Z",
        )
        .expect("repair activation state");
        let completed_activations: i32 = conn
            .query_row(
                "SELECT completedActivations FROM orthodontic_appliances WHERE applianceId = 'appl-exp'",
                [],
                |row| row.get(0),
            )
            .expect("read completedActivations");
        assert_eq!(completed_activations, 1);
        let (status, next_trigger): (String, String) = conn
            .query_row(
                "SELECT status, nextTriggerAt FROM reminder_states WHERE stateId = 'ortho-appl-exp-PO-ORTHO-EXPANDER-ACTIVATION'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("read repaired state");
        assert_eq!(status, "active");
        assert!(
            next_trigger.starts_with("2026-04-03"),
            "expected next trigger to re-open from remaining activation history; got {next_trigger}",
        );
    }

    /// PO-ORTHO-002b: a child may hold at most one non-completed case. The
    /// constraint helper inspects the table and refuses a second insert; an
    /// already-completed case never blocks a new one.
    #[test]
    fn assert_no_other_non_completed_case_admits_first_blocks_second_and_admits_after_close() {
        let conn = Connection::open_in_memory().expect("open in-memory db");
        conn.execute_batch("PRAGMA foreign_keys=ON;")
            .expect("enable foreign keys");
        run_migrations(&conn).expect("run migrations");
        seed_family_and_child(&conn);

        // No cases yet → admits.
        assert_no_other_non_completed_case(&conn, "child-1", None)
            .expect("no cases yet — admit");

        // Insert a non-completed case directly (raw SQL bypasses the command
        // layer; this lets us test the helper independently).
        conn.execute(
            "INSERT INTO orthodontic_cases (caseId, childId, caseType, stage, startedAt, plannedEndAt, actualEndAt, primaryIssues, providerName, providerInstitution, nextReviewDate, notes, createdAt, updatedAt) VALUES (?1,?2,?3,?4,?5,NULL,NULL,NULL,NULL,NULL,NULL,NULL,?6,?6)",
            params!["case-A", "child-1", "clear-aligners", "active", "2026-04-01", "2026-04-01T00:00:00.000Z"],
        )
        .expect("seed case A");

        let blocked = assert_no_other_non_completed_case(&conn, "child-1", None);
        assert!(blocked.is_err(), "second non-completed insert must be blocked");
        let msg = blocked.unwrap_err();
        assert!(msg.contains("PO-ORTHO-002b"), "error must cite PO-ORTHO-002b; got: {msg}");

        // The same call with `excluding_case_id = Some(case-A)` admits — this
        // is the path used by `update_orthodontic_case` editing case A itself.
        assert_no_other_non_completed_case(&conn, "child-1", Some("case-A"))
            .expect("excluding the case being edited must admit");

        // Complete case A → a new non-completed case must be admitted.
        conn.execute(
            "UPDATE orthodontic_cases SET stage='completed', actualEndAt='2026-09-01' WHERE caseId='case-A'",
            [],
        )
        .expect("complete case A");
        assert_no_other_non_completed_case(&conn, "child-1", None)
            .expect("after completing the prior case, a new one is admissible");

        // Different child is always independent.
        conn.execute(
            "INSERT INTO children (childId, familyId, displayName, gender, birthDate, nurtureMode, createdAt, updatedAt) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)",
            params![
                "child-2",
                "family-1",
                "Second",
                "male",
                "2017-04-01",
                "balanced",
                "2026-04-01T00:00:00.000Z"
            ],
        )
        .expect("seed second child");
        assert_no_other_non_completed_case(&conn, "child-2", None)
            .expect("child-2 has no cases — admit");
    }

    /// Regression: a child with two concurrent appliances of the same type
    /// (e.g. two clear-aligner appliances across two cases) must not collide
    /// on the `UNIQUE (childId, ruleId, repeatIndex)` constraint when seeding
    /// per-appliance protocol reminder_states. The seed allocator must reuse
    /// the existing repeatIndex on stateId replay and otherwise pick the next
    /// free integer.
    #[test]
    fn next_repeat_index_for_seed_avoids_unique_collision_across_appliances() {
        let conn = Connection::open_in_memory().expect("open in-memory db");
        conn.execute_batch("PRAGMA foreign_keys=ON;")
            .expect("enable foreign keys");
        run_migrations(&conn).expect("run migrations");
        seed_family_and_child(&conn);

        // First appliance for child-1 already seeded a row at repeatIndex=0.
        conn.execute(
            "INSERT INTO reminder_states (stateId, childId, ruleId, status, activatedAt, completedAt, dismissedAt, dismissReason, repeatIndex, nextTriggerAt, notApplicable, surfaceCount, notes, createdAt, updatedAt)
             VALUES (?1, ?2, 'PO-ORTHO-ALIGNER-CHANGE', 'active', ?3, NULL, NULL, NULL, 0, ?4, 0, 0, ?5, ?3, ?3)",
            params![
                "ortho-appl-A-PO-ORTHO-ALIGNER-CHANGE",
                "child-1",
                "2026-04-01T00:00:00.000Z",
                "2026-04-01T00:00:00.000Z",
                "[ortho-protocol] applianceId=appl-A",
            ],
        )
        .expect("seed first appliance state");

        // Replay seed for the SAME appliance must reuse repeatIndex=0.
        let replay = next_repeat_index_for_seed(
            &conn,
            "ortho-appl-A-PO-ORTHO-ALIGNER-CHANGE",
            "child-1",
            "PO-ORTHO-ALIGNER-CHANGE",
        )
        .expect("replay repeat index");
        assert_eq!(replay, 0, "replay must reuse existing repeatIndex");

        // Seed for a NEW appliance under same child + rule must pick the next
        // free repeatIndex (1) so the UNIQUE constraint does not fire.
        let next = next_repeat_index_for_seed(
            &conn,
            "ortho-appl-B-PO-ORTHO-ALIGNER-CHANGE",
            "child-1",
            "PO-ORTHO-ALIGNER-CHANGE",
        )
        .expect("new repeat index");
        assert_eq!(next, 1, "second concurrent appliance must get repeatIndex=1");

        // Inserting the second row with the new repeatIndex must succeed.
        conn.execute(
            "INSERT INTO reminder_states (stateId, childId, ruleId, status, activatedAt, completedAt, dismissedAt, dismissReason, repeatIndex, nextTriggerAt, notApplicable, surfaceCount, notes, createdAt, updatedAt)
             VALUES (?1, ?2, 'PO-ORTHO-ALIGNER-CHANGE', 'active', ?3, NULL, NULL, NULL, ?4, ?5, 0, 0, ?6, ?3, ?3)",
            params![
                "ortho-appl-B-PO-ORTHO-ALIGNER-CHANGE",
                "child-1",
                "2026-05-01T00:00:00.000Z",
                next,
                "2026-05-01T00:00:00.000Z",
                "[ortho-protocol] applianceId=appl-B",
            ],
        )
        .expect("second appliance state must not collide");

        // Sanity: a different rule on the same child still starts at 0.
        let other_rule = next_repeat_index_for_seed(
            &conn,
            "ortho-appl-A-PO-ORTHO-REVIEW-ALIGNER",
            "child-1",
            "PO-ORTHO-REVIEW-ALIGNER",
        )
        .expect("other rule repeat index");
        assert_eq!(other_rule, 0);
    }
}
