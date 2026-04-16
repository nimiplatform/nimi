use rusqlite::params;
use serde::Serialize;

use super::super::get_conn;

// ── Custom Todos ──────────────────────────────────────────

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomTodoRecord {
    pub todo_id: String,
    pub child_id: String,
    pub title: String,
    pub due_date: Option<String>,
    pub completed_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[tauri::command]
pub fn insert_custom_todo(
    todo_id: String,
    child_id: String,
    title: String,
    due_date: Option<String>,
    now: String,
) -> Result<(), String> {
    let conn = get_conn()?.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO custom_todos (todoId, childId, title, dueDate, completedAt, createdAt, updatedAt) VALUES (?1,?2,?3,?4,NULL,?5,?5)",
        params![todo_id, child_id, title, due_date, now],
    )
    .map_err(|e| format!("insert_custom_todo: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn update_custom_todo(
    todo_id: String,
    title: String,
    due_date: Option<String>,
    now: String,
) -> Result<(), String> {
    let conn = get_conn()?.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE custom_todos SET title=?2, dueDate=?3, updatedAt=?4 WHERE todoId=?1",
        params![todo_id, title, due_date, now],
    )
    .map_err(|e| format!("update_custom_todo: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn complete_custom_todo(todo_id: String, now: String) -> Result<(), String> {
    let conn = get_conn()?.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE custom_todos SET completedAt=?2, updatedAt=?2 WHERE todoId=?1",
        params![todo_id, now],
    )
    .map_err(|e| format!("complete_custom_todo: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn uncomplete_custom_todo(todo_id: String, now: String) -> Result<(), String> {
    let conn = get_conn()?.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE custom_todos SET completedAt=NULL, updatedAt=?2 WHERE todoId=?1",
        params![todo_id, now],
    )
    .map_err(|e| format!("uncomplete_custom_todo: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn delete_custom_todo(todo_id: String) -> Result<(), String> {
    let conn = get_conn()?.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM custom_todos WHERE todoId=?1", params![todo_id])
        .map_err(|e| format!("delete_custom_todo: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn get_custom_todos(child_id: String) -> Result<Vec<CustomTodoRecord>, String> {
    let conn = get_conn()?.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT todoId, childId, title, dueDate, completedAt, createdAt, updatedAt FROM custom_todos WHERE childId=?1 ORDER BY completedAt IS NOT NULL, createdAt DESC")
        .map_err(|e| format!("get_custom_todos: {e}"))?;
    let rows = stmt
        .query_map(params![child_id], |row| {
            Ok(CustomTodoRecord {
                todo_id: row.get(0)?,
                child_id: row.get(1)?,
                title: row.get(2)?,
                due_date: row.get(3)?,
                completed_at: row.get(4)?,
                created_at: row.get(5)?,
                updated_at: row.get(6)?,
            })
        })
        .map_err(|e| format!("get_custom_todos: {e}"))?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("get_custom_todos collect: {e}"))
}
