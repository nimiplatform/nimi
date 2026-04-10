use rusqlite::params;
use serde::Serialize;

use super::super::get_conn;

// ── Reminder States ────────────────────────────────────────

#[tauri::command]
pub fn upsert_reminder_state(
    state_id: String, child_id: String, rule_id: String, status: String,
    activated_at: Option<String>, completed_at: Option<String>, dismissed_at: Option<String>,
    dismiss_reason: Option<String>, repeat_index: i32, next_trigger_at: Option<String>,
    snoozed_until: Option<String>, scheduled_date: Option<String>, not_applicable: i32,
    planned_for_date: Option<String>, surface_rank: Option<i32>, last_surfaced_at: Option<String>,
    surface_count: i32, notes: Option<String>, now: String,
) -> Result<(), String> {
    let conn = get_conn()?.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO reminder_states (stateId, childId, ruleId, status, activatedAt, completedAt, dismissedAt, dismissReason, repeatIndex, nextTriggerAt, snoozedUntil, scheduledDate, notApplicable, plannedForDate, surfaceRank, lastSurfacedAt, surfaceCount, notes, createdAt, updatedAt) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?19) ON CONFLICT(childId, ruleId, repeatIndex) DO UPDATE SET status=?4, activatedAt=?5, completedAt=?6, dismissedAt=?7, dismissReason=?8, nextTriggerAt=?10, snoozedUntil=?11, scheduledDate=?12, notApplicable=?13, plannedForDate=?14, surfaceRank=?15, lastSurfacedAt=?16, surfaceCount=?17, notes=?18, updatedAt=?19",
        params![state_id, child_id, rule_id, status, activated_at, completed_at, dismissed_at, dismiss_reason, repeat_index, next_trigger_at, snoozed_until, scheduled_date, not_applicable, planned_for_date, surface_rank, last_surfaced_at, surface_count, notes, now],
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
    pub snoozed_until: Option<String>,
    pub scheduled_date: Option<String>,
    pub not_applicable: i32,
    pub planned_for_date: Option<String>,
    pub surface_rank: Option<i32>,
    pub last_surfaced_at: Option<String>,
    pub surface_count: i32,
    pub notes: Option<String>,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
}

#[tauri::command]
pub fn get_reminder_states(child_id: String) -> Result<Vec<ReminderStateRecord>, String> {
    let conn = get_conn()?.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare("SELECT stateId, childId, ruleId, status, activatedAt, completedAt, dismissedAt, dismissReason, repeatIndex, nextTriggerAt, snoozedUntil, scheduledDate, notApplicable, plannedForDate, surfaceRank, lastSurfacedAt, surfaceCount, notes, createdAt, updatedAt FROM reminder_states WHERE childId = ?1 ORDER BY updatedAt DESC").map_err(|e| format!("get_reminder_states: {e}"))?;
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
            snoozed_until: row.get(10)?,
            scheduled_date: row.get(11)?,
            not_applicable: row.get(12)?,
            planned_for_date: row.get(13)?,
            surface_rank: row.get(14)?,
            last_surfaced_at: row.get(15)?,
            surface_count: row.get(16)?,
            notes: row.get(17)?,
            created_at: row.get(18)?,
            updated_at: row.get(19)?,
        })
    }).map_err(|e| format!("get_reminder_states: {e}"))?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| format!("get_reminder_states collect: {e}"))
}

#[tauri::command]
pub fn get_active_reminders(child_id: String) -> Result<Vec<ReminderStateRecord>, String> {
    let conn = get_conn()?.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare("SELECT stateId, childId, ruleId, status, activatedAt, completedAt, dismissedAt, dismissReason, repeatIndex, nextTriggerAt, snoozedUntil, scheduledDate, notApplicable, plannedForDate, surfaceRank, lastSurfacedAt, surfaceCount, notes, createdAt, updatedAt FROM reminder_states WHERE childId = ?1 AND completedAt IS NULL AND COALESCE(notApplicable, 0) = 0 ORDER BY updatedAt DESC").map_err(|e| format!("get_active_reminders: {e}"))?;
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
            snoozed_until: row.get(10)?,
            scheduled_date: row.get(11)?,
            not_applicable: row.get(12)?,
            planned_for_date: row.get(13)?,
            surface_rank: row.get(14)?,
            last_surfaced_at: row.get(15)?,
            surface_count: row.get(16)?,
            notes: row.get(17)?,
            created_at: row.get(18)?,
            updated_at: row.get(19)?,
        })
    }).map_err(|e| format!("get_active_reminders: {e}"))?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| format!("get_active_reminders collect: {e}"))
}
