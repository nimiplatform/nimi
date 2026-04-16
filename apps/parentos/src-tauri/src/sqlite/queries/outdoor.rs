use rusqlite::params;
use serde::Serialize;

use super::super::get_conn;

// ── Outdoor Records ──────────────────────────────────────

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OutdoorRecord {
    pub record_id: String,
    pub child_id: String,
    pub activity_date: String,
    pub duration_minutes: i32,
    pub note: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[tauri::command]
pub fn insert_outdoor_record(
    record_id: String,
    child_id: String,
    activity_date: String,
    duration_minutes: i32,
    note: Option<String>,
    now: String,
) -> Result<(), String> {
    if duration_minutes <= 0 {
        return Err("insert_outdoor_record: durationMinutes must be > 0".to_string());
    }
    let conn = get_conn()?.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO outdoor_records (recordId, childId, activityDate, durationMinutes, note, createdAt, updatedAt) VALUES (?1,?2,?3,?4,?5,?6,?6)",
        params![record_id, child_id, activity_date, duration_minutes, note, now],
    )
    .map_err(|e| format!("insert_outdoor_record: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn update_outdoor_record(
    record_id: String,
    activity_date: Option<String>,
    duration_minutes: Option<i32>,
    note: Option<String>,
    now: String,
) -> Result<(), String> {
    if let Some(minutes) = duration_minutes {
        if minutes <= 0 {
            return Err("update_outdoor_record: durationMinutes must be > 0".to_string());
        }
    }
    let conn = get_conn()?.lock().map_err(|e| e.to_string())?;

    // Build SET clauses dynamically for partial update
    let mut sets = vec!["updatedAt = ?2"];
    let mut param_idx: usize = 3;
    if activity_date.is_some() {
        sets.push("activityDate = ?3");
        param_idx = 4;
    }
    if duration_minutes.is_some() {
        let clause = if param_idx == 3 { "durationMinutes = ?3" } else { "durationMinutes = ?4" };
        sets.push(clause);
        param_idx += 1;
    }
    // note is always settable (can be set to NULL)
    let note_clause = match param_idx {
        3 => "note = ?3",
        4 => "note = ?4",
        _ => "note = ?5",
    };
    sets.push(note_clause);

    let sql = format!("UPDATE outdoor_records SET {} WHERE recordId = ?1", sets.join(", "));

    // Build params in order: recordId, now, then optional fields
    let mut param_values: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();
    param_values.push(Box::new(record_id.clone()));
    param_values.push(Box::new(now));
    if let Some(date) = activity_date {
        param_values.push(Box::new(date));
    }
    if let Some(minutes) = duration_minutes {
        param_values.push(Box::new(minutes));
    }
    param_values.push(Box::new(note));

    let params_ref: Vec<&dyn rusqlite::types::ToSql> = param_values.iter().map(|p| p.as_ref()).collect();

    let updated = conn
        .execute(&sql, params_ref.as_slice())
        .map_err(|e| format!("update_outdoor_record: {e}"))?;

    if updated == 0 {
        return Err(format!("update_outdoor_record: no record found with id {record_id}"));
    }
    Ok(())
}

#[tauri::command]
pub fn delete_outdoor_record(record_id: String) -> Result<(), String> {
    let conn = get_conn()?.lock().map_err(|e| e.to_string())?;
    let deleted = conn
        .execute("DELETE FROM outdoor_records WHERE recordId = ?1", params![record_id])
        .map_err(|e| format!("delete_outdoor_record: {e}"))?;
    if deleted == 0 {
        return Err(format!("delete_outdoor_record: no record found with id {record_id}"));
    }
    Ok(())
}

#[tauri::command]
pub fn get_outdoor_records(
    child_id: String,
    start_date: Option<String>,
    end_date: Option<String>,
) -> Result<Vec<OutdoorRecord>, String> {
    let conn = get_conn()?.lock().map_err(|e| e.to_string())?;

    let (sql, params_vec): (String, Vec<Box<dyn rusqlite::types::ToSql>>) = match (&start_date, &end_date) {
        (Some(start), Some(end)) => (
            "SELECT recordId, childId, activityDate, durationMinutes, note, createdAt, updatedAt FROM outdoor_records WHERE childId = ?1 AND activityDate >= ?2 AND activityDate <= ?3 ORDER BY activityDate DESC, createdAt DESC".to_string(),
            vec![Box::new(child_id), Box::new(start.clone()), Box::new(end.clone())],
        ),
        (Some(start), None) => (
            "SELECT recordId, childId, activityDate, durationMinutes, note, createdAt, updatedAt FROM outdoor_records WHERE childId = ?1 AND activityDate >= ?2 ORDER BY activityDate DESC, createdAt DESC".to_string(),
            vec![Box::new(child_id), Box::new(start.clone())],
        ),
        (None, Some(end)) => (
            "SELECT recordId, childId, activityDate, durationMinutes, note, createdAt, updatedAt FROM outdoor_records WHERE childId = ?1 AND activityDate <= ?2 ORDER BY activityDate DESC, createdAt DESC".to_string(),
            vec![Box::new(child_id), Box::new(end.clone())],
        ),
        (None, None) => (
            "SELECT recordId, childId, activityDate, durationMinutes, note, createdAt, updatedAt FROM outdoor_records WHERE childId = ?1 ORDER BY activityDate DESC, createdAt DESC".to_string(),
            vec![Box::new(child_id)],
        ),
    };

    let params_ref: Vec<&dyn rusqlite::types::ToSql> = params_vec.iter().map(|p| p.as_ref()).collect();
    let mut stmt = conn.prepare(&sql).map_err(|e| format!("get_outdoor_records: {e}"))?;
    let rows = stmt
        .query_map(params_ref.as_slice(), |row| {
            Ok(OutdoorRecord {
                record_id: row.get(0)?,
                child_id: row.get(1)?,
                activity_date: row.get(2)?,
                duration_minutes: row.get(3)?,
                note: row.get(4)?,
                created_at: row.get(5)?,
                updated_at: row.get(6)?,
            })
        })
        .map_err(|e| format!("get_outdoor_records: {e}"))?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("get_outdoor_records collect: {e}"))
}

#[tauri::command]
pub fn get_outdoor_goal(child_id: String) -> Result<Option<i32>, String> {
    let conn = get_conn()?.lock().map_err(|e| e.to_string())?;
    let result = conn
        .query_row(
            "SELECT outdoorGoalMinutes FROM children WHERE childId = ?1",
            params![child_id],
            |row| row.get(0),
        )
        .map_err(|e| format!("get_outdoor_goal: {e}"))?;
    Ok(result)
}

#[tauri::command]
pub fn set_outdoor_goal(child_id: String, goal_minutes: i32, now: String) -> Result<(), String> {
    if goal_minutes <= 0 {
        return Err("set_outdoor_goal: goalMinutes must be > 0".to_string());
    }
    let conn = get_conn()?.lock().map_err(|e| e.to_string())?;
    let updated = conn
        .execute(
            "UPDATE children SET outdoorGoalMinutes = ?2, updatedAt = ?3 WHERE childId = ?1",
            params![child_id, goal_minutes, now],
        )
        .map_err(|e| format!("set_outdoor_goal: {e}"))?;
    if updated == 0 {
        return Err(format!("set_outdoor_goal: no child found with id {child_id}"));
    }
    Ok(())
}
