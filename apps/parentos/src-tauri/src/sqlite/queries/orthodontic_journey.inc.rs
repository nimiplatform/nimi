// Orthodontic journey projection (PO-ORTHO-001 four-layer + PO-ORTHO-007).
//
// Combines past events from health_record_events (clinical), orthodontic_checkins
// (aligner-change, expander-activation), orthodontic_unwear_intervals
// (closed gaps), and lifecycle moments (case-started, appliance-paused,
// appliance-completed) with future events derived from appliance.nextReviewDate,
// daysPerAligner cycle math, and reminder_states.nextTriggerAt.
//
// The projection is a typed, tagged enum returned to the renderer; future
// events use `predictedAt` while past events use `occurredAt`. Both lists
// are sorted ascending by their respective time fields.

#[derive(Debug, Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
#[allow(dead_code)] // some variants are reserved for renderer use without server-side population
pub enum JourneyEntry {
    #[serde(rename_all = "camelCase")]
    CaseStarted {
        occurred_at: String,
        case_type: String,
        stage: String,
    },
    #[serde(rename_all = "camelCase")]
    ApplianceStarted {
        occurred_at: String,
        appliance_id: String,
        appliance_type: String,
    },
    #[serde(rename_all = "camelCase")]
    AppliancePaused {
        occurred_at: String,
        appliance_id: String,
        reason: Option<String>,
    },
    #[serde(rename_all = "camelCase")]
    ApplianceCompleted {
        occurred_at: String,
        appliance_id: String,
    },
    #[serde(rename_all = "camelCase")]
    AlignerChange {
        occurred_at: String,
        appliance_id: String,
        aligner_index: i32,
    },
    #[serde(rename_all = "camelCase")]
    ExpanderActivation {
        occurred_at: String,
        appliance_id: String,
        activation_index: i32,
    },
    #[serde(rename_all = "camelCase")]
    ClinicalEvent {
        occurred_at: String,
        event_type: String,
        hospital: Option<String>,
        notes: Option<String>,
    },
    #[serde(rename_all = "camelCase")]
    UnwearInterval {
        start_at: String,
        end_at: Option<String>,
        duration_hours: Option<f64>,
        reason: Option<String>,
    },
    #[serde(rename_all = "camelCase")]
    NextClinicalReview {
        predicted_at: String,
        appliance_id: String,
        rule_id: String,
    },
    #[serde(rename_all = "camelCase")]
    NextAlignerChange {
        predicted_at: String,
        appliance_id: String,
        aligner_index: i32,
    },
    #[serde(rename_all = "camelCase")]
    CyclePlannedSwitch {
        predicted_at: String,
        appliance_id: String,
    },
    #[serde(rename_all = "camelCase")]
    CasePlannedEnd { predicted_at: String },
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OrthodonticJourney {
    pub past: Vec<JourneyEntry>,
    pub future: Vec<JourneyEntry>,
}

fn occurred_at_for_journey_entry(entry: &JourneyEntry) -> &str {
    match entry {
        JourneyEntry::CaseStarted { occurred_at, .. } => occurred_at,
        JourneyEntry::ApplianceStarted { occurred_at, .. } => occurred_at,
        JourneyEntry::AppliancePaused { occurred_at, .. } => occurred_at,
        JourneyEntry::ApplianceCompleted { occurred_at, .. } => occurred_at,
        JourneyEntry::AlignerChange { occurred_at, .. } => occurred_at,
        JourneyEntry::ExpanderActivation { occurred_at, .. } => occurred_at,
        JourneyEntry::ClinicalEvent { occurred_at, .. } => occurred_at,
        JourneyEntry::UnwearInterval { start_at, .. } => start_at,
        JourneyEntry::NextClinicalReview { predicted_at, .. } => predicted_at,
        JourneyEntry::NextAlignerChange { predicted_at, .. } => predicted_at,
        JourneyEntry::CyclePlannedSwitch { predicted_at, .. } => predicted_at,
        JourneyEntry::CasePlannedEnd { predicted_at } => predicted_at,
    }
}

fn parse_iso_hours_diff(start: &str, end: &str) -> Option<f64> {
    use chrono::DateTime;
    let s = DateTime::parse_from_rfc3339(start).ok()?;
    let e = DateTime::parse_from_rfc3339(end).ok()?;
    let diff = e.signed_duration_since(s);
    Some(diff.num_seconds() as f64 / 3600.0)
}

#[tauri::command]
pub fn get_orthodontic_journey(
    child_id: String,
    case_id: String,
) -> Result<OrthodonticJourney, String> {
    let conn = get_conn()?.lock().map_err(|e| e.to_string())?;
    // Verify caseId belongs to childId; fail-close otherwise.
    let case_meta: Option<(String, String, String, Option<String>, Option<String>)> = conn
        .query_row(
            "SELECT caseType, stage, startedAt, plannedEndAt, actualEndAt FROM orthodontic_cases WHERE caseId = ?1 AND childId = ?2",
            params![case_id, child_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, Option<String>>(3)?,
                    row.get::<_, Option<String>>(4)?,
                ))
            },
        )
        .ok();
    let Some((case_type, stage, case_started_at, planned_end_at, _actual_end_at)) = case_meta
    else {
        return Err(format!(
            "case \"{case_id}\" does not exist for child \"{child_id}\""
        ));
    };

    let mut past: Vec<JourneyEntry> = Vec::new();
    let mut future: Vec<JourneyEntry> = Vec::new();

    // ── Past: case started ──
    past.push(JourneyEntry::CaseStarted {
        occurred_at: format!("{case_started_at}T00:00:00.000Z"),
        case_type: case_type.clone(),
        stage,
    });

    // ── Past: appliance lifecycle (started / paused / completed) ──
    let mut appliance_stmt = conn
        .prepare(
            "SELECT applianceId, applianceType, startedAt, status, pauseReason, endedAt, updatedAt, daysPerAligner, totalAligners, prescribedHoursPerDay, reviewIntervalDays, nextReviewDate
             FROM orthodontic_appliances WHERE caseId = ?1 ORDER BY startedAt ASC, createdAt ASC",
        )
        .map_err(|e| format!("get_orthodontic_journey appliance prepare: {e}"))?;
    struct ApplianceRowJ {
        appliance_id: String,
        appliance_type: String,
        started_at: String,
        status: String,
        pause_reason: Option<String>,
        ended_at: Option<String>,
        updated_at: String,
        days_per_aligner: Option<i32>,
        total_aligners: Option<i32>,
        prescribed_hours_per_day: Option<i32>,
        review_interval_days: Option<i32>,
        next_review_date: Option<String>,
    }
    let appliance_rows: Vec<ApplianceRowJ> = appliance_stmt
        .query_map(params![case_id], |row| {
            Ok(ApplianceRowJ {
                appliance_id: row.get(0)?,
                appliance_type: row.get(1)?,
                started_at: row.get(2)?,
                status: row.get(3)?,
                pause_reason: row.get(4)?,
                ended_at: row.get(5)?,
                updated_at: row.get(6)?,
                days_per_aligner: row.get(7)?,
                total_aligners: row.get(8)?,
                prescribed_hours_per_day: row.get(9)?,
                review_interval_days: row.get(10)?,
                next_review_date: row.get(11)?,
            })
        })
        .map_err(|e| format!("get_orthodontic_journey appliance query: {e}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("get_orthodontic_journey appliance collect: {e}"))?;

    for a in &appliance_rows {
        past.push(JourneyEntry::ApplianceStarted {
            occurred_at: format!("{}T00:00:00.000Z", a.started_at),
            appliance_id: a.appliance_id.clone(),
            appliance_type: a.appliance_type.clone(),
        });
        if a.status == "paused" {
            past.push(JourneyEntry::AppliancePaused {
                occurred_at: a.updated_at.clone(),
                appliance_id: a.appliance_id.clone(),
                reason: a.pause_reason.clone(),
            });
        }
        if a.status == "completed" {
            past.push(JourneyEntry::ApplianceCompleted {
                occurred_at: a
                    .ended_at
                    .clone()
                    .map(|d| format!("{d}T00:00:00.000Z"))
                    .unwrap_or_else(|| a.updated_at.clone()),
                appliance_id: a.appliance_id.clone(),
            });
        }
    }

    // ── Past: aligner-change + expander-activation checkins ──
    let mut checkin_stmt = conn
        .prepare(
            "SELECT applianceId, checkinType, checkinDate, alignerIndex, activationIndex
             FROM orthodontic_checkins WHERE caseId = ?1 ORDER BY checkinDate ASC, createdAt ASC",
        )
        .map_err(|e| format!("get_orthodontic_journey checkin prepare: {e}"))?;
    let checkin_rows: Vec<(String, String, String, Option<i32>, Option<i32>)> = checkin_stmt
        .query_map(params![case_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, Option<i32>>(3)?,
                row.get::<_, Option<i32>>(4)?,
            ))
        })
        .map_err(|e| format!("get_orthodontic_journey checkin query: {e}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("get_orthodontic_journey checkin collect: {e}"))?;
    for (appliance_id, checkin_type, checkin_date, aligner_index, activation_index) in &checkin_rows
    {
        let occurred_at = format!("{checkin_date}T00:00:00.000Z");
        match checkin_type.as_str() {
            "aligner-change" => {
                if let Some(idx) = aligner_index {
                    past.push(JourneyEntry::AlignerChange {
                        occurred_at,
                        appliance_id: appliance_id.clone(),
                        aligner_index: *idx,
                    });
                }
            }
            "expander-activation" => {
                if let Some(idx) = activation_index {
                    past.push(JourneyEntry::ExpanderActivation {
                        occurred_at,
                        appliance_id: appliance_id.clone(),
                        activation_index: *idx,
                    });
                }
            }
            _ => {}
        }
    }

    // ── Past: ortho-* clinical events from health_record_events ──
    //
    // Authority: ortho lifecycle events are stored as `health_record_values`
    // rows with `metricId = 'dental.event'` and the eventType / hospital live
    // inside `valueJson`. The event row itself uses `effectiveDate` (date) and
    // `notes` (free text). This mirrors `get_dental_records` in
    // `health_records_dental.inc.rs` so journey + dental tab agree.
    let mut clinical_stmt = conn
        .prepare(
            "SELECT
                 json_extract(v.valueJson, '$.eventType'),
                 e.effectiveDate,
                 json_extract(v.valueJson, '$.hospital'),
                 e.notes
             FROM health_record_events e
             JOIN health_record_values v ON v.eventId = e.eventId
             WHERE e.childId = ?1
               AND v.metricId = 'dental.event'
               AND json_extract(v.valueJson, '$.eventType') IN
                   ('ortho-assessment','ortho-review','ortho-adjustment','ortho-issue','ortho-end','ortho-start')
             ORDER BY e.effectiveDate ASC, e.createdAt ASC",
        )
        .map_err(|e| format!("get_orthodontic_journey clinical prepare: {e}"))?;
    let clinical_rows: Vec<(Option<String>, String, Option<String>, Option<String>)> =
        clinical_stmt
            .query_map(params![child_id], |row| {
                Ok((
                    row.get::<_, Option<String>>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, Option<String>>(3)?,
                ))
            })
            .map_err(|e| format!("get_orthodontic_journey clinical query: {e}"))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("get_orthodontic_journey clinical collect: {e}"))?;
    for (event_type_opt, effective_date, hospital, notes) in clinical_rows {
        if let Some(event_type) = event_type_opt {
            past.push(JourneyEntry::ClinicalEvent {
                occurred_at: format!("{effective_date}T00:00:00.000Z"),
                event_type,
                hospital,
                notes,
            });
        }
    }

    // ── Past: closed wear-gap intervals (open ones are excluded; they live in today-card) ──
    let mut interval_stmt = conn
        .prepare(
            "SELECT startAt, endAt, reason
             FROM orthodontic_unwear_intervals WHERE caseId = ?1 AND endAt IS NOT NULL
             ORDER BY startAt ASC",
        )
        .map_err(|e| format!("get_orthodontic_journey interval prepare: {e}"))?;
    let interval_rows: Vec<(String, Option<String>, Option<String>)> = interval_stmt
        .query_map(params![case_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, Option<String>>(1)?,
                row.get::<_, Option<String>>(2)?,
            ))
        })
        .map_err(|e| format!("get_orthodontic_journey interval query: {e}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("get_orthodontic_journey interval collect: {e}"))?;
    for (start_at, end_at_opt, reason) in interval_rows {
        let duration_hours = end_at_opt
            .as_deref()
            .and_then(|end| parse_iso_hours_diff(&start_at, end));
        past.push(JourneyEntry::UnwearInterval {
            start_at,
            end_at: end_at_opt,
            duration_hours,
            reason,
        });
    }

    // ── Future: per-active-appliance review + cycle planned switch ──
    for a in &appliance_rows {
        if a.status != "active" {
            continue;
        }
        if let Some(next_review) = a.next_review_date.as_deref() {
            let rule_id = review_rule_id_for_appliance(a.appliance_type.as_str())
                .unwrap_or("PO-ORTHO-REVIEW-ALIGNER");
            future.push(JourneyEntry::NextClinicalReview {
                predicted_at: format!("{next_review}T00:00:00.000Z"),
                appliance_id: a.appliance_id.clone(),
                rule_id: rule_id.to_string(),
            });
        }
        // Clear-aligner: planned switch from cycle anchor + daysPerAligner.
        if a.appliance_type == "clear-aligner" {
            if let Some(days) = a.days_per_aligner {
                if days > 0 {
                    let anchor = checkin_rows
                        .iter()
                        .filter(|(aid, ct, _, _, _)| {
                            *aid == a.appliance_id && ct == "aligner-change"
                        })
                        .map(|(_, _, d, _, _)| d.clone())
                        .max()
                        .unwrap_or_else(|| a.started_at.clone());
                    let switch_date = add_days_iso(anchor.as_str(), days as i64);
                    let next_index = checkin_rows
                        .iter()
                        .filter(|(aid, ct, _, idx, _)| {
                            *aid == a.appliance_id
                                && ct == "aligner-change"
                                && idx.is_some()
                        })
                        .filter_map(|(_, _, _, idx, _)| *idx)
                        .max()
                        .map(|i| i + 1)
                        .unwrap_or(1);
                    let _ = a.total_aligners; // referenced for documentation; cap is enforced at write
                    let _ = a.prescribed_hours_per_day;
                    let _ = a.review_interval_days;
                    future.push(JourneyEntry::NextAlignerChange {
                        predicted_at: format!("{switch_date}T00:00:00.000Z"),
                        appliance_id: a.appliance_id.clone(),
                        aligner_index: next_index,
                    });
                }
            }
        }
    }

    // ── Future: case planned end (if set) ──
    if let Some(planned) = planned_end_at {
        future.push(JourneyEntry::CasePlannedEnd {
            predicted_at: format!("{planned}T00:00:00.000Z"),
        });
    }

    past.sort_by(|a, b| {
        occurred_at_for_journey_entry(a).cmp(occurred_at_for_journey_entry(b))
    });
    future.sort_by(|a, b| {
        occurred_at_for_journey_entry(a).cmp(occurred_at_for_journey_entry(b))
    });

    Ok(OrthodonticJourney { past, future })
}
