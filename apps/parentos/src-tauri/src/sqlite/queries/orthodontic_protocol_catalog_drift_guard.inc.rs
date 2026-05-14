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
        appliance_phase_sequence, default_review_interval_days_for_rule, dental_followup_rule_for,
        protocols_for_appliance, review_rule_id_for_appliance,
    };
    use serde::Deserialize;
    use std::collections::{BTreeMap, BTreeSet};
    #[derive(Debug, Deserialize)]
    struct Spec {
        rules: Vec<ProtocolRuleSpec>,
        #[serde(rename = "dentalFollowUpRules")]
        dental_followup_rules: Vec<DentalFollowupRuleSpec>,
        #[serde(rename = "appliancePhases")]
        appliance_phases: BTreeMap<String, Vec<AppliancePhaseSpec>>,
    }
    #[derive(Debug, Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct AppliancePhaseSpec {
        phase_id: String,
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
    #[test]
    fn appliance_phases_match_yaml() {
        // PO-ORTHO-013: the Rust `appliance_phase_sequence` mirror must match
        // the ordered phaseId list in `orthodontic-protocols.yaml#appliancePhases`
        // for every applianceType, in order.
        let spec = parse_spec();
        const ALL_APPLIANCE_TYPES: &[&str] = &[
            "twin-block",
            "expander",
            "activator",
            "metal-braces",
            "ceramic-braces",
            "clear-aligner",
            "retainer-fixed",
            "retainer-removable",
        ];
        // Every applianceType must have a YAML phase sequence and a matching
        // Rust mirror, in the same order.
        for appliance_type in ALL_APPLIANCE_TYPES {
            let yaml_phases: Vec<&str> = spec
                .appliance_phases
                .get(*appliance_type)
                .unwrap_or_else(|| {
                    panic!("orthodontic-protocols.yaml#appliancePhases is missing applianceType \"{appliance_type}\"")
                })
                .iter()
                .map(|p| p.phase_id.as_str())
                .collect();
            let rust_phases = appliance_phase_sequence(appliance_type);
            assert_eq!(
                rust_phases, yaml_phases.as_slice(),
                "appliancePhases drift for \"{appliance_type}\": Rust {rust_phases:?} vs YAML {yaml_phases:?}",
            );
        }
        // Reverse: the YAML must not declare a phase sequence for an
        // applianceType outside the admitted enum.
        for appliance_type in spec.appliance_phases.keys() {
            assert!(
                ALL_APPLIANCE_TYPES.contains(&appliance_type.as_str()),
                "orthodontic-protocols.yaml#appliancePhases declares unknown applianceType \"{appliance_type}\"",
            );
        }
    }
}
