use rusqlite::params;
use serde::Serialize;

use super::super::get_conn;

// ── Posture Assessments (retained-owner domain, profile-contract.md#PO-PROF-019) ──

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PostureAssessment {
    pub assessment_id: String,
    pub child_id: String,
    pub assessed_at: String,
    pub age_months: i32,
    pub source: Option<String>,
    pub shoulder: Option<String>,
    pub scapula: Option<String>,
    pub hip: Option<String>,
    pub leg: Option<String>,
    pub heel: Option<String>,
    pub neck: Option<String>,
    pub pelvis: Option<String>,
    pub knee: Option<String>,
    pub adam: Option<String>,
    pub cobb_angle: Option<f64>,
    pub notes: Option<String>,
    pub photo_paths: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn insert_posture_assessment(
    assessment_id: String,
    child_id: String,
    assessed_at: String,
    age_months: i32,
    source: Option<String>,
    shoulder: Option<String>,
    scapula: Option<String>,
    hip: Option<String>,
    leg: Option<String>,
    heel: Option<String>,
    neck: Option<String>,
    pelvis: Option<String>,
    knee: Option<String>,
    adam: Option<String>,
    cobb_angle: Option<f64>,
    notes: Option<String>,
    photo_paths: Option<String>,
    now: String,
) -> Result<(), String> {
    let conn = get_conn()?.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO posture_assessments
         (assessmentId, childId, assessedAt, ageMonths, source, shoulder, scapula, hip, leg, heel,
          neck, pelvis, knee, adam, cobbAngle, notes, photoPaths, createdAt, updatedAt)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?18)",
        params![
            assessment_id, child_id, assessed_at, age_months, source, shoulder, scapula, hip, leg,
            heel, neck, pelvis, knee, adam, cobb_angle, notes, photo_paths, now
        ],
    )
    .map_err(|e| format!("insert_posture_assessment: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn get_posture_assessments(child_id: String) -> Result<Vec<PostureAssessment>, String> {
    let conn = get_conn()?.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT assessmentId, childId, assessedAt, ageMonths, source, shoulder, scapula, hip,
                    leg, heel, neck, pelvis, knee, adam, cobbAngle, notes, photoPaths,
                    createdAt, updatedAt
             FROM posture_assessments
             WHERE childId = ?1
             ORDER BY assessedAt DESC, createdAt DESC",
        )
        .map_err(|e| format!("get_posture_assessments: {e}"))?;
    let rows = stmt
        .query_map(params![child_id], |row| {
            Ok(PostureAssessment {
                assessment_id: row.get(0)?,
                child_id: row.get(1)?,
                assessed_at: row.get(2)?,
                age_months: row.get(3)?,
                source: row.get(4)?,
                shoulder: row.get(5)?,
                scapula: row.get(6)?,
                hip: row.get(7)?,
                leg: row.get(8)?,
                heel: row.get(9)?,
                neck: row.get(10)?,
                pelvis: row.get(11)?,
                knee: row.get(12)?,
                adam: row.get(13)?,
                cobb_angle: row.get(14)?,
                notes: row.get(15)?,
                photo_paths: row.get(16)?,
                created_at: row.get(17)?,
                updated_at: row.get(18)?,
            })
        })
        .map_err(|e| format!("get_posture_assessments: {e}"))?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("get_posture_assessments collect: {e}"))
}
