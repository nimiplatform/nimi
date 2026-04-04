use rusqlite::params;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::sync::OnceLock;

use super::get_conn;

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

fn is_supported_growth_report_type(report_type: &str) -> bool {
    matches!(report_type, "monthly" | "quarterly" | "quarterly-letter")
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

// ── Growth Reports ─────────────────────────────────────────

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

// ── App Settings ───────────────────────────────────────────

#[tauri::command]
pub fn set_app_setting(key: String, value: String, now: String) -> Result<(), String> {
    let conn = get_conn()?.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO app_settings (key, value, updatedAt) VALUES (?1, ?2, ?3) ON CONFLICT(key) DO UPDATE SET value = ?2, updatedAt = ?3",
        params![key, value, now],
    ).map_err(|e| format!("set_app_setting: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn get_app_setting(key: String) -> Result<Option<String>, String> {
    let conn = get_conn()?.lock().map_err(|e| e.to_string())?;
    let result = conn.query_row(
        "SELECT value FROM app_settings WHERE key = ?1",
        params![key],
        |row| row.get(0),
    ).ok();
    Ok(result)
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
    assessment_id: String, child_id: String, assessed_at: String, age_months: i32,
    assessment_source: Option<String>, run_50m: Option<f64>, run_800m: Option<f64>,
    run_1000m: Option<f64>, sit_and_reach: Option<f64>, standing_long_jump: Option<f64>,
    sit_ups: Option<i32>, pull_ups: Option<i32>, rope_skipping: Option<i32>,
    vital_capacity: Option<i32>, foot_arch_status: Option<String>,
    overall_grade: Option<String>, notes: Option<String>, now: String,
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

#[cfg(test)]
mod tests {
    use super::{validate_observation_selection, JournalTagInput};

    #[test]
    fn rejects_unknown_dimension_id() {
        let result = validate_observation_selection(Some("PO-OBS-UNKNOWN"), None, &[]);
        assert!(result
            .expect_err("expected unknown dimensionId to fail")
            .contains("unsupported journal observation dimensionId"));
    }

    #[test]
    fn rejects_tags_without_dimension_id() {
        let result = validate_observation_selection(None, Some("[\"Deep focus\"]"), &[]);
        assert!(result
            .expect_err("expected tags without dimensionId to fail")
            .contains("require a dimensionId"));
    }

    #[test]
    fn rejects_ai_tags_outside_the_dimension_quick_tag_set() {
        let ai_tags = vec![JournalTagInput {
            tag_id: "tag-1".to_string(),
            domain: "observation".to_string(),
            tag: "Invented tag".to_string(),
            source: "ai".to_string(),
            confidence: Some(0.6),
        }];

        let result = validate_observation_selection(
            Some("PO-OBS-CONC-001"),
            Some("[\"深度专注\"]"),
            &ai_tags,
        );

        assert!(result
            .expect_err("expected unsupported AI tag to fail")
            .contains("unsupported journal AI tag"));
    }

    #[test]
    fn accepts_supported_dimension_and_tags() {
        let ai_tags = vec![JournalTagInput {
            tag_id: "tag-1".to_string(),
            domain: "observation".to_string(),
            tag: "深度专注".to_string(),
            source: "ai".to_string(),
            confidence: Some(0.8),
        }];

        validate_observation_selection(
            Some("PO-OBS-CONC-001"),
            Some("[\"深度专注\",\"反复操作\"]"),
            &ai_tags,
        )
        .expect("expected supported tags to pass");
    }
}
