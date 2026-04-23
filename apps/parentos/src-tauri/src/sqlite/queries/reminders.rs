use rusqlite::params;
use serde::Serialize;

use super::super::get_conn;

// ── Reminder States ────────────────────────────────────────
//
// Per-kind progression columns added in schema v10 per
// reminder-interaction-contract.md#PO-REMI-004:
//   acknowledgedAt / reflectedAt                        (guide)
//   practiceStartedAt / practiceLastAt / practiceCount / practiceHabituatedAt (practice)
//   consultedAt / consultationConversationId             (consult, written by advisor)
//
// The legacy `status` field continues to carry pending | active | completed | dismissed
// | overdue as a compatibility signal. Per PO-REMI plan W3, the engine writes
// status='completed' whenever any kind reaches its terminal state, so `get_active_reminders`
// filters on `status != 'completed'` instead of the v9-era `completedAt IS NULL`.

const UPSERT_SQL: &str = "INSERT INTO reminder_states (\
stateId, childId, ruleId, status, activatedAt, completedAt, dismissedAt, dismissReason, \
repeatIndex, nextTriggerAt, snoozedUntil, scheduledDate, notApplicable, plannedForDate, \
surfaceRank, lastSurfacedAt, surfaceCount, notes, \
acknowledgedAt, reflectedAt, practiceStartedAt, practiceLastAt, practiceCount, \
practiceHabituatedAt, consultedAt, consultationConversationId, \
createdAt, updatedAt\
) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,?22,?23,?24,?25,?26,?27,?27) \
ON CONFLICT(childId, ruleId, repeatIndex) DO UPDATE SET \
status=?4, activatedAt=?5, completedAt=?6, dismissedAt=?7, dismissReason=?8, \
nextTriggerAt=?10, snoozedUntil=?11, scheduledDate=?12, notApplicable=?13, \
plannedForDate=?14, surfaceRank=?15, lastSurfacedAt=?16, surfaceCount=?17, notes=?18, \
acknowledgedAt=?19, reflectedAt=?20, practiceStartedAt=?21, practiceLastAt=?22, \
practiceCount=?23, practiceHabituatedAt=?24, consultedAt=?25, consultationConversationId=?26, \
updatedAt=?27";

const SELECT_COLUMNS: &str = "stateId, childId, ruleId, status, activatedAt, completedAt, \
dismissedAt, dismissReason, repeatIndex, nextTriggerAt, snoozedUntil, scheduledDate, \
notApplicable, plannedForDate, surfaceRank, lastSurfacedAt, surfaceCount, notes, \
acknowledgedAt, reflectedAt, practiceStartedAt, practiceLastAt, practiceCount, \
practiceHabituatedAt, consultedAt, consultationConversationId, createdAt, updatedAt";

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn upsert_reminder_state(
    state_id: String, child_id: String, rule_id: String, status: String,
    activated_at: Option<String>, completed_at: Option<String>, dismissed_at: Option<String>,
    dismiss_reason: Option<String>, repeat_index: i32, next_trigger_at: Option<String>,
    snoozed_until: Option<String>, scheduled_date: Option<String>, not_applicable: i32,
    planned_for_date: Option<String>, surface_rank: Option<i32>, last_surfaced_at: Option<String>,
    surface_count: i32, notes: Option<String>,
    acknowledged_at: Option<String>, reflected_at: Option<String>,
    practice_started_at: Option<String>, practice_last_at: Option<String>, practice_count: i32,
    practice_habituated_at: Option<String>,
    consulted_at: Option<String>, consultation_conversation_id: Option<String>,
    now: String,
) -> Result<(), String> {
    let conn = get_conn()?.lock().map_err(|e| e.to_string())?;
    conn.execute(
        UPSERT_SQL,
        params![
            state_id, child_id, rule_id, status,
            activated_at, completed_at, dismissed_at, dismiss_reason,
            repeat_index, next_trigger_at, snoozed_until, scheduled_date,
            not_applicable, planned_for_date, surface_rank, last_surfaced_at,
            surface_count, notes,
            acknowledged_at, reflected_at,
            practice_started_at, practice_last_at, practice_count,
            practice_habituated_at, consulted_at, consultation_conversation_id,
            now,
        ],
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
    pub acknowledged_at: Option<String>,
    pub reflected_at: Option<String>,
    pub practice_started_at: Option<String>,
    pub practice_last_at: Option<String>,
    pub practice_count: i32,
    pub practice_habituated_at: Option<String>,
    pub consulted_at: Option<String>,
    pub consultation_conversation_id: Option<String>,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
}

fn map_record(row: &rusqlite::Row<'_>) -> rusqlite::Result<ReminderStateRecord> {
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
        acknowledged_at: row.get(18)?,
        reflected_at: row.get(19)?,
        practice_started_at: row.get(20)?,
        practice_last_at: row.get(21)?,
        practice_count: row.get(22)?,
        practice_habituated_at: row.get(23)?,
        consulted_at: row.get(24)?,
        consultation_conversation_id: row.get(25)?,
        created_at: row.get(26)?,
        updated_at: row.get(27)?,
    })
}

#[tauri::command]
pub fn get_reminder_states(child_id: String) -> Result<Vec<ReminderStateRecord>, String> {
    let conn = get_conn()?.lock().map_err(|e| e.to_string())?;
    let sql = format!(
        "SELECT {SELECT_COLUMNS} FROM reminder_states WHERE childId = ?1 ORDER BY updatedAt DESC"
    );
    let mut stmt = conn
        .prepare(&sql)
        .map_err(|e| format!("get_reminder_states: {e}"))?;
    let rows = stmt
        .query_map(params![child_id], map_record)
        .map_err(|e| format!("get_reminder_states: {e}"))?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("get_reminder_states collect: {e}"))
}

/// PO-REMI-007 advisor writeback. Invoked by the advisor module when the AI
/// produces its first persisted assistant message on a reminder-anchored
/// conversation. Sets `consultedAt` + `consultationConversationId` atomically
/// and flips `status` to `'completed'` so kind-agnostic filters (e.g.
/// `get_active_reminders`) suppress the row.
///
/// Idempotent: first successful writeback wins. If `consultedAt` is already
/// non-null for the given `(childId, ruleId, repeatIndex)`, subsequent invocations
/// are a no-op. Fail-close when the target `reminder_states` row does not exist
/// (per PO-REMI-012 — the advisor must not fabricate state).
#[tauri::command]
pub fn upsert_reminder_consultation(
    child_id: String,
    rule_id: String,
    repeat_index: i32,
    conversation_id: String,
    now: String,
) -> Result<(), String> {
    let conn = get_conn()?.lock().map_err(|e| e.to_string())?;

    let existing: Option<(Option<String>, Option<String>)> = conn
        .query_row(
            "SELECT consultedAt, consultationConversationId FROM reminder_states \
             WHERE childId = ?1 AND ruleId = ?2 AND repeatIndex = ?3",
            params![child_id, rule_id, repeat_index],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .ok();

    let Some((already_consulted_at, _)) = existing else {
        return Err(format!(
            "upsert_reminder_consultation: no reminder_states row for child={child_id} rule={rule_id} repeat={repeat_index} (PO-REMI-012)"
        ));
    };

    if already_consulted_at.is_some() {
        // First writeback wins per PO-REMI-007.
        return Ok(());
    }

    conn.execute(
        "UPDATE reminder_states SET \
         consultedAt = ?1, \
         consultationConversationId = ?2, \
         status = 'completed', \
         updatedAt = ?3 \
         WHERE childId = ?4 AND ruleId = ?5 AND repeatIndex = ?6",
        params![now, conversation_id, now, child_id, rule_id, repeat_index],
    )
    .map_err(|e| format!("upsert_reminder_consultation write: {e}"))?;
    Ok(())
}

/// PO-REMI-007 cascade: when an `ai_conversations` row anchored to a consult
/// reminder is deleted (including child-scope cascade), the paired reminder row
/// must clear `consultedAt` and `consultationConversationId` so the consult
/// lifecycle rolls back cleanly. The advisor module is responsible for invoking
/// this before deleting the conversation.
#[tauri::command]
pub fn clear_reminder_consultation(
    child_id: String,
    conversation_id: String,
    now: String,
) -> Result<(), String> {
    let conn = get_conn()?.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE reminder_states SET \
         consultedAt = NULL, \
         consultationConversationId = NULL, \
         status = CASE WHEN completedAt IS NOT NULL THEN 'completed' ELSE 'active' END, \
         updatedAt = ?1 \
         WHERE childId = ?2 AND consultationConversationId = ?3",
        params![now, child_id, conversation_id],
    )
    .map_err(|e| format!("clear_reminder_consultation: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn get_active_reminders(child_id: String) -> Result<Vec<ReminderStateRecord>, String> {
    // PO-REMI plan W3: filter kind-agnostic on the legacy `status` field. Once the
    // engine writes status='completed' for each kind's terminal timestamp (task→completedAt,
    // guide→acknowledgedAt, practice→practiceHabituatedAt, consult→consultedAt), this filter
    // stays correct across all four kinds without per-kind branching.
    let conn = get_conn()?.lock().map_err(|e| e.to_string())?;
    let sql = format!(
        "SELECT {SELECT_COLUMNS} FROM reminder_states \
         WHERE childId = ?1 AND status != 'completed' AND COALESCE(notApplicable, 0) = 0 \
         ORDER BY updatedAt DESC"
    );
    let mut stmt = conn
        .prepare(&sql)
        .map_err(|e| format!("get_active_reminders: {e}"))?;
    let rows = stmt
        .query_map(params![child_id], map_record)
        .map_err(|e| format!("get_active_reminders: {e}"))?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("get_active_reminders collect: {e}"))
}
