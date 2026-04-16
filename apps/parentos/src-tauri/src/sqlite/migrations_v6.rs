use rusqlite::Connection;

/// v6: custom_todos table for user-created todo items per child.
pub(super) fn apply_v6(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS custom_todos (
            todoId      TEXT PRIMARY KEY NOT NULL,
            childId     TEXT NOT NULL REFERENCES children(childId) ON DELETE CASCADE,
            title       TEXT NOT NULL,
            dueDate     TEXT,
            completedAt TEXT,
            createdAt   TEXT NOT NULL,
            updatedAt   TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_custom_todos_child_completed ON custom_todos (childId, completedAt);
        CREATE INDEX IF NOT EXISTS idx_custom_todos_child_due       ON custom_todos (childId, dueDate);
    "#,
    )
    .map_err(|e| format!("migration v6 failed: {e}"))
}
