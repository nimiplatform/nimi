// `compute_compliance_bucket` and the corresponding daily-bucket thresholds
// were retired by migration v15 along with `wear-daily` / `retention-wear`
// (PO-ORTHO-005b). Compliance is now a per-cycle continuous projection
// computed in the renderer (`orthodontic-derive.ts`); no Rust helper is
// needed at the storage seam.
#[cfg(test)]
mod protocol_catalog_drift_guard {
    //! Spec↔runtime drift guard for the orthodontic protocol catalog.
    //!
    //! The Rust catalog embedded above (`protocols_for_appliance`,
    //! `dental_followup_rule_for`, `APPLIANCE_TYPE_OPTIONS` style min-ages) is
    //! a performance mirror of `spec/kernel/tables/orthodontic-protocols.yaml`.
    //! The YAML remains the sole authority. This test parses the YAML at
    //! compile/test time and asserts the embedded catalog agrees. Any new
    //! protocol rule, renamed ruleId, changed applianceType-binding, or
    //! changed follow-up interval must update the YAML AND the Rust mirror
    //! together or this test fails.
    use super::{
        default_review_interval_days_for_rule, dental_followup_rule_for, protocols_for_appliance,
        review_rule_id_for_appliance,
    };
    use serde::Deserialize;
    use std::collections::{BTreeMap, BTreeSet};
    #[derive(Debug, Deserialize)]
    struct Spec {
        rules: Vec<ProtocolRuleSpec>,
        #[serde(rename = "dentalFollowUpRules")]
        dental_followup_rules: Vec<DentalFollowupRuleSpec>,
    }
    #[derive(Debug, Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct ProtocolRuleSpec {
        rule_id: String,
        #[serde(default)]
        appliance_types: Vec<String>,
        #[serde(default)]
        default_interval_days: Option<i64>,
    }
    #[derive(Debug, Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct DentalFollowupRuleSpec {
        rule_id: String,
        interval_months: i64,
        triggered_by: TriggeredBy,
    }
    #[derive(Debug, Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct TriggeredBy {
        dental_event_type: String,
    }
    const YAML: &str = include_str!("../../../../spec/kernel/tables/orthodontic-protocols.yaml");
    fn parse_spec() -> Spec {
        serde_yaml::from_str(YAML).expect("parse orthodontic-protocols.yaml")
    }
    /// Event-driven protocol rules: NOT seeded at appliance creation, so they
    /// MUST be excluded from the appliance-time `protocols_for_appliance`
    /// catalog comparison. The drift guard reconciles them separately by
    /// checking that they exist in both YAML and Rust admission lists.
    const EVENT_DRIVEN_RULE_IDS: &[&str] = &["PO-ORTHO-UNWEAR-OPEN"];

    #[test]
    fn rust_protocols_for_appliance_matches_yaml_appliance_bindings() {
        let spec = parse_spec();
        // Build YAML source of truth: appliance_type → set of ruleIds, but
        // strip out event-driven rules (they are not part of the appliance-creation
        // seeding catalog; PO-ORTHO-UNWEAR-OPEN is written by `insert_unwear_interval`).
        let mut yaml_by_appliance: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
        for rule in &spec.rules {
            if EVENT_DRIVEN_RULE_IDS.contains(&rule.rule_id.as_str()) {
                continue;
            }
            for appliance in &rule.appliance_types {
                yaml_by_appliance
                    .entry(appliance.clone())
                    .or_default()
                    .insert(rule.rule_id.clone());
            }
        }
        // Rust mirror for each appliance type declared in the YAML.
        for (appliance_type, yaml_rules) in &yaml_by_appliance {
            let rust_rules: BTreeSet<String> = protocols_for_appliance(appliance_type)
                .iter()
                .map(|p| p.rule_id.to_string())
                .collect();
            assert_eq!(
                &rust_rules, yaml_rules,
                "drift for applianceType \"{appliance_type}\": YAML {yaml_rules:?} vs Rust {rust_rules:?}",
            );
        }
        // Reverse direction: every rule the Rust catalog emits must exist in the YAML.
        let yaml_all: BTreeSet<String> = spec.rules.iter().map(|r| r.rule_id.clone()).collect();
        for appliance_type in yaml_by_appliance.keys() {
            for p in protocols_for_appliance(appliance_type) {
                assert!(
                    yaml_all.contains(p.rule_id),
                    "Rust catalog references ruleId \"{}\" not in orthodontic-protocols.yaml#rules",
                    p.rule_id,
                );
            }
        }
        // Event-driven rules: present in YAML must be admitted in Rust by an
        // explicit binding (covered by EVENT_DRIVEN_RULE_IDS) so the catalog
        // remains the sole source of truth even for non-seeded rules.
        for rule_id in EVENT_DRIVEN_RULE_IDS {
            assert!(
                yaml_all.contains(*rule_id),
                "EVENT_DRIVEN_RULE_IDS includes \"{rule_id}\" but it is missing from orthodontic-protocols.yaml#rules",
            );
        }
    }
    #[test]
    fn review_rule_mapping_and_intervals_match_yaml() {
        // Rule ids that are review-cycle closers per the YAML.
        const REVIEW_RULE_IDS: &[&str] = &[
            "PO-ORTHO-REVIEW-ALIGNER",
            "PO-ORTHO-REVIEW-FIXED",
            "PO-ORTHO-REVIEW-INTERCEPTIVE",
            "PO-ORTHO-RETENTION-REVIEW",
        ];
        let spec = parse_spec();
        let mut yaml_rule_by_appliance: BTreeMap<String, String> = BTreeMap::new();
        let mut yaml_default_days: BTreeMap<String, i64> = BTreeMap::new();
        for rule in &spec.rules {
            if !REVIEW_RULE_IDS.contains(&rule.rule_id.as_str()) {
                continue;
            }
            if let Some(days) = rule.default_interval_days {
                yaml_default_days.insert(rule.rule_id.clone(), days);
            }
            for appliance in &rule.appliance_types {
                let prior = yaml_rule_by_appliance.insert(appliance.clone(), rule.rule_id.clone());
                assert!(
                    prior.is_none(),
                    "YAML binds applianceType \"{appliance}\" to more than one review rule ({} and {}); review mapping must be one-to-one",
                    prior.unwrap_or_default(),
                    rule.rule_id,
                );
            }
        }
        // Every YAML review binding must match the Rust mapping.
        for (appliance_type, expected_rule_id) in &yaml_rule_by_appliance {
            let rust_mapping = review_rule_id_for_appliance(appliance_type);
            assert_eq!(
                rust_mapping,
                Some(expected_rule_id.as_str()),
                "review-rule drift for applianceType \"{appliance_type}\": Rust {rust_mapping:?} vs YAML {expected_rule_id}",
            );
        }
        // Reverse: every Rust-admitted applianceType in the YAML schema must yield a known review rule.
        for appliance_type in [
            "clear-aligner",
            "metal-braces",
            "ceramic-braces",
            "twin-block",
            "expander",
            "activator",
            "retainer-fixed",
            "retainer-removable",
        ] {
            let rust = review_rule_id_for_appliance(appliance_type);
            let yaml = yaml_rule_by_appliance
                .get(appliance_type)
                .map(String::as_str);
            assert_eq!(
                rust, yaml,
                "review-rule admission drift for \"{appliance_type}\": Rust={rust:?}, YAML={yaml:?}",
            );
        }
        // Default intervals must match for every review rule present in the YAML.
        for (rule_id, yaml_days) in &yaml_default_days {
            let rust_days = default_review_interval_days_for_rule(rule_id);
            assert_eq!(
                rust_days,
                Some(*yaml_days),
                "defaultIntervalDays drift for {rule_id}: Rust={rust_days:?} YAML={yaml_days}",
            );
        }
    }
    #[test]
    fn rust_dental_followup_rule_for_matches_yaml() {
        let spec = parse_spec();
        // Every YAML follow-up rule has a Rust mapping with the same ruleId + intervalMonths.
        for rule in &spec.dental_followup_rules {
            let event_type = &rule.triggered_by.dental_event_type;
            let mapped = dental_followup_rule_for(event_type)
                .unwrap_or_else(|| panic!("Rust dental_followup_rule_for({event_type}) returns None; YAML has {} with interval {}",
                    rule.rule_id, rule.interval_months));
            assert_eq!(
                mapped.0, rule.rule_id,
                "ruleId drift for dental eventType \"{event_type}\": Rust={} YAML={}",
                mapped.0, rule.rule_id,
            );
            assert_eq!(
                mapped.1, rule.interval_months,
                "intervalMonths drift for \"{event_type}\": Rust={} YAML={}",
                mapped.1, rule.interval_months,
            );
        }
        // Reverse direction: make sure Rust doesn't admit an event type the YAML doesn't list.
        let yaml_event_types: BTreeSet<&str> = spec
            .dental_followup_rules
            .iter()
            .map(|r| r.triggered_by.dental_event_type.as_str())
            .collect();
        for candidate in [
            "eruption",
            "loss",
            "caries",
            "filling",
            "cleaning",
            "fluoride",
            "sealant",
            "ortho-assessment",
            "checkup",
        ] {
            let admitted_by_rust = dental_followup_rule_for(candidate).is_some();
            let admitted_by_yaml = yaml_event_types.contains(candidate);
            assert_eq!(
                admitted_by_rust, admitted_by_yaml,
                "follow-up admission drift for eventType \"{candidate}\": Rust admits={admitted_by_rust}, YAML admits={admitted_by_yaml}",
            );
        }
    }
}
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
#[tauri::command]
pub fn insert_orthodontic_checkin(
    checkin_id: String,
    child_id: String,
    case_id: String,
    appliance_id: String,
    checkin_type: String,
    checkin_date: String,
    activation_index: Option<i32>,
    aligner_index: Option<i32>,
    notes: Option<String>,
    now: String,
) -> Result<(), String> {
    let ct = checkin_type.trim();
    if !is_admitted_checkin_type(ct) {
        return Err(format!(
            "unsupported orthodontic checkinType \"{checkin_type}\"; expected {ADMITTED_CHECKIN_TYPES} (daily wear is now modeled as wear-gap intervals, see PO-ORTHO-005a; review/adjustment/issue/end must write to dental_records, PO-ORTHO-001)"
        ));
    }
    // Structural validation by checkinType.
    match ct {
        "aligner-change" => {
            if aligner_index.is_none() {
                return Err("checkinType=aligner-change requires alignerIndex".to_string());
            }
        }
        "expander-activation" => {
            if activation_index.is_none() {
                return Err("checkinType=expander-activation requires activationIndex".to_string());
            }
        }
        _ => {}
    }
    // Verify caseId<->applianceId round-trip and expander activation cap.
    {
        let conn = get_conn()?.lock().map_err(|e| e.to_string())?;
        let appliance_row: Option<(String, Option<i32>, i32)> = conn
            .query_row(
                "SELECT applianceType, prescribedActivations, completedActivations FROM orthodontic_appliances WHERE applianceId = ?1 AND caseId = ?2 AND childId = ?3",
                params![appliance_id, case_id, child_id],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, Option<i32>>(1)?, row.get::<_, i32>(2)?)),
            )
            .ok();
        let Some((appliance_type, prescribed, completed)) = appliance_row else {
            return Err(
                "checkin applianceId does not round-trip to declared caseId/childId (PO-ORTHO-005)"
                    .to_string(),
            );
        };
        if ct == "aligner-change" && appliance_type != "clear-aligner" {
            return Err(format!(
                "aligner-change checkin requires applianceType=clear-aligner; got {appliance_type}"
            ));
        }
        if ct == "expander-activation" && appliance_type != "expander" {
            return Err(format!(
                "expander-activation checkin requires applianceType=expander; got {appliance_type}"
            ));
        }
        if ct == "expander-activation" {
            if let Some(cap) = prescribed {
                if completed >= cap {
                    return Err(format!(
                        "expander total activations ({completed}) has reached the prescribed cap ({cap}); protocol rule PO-ORTHO-EXPANDER-ACTIVATION stopWhen fires here"
                    ));
                }
            }
        }
    }
    let conn = get_conn()?.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO orthodontic_checkins (checkinId, childId, caseId, applianceId, checkinType, checkinDate, activationIndex, alignerIndex, notes, createdAt, updatedAt)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10)",
        params![checkin_id, child_id, case_id, appliance_id, checkin_type, checkin_date, activation_index, aligner_index, notes, now],
    )
    .map_err(|e| format!("insert_orthodontic_checkin: {e}"))?;
    // For expander-activation, bump the parent appliance's completedActivations counter.
    if ct == "expander-activation" {
        conn.execute(
            "UPDATE orthodontic_appliances SET completedActivations = completedActivations + 1, updatedAt = ?2 WHERE applianceId = ?1",
            params![appliance_id, now],
        )
        .map_err(|e| format!("insert_orthodontic_checkin bump activations: {e}"))?;
    }
    // Advance the matching protocol reminder_state's nextTriggerAt so the
    // reminder center shows the next cycle's target day (PO-ORTHO-007 delivery freshness).
    let rule_id_for_advance = match ct {
        "aligner-change" => Some("PO-ORTHO-ALIGNER-CHANGE"),
        "expander-activation" => Some("PO-ORTHO-EXPANDER-ACTIVATION"),
        _ => None,
    };
    if let Some(rule_id) = rule_id_for_advance {
        let advance_days = match ct {
            "expander-activation" => 1,
            "aligner-change" => 14,
            _ => 0,
        };
        let next = add_days_iso(&checkin_date, advance_days);
        let next_iso = format!("{next}T00:00:00.000Z");
        let state_id = format!("ortho-{}-{}", appliance_id, rule_id);
        conn.execute(
            "UPDATE reminder_states SET nextTriggerAt = ?2, updatedAt = ?3 WHERE stateId = ?1",
            params![state_id, next_iso, now],
        )
        .map_err(|e| format!("insert_orthodontic_checkin advance nextTriggerAt: {e}"))?;
    }
    // If expander activations reach the cap, complete the activation state.
    if ct == "expander-activation" {
        let hit_cap: i64 = conn
            .query_row(
                "SELECT CASE WHEN prescribedActivations IS NOT NULL AND completedActivations >= prescribedActivations THEN 1 ELSE 0 END FROM orthodontic_appliances WHERE applianceId = ?1",
                params![appliance_id],
                |row| row.get(0),
            )
            .unwrap_or(0);
        if hit_cap == 1 {
            let state_id = format!("ortho-{}-PO-ORTHO-EXPANDER-ACTIVATION", appliance_id);
            conn.execute(
                "UPDATE reminder_states SET status='completed', completedAt=?2, updatedAt=?2 WHERE stateId = ?1",
                params![state_id, now],
            )
            .map_err(|e| format!("insert_orthodontic_checkin complete activation state: {e}"))?;
        }
    }
    Ok(())
}
#[tauri::command]
pub fn delete_orthodontic_checkin(checkin_id: String) -> Result<(), String> {
    let conn = get_conn()?.lock().map_err(|e| e.to_string())?;
    let meta: Option<(String, String)> = conn
        .query_row(
            "SELECT applianceId, checkinType FROM orthodontic_checkins WHERE checkinId = ?1",
            params![checkin_id],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        )
        .ok();
    let Some((appliance_id, checkin_type)) = meta else {
        return Err(format!(
            "orthodontic checkin \"{checkin_id}\" does not exist"
        ));
    };
    let now: String = conn
        .query_row("SELECT strftime('%Y-%m-%dT%H:%M:%fZ', 'now')", [], |row| {
            row.get(0)
        })
        .map_err(|e| format!("delete_orthodontic_checkin fetch now() failed: {e}"))?;
    conn.execute(
        "DELETE FROM orthodontic_checkins WHERE checkinId = ?1",
        params![checkin_id],
    )
    .map_err(|e| format!("delete_orthodontic_checkin: {e}"))?;
    repair_protocol_state_after_checkin_delete(
        &conn,
        appliance_id.as_str(),
        checkin_type.as_str(),
        now.as_str(),
    )?;
    Ok(())
}
#[tauri::command]
pub fn get_orthodontic_checkins(
    appliance_id: String,
    limit_days: Option<i32>,
) -> Result<Vec<OrthodonticCheckin>, String> {
    let conn = get_conn()?.lock().map_err(|e| e.to_string())?;
    let days = limit_days.unwrap_or(30);
    let mut stmt = conn
        .prepare(
            "SELECT checkinId, childId, caseId, applianceId, checkinType, checkinDate, activationIndex, alignerIndex, notes, createdAt, updatedAt
             FROM orthodontic_checkins
             WHERE applianceId = ?1
               AND checkinDate >= date('now', '-' || ?2 || ' day')
             ORDER BY checkinDate DESC, createdAt DESC",
        )
        .map_err(|e| format!("get_orthodontic_checkins: {e}"))?;
    let rows = stmt
        .query_map(params![appliance_id, days], |row| {
            Ok(OrthodonticCheckin {
                checkin_id: row.get(0)?,
                child_id: row.get(1)?,
                case_id: row.get(2)?,
                appliance_id: row.get(3)?,
                checkin_type: row.get(4)?,
                checkin_date: row.get(5)?,
                activation_index: row.get(6)?,
                aligner_index: row.get(7)?,
                notes: row.get(8)?,
                created_at: row.get(9)?,
                updated_at: row.get(10)?,
            })
        })
        .map_err(|e| format!("get_orthodontic_checkins: {e}"))?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("get_orthodontic_checkins collect: {e}"))
}
// ── Dashboard projection ──────────────────────────────────
//
// PO-ORTHO-008 cutover: the legacy `compliance30d` daily-bucket counts are
// retired along with `wear-daily` / `retention-wear`. Per-cycle continuous
// projection is computed in the renderer's `orthodontic-derive.ts` from the
// raw appliance row + unwear intervals + aligner-change checkins; no aggregate
// projection is stored in the dashboard payload.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OrthodonticDashboard {
    pub active_case: Option<OrthodonticCase>,
    pub active_appliances: Vec<OrthodonticAppliance>,
    pub next_review_date: Option<String>,
}
