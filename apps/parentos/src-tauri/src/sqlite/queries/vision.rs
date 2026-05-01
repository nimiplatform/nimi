use rusqlite::{params, OptionalExtension};
use serde::Serialize;

use super::super::get_conn;

/// Per-child vision follow-up cadence configuration.
///
/// Mirrors `vision_followup_settings` in `spec/kernel/tables/local-storage.yaml`.
/// Returned to the renderer as camelCase JSON.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VisionFollowupSettings {
    pub child_id: String,
    pub cadence_months: i32,
    pub custom_next_date: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

const MIN_CADENCE_MONTHS: i32 = 1;
const MAX_CADENCE_MONTHS: i32 = 36;

/// Read the current settings row for a child, or None when no row exists yet
/// (the renderer interprets None as "use system-recommended cadence").
#[tauri::command]
pub fn get_vision_followup_settings(
    child_id: String,
) -> Result<Option<VisionFollowupSettings>, String> {
    let conn = get_conn()?.lock().map_err(|e| e.to_string())?;
    let result = conn
        .query_row(
            "SELECT childId, cadenceMonths, customNextDate, createdAt, updatedAt
             FROM vision_followup_settings
             WHERE childId = ?1",
            params![child_id],
            |row| {
                Ok(VisionFollowupSettings {
                    child_id: row.get(0)?,
                    cadence_months: row.get(1)?,
                    custom_next_date: row.get(2)?,
                    created_at: row.get(3)?,
                    updated_at: row.get(4)?,
                })
            },
        )
        .optional()
        .map_err(|e| format!("get_vision_followup_settings: {e}"))?;
    Ok(result)
}

/// Upsert the settings row for a child. `cadence_months` is required and
/// validated to the [1, 36] range; `custom_next_date` is an optional ISO 8601
/// date that overrides only the next visit (callers pass None to clear it).
#[tauri::command]
pub fn set_vision_followup_settings(
    child_id: String,
    cadence_months: i32,
    custom_next_date: Option<String>,
    now: String,
) -> Result<(), String> {
    if cadence_months < MIN_CADENCE_MONTHS || cadence_months > MAX_CADENCE_MONTHS {
        return Err(format!(
            "set_vision_followup_settings: cadenceMonths must be between {MIN_CADENCE_MONTHS} and {MAX_CADENCE_MONTHS}, got {cadence_months}"
        ));
    }
    if let Some(ref date) = custom_next_date {
        validate_iso_date(date)?;
    }
    let conn = get_conn()?.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO vision_followup_settings (childId, cadenceMonths, customNextDate, createdAt, updatedAt)
         VALUES (?1, ?2, ?3, ?4, ?4)
         ON CONFLICT(childId) DO UPDATE SET
            cadenceMonths = excluded.cadenceMonths,
            customNextDate = excluded.customNextDate,
            updatedAt = excluded.updatedAt",
        params![child_id, cadence_months, custom_next_date, now],
    )
    .map_err(|e| format!("set_vision_followup_settings: {e}"))?;
    Ok(())
}

/// Delete the settings row, reverting the child to the system-recommended
/// cadence on the next read. Idempotent — succeeds even if no row exists.
#[tauri::command]
pub fn clear_vision_followup_settings(child_id: String) -> Result<(), String> {
    let conn = get_conn()?.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM vision_followup_settings WHERE childId = ?1",
        params![child_id],
    )
    .map_err(|e| format!("clear_vision_followup_settings: {e}"))?;
    Ok(())
}

fn validate_iso_date(date: &str) -> Result<(), String> {
    fn invalid_date_error(date: &str) -> String {
        format!("set_vision_followup_settings: customNextDate must be ISO 8601 YYYY-MM-DD, got '{date}'")
    }

    if date.len() != 10 {
        return Err(invalid_date_error(date));
    }
    let bytes = date.as_bytes();
    let digit_at = |idx: usize| -> bool { bytes.get(idx).map(|b| b.is_ascii_digit()).unwrap_or(false) };
    let dash_at = |idx: usize| -> bool { bytes.get(idx).copied() == Some(b'-') };
    let shape_ok = digit_at(0)
        && digit_at(1)
        && digit_at(2)
        && digit_at(3)
        && dash_at(4)
        && digit_at(5)
        && digit_at(6)
        && dash_at(7)
        && digit_at(8)
        && digit_at(9);
    if !shape_ok {
        return Err(invalid_date_error(date));
    }
    if chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d").is_err() {
        return Err(invalid_date_error(date));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::validate_iso_date;

    #[test]
    fn validate_iso_date_rejects_invalid_calendar_dates() {
        assert!(validate_iso_date("2026-02-28").is_ok());
        assert!(validate_iso_date("2026-02-30").is_err());
        assert!(validate_iso_date("2026-13-01").is_err());
        assert!(validate_iso_date("2026/02/28").is_err());
    }
}
