use rusqlite::params;
use serde::Serialize;

use super::super::get_conn;

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
        "SELECT COUNT(*) FROM growth_measurements WHERE childId = ?1",
        "SELECT MAX(createdAt) FROM growth_measurements WHERE childId = ?1",
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
        "SELECT COUNT(*) FROM growth_measurements WHERE childId = ?1 AND typeId IN ('vision-left','vision-right','corrected-vision-left','corrected-vision-right','hyperopia-reserve','refraction-sph-left','refraction-sph-right','refraction-cyl-left','refraction-cyl-right','refraction-axis-left','refraction-axis-right','axial-length-left','axial-length-right','corneal-curvature-left','corneal-curvature-right')",
        "SELECT MAX(createdAt) FROM growth_measurements WHERE childId = ?1 AND typeId IN ('vision-left','vision-right','corrected-vision-left','corrected-vision-right','hyperopia-reserve','refraction-sph-left','refraction-sph-right','refraction-cyl-left','refraction-cyl-right','refraction-axis-left','refraction-axis-right','axial-length-left','axial-length-right','corneal-curvature-left','corneal-curvature-right')",
    ),
    (
        "dental",
        "SELECT COUNT(*) FROM dental_records WHERE childId = ?1",
        "SELECT MAX(createdAt) FROM dental_records WHERE childId = ?1",
    ),
    (
        "allergies",
        "SELECT COUNT(*) FROM allergy_records WHERE childId = ?1",
        "SELECT MAX(COALESCE(updatedAt, createdAt)) FROM allergy_records WHERE childId = ?1",
    ),
    (
        "sleep",
        "SELECT COUNT(*) FROM sleep_records WHERE childId = ?1",
        "SELECT MAX(createdAt) FROM sleep_records WHERE childId = ?1",
    ),
    (
        "medical-events",
        "SELECT COUNT(*) FROM medical_events WHERE childId = ?1",
        "SELECT MAX(COALESCE(updatedAt, createdAt)) FROM medical_events WHERE childId = ?1",
    ),
    (
        "posture",
        // posture has no dedicated table yet (PO-PROF-019)
        "SELECT 0",
        "SELECT NULL",
    ),
    (
        "tanner",
        "SELECT COUNT(*) FROM tanner_assessments WHERE childId = ?1",
        "SELECT MAX(createdAt) FROM tanner_assessments WHERE childId = ?1",
    ),
    (
        "fitness",
        "SELECT COUNT(*) FROM fitness_assessments WHERE childId = ?1",
        "SELECT MAX(createdAt) FROM fitness_assessments WHERE childId = ?1",
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
    record_id: String, child_id: String, rule_id: String, vaccine_name: String,
    vaccinated_at: String, age_months: i32, batch_number: Option<String>,
    hospital: Option<String>, adverse_reaction: Option<String>, photo_path: Option<String>, now: String,
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
    let rows = stmt.query_map(params![child_id], |row| {
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
    }).map_err(|e| format!("get_vaccine_records: {e}"))?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| format!("get_vaccine_records collect: {e}"))
}

// ── Dental Records ────────────────────────────────────────

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
    record_id: String, child_id: String, event_type: String,
    tooth_id: Option<String>, tooth_set: Option<String>, event_date: String,
    age_months: i32, severity: Option<String>, hospital: Option<String>,
    notes: Option<String>, photo_path: Option<String>, now: String,
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
    record_id: String, child_id: String, allergen: String, category: String,
    reaction_type: Option<String>, severity: String,
    diagnosed_at: Option<String>, age_months_at_diagnosis: Option<i32>,
    status: String, status_changed_at: Option<String>, confirmed_by: Option<String>,
    notes: Option<String>, now: String,
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
    record_id: String, allergen: String, category: String,
    reaction_type: Option<String>, severity: String, status: String,
    status_changed_at: Option<String>, confirmed_by: Option<String>,
    notes: Option<String>, now: String,
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

#[tauri::command]
pub fn upsert_sleep_record(
    record_id: String, child_id: String, sleep_date: String,
    bedtime: Option<String>, wake_time: Option<String>, duration_minutes: Option<i32>,
    nap_count: Option<i32>, nap_minutes: Option<i32>, quality: Option<String>,
    age_months: i32, notes: Option<String>, now: String,
) -> Result<(), String> {
    let conn = get_conn()?.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO sleep_records (recordId, childId, sleepDate, bedtime, wakeTime, durationMinutes, napCount, napMinutes, quality, ageMonths, notes, createdAt) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12) ON CONFLICT(childId, sleepDate) DO UPDATE SET bedtime=excluded.bedtime, wakeTime=excluded.wakeTime, durationMinutes=excluded.durationMinutes, napCount=excluded.napCount, napMinutes=excluded.napMinutes, quality=excluded.quality, notes=excluded.notes",
        params![record_id, child_id, sleep_date, bedtime, wake_time, duration_minutes, nap_count, nap_minutes, quality, age_months, notes, now],
    ).map_err(|e| format!("upsert_sleep_record: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn delete_sleep_record(record_id: String) -> Result<(), String> {
    let conn = get_conn()?.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM sleep_records WHERE recordId = ?1", params![record_id])
        .map_err(|e| format!("delete_sleep_record: {e}"))?;
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

// ── Medical Events ────────────────────────────────────────

fn is_supported_medical_event_type(t: &str) -> bool {
    matches!(t, "visit" | "emergency" | "hospitalization" | "checkup" | "medication" | "other")
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
    event_id: String, child_id: String, event_type: String, title: String,
    event_date: String, end_date: Option<String>, age_months: i32,
    severity: Option<String>, result: Option<String>, hospital: Option<String>,
    medication: Option<String>, dosage: Option<String>, notes: Option<String>,
    photo_path: Option<String>, now: String,
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
    event_id: String, title: String, event_date: String, end_date: Option<String>,
    severity: Option<String>, result: Option<String>, hospital: Option<String>,
    medication: Option<String>, dosage: Option<String>, notes: Option<String>,
    photo_path: Option<String>, now: String,
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
