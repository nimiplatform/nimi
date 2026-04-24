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
