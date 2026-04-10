use rusqlite::params;
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

#[tauri::command]
pub fn insert_tanner_assessment(
    assessment_id: String, child_id: String, assessed_at: String, age_months: i32,
    breast_or_genital_stage: Option<i32>, pubic_hair_stage: Option<i32>,
    assessed_by: Option<String>, notes: Option<String>, now: String,
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
    let conn = get_conn()?.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO tanner_assessments (assessmentId, childId, assessedAt, ageMonths, breastOrGenitalStage, pubicHairStage, assessedBy, notes, createdAt) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)",
        params![assessment_id, child_id, assessed_at, age_months, breast_or_genital_stage, pubic_hair_stage, assessed_by, notes, now],
    ).map_err(|e| format!("insert_tanner_assessment: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn get_tanner_assessments(child_id: String) -> Result<Vec<TannerAssessment>, String> {
    let conn = get_conn()?.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare("SELECT assessmentId, childId, assessedAt, ageMonths, breastOrGenitalStage, pubicHairStage, assessedBy, notes, createdAt FROM tanner_assessments WHERE childId = ?1 ORDER BY assessedAt").map_err(|e| format!("get_tanner_assessments: {e}"))?;
    let rows = stmt.query_map(params![child_id], |row| {
        Ok(TannerAssessment {
            assessment_id: row.get(0)?,
            child_id: row.get(1)?,
            assessed_at: row.get(2)?,
            age_months: row.get(3)?,
            breast_or_genital_stage: row.get(4)?,
            pubic_hair_stage: row.get(5)?,
            assessed_by: row.get(6)?,
            notes: row.get(7)?,
            created_at: row.get(8)?,
        })
    }).map_err(|e| format!("get_tanner_assessments: {e}"))?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| format!("get_tanner_assessments collect: {e}"))
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
    pub overall_grade: Option<String>,
    pub notes: Option<String>,
    pub created_at: String,
}

#[tauri::command]
pub fn insert_fitness_assessment(
    assessment_id: String, child_id: String, assessed_at: String, age_months: i32,
    assessment_source: Option<String>, run_50m: Option<f64>, run_800m: Option<f64>,
    run_1000m: Option<f64>, run_50x8: Option<f64>, sit_and_reach: Option<f64>, standing_long_jump: Option<f64>,
    sit_ups: Option<i32>, pull_ups: Option<i32>, rope_skipping: Option<i32>,
    vital_capacity: Option<i32>,
    run_10m_shuttle: Option<f64>, tennis_ball_throw: Option<f64>,
    double_foot_jump: Option<f64>, balance_beam: Option<f64>,
    foot_arch_status: Option<String>,
    overall_grade: Option<String>, notes: Option<String>, now: String,
) -> Result<(), String> {
    let conn = get_conn()?.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO fitness_assessments (assessmentId, childId, assessedAt, ageMonths, assessmentSource, run50m, run800m, run1000m, run50x8, sitAndReach, standingLongJump, sitUps, pullUps, ropeSkipping, vitalCapacity, run10mShuttle, tennisBallThrow, doubleFootJump, balanceBeam, footArchStatus, overallGrade, notes, createdAt) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,?22,?23)",
        params![assessment_id, child_id, assessed_at, age_months, assessment_source, run_50m, run_800m, run_1000m, run_50x8, sit_and_reach, standing_long_jump, sit_ups, pull_ups, rope_skipping, vital_capacity, run_10m_shuttle, tennis_ball_throw, double_foot_jump, balance_beam, foot_arch_status, overall_grade, notes, now],
    ).map_err(|e| format!("insert_fitness_assessment: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn get_fitness_assessments(child_id: String) -> Result<Vec<FitnessAssessment>, String> {
    let conn = get_conn()?.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare("SELECT assessmentId, childId, assessedAt, ageMonths, assessmentSource, run50m, run800m, run1000m, run50x8, sitAndReach, standingLongJump, sitUps, pullUps, ropeSkipping, vitalCapacity, run10mShuttle, tennisBallThrow, doubleFootJump, balanceBeam, footArchStatus, overallGrade, notes, createdAt FROM fitness_assessments WHERE childId = ?1 ORDER BY assessedAt DESC").map_err(|e| format!("get_fitness_assessments: {e}"))?;
    let rows = stmt.query_map(params![child_id], |row| {
        Ok(FitnessAssessment {
            assessment_id: row.get(0)?,
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
            sit_ups: row.get(11)?,
            pull_ups: row.get(12)?,
            rope_skipping: row.get(13)?,
            vital_capacity: row.get(14)?,
            run_10m_shuttle: row.get(15)?,
            tennis_ball_throw: row.get(16)?,
            double_foot_jump: row.get(17)?,
            balance_beam: row.get(18)?,
            foot_arch_status: row.get(19)?,
            overall_grade: row.get(20)?,
            notes: row.get(21)?,
            created_at: row.get(22)?,
        })
    }).map_err(|e| format!("get_fitness_assessments: {e}"))?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| format!("get_fitness_assessments collect: {e}"))
}

// ── Delete operations ────────────────────────────────────────

#[tauri::command]
pub fn delete_tanner_assessment(assessment_id: String) -> Result<(), String> {
    let conn = get_conn()?.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM tanner_assessments WHERE assessmentId = ?1", params![assessment_id])
        .map_err(|e| format!("delete_tanner_assessment: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn delete_fitness_assessment(assessment_id: String) -> Result<(), String> {
    let conn = get_conn()?.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM fitness_assessments WHERE assessmentId = ?1", params![assessment_id])
        .map_err(|e| format!("delete_fitness_assessment: {e}"))?;
    Ok(())
}
