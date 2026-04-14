use rusqlite::Connection;

/// v5: unified attachments table for image/document archival across all child-scoped records.
pub(super) fn apply_v5(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS attachments (
            attachmentId TEXT PRIMARY KEY NOT NULL,
            childId      TEXT NOT NULL REFERENCES children(childId) ON DELETE CASCADE,
            ownerTable   TEXT NOT NULL,
            ownerId      TEXT NOT NULL,
            filePath     TEXT NOT NULL,
            fileName     TEXT NOT NULL,
            mimeType     TEXT NOT NULL,
            caption      TEXT,
            createdAt    TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_attach_child_owner ON attachments (childId, ownerTable, ownerId);
        CREATE INDEX IF NOT EXISTS idx_attach_child_date  ON attachments (childId, createdAt);
    "#,
    )
    .map_err(|e| format!("migration v5 failed: {e}"))
}
