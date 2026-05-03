// ── Dental Records ────────────────────────────────────────

/// Dental eventTypes admitted for NEW writes via the insert/update commands.
/// Excludes `ortho-start` (historical/read-only per PO-PROF-008) and the
/// ortho-lifecycle events (review/adjustment/issue/end) which are authored
/// exclusively by the orthodontic workflow's clinical-event shortcut — those
/// have their own writer path and are not admitted from the generic dental
/// form to prevent orphan-style flows.
const SUPPORTED_DENTAL_EVENT_TYPES_FOR_WRITE: &str =
    "eruption | loss | caries | filling | cleaning | fluoride | sealant | ortho-assessment | checkup";

fn is_writable_dental_event_type(t: &str) -> bool {
    matches!(
        t,
        "eruption"
            | "loss"
            | "caries"
            | "filling"
            | "cleaning"
            | "fluoride"
            | "sealant"
            | "ortho-assessment"
            | "checkup"
    )
}

/// Ortho-lifecycle eventTypes admitted ONLY from the orthodontic workflow's
/// clinical-event writer (see insert_dental_record_for_ortho_lifecycle).
/// The generic dental form's insert/update must reject these.
fn is_ortho_lifecycle_event_type(t: &str) -> bool {
    matches!(
        t,
        "ortho-review" | "ortho-adjustment" | "ortho-issue" | "ortho-end"
    )
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DentalRecord {
    pub record_id: String,
    pub child_id: String,
    pub event_type: String,
    pub tooth_id: Option<String>,
    pub tooth_set: Option<String>,
    pub event_date: String,
    pub age_months: i32,
    pub severity: Option<String>,
    pub hospital: Option<String>,
    pub notes: Option<String>,
    pub photo_path: Option<String>,
    pub created_at: String,
}

fn dental_event_payload_json(
    event_type: &str,
    tooth_id: Option<&String>,
    tooth_set: Option<&String>,
    severity: Option<&String>,
    hospital: Option<&String>,
    photo_path: Option<&String>,
) -> String {
    json!({
        "eventType": event_type,
        "toothId": tooth_id,
        "toothSet": tooth_set,
        "severity": severity,
        "hospital": hospital,
        "photoPath": photo_path,
    })
    .to_string()
}

fn dental_metadata_json(event_type: &str, record_id: &str) -> String {
    json!({
        "detailApi": "dental",
        "eventType": event_type,
        "canonicalRecordId": record_id,
    })
    .to_string()
}

#[tauri::command]
pub fn insert_dental_record(
    record_id: String,
    child_id: String,
    event_type: String,
    tooth_id: Option<String>,
    tooth_set: Option<String>,
    event_date: String,
    age_months: i32,
    severity: Option<String>,
    hospital: Option<String>,
    notes: Option<String>,
    photo_path: Option<String>,
    now: String,
) -> Result<(), String> {
    if !is_writable_dental_event_type(event_type.trim()) {
        let reason = if event_type.trim() == "ortho-start" {
            "ortho-start is historical/read-only (PO-PROF-008); new orthodontic treatments must be modeled through orthodontic_cases and orthodontic_appliances"
        } else if is_ortho_lifecycle_event_type(event_type.trim()) {
            "orthodontic lifecycle events (review/adjustment/issue/end) must be written via the orthodontic workflow's clinical-event writer, not the generic dental form"
        } else {
            "unsupported dental eventType"
        };
        return Err(format!(
            "{reason}: \"{event_type}\"; expected {SUPPORTED_DENTAL_EVENT_TYPES_FOR_WRITE}",
        ));
    }
    {
        let mut conn = get_conn()?.lock().map_err(|e| e.to_string())?;
        let payload_json = dental_event_payload_json(
            event_type.trim(),
            tooth_id.as_ref(),
            tooth_set.as_ref(),
            severity.as_ref(),
            hospital.as_ref(),
            photo_path.as_ref(),
        );
        save_health_record_capture_with_conn(
            &mut conn,
            SaveHealthRecordCaptureInput {
                event_id: record_id.clone(),
                child_id: child_id.clone(),
                protocol_id: "dental-event".to_string(),
                group_id: "dental".to_string(),
                record_kind: "manual".to_string(),
                source_surface: "profile_detail".to_string(),
                recorded_at: event_date.clone(),
                effective_date: event_date.clone(),
                age_months,
                recorder_id: None,
                linked_reminder_state_id: None,
                linked_reminder_rule_id: None,
                notes: notes.clone(),
                metadata_json: Some(dental_metadata_json(event_type.trim(), &record_id)),
                now: now.clone(),
                values: vec![HealthRecordCaptureValueInput {
                    value_id: format!("dental-event-value:{record_id}"),
                    metric_id: "dental.event".to_string(),
                    value_number: None,
                    value_text: None,
                    value_json: Some(payload_json),
                    unit: None,
                    qualifier: None,
                    record_kind: "measured".to_string(),
                    source_value_ids: None,
                }],
            },
        )?;
    }
    // Seed admitted dental follow-up reminder_state for triggering eventTypes
    // (PO-DEN-FOLLOWUP-*). No-op for non-triggering types.
    super::orthodontic::ensure_dental_followup_reminder(
        child_id.as_str(),
        event_type.trim(),
        event_date.as_str(),
        now.as_str(),
    )?;
    Ok(())
}

#[tauri::command]
pub fn update_dental_record(
    record_id: String,
    event_type: String,
    tooth_id: Option<String>,
    tooth_set: Option<String>,
    event_date: String,
    age_months: i32,
    severity: Option<String>,
    hospital: Option<String>,
    notes: Option<String>,
    photo_path: Option<String>,
    now: String,
) -> Result<(), String> {
    if !is_writable_dental_event_type(event_type.trim()) {
        let reason = if event_type.trim() == "ortho-start" {
            "ortho-start is historical/read-only (PO-PROF-008); new orthodontic treatments must be modeled through orthodontic_cases and orthodontic_appliances"
        } else if is_ortho_lifecycle_event_type(event_type.trim()) {
            "orthodontic lifecycle events (review/adjustment/issue/end) must be written via the orthodontic workflow's clinical-event writer, not the generic dental form"
        } else {
            "unsupported dental eventType"
        };
        return Err(format!(
            "{reason}: \"{event_type}\"; expected {SUPPORTED_DENTAL_EVENT_TYPES_FOR_WRITE}",
        ));
    }
    let mut conn = get_conn()?.lock().map_err(|e| e.to_string())?;
    let tx = conn
        .transaction()
        .map_err(|e| format!("update_dental_record begin transaction: {e}"))?;
    let updated = tx
        .execute(
            "UPDATE health_record_events
             SET recordedAt=?2, effectiveDate=?2, ageMonths=?3, notes=?4,
                 metadataJson=?5, updatedAt=?6
             WHERE eventId=?1 AND protocolId='dental-event'",
            params![
                &record_id,
                &event_date,
                age_months,
                &notes,
                dental_metadata_json(event_type.trim(), &record_id),
                &now
            ],
        )
        .map_err(|e| format!("update_dental_record update event: {e}"))?;
    if updated == 0 {
        return Err(format!("update_dental_record missing canonical event \"{record_id}\""));
    }
    let payload_json = dental_event_payload_json(
        event_type.trim(),
        tooth_id.as_ref(),
        tooth_set.as_ref(),
        severity.as_ref(),
        hospital.as_ref(),
        photo_path.as_ref(),
    );
    tx.execute(
        "UPDATE health_record_values
         SET valueJson=?2
         WHERE valueId=?1 AND metricId='dental.event'",
        params![format!("dental-event-value:{record_id}"), payload_json],
    )
    .map_err(|e| format!("update_dental_record update value: {e}"))?;
    tx.commit()
        .map_err(|e| format!("update_dental_record commit: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn delete_dental_record(record_id: String) -> Result<(), String> {
    let conn = get_conn()?.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM health_record_events WHERE eventId = ?1 AND protocolId = 'dental-event'",
        params![record_id],
    )
    .map_err(|e| format!("delete_dental_record: {e}"))?;
    Ok(())
}

/// Orthodontic workflow's clinical-event writer.
///
/// Admits the four ortho lifecycle eventTypes rejected by the generic dental
/// writer. Called from the orthodontic UI shortcut (e.g. "记录一次复诊").
/// The row is written into canonical health_record_events so it shows up in
/// the dental clinical timeline (PO-ORTHO-001 cross-write rule).
#[tauri::command]
pub fn insert_ortho_clinical_dental_record(
    record_id: String,
    child_id: String,
    event_type: String,
    event_date: String,
    age_months: i32,
    hospital: Option<String>,
    notes: Option<String>,
    now: String,
) -> Result<(), String> {
    let et = event_type.trim();
    if !is_ortho_lifecycle_event_type(et) {
        return Err(format!(
            "insert_ortho_clinical_dental_record rejects non-ortho eventType \"{event_type}\"; expected ortho-review | ortho-adjustment | ortho-issue | ortho-end",
        ));
    }
    let mut conn = get_conn()?.lock().map_err(|e| e.to_string())?;
    let payload_json = dental_event_payload_json(
        et,
        None,
        None,
        None,
        hospital.as_ref(),
        None,
    );
    save_health_record_capture_with_conn(
        &mut conn,
        SaveHealthRecordCaptureInput {
            event_id: record_id.clone(),
            child_id,
            protocol_id: "dental-event".to_string(),
            group_id: "dental".to_string(),
            record_kind: "manual".to_string(),
            source_surface: "profile_detail".to_string(),
            recorded_at: event_date.clone(),
            effective_date: event_date,
            age_months,
            recorder_id: None,
            linked_reminder_state_id: None,
            linked_reminder_rule_id: None,
            notes,
            metadata_json: Some(dental_metadata_json(et, &record_id)),
            now,
            values: vec![HealthRecordCaptureValueInput {
                value_id: format!("dental-event-value:{record_id}"),
                metric_id: "dental.event".to_string(),
                value_number: None,
                value_text: None,
                value_json: Some(payload_json),
                unit: None,
                qualifier: None,
                record_kind: "measured".to_string(),
                source_value_ids: None,
            }],
        },
    )?;
    Ok(())
}

#[tauri::command]
pub fn get_dental_records(child_id: String) -> Result<Vec<DentalRecord>, String> {
    let conn = get_conn()?.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare(
        "SELECT
             e.eventId,
             e.childId,
             json_extract(v.valueJson, '$.eventType'),
             json_extract(v.valueJson, '$.toothId'),
             json_extract(v.valueJson, '$.toothSet'),
             e.effectiveDate,
             e.ageMonths,
             json_extract(v.valueJson, '$.severity'),
             json_extract(v.valueJson, '$.hospital'),
             e.notes,
             json_extract(v.valueJson, '$.photoPath'),
             e.createdAt
         FROM health_record_events e
         JOIN health_record_values v ON v.eventId = e.eventId
         WHERE e.childId = ?1 AND v.metricId = 'dental.event'
         ORDER BY e.effectiveDate",
    ).map_err(|e| format!("get_dental_records: {e}"))?;
    let rows = stmt
        .query_map(params![child_id], |row| {
            Ok(DentalRecord {
                record_id: row.get(0)?,
                child_id: row.get(1)?,
                event_type: row.get(2)?,
                tooth_id: row.get(3)?,
                tooth_set: row.get(4)?,
                event_date: row.get(5)?,
                age_months: row.get(6)?,
                severity: row.get(7)?,
                hospital: row.get(8)?,
                notes: row.get(9)?,
                photo_path: row.get(10)?,
                created_at: row.get(11)?,
            })
        })
        .map_err(|e| format!("get_dental_records: {e}"))?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("get_dental_records collect: {e}"))
}
