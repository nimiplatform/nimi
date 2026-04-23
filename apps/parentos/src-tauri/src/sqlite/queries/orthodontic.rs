use rusqlite::{params, Connection};
use serde::Serialize;

use super::super::get_conn;

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

fn add_days_iso_strict(iso_date: &str, days: i64) -> Result<String, String> {
    use chrono::{Duration, NaiveDate};

    let date = NaiveDate::parse_from_str(iso_date, "%Y-%m-%d")
        .map_err(|e| format!("invalid ISO date \"{iso_date}\": {e}"))?;
    let next = date
        .checked_add_signed(Duration::days(days))
        .ok_or_else(|| format!("date overflow when adding {days} day(s) to {iso_date}"))?;
    Ok(next.format("%Y-%m-%d").to_string())
}

/// Dental follow-up rule metadata (mirrors orthodontic-protocols.yaml#dentalFollowUpRules).
pub(crate) fn dental_followup_rule_for(event_type: &str) -> Option<(&'static str, i64)> {
    // (admitted ruleId, intervalMonths)
    match event_type {
        "cleaning" => Some(("PO-DEN-FOLLOWUP-CLEANING", 6)),
        "fluoride" => Some(("PO-DEN-FOLLOWUP-FLUORIDE", 6)),
        "sealant" => Some(("PO-DEN-FOLLOWUP-SEALANT", 12)),
        "filling" => Some(("PO-DEN-FOLLOWUP-FILLING", 6)),
        "checkup" => Some(("PO-DEN-FOLLOWUP-CHECKUP", 6)),
        _ => None,
    }
}

fn add_months_iso(iso_date: &str, months: i64) -> String {
    // SQLite handles month arithmetic deterministically via the date() function.
    let conn = match get_conn() {
        Ok(c) => c,
        Err(_) => return iso_date.to_string(),
    };
    let conn = match conn.lock() {
        Ok(c) => c,
        Err(_) => return iso_date.to_string(),
    };
    conn.query_row(
        "SELECT date(?1, ?2 || ' months')",
        params![iso_date, months],
        |row| row.get::<_, String>(0),
    )
    .unwrap_or_else(|_| iso_date.to_string())
}

fn add_days_iso(iso_date: &str, days: i64) -> String {
    let conn = match get_conn() {
        Ok(c) => c,
        Err(_) => return iso_date.to_string(),
    };
    let conn = match conn.lock() {
        Ok(c) => c,
        Err(_) => return iso_date.to_string(),
    };
    conn.query_row(
        "SELECT date(?1, ?2 || ' days')",
        params![iso_date, days],
        |row| row.get::<_, String>(0),
    )
    .unwrap_or_else(|_| iso_date.to_string())
}

fn derive_initial_review_schedule(
    appliance_type: &str,
    started_at: &str,
    review_interval_days_override: Option<i32>,
) -> Result<(Option<i32>, Option<String>), String> {
    let effective_days = match review_interval_days_override {
        Some(days) => Some(days),
        None => review_rule_id_for_appliance(appliance_type)
            .and_then(default_review_interval_days_for_rule)
            .map(|days| days as i32),
    };
    let next_review_date = match effective_days {
        Some(days) => Some(add_days_iso_strict(started_at, i64::from(days))?),
        None => None,
    };
    Ok((effective_days, next_review_date))
}

fn assert_parent_case_accepts_appliance(
    conn: &Connection,
    case_id: &str,
    child_id: &str,
) -> Result<(), String> {
    let parent_case_meta: Option<(String, String)> = conn
        .query_row(
            "SELECT childId, caseType FROM orthodontic_cases WHERE caseId = ?1",
            params![case_id],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        )
        .ok();
    let Some((case_child_id, case_type)) = parent_case_meta else {
        return Err(format!("parent case \"{case_id}\" does not exist"));
    };
    if case_child_id != child_id {
        return Err(format!(
            "appliance childId \"{child_id}\" does not match parent case.childId \"{case_child_id}\" (PO-ORTHO-003)"
        ));
    }
    if case_type == "unknown-legacy" {
        return Err(
            "parent case is unknown-legacy (PO-ORTHO-002a); re-classify the case before adding appliances"
                .to_string(),
        );
    }
    Ok(())
}

/// Writes reminder_states rows for each applicable PO-ORTHO-* protocol rule
/// matching `appliance_type`. Idempotent: replays upsert the same rows so
/// appliance restart scenarios stay consistent. Called on
/// insert_orthodontic_appliance (status=active) and on resume-from-paused.
fn seed_protocol_reminders_for_appliance(
    appliance_id: &str,
    child_id: &str,
    appliance_type: &str,
    started_at: &str,
    _review_interval_days_override: Option<i32>,
    _prescribed_hours_per_day: Option<i32>,
    now: &str,
) -> Result<(), String> {
    let protocols = protocols_for_appliance(appliance_type);
    if protocols.is_empty() {
        return Ok(());
    }
    let conn = get_conn()?.lock().map_err(|e| e.to_string())?;
    for protocol in protocols {
        let next_trigger = add_days_iso(started_at, protocol.first_trigger_days);
        let next_trigger_iso = format!("{next_trigger}T00:00:00.000Z");
        let state_id = format!("ortho-{}-{}", appliance_id, protocol.rule_id);
        let notes = format!("[ortho-protocol] applianceId={appliance_id}");
        // Upsert by stateId so replay stays idempotent.
        conn.execute(
            "INSERT INTO reminder_states (stateId, childId, ruleId, status, activatedAt, completedAt, dismissedAt, dismissReason, repeatIndex, nextTriggerAt, snoozedUntil, scheduledDate, notApplicable, plannedForDate, surfaceRank, lastSurfacedAt, surfaceCount, notes, createdAt, updatedAt)
             VALUES (?1, ?2, ?3, 'active', ?4, NULL, NULL, NULL, 0, ?5, NULL, NULL, 0, NULL, NULL, NULL, 0, ?6, ?4, ?4)
             ON CONFLICT(stateId) DO UPDATE SET status='active', activatedAt=?4, completedAt=NULL, dismissedAt=NULL, dismissReason=NULL, nextTriggerAt=COALESCE(reminder_states.nextTriggerAt, excluded.nextTriggerAt), notes=?6, updatedAt=?4",
            params![state_id, child_id, protocol.rule_id, now, next_trigger_iso, notes],
        )
        .map_err(|e| format!("seed_protocol_reminders_for_appliance({}, {}): {e}", appliance_id, protocol.rule_id))?;
    }
    Ok(())
}

/// Updates states for one appliance to `status` and timestamps.
fn transition_protocol_reminders(
    conn: &Connection,
    appliance_id: &str,
    new_status: &str,
    now: &str,
    dismiss_reason: Option<&str>,
) -> Result<(), String> {
    let notes_prefix = format!("[ortho-protocol] applianceId={appliance_id}%");
    match new_status {
        "dismissed" => {
            conn.execute(
                "UPDATE reminder_states SET status='dismissed', dismissedAt=?1, dismissReason=?2, updatedAt=?1 WHERE notes LIKE ?3 AND status NOT IN ('completed','dismissed')",
                params![now, dismiss_reason.unwrap_or("appliance-paused"), notes_prefix],
            )
            .map_err(|e| format!("transition_protocol_reminders(dismissed): {e}"))?;
        }
        "completed" => {
            conn.execute(
                "UPDATE reminder_states SET status='completed', completedAt=?1, updatedAt=?1 WHERE notes LIKE ?2 AND status <> 'completed'",
                params![now, notes_prefix],
            )
            .map_err(|e| format!("transition_protocol_reminders(completed): {e}"))?;
        }
        _ => {
            return Err(format!(
                "unsupported protocol transition target: {new_status}"
            ))
        }
    }
    Ok(())
}

fn delete_protocol_reminders_for_appliance(
    conn: &Connection,
    appliance_id: &str,
) -> Result<(), String> {
    let notes_prefix = format!("[ortho-protocol] applianceId={appliance_id}%");
    conn.execute(
        "DELETE FROM reminder_states WHERE notes LIKE ?1",
        params![notes_prefix],
    )
    .map_err(|e| format!("delete_protocol_reminders_for_appliance: {e}"))?;
    Ok(())
}

fn protocol_binding_for_checkin_type(checkin_type: &str) -> Option<(&'static str, i64)> {
    match checkin_type {
        "wear-daily" => Some(("PO-ORTHO-WEAR-DAILY", 1)),
        "retention-wear" => Some(("PO-ORTHO-RETENTION-WEAR", 1)),
        "aligner-change" => Some(("PO-ORTHO-ALIGNER-CHANGE", 14)),
        "expander-activation" => Some(("PO-ORTHO-EXPANDER-ACTIVATION", 1)),
        _ => None,
    }
}

fn repair_protocol_state_after_checkin_delete(
    conn: &Connection,
    appliance_id: &str,
    checkin_type: &str,
    now: &str,
) -> Result<(), String> {
    let Some((rule_id, cadence_days)) = protocol_binding_for_checkin_type(checkin_type) else {
        return Ok(());
    };

    let (appliance_type, started_at, appliance_status, prescribed_activations): (
        String,
        String,
        String,
        Option<i32>,
    ) = conn
        .query_row(
            "SELECT applianceType, startedAt, status, prescribedActivations FROM orthodontic_appliances WHERE applianceId = ?1",
            params![appliance_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, Option<i32>>(3)?,
                ))
            },
        )
        .map_err(|e| format!("repair_protocol_state_after_checkin_delete fetch appliance meta: {e}"))?;

    let latest_checkin_date: Option<String> = conn
        .query_row(
            "SELECT checkinDate FROM orthodontic_checkins
             WHERE applianceId = ?1 AND checkinType = ?2
             ORDER BY checkinDate DESC, createdAt DESC
             LIMIT 1",
            params![appliance_id, checkin_type],
            |row| row.get(0),
        )
        .ok();
    let next_trigger_date = match latest_checkin_date {
        Some(date) => add_days_iso_strict(date.as_str(), cadence_days)?,
        None => {
            let seed_days = protocols_for_appliance(appliance_type.as_str())
                .iter()
                .find(|protocol| protocol.rule_id == rule_id)
                .map(|protocol| protocol.first_trigger_days)
                .unwrap_or(0);
            add_days_iso_strict(started_at.as_str(), seed_days)?
        }
    };
    let next_trigger_iso = format!("{next_trigger_date}T00:00:00.000Z");
    let state_id = format!("ortho-{}-{}", appliance_id, rule_id);

    let mut target_state = match appliance_status.as_str() {
        "paused" => "dismissed",
        "completed" => "completed",
        _ => "active",
    };

    if checkin_type == "expander-activation" {
        let completed_count: i32 = conn
            .query_row(
                "SELECT COUNT(*) FROM orthodontic_checkins WHERE applianceId = ?1 AND checkinType = 'expander-activation'",
                params![appliance_id],
                |row| row.get(0),
            )
            .map_err(|e| format!("repair_protocol_state_after_checkin_delete count expander activations: {e}"))?;
        conn.execute(
            "UPDATE orthodontic_appliances SET completedActivations = ?2, updatedAt = ?3 WHERE applianceId = ?1",
            params![appliance_id, completed_count, now],
        )
        .map_err(|e| format!("repair_protocol_state_after_checkin_delete sync completedActivations: {e}"))?;
        if appliance_status == "active"
            && prescribed_activations.is_some()
            && completed_count >= prescribed_activations.unwrap_or_default()
        {
            target_state = "completed";
        }
    }

    match target_state {
        "dismissed" => {
            conn.execute(
                "UPDATE reminder_states
                 SET status='dismissed', completedAt=NULL, dismissedAt=?2, dismissReason='appliance-paused', nextTriggerAt=?3, updatedAt=?2
                 WHERE stateId = ?1",
                params![state_id, now, next_trigger_iso],
            )
            .map_err(|e| format!("repair_protocol_state_after_checkin_delete dismiss state: {e}"))?;
        }
        "completed" => {
            conn.execute(
                "UPDATE reminder_states
                 SET status='completed', completedAt=?2, dismissedAt=NULL, dismissReason=NULL, nextTriggerAt=?3, updatedAt=?2
                 WHERE stateId = ?1",
                params![state_id, now, next_trigger_iso],
            )
            .map_err(|e| format!("repair_protocol_state_after_checkin_delete complete state: {e}"))?;
        }
        _ => {
            conn.execute(
                "UPDATE reminder_states
                 SET status='active', completedAt=NULL, dismissedAt=NULL, dismissReason=NULL, nextTriggerAt=?2, updatedAt=?3
                 WHERE stateId = ?1",
                params![state_id, next_trigger_iso, now],
            )
            .map_err(|e| format!("repair_protocol_state_after_checkin_delete reactivate state: {e}"))?;
        }
    }

    Ok(())
}

/// Writes/refreshes a dental follow-up reminder_state when a triggering
/// dental eventType is recorded. Idempotent per (childId, ruleId) — the
/// latest follow-up always wins (replacement semantics).
fn upsert_dental_followup_reminder(
    child_id: &str,
    event_type: &str,
    event_date: &str,
    now: &str,
) -> Result<(), String> {
    let Some((rule_id, interval_months)) = dental_followup_rule_for(event_type) else {
        return Ok(());
    };
    let next_trigger = add_months_iso(event_date, interval_months);
    let next_trigger_iso = format!("{next_trigger}T00:00:00.000Z");
    let state_id = format!("dental-fu-{child_id}-{rule_id}");
    let notes = format!("[dental-followup] triggeredBy={event_type} at={event_date}");
    let conn = get_conn()?.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO reminder_states (stateId, childId, ruleId, status, activatedAt, completedAt, dismissedAt, dismissReason, repeatIndex, nextTriggerAt, snoozedUntil, scheduledDate, notApplicable, plannedForDate, surfaceRank, lastSurfacedAt, surfaceCount, notes, createdAt, updatedAt)
         VALUES (?1, ?2, ?3, 'active', ?4, NULL, NULL, NULL, 0, ?5, NULL, NULL, 0, NULL, NULL, NULL, 0, ?6, ?4, ?4)
         ON CONFLICT(stateId) DO UPDATE SET status='active', activatedAt=?4, completedAt=NULL, dismissedAt=NULL, nextTriggerAt=?5, notes=?6, updatedAt=?4",
        params![state_id, child_id, rule_id, now, next_trigger_iso, notes],
    )
    .map_err(|e| format!("upsert_dental_followup_reminder({rule_id}): {e}"))?;
    Ok(())
}

// Public bridge so health_records.rs can call into the follow-up writer
// without exposing module internals to all callers.
pub fn ensure_dental_followup_reminder(
    child_id: &str,
    event_type: &str,
    event_date: &str,
    now: &str,
) -> Result<(), String> {
    upsert_dental_followup_reminder(child_id, event_type, event_date, now)
}

// ── Shared validators ──────────────────────────────────────

/// caseType values writable from the command layer.
/// `unknown-legacy` is stored on disk (produced only by migration v9), but new
/// inserts/updates MUST reject it per PO-ORTHO-002a.
const WRITABLE_CASE_TYPES: &str = "early-intervention | fixed-braces | clear-aligners";
const ADMITTED_STAGES: &str = "assessment | planning | active | retention | completed";
const ADMITTED_APPLIANCE_TYPES: &str = "twin-block | expander | activator | metal-braces | ceramic-braces | clear-aligner | retainer-fixed | retainer-removable";
const ADMITTED_APPLIANCE_STATUSES: &str = "active | paused | completed";
const ADMITTED_CHECKIN_TYPES: &str =
    "wear-daily | aligner-change | expander-activation | retention-wear";

/// Returns true for caseTypes admitted for command-layer WRITES.
/// `unknown-legacy` is excluded — it is migration-authored only.
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
fn assert_age_gate(
    appliance_type: &str,
    started_at: &str,
    child_birth_date: &str,
) -> Result<(), String> {
    use chrono::NaiveDate;
    let min_months = min_age_months_for_appliance(appliance_type);
    let started = NaiveDate::parse_from_str(started_at, "%Y-%m-%d")
        .map_err(|e| format!("invalid startedAt \"{started_at}\": {e}"))?;
    let birth = NaiveDate::parse_from_str(child_birth_date, "%Y-%m-%d")
        .map_err(|e| format!("invalid child birthDate \"{child_birth_date}\": {e}"))?;
    let months = ((started.format("%Y").to_string().parse::<i32>().unwrap_or(0)
        - birth.format("%Y").to_string().parse::<i32>().unwrap_or(0))
        * 12)
        + (started.format("%m").to_string().parse::<i32>().unwrap_or(0)
            - birth.format("%m").to_string().parse::<i32>().unwrap_or(0));
    if months < min_months {
        return Err(format!(
            "appliance \"{appliance_type}\" requires child age >= {min_months} months (PO-ORTHO-009); got {months}",
        ));
    }
    Ok(())
}

#[tauri::command]
pub fn insert_orthodontic_appliance(
    appliance_id: String,
    case_id: String,
    child_id: String,
    child_birth_date: String,
    appliance_type: String,
    status: String,
    started_at: String,
    prescribed_hours_per_day: Option<i32>,
    prescribed_activations: Option<i32>,
    review_interval_days: Option<i32>,
    notes: Option<String>,
    now: String,
) -> Result<(), String> {
    if !is_admitted_appliance_type(appliance_type.trim()) {
        return Err(format!(
            "unsupported applianceType \"{appliance_type}\"; expected {ADMITTED_APPLIANCE_TYPES}"
        ));
    }
    if !is_admitted_appliance_status(status.trim()) {
        return Err(format!(
            "unsupported appliance status \"{status}\"; expected {ADMITTED_APPLIANCE_STATUSES}"
        ));
    }
    if appliance_requires_prescribed_hours(appliance_type.trim())
        && prescribed_hours_per_day.is_none()
    {
        return Err(format!(
            "applianceType \"{appliance_type}\" requires prescribedHoursPerDay for daily compliance checkins (PO-ORTHO-003)"
        ));
    }
    assert_age_gate(
        appliance_type.trim(),
        started_at.trim(),
        child_birth_date.trim(),
    )?;

    let (effective_review_interval_days, initial_next_review_date) =
        derive_initial_review_schedule(
            appliance_type.trim(),
            started_at.trim(),
            review_interval_days,
        )?;

    let conn = get_conn()?.lock().map_err(|e| e.to_string())?;
    assert_parent_case_accepts_appliance(&conn, case_id.as_str(), child_id.as_str())?;
    conn.execute(
        "INSERT INTO orthodontic_appliances (applianceId, caseId, childId, applianceType, status, startedAt, endedAt, prescribedHoursPerDay, prescribedActivations, completedActivations, reviewIntervalDays, lastReviewAt, nextReviewDate, pauseReason, notes, createdAt, updatedAt)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL, ?7, ?8, 0, ?9, NULL, ?10, NULL, ?11, ?12, ?12)",
        params![
            appliance_id,
            case_id,
            child_id,
            appliance_type,
            status,
            started_at,
            prescribed_hours_per_day,
            prescribed_activations,
            effective_review_interval_days,
            initial_next_review_date,
            notes,
            now
        ],
    )
    .map_err(|e| format!("insert_orthodontic_appliance: {e}"))?;
    drop(conn);
    // Seed admitted protocol reminder_states for this appliance (PO-ORTHO-007 delivery).
    if status.trim() == "active" {
        seed_protocol_reminders_for_appliance(
            appliance_id.as_str(),
            child_id.as_str(),
            appliance_type.trim(),
            started_at.as_str(),
            review_interval_days,
            prescribed_hours_per_day,
            now.as_str(),
        )?;
    }
    recompute_case_next_review(case_id.as_str())?;
    Ok(())
}

#[tauri::command]
pub fn update_orthodontic_appliance_status(
    appliance_id: String,
    status: String,
    pause_reason: Option<String>,
    ended_at: Option<String>,
    now: String,
) -> Result<(), String> {
    if !is_admitted_appliance_status(status.trim()) {
        return Err(format!(
            "unsupported appliance status \"{status}\"; expected {ADMITTED_APPLIANCE_STATUSES}"
        ));
    }
    if status.trim() == "paused" && pause_reason.as_deref().unwrap_or("").is_empty() {
        return Err("appliance status=paused requires pauseReason (PO-ORTHO-004)".to_string());
    }
    if status.trim() == "completed" && ended_at.as_deref().unwrap_or("").is_empty() {
        return Err("appliance status=completed requires endedAt".to_string());
    }

    let case_id: String;
    let appliance_type: String;
    let started_at: String;
    let child_id: String;
    let prescribed_hours: Option<i32>;
    let review_interval: Option<i32>;
    {
        let conn = get_conn()?.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "UPDATE orthodontic_appliances SET status=?2, pauseReason=?3, endedAt=?4, updatedAt=?5 WHERE applianceId=?1",
            params![appliance_id, status, pause_reason, ended_at, now],
        )
        .map_err(|e| format!("update_orthodontic_appliance_status: {e}"))?;
        let row = conn
            .query_row(
                "SELECT caseId, applianceType, startedAt, childId, prescribedHoursPerDay, reviewIntervalDays FROM orthodontic_appliances WHERE applianceId = ?1",
                params![appliance_id],
                |row| Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, Option<i32>>(4)?,
                    row.get::<_, Option<i32>>(5)?,
                )),
            )
            .map_err(|e| format!("update_orthodontic_appliance_status fetch appliance meta: {e}"))?;
        case_id = row.0;
        appliance_type = row.1;
        started_at = row.2;
        child_id = row.3;
        prescribed_hours = row.4;
        review_interval = row.5;

        // Protocol reminder lifecycle transitions (PO-ORTHO-007 delivery).
        match status.trim() {
            "paused" => transition_protocol_reminders(
                &conn,
                appliance_id.as_str(),
                "dismissed",
                now.as_str(),
                Some("appliance-paused"),
            )?,
            "completed" => transition_protocol_reminders(
                &conn,
                appliance_id.as_str(),
                "completed",
                now.as_str(),
                None,
            )?,
            "active" => {} // re-seed below outside the locked connection
            _ => {}
        }
    }
    if status.trim() == "active" {
        // Resume from pause: re-seed fresh active protocol reminder_states.
        seed_protocol_reminders_for_appliance(
            appliance_id.as_str(),
            child_id.as_str(),
            appliance_type.as_str(),
            started_at.as_str(),
            review_interval,
            prescribed_hours,
            now.as_str(),
        )?;
    }
    recompute_case_next_review(case_id.as_str())?;
    Ok(())
}

#[tauri::command]
pub fn update_orthodontic_appliance_review(
    appliance_id: String,
    last_review_at: Option<String>,
    next_review_date: Option<String>,
    now: String,
) -> Result<(), String> {
    let case_id: String;
    let appliance_type: String;
    {
        let conn = get_conn()?.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "UPDATE orthodontic_appliances SET lastReviewAt=?2, nextReviewDate=?3, updatedAt=?4 WHERE applianceId=?1",
            params![appliance_id, last_review_at, next_review_date, now],
        )
        .map_err(|e| format!("update_orthodontic_appliance_review: {e}"))?;
        let row = conn
            .query_row(
                "SELECT caseId, applianceType FROM orthodontic_appliances WHERE applianceId = ?1",
                params![appliance_id],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
            )
            .map_err(|e| format!("update_orthodontic_appliance_review fetch meta: {e}"))?;
        case_id = row.0;
        appliance_type = row.1;

        // Advance the matching PO-ORTHO-REVIEW-* reminder_state's nextTriggerAt
        // so the review reminder closes its current cycle and opens the next one.
        // Skips silently when the appliance type has no review rule (none today,
        // but keeps the guard close to the match).
        if let Some(review_rule_id) = review_rule_id_for_appliance(appliance_type.as_str()) {
            let state_id = format!("ortho-{}-{}", appliance_id, review_rule_id);
            let next_trigger_iso = match next_review_date.as_deref() {
                Some(d) if !d.is_empty() => format!("{d}T00:00:00.000Z"),
                _ => "".to_string(),
            };
            if !next_trigger_iso.is_empty() {
                // Keep state status active; only advance nextTriggerAt. If the
                // state was seeded on appliance insert it already exists; if
                // the user records a review before the seed (defensive), this
                // no-ops because stateId won't match. A future migration may
                // upsert here if we introduce parent-authored review cycles.
                conn.execute(
                    "UPDATE reminder_states SET nextTriggerAt = ?2, updatedAt = ?3 WHERE stateId = ?1",
                    params![state_id, next_trigger_iso, now],
                )
                .map_err(|e| format!("update_orthodontic_appliance_review advance review state: {e}"))?;
            }
        }
    }
    recompute_case_next_review(case_id.as_str())?;
    Ok(())
}

#[tauri::command]
pub fn delete_orthodontic_appliance(appliance_id: String) -> Result<(), String> {
    let case_id: String;
    {
        let conn = get_conn()?.lock().map_err(|e| e.to_string())?;
        case_id = conn
            .query_row(
                "SELECT caseId FROM orthodontic_appliances WHERE applianceId = ?1",
                params![appliance_id],
                |row| row.get(0),
            )
            .map_err(|e| format!("delete_orthodontic_appliance fetch caseId: {e}"))?;
        // Remove protocol reminder_states before the appliance itself (FK on checkin
        // cascade already covers checkins; reminder_states is keyed by notes prefix).
        delete_protocol_reminders_for_appliance(&conn, appliance_id.as_str())?;
        conn.execute(
            "DELETE FROM orthodontic_appliances WHERE applianceId = ?1",
            params![appliance_id],
        )
        .map_err(|e| format!("delete_orthodontic_appliance: {e}"))?;
    }
    recompute_case_next_review(case_id.as_str())?;
    Ok(())
}

#[tauri::command]
pub fn get_orthodontic_appliances(case_id: String) -> Result<Vec<OrthodonticAppliance>, String> {
    let conn = get_conn()?.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT applianceId, caseId, childId, applianceType, status, startedAt, endedAt, prescribedHoursPerDay, prescribedActivations, completedActivations, reviewIntervalDays, lastReviewAt, nextReviewDate, pauseReason, notes, createdAt, updatedAt
             FROM orthodontic_appliances WHERE caseId = ?1 ORDER BY startedAt DESC, createdAt DESC",
        )
        .map_err(|e| format!("get_orthodontic_appliances: {e}"))?;
    let rows = stmt
        .query_map(params![case_id], |row| {
            Ok(OrthodonticAppliance {
                appliance_id: row.get(0)?,
                case_id: row.get(1)?,
                child_id: row.get(2)?,
                appliance_type: row.get(3)?,
                status: row.get(4)?,
                started_at: row.get(5)?,
                ended_at: row.get(6)?,
                prescribed_hours_per_day: row.get(7)?,
                prescribed_activations: row.get(8)?,
                completed_activations: row.get(9)?,
                review_interval_days: row.get(10)?,
                last_review_at: row.get(11)?,
                next_review_date: row.get(12)?,
                pause_reason: row.get(13)?,
                notes: row.get(14)?,
                created_at: row.get(15)?,
                updated_at: row.get(16)?,
            })
        })
        .map_err(|e| format!("get_orthodontic_appliances: {e}"))?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("get_orthodontic_appliances collect: {e}"))
}

fn recompute_case_next_review(case_id: &str) -> Result<(), String> {
    let conn = get_conn()?.lock().map_err(|e| e.to_string())?;
    // min(nextReviewDate) across active appliances on this case.
    let next: Option<String> = conn
        .query_row(
            "SELECT MIN(nextReviewDate) FROM orthodontic_appliances WHERE caseId = ?1 AND status = 'active' AND nextReviewDate IS NOT NULL",
            params![case_id],
            |row| row.get(0),
        )
        .unwrap_or(None);
    conn.execute(
        "UPDATE orthodontic_cases SET nextReviewDate = ?2 WHERE caseId = ?1",
        params![case_id, next],
    )
    .map_err(|e| format!("recompute_case_next_review: {e}"))?;
    Ok(())
}

// ── Checkin queries ───────────────────────────────────────

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OrthodonticCheckin {
    pub checkin_id: String,
    pub child_id: String,
    pub case_id: String,
    pub appliance_id: String,
    pub checkin_type: String,
    pub checkin_date: String,
    pub actual_wear_hours: Option<f64>,
    pub prescribed_hours: Option<f64>,
    pub compliance_bucket: Option<String>,
    pub activation_index: Option<i32>,
    pub aligner_index: Option<i32>,
    pub notes: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

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

/// Returns the orthodontic dashboard for the given child.
///
/// Important: the `compliance30d` field is a TASK-COMPLETION approximation, not
/// a clinical wear-hours reconstruction. The dashboard UI must label it as such
/// per PO-ORTHO-008.
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
