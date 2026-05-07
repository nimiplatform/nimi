// Wear-gap interval command surface (PO-ORTHO-005a).
//
// Daily wear is the default assumption (22h/day for clear-aligner; per
// `prescribedHoursPerDay` for other removable types). Parents only record
// EXCEPTIONS — `(startAt, endAt)` pairs when the appliance is taken out.
// `endAt IS NULL` is a half-open "still un-worn" interval; the storage
// partial unique index plus this command-layer guard enforces "at most one
// open interval per applianceId".
//
// Open intervals seed a `PO-ORTHO-UNWEAR-OPEN` reminder_state with
// `nextTriggerAt = startAt + 4h`; closing or deleting the interval marks the
// reminder_state completed. This rule is event-driven and is therefore NOT
// part of `protocols_for_appliance` (which is for appliance-creation seeding).

const ADMITTED_UNWEAR_REASONS: &str = "meal | sport | school | sleep | other";
const UNWEAR_OPEN_NUDGE_HOURS: i64 = 4;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OrthodonticUnwearInterval {
    pub interval_id: String,
    pub child_id: String,
    pub case_id: String,
    pub appliance_id: String,
    pub start_at: String,
    pub end_at: Option<String>,
    pub reason: Option<String>,
    pub notes: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

fn is_admitted_unwear_reason(r: &str) -> bool {
    matches!(r, "meal" | "sport" | "school" | "sleep" | "other")
}

/// Returns the `applianceType` of the parent appliance plus a round-trip check
/// against the declared `caseId` / `childId`. Fails closed if the triple does
/// not match (PO-ORTHO-005a invariant).
fn fetch_appliance_for_unwear(
    conn: &Connection,
    appliance_id: &str,
    case_id: &str,
    child_id: &str,
) -> Result<String, String> {
    let row: Option<String> = conn
        .query_row(
            "SELECT applianceType FROM orthodontic_appliances WHERE applianceId = ?1 AND caseId = ?2 AND childId = ?3",
            params![appliance_id, case_id, child_id],
            |row| row.get::<_, String>(0),
        )
        .ok();
    row.ok_or_else(|| {
        "wear-gap interval applianceId does not round-trip to declared caseId/childId (PO-ORTHO-005a)"
            .to_string()
    })
}

/// Asserts `endAt > startAt` when `endAt` is present.
fn assert_end_after_start(start_at: &str, end_at: Option<&str>) -> Result<(), String> {
    if let Some(end) = end_at {
        if end <= start_at {
            return Err(format!(
                "wear-gap interval endAt \"{end}\" must be strictly greater than startAt \"{start_at}\""
            ));
        }
    }
    Ok(())
}

fn assert_no_other_open_interval(
    conn: &Connection,
    appliance_id: &str,
    excluding_interval_id: Option<&str>,
) -> Result<(), String> {
    let exists: i64 = match excluding_interval_id {
        Some(excl) => conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM orthodontic_unwear_intervals WHERE applianceId = ?1 AND endAt IS NULL AND intervalId <> ?2)",
            params![appliance_id, excl],
            |row| row.get(0),
        ),
        None => conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM orthodontic_unwear_intervals WHERE applianceId = ?1 AND endAt IS NULL)",
            params![appliance_id],
            |row| row.get(0),
        ),
    }
    .map_err(|e| format!("assert_no_other_open_interval query: {e}"))?;
    if exists == 1 {
        return Err(
            "applianceId already has an open un-wear interval; close it before opening another (PO-ORTHO-005a)"
                .to_string(),
        );
    }
    Ok(())
}

/// Adds N hours to an ISO datetime string with sub-second precision support.
fn add_hours_iso(iso: &str, hours: i64) -> Result<String, String> {
    use chrono::{DateTime, Duration, Utc};
    let parsed = DateTime::parse_from_rfc3339(iso)
        .map_err(|e| format!("invalid ISO datetime \"{iso}\": {e}"))?
        .with_timezone(&Utc);
    let next = parsed
        .checked_add_signed(Duration::hours(hours))
        .ok_or_else(|| format!("datetime overflow adding {hours}h to {iso}"))?;
    Ok(next
        .format("%Y-%m-%dT%H:%M:%S%.3fZ")
        .to_string())
}

fn unwear_open_state_id(interval_id: &str) -> String {
    format!("ortho-unwear-{interval_id}")
}

fn seed_unwear_open_reminder(
    conn: &Connection,
    interval_id: &str,
    child_id: &str,
    appliance_id: &str,
    start_at: &str,
    now: &str,
) -> Result<(), String> {
    let state_id = unwear_open_state_id(interval_id);
    let next_trigger = add_hours_iso(start_at, UNWEAR_OPEN_NUDGE_HOURS)?;
    let notes = format!("[ortho-protocol] applianceId={appliance_id}; intervalId={interval_id}");
    let repeat_index =
        next_repeat_index_for_seed(conn, &state_id, child_id, "PO-ORTHO-UNWEAR-OPEN")?;
    conn.execute(
        "INSERT INTO reminder_states (stateId, childId, ruleId, status, activatedAt, completedAt, dismissedAt, dismissReason, repeatIndex, nextTriggerAt, snoozedUntil, scheduledDate, notApplicable, plannedForDate, surfaceRank, lastSurfacedAt, surfaceCount, notes, createdAt, updatedAt)
         VALUES (?1, ?2, 'PO-ORTHO-UNWEAR-OPEN', 'active', ?3, NULL, NULL, NULL, ?4, ?5, NULL, NULL, 0, NULL, NULL, NULL, 0, ?6, ?3, ?3)
         ON CONFLICT(stateId) DO UPDATE SET status='active', activatedAt=?3, completedAt=NULL, dismissedAt=NULL, dismissReason=NULL, nextTriggerAt=?5, notes=?6, updatedAt=?3",
        params![state_id, child_id, now, repeat_index, next_trigger, notes],
    )
    .map_err(|e| format!("seed_unwear_open_reminder({interval_id}): {e}"))?;
    Ok(())
}

fn complete_unwear_open_reminder(
    conn: &Connection,
    interval_id: &str,
    now: &str,
) -> Result<(), String> {
    let state_id = unwear_open_state_id(interval_id);
    conn.execute(
        "UPDATE reminder_states SET status='completed', completedAt=?2, updatedAt=?2 WHERE stateId = ?1 AND status <> 'completed'",
        params![state_id, now],
    )
    .map_err(|e| format!("complete_unwear_open_reminder({interval_id}): {e}"))?;
    Ok(())
}

fn delete_unwear_open_reminder(conn: &Connection, interval_id: &str) -> Result<(), String> {
    let state_id = unwear_open_state_id(interval_id);
    conn.execute(
        "DELETE FROM reminder_states WHERE stateId = ?1",
        params![state_id],
    )
    .map_err(|e| format!("delete_unwear_open_reminder({interval_id}): {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn insert_unwear_interval(
    interval_id: String,
    child_id: String,
    case_id: String,
    appliance_id: String,
    start_at: String,
    end_at: Option<String>,
    reason: Option<String>,
    notes: Option<String>,
    now: String,
) -> Result<(), String> {
    if let Some(r) = reason.as_deref() {
        if !is_admitted_unwear_reason(r.trim()) {
            return Err(format!(
                "unsupported wear-gap reason \"{r}\"; expected {ADMITTED_UNWEAR_REASONS}"
            ));
        }
    }
    assert_end_after_start(&start_at, end_at.as_deref())?;
    let conn = get_conn()?.lock().map_err(|e| e.to_string())?;
    let appliance_type =
        fetch_appliance_for_unwear(&conn, &appliance_id, &case_id, &child_id)?;
    if !appliance_supports_wear_gap(appliance_type.as_str()) {
        return Err(format!(
            "applianceType \"{appliance_type}\" does not support wear-gap intervals; admitted: clear-aligner | twin-block | activator | retainer-removable (PO-ORTHO-005a)"
        ));
    }
    if end_at.is_none() {
        assert_no_other_open_interval(&conn, &appliance_id, None)?;
    }
    conn.execute(
        "INSERT INTO orthodontic_unwear_intervals (intervalId, childId, caseId, applianceId, startAt, endAt, reason, notes, createdAt, updatedAt)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)",
        params![interval_id, child_id, case_id, appliance_id, start_at, end_at, reason, notes, now],
    )
    .map_err(|e| format!("insert_unwear_interval: {e}"))?;
    if end_at.is_none() {
        seed_unwear_open_reminder(&conn, &interval_id, &child_id, &appliance_id, &start_at, &now)?;
    }
    Ok(())
}

#[tauri::command]
pub fn close_unwear_interval(
    interval_id: String,
    end_at: String,
    now: String,
) -> Result<(), String> {
    let conn = get_conn()?.lock().map_err(|e| e.to_string())?;
    let row: Option<(String, Option<String>)> = conn
        .query_row(
            "SELECT startAt, endAt FROM orthodontic_unwear_intervals WHERE intervalId = ?1",
            params![interval_id],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?)),
        )
        .ok();
    let Some((start_at, current_end)) = row else {
        return Err(format!(
            "wear-gap interval \"{interval_id}\" does not exist"
        ));
    };
    if current_end.is_some() {
        return Err(format!(
            "wear-gap interval \"{interval_id}\" is already closed; use update_unwear_interval to edit history"
        ));
    }
    if end_at <= start_at {
        return Err(format!(
            "wear-gap interval endAt \"{end_at}\" must be strictly greater than startAt \"{start_at}\""
        ));
    }
    conn.execute(
        "UPDATE orthodontic_unwear_intervals SET endAt = ?2, updatedAt = ?3 WHERE intervalId = ?1",
        params![interval_id, end_at, now],
    )
    .map_err(|e| format!("close_unwear_interval: {e}"))?;
    complete_unwear_open_reminder(&conn, &interval_id, &now)?;
    Ok(())
}

#[tauri::command]
pub fn update_unwear_interval(
    interval_id: String,
    start_at: String,
    end_at: Option<String>,
    reason: Option<String>,
    notes: Option<String>,
    now: String,
) -> Result<(), String> {
    if let Some(r) = reason.as_deref() {
        if !is_admitted_unwear_reason(r.trim()) {
            return Err(format!(
                "unsupported wear-gap reason \"{r}\"; expected {ADMITTED_UNWEAR_REASONS}"
            ));
        }
    }
    assert_end_after_start(&start_at, end_at.as_deref())?;
    let conn = get_conn()?.lock().map_err(|e| e.to_string())?;
    let row: Option<(String, String, Option<String>)> = conn
        .query_row(
            "SELECT applianceId, childId, endAt FROM orthodontic_unwear_intervals WHERE intervalId = ?1",
            params![interval_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<String>>(2)?,
                ))
            },
        )
        .ok();
    let Some((appliance_id, child_id, current_end)) = row else {
        return Err(format!(
            "wear-gap interval \"{interval_id}\" does not exist"
        ));
    };
    if end_at.is_none() {
        assert_no_other_open_interval(&conn, &appliance_id, Some(&interval_id))?;
    }
    conn.execute(
        "UPDATE orthodontic_unwear_intervals SET startAt = ?2, endAt = ?3, reason = ?4, notes = ?5, updatedAt = ?6 WHERE intervalId = ?1",
        params![interval_id, start_at, end_at, reason, notes, now],
    )
    .map_err(|e| format!("update_unwear_interval: {e}"))?;
    // Reconcile reminder_state with the new open/closed shape.
    match (current_end.is_some(), end_at.is_some()) {
        (true, false) => {
            // Was closed, now open again — re-seed the nudge.
            seed_unwear_open_reminder(&conn, &interval_id, &child_id, &appliance_id, &start_at, &now)?;
        }
        (false, true) => {
            complete_unwear_open_reminder(&conn, &interval_id, &now)?;
        }
        (false, false) => {
            // Still open; refresh nextTriggerAt to startAt + 4h in case startAt moved.
            seed_unwear_open_reminder(&conn, &interval_id, &child_id, &appliance_id, &start_at, &now)?;
        }
        (true, true) => { /* still closed, no reminder action */ }
    }
    Ok(())
}

#[tauri::command]
pub fn delete_unwear_interval(interval_id: String) -> Result<(), String> {
    let conn = get_conn()?.lock().map_err(|e| e.to_string())?;
    delete_unwear_open_reminder(&conn, &interval_id)?;
    let affected = conn
        .execute(
            "DELETE FROM orthodontic_unwear_intervals WHERE intervalId = ?1",
            params![interval_id],
        )
        .map_err(|e| format!("delete_unwear_interval: {e}"))?;
    if affected == 0 {
        return Err(format!(
            "wear-gap interval \"{interval_id}\" does not exist"
        ));
    }
    Ok(())
}

#[tauri::command]
pub fn get_unwear_intervals(
    appliance_id: String,
    limit: Option<i32>,
) -> Result<Vec<OrthodonticUnwearInterval>, String> {
    let conn = get_conn()?.lock().map_err(|e| e.to_string())?;
    let cap = limit.unwrap_or(200);
    let mut stmt = conn
        .prepare(
            "SELECT intervalId, childId, caseId, applianceId, startAt, endAt, reason, notes, createdAt, updatedAt
             FROM orthodontic_unwear_intervals
             WHERE applianceId = ?1
             ORDER BY startAt DESC, createdAt DESC
             LIMIT ?2",
        )
        .map_err(|e| format!("get_unwear_intervals prepare: {e}"))?;
    let rows = stmt
        .query_map(params![appliance_id, cap], |row| {
            Ok(OrthodonticUnwearInterval {
                interval_id: row.get(0)?,
                child_id: row.get(1)?,
                case_id: row.get(2)?,
                appliance_id: row.get(3)?,
                start_at: row.get(4)?,
                end_at: row.get(5)?,
                reason: row.get(6)?,
                notes: row.get(7)?,
                created_at: row.get(8)?,
                updated_at: row.get(9)?,
            })
        })
        .map_err(|e| format!("get_unwear_intervals query: {e}"))?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("get_unwear_intervals collect: {e}"))
}
