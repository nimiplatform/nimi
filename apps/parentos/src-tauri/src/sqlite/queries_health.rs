use crate::sqlite::get_conn;
use rusqlite::params;
use serde::Serialize;

fn is_supported_growth_report_type(report_type: &str) -> bool {
    matches!(report_type, "monthly" | "quarterly" | "quarterly-letter")
}

#[tauri::command]
pub fn insert_growth_report(
    report_id: String,
    child_id: String,
    report_type: String,
    period_start: String,
    period_end: String,
    age_months_start: i32,
    age_months_end: i32,
    content: String,
    generated_at: String,
    now: String,
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
pub fn get_growth_reports(
    child_id: String,
    report_type: Option<String>,
) -> Result<Vec<GrowthReport>, String> {
    let conn = get_conn()?.lock().map_err(|e| e.to_string())?;
    let sql = match &report_type {
        Some(_) => "SELECT reportId, childId, reportType, periodStart, periodEnd, ageMonthsStart, ageMonthsEnd, content, generatedAt, createdAt FROM growth_reports WHERE childId = ?1 AND reportType = ?2 ORDER BY periodStart DESC",
        None => "SELECT reportId, childId, reportType, periodStart, periodEnd, ageMonthsStart, ageMonthsEnd, content, generatedAt, createdAt FROM growth_reports WHERE childId = ?1 ORDER BY periodStart DESC",
    };
    let mut stmt = conn
        .prepare(sql)
        .map_err(|e| format!("get_growth_reports: {e}"))?;
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
pub fn set_app_setting(key: String, value: String, now: String) -> Result<(), String> {
    let conn = get_conn()?.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO app_settings (key, value, updatedAt) VALUES (?1, ?2, ?3) ON CONFLICT(key) DO UPDATE SET value = ?2, updatedAt = ?3",
        params![key, value, now],
    )
    .map_err(|e| format!("set_app_setting: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn get_app_setting(key: String) -> Result<Option<String>, String> {
    let conn = get_conn()?.lock().map_err(|e| e.to_string())?;
    let result = conn
        .query_row(
            "SELECT value FROM app_settings WHERE key = ?1",
            params![key],
            |row| row.get(0),
        )
        .ok();
    Ok(result)
}

fn is_supported_dental_event_type(t: &str) -> bool {
    matches!(t, "eruption" | "loss" | "caries" | "cleaning" | "ortho-assessment")
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
    if !is_supported_dental_event_type(event_type.trim()) {
        return Err(format!(
            "unsupported dental eventType \"{event_type}\"; expected eruption | loss | caries | cleaning | ortho-assessment",
        ));
    }
    let conn = get_conn()?.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO dental_records (recordId, childId, eventType, toothId, toothSet, eventDate, ageMonths, severity, hospital, notes, photoPath, createdAt) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)",
        params![record_id, child_id, event_type, tooth_id, tooth_set, event_date, age_months, severity, hospital, notes, photo_path, now],
    ).map_err(|e| format!("insert_dental_record: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn get_dental_records(child_id: String) -> Result<Vec<DentalRecord>, String> {
    let conn = get_conn()?.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare("SELECT recordId, childId, eventType, toothId, toothSet, eventDate, ageMonths, severity, hospital, notes, photoPath, createdAt FROM dental_records WHERE childId = ?1 ORDER BY eventDate").map_err(|e| format!("get_dental_records: {e}"))?;
    let rows = stmt.query_map(params![child_id], |row| {
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
    }).map_err(|e| format!("get_dental_records: {e}"))?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| format!("get_dental_records collect: {e}"))
}

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
        return Err(format!("unsupported allergy severity \"{severity}\"; expected mild | moderate | severe"));
    }
    if !is_supported_allergy_status(status.trim()) {
        return Err(format!("unsupported allergy status \"{status}\"; expected active | outgrown | uncertain"));
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
    let rows = stmt.query_map(params![child_id], |row| {
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
    }).map_err(|e| format!("get_allergy_records: {e}"))?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| format!("get_allergy_records collect: {e}"))
}

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
    let conn = get_conn()?.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO sleep_records (recordId, childId, sleepDate, bedtime, wakeTime, durationMinutes, napCount, napMinutes, quality, ageMonths, notes, createdAt) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12) ON CONFLICT(childId, sleepDate) DO UPDATE SET bedtime=excluded.bedtime, wakeTime=excluded.wakeTime, durationMinutes=excluded.durationMinutes, napCount=excluded.napCount, napMinutes=excluded.napMinutes, quality=excluded.quality, notes=excluded.notes",
        params![record_id, child_id, sleep_date, bedtime, wake_time, duration_minutes, nap_count, nap_minutes, quality, age_months, notes, now],
    ).map_err(|e| format!("upsert_sleep_record: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn get_sleep_records(child_id: String, limit: Option<i32>) -> Result<Vec<SleepRecord>, String> {
    let conn = get_conn()?.lock().map_err(|e| e.to_string())?;
    let lim = limit.unwrap_or(90);
    let mut stmt = conn.prepare("SELECT recordId, childId, sleepDate, bedtime, wakeTime, durationMinutes, napCount, napMinutes, quality, ageMonths, notes, createdAt FROM sleep_records WHERE childId = ?1 ORDER BY sleepDate DESC LIMIT ?2").map_err(|e| format!("get_sleep_records: {e}"))?;
    let rows = stmt.query_map(params![child_id, lim], |row| {
        Ok(SleepRecord {
            record_id: row.get(0)?,
            child_id: row.get(1)?,
            sleep_date: row.get(2)?,
            bedtime: row.get(3)?,
            wake_time: row.get(4)?,
            duration_minutes: row.get(5)?,
            nap_count: row.get(6)?,
            nap_minutes: row.get(7)?,
            quality: row.get(8)?,
            age_months: row.get(9)?,
            notes: row.get(10)?,
            created_at: row.get(11)?,
        })
    }).map_err(|e| format!("get_sleep_records: {e}"))?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| format!("get_sleep_records collect: {e}"))
}

fn is_supported_medical_event_type(t: &str) -> bool {
    matches!(t, "injury" | "fracture" | "surgery" | "skin-condition" | "medication" | "hearing-screening" | "other")
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
            "unsupported medical eventType \"{event_type}\"; expected injury | fracture | surgery | skin-condition | medication | hearing-screening | other",
        ));
    }
    let conn = get_conn()?.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO medical_events (eventId, childId, eventType, title, eventDate, endDate, ageMonths, severity, result, hospital, medication, dosage, notes, photoPath, createdAt, updatedAt) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?15)",
        params![event_id, child_id, event_type, title, event_date, end_date, age_months, severity, result, hospital, medication, dosage, notes, photo_path, now],
    ).map_err(|e| format!("insert_medical_event: {e}"))?;
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
    let conn = get_conn()?.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE medical_events SET title=?2, eventDate=?3, endDate=?4, severity=?5, result=?6, hospital=?7, medication=?8, dosage=?9, notes=?10, photoPath=?11, updatedAt=?12 WHERE eventId=?1",
        params![event_id, title, event_date, end_date, severity, result, hospital, medication, dosage, notes, photo_path, now],
    ).map_err(|e| format!("update_medical_event: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn get_medical_events(child_id: String) -> Result<Vec<MedicalEvent>, String> {
    let conn = get_conn()?.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare("SELECT eventId, childId, eventType, title, eventDate, endDate, ageMonths, severity, result, hospital, medication, dosage, notes, photoPath, createdAt, updatedAt FROM medical_events WHERE childId = ?1 ORDER BY eventDate DESC").map_err(|e| format!("get_medical_events: {e}"))?;
    let rows = stmt.query_map(params![child_id], |row| {
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
    }).map_err(|e| format!("get_medical_events: {e}"))?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| format!("get_medical_events collect: {e}"))
}

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
    pub sit_and_reach: Option<f64>,
    pub standing_long_jump: Option<f64>,
    pub sit_ups: Option<i32>,
    pub pull_ups: Option<i32>,
    pub rope_skipping: Option<i32>,
    pub vital_capacity: Option<i32>,
    pub foot_arch_status: Option<String>,
    pub overall_grade: Option<String>,
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
    sit_and_reach: Option<f64>,
    standing_long_jump: Option<f64>,
    sit_ups: Option<i32>,
    pull_ups: Option<i32>,
    rope_skipping: Option<i32>,
    vital_capacity: Option<i32>,
    foot_arch_status: Option<String>,
    overall_grade: Option<String>,
    notes: Option<String>,
    now: String,
) -> Result<(), String> {
    let conn = get_conn()?.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO fitness_assessments (assessmentId, childId, assessedAt, ageMonths, assessmentSource, run50m, run800m, run1000m, sitAndReach, standingLongJump, sitUps, pullUps, ropeSkipping, vitalCapacity, footArchStatus, overallGrade, notes, createdAt) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18)",
        params![assessment_id, child_id, assessed_at, age_months, assessment_source, run_50m, run_800m, run_1000m, sit_and_reach, standing_long_jump, sit_ups, pull_ups, rope_skipping, vital_capacity, foot_arch_status, overall_grade, notes, now],
    ).map_err(|e| format!("insert_fitness_assessment: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn get_fitness_assessments(child_id: String) -> Result<Vec<FitnessAssessment>, String> {
    let conn = get_conn()?.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare("SELECT assessmentId, childId, assessedAt, ageMonths, assessmentSource, run50m, run800m, run1000m, sitAndReach, standingLongJump, sitUps, pullUps, ropeSkipping, vitalCapacity, footArchStatus, overallGrade, notes, createdAt FROM fitness_assessments WHERE childId = ?1 ORDER BY assessedAt DESC").map_err(|e| format!("get_fitness_assessments: {e}"))?;
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
            sit_and_reach: row.get(8)?,
            standing_long_jump: row.get(9)?,
            sit_ups: row.get(10)?,
            pull_ups: row.get(11)?,
            rope_skipping: row.get(12)?,
            vital_capacity: row.get(13)?,
            foot_arch_status: row.get(14)?,
            overall_grade: row.get(15)?,
            notes: row.get(16)?,
            created_at: row.get(17)?,
        })
    }).map_err(|e| format!("get_fitness_assessments: {e}"))?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| format!("get_fitness_assessments collect: {e}"))
}
