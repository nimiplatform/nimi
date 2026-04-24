fn compute_compliance_bucket(actual: Option<f64>, prescribed: Option<f64>) -> Option<String> {
    match (actual, prescribed) {
        (Some(a), Some(p)) if p > 0.0 => {
            let ratio = a / p;
            if ratio >= 0.80 {
                Some("done".to_string())
            } else if ratio >= 0.50 {
                Some("partial".to_string())
            } else {
                Some("missed".to_string())
            }
        }
        _ => None,
    }
}
#[cfg(test)]
mod compliance_tests {
    use super::compute_compliance_bucket;
    #[test]
    fn compliance_bucket_thresholds_match_protocol_spec() {
        // Exact protocol thresholds from orthodontic-protocols.yaml#schema.complianceThresholds.
        assert_eq!(
            compute_compliance_bucket(Some(17.6), Some(22.0)).as_deref(),
            Some("done")
        ); // 80.0% → done
        assert_eq!(
            compute_compliance_bucket(Some(17.5), Some(22.0)).as_deref(),
            Some("partial")
        ); // 79.5% → partial
        assert_eq!(
            compute_compliance_bucket(Some(11.0), Some(22.0)).as_deref(),
            Some("partial")
        ); // 50.0% → partial
        assert_eq!(
            compute_compliance_bucket(Some(10.9), Some(22.0)).as_deref(),
            Some("missed")
        ); // 49.5% → missed
        assert_eq!(
            compute_compliance_bucket(Some(0.0), Some(22.0)).as_deref(),
            Some("missed")
        );
        assert_eq!(compute_compliance_bucket(None, Some(22.0)), None);
        assert_eq!(compute_compliance_bucket(Some(20.0), None), None);
        assert_eq!(compute_compliance_bucket(Some(20.0), Some(0.0)), None);
    }
}
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
    #[test]
    fn rust_protocols_for_appliance_matches_yaml_appliance_bindings() {
        let spec = parse_spec();
        // Build YAML source of truth: appliance_type → set of ruleIds.
        let mut yaml_by_appliance: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
        for rule in &spec.rules {
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
        assert_parent_case_accepts_appliance, derive_initial_review_schedule,
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
}
#[tauri::command]
pub fn insert_orthodontic_checkin(
    checkin_id: String,
    child_id: String,
    case_id: String,
    appliance_id: String,
    checkin_type: String,
    checkin_date: String,
    actual_wear_hours: Option<f64>,
    prescribed_hours: Option<f64>,
    activation_index: Option<i32>,
    aligner_index: Option<i32>,
    notes: Option<String>,
    now: String,
) -> Result<(), String> {
    let ct = checkin_type.trim();
    if !is_admitted_checkin_type(ct) {
        return Err(format!(
            "unsupported orthodontic checkinType \"{checkin_type}\"; expected {ADMITTED_CHECKIN_TYPES} (review/adjustment/issue/end must write to dental_records instead, PO-ORTHO-001)"
        ));
    }
    // Structural validation by checkinType.
    match ct {
        "wear-daily" | "retention-wear" => {
            if actual_wear_hours.is_none() || prescribed_hours.is_none() {
                return Err(format!(
                    "checkinType=\"{ct}\" requires actualWearHours and prescribedHours"
                ));
            }
        }
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
    // complianceBucket is computed only for wear-daily / retention-wear.
    let bucket = match ct {
        "wear-daily" | "retention-wear" => {
            compute_compliance_bucket(actual_wear_hours, prescribed_hours)
        }
        _ => None,
    };
    let conn = get_conn()?.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO orthodontic_checkins (checkinId, childId, caseId, applianceId, checkinType, checkinDate, actualWearHours, prescribedHours, complianceBucket, activationIndex, alignerIndex, notes, createdAt, updatedAt)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?13)",
        params![checkin_id, child_id, case_id, appliance_id, checkin_type, checkin_date, actual_wear_hours, prescribed_hours, bucket, activation_index, aligner_index, notes, now],
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
    // reminder center shows the next cycle's target day rather than staying
    // stuck on the old due date (PO-ORTHO-007 delivery freshness).
    let rule_id_for_advance = match ct {
        "wear-daily" => Some("PO-ORTHO-WEAR-DAILY"),
        "retention-wear" => Some("PO-ORTHO-RETENTION-WEAR"),
        "aligner-change" => Some("PO-ORTHO-ALIGNER-CHANGE"),
        "expander-activation" => Some("PO-ORTHO-EXPANDER-ACTIVATION"),
        _ => None,
    };
    if let Some(rule_id) = rule_id_for_advance {
        let advance_days = match ct {
            "wear-daily" | "retention-wear" | "expander-activation" => 1,
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
            "SELECT checkinId, childId, caseId, applianceId, checkinType, checkinDate, actualWearHours, prescribedHours, complianceBucket, activationIndex, alignerIndex, notes, createdAt, updatedAt
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
                actual_wear_hours: row.get(6)?,
                prescribed_hours: row.get(7)?,
                compliance_bucket: row.get(8)?,
                activation_index: row.get(9)?,
                aligner_index: row.get(10)?,
                notes: row.get(11)?,
                created_at: row.get(12)?,
                updated_at: row.get(13)?,
            })
        })
        .map_err(|e| format!("get_orthodontic_checkins: {e}"))?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("get_orthodontic_checkins collect: {e}"))
}
// ── Dashboard projection ──────────────────────────────────
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OrthodonticDashboard {
    pub active_case: Option<OrthodonticCase>,
    pub active_appliances: Vec<OrthodonticAppliance>,
    pub next_review_date: Option<String>,
    /// 30-day task-completion approximation: done / partial / missed counts.
    /// Label as "任务达成率近似" in the UI (PO-ORTHO-008).
    pub compliance30d: Compliance30d,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Compliance30d {
    pub done: i64,
    pub partial: i64,
    pub missed: i64,
    pub total: i64,
    pub note: String,
}
