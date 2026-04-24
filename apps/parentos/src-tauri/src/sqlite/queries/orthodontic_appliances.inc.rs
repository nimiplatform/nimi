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
