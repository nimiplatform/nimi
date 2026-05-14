// `compute_compliance_bucket` and the corresponding daily-bucket thresholds
// were retired by migration v15 along with `wear-daily` / `retention-wear`
// (PO-ORTHO-005b). Compliance is now a per-cycle continuous projection
// computed in the renderer (`orthodontic-derive.ts`); no Rust helper is
// needed at the storage seam.
#[tauri::command]
pub fn insert_orthodontic_checkin(
    checkin_id: String,
    child_id: String,
    case_id: String,
    appliance_id: String,
    checkin_type: String,
    checkin_date: String,
    checkin_at: Option<String>,
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
    // PO-ORTHO-005 invariant: when checkinAt is provided, its UTC date
    // component must match checkinDate so the day-bucketed indexes and the
    // sub-day cycle anchor stay coherent. Empty string is treated as None.
    let checkin_at_norm: Option<String> = match checkin_at.as_deref() {
        None => None,
        Some(s) if s.trim().is_empty() => None,
        Some(s) => Some(s.trim().to_string()),
    };
    if let Some(ts) = checkin_at_norm.as_deref() {
        if ts.len() < 10 || &ts[..10] != checkin_date {
            return Err(format!(
                "checkinAt UTC date component ({}) does not match checkinDate ({}) — PO-ORTHO-005",
                &ts[..ts.len().min(10)],
                checkin_date
            ));
        }
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
        "INSERT INTO orthodontic_checkins (checkinId, childId, caseId, applianceId, checkinType, checkinDate, checkinAt, activationIndex, alignerIndex, notes, createdAt, updatedAt)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?11)",
        params![checkin_id, child_id, case_id, appliance_id, checkin_type, checkin_date, checkin_at_norm, activation_index, aligner_index, notes, now],
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
        // Cadence follows the appliance's own schedule so the reminder lines up
        // with the actual change cycle: PO-ORTHO-ALIGNER-CHANGE uses
        // daysPerAligner (PO-ORTHO-008); PO-ORTHO-EXPANDER-ACTIVATION uses
        // activationIntervalDays (PO-ORTHO-014). Both fall back to the catalog
        // default only if the column is NULL.
        let advance_days = match ct {
            "expander-activation" => {
                let aid: Option<i32> = conn
                    .query_row(
                        "SELECT activationIntervalDays FROM orthodontic_appliances WHERE applianceId = ?1",
                        params![appliance_id],
                        |row| row.get(0),
                    )
                    .map_err(|e| {
                        format!("insert_orthodontic_checkin fetch activationIntervalDays: {e}")
                    })?;
                aid.map(i64::from).unwrap_or(1)
            }
            "aligner-change" => {
                let dpa: Option<i32> = conn
                    .query_row(
                        "SELECT daysPerAligner FROM orthodontic_appliances WHERE applianceId = ?1",
                        params![appliance_id],
                        |row| row.get(0),
                    )
                    .map_err(|e| format!("insert_orthodontic_checkin fetch daysPerAligner: {e}"))?;
                dpa.map(i64::from).unwrap_or(14)
            }
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
            "SELECT checkinId, childId, caseId, applianceId, checkinType, checkinDate, checkinAt, activationIndex, alignerIndex, notes, createdAt, updatedAt
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
                checkin_at: row.get(6)?,
                activation_index: row.get(7)?,
                aligner_index: row.get(8)?,
                notes: row.get(9)?,
                created_at: row.get(10)?,
                updated_at: row.get(11)?,
            })
        })
        .map_err(|e| format!("get_orthodontic_checkins: {e}"))?;
    let checkins = rows
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("get_orthodontic_checkins collect: {e}"))?;
    for checkin in &checkins {
        validate_orthodontic_checkin_read_type(checkin.checkin_type.as_str())?;
    }
    Ok(checkins)
}

pub(super) fn validate_orthodontic_checkin_read_type(checkin_type: &str) -> Result<(), String> {
    if !is_admitted_checkin_type(checkin_type.trim()) {
        return Err(format!(
            "persisted unsupported orthodontic checkinType \"{checkin_type}\"; expected {ADMITTED_CHECKIN_TYPES} (PO-ORTHO-005b)"
        ));
    }
    Ok(())
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
