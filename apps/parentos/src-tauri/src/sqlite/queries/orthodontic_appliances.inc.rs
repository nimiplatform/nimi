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

/// PO-ORTHO-014: `activationIntervalDays` is expander-only and, when set for an
/// expander, must be a positive integer. Any non-null value on a non-expander
/// type fail-closes.
fn validate_activation_interval_days(
    appliance_type: &str,
    activation_interval_days: Option<i32>,
) -> Result<(), String> {
    match (appliance_type, activation_interval_days) {
        ("expander", Some(d)) if d > 0 => Ok(()),
        ("expander", Some(d)) => Err(format!(
            "activationIntervalDays must be a positive integer for expander; got {d} (PO-ORTHO-014)"
        )),
        ("expander", None) => Ok(()),
        (_, Some(_)) => Err(format!(
            "activationIntervalDays is expander-only and must be NULL for applianceType \"{appliance_type}\" (PO-ORTHO-014)"
        )),
        (_, None) => Ok(()),
    }
}

/// PO-ORTHO-013: `currentPhase` / `phaseStartedAt` are either both NULL ("phase
/// not yet set") or both set, and a non-null `currentPhase` must be a `phaseId`
/// admitted for the appliance's `applianceType`.
fn validate_appliance_phase_fields(
    appliance_type: &str,
    current_phase: Option<&str>,
    phase_started_at: Option<&str>,
) -> Result<(), String> {
    match (current_phase, phase_started_at) {
        (None, None) => Ok(()),
        (Some(phase), Some(_)) => {
            let seq = appliance_phase_sequence(appliance_type);
            if seq.contains(&phase) {
                Ok(())
            } else {
                Err(format!(
                    "currentPhase \"{phase}\" is not an admitted phase for applianceType \"{appliance_type}\" (PO-ORTHO-013); expected one of {seq:?}"
                ))
            }
        }
        _ => Err(
            "currentPhase and phaseStartedAt must both be set or both be NULL (PO-ORTHO-013)"
                .to_string(),
        ),
    }
}

/// Read-path fail-close (PO-ORTHO-011): a persisted appliance row must still
/// satisfy the PO-ORTHO-013 / PO-ORTHO-014 field invariants. The write paths
/// already enforce these, so a violation here means direct DB tampering or a
/// migration defect — surface it rather than render a contract-violating row.
fn validate_orthodontic_appliance_read_fields(
    appliance: &OrthodonticAppliance,
) -> Result<(), String> {
    validate_activation_interval_days(
        appliance.appliance_type.as_str(),
        appliance.activation_interval_days,
    )?;
    validate_appliance_phase_fields(
        appliance.appliance_type.as_str(),
        appliance.current_phase.as_deref(),
        appliance.phase_started_at.as_deref(),
    )?;
    Ok(())
}
#[tauri::command]
#[allow(clippy::too_many_arguments)]
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
    activation_interval_days: Option<i32>,
    total_aligners: Option<i32>,
    days_per_aligner: Option<i32>,
    current_phase: Option<String>,
    phase_started_at: Option<String>,
    review_interval_days: Option<i32>,
    next_review_agenda: Option<String>,
    notes: Option<String>,
    now: String,
) -> Result<(), String> {
    let appliance_type_trimmed = appliance_type.trim();
    let status_trimmed = status.trim();
    if !is_admitted_appliance_type(appliance_type_trimmed) {
        return Err(format!(
            "unsupported applianceType \"{appliance_type}\"; expected {ADMITTED_APPLIANCE_TYPES}"
        ));
    }
    validate_insert_orthodontic_appliance_status(status_trimmed, status.as_str())?;
    if appliance_requires_prescribed_hours(appliance_type_trimmed)
        && prescribed_hours_per_day.is_none()
    {
        return Err(format!(
            "applianceType \"{appliance_type}\" requires prescribedHoursPerDay for daily compliance checkins (PO-ORTHO-003)"
        ));
    }
    if appliance_type_trimmed == "clear-aligner" {
        match (total_aligners, days_per_aligner) {
            (Some(t), Some(d)) if t > 0 && d > 0 => {}
            _ => {
                return Err(format!(
                    "applianceType \"clear-aligner\" requires positive totalAligners and daysPerAligner (PO-ORTHO-003)"
                ));
            }
        }
    } else if total_aligners.is_some() || days_per_aligner.is_some() {
        return Err(format!(
            "totalAligners / daysPerAligner are clear-aligner-only and must be NULL for applianceType \"{appliance_type}\" (PO-ORTHO-003)"
        ));
    }
    validate_activation_interval_days(appliance_type_trimmed, activation_interval_days)?;
    validate_appliance_phase_fields(
        appliance_type_trimmed,
        current_phase.as_deref().map(str::trim),
        phase_started_at.as_deref().map(str::trim),
    )?;
    assert_age_gate(
        appliance_type_trimmed,
        started_at.trim(),
        child_birth_date.trim(),
    )?;
    let (effective_review_interval_days, initial_next_review_date) =
        derive_initial_review_schedule(
            appliance_type_trimmed,
            started_at.trim(),
            review_interval_days,
        )?;
    let conn = get_conn()?.lock().map_err(|e| e.to_string())?;
    assert_parent_case_accepts_appliance(&conn, case_id.as_str(), child_id.as_str())?;
    conn.execute(
        "INSERT INTO orthodontic_appliances (applianceId, caseId, childId, applianceType, status, startedAt, endedAt, prescribedHoursPerDay, prescribedActivations, completedActivations, activationIntervalDays, totalAligners, daysPerAligner, currentPhase, phaseStartedAt, reviewIntervalDays, lastReviewAt, nextReviewDate, nextReviewAgenda, pauseReason, notes, createdAt, updatedAt)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL, ?7, ?8, 0, ?9, ?10, ?11, ?12, ?13, ?14, NULL, ?15, ?16, NULL, ?17, ?18, ?18)",
        params![
            appliance_id,
            case_id,
            child_id,
            appliance_type,
            status,
            started_at,
            prescribed_hours_per_day,
            prescribed_activations,
            activation_interval_days,
            total_aligners,
            days_per_aligner,
            current_phase,
            phase_started_at,
            effective_review_interval_days,
            initial_next_review_date,
            next_review_agenda,
            notes,
            now
        ],
    )
    .map_err(|e| format!("insert_orthodontic_appliance: {e}"))?;
    drop(conn);
    // Seed admitted protocol reminder_states for this appliance (PO-ORTHO-007 delivery).
    if status_trimmed == "active" {
        seed_protocol_reminders_for_appliance(
            appliance_id.as_str(),
            child_id.as_str(),
            appliance_type.trim(),
            started_at.as_str(),
            review_interval_days,
            prescribed_hours_per_day,
            days_per_aligner,
            activation_interval_days,
            now.as_str(),
        )?;
    }
    recompute_case_next_review(case_id.as_str())?;
    Ok(())
}

pub(super) fn validate_insert_orthodontic_appliance_status(
    status_trimmed: &str,
    original_status: &str,
) -> Result<(), String> {
    if !is_admitted_appliance_status(status_trimmed) {
        return Err(format!(
            "unsupported appliance status \"{original_status}\"; expected {ADMITTED_APPLIANCE_STATUSES}"
        ));
    }
    if status_trimmed == "paused" {
        return Err("insert_orthodontic_appliance status=paused requires pauseReason; use the appliance status transition path so PO-ORTHO-004 pause lifecycle semantics are enforced".to_string());
    }
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
    let days_per_aligner: Option<i32>;
    let activation_interval_days: Option<i32>;
    {
        let conn = get_conn()?.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "UPDATE orthodontic_appliances SET status=?2, pauseReason=?3, endedAt=?4, updatedAt=?5 WHERE applianceId=?1",
            params![appliance_id, status, pause_reason, ended_at, now],
        )
        .map_err(|e| format!("update_orthodontic_appliance_status: {e}"))?;
        let row = conn
            .query_row(
                "SELECT caseId, applianceType, startedAt, childId, prescribedHoursPerDay, reviewIntervalDays, daysPerAligner, activationIntervalDays FROM orthodontic_appliances WHERE applianceId = ?1",
                params![appliance_id],
                |row| Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, Option<i32>>(4)?,
                    row.get::<_, Option<i32>>(5)?,
                    row.get::<_, Option<i32>>(6)?,
                    row.get::<_, Option<i32>>(7)?,
                )),
            )
            .map_err(|e| format!("update_orthodontic_appliance_status fetch appliance meta: {e}"))?;
        case_id = row.0;
        appliance_type = row.1;
        started_at = row.2;
        child_id = row.3;
        prescribed_hours = row.4;
        review_interval = row.5;
        days_per_aligner = row.6;
        activation_interval_days = row.7;
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
            days_per_aligner,
            activation_interval_days,
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

/// Edits the in-flight wear plan of an existing appliance:
/// `prescribedHoursPerDay`, `totalAligners`, `daysPerAligner`,
/// `activationIntervalDays` (PO-ORTHO-014), `nextReviewAgenda` (PO-ORTHO-015).
/// Same fail-close rules as `insert_orthodontic_appliance` (PO-ORTHO-003) —
/// `clear-aligner` requires positive `totalAligners` AND `daysPerAligner`;
/// non-clear-aligner rows must keep both NULL; `prescribed_hours_per_day` must
/// be present for any wear-gap-supporting type; `activationIntervalDays` is
/// expander-only and positive when set.
///
/// Does NOT mutate `reviewIntervalDays`, `nextReviewDate`, `status`,
/// `currentPhase`, or `phaseStartedAt` — those stay owned by the
/// review/status/phase-advance update paths so a plan edit never silently
/// advances the review cycle or the treatment phase. The
/// `PO-ORTHO-ALIGNER-CHANGE` reminder_state IS rescheduled when `daysPerAligner`
/// changes, because its cadence is definitionally `daysPerAligner`
/// (PO-ORTHO-008) and a stale value would surface as the wrong "更换下一副牙套"
/// date in the reminder center.
#[tauri::command]
pub fn update_orthodontic_appliance_plan(
    appliance_id: String,
    prescribed_hours_per_day: Option<i32>,
    total_aligners: Option<i32>,
    days_per_aligner: Option<i32>,
    activation_interval_days: Option<i32>,
    next_review_agenda: Option<String>,
    now: String,
) -> Result<(), String> {
    let conn = get_conn()?.lock().map_err(|e| e.to_string())?;
    let appliance_type: String = conn
        .query_row(
            "SELECT applianceType FROM orthodontic_appliances WHERE applianceId = ?1",
            params![appliance_id],
            |row| row.get(0),
        )
        .map_err(|e| format!("update_orthodontic_appliance_plan: appliance \"{appliance_id}\" not found: {e}"))?;
    let appliance_type_trimmed = appliance_type.trim();

    if appliance_requires_prescribed_hours(appliance_type_trimmed)
        && prescribed_hours_per_day.is_none()
    {
        return Err(format!(
            "applianceType \"{appliance_type}\" requires prescribedHoursPerDay (PO-ORTHO-003)"
        ));
    }
    if let Some(h) = prescribed_hours_per_day {
        if h <= 0 || h > 24 {
            return Err(format!(
                "prescribedHoursPerDay must be in 1..24 hours; got {h}"
            ));
        }
    }
    if appliance_type_trimmed == "clear-aligner" {
        match (total_aligners, days_per_aligner) {
            (Some(t), Some(d)) if t > 0 && d > 0 => {}
            _ => {
                return Err(
                    "applianceType \"clear-aligner\" requires positive totalAligners and daysPerAligner (PO-ORTHO-003)"
                        .to_string(),
                );
            }
        }
    } else if total_aligners.is_some() || days_per_aligner.is_some() {
        return Err(format!(
            "totalAligners / daysPerAligner are clear-aligner-only and must be NULL for applianceType \"{appliance_type}\" (PO-ORTHO-003)"
        ));
    }
    validate_activation_interval_days(appliance_type_trimmed, activation_interval_days)?;

    conn.execute(
        "UPDATE orthodontic_appliances
         SET prescribedHoursPerDay = ?2,
             totalAligners = ?3,
             daysPerAligner = ?4,
             activationIntervalDays = ?5,
             nextReviewAgenda = ?6,
             updatedAt = ?7
         WHERE applianceId = ?1",
        params![
            appliance_id,
            prescribed_hours_per_day,
            total_aligners,
            days_per_aligner,
            activation_interval_days,
            next_review_agenda,
            now,
        ],
    )
    .map_err(|e| format!("update_orthodontic_appliance_plan: {e}"))?;
    // Reschedule the active PO-ORTHO-ALIGNER-CHANGE reminder so its
    // nextTriggerAt reflects the new daysPerAligner. Anchor is the latest
    // aligner-change checkin date if any, else the appliance startedAt.
    if appliance_type_trimmed == "clear-aligner" {
        if let Some(dpa) = days_per_aligner {
            let anchor: Option<String> = conn
                .query_row(
                    "SELECT COALESCE(
                         (SELECT checkinDate FROM orthodontic_checkins
                          WHERE applianceId = ?1 AND checkinType = 'aligner-change'
                          ORDER BY checkinDate DESC, createdAt DESC LIMIT 1),
                         (SELECT startedAt FROM orthodontic_appliances WHERE applianceId = ?1)
                     )",
                    params![appliance_id],
                    |row| row.get::<_, Option<String>>(0),
                )
                .map_err(|e| format!("update_orthodontic_appliance_plan fetch aligner-change anchor: {e}"))?;
            if let Some(anchor_date) = anchor {
                let next = add_days_iso(anchor_date.as_str(), i64::from(dpa));
                let next_iso = format!("{next}T00:00:00.000Z");
                let state_id = format!("ortho-{}-PO-ORTHO-ALIGNER-CHANGE", appliance_id);
                conn.execute(
                    "UPDATE reminder_states SET nextTriggerAt = ?2, updatedAt = ?3
                     WHERE stateId = ?1 AND status = 'active'",
                    params![state_id, next_iso, now],
                )
                .map_err(|e| format!("update_orthodontic_appliance_plan reschedule aligner-change: {e}"))?;
            }
        }
    }
    Ok(())
}

/// Resolves the admitted next phase for a phase advance (PO-ORTHO-013): the
/// first phase when `current_phase` is None, the phase one step after the
/// current one otherwise. `Ok(None)` means the appliance is already at the
/// final phase. `Err` when the type has no sequence or the persisted phase is
/// not in the type's sequence (fail-close).
fn resolve_next_appliance_phase(
    appliance_type: &str,
    current_phase: Option<&str>,
) -> Result<Option<&'static str>, String> {
    let seq = appliance_phase_sequence(appliance_type);
    if seq.is_empty() {
        return Err(format!(
            "applianceType \"{appliance_type}\" has no admitted phase sequence (PO-ORTHO-013)"
        ));
    }
    match current_phase {
        None => Ok(seq.first().copied()),
        Some(curr) => {
            let idx = seq.iter().position(|p| *p == curr).ok_or_else(|| {
                format!(
                    "persisted currentPhase \"{curr}\" is not in the \"{appliance_type}\" phase sequence (PO-ORTHO-013)"
                )
            })?;
            Ok(seq.get(idx + 1).copied())
        }
    }
}

/// PO-ORTHO-013: parent-initiated, adjacency-only treatment-phase advance.
/// The admitted `next_phase` is the immediate next `phaseId` in the appliance
/// type's sequence — the first phase when `currentPhase` is NULL, otherwise the
/// phase one step after the current one. Any other target fail-closes. Sets
/// `phaseStartedAt` to the UTC date component of `now`.
#[tauri::command]
pub fn advance_orthodontic_appliance_phase(
    appliance_id: String,
    next_phase: String,
    now: String,
) -> Result<(), String> {
    let next_phase_trimmed = next_phase.trim();
    let conn = get_conn()?.lock().map_err(|e| e.to_string())?;
    let (appliance_type, current_phase): (String, Option<String>) = conn
        .query_row(
            "SELECT applianceType, currentPhase FROM orthodontic_appliances WHERE applianceId = ?1",
            params![appliance_id],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?)),
        )
        .map_err(|e| {
            format!("advance_orthodontic_appliance_phase: appliance \"{appliance_id}\" not found: {e}")
        })?;
    let Some(expected_next) =
        resolve_next_appliance_phase(appliance_type.as_str(), current_phase.as_deref())?
    else {
        return Err(format!(
            "appliance \"{appliance_id}\" is already at the final phase of its \"{appliance_type}\" sequence; no next phase to advance to (PO-ORTHO-013)"
        ));
    };
    if next_phase_trimmed != expected_next {
        return Err(format!(
            "phase transition target \"{next_phase_trimmed}\" is not the immediate next phase (expected \"{expected_next}\") for applianceType \"{appliance_type}\" (PO-ORTHO-013)"
        ));
    }
    let phase_started_at = if now.len() >= 10 {
        &now[..10]
    } else {
        now.as_str()
    };
    conn.execute(
        "UPDATE orthodontic_appliances SET currentPhase = ?2, phaseStartedAt = ?3, updatedAt = ?4 WHERE applianceId = ?1",
        params![appliance_id, next_phase_trimmed, phase_started_at, now],
    )
    .map_err(|e| format!("advance_orthodontic_appliance_phase: {e}"))?;
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
            "SELECT applianceId, caseId, childId, applianceType, status, startedAt, endedAt, prescribedHoursPerDay, prescribedActivations, completedActivations, activationIntervalDays, totalAligners, daysPerAligner, currentPhase, phaseStartedAt, reviewIntervalDays, lastReviewAt, nextReviewDate, nextReviewAgenda, pauseReason, notes, createdAt, updatedAt
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
                activation_interval_days: row.get(10)?,
                total_aligners: row.get(11)?,
                days_per_aligner: row.get(12)?,
                current_phase: row.get(13)?,
                phase_started_at: row.get(14)?,
                review_interval_days: row.get(15)?,
                last_review_at: row.get(16)?,
                next_review_date: row.get(17)?,
                next_review_agenda: row.get(18)?,
                pause_reason: row.get(19)?,
                notes: row.get(20)?,
                created_at: row.get(21)?,
                updated_at: row.get(22)?,
            })
        })
        .map_err(|e| format!("get_orthodontic_appliances: {e}"))?;
    let appliances = rows
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("get_orthodontic_appliances collect: {e}"))?;
    for appliance in &appliances {
        validate_orthodontic_appliance_read_fields(appliance)?;
    }
    Ok(appliances)
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
//
// Daily wear is NOT a checkin (PO-ORTHO-005a). Admitted checkin types are
// `aligner-change` and `expander-activation`. Legacy `actualWearHours`,
// `prescribedHours`, and `complianceBucket` columns were dropped by migration
// v15 (PO-ORTHO-005b).
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OrthodonticCheckin {
    pub checkin_id: String,
    pub child_id: String,
    pub case_id: String,
    pub appliance_id: String,
    pub checkin_type: String,
    pub checkin_date: String,
    /// PO-ORTHO-008 cycle anchor: ISO 8601 datetime when the event actually
    /// occurred. NULL on legacy rows (pre-v19); renderer falls back to
    /// `checkin_date` at 00:00 UTC for those rows.
    pub checkin_at: Option<String>,
    pub activation_index: Option<i32>,
    pub aligner_index: Option<i32>,
    pub notes: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[cfg(test)]
mod appliance_field_guard_tests {
    //! Unit coverage for the PO-ORTHO-013 / PO-ORTHO-014 fail-close validators
    //! and the parent-initiated phase-advance adjacency resolver.
    use super::{
        resolve_next_appliance_phase, validate_activation_interval_days,
        validate_appliance_phase_fields,
    };

    #[test]
    fn activation_interval_days_is_expander_only_and_positive() {
        assert!(validate_activation_interval_days("expander", Some(3)).is_ok());
        assert!(validate_activation_interval_days("expander", None).is_ok());
        assert!(validate_activation_interval_days("expander", Some(0)).is_err());
        assert!(validate_activation_interval_days("expander", Some(-1)).is_err());
        // Non-expander types must keep it NULL.
        assert!(validate_activation_interval_days("clear-aligner", None).is_ok());
        let err = validate_activation_interval_days("metal-braces", Some(2))
            .expect_err("non-expander with a value must fail-close");
        assert!(err.contains("PO-ORTHO-014"));
    }

    #[test]
    fn appliance_phase_fields_require_paired_nullness_and_admitted_phase() {
        // Both NULL — admitted "not yet set" state.
        assert!(validate_appliance_phase_fields("expander", None, None).is_ok());
        // Both set with an admitted phaseId for the type.
        assert!(
            validate_appliance_phase_fields("expander", Some("widening"), Some("2026-05-01")).is_ok()
        );
        // Phase not in the type's sequence.
        let bad_phase =
            validate_appliance_phase_fields("expander", Some("leveling"), Some("2026-05-01"))
                .expect_err("phase outside the type sequence must fail-close");
        assert!(bad_phase.contains("PO-ORTHO-013"));
        // Unpaired nullness.
        assert!(validate_appliance_phase_fields("expander", Some("widening"), None).is_err());
        assert!(validate_appliance_phase_fields("expander", None, Some("2026-05-01")).is_err());
    }

    #[test]
    fn next_phase_resolver_is_adjacency_only() {
        // NULL → first phase.
        assert_eq!(
            resolve_next_appliance_phase("metal-braces", None).unwrap(),
            Some("leveling")
        );
        // Mid-sequence → the immediate next.
        assert_eq!(
            resolve_next_appliance_phase("metal-braces", Some("leveling")).unwrap(),
            Some("space-closure")
        );
        // Final phase → None (no next).
        assert_eq!(
            resolve_next_appliance_phase("metal-braces", Some("debond-prep")).unwrap(),
            None
        );
        // Persisted phase not in the type's sequence → fail-close.
        assert!(resolve_next_appliance_phase("metal-braces", Some("widening")).is_err());
        // Unknown applianceType has no sequence → fail-close.
        assert!(resolve_next_appliance_phase("not-a-type", None).is_err());
    }
}
