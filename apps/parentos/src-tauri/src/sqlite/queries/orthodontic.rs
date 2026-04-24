use super::super::get_conn;
use rusqlite::{params, Connection};
use serde::Serialize;
// ── Protocol delivery catalog (mirrors orthodontic-protocols.yaml) ─────────
//
// Embedded in Rust so reminder_state seeding can happen synchronously at
// command time without reparsing YAML. Drift between this table and
// `apps/parentos/spec/kernel/tables/orthodontic-protocols.yaml` is a spec
// violation; `check:spec-consistency` should catch it if a future drift check
// is added.
pub(crate) struct AppliedProtocol {
    pub(crate) rule_id: &'static str,
    /// Days from appliance.startedAt until the first reminder fires.
    /// Daily-cadence rules use 0 (fires today).
    pub(crate) first_trigger_days: i64,
}
pub(crate) fn protocols_for_appliance(appliance_type: &str) -> &'static [AppliedProtocol] {
    match appliance_type {
        "clear-aligner" => &[
            AppliedProtocol {
                rule_id: "PO-ORTHO-WEAR-DAILY",
                first_trigger_days: 0,
            },
            AppliedProtocol {
                rule_id: "PO-ORTHO-ALIGNER-CHANGE",
                first_trigger_days: 14,
            },
            AppliedProtocol {
                rule_id: "PO-ORTHO-REVIEW-ALIGNER",
                first_trigger_days: 56,
            },
        ],
        "metal-braces" | "ceramic-braces" => &[AppliedProtocol {
            rule_id: "PO-ORTHO-REVIEW-FIXED",
            first_trigger_days: 28,
        }],
        "expander" => &[
            AppliedProtocol {
                rule_id: "PO-ORTHO-EXPANDER-ACTIVATION",
                first_trigger_days: 1,
            },
            AppliedProtocol {
                rule_id: "PO-ORTHO-REVIEW-INTERCEPTIVE",
                first_trigger_days: 42,
            },
        ],
        "twin-block" | "activator" => &[
            AppliedProtocol {
                rule_id: "PO-ORTHO-WEAR-DAILY",
                first_trigger_days: 0,
            },
            AppliedProtocol {
                rule_id: "PO-ORTHO-REVIEW-INTERCEPTIVE",
                first_trigger_days: 42,
            },
        ],
        "retainer-removable" => &[
            AppliedProtocol {
                rule_id: "PO-ORTHO-RETENTION-WEAR",
                first_trigger_days: 0,
            },
            AppliedProtocol {
                rule_id: "PO-ORTHO-RETENTION-REVIEW",
                first_trigger_days: 180,
            },
        ],
        "retainer-fixed" => &[AppliedProtocol {
            rule_id: "PO-ORTHO-RETENTION-REVIEW",
            first_trigger_days: 180,
        }],
        _ => &[],
    }
}
/// Maps applianceType → the admitted review-cycle protocol ruleId.
/// Mirrors `orthodontic-protocols.yaml#rules` where `applianceTypes` crosses
/// into the rule (e.g. `PO-ORTHO-REVIEW-ALIGNER` applies to `clear-aligner`).
/// Drift is caught by `protocol_catalog_drift_guard::review_rule_mapping_matches_yaml`.
pub(crate) fn review_rule_id_for_appliance(appliance_type: &str) -> Option<&'static str> {
    match appliance_type {
        "clear-aligner" => Some("PO-ORTHO-REVIEW-ALIGNER"),
        "metal-braces" | "ceramic-braces" => Some("PO-ORTHO-REVIEW-FIXED"),
        "twin-block" | "expander" | "activator" => Some("PO-ORTHO-REVIEW-INTERCEPTIVE"),
        "retainer-fixed" | "retainer-removable" => Some("PO-ORTHO-RETENTION-REVIEW"),
        _ => None,
    }
}
/// Default days between review visits per protocol rule (used when appliance
/// doesn't override). Mirrors `defaultIntervalDays` in
/// `orthodontic-protocols.yaml#rules`. Drift-guarded.
pub(crate) fn default_review_interval_days_for_rule(rule_id: &str) -> Option<i64> {
    match rule_id {
        "PO-ORTHO-REVIEW-ALIGNER" => Some(56),
        "PO-ORTHO-REVIEW-FIXED" => Some(28),
        "PO-ORTHO-REVIEW-INTERCEPTIVE" => Some(42),
        "PO-ORTHO-RETENTION-REVIEW" => Some(180),
        _ => None,
    }
}
include!("orthodontic_protocol_reminders.inc.rs");

fn is_writable_case_type(t: &str) -> bool {
    matches!(t, "early-intervention" | "fixed-braces" | "clear-aligners")
}
fn is_admitted_stage(s: &str) -> bool {
    matches!(
        s,
        "assessment" | "planning" | "active" | "retention" | "completed"
    )
}
fn is_admitted_appliance_type(t: &str) -> bool {
    matches!(
        t,
        "twin-block"
            | "expander"
            | "activator"
            | "metal-braces"
            | "ceramic-braces"
            | "clear-aligner"
            | "retainer-fixed"
            | "retainer-removable"
    )
}
fn is_admitted_appliance_status(s: &str) -> bool {
    matches!(s, "active" | "paused" | "completed")
}
fn appliance_requires_prescribed_hours(appliance_type: &str) -> bool {
    matches!(
        appliance_type,
        "clear-aligner" | "twin-block" | "activator" | "retainer-removable"
    )
}
fn is_admitted_checkin_type(t: &str) -> bool {
    matches!(
        t,
        "wear-daily" | "aligner-change" | "expander-activation" | "retention-wear"
    )
}
/// Minimum child age (months) for each applianceType.
/// Mirrors orthodontic-protocols.yaml#applianceMinAge — kept in sync by
/// PO-ORTHO-009. Drift between this table and the YAML is caught by the
/// spec-consistency check.
fn min_age_months_for_appliance(appliance_type: &str) -> i32 {
    match appliance_type {
        "twin-block" | "expander" | "activator" => 48,
        "metal-braces" | "ceramic-braces" | "clear-aligner" | "retainer-fixed"
        | "retainer-removable" => 84,
        _ => i32::MAX, // unknown types fall through; validator rejects separately
    }
}
// ── Case queries ──────────────────────────────────────────
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OrthodonticCase {
    pub case_id: String,
    pub child_id: String,
    pub case_type: String,
    pub stage: String,
    pub started_at: String,
    pub planned_end_at: Option<String>,
    pub actual_end_at: Option<String>,
    pub primary_issues: Option<String>,
    pub provider_name: Option<String>,
    pub provider_institution: Option<String>,
    pub next_review_date: Option<String>,
    pub notes: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}
#[tauri::command]
pub fn insert_orthodontic_case(
    case_id: String,
    child_id: String,
    case_type: String,
    stage: String,
    started_at: String,
    planned_end_at: Option<String>,
    primary_issues: Option<String>,
    provider_name: Option<String>,
    provider_institution: Option<String>,
    notes: Option<String>,
    now: String,
) -> Result<(), String> {
    if !is_writable_case_type(case_type.trim()) {
        return Err(format!(
            "caseType \"{case_type}\" is not writable (PO-ORTHO-002a); expected {WRITABLE_CASE_TYPES}. unknown-legacy rows are migration-authored only and must be re-classified via update_orthodontic_case before further writes."
        ));
    }
    if !is_admitted_stage(stage.trim()) {
        return Err(format!(
            "unsupported orthodontic stage \"{stage}\"; expected {ADMITTED_STAGES}"
        ));
    }
    if stage.trim() == "completed" {
        return Err(
            "insert_orthodontic_case rejects stage=completed because actualEndAt is required (PO-ORTHO-002); use a closeout flow that can provide actualEndAt".to_string(),
        );
    }
    let conn = get_conn()?.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO orthodontic_cases (caseId, childId, caseType, stage, startedAt, plannedEndAt, actualEndAt, primaryIssues, providerName, providerInstitution, nextReviewDate, notes, createdAt, updatedAt)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL, ?7, ?8, ?9, NULL, ?10, ?11, ?11)",
        params![case_id, child_id, case_type, stage, started_at, planned_end_at, primary_issues, provider_name, provider_institution, notes, now],
    )
    .map_err(|e| format!("insert_orthodontic_case: {e}"))?;
    Ok(())
}
#[tauri::command]
pub fn update_orthodontic_case(
    case_id: String,
    case_type: String,
    stage: String,
    started_at: String,
    planned_end_at: Option<String>,
    actual_end_at: Option<String>,
    primary_issues: Option<String>,
    provider_name: Option<String>,
    provider_institution: Option<String>,
    notes: Option<String>,
    now: String,
) -> Result<(), String> {
    if !is_writable_case_type(case_type.trim()) {
        return Err(format!(
            "caseType \"{case_type}\" is not writable (PO-ORTHO-002a); expected {WRITABLE_CASE_TYPES}. unknown-legacy rows are migration-authored only and must be re-classified via update_orthodontic_case before further writes."
        ));
    }
    if !is_admitted_stage(stage.trim()) {
        return Err(format!(
            "unsupported orthodontic stage \"{stage}\"; expected {ADMITTED_STAGES}"
        ));
    }
    if stage.trim() == "completed" && actual_end_at.as_deref().unwrap_or("").is_empty() {
        return Err(
            "orthodontic case stage=completed requires actualEndAt (PO-ORTHO-002)".to_string(),
        );
    }
    let conn = get_conn()?.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE orthodontic_cases SET caseType=?2, stage=?3, startedAt=?4, plannedEndAt=?5, actualEndAt=?6, primaryIssues=?7, providerName=?8, providerInstitution=?9, notes=?10, updatedAt=?11 WHERE caseId=?1",
        params![case_id, case_type, stage, started_at, planned_end_at, actual_end_at, primary_issues, provider_name, provider_institution, notes, now],
    )
    .map_err(|e| format!("update_orthodontic_case: {e}"))?;
    recompute_case_next_review(case_id.as_str())?;
    Ok(())
}
#[tauri::command]
pub fn delete_orthodontic_case(case_id: String) -> Result<(), String> {
    let conn = get_conn()?.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM orthodontic_cases WHERE caseId = ?1",
        params![case_id],
    )
    .map_err(|e| format!("delete_orthodontic_case: {e}"))?;
    Ok(())
}
#[tauri::command]
pub fn get_orthodontic_cases(child_id: String) -> Result<Vec<OrthodonticCase>, String> {
    let conn = get_conn()?.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT caseId, childId, caseType, stage, startedAt, plannedEndAt, actualEndAt, primaryIssues, providerName, providerInstitution, nextReviewDate, notes, createdAt, updatedAt
             FROM orthodontic_cases WHERE childId = ?1 ORDER BY startedAt DESC, createdAt DESC",
        )
        .map_err(|e| format!("get_orthodontic_cases: {e}"))?;
    let rows = stmt
        .query_map(params![child_id], |row| {
            Ok(OrthodonticCase {
                case_id: row.get(0)?,
                child_id: row.get(1)?,
                case_type: row.get(2)?,
                stage: row.get(3)?,
                started_at: row.get(4)?,
                planned_end_at: row.get(5)?,
                actual_end_at: row.get(6)?,
                primary_issues: row.get(7)?,
                provider_name: row.get(8)?,
                provider_institution: row.get(9)?,
                next_review_date: row.get(10)?,
                notes: row.get(11)?,
                created_at: row.get(12)?,
                updated_at: row.get(13)?,
            })
        })
        .map_err(|e| format!("get_orthodontic_cases: {e}"))?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("get_orthodontic_cases collect: {e}"))
}
// ── Appliance queries ─────────────────────────────────────
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OrthodonticAppliance {
    pub appliance_id: String,
    pub case_id: String,
    pub child_id: String,
    pub appliance_type: String,
    pub status: String,
    pub started_at: String,
    pub ended_at: Option<String>,
    pub prescribed_hours_per_day: Option<i32>,
    pub prescribed_activations: Option<i32>,
    pub completed_activations: i32,
    pub review_interval_days: Option<i32>,
    pub last_review_at: Option<String>,
    pub next_review_date: Option<String>,
    pub pause_reason: Option<String>,
    pub notes: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}
/// Reject `started_at` that would place the child below the applianceType's
/// min-age gate (PO-ORTHO-009). `child_birth_date` comes from the caller to
/// avoid a second query; Rust validates numerically.
include!("orthodontic_appliances.inc.rs");

include!("orthodontic_checkins.inc.rs");

#[tauri::command]
pub fn get_orthodontic_dashboard(child_id: String) -> Result<OrthodonticDashboard, String> {
    let cases = get_orthodontic_cases(child_id.clone())?;
    // "Active" case is the most recent one with stage in (active | retention).
    // PO-ORTHO-002a: unknown-legacy cases are excluded from the active dashboard
    // until the parent re-classifies. Their clinical timeline rows in
    // dental_records remain visible via the dental history tab.
    let active_case = cases
        .iter()
        .find(|c| {
            matches!(c.stage.as_str(), "active" | "retention") && c.case_type != "unknown-legacy"
        })
        .cloned();
    let active_case_cloned = active_case.clone();
    let mut active_appliances: Vec<OrthodonticAppliance> = Vec::new();
    if let Some(case) = active_case_cloned.as_ref() {
        let appliances = get_orthodontic_appliances(case.case_id.clone())?;
        active_appliances = appliances
            .into_iter()
            .filter(|a| a.status == "active")
            .collect();
    }
    let next_review_date = active_case_cloned
        .as_ref()
        .and_then(|c| c.next_review_date.clone());
    let compliance = {
        let conn = get_conn()?.lock().map_err(|e| e.to_string())?;
        // Only wear-daily / retention-wear contribute to the compliance approximation.
        let mut stmt = conn
            .prepare(
                "SELECT complianceBucket, COUNT(*) FROM orthodontic_checkins
                 WHERE childId = ?1
                   AND checkinType IN ('wear-daily', 'retention-wear')
                   AND checkinDate >= date('now', '-30 day')
                   AND complianceBucket IS NOT NULL
                 GROUP BY complianceBucket",
            )
            .map_err(|e| format!("compliance30d prepare: {e}"))?;
        let mut done = 0i64;
        let mut partial = 0i64;
        let mut missed = 0i64;
        let rows = stmt
            .query_map(params![child_id], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
            })
            .map_err(|e| format!("compliance30d query: {e}"))?;
        for row in rows {
            let (bucket, count) = row.map_err(|e| format!("compliance30d read row: {e}"))?;
            match bucket.as_str() {
                "done" => done = count,
                "partial" => partial = count,
                "missed" => missed = count,
                _ => {}
            }
        }
        Compliance30d {
            done,
            partial,
            missed,
            total: done + partial + missed,
            note: "任务达成率近似 (PO-ORTHO-008)；非实际佩戴小时临床还原".to_string(),
        }
    };
    Ok(OrthodonticDashboard {
        active_case,
        active_appliances,
        next_review_date,
        compliance30d: compliance,
    })
}
// Cloneable newtype helpers so dashboard can share OrthodonticCase/Appliance.
impl Clone for OrthodonticCase {
    fn clone(&self) -> Self {
        Self {
            case_id: self.case_id.clone(),
            child_id: self.child_id.clone(),
            case_type: self.case_type.clone(),
            stage: self.stage.clone(),
            started_at: self.started_at.clone(),
            planned_end_at: self.planned_end_at.clone(),
            actual_end_at: self.actual_end_at.clone(),
            primary_issues: self.primary_issues.clone(),
            provider_name: self.provider_name.clone(),
            provider_institution: self.provider_institution.clone(),
            next_review_date: self.next_review_date.clone(),
            notes: self.notes.clone(),
            created_at: self.created_at.clone(),
            updated_at: self.updated_at.clone(),
        }
    }
}
