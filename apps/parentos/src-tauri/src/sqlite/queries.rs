use rusqlite::params;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::sync::OnceLock;

use super::get_conn;

#[path = "queries_health.rs"]
mod queries_health;

pub use queries_health::*;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ObservationFrameworkSpec {
    dimensions: Vec<ObservationDimensionSpec>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ObservationDimensionSpec {
    dimension_id: String,
    #[serde(default)]
    quick_tags: Vec<String>,
}

#[derive(Debug)]
struct ObservationVocabulary {
    quick_tags_by_dimension: HashMap<String, HashSet<String>>,
}

static OBSERVATION_VOCABULARY: OnceLock<Result<ObservationVocabulary, String>> = OnceLock::new();

fn get_observation_vocabulary() -> Result<&'static ObservationVocabulary, String> {
    let loaded = OBSERVATION_VOCABULARY.get_or_init(|| {
        let spec: ObservationFrameworkSpec = serde_yaml::from_str(include_str!(
            "../../../spec/kernel/tables/observation-framework.yaml",
        ))
        .map_err(|e| format!("parse observation-framework.yaml: {e}"))?;

        let quick_tags_by_dimension = spec
            .dimensions
            .into_iter()
            .map(|dimension| {
                let tags = dimension.quick_tags.into_iter().collect::<HashSet<_>>();
                (dimension.dimension_id, tags)
            })
            .collect::<HashMap<_, _>>();

        Ok(ObservationVocabulary {
            quick_tags_by_dimension,
        })
    });

    match loaded {
        Ok(vocabulary) => Ok(vocabulary),
        Err(error) => Err(error.clone()),
    }
}

fn parse_string_array_field(field_name: &str, raw: Option<&str>) -> Result<Vec<String>, String> {
    let Some(raw) = raw.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(Vec::new());
    };

    let parsed = serde_json::from_str::<Vec<String>>(raw)
        .map_err(|e| format!("invalid {field_name} JSON array: {e}"))?;

    Ok(parsed
        .into_iter()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .collect())
}

fn validate_observation_selection(
    dimension_id: Option<&str>, selected_tags: Option<&str>, ai_tags: &[JournalTagInput],
) -> Result<(), String> {
    let vocabulary = get_observation_vocabulary()?;
    let normalized_dimension_id = dimension_id.map(str::trim).filter(|value| !value.is_empty());
    let selected_tags = parse_string_array_field("selectedTags", selected_tags)?;

    if normalized_dimension_id.is_none() && (!selected_tags.is_empty() || !ai_tags.is_empty()) {
        return Err("journal observation tags require a dimensionId".to_string());
    }

    let Some(dimension_id) = normalized_dimension_id else {
        return Ok(());
    };

    let allowed_tags = vocabulary
        .quick_tags_by_dimension
        .get(dimension_id)
        .ok_or_else(|| format!("unsupported journal observation dimensionId \"{dimension_id}\""))?;

    for tag in &selected_tags {
        if !allowed_tags.contains(tag) {
            return Err(format!(
                "unsupported selectedTags value \"{tag}\" for dimensionId \"{dimension_id}\"",
            ));
        }
    }

    for tag in ai_tags {
        if tag.domain != "observation" {
            return Err(format!(
                "unsupported journal AI tag domain \"{}\" for dimensionId \"{dimension_id}\"",
                tag.domain,
            ));
        }

        if !allowed_tags.contains(tag.tag.trim()) {
            return Err(format!(
                "unsupported journal AI tag \"{}\" for dimensionId \"{dimension_id}\"",
                tag.tag,
            ));
        }
    }

    Ok(())
}

// ── Family & Children ──────────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Family {
    pub family_id: String,
    pub display_name: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Child {
    pub child_id: String,
    pub family_id: String,
    pub display_name: String,
    pub gender: String,
    pub birth_date: String,
    pub birth_weight_kg: Option<f64>,
    pub birth_height_cm: Option<f64>,
    pub birth_head_circ_cm: Option<f64>,
    pub avatar_path: Option<String>,
    pub nurture_mode: String,
    pub nurture_mode_overrides: Option<String>,
    pub allergies: Option<String>,
    pub medical_notes: Option<String>,
    pub recorder_profiles: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[tauri::command]
pub fn create_family(family_id: String, display_name: String, now: String) -> Result<(), String> {
    let conn = get_conn()?.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO families (familyId, displayName, createdAt, updatedAt) VALUES (?1, ?2, ?3, ?3)",
        params![family_id, display_name, now],
    )
    .map_err(|e| format!("create_family: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn get_family() -> Result<Option<Family>, String> {
    let conn = get_conn()?.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT familyId, displayName, createdAt, updatedAt FROM families LIMIT 1")
        .map_err(|e| format!("get_family: {e}"))?;
    let result = stmt
        .query_row([], |row| {
            Ok(Family {
                family_id: row.get(0)?,
                display_name: row.get(1)?,
                created_at: row.get(2)?,
                updated_at: row.get(3)?,
            })
        })
        .ok();
    Ok(result)
}

#[tauri::command]
pub fn create_child(
    child_id: String, family_id: String, display_name: String, gender: String,
    birth_date: String, birth_weight_kg: Option<f64>, birth_height_cm: Option<f64>,
    birth_head_circ_cm: Option<f64>, avatar_path: Option<String>, nurture_mode: String,
    nurture_mode_overrides: Option<String>, allergies: Option<String>,
    medical_notes: Option<String>, recorder_profiles: Option<String>, now: String,
) -> Result<(), String> {
    let conn = get_conn()?.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO children (childId, familyId, displayName, gender, birthDate, birthWeightKg, birthHeightCm, birthHeadCircCm, avatarPath, nurtureMode, nurtureModeOverrides, allergies, medicalNotes, recorderProfiles, createdAt, updatedAt) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?15)",
        params![
            child_id, family_id, display_name, gender, birth_date, birth_weight_kg,
            birth_height_cm, birth_head_circ_cm, avatar_path, nurture_mode,
            nurture_mode_overrides, allergies, medical_notes, recorder_profiles, now
        ],
    )
    .map_err(|e| format!("create_child: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn get_children(family_id: String) -> Result<Vec<Child>, String> {
    let conn = get_conn()?.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT childId, familyId, displayName, gender, birthDate, birthWeightKg, birthHeightCm, birthHeadCircCm, avatarPath, nurtureMode, nurtureModeOverrides, allergies, medicalNotes, recorderProfiles, createdAt, updatedAt FROM children WHERE familyId = ?1 ORDER BY birthDate")
        .map_err(|e| format!("get_children: {e}"))?;
    let rows = stmt
        .query_map(params![family_id], |row| {
            Ok(Child {
                child_id: row.get(0)?,
                family_id: row.get(1)?,
                display_name: row.get(2)?,
                gender: row.get(3)?,
                birth_date: row.get(4)?,
                birth_weight_kg: row.get(5)?,
                birth_height_cm: row.get(6)?,
                birth_head_circ_cm: row.get(7)?,
                avatar_path: row.get(8)?,
                nurture_mode: row.get(9)?,
                nurture_mode_overrides: row.get(10)?,
                allergies: row.get(11)?,
                medical_notes: row.get(12)?,
                recorder_profiles: row.get(13)?,
                created_at: row.get(14)?,
                updated_at: row.get(15)?,
            })
        })
        .map_err(|e| format!("get_children: {e}"))?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("get_children collect: {e}"))
}

#[tauri::command]
pub fn update_child(
    child_id: String, display_name: String, gender: String, birth_date: String,
    birth_weight_kg: Option<f64>, birth_height_cm: Option<f64>, birth_head_circ_cm: Option<f64>,
    avatar_path: Option<String>, nurture_mode: String, nurture_mode_overrides: Option<String>,
    allergies: Option<String>, medical_notes: Option<String>, recorder_profiles: Option<String>,
    now: String,
) -> Result<(), String> {
    let conn = get_conn()?.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE children SET displayName = ?2, gender = ?3, birthDate = ?4, birthWeightKg = ?5, birthHeightCm = ?6, birthHeadCircCm = ?7, avatarPath = ?8, nurtureMode = ?9, nurtureModeOverrides = ?10, allergies = ?11, medicalNotes = ?12, recorderProfiles = ?13, updatedAt = ?14 WHERE childId = ?1",
        params![
            child_id, display_name, gender, birth_date, birth_weight_kg, birth_height_cm,
            birth_head_circ_cm, avatar_path, nurture_mode, nurture_mode_overrides, allergies,
            medical_notes, recorder_profiles, now
        ],
    )
    .map_err(|e| format!("update_child: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn delete_child(child_id: String) -> Result<(), String> {
    let conn = get_conn()?.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM children WHERE childId = ?1", params![child_id])
        .map_err(|e| format!("delete_child: {e}"))?;
    Ok(())
}

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

// ── Reminder States ────────────────────────────────────────

#[tauri::command]
pub fn upsert_reminder_state(
    state_id: String, child_id: String, rule_id: String, status: String,
    activated_at: Option<String>, completed_at: Option<String>, dismissed_at: Option<String>,
    dismiss_reason: Option<String>, repeat_index: i32, next_trigger_at: Option<String>,
    notes: Option<String>, now: String,
) -> Result<(), String> {
    let conn = get_conn()?.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO reminder_states (stateId, childId, ruleId, status, activatedAt, completedAt, dismissedAt, dismissReason, repeatIndex, nextTriggerAt, notes, createdAt, updatedAt) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?12) ON CONFLICT(childId, ruleId, repeatIndex) DO UPDATE SET status=?4, activatedAt=?5, completedAt=?6, dismissedAt=?7, dismissReason=?8, nextTriggerAt=?10, notes=?11, updatedAt=?12",
        params![state_id, child_id, rule_id, status, activated_at, completed_at, dismissed_at, dismiss_reason, repeat_index, next_trigger_at, notes, now],
    )
    .map_err(|e| format!("upsert_reminder_state: {e}"))?;
    Ok(())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReminderStateRecord {
    pub state_id: String,
    pub child_id: String,
    pub rule_id: String,
    pub status: String,
    pub activated_at: Option<String>,
    pub completed_at: Option<String>,
    pub dismissed_at: Option<String>,
    pub dismiss_reason: Option<String>,
    pub repeat_index: i32,
    pub next_trigger_at: Option<String>,
    pub notes: Option<String>,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
}

#[tauri::command]
pub fn get_reminder_states(child_id: String) -> Result<Vec<ReminderStateRecord>, String> {
    let conn = get_conn()?.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare("SELECT stateId, childId, ruleId, status, activatedAt, completedAt, dismissedAt, dismissReason, repeatIndex, nextTriggerAt, notes, createdAt, updatedAt FROM reminder_states WHERE childId = ?1 ORDER BY updatedAt DESC").map_err(|e| format!("get_reminder_states: {e}"))?;
    let rows = stmt.query_map(params![child_id], |row| {
        Ok(ReminderStateRecord {
            state_id: row.get(0)?,
            child_id: row.get(1)?,
            rule_id: row.get(2)?,
            status: row.get(3)?,
            activated_at: row.get(4)?,
            completed_at: row.get(5)?,
            dismissed_at: row.get(6)?,
            dismiss_reason: row.get(7)?,
            repeat_index: row.get(8)?,
            next_trigger_at: row.get(9)?,
            notes: row.get(10)?,
            created_at: row.get(11)?,
            updated_at: row.get(12)?,
        })
    }).map_err(|e| format!("get_reminder_states: {e}"))?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| format!("get_reminder_states collect: {e}"))
}

#[tauri::command]
pub fn get_active_reminders(child_id: String) -> Result<Vec<ReminderStateRecord>, String> {
    let conn = get_conn()?.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare("SELECT stateId, childId, ruleId, status, activatedAt, nextTriggerAt, repeatIndex, notes FROM reminder_states WHERE childId = ?1 AND status IN ('pending', 'active', 'overdue') ORDER BY nextTriggerAt").map_err(|e| format!("get_active_reminders: {e}"))?;
    let rows = stmt.query_map(params![child_id], |row| {
        Ok(ReminderStateRecord {
            state_id: row.get(0)?,
            child_id: row.get(1)?,
            rule_id: row.get(2)?,
            status: row.get(3)?,
            activated_at: row.get(4)?,
            completed_at: None,
            dismissed_at: None,
            dismiss_reason: None,
            repeat_index: row.get(6)?,
            next_trigger_at: row.get(5)?,
            notes: row.get(7)?,
            created_at: None,
            updated_at: None,
        })
    }).map_err(|e| format!("get_active_reminders: {e}"))?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| format!("get_active_reminders collect: {e}"))
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

// ── Journal Entries ────────────────────────────────────────

#[tauri::command]
pub fn insert_journal_entry(
    entry_id: String, child_id: String, content_type: String, text_content: Option<String>,
    voice_path: Option<String>, photo_paths: Option<String>, recorded_at: String, age_months: i32,
    observation_mode: Option<String>, dimension_id: Option<String>, selected_tags: Option<String>,
    guided_answers: Option<String>, observation_duration: Option<i32>,
    keepsake: i32, recorder_id: Option<String>, now: String,
) -> Result<(), String> {
    validate_observation_selection(
        dimension_id.as_deref(),
        selected_tags.as_deref(),
        &[],
    )?;

    let conn = get_conn()?.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO journal_entries (entryId, childId, contentType, textContent, voicePath, photoPaths, recordedAt, ageMonths, observationMode, dimensionId, selectedTags, guidedAnswers, observationDuration, keepsake, recorderId, createdAt, updatedAt) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?16)",
        params![entry_id, child_id, content_type, text_content, voice_path, photo_paths, recorded_at, age_months, observation_mode, dimension_id, selected_tags, guided_answers, observation_duration, keepsake, recorder_id, now],
    )
    .map_err(|e| format!("insert_journal_entry: {e}"))?;
    Ok(())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JournalTagInput {
    pub tag_id: String,
    pub domain: String,
    pub tag: String,
    pub source: String,
    pub confidence: Option<f64>,
}

#[tauri::command]
pub fn insert_journal_entry_with_tags(
    entry_id: String, child_id: String, content_type: String, text_content: Option<String>,
    voice_path: Option<String>, photo_paths: Option<String>, recorded_at: String, age_months: i32,
    observation_mode: Option<String>, dimension_id: Option<String>, selected_tags: Option<String>,
    guided_answers: Option<String>, observation_duration: Option<i32>,
    keepsake: i32, recorder_id: Option<String>, ai_tags: Vec<JournalTagInput>, now: String,
) -> Result<(), String> {
    validate_observation_selection(
        dimension_id.as_deref(),
        selected_tags.as_deref(),
        &ai_tags,
    )?;

    let mut conn = get_conn()?.lock().map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| format!("insert_journal_entry_with_tags tx: {e}"))?;

    tx.execute(
        "INSERT INTO journal_entries (entryId, childId, contentType, textContent, voicePath, photoPaths, recordedAt, ageMonths, observationMode, dimensionId, selectedTags, guidedAnswers, observationDuration, keepsake, recorderId, createdAt, updatedAt) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?16)",
        params![entry_id, child_id, content_type, text_content, voice_path, photo_paths, recorded_at, age_months, observation_mode, dimension_id, selected_tags, guided_answers, observation_duration, keepsake, recorder_id, now],
    ).map_err(|e| format!("insert_journal_entry_with_tags entry: {e}"))?;

    for tag in ai_tags {
        tx.execute(
            "INSERT INTO journal_tags (tagId, entryId, domain, tag, source, confidence, createdAt) VALUES (?1,?2,?3,?4,?5,?6,?7)",
            params![tag.tag_id, entry_id, tag.domain, tag.tag, tag.source, tag.confidence, now],
        ).map_err(|e| format!("insert_journal_entry_with_tags tag: {e}"))?;
    }

    tx.commit().map_err(|e| format!("insert_journal_entry_with_tags commit: {e}"))?;
    Ok(())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JournalEntry {
    pub entry_id: String,
    pub child_id: String,
    pub content_type: String,
    pub text_content: Option<String>,
    pub voice_path: Option<String>,
    pub photo_paths: Option<String>,
    pub recorded_at: String,
    pub age_months: i32,
    pub observation_mode: Option<String>,
    pub dimension_id: Option<String>,
    pub selected_tags: Option<String>,
    pub guided_answers: Option<String>,
    pub observation_duration: Option<i32>,
    pub keepsake: i32,
    pub recorder_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[tauri::command]
pub fn get_journal_entries(child_id: String, limit: Option<i32>) -> Result<Vec<JournalEntry>, String> {
    let conn = get_conn()?.lock().map_err(|e| e.to_string())?;
    let lim = limit.unwrap_or(50);
    let mut stmt = conn.prepare("SELECT entryId, childId, contentType, textContent, voicePath, photoPaths, recordedAt, ageMonths, observationMode, dimensionId, selectedTags, guidedAnswers, observationDuration, keepsake, recorderId, createdAt, updatedAt FROM journal_entries WHERE childId = ?1 ORDER BY recordedAt DESC LIMIT ?2").map_err(|e| format!("get_journal_entries: {e}"))?;
    let rows = stmt.query_map(params![child_id, lim], |row| {
        Ok(JournalEntry {
            entry_id: row.get(0)?,
            child_id: row.get(1)?,
            content_type: row.get(2)?,
            text_content: row.get(3)?,
            voice_path: row.get(4)?,
            photo_paths: row.get(5)?,
            recorded_at: row.get(6)?,
            age_months: row.get(7)?,
            observation_mode: row.get(8)?,
            dimension_id: row.get(9)?,
            selected_tags: row.get(10)?,
            guided_answers: row.get(11)?,
            observation_duration: row.get(12)?,
            keepsake: row.get(13)?,
            recorder_id: row.get(14)?,
            created_at: row.get(15)?,
            updated_at: row.get(16)?,
        })
    }).map_err(|e| format!("get_journal_entries: {e}"))?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| format!("get_journal_entries collect: {e}"))
}

#[tauri::command]
pub fn insert_journal_tag(tag_id: String, entry_id: String, domain: String, tag: String, source: String, confidence: Option<f64>, now: String) -> Result<(), String> {
    let conn = get_conn()?.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO journal_tags (tagId, entryId, domain, tag, source, confidence, createdAt) VALUES (?1,?2,?3,?4,?5,?6,?7)",
        params![tag_id, entry_id, domain, tag, source, confidence, now],
    ).map_err(|e| format!("insert_journal_tag: {e}"))?;
    Ok(())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JournalTag {
    pub tag_id: String,
    pub entry_id: String,
    pub domain: String,
    pub tag: String,
    pub source: String,
    pub confidence: Option<f64>,
    pub created_at: String,
}

#[tauri::command]
pub fn get_journal_tags(entry_id: String) -> Result<Vec<JournalTag>, String> {
    let conn = get_conn()?.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare("SELECT tagId, entryId, domain, tag, source, confidence, createdAt FROM journal_tags WHERE entryId = ?1").map_err(|e| format!("get_journal_tags: {e}"))?;
    let rows = stmt.query_map(params![entry_id], |row| {
        Ok(JournalTag {
            tag_id: row.get(0)?,
            entry_id: row.get(1)?,
            domain: row.get(2)?,
            tag: row.get(3)?,
            source: row.get(4)?,
            confidence: row.get(5)?,
            created_at: row.get(6)?,
        })
    }).map_err(|e| format!("get_journal_tags: {e}"))?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| format!("get_journal_tags collect: {e}"))
}

// ── AI Conversations ───────────────────────────────────────

#[tauri::command]
pub fn create_conversation(conversation_id: String, child_id: String, title: Option<String>, now: String) -> Result<(), String> {
    let conn = get_conn()?.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO ai_conversations (conversationId, childId, title, startedAt, lastMessageAt, messageCount, createdAt) VALUES (?1,?2,?3,?4,?4,0,?4)",
        params![conversation_id, child_id, title, now],
    ).map_err(|e| format!("create_conversation: {e}"))?;
    Ok(())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Conversation {
    pub conversation_id: String,
    pub child_id: String,
    pub title: Option<String>,
    pub started_at: String,
    pub last_message_at: String,
    pub message_count: i32,
    pub created_at: String,
}

#[tauri::command]
pub fn get_conversations(child_id: String) -> Result<Vec<Conversation>, String> {
    let conn = get_conn()?.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare("SELECT conversationId, childId, title, startedAt, lastMessageAt, messageCount, createdAt FROM ai_conversations WHERE childId = ?1 ORDER BY lastMessageAt DESC").map_err(|e| format!("get_conversations: {e}"))?;
    let rows = stmt.query_map(params![child_id], |row| {
        Ok(Conversation {
            conversation_id: row.get(0)?,
            child_id: row.get(1)?,
            title: row.get(2)?,
            started_at: row.get(3)?,
            last_message_at: row.get(4)?,
            message_count: row.get(5)?,
            created_at: row.get(6)?,
        })
    }).map_err(|e| format!("get_conversations: {e}"))?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| format!("get_conversations collect: {e}"))
}

#[tauri::command]
pub fn insert_ai_message(message_id: String, conversation_id: String, role: String, content: String, context_snapshot: Option<String>, now: String) -> Result<(), String> {
    let conn = get_conn()?.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO ai_messages (messageId, conversationId, role, content, contextSnapshot, createdAt) VALUES (?1,?2,?3,?4,?5,?6)",
        params![message_id, conversation_id, role, content, context_snapshot, now],
    ).map_err(|e| format!("insert_ai_message: {e}"))?;
    conn.execute(
        "UPDATE ai_conversations SET lastMessageAt = ?2, messageCount = messageCount + 1 WHERE conversationId = ?1",
        params![conversation_id, now],
    ).map_err(|e| format!("update conversation: {e}"))?;
    Ok(())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiMessage {
    pub message_id: String,
    pub conversation_id: String,
    pub role: String,
    pub content: String,
    pub context_snapshot: Option<String>,
    pub created_at: String,
}

#[tauri::command]
pub fn get_ai_messages(conversation_id: String) -> Result<Vec<AiMessage>, String> {
    let conn = get_conn()?.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare("SELECT messageId, conversationId, role, content, contextSnapshot, createdAt FROM ai_messages WHERE conversationId = ?1 ORDER BY createdAt").map_err(|e| format!("get_ai_messages: {e}"))?;
    let rows = stmt.query_map(params![conversation_id], |row| {
        Ok(AiMessage {
            message_id: row.get(0)?,
            conversation_id: row.get(1)?,
            role: row.get(2)?,
            content: row.get(3)?,
            context_snapshot: row.get(4)?,
            created_at: row.get(5)?,
        })
    }).map_err(|e| format!("get_ai_messages: {e}"))?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| format!("get_ai_messages collect: {e}"))
}

#[cfg(test)]
#[path = "queries_tests.rs"]
mod tests;
