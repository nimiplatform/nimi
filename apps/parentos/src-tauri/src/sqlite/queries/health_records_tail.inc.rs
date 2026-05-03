// ── Allergy Records ───────────────────────────────────────

fn is_supported_allergy_category(c: &str) -> bool {
    matches!(c, "food" | "drug" | "environmental" | "contact" | "other")
}

fn is_supported_allergy_severity(s: &str) -> bool {
    matches!(s, "mild" | "moderate" | "severe")
}

fn is_supported_allergy_status(s: &str) -> bool {
    matches!(s, "active" | "outgrown" | "uncertain")
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AllergyRecord {
    pub record_id: String,
    pub child_id: String,
    pub allergen: String,
    pub category: String,
    pub reaction_type: Option<String>,
    pub severity: String,
    pub diagnosed_at: Option<String>,
    pub age_months_at_diagnosis: Option<i32>,
    pub status: String,
    pub status_changed_at: Option<String>,
    pub confirmed_by: Option<String>,
    pub notes: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[tauri::command]
pub fn insert_allergy_record(
    record_id: String,
    child_id: String,
    allergen: String,
    category: String,
    reaction_type: Option<String>,
    severity: String,
    diagnosed_at: Option<String>,
    age_months_at_diagnosis: Option<i32>,
    status: String,
    status_changed_at: Option<String>,
    confirmed_by: Option<String>,
    notes: Option<String>,
    now: String,
) -> Result<(), String> {
    if !is_supported_allergy_category(category.trim()) {
        return Err(format!("unsupported allergy category \"{category}\"; expected food | drug | environmental | contact | other"));
    }
    if !is_supported_allergy_severity(severity.trim()) {
        return Err(format!(
            "unsupported allergy severity \"{severity}\"; expected mild | moderate | severe"
        ));
    }
    if !is_supported_allergy_status(status.trim()) {
        return Err(format!(
            "unsupported allergy status \"{status}\"; expected active | outgrown | uncertain"
        ));
    }
    let conn = get_conn()?.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO allergy_records (recordId, childId, allergen, category, reactionType, severity, diagnosedAt, ageMonthsAtDiagnosis, status, statusChangedAt, confirmedBy, notes, createdAt, updatedAt) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?13)",
        params![record_id, child_id, allergen, category, reaction_type, severity, diagnosed_at, age_months_at_diagnosis, status, status_changed_at, confirmed_by, notes, now],
    ).map_err(|e| format!("insert_allergy_record: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn update_allergy_record(
    record_id: String,
    allergen: String,
    category: String,
    reaction_type: Option<String>,
    severity: String,
    status: String,
    status_changed_at: Option<String>,
    confirmed_by: Option<String>,
    notes: Option<String>,
    now: String,
) -> Result<(), String> {
    if !is_supported_allergy_category(category.trim()) {
        return Err(format!("unsupported allergy category \"{category}\""));
    }
    if !is_supported_allergy_severity(severity.trim()) {
        return Err(format!("unsupported allergy severity \"{severity}\""));
    }
    if !is_supported_allergy_status(status.trim()) {
        return Err(format!("unsupported allergy status \"{status}\""));
    }
    let conn = get_conn()?.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE allergy_records SET allergen=?2, category=?3, reactionType=?4, severity=?5, status=?6, statusChangedAt=?7, confirmedBy=?8, notes=?9, updatedAt=?10 WHERE recordId=?1",
        params![record_id, allergen, category, reaction_type, severity, status, status_changed_at, confirmed_by, notes, now],
    ).map_err(|e| format!("update_allergy_record: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn get_allergy_records(child_id: String) -> Result<Vec<AllergyRecord>, String> {
    let conn = get_conn()?.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare("SELECT recordId, childId, allergen, category, reactionType, severity, diagnosedAt, ageMonthsAtDiagnosis, status, statusChangedAt, confirmedBy, notes, createdAt, updatedAt FROM allergy_records WHERE childId = ?1 ORDER BY createdAt DESC").map_err(|e| format!("get_allergy_records: {e}"))?;
    let rows = stmt
        .query_map(params![child_id], |row| {
            Ok(AllergyRecord {
                record_id: row.get(0)?,
                child_id: row.get(1)?,
                allergen: row.get(2)?,
                category: row.get(3)?,
                reaction_type: row.get(4)?,
                severity: row.get(5)?,
                diagnosed_at: row.get(6)?,
                age_months_at_diagnosis: row.get(7)?,
                status: row.get(8)?,
                status_changed_at: row.get(9)?,
                confirmed_by: row.get(10)?,
                notes: row.get(11)?,
                created_at: row.get(12)?,
                updated_at: row.get(13)?,
            })
        })
        .map_err(|e| format!("get_allergy_records: {e}"))?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("get_allergy_records collect: {e}"))
}

// ── Sleep Records ─────────────────────────────────────────

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SleepRecord {
    pub record_id: String,
    pub child_id: String,
    pub sleep_date: String,
    pub bedtime: Option<String>,
    pub wake_time: Option<String>,
    pub duration_minutes: Option<i32>,
    pub nap_count: Option<i32>,
    pub nap_minutes: Option<i32>,
    pub quality: Option<String>,
    pub age_months: i32,
    pub notes: Option<String>,
    pub created_at: String,
}

fn detail_sleep_event_id(record_id: &str) -> String {
    format!("detail-sleep:{record_id}")
}

fn strip_health_detail_prefix<'a>(value: &'a str, prefix: &str) -> &'a str {
    value.strip_prefix(prefix).unwrap_or(value)
}

fn sleep_metadata_field(metadata_json: Option<&str>, field_name: &str) -> Option<String> {
    let metadata =
        metadata_json.and_then(|raw| serde_json::from_str::<serde_json::Value>(raw).ok())?;
    metadata
        .get(field_name)
        .and_then(|value| value.as_str())
        .map(ToString::to_string)
}

fn sleep_metadata_i32(metadata_json: Option<&str>, field_name: &str) -> Option<i32> {
    let metadata =
        metadata_json.and_then(|raw| serde_json::from_str::<serde_json::Value>(raw).ok())?;
    metadata
        .get(field_name)
        .and_then(|value| value.as_i64())
        .and_then(|value| i32::try_from(value).ok())
}

#[tauri::command]
pub fn upsert_sleep_record(
    record_id: String,
    child_id: String,
    sleep_date: String,
    bedtime: Option<String>,
    wake_time: Option<String>,
    duration_minutes: Option<i32>,
    nap_count: Option<i32>,
    nap_minutes: Option<i32>,
    quality: Option<String>,
    age_months: i32,
    notes: Option<String>,
    now: String,
) -> Result<(), String> {
    let duration_minutes = duration_minutes
        .ok_or_else(|| "upsert_sleep_record requires durationMinutes".to_string())?;
    if duration_minutes <= 0 {
        return Err("upsert_sleep_record: durationMinutes must be > 0".to_string());
    }
    let mut conn = get_conn()?.lock().map_err(|e| e.to_string())?;
    let tx = conn
        .transaction()
        .map_err(|e| format!("upsert_sleep_record begin transaction: {e}"))?;
    tx.execute(
        "DELETE FROM health_record_events
         WHERE childId = ?1 AND protocolId = 'sleep-night' AND effectiveDate = ?2",
        params![&child_id, &sleep_date],
    )
    .map_err(|e| format!("upsert_sleep_record delete replaced sleep event: {e}"))?;
    let event_id = detail_sleep_event_id(&record_id);
    tx.execute(
        "INSERT INTO health_record_events (
            eventId, childId, protocolId, groupId, recordKind, sourceSurface,
            recordedAt, effectiveDate, ageMonths, notes, metadataJson, createdAt, updatedAt
        ) VALUES (?1, ?2, 'sleep-night', 'sleep', 'manual', 'profile_detail', ?3, ?3, ?4, ?5, ?6, ?7, ?7)",
        params![
            &event_id,
            &child_id,
            &sleep_date,
            age_months,
            &notes,
            serde_json::json!({
                "legacySleepRecordApi": true,
                "recordId": record_id,
                "bedtime": bedtime,
                "wakeTime": wake_time,
                "napCount": nap_count,
                "napMinutes": nap_minutes,
                "quality": quality,
            })
            .to_string(),
            &now,
        ],
    )
    .map_err(|e| format!("upsert_sleep_record insert health event: {e}"))?;
    tx.execute(
        "INSERT INTO health_record_values (
            valueId, eventId, childId, metricId, valueNumber, unit, recordKind, createdAt
        ) VALUES (?1, ?2, ?3, 'sleep.duration_minutes', ?4, 'min', 'measured', ?5)",
        params![&record_id, &event_id, &child_id, duration_minutes, &now],
    )
    .map_err(|e| format!("upsert_sleep_record insert health value: {e}"))?;
    tx.commit()
        .map_err(|e| format!("upsert_sleep_record commit: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn delete_sleep_record(record_id: String) -> Result<(), String> {
    let conn = get_conn()?.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM health_record_events WHERE eventId = ?1 AND protocolId = 'sleep-night'",
        params![detail_sleep_event_id(&record_id)],
    )
    .map_err(|e| format!("delete_sleep_record: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn get_sleep_records(child_id: String, limit: Option<i32>) -> Result<Vec<SleepRecord>, String> {
    let conn = get_conn()?.lock().map_err(|e| e.to_string())?;
    let lim = limit.unwrap_or(90);
    let mut stmt = conn
        .prepare(
            "SELECT
            e.eventId,
            e.childId,
            e.effectiveDate,
            e.metadataJson,
            v.valueNumber,
            e.ageMonths,
            e.notes,
            e.createdAt
         FROM health_record_events e
         JOIN health_record_values v ON v.eventId = e.eventId
         WHERE e.childId = ?1
           AND e.protocolId = 'sleep-night'
           AND v.metricId = 'sleep.duration_minutes'
         ORDER BY e.effectiveDate DESC
         LIMIT ?2",
        )
        .map_err(|e| format!("get_sleep_records: {e}"))?;
    let rows = stmt
        .query_map(params![child_id, lim], |row| {
            let event_id: String = row.get(0)?;
            let metadata_json: Option<String> = row.get(3)?;
            let duration_number: Option<f64> = row.get(4)?;
            Ok(SleepRecord {
                record_id: strip_health_detail_prefix(&event_id, "detail-sleep:").to_string(),
                child_id: row.get(1)?,
                sleep_date: row.get(2)?,
                bedtime: sleep_metadata_field(metadata_json.as_deref(), "bedtime"),
                wake_time: sleep_metadata_field(metadata_json.as_deref(), "wakeTime"),
                duration_minutes: duration_number.map(|value| value.round() as i32),
                nap_count: sleep_metadata_i32(metadata_json.as_deref(), "napCount"),
                nap_minutes: sleep_metadata_i32(metadata_json.as_deref(), "napMinutes"),
                quality: sleep_metadata_field(metadata_json.as_deref(), "quality"),
                age_months: row.get(5)?,
                notes: row.get(6)?,
                created_at: row.get(7)?,
            })
        })
        .map_err(|e| format!("get_sleep_records: {e}"))?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("get_sleep_records collect: {e}"))
}

// ── Medical Events ────────────────────────────────────────

fn is_supported_medical_event_type(t: &str) -> bool {
    matches!(
        t,
        "visit" | "emergency" | "hospitalization" | "checkup" | "medication" | "other"
    )
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MedicalEvent {
    pub event_id: String,
    pub child_id: String,
    pub event_type: String,
    pub title: String,
    pub event_date: String,
    pub end_date: Option<String>,
    pub age_months: i32,
    pub severity: Option<String>,
    pub result: Option<String>,
    pub hospital: Option<String>,
    pub medication: Option<String>,
    pub dosage: Option<String>,
    pub notes: Option<String>,
    pub photo_path: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

fn medical_event_payload_json(
    event_type: &str,
    title: &str,
    end_date: Option<&String>,
    severity: Option<&String>,
    result: Option<&String>,
    hospital: Option<&String>,
    medication: Option<&String>,
    dosage: Option<&String>,
    photo_path: Option<&String>,
) -> String {
    json!({
        "eventType": event_type,
        "title": title,
        "endDate": end_date,
        "severity": severity,
        "result": result,
        "hospital": hospital,
        "medication": medication,
        "dosage": dosage,
        "photoPath": photo_path,
    })
    .to_string()
}

fn medical_metadata_json(event_type: &str, event_id: &str) -> String {
    json!({
        "detailApi": "medical",
        "eventType": event_type,
        "canonicalEventId": event_id,
    })
    .to_string()
}

#[tauri::command]
pub fn insert_medical_event(
    event_id: String,
    child_id: String,
    event_type: String,
    title: String,
    event_date: String,
    end_date: Option<String>,
    age_months: i32,
    severity: Option<String>,
    result: Option<String>,
    hospital: Option<String>,
    medication: Option<String>,
    dosage: Option<String>,
    notes: Option<String>,
    photo_path: Option<String>,
    now: String,
) -> Result<(), String> {
    if !is_supported_medical_event_type(event_type.trim()) {
        return Err(format!(
            "unsupported medical eventType \"{event_type}\"; expected visit | emergency | hospitalization | checkup | medication | other",
        ));
    }
    let mut conn = get_conn()?.lock().map_err(|e| e.to_string())?;
    let payload_json = medical_event_payload_json(
        event_type.trim(),
        &title,
        end_date.as_ref(),
        severity.as_ref(),
        result.as_ref(),
        hospital.as_ref(),
        medication.as_ref(),
        dosage.as_ref(),
        photo_path.as_ref(),
    );
    save_health_record_capture_with_conn(
        &mut conn,
        SaveHealthRecordCaptureInput {
            event_id: event_id.clone(),
            child_id,
            protocol_id: "medical-event".to_string(),
            group_id: "medical".to_string(),
            record_kind: "manual".to_string(),
            source_surface: "profile_detail".to_string(),
            recorded_at: event_date.clone(),
            effective_date: event_date,
            age_months,
            recorder_id: None,
            linked_reminder_state_id: None,
            linked_reminder_rule_id: None,
            notes,
            metadata_json: Some(medical_metadata_json(event_type.trim(), &event_id)),
            now,
            values: vec![HealthRecordCaptureValueInput {
                value_id: format!("medical-event-value:{event_id}"),
                metric_id: "medical.event".to_string(),
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
pub fn update_medical_event(
    event_id: String,
    title: String,
    event_date: String,
    end_date: Option<String>,
    severity: Option<String>,
    result: Option<String>,
    hospital: Option<String>,
    medication: Option<String>,
    dosage: Option<String>,
    notes: Option<String>,
    photo_path: Option<String>,
    now: String,
) -> Result<(), String> {
    let mut conn = get_conn()?.lock().map_err(|e| e.to_string())?;
    let (event_type, age_months): (String, i32) = conn
        .query_row(
            "SELECT json_extract(v.valueJson, '$.eventType'), e.ageMonths
             FROM health_record_events e
             JOIN health_record_values v ON v.eventId = e.eventId
             WHERE e.eventId = ?1 AND v.metricId = 'medical.event'",
            params![&event_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|e| format!("update_medical_event load existing event: {e}"))?;
    let tx = conn
        .transaction()
        .map_err(|e| format!("update_medical_event begin transaction: {e}"))?;
    tx.execute(
        "UPDATE health_record_events
         SET recordedAt=?2, effectiveDate=?2, ageMonths=?3, notes=?4,
             metadataJson=?5, updatedAt=?6
         WHERE eventId=?1 AND protocolId='medical-event'",
        params![
            &event_id,
            &event_date,
            age_months,
            &notes,
            medical_metadata_json(&event_type, &event_id),
            &now
        ],
    )
    .map_err(|e| format!("update_medical_event update event: {e}"))?;
    let payload_json = medical_event_payload_json(
        &event_type,
        &title,
        end_date.as_ref(),
        severity.as_ref(),
        result.as_ref(),
        hospital.as_ref(),
        medication.as_ref(),
        dosage.as_ref(),
        photo_path.as_ref(),
    );
    tx.execute(
        "UPDATE health_record_values
         SET valueJson=?2
         WHERE valueId=?1 AND metricId='medical.event'",
        params![format!("medical-event-value:{event_id}"), payload_json],
    )
    .map_err(|e| format!("update_medical_event update value: {e}"))?;
    tx.commit()
        .map_err(|e| format!("update_medical_event commit: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn get_medical_events(child_id: String) -> Result<Vec<MedicalEvent>, String> {
    let conn = get_conn()?.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare(
        "SELECT
             e.eventId,
             e.childId,
             json_extract(v.valueJson, '$.eventType'),
             json_extract(v.valueJson, '$.title'),
             e.effectiveDate,
             json_extract(v.valueJson, '$.endDate'),
             e.ageMonths,
             json_extract(v.valueJson, '$.severity'),
             json_extract(v.valueJson, '$.result'),
             json_extract(v.valueJson, '$.hospital'),
             json_extract(v.valueJson, '$.medication'),
             json_extract(v.valueJson, '$.dosage'),
             e.notes,
             json_extract(v.valueJson, '$.photoPath'),
             e.createdAt,
             e.updatedAt
         FROM health_record_events e
         JOIN health_record_values v ON v.eventId = e.eventId
         WHERE e.childId = ?1 AND v.metricId = 'medical.event'
         ORDER BY e.effectiveDate DESC",
    ).map_err(|e| format!("get_medical_events: {e}"))?;
    let rows = stmt
        .query_map(params![child_id], |row| {
            Ok(MedicalEvent {
                event_id: row.get(0)?,
                child_id: row.get(1)?,
                event_type: row.get(2)?,
                title: row.get(3)?,
                event_date: row.get(4)?,
                end_date: row.get(5)?,
                age_months: row.get(6)?,
                severity: row.get(7)?,
                result: row.get(8)?,
                hospital: row.get(9)?,
                medication: row.get(10)?,
                dosage: row.get(11)?,
                notes: row.get(12)?,
                photo_path: row.get(13)?,
                created_at: row.get(14)?,
                updated_at: row.get(15)?,
            })
        })
        .map_err(|e| format!("get_medical_events: {e}"))?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("get_medical_events collect: {e}"))
}
