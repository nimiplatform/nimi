use rusqlite::{params, OptionalExtension};
use serde::Serialize;

use super::super::get_conn;

// ── Tanner Assessments ────────────────────────────────────

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TannerAssessment {
    pub assessment_id: String,
    pub child_id: String,
    pub assessed_at: String,
    pub age_months: i32,
    pub breast_or_genital_stage: Option<i32>,
    pub pubic_hair_stage: Option<i32>,
    pub assessed_by: Option<String>,
    pub notes: Option<String>,
    pub created_at: String,
}

fn detail_tanner_event_id(assessment_id: &str) -> String {
    format!("detail-tanner:{assessment_id}")
}

fn detail_fitness_event_id(assessment_id: &str) -> String {
    format!("detail-fitness:{assessment_id}")
}

fn strip_detail_prefix<'a>(value: &'a str, prefix: &str) -> &'a str {
    value.strip_prefix(prefix).unwrap_or(value)
}

fn number_to_stage(value: Option<f64>) -> Option<i32> {
    value.map(|stage| stage.round() as i32)
}

fn finite_optional(value: Option<f64>, field_name: &str) -> Result<Option<f64>, String> {
    if let Some(number) = value {
        if !number.is_finite() {
            return Err(format!("{field_name} must be finite"));
        }
    }
    Ok(value)
}

fn finite_optional_i32(value: Option<i32>) -> Option<f64> {
    value.map(f64::from)
}

#[tauri::command]
pub fn insert_tanner_assessment(
    assessment_id: String,
    child_id: String,
    assessed_at: String,
    age_months: i32,
    breast_or_genital_stage: Option<i32>,
    pubic_hair_stage: Option<i32>,
    assessed_by: Option<String>,
    notes: Option<String>,
    now: String,
) -> Result<(), String> {
    if let Some(stage) = breast_or_genital_stage {
        if !(1..=5).contains(&stage) {
            return Err(format!("breastOrGenitalStage must be 1-5, got {stage}"));
        }
    }
    if let Some(stage) = pubic_hair_stage {
        if !(1..=5).contains(&stage) {
            return Err(format!("pubicHairStage must be 1-5, got {stage}"));
        }
    }
    let primary_stage = breast_or_genital_stage
        .ok_or_else(|| "insert_tanner_assessment requires breastOrGenitalStage".to_string())?;
    let pubic_stage = pubic_hair_stage
        .ok_or_else(|| "insert_tanner_assessment requires pubicHairStage".to_string())?;
    let mut conn = get_conn()?.lock().map_err(|e| e.to_string())?;
    let gender: String = conn
        .query_row(
            "SELECT gender FROM children WHERE childId = ?1",
            params![&child_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| format!("insert_tanner_assessment query child gender: {e}"))?
        .ok_or_else(|| format!("insert_tanner_assessment: no child found with id {child_id}"))?;
    let (protocol_id, primary_metric_id) = match gender.as_str() {
        "female" => (
            "tanner-female-self-assessment",
            "development.tanner_breast_stage",
        ),
        "male" => (
            "tanner-male-self-assessment",
            "development.tanner_genital_stage",
        ),
        _ => {
            return Err(format!(
                "insert_tanner_assessment: unsupported child gender \"{gender}\""
            ))
        }
    };
    let tx = conn
        .transaction()
        .map_err(|e| format!("insert_tanner_assessment begin transaction: {e}"))?;
    let event_id = detail_tanner_event_id(&assessment_id);
    tx.execute(
        "INSERT INTO health_record_events (
            eventId, childId, protocolId, groupId, recordKind, sourceSurface,
            recordedAt, effectiveDate, ageMonths, notes, metadataJson, createdAt, updatedAt
        ) VALUES (?1, ?2, ?3, 'development', 'manual', 'profile_detail', ?4, ?4, ?5, ?6, ?7, ?8, ?8)",
        params![
            &event_id,
            &child_id,
            protocol_id,
            &assessed_at,
            age_months,
            &notes,
            serde_json::json!({
                "legacyTannerAssessmentApi": true,
                "assessmentId": assessment_id,
                "assessedBy": assessed_by,
            })
            .to_string(),
            &now,
        ],
    )
    .map_err(|e| format!("insert_tanner_assessment insert health event: {e}"))?;
    tx.execute(
        "INSERT INTO health_record_values (
            valueId, eventId, childId, metricId, valueNumber, unit, recordKind, createdAt
        ) VALUES (?1, ?2, ?3, ?4, ?5, 'stage', 'measured', ?6)",
        params![
            format!("detail-tanner-value:{assessment_id}:primary"),
            &event_id,
            &child_id,
            primary_metric_id,
            primary_stage,
            &now,
        ],
    )
    .map_err(|e| format!("insert_tanner_assessment insert primary stage: {e}"))?;
    tx.execute(
        "INSERT INTO health_record_values (
            valueId, eventId, childId, metricId, valueNumber, unit, recordKind, createdAt
        ) VALUES (?1, ?2, ?3, 'development.tanner_pubic_hair_stage', ?4, 'stage', 'measured', ?5)",
        params![
            format!("detail-tanner-value:{assessment_id}:pubic-hair"),
            &event_id,
            &child_id,
            pubic_stage,
            &now,
        ],
    )
    .map_err(|e| format!("insert_tanner_assessment insert pubic hair stage: {e}"))?;
    tx.commit()
        .map_err(|e| format!("insert_tanner_assessment commit: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn get_tanner_assessments(child_id: String) -> Result<Vec<TannerAssessment>, String> {
    let conn = get_conn()?.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare(
        "SELECT
            e.eventId,
            e.childId,
            e.effectiveDate,
            e.ageMonths,
            MAX(CASE WHEN v.metricId IN ('development.tanner_breast_stage','development.tanner_genital_stage') THEN v.valueNumber END),
            MAX(CASE WHEN v.metricId = 'development.tanner_pubic_hair_stage' THEN v.valueNumber END),
            json_extract(e.metadataJson, '$.assessedBy'),
            e.notes,
            e.createdAt
         FROM health_record_events e
         JOIN health_record_values v ON v.eventId = e.eventId
         WHERE e.childId = ?1
           AND e.protocolId IN ('tanner-female-self-assessment', 'tanner-male-self-assessment')
         GROUP BY e.eventId
         ORDER BY e.effectiveDate"
    ).map_err(|e| format!("get_tanner_assessments: {e}"))?;
    let rows = stmt
        .query_map(params![child_id], |row| {
            let event_id: String = row.get(0)?;
            Ok(TannerAssessment {
                assessment_id: strip_detail_prefix(&event_id, "detail-tanner:").to_string(),
                child_id: row.get(1)?,
                assessed_at: row.get(2)?,
                age_months: row.get(3)?,
                breast_or_genital_stage: number_to_stage(row.get(4)?),
                pubic_hair_stage: number_to_stage(row.get(5)?),
                assessed_by: row.get(6)?,
                notes: row.get(7)?,
                created_at: row.get(8)?,
            })
        })
        .map_err(|e| format!("get_tanner_assessments: {e}"))?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("get_tanner_assessments collect: {e}"))
}

// ── Fitness Assessments ───────────────────────────────────

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FitnessAssessment {
    pub assessment_id: String,
    pub child_id: String,
    pub assessed_at: String,
    pub age_months: i32,
    pub assessment_source: Option<String>,
    pub run_50m: Option<f64>,
    pub run_800m: Option<f64>,
    pub run_1000m: Option<f64>,
    pub run_50x8: Option<f64>,
    pub sit_and_reach: Option<f64>,
    pub standing_long_jump: Option<f64>,
    pub sit_ups: Option<i32>,
    pub pull_ups: Option<i32>,
    pub rope_skipping: Option<i32>,
    pub vital_capacity: Option<i32>,
    pub run_10m_shuttle: Option<f64>,
    pub tennis_ball_throw: Option<f64>,
    pub double_foot_jump: Option<f64>,
    pub balance_beam: Option<f64>,
    pub foot_arch_status: Option<String>,
    pub notes: Option<String>,
    pub created_at: String,
}

#[tauri::command]
pub fn insert_fitness_assessment(
    assessment_id: String,
    child_id: String,
    assessed_at: String,
    age_months: i32,
    assessment_source: Option<String>,
    run_50m: Option<f64>,
    run_800m: Option<f64>,
    run_1000m: Option<f64>,
    run_50x8: Option<f64>,
    sit_and_reach: Option<f64>,
    standing_long_jump: Option<f64>,
    sit_ups: Option<i32>,
    pull_ups: Option<i32>,
    rope_skipping: Option<i32>,
    vital_capacity: Option<i32>,
    run_10m_shuttle: Option<f64>,
    tennis_ball_throw: Option<f64>,
    double_foot_jump: Option<f64>,
    balance_beam: Option<f64>,
    foot_arch_status: Option<String>,
    notes: Option<String>,
    now: String,
) -> Result<(), String> {
    let numeric_values: [(&str, &str, Option<f64>, Option<&str>); 14] = [
        (
            "run-50m",
            "fitness.run_50m",
            finite_optional(run_50m, "run50m")?,
            Some("s"),
        ),
        (
            "run-800m",
            "fitness.run_800m",
            finite_optional(run_800m, "run800m")?,
            Some("s"),
        ),
        (
            "run-1000m",
            "fitness.run_1000m",
            finite_optional(run_1000m, "run1000m")?,
            Some("s"),
        ),
        (
            "run-50x8",
            "fitness.run_50x8",
            finite_optional(run_50x8, "run50x8")?,
            Some("s"),
        ),
        (
            "sit-and-reach",
            "fitness.sit_and_reach",
            finite_optional(sit_and_reach, "sitAndReach")?,
            Some("cm"),
        ),
        (
            "standing-long-jump",
            "fitness.standing_long_jump",
            finite_optional(standing_long_jump, "standingLongJump")?,
            Some("cm"),
        ),
        (
            "sit-ups",
            "fitness.sit_ups",
            finite_optional_i32(sit_ups),
            Some("count"),
        ),
        (
            "pull-ups",
            "fitness.pull_ups",
            finite_optional_i32(pull_ups),
            Some("count"),
        ),
        (
            "rope-skipping",
            "fitness.rope_skipping",
            finite_optional_i32(rope_skipping),
            Some("count_per_min"),
        ),
        (
            "vital-capacity",
            "fitness.vital_capacity",
            finite_optional_i32(vital_capacity),
            Some("ml"),
        ),
        (
            "run-10m-shuttle",
            "fitness.run_10m_shuttle",
            finite_optional(run_10m_shuttle, "run10mShuttle")?,
            Some("s"),
        ),
        (
            "tennis-ball-throw",
            "fitness.tennis_ball_throw",
            finite_optional(tennis_ball_throw, "tennisBallThrow")?,
            Some("m"),
        ),
        (
            "double-foot-jump",
            "fitness.double_foot_jump",
            finite_optional(double_foot_jump, "doubleFootJump")?,
            Some("s"),
        ),
        (
            "balance-beam",
            "fitness.balance_beam",
            finite_optional(balance_beam, "balanceBeam")?,
            Some("s"),
        ),
    ];
    let has_numeric = numeric_values
        .iter()
        .any(|(_, _, value, _)| value.is_some());
    let foot_arch_status = foot_arch_status
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    if !has_numeric && foot_arch_status.is_none() {
        return Err(
            "insert_fitness_assessment requires at least one admitted fitness metric".to_string(),
        );
    }
    let mut conn = get_conn()?.lock().map_err(|e| e.to_string())?;
    let tx = conn
        .transaction()
        .map_err(|e| format!("insert_fitness_assessment begin transaction: {e}"))?;
    let event_id = detail_fitness_event_id(&assessment_id);
    tx.execute(
        "INSERT INTO health_record_events (
            eventId, childId, protocolId, groupId, recordKind, sourceSurface,
            recordedAt, effectiveDate, ageMonths, notes, metadataJson, createdAt, updatedAt
        ) VALUES (?1, ?2, 'fitness-school-assessment', 'fitness', 'manual', 'profile_detail', ?3, ?3, ?4, ?5, ?6, ?7, ?7)",
        params![
            &event_id,
            &child_id,
            &assessed_at,
            age_months,
            &notes,
            serde_json::json!({
                "legacyFitnessAssessmentApi": true,
                "assessmentId": assessment_id,
                "assessmentSource": assessment_source,
            })
            .to_string(),
            &now,
        ],
    )
    .map_err(|e| format!("insert_fitness_assessment insert health event: {e}"))?;
    for (suffix, metric_id, value, unit) in numeric_values {
        if let Some(value) = value {
            tx.execute(
                "INSERT INTO health_record_values (
                    valueId, eventId, childId, metricId, valueNumber, unit, recordKind, createdAt
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'measured', ?7)",
                params![
                    format!("detail-fitness-value:{assessment_id}:{suffix}"),
                    &event_id,
                    &child_id,
                    metric_id,
                    value,
                    unit,
                    &now,
                ],
            )
            .map_err(|e| format!("insert_fitness_assessment insert {metric_id}: {e}"))?;
        }
    }
    if let Some(value) = foot_arch_status {
        tx.execute(
            "INSERT INTO health_record_values (
                valueId, eventId, childId, metricId, valueText, recordKind, createdAt
            ) VALUES (?1, ?2, ?3, 'fitness.foot_arch_status', ?4, 'measured', ?5)",
            params![
                format!("detail-fitness-value:{assessment_id}:foot-arch-status"),
                &event_id,
                &child_id,
                value,
                &now,
            ],
        )
        .map_err(|e| format!("insert_fitness_assessment insert foot arch status: {e}"))?;
    }
    tx.commit()
        .map_err(|e| format!("insert_fitness_assessment commit: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn get_fitness_assessments(child_id: String) -> Result<Vec<FitnessAssessment>, String> {
    let conn = get_conn()?.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT
            e.eventId,
            e.childId,
            e.effectiveDate,
            e.ageMonths,
            json_extract(e.metadataJson, '$.assessmentSource'),
            MAX(CASE WHEN v.metricId = 'fitness.run_50m' THEN v.valueNumber END),
            MAX(CASE WHEN v.metricId = 'fitness.run_800m' THEN v.valueNumber END),
            MAX(CASE WHEN v.metricId = 'fitness.run_1000m' THEN v.valueNumber END),
            MAX(CASE WHEN v.metricId = 'fitness.run_50x8' THEN v.valueNumber END),
            MAX(CASE WHEN v.metricId = 'fitness.sit_and_reach' THEN v.valueNumber END),
            MAX(CASE WHEN v.metricId = 'fitness.standing_long_jump' THEN v.valueNumber END),
            MAX(CASE WHEN v.metricId = 'fitness.sit_ups' THEN v.valueNumber END),
            MAX(CASE WHEN v.metricId = 'fitness.pull_ups' THEN v.valueNumber END),
            MAX(CASE WHEN v.metricId = 'fitness.rope_skipping' THEN v.valueNumber END),
            MAX(CASE WHEN v.metricId = 'fitness.vital_capacity' THEN v.valueNumber END),
            MAX(CASE WHEN v.metricId = 'fitness.run_10m_shuttle' THEN v.valueNumber END),
            MAX(CASE WHEN v.metricId = 'fitness.tennis_ball_throw' THEN v.valueNumber END),
            MAX(CASE WHEN v.metricId = 'fitness.double_foot_jump' THEN v.valueNumber END),
            MAX(CASE WHEN v.metricId = 'fitness.balance_beam' THEN v.valueNumber END),
            MAX(CASE WHEN v.metricId = 'fitness.foot_arch_status' THEN v.valueText END),
            e.notes,
            e.createdAt
         FROM health_record_events e
         JOIN health_record_values v ON v.eventId = e.eventId
         WHERE e.childId = ?1 AND e.protocolId = 'fitness-school-assessment'
         GROUP BY e.eventId
         ORDER BY e.effectiveDate DESC",
        )
        .map_err(|e| format!("get_fitness_assessments: {e}"))?;
    let rows = stmt
        .query_map(params![child_id], |row| {
            let event_id: String = row.get(0)?;
            Ok(FitnessAssessment {
                assessment_id: strip_detail_prefix(&event_id, "detail-fitness:").to_string(),
                child_id: row.get(1)?,
                assessed_at: row.get(2)?,
                age_months: row.get(3)?,
                assessment_source: row.get(4)?,
                run_50m: row.get(5)?,
                run_800m: row.get(6)?,
                run_1000m: row.get(7)?,
                run_50x8: row.get(8)?,
                sit_and_reach: row.get(9)?,
                standing_long_jump: row.get(10)?,
                sit_ups: number_to_stage(row.get(11)?),
                pull_ups: number_to_stage(row.get(12)?),
                rope_skipping: number_to_stage(row.get(13)?),
                vital_capacity: number_to_stage(row.get(14)?),
                run_10m_shuttle: row.get(15)?,
                tennis_ball_throw: row.get(16)?,
                double_foot_jump: row.get(17)?,
                balance_beam: row.get(18)?,
                foot_arch_status: row.get(19)?,
                notes: row.get(20)?,
                created_at: row.get(21)?,
            })
        })
        .map_err(|e| format!("get_fitness_assessments: {e}"))?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("get_fitness_assessments collect: {e}"))
}

// ── Delete operations ────────────────────────────────────────

#[tauri::command]
pub fn delete_tanner_assessment(assessment_id: String) -> Result<(), String> {
    let conn = get_conn()?.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM health_record_events WHERE eventId = ?1 AND protocolId IN ('tanner-female-self-assessment', 'tanner-male-self-assessment')",
        params![detail_tanner_event_id(&assessment_id)],
    )
        .map_err(|e| format!("delete_tanner_assessment: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn delete_fitness_assessment(assessment_id: String) -> Result<(), String> {
    let conn = get_conn()?.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM health_record_events WHERE eventId = ?1 AND protocolId = 'fitness-school-assessment'",
        params![detail_fitness_event_id(&assessment_id)],
    )
        .map_err(|e| format!("delete_fitness_assessment: {e}"))?;
    Ok(())
}
