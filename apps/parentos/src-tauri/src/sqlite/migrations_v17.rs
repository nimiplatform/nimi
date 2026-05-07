use std::collections::HashSet;

use rusqlite::Connection;
use serde::Deserialize;

/// Schema v17: purge orphan `reminder_states` rows whose ruleIds are not in
/// the compiled reminder catalog.
///
/// Pre-contract code paths (and in-flight migrations from older builds) can
/// leave `reminder_states` rows whose ruleId doesn't appear in any admitted
/// YAML source. After the v9 `dental-auto-*` purge and v3 dismissed-row
/// check, active rows with stale ruleIds can still survive — for example
/// when the orthodontic protocol catalog admitted `PO-ORTHO-*` rules under
/// a different id during early development. Those rows now trip the
/// PO-TIME-007 fail-close invariant in `buildReminderAgenda` and freeze the
/// timeline / reminders pages. This migration deletes them so the UI stays
/// usable without weakening the runtime fail-close contract.
///
/// Catalog union (must mirror the `generate-knowledge-base.ts` compile step):
///
///   - `reminder-rules.yaml`           — base catalog
///   - `reminder-rules-extended.yaml`  — extended catalog
///   - `orthodontic-protocols.yaml`    — `PO-ORTHO-*` and `PO-DEN-FOLLOWUP-*`
///
/// Idempotent: a no-op when `reminder_states` has no orphans, which is the
/// expected steady state after this migration runs once.
pub(super) fn apply_v17(conn: &Connection) -> Result<(), String> {
    purge_orphan_reminder_states(conn)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReminderRulesYaml {
    rules: Vec<RuleIdRecord>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OrthodonticProtocolsYaml {
    rules: Vec<RuleIdRecord>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RuleIdRecord {
    rule_id: String,
}

fn load_admitted_rule_ids() -> Result<HashSet<String>, String> {
    let base: ReminderRulesYaml = serde_yaml::from_str(include_str!(
        "../../../spec/kernel/tables/reminder-rules.yaml",
    ))
    .map_err(|e| format!("migration v17 parse reminder-rules.yaml failed: {e}"))?;
    let extended: ReminderRulesYaml = serde_yaml::from_str(include_str!(
        "../../../spec/kernel/tables/reminder-rules-extended.yaml",
    ))
    .map_err(|e| format!("migration v17 parse reminder-rules-extended.yaml failed: {e}"))?;
    let ortho: OrthodonticProtocolsYaml = serde_yaml::from_str(include_str!(
        "../../../spec/kernel/tables/orthodontic-protocols.yaml",
    ))
    .map_err(|e| format!("migration v17 parse orthodontic-protocols.yaml failed: {e}"))?;

    let mut set = HashSet::new();
    for record in base.rules {
        set.insert(record.rule_id);
    }
    for record in extended.rules {
        set.insert(record.rule_id);
    }
    for record in ortho.rules {
        set.insert(record.rule_id);
    }
    Ok(set)
}

fn purge_orphan_reminder_states(conn: &Connection) -> Result<(), String> {
    let admitted = load_admitted_rule_ids()?;

    let mut stmt = conn
        .prepare("SELECT DISTINCT ruleId FROM reminder_states")
        .map_err(|e| format!("migration v17 prepare reminder_states scan failed: {e}"))?;
    let rows = stmt
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|e| format!("migration v17 query reminder_states ruleIds failed: {e}"))?;

    let mut orphan_rule_ids: Vec<String> = Vec::new();
    for row in rows {
        let rule_id = row
            .map_err(|e| format!("migration v17 read reminder_states ruleId failed: {e}"))?;
        if !admitted.contains(&rule_id) {
            orphan_rule_ids.push(rule_id);
        }
    }

    for rule_id in orphan_rule_ids {
        conn.execute(
            "DELETE FROM reminder_states WHERE ruleId = ?1",
            [&rule_id],
        )
        .map_err(|e| format!("migration v17 purge ruleId '{rule_id}' failed: {e}"))?;
    }

    Ok(())
}
