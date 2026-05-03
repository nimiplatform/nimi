use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::json;

use super::super::get_conn;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthRecordCaptureValueInput {
    pub value_id: String,
    pub metric_id: String,
    pub value_number: Option<f64>,
    pub value_text: Option<String>,
    pub value_json: Option<String>,
    pub unit: Option<String>,
    pub qualifier: Option<String>,
    pub record_kind: String,
    pub source_value_ids: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveHealthRecordCaptureInput {
    pub event_id: String,
    pub child_id: String,
    pub protocol_id: String,
    pub group_id: String,
    pub record_kind: String,
    pub source_surface: String,
    pub recorded_at: String,
    pub effective_date: String,
    pub age_months: i32,
    pub recorder_id: Option<String>,
    pub linked_reminder_state_id: Option<String>,
    pub linked_reminder_rule_id: Option<String>,
    pub notes: Option<String>,
    pub metadata_json: Option<String>,
    pub now: String,
    pub values: Vec<HealthRecordCaptureValueInput>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveHealthRecordCaptureResult {
    pub event_id: String,
    pub value_ids: Vec<String>,
    pub persisted_value_count: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthRecordEventRow {
    pub event_id: String,
    pub child_id: String,
    pub protocol_id: String,
    pub group_id: String,
    pub record_kind: String,
    pub source_surface: String,
    pub recorded_at: String,
    pub effective_date: String,
    pub age_months: i32,
    pub recorder_id: Option<String>,
    pub linked_reminder_state_id: Option<String>,
    pub linked_reminder_rule_id: Option<String>,
    pub notes: Option<String>,
    pub metadata_json: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthRecordValueRow {
    pub value_id: String,
    pub event_id: String,
    pub child_id: String,
    pub metric_id: String,
    pub value_number: Option<f64>,
    pub value_text: Option<String>,
    pub value_json: Option<String>,
    pub unit: Option<String>,
    pub qualifier: Option<String>,
    pub record_kind: String,
    pub source_value_ids: Option<String>,
    pub created_at: String,
}

fn is_supported_health_event_kind(value: &str) -> bool {
    matches!(
        value,
        "manual" | "imported" | "ocr_confirmed" | "reminder_linked" | "derived"
    )
}

fn is_supported_health_source_surface(value: &str) -> bool {
    matches!(
        value,
        "profile_console" | "profile_detail" | "reminder" | "ocr_tool" | "import"
    )
}

fn is_supported_health_value_kind(value: &str) -> bool {
    matches!(value, "measured" | "derived" | "parent_confirmed_import")
}

fn non_empty(value: &str, field_name: &str) -> Result<(), String> {
    if value.trim().is_empty() {
        return Err(format!("{field_name} is required"));
    }
    Ok(())
}

fn validate_health_record_capture(input: &SaveHealthRecordCaptureInput) -> Result<(), String> {
    non_empty(&input.event_id, "eventId")?;
    non_empty(&input.child_id, "childId")?;
    non_empty(&input.protocol_id, "protocolId")?;
    non_empty(&input.group_id, "groupId")?;
    non_empty(&input.recorded_at, "recordedAt")?;
    non_empty(&input.effective_date, "effectiveDate")?;
    non_empty(&input.now, "now")?;
    if !is_supported_health_event_kind(input.record_kind.trim()) {
        return Err(format!(
            "unsupported health recordKind \"{}\"",
            input.record_kind
        ));
    }
    if !is_supported_health_source_surface(input.source_surface.trim()) {
        return Err(format!(
            "unsupported health sourceSurface \"{}\"",
            input.source_surface
        ));
    }
    if input.values.is_empty() {
        return Err("health capture requires at least one value".to_string());
    }

    let mut value_ids = std::collections::HashSet::new();
    for value in &input.values {
        non_empty(&value.value_id, "valueId")?;
        non_empty(&value.metric_id, "metricId")?;
        if !value_ids.insert(value.value_id.trim().to_string()) {
            return Err(format!("duplicate health valueId \"{}\"", value.value_id));
        }
        if !is_supported_health_value_kind(value.record_kind.trim()) {
            return Err(format!(
                "unsupported health value recordKind \"{}\"",
                value.record_kind
            ));
        }
        if let Some(number) = value.value_number {
            if !number.is_finite() {
                return Err(format!(
                    "health value \"{}\" has non-finite valueNumber",
                    value.value_id
                ));
            }
        }
        if value.value_number.is_none()
            && value
                .value_text
                .as_deref()
                .map(str::trim)
                .filter(|text| !text.is_empty())
                .is_none()
            && value
                .value_json
                .as_deref()
                .map(str::trim)
                .filter(|json| !json.is_empty())
                .is_none()
        {
            return Err(format!(
                "health value \"{}\" requires valueNumber, valueText, or valueJson",
                value.value_id
            ));
        }
        if value.record_kind.trim() == "derived"
            && value
                .source_value_ids
                .as_deref()
                .map(str::trim)
                .filter(|ids| !ids.is_empty())
                .is_none()
        {
            return Err(format!(
                "derived health value \"{}\" requires sourceValueIds",
                value.value_id
            ));
        }
    }
    Ok(())
}

pub(crate) fn save_health_record_capture_with_conn(
    conn: &mut Connection,
    input: SaveHealthRecordCaptureInput,
) -> Result<SaveHealthRecordCaptureResult, String> {
    validate_health_record_capture(&input)?;

    let tx = conn
        .transaction()
        .map_err(|e| format!("save_health_record_capture begin transaction: {e}"))?;
    tx.execute(
        "INSERT INTO health_record_events (
            eventId, childId, protocolId, groupId, recordKind, sourceSurface,
            recordedAt, effectiveDate, ageMonths, recorderId,
            linkedReminderStateId, linkedReminderRuleId, notes, metadataJson,
            createdAt, updatedAt
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?15)",
        params![
            &input.event_id,
            &input.child_id,
            &input.protocol_id,
            &input.group_id,
            &input.record_kind,
            &input.source_surface,
            &input.recorded_at,
            &input.effective_date,
            input.age_months,
            &input.recorder_id,
            &input.linked_reminder_state_id,
            &input.linked_reminder_rule_id,
            &input.notes,
            &input.metadata_json,
            &input.now,
        ],
    )
    .map_err(|e| format!("save_health_record_capture insert event: {e}"))?;

    let mut value_ids = Vec::with_capacity(input.values.len());
    for value in input.values {
        tx.execute(
            "INSERT INTO health_record_values (
                valueId, eventId, childId, metricId, valueNumber, valueText,
                valueJson, unit, qualifier, recordKind, sourceValueIds, createdAt
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
            params![
                &value.value_id,
                &input.event_id,
                &input.child_id,
                &value.metric_id,
                value.value_number,
                &value.value_text,
                &value.value_json,
                &value.unit,
                &value.qualifier,
                &value.record_kind,
                &value.source_value_ids,
                &input.now,
            ],
        )
        .map_err(|e| format!("save_health_record_capture insert value: {e}"))?;
        value_ids.push(value.value_id);
    }
    tx.commit()
        .map_err(|e| format!("save_health_record_capture commit: {e}"))?;

    Ok(SaveHealthRecordCaptureResult {
        event_id: input.event_id,
        persisted_value_count: value_ids.len(),
        value_ids,
    })
}

#[tauri::command]
pub fn save_health_record_capture(
    input: SaveHealthRecordCaptureInput,
) -> Result<SaveHealthRecordCaptureResult, String> {
    let mut conn = get_conn()?.lock().map_err(|e| e.to_string())?;
    save_health_record_capture_with_conn(&mut conn, input)
}

#[tauri::command]
pub fn get_health_record_events(child_id: String) -> Result<Vec<HealthRecordEventRow>, String> {
    let conn = get_conn()?.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT eventId, childId, protocolId, groupId, recordKind, sourceSurface,
                    recordedAt, effectiveDate, ageMonths, recorderId,
                    linkedReminderStateId, linkedReminderRuleId, notes, metadataJson,
                    createdAt, updatedAt
             FROM health_record_events
             WHERE childId = ?1
             ORDER BY effectiveDate DESC, createdAt DESC",
        )
        .map_err(|e| format!("get_health_record_events prepare: {e}"))?;
    let rows = stmt
        .query_map(params![child_id], |row| {
            Ok(HealthRecordEventRow {
                event_id: row.get(0)?,
                child_id: row.get(1)?,
                protocol_id: row.get(2)?,
                group_id: row.get(3)?,
                record_kind: row.get(4)?,
                source_surface: row.get(5)?,
                recorded_at: row.get(6)?,
                effective_date: row.get(7)?,
                age_months: row.get(8)?,
                recorder_id: row.get(9)?,
                linked_reminder_state_id: row.get(10)?,
                linked_reminder_rule_id: row.get(11)?,
                notes: row.get(12)?,
                metadata_json: row.get(13)?,
                created_at: row.get(14)?,
                updated_at: row.get(15)?,
            })
        })
        .map_err(|e| format!("get_health_record_events query: {e}"))?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("get_health_record_events collect: {e}"))
}

#[tauri::command]
pub fn get_health_record_values(child_id: String) -> Result<Vec<HealthRecordValueRow>, String> {
    let conn = get_conn()?.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT valueId, eventId, childId, metricId, valueNumber, valueText, valueJson,
                    unit, qualifier, recordKind, sourceValueIds, createdAt
             FROM health_record_values
             WHERE childId = ?1
             ORDER BY createdAt DESC, valueId DESC",
        )
        .map_err(|e| format!("get_health_record_values prepare: {e}"))?;
    let rows = stmt
        .query_map(params![child_id], |row| {
            Ok(HealthRecordValueRow {
                value_id: row.get(0)?,
                event_id: row.get(1)?,
                child_id: row.get(2)?,
                metric_id: row.get(3)?,
                value_number: row.get(4)?,
                value_text: row.get(5)?,
                value_json: row.get(6)?,
                unit: row.get(7)?,
                qualifier: row.get(8)?,
                record_kind: row.get(9)?,
                source_value_ids: row.get(10)?,
                created_at: row.get(11)?,
            })
        })
        .map_err(|e| format!("get_health_record_values query: {e}"))?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("get_health_record_values collect: {e}"))
}

// ── Profile Section Summaries ─────────────────────────────

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SectionSummary {
    pub section_id: String,
    pub record_count: i64,
    pub last_updated_at: Option<String>,
    pub state: String, // "ok" | "empty" | "error"
    pub error_message: Option<String>,
}

/// Section definition: (sectionId, SQL for COUNT, SQL for MAX timestamp)
const SECTION_QUERIES: &[(&str, &str, &str)] = &[
    (
        "growth",
        "SELECT COUNT(*) FROM health_record_values WHERE childId = ?1 AND metricId IN ('growth.height','growth.weight','growth.head_circumference','growth.bmi')",
        "SELECT MAX(createdAt) FROM health_record_values WHERE childId = ?1 AND metricId IN ('growth.height','growth.weight','growth.head_circumference','growth.bmi')",
    ),
    (
        "milestones",
        "SELECT COUNT(*) FROM milestone_records WHERE childId = ?1",
        "SELECT MAX(createdAt) FROM milestone_records WHERE childId = ?1",
    ),
    (
        "vaccines",
        "SELECT COUNT(*) FROM vaccine_records WHERE childId = ?1",
        "SELECT MAX(createdAt) FROM vaccine_records WHERE childId = ?1",
    ),
    (
        "vision",
        "SELECT COUNT(*) FROM health_record_values WHERE childId = ?1 AND metricId IN ('vision.left_visual_acuity','vision.right_visual_acuity','vision.left_axial_length','vision.right_axial_length','vision.left_iop','vision.right_iop')",
        "SELECT MAX(createdAt) FROM health_record_values WHERE childId = ?1 AND metricId IN ('vision.left_visual_acuity','vision.right_visual_acuity','vision.left_axial_length','vision.right_axial_length','vision.left_iop','vision.right_iop')",
    ),
    (
        "dental",
        "SELECT COUNT(*) FROM health_record_values WHERE childId = ?1 AND metricId = 'dental.event'",
        "SELECT MAX(createdAt) FROM health_record_values WHERE childId = ?1 AND metricId = 'dental.event'",
    ),
    (
        "allergies",
        "SELECT COUNT(*) FROM allergy_records WHERE childId = ?1",
        "SELECT MAX(COALESCE(updatedAt, createdAt)) FROM allergy_records WHERE childId = ?1",
    ),
    (
        "sleep",
        "SELECT COUNT(*) FROM health_record_values WHERE childId = ?1 AND metricId = 'sleep.duration_minutes'",
        "SELECT MAX(createdAt) FROM health_record_values WHERE childId = ?1 AND metricId = 'sleep.duration_minutes'",
    ),
    (
        "medical-events",
        "SELECT COUNT(*) FROM health_record_values WHERE childId = ?1 AND metricId = 'medical.event'",
        "SELECT MAX(e.updatedAt) FROM health_record_events e JOIN health_record_values v ON v.eventId = e.eventId WHERE v.childId = ?1 AND v.metricId = 'medical.event'",
    ),
    (
        "posture",
        // posture has no dedicated table yet (PO-PROF-019)
        "SELECT 0",
        "SELECT NULL",
    ),
    (
        "tanner",
        "SELECT COUNT(*) FROM health_record_values WHERE childId = ?1 AND metricId IN ('development.tanner_breast_stage','development.tanner_genital_stage','development.tanner_pubic_hair_stage','development.bone_age_years','development.body_fat_percentage')",
        "SELECT MAX(createdAt) FROM health_record_values WHERE childId = ?1 AND metricId IN ('development.tanner_breast_stage','development.tanner_genital_stage','development.tanner_pubic_hair_stage','development.bone_age_years','development.body_fat_percentage')",
    ),
    (
        "fitness",
        "SELECT COUNT(*) FROM health_record_values WHERE childId = ?1 AND metricId IN ('fitness.run_50m','fitness.vital_capacity','fitness.run_800m','fitness.run_1000m','fitness.run_50x8','fitness.sit_and_reach','fitness.standing_long_jump','fitness.sit_ups','fitness.pull_ups','fitness.rope_skipping','fitness.run_10m_shuttle','fitness.tennis_ball_throw','fitness.double_foot_jump','fitness.balance_beam','fitness.foot_arch_status','fitness.overall_grade')",
        "SELECT MAX(createdAt) FROM health_record_values WHERE childId = ?1 AND metricId IN ('fitness.run_50m','fitness.vital_capacity','fitness.run_800m','fitness.run_1000m','fitness.run_50x8','fitness.sit_and_reach','fitness.standing_long_jump','fitness.sit_ups','fitness.pull_ups','fitness.rope_skipping','fitness.run_10m_shuttle','fitness.tennis_ball_throw','fitness.double_foot_jump','fitness.balance_beam','fitness.foot_arch_status','fitness.overall_grade')",
    ),
    (
        "outdoor",
        "SELECT COUNT(*) FROM health_record_values WHERE childId = ?1 AND metricId = 'outdoor.activity_minutes'",
        "SELECT MAX(createdAt) FROM health_record_values WHERE childId = ?1 AND metricId = 'outdoor.activity_minutes'",
    ),
];

#[tauri::command]
pub fn get_profile_section_summaries(child_id: String) -> Result<Vec<SectionSummary>, String> {
    let conn = get_conn()?.lock().map_err(|e| e.to_string())?;
    let mut results = Vec::with_capacity(SECTION_QUERIES.len());

    for &(section_id, count_sql, max_sql) in SECTION_QUERIES {
        let summary = (|| -> Result<SectionSummary, String> {
            let count: i64 = if count_sql.contains("?1") {
                conn.query_row(count_sql, params![child_id], |row| row.get(0))
            } else {
                conn.query_row(count_sql, [], |row| row.get(0))
            }
            .map_err(|e| format!("{section_id} count: {e}"))?;

            let last_updated: Option<String> = if max_sql.contains("?1") {
                conn.query_row(max_sql, params![child_id], |row| row.get(0))
            } else {
                conn.query_row(max_sql, [], |row| row.get(0))
            }
            .map_err(|e| format!("{section_id} max: {e}"))?;

            let state = if count > 0 { "ok" } else { "empty" };
            Ok(SectionSummary {
                section_id: section_id.to_string(),
                record_count: count,
                last_updated_at: last_updated,
                state: state.to_string(),
                error_message: None,
            })
        })();

        match summary {
            Ok(s) => results.push(s),
            Err(e) => results.push(SectionSummary {
                section_id: section_id.to_string(),
                record_count: 0,
                last_updated_at: None,
                state: "error".to_string(),
                error_message: Some(e),
            }),
        }
    }

    Ok(results)
}

// ── Vaccine Records ────────────────────────────────────────

#[tauri::command]
pub fn insert_vaccine_record(
    record_id: String,
    child_id: String,
    rule_id: String,
    vaccine_name: String,
    vaccinated_at: String,
    age_months: i32,
    batch_number: Option<String>,
    hospital: Option<String>,
    adverse_reaction: Option<String>,
    photo_path: Option<String>,
    now: String,
) -> Result<(), String> {
    let conn = get_conn()?.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO vaccine_records (recordId, childId, ruleId, vaccineName, vaccinatedAt, ageMonths, batchNumber, hospital, adverseReaction, photoPath, createdAt) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",
        params![record_id, child_id, rule_id, vaccine_name, vaccinated_at, age_months, batch_number, hospital, adverse_reaction, photo_path, now],
    )
    .map_err(|e| format!("insert_vaccine_record: {e}"))?;
    Ok(())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaccineRecord {
    pub record_id: String,
    pub child_id: String,
    pub rule_id: String,
    pub vaccine_name: String,
    pub vaccinated_at: String,
    pub age_months: i32,
    pub batch_number: Option<String>,
    pub hospital: Option<String>,
    pub adverse_reaction: Option<String>,
    pub photo_path: Option<String>,
    pub created_at: String,
}

#[tauri::command]
pub fn get_vaccine_records(child_id: String) -> Result<Vec<VaccineRecord>, String> {
    let conn = get_conn()?.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare("SELECT recordId, childId, ruleId, vaccineName, vaccinatedAt, ageMonths, batchNumber, hospital, adverseReaction, photoPath, createdAt FROM vaccine_records WHERE childId = ?1 ORDER BY vaccinatedAt").map_err(|e| format!("get_vaccine_records: {e}"))?;
    let rows = stmt
        .query_map(params![child_id], |row| {
            Ok(VaccineRecord {
                record_id: row.get(0)?,
                child_id: row.get(1)?,
                rule_id: row.get(2)?,
                vaccine_name: row.get(3)?,
                vaccinated_at: row.get(4)?,
                age_months: row.get(5)?,
                batch_number: row.get(6)?,
                hospital: row.get(7)?,
                adverse_reaction: row.get(8)?,
                photo_path: row.get(9)?,
                created_at: row.get(10)?,
            })
        })
        .map_err(|e| format!("get_vaccine_records: {e}"))?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("get_vaccine_records collect: {e}"))
}

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
