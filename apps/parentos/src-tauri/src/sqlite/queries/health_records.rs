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


include!("health_records_dental.inc.rs");
include!("health_records_tail.inc.rs");
