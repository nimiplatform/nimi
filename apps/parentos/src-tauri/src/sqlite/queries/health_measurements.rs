use rusqlite::params;
use serde::Serialize;

use super::super::get_conn;

// ── Growth Measurements ────────────────────────────────────

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Measurement {
    pub measurement_id: String,
    pub child_id: String,
    pub type_id: String,
    pub value: f64,
    pub measured_at: String,
    pub age_months: i32,
    pub percentile: Option<f64>,
    pub source: Option<String>,
    pub notes: Option<String>,
    pub created_at: String,
}

fn measurement_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Measurement> {
    Ok(Measurement {
        measurement_id: row.get(0)?,
        child_id: row.get(1)?,
        type_id: row.get(2)?,
        value: row.get(3)?,
        measured_at: row.get(4)?,
        age_months: row.get(5)?,
        percentile: row.get(6)?,
        source: row.get(7)?,
        notes: row.get(8)?,
        created_at: row.get(9)?,
    })
}

#[tauri::command]
pub fn insert_measurement(
    measurement_id: String, child_id: String, type_id: String, value: f64,
    measured_at: String, age_months: i32, percentile: Option<f64>, source: Option<String>,
    notes: Option<String>, now: String,
) -> Result<(), String> {
    let conn = get_conn()?.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO growth_measurements (measurementId, childId, typeId, value, measuredAt, ageMonths, percentile, source, notes, createdAt) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",
        params![measurement_id, child_id, type_id, value, measured_at, age_months, percentile, source, notes, now],
    )
    .map_err(|e| format!("insert_measurement: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn get_measurements(child_id: String, type_id: Option<String>) -> Result<Vec<Measurement>, String> {
    let conn = get_conn()?.lock().map_err(|e| e.to_string())?;
    let sql = match &type_id {
        Some(_) => "SELECT measurementId, childId, typeId, value, measuredAt, ageMonths, percentile, source, notes, createdAt FROM growth_measurements WHERE childId = ?1 AND typeId = ?2 ORDER BY measuredAt",
        None => "SELECT measurementId, childId, typeId, value, measuredAt, ageMonths, percentile, source, notes, createdAt FROM growth_measurements WHERE childId = ?1 ORDER BY measuredAt",
    };
    let mut stmt = conn.prepare(sql).map_err(|e| format!("get_measurements: {e}"))?;
    if let Some(tid) = &type_id {
        let rows = stmt
            .query_map(params![child_id, tid], measurement_from_row)
            .map_err(|e| format!("get_measurements: {e}"))?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("get_measurements collect: {e}"))
    } else {
        let rows = stmt
            .query_map(params![child_id], measurement_from_row)
            .map_err(|e| format!("get_measurements: {e}"))?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("get_measurements collect: {e}"))
    }
}

#[tauri::command]
pub fn update_measurement(
    measurement_id: String, value: f64, measured_at: String, age_months: i32,
    percentile: Option<f64>, source: Option<String>, notes: Option<String>, now: String,
) -> Result<(), String> {
    let conn = get_conn()?.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE growth_measurements SET value = ?2, measuredAt = ?3, ageMonths = ?4, percentile = ?5, source = ?6, notes = ?7, createdAt = ?8 WHERE measurementId = ?1",
        params![measurement_id, value, measured_at, age_months, percentile, source, notes, now],
    ).map_err(|e| format!("update_measurement: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn delete_measurement(measurement_id: String) -> Result<(), String> {
    let conn = get_conn()?.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM growth_measurements WHERE measurementId = ?1", params![measurement_id])
        .map_err(|e| format!("delete_measurement: {e}"))?;
    Ok(())
}

// ── Milestone Records ──────────────────────────────────────

#[tauri::command]
pub fn upsert_milestone_record(
    record_id: String, child_id: String, milestone_id: String,
    achieved_at: Option<String>, age_months_when_achieved: Option<i32>,
    notes: Option<String>, photo_path: Option<String>, now: String,
) -> Result<(), String> {
    let conn = get_conn()?.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO milestone_records (recordId, childId, milestoneId, achievedAt, ageMonthsWhenAchieved, notes, photoPath, createdAt, updatedAt) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?8) ON CONFLICT(childId, milestoneId) DO UPDATE SET achievedAt=?4, ageMonthsWhenAchieved=?5, notes=?6, photoPath=?7, updatedAt=?8",
        params![record_id, child_id, milestone_id, achieved_at, age_months_when_achieved, notes, photo_path, now],
    )
    .map_err(|e| format!("upsert_milestone_record: {e}"))?;
    Ok(())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MilestoneRecord {
    pub record_id: String,
    pub child_id: String,
    pub milestone_id: String,
    pub achieved_at: Option<String>,
    pub age_months_when_achieved: Option<i32>,
    pub notes: Option<String>,
    pub photo_path: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[tauri::command]
pub fn get_milestone_records(child_id: String) -> Result<Vec<MilestoneRecord>, String> {
    let conn = get_conn()?.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare("SELECT recordId, childId, milestoneId, achievedAt, ageMonthsWhenAchieved, notes, photoPath, createdAt, updatedAt FROM milestone_records WHERE childId = ?1 ORDER BY achievedAt").map_err(|e| format!("get_milestone_records: {e}"))?;
    let rows = stmt.query_map(params![child_id], |row| {
        Ok(MilestoneRecord {
            record_id: row.get(0)?,
            child_id: row.get(1)?,
            milestone_id: row.get(2)?,
            achieved_at: row.get(3)?,
            age_months_when_achieved: row.get(4)?,
            notes: row.get(5)?,
            photo_path: row.get(6)?,
            created_at: row.get(7)?,
            updated_at: row.get(8)?,
        })
    }).map_err(|e| format!("get_milestone_records: {e}"))?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| format!("get_milestone_records collect: {e}"))
}

#[tauri::command]
pub fn delete_milestone_record(record_id: String) -> Result<(), String> {
    let conn = get_conn()?.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM milestone_records WHERE recordId = ?1", params![record_id])
        .map_err(|e| format!("delete_milestone_record: {e}"))?;
    Ok(())
}

// ── Growth Reports ─────────────────────────────────────────

fn is_supported_growth_report_type(report_type: &str) -> bool {
    matches!(report_type, "monthly" | "quarterly" | "quarterly-letter" | "custom")
}

#[tauri::command]
pub fn insert_growth_report(
    report_id: String, child_id: String, report_type: String,
    period_start: String, period_end: String, age_months_start: i32, age_months_end: i32,
    content: String, generated_at: String, now: String,
) -> Result<(), String> {
    if !is_supported_growth_report_type(report_type.trim()) {
        return Err(format!(
            "unsupported growth reportType \"{}\"; expected monthly | quarterly | quarterly-letter",
            report_type,
        ));
    }

    let conn = get_conn()?.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO growth_reports (reportId, childId, reportType, periodStart, periodEnd, ageMonthsStart, ageMonthsEnd, content, generatedAt, createdAt) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",
        params![report_id, child_id, report_type, period_start, period_end, age_months_start, age_months_end, content, generated_at, now],
    ).map_err(|e| format!("insert_growth_report: {e}"))?;
    Ok(())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GrowthReport {
    pub report_id: String,
    pub child_id: String,
    pub report_type: String,
    pub period_start: String,
    pub period_end: String,
    pub age_months_start: i32,
    pub age_months_end: i32,
    pub content: String,
    pub generated_at: String,
    pub created_at: String,
}

fn growth_report_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<GrowthReport> {
    Ok(GrowthReport {
        report_id: row.get(0)?,
        child_id: row.get(1)?,
        report_type: row.get(2)?,
        period_start: row.get(3)?,
        period_end: row.get(4)?,
        age_months_start: row.get(5)?,
        age_months_end: row.get(6)?,
        content: row.get(7)?,
        generated_at: row.get(8)?,
        created_at: row.get(9)?,
    })
}

#[tauri::command]
pub fn get_growth_reports(child_id: String, report_type: Option<String>) -> Result<Vec<GrowthReport>, String> {
    let conn = get_conn()?.lock().map_err(|e| e.to_string())?;
    let sql = match &report_type {
        Some(_) => "SELECT reportId, childId, reportType, periodStart, periodEnd, ageMonthsStart, ageMonthsEnd, content, generatedAt, createdAt FROM growth_reports WHERE childId = ?1 AND reportType = ?2 ORDER BY periodStart DESC",
        None => "SELECT reportId, childId, reportType, periodStart, periodEnd, ageMonthsStart, ageMonthsEnd, content, generatedAt, createdAt FROM growth_reports WHERE childId = ?1 ORDER BY periodStart DESC",
    };
    let mut stmt = conn.prepare(sql).map_err(|e| format!("get_growth_reports: {e}"))?;
    if let Some(rt) = &report_type {
        let rows = stmt
            .query_map(params![child_id, rt], growth_report_from_row)
            .map_err(|e| format!("get_growth_reports: {e}"))?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("get_growth_reports collect: {e}"))
    } else {
        let rows = stmt
            .query_map(params![child_id], growth_report_from_row)
            .map_err(|e| format!("get_growth_reports: {e}"))?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("get_growth_reports collect: {e}"))
    }
}

#[tauri::command]
pub fn update_growth_report_content(report_id: String, content: String, _now: String) -> Result<(), String> {
    let conn = get_conn()?.lock().map_err(|e| e.to_string())?;
    let changed = conn
        .execute(
            "UPDATE growth_reports SET content = ?1 WHERE reportId = ?2",
            params![content, report_id],
        )
        .map_err(|e| format!("update_growth_report_content: {e}"))?;
    if changed == 0 {
        return Err(format!("update_growth_report_content: no report found with id {report_id}"));
    }
    Ok(())
}
