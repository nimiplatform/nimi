use chrono::{Datelike, NaiveDate};
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

fn detail_outdoor_event_id(record_id: &str) -> String {
    format!("detail-outdoor:{record_id}")
}

fn strip_outdoor_detail_prefix<'a>(value: &'a str, prefix: &str) -> &'a str {
    value.strip_prefix(prefix).unwrap_or(value)
}

fn age_months_at_birth_date(birth_date: &str, activity_date: &str) -> Result<i32, String> {
    let birth = NaiveDate::parse_from_str(birth_date, "%Y-%m-%d")
        .map_err(|e| format!("parse child birthDate for outdoor record: {e}"))?;
    let date = NaiveDate::parse_from_str(activity_date, "%Y-%m-%d")
        .map_err(|e| format!("parse outdoor activityDate: {e}"))?;
    let mut months =
        (date.year() - birth.year()) * 12 + (date.month() as i32 - birth.month() as i32);
    if date.day() < birth.day() {
        months -= 1;
    }
    Ok(months.max(0))
}

#[tauri::command]
pub fn insert_outdoor_record(
    record_id: String,
    child_id: String,
    activity_date: String,
    duration_minutes: i32,
    note: Option<String>,
    now: String,
    linked_reminder_state_id: Option<String>,
    linked_reminder_rule_id: Option<String>,
) -> Result<(), String> {
    if duration_minutes <= 0 {
        return Err("insert_outdoor_record: durationMinutes must be > 0".to_string());
    }
    let mut conn = get_conn()?.lock().map_err(|e| e.to_string())?;
    let birth_date: String = conn
        .query_row(
            "SELECT birthDate FROM children WHERE childId = ?1",
            params![&child_id],
            |row| row.get(0),
        )
        .map_err(|e| format!("insert_outdoor_record query child birthDate: {e}"))?;
    let age_months = age_months_at_birth_date(&birth_date, &activity_date)?;
    let source_surface = if linked_reminder_state_id.is_some() || linked_reminder_rule_id.is_some() {
        "reminder"
    } else {
        "profile_detail"
    };
    let tx = conn
        .transaction()
        .map_err(|e| format!("insert_outdoor_record begin transaction: {e}"))?;
    let event_id = detail_outdoor_event_id(&record_id);
    tx.execute(
        "INSERT INTO health_record_events (
            eventId, childId, protocolId, groupId, recordKind, sourceSurface,
            recordedAt, effectiveDate, ageMonths, linkedReminderStateId, linkedReminderRuleId,
            notes, metadataJson, createdAt, updatedAt
        ) VALUES (?1, ?2, 'outdoor-activity', 'outdoor', 'manual', ?3, ?4, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10)",
        params![
            &event_id,
            &child_id,
            source_surface,
            &activity_date,
            age_months,
            &linked_reminder_state_id,
            &linked_reminder_rule_id,
            &note,
            serde_json::json!({
                "legacyOutdoorRecordApi": true,
                "recordId": record_id,
            })
            .to_string(),
            &now,
        ],
    )
    .map_err(|e| format!("insert_outdoor_record insert health event: {e}"))?;
    tx.execute(
        "INSERT INTO health_record_values (
            valueId, eventId, childId, metricId, valueNumber, unit, recordKind, createdAt
        ) VALUES (?1, ?2, ?3, 'outdoor.activity_minutes', ?4, 'min', 'measured', ?5)",
        params![&record_id, &event_id, &child_id, duration_minutes, &now],
    )
    .map_err(|e| format!("insert_outdoor_record insert health value: {e}"))?;
    tx.commit()
        .map_err(|e| format!("insert_outdoor_record commit: {e}"))?;
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
    let event_id = detail_outdoor_event_id(&record_id);
    let replacement_age_months: Option<i32> = if let Some(date) = activity_date.as_deref() {
        let birth_date: String = conn
            .query_row(
                "SELECT c.birthDate
                 FROM children c
                 JOIN health_record_events e ON e.childId = c.childId
                 WHERE e.eventId = ?1",
                params![&event_id],
                |row| row.get(0),
            )
            .map_err(|e| format!("update_outdoor_record query child birthDate: {e}"))?;
        Some(age_months_at_birth_date(&birth_date, date)?)
    } else {
        None
    };
    let updated_event = conn
        .execute(
            "UPDATE health_record_events
             SET recordedAt = COALESCE(?2, recordedAt),
                 effectiveDate = COALESCE(?2, effectiveDate),
                 ageMonths = COALESCE(?3, ageMonths),
                 notes = ?4,
                 updatedAt = ?5
             WHERE eventId = ?1 AND protocolId = 'outdoor-activity'",
            params![
                &event_id,
                &activity_date,
                replacement_age_months,
                &note,
                &now
            ],
        )
        .map_err(|e| format!("update_outdoor_record update health event: {e}"))?;
    if updated_event == 0 {
        return Err(format!(
            "update_outdoor_record: no record found with id {record_id}"
        ));
    }
    if let Some(minutes) = duration_minutes {
        conn.execute(
            "UPDATE health_record_values
             SET valueNumber = ?2, createdAt = ?3
             WHERE eventId = ?1 AND metricId = 'outdoor.activity_minutes'",
            params![&event_id, minutes, &now],
        )
        .map_err(|e| format!("update_outdoor_record update health value: {e}"))?;
    }
    Ok(())
}

#[tauri::command]
pub fn delete_outdoor_record(record_id: String) -> Result<(), String> {
    let conn = get_conn()?.lock().map_err(|e| e.to_string())?;
    let deleted = conn
        .execute(
            "DELETE FROM health_record_events WHERE eventId = ?1 AND protocolId = 'outdoor-activity'",
            params![detail_outdoor_event_id(&record_id)],
        )
        .map_err(|e| format!("delete_outdoor_record: {e}"))?;
    if deleted == 0 {
        return Err(format!(
            "delete_outdoor_record: no record found with id {record_id}"
        ));
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
            "SELECT e.eventId, e.childId, e.effectiveDate, v.valueNumber, e.notes, e.createdAt, e.updatedAt FROM health_record_events e JOIN health_record_values v ON v.eventId = e.eventId WHERE e.childId = ?1 AND e.protocolId = 'outdoor-activity' AND v.metricId = 'outdoor.activity_minutes' AND e.effectiveDate >= ?2 AND e.effectiveDate <= ?3 ORDER BY e.effectiveDate DESC, e.createdAt DESC".to_string(),
            vec![Box::new(child_id), Box::new(start.clone()), Box::new(end.clone())],
        ),
        (Some(start), None) => (
            "SELECT e.eventId, e.childId, e.effectiveDate, v.valueNumber, e.notes, e.createdAt, e.updatedAt FROM health_record_events e JOIN health_record_values v ON v.eventId = e.eventId WHERE e.childId = ?1 AND e.protocolId = 'outdoor-activity' AND v.metricId = 'outdoor.activity_minutes' AND e.effectiveDate >= ?2 ORDER BY e.effectiveDate DESC, e.createdAt DESC".to_string(),
            vec![Box::new(child_id), Box::new(start.clone())],
        ),
        (None, Some(end)) => (
            "SELECT e.eventId, e.childId, e.effectiveDate, v.valueNumber, e.notes, e.createdAt, e.updatedAt FROM health_record_events e JOIN health_record_values v ON v.eventId = e.eventId WHERE e.childId = ?1 AND e.protocolId = 'outdoor-activity' AND v.metricId = 'outdoor.activity_minutes' AND e.effectiveDate <= ?2 ORDER BY e.effectiveDate DESC, e.createdAt DESC".to_string(),
            vec![Box::new(child_id), Box::new(end.clone())],
        ),
        (None, None) => (
            "SELECT e.eventId, e.childId, e.effectiveDate, v.valueNumber, e.notes, e.createdAt, e.updatedAt FROM health_record_events e JOIN health_record_values v ON v.eventId = e.eventId WHERE e.childId = ?1 AND e.protocolId = 'outdoor-activity' AND v.metricId = 'outdoor.activity_minutes' ORDER BY e.effectiveDate DESC, e.createdAt DESC".to_string(),
            vec![Box::new(child_id)],
        ),
    };

    let params_ref: Vec<&dyn rusqlite::types::ToSql> =
        params_vec.iter().map(|p| p.as_ref()).collect();
    let mut stmt = conn
        .prepare(&sql)
        .map_err(|e| format!("get_outdoor_records: {e}"))?;
    let rows = stmt
        .query_map(params_ref.as_slice(), |row| {
            let event_id: String = row.get(0)?;
            let duration: f64 = row.get(3)?;
            Ok(OutdoorRecord {
                record_id: strip_outdoor_detail_prefix(&event_id, "detail-outdoor:").to_string(),
                child_id: row.get(1)?,
                activity_date: row.get(2)?,
                duration_minutes: duration.round() as i32,
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
        return Err(format!(
            "set_outdoor_goal: no child found with id {child_id}"
        ));
    }
    Ok(())
}
