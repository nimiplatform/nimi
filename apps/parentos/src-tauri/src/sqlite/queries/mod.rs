mod assessments;
mod custom_todos;
mod health_measurements;
mod health_records;
mod journal;
mod reminders;

pub use assessments::*;
pub use custom_todos::*;
pub use health_measurements::*;
pub use health_records::*;
pub use journal::*;
pub use reminders::*;

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
            "../../../../spec/kernel/tables/observation-framework.yaml",
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

pub(crate) fn validate_observation_selection(
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
        .prepare(
            "SELECT familyId, displayName, createdAt, updatedAt
             FROM families
             ORDER BY updatedAt DESC, createdAt DESC
             LIMIT 1",
        )
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
pub fn get_child(child_id: String) -> Result<Option<Child>, String> {
    let conn = get_conn()?.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT childId, familyId, displayName, gender, birthDate, birthWeightKg, birthHeightCm, birthHeadCircCm, avatarPath, nurtureMode, nurtureModeOverrides, allergies, medicalNotes, recorderProfiles, createdAt, updatedAt
             FROM children
             WHERE childId = ?1
             LIMIT 1",
        )
        .map_err(|e| format!("get_child: {e}"))?;
    let result = stmt
        .query_row(params![child_id], |row| {
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

#[cfg(test)]
#[path = "../queries_tests.rs"]
mod tests;
