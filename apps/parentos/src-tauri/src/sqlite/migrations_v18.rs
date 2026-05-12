use rusqlite::Connection;

/// Schema v18: admit the orthodontic photo-session image record
/// (`PO-ORTHO-012`).
///
/// 1. Creates `orthodontic_photo_sessions`, the per-session container that
///    owns 0..2 attached photographs (one per angle). Sessions cascade on the
///    parent `orthodontic_cases` row and on the optional pinned
///    `orthodontic_appliances` row, so any case-level deletion sweeps the
///    journey out cleanly without leaving orphan rows.
///
/// 2. Adds `attachments.metadataJson` so the shared image table can carry
///    owner-specific metadata. For photo sessions this column holds
///    `{"angle":"front"}` or `{"angle":"side"}` exactly; other owner kinds may
///    use it for their own structured payloads.
///
/// Idempotent — every DDL uses `IF NOT EXISTS` for tables / indexes and a
/// PRAGMA-driven check for the column. Re-running v18 on a stamped database
/// is a no-op, which makes the `repair_missing_tables` replay safe.
///
/// File-level cascade (PO-ORTHO-012) lives in the Tauri command layer, not
/// here: the SQL FK chain is responsible for the row purge, the photos
/// module purges the on-disk directory.
pub(super) fn apply_v18(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(PHOTO_SESSION_DDL)
        .map_err(|e| format!("migration v18: photo sessions DDL failed: {e}"))?;
    ensure_attachments_metadata_json_column(conn)?;
    ensure_photo_session_unique_angle_index(conn)?;
    ensure_photo_session_attachments_cascade_trigger(conn)?;
    Ok(())
}

const PHOTO_SESSION_DDL: &str = "
    CREATE TABLE IF NOT EXISTS orthodontic_photo_sessions (
        sessionId    TEXT PRIMARY KEY NOT NULL,
        childId      TEXT NOT NULL REFERENCES children(childId) ON DELETE CASCADE,
        caseId       TEXT NOT NULL REFERENCES orthodontic_cases(caseId) ON DELETE CASCADE,
        applianceId  TEXT REFERENCES orthodontic_appliances(applianceId) ON DELETE CASCADE,
        trayIndex    INTEGER,
        sessionDate  TEXT NOT NULL,
        note         TEXT,
        createdAt    TEXT NOT NULL,
        updatedAt    TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_photo_sessions_child_date
        ON orthodontic_photo_sessions (childId, sessionDate);
    CREATE INDEX IF NOT EXISTS idx_photo_sessions_case_date
        ON orthodontic_photo_sessions (caseId, sessionDate);
    CREATE INDEX IF NOT EXISTS idx_photo_sessions_appliance
        ON orthodontic_photo_sessions (applianceId);
";

fn ensure_attachments_metadata_json_column(conn: &Connection) -> Result<(), String> {
    // Older `repair_missing_tables` replays can re-enter v18 before v5 has
    // recreated `attachments`. Short-circuit when the table is absent — the
    // next replay pass (after v5 runs) will revisit this column add.
    if !attachments_table_exists(conn)? {
        return Ok(());
    }
    // PRAGMA table_info returns one row per column; idempotency hinges on
    // detecting the column already being present before issuing ALTER (SQLite
    // would otherwise raise `duplicate column name` on replay).
    let mut stmt = conn
        .prepare("PRAGMA table_info(attachments)")
        .map_err(|e| format!("migration v18: read attachments schema failed: {e}"))?;
    let names: Result<Vec<String>, _> = stmt
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|e| format!("migration v18: scan attachments columns failed: {e}"))?
        .collect();
    let names =
        names.map_err(|e| format!("migration v18: collect attachments columns failed: {e}"))?;
    if names.iter().any(|n| n == "metadataJson") {
        return Ok(());
    }
    conn.execute_batch("ALTER TABLE attachments ADD COLUMN metadataJson TEXT;")
        .map_err(|e| format!("migration v18: add attachments.metadataJson failed: {e}"))?;
    Ok(())
}

fn attachments_table_exists(conn: &Connection) -> Result<bool, String> {
    conn.query_row(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='attachments'",
        [],
        |_| Ok(true),
    )
    .or_else(|err| match err {
        rusqlite::Error::QueryReturnedNoRows => Ok(false),
        _ => Err(format!("migration v18: check attachments exists failed: {err}")),
    })
}

/// Schema-level enforcement of PO-ORTHO-012 "exactly one angle per session":
/// the partial unique index keys on (ownerId, angle) for the photo-session
/// owner only, so other attachment owners are unaffected. Using
/// `json_extract` makes the constraint robust against incidental whitespace
/// differences in the persisted `metadataJson` string. Idempotent via
/// `CREATE UNIQUE INDEX IF NOT EXISTS`; skipped when attachments is missing
/// (the column add step short-circuits the same way).
fn ensure_photo_session_unique_angle_index(conn: &Connection) -> Result<(), String> {
    if !attachments_table_exists(conn)? {
        return Ok(());
    }
    conn.execute_batch(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_photo_session_unique_angle
            ON attachments (ownerId, json_extract(metadataJson, '$.angle'))
            WHERE ownerTable = 'orthodontic_photo_sessions';",
    )
    .map_err(|e| format!("migration v18: create photo-session unique angle index failed: {e}"))?;
    Ok(())
}

/// Wave A audit follow-up (W3) — DB-side enforcement of
/// "deleting a session row purges its attachment rows".
///
/// `attachments` is the unified owner-polymorphic table, so it does not carry
/// a real FK back to `orthodontic_photo_sessions`. Without this trigger the
/// cascade exists only at the Tauri command layer, and any path that bypasses
/// that command (a direct cases-row delete cascading into photo_sessions, or
/// a future maintenance script) would orphan attachment rows.
///
/// The trigger fires `AFTER DELETE` on `orthodontic_photo_sessions` and
/// purges every attachment row whose `ownerTable` + `ownerId` matches. This
/// runs for FK-cascade-driven deletes too (SQLite triggers fire on cascade),
/// so the cases→sessions→attachments chain stays atomic at the DB layer.
/// On-disk file purge is still the command layer's responsibility — the
/// trigger only owns row integrity.
///
/// Idempotent via `CREATE TRIGGER IF NOT EXISTS`. Skipped when `attachments`
/// is absent (same short-circuit pattern as the metadata column / index).
fn ensure_photo_session_attachments_cascade_trigger(conn: &Connection) -> Result<(), String> {
    if !attachments_table_exists(conn)? {
        return Ok(());
    }
    conn.execute_batch(
        "CREATE TRIGGER IF NOT EXISTS trg_photo_session_cascade_attachments
            AFTER DELETE ON orthodontic_photo_sessions
            FOR EACH ROW
            BEGIN
                DELETE FROM attachments
                WHERE ownerTable = 'orthodontic_photo_sessions'
                  AND ownerId = OLD.sessionId;
            END;",
    )
    .map_err(|e| {
        format!("migration v18: create photo-session attachments cascade trigger failed: {e}")
    })?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn bootstrap_required_tables(conn: &Connection) {
        // Wave A audit follow-up — enable FK enforcement BEFORE the
        // bootstrap inserts so cascade chains are exercised consistently
        // with production semantics. SQLite's `foreign_keys` PRAGMA is
        // per-connection and defaults to OFF; deferring the enable until
        // after inserts let us land valid rows that would otherwise have
        // been blocked, which weakens the test fixture's signal.
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        conn.execute_batch(
            "
            CREATE TABLE children (childId TEXT PRIMARY KEY);
            CREATE TABLE orthodontic_cases (
                caseId TEXT PRIMARY KEY,
                childId TEXT NOT NULL REFERENCES children(childId) ON DELETE CASCADE
            );
            CREATE TABLE orthodontic_appliances (
                applianceId TEXT PRIMARY KEY,
                caseId TEXT NOT NULL REFERENCES orthodontic_cases(caseId) ON DELETE CASCADE
            );
            CREATE TABLE attachments (
                attachmentId TEXT PRIMARY KEY,
                childId TEXT NOT NULL,
                ownerTable TEXT NOT NULL,
                ownerId TEXT NOT NULL,
                filePath TEXT NOT NULL,
                fileName TEXT NOT NULL,
                mimeType TEXT NOT NULL,
                caption TEXT,
                createdAt TEXT NOT NULL
            );
            INSERT INTO children(childId) VALUES('child-1');
            INSERT INTO orthodontic_cases(caseId, childId) VALUES('case-1', 'child-1');
            INSERT INTO orthodontic_appliances(applianceId, caseId) VALUES('app-1', 'case-1');
            ",
        )
        .unwrap();
    }

    #[test]
    fn applies_clean() {
        let conn = Connection::open_in_memory().unwrap();
        bootstrap_required_tables(&conn);
        apply_v18(&conn).expect("v18 should apply cleanly");

        // photo_sessions table exists and accepts a round-trip insert.
        conn.execute(
            "INSERT INTO orthodontic_photo_sessions
             (sessionId, childId, caseId, applianceId, trayIndex, sessionDate, note, createdAt, updatedAt)
             VALUES ('sess-1', 'child-1', 'case-1', 'app-1', 3, '2026-05-11', 'first', '2026-05-11T00:00:00Z', '2026-05-11T00:00:00Z')",
            [],
        )
        .expect("insert photo session row");

        // attachments.metadataJson column exists.
        let mut stmt = conn.prepare("PRAGMA table_info(attachments)").unwrap();
        let cols: Vec<String> = stmt
            .query_map([], |row| row.get::<_, String>(1))
            .unwrap()
            .map(|r| r.unwrap())
            .collect();
        assert!(cols.contains(&"metadataJson".to_string()));
    }

    #[test]
    fn replay_is_no_op() {
        let conn = Connection::open_in_memory().unwrap();
        bootstrap_required_tables(&conn);
        apply_v18(&conn).expect("first apply");
        apply_v18(&conn).expect("second apply must be idempotent");
        apply_v18(&conn).expect("third apply must be idempotent");
    }

    #[test]
    fn case_delete_cascades_into_photo_sessions() {
        let conn = Connection::open_in_memory().unwrap();
        bootstrap_required_tables(&conn);
        apply_v18(&conn).expect("v18 apply");

        conn.execute(
            "INSERT INTO orthodontic_photo_sessions
             (sessionId, childId, caseId, applianceId, trayIndex, sessionDate, note, createdAt, updatedAt)
             VALUES ('sess-1', 'child-1', 'case-1', 'app-1', NULL, '2026-05-11', NULL, '2026-05-11T00:00:00Z', '2026-05-11T00:00:00Z')",
            [],
        )
        .unwrap();
        conn.execute("DELETE FROM orthodontic_cases WHERE caseId = 'case-1'", [])
            .unwrap();
        let remaining: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM orthodontic_photo_sessions WHERE sessionId = 'sess-1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(remaining, 0, "case delete must cascade into photo sessions");
    }

    #[test]
    fn appliance_delete_cascades_into_photo_sessions() {
        let conn = Connection::open_in_memory().unwrap();
        bootstrap_required_tables(&conn);
        apply_v18(&conn).expect("v18 apply");

        conn.execute(
            "INSERT INTO orthodontic_photo_sessions
             (sessionId, childId, caseId, applianceId, trayIndex, sessionDate, note, createdAt, updatedAt)
             VALUES ('sess-1', 'child-1', 'case-1', 'app-1', 1, '2026-05-11', NULL, '2026-05-11T00:00:00Z', '2026-05-11T00:00:00Z')",
            [],
        )
        .unwrap();
        conn.execute(
            "DELETE FROM orthodontic_appliances WHERE applianceId = 'app-1'",
            [],
        )
        .unwrap();
        let remaining: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM orthodontic_photo_sessions WHERE sessionId = 'sess-1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(
            remaining, 0,
            "appliance delete must cascade into pinned photo sessions"
        );
    }

    #[test]
    fn child_delete_cascades_into_photo_sessions() {
        let conn = Connection::open_in_memory().unwrap();
        bootstrap_required_tables(&conn);
        apply_v18(&conn).expect("v18 apply");

        conn.execute(
            "INSERT INTO orthodontic_photo_sessions
             (sessionId, childId, caseId, applianceId, trayIndex, sessionDate, note, createdAt, updatedAt)
             VALUES ('sess-1', 'child-1', 'case-1', 'app-1', NULL, '2026-05-11', NULL, '2026-05-11T00:00:00Z', '2026-05-11T00:00:00Z')",
            [],
        )
        .unwrap();
        // Tear the FK chain top-down: cases first (so its FK to children can
        // release), then children. Without the case cascade, the child-row
        // delete would only sweep the leaves whose ON DELETE CASCADE points
        // back at children, not the photo session attached to a case.
        conn.execute("DELETE FROM orthodontic_cases WHERE caseId = 'case-1'", [])
            .unwrap();
        conn.execute("DELETE FROM children WHERE childId = 'child-1'", [])
            .unwrap();
        let remaining: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM orthodontic_photo_sessions WHERE childId = 'child-1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(
            remaining, 0,
            "child + case cascade must leave photo_sessions empty"
        );
    }

    #[test]
    fn session_accepts_null_appliance_id() {
        let conn = Connection::open_in_memory().unwrap();
        bootstrap_required_tables(&conn);
        apply_v18(&conn).expect("v18 apply");

        conn.execute(
            "INSERT INTO orthodontic_photo_sessions
             (sessionId, childId, caseId, applianceId, trayIndex, sessionDate, note, createdAt, updatedAt)
             VALUES ('sess-1', 'child-1', 'case-1', NULL, NULL, '2026-05-11', NULL, '2026-05-11T00:00:00Z', '2026-05-11T00:00:00Z')",
            [],
        )
        .expect("nullable applianceId must be accepted at the schema layer");

        let stored: Option<String> = conn
            .query_row(
                "SELECT applianceId FROM orthodontic_photo_sessions WHERE sessionId = 'sess-1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(stored.is_none());
    }

    #[test]
    fn attachments_metadata_json_round_trips() {
        let conn = Connection::open_in_memory().unwrap();
        bootstrap_required_tables(&conn);
        apply_v18(&conn).expect("v18 apply");

        // Existing attachments rows (inserted pre-v18) have metadataJson = NULL
        // by default; the migration adds the column with no DEFAULT clause.
        conn.execute(
            "INSERT INTO attachments
             (attachmentId, childId, ownerTable, ownerId, filePath, fileName, mimeType, caption, createdAt)
             VALUES ('att-legacy', 'child-1', 'health_record_events', 'evt-1', '/tmp/legacy.jpg', 'legacy.jpg', 'image/jpeg', NULL, '2026-05-11T00:00:00Z')",
            [],
        )
        .unwrap();
        let legacy_meta: Option<String> = conn
            .query_row(
                "SELECT metadataJson FROM attachments WHERE attachmentId = 'att-legacy'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(legacy_meta.is_none(), "post-ALTER row must default NULL");

        conn.execute(
            "INSERT INTO orthodontic_photo_sessions
             (sessionId, childId, caseId, applianceId, trayIndex, sessionDate, note, createdAt, updatedAt)
             VALUES ('sess-1', 'child-1', 'case-1', NULL, NULL, '2026-05-11', NULL, '2026-05-11T00:00:00Z', '2026-05-11T00:00:00Z')",
            [],
        )
        .unwrap();

        conn.execute(
            "INSERT INTO attachments
             (attachmentId, childId, ownerTable, ownerId, filePath, fileName, mimeType, caption, metadataJson, createdAt)
             VALUES ('att-1', 'child-1', 'orthodontic_photo_sessions', 'sess-1', '/tmp/sess-1/front.jpg', 'front.jpg', 'image/jpeg', NULL, '{\"angle\":\"front\"}', '2026-05-11T00:00:00Z')",
            [],
        )
        .unwrap();

        let stored: String = conn
            .query_row(
                "SELECT metadataJson FROM attachments WHERE attachmentId = 'att-1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(stored, "{\"angle\":\"front\"}");

        // Adding a `side` row for the same session is admitted.
        conn.execute(
            "INSERT INTO attachments
             (attachmentId, childId, ownerTable, ownerId, filePath, fileName, mimeType, caption, metadataJson, createdAt)
             VALUES ('att-2', 'child-1', 'orthodontic_photo_sessions', 'sess-1', '/tmp/sess-1/side.jpg', 'side.jpg', 'image/jpeg', NULL, '{\"angle\":\"side\"}', '2026-05-11T00:00:00Z')",
            [],
        )
        .expect("first side attachment for the same session must succeed");

        // Adding a SECOND `front` row for the same session must be rejected by
        // the partial unique index (PO-ORTHO-012 / W4).
        let dup = conn.execute(
            "INSERT INTO attachments
             (attachmentId, childId, ownerTable, ownerId, filePath, fileName, mimeType, caption, metadataJson, createdAt)
             VALUES ('att-3', 'child-1', 'orthodontic_photo_sessions', 'sess-1', '/tmp/sess-1/front2.jpg', 'front2.jpg', 'image/jpeg', NULL, '{\"angle\":\"front\"}', '2026-05-11T00:00:00Z')",
            [],
        );
        assert!(
            dup.is_err(),
            "second front attachment for the same session must fail-close at the index"
        );

        // The index is scoped to ownerTable='orthodontic_photo_sessions';
        // a `health_record_events` attachment with a matching ownerId is
        // unaffected (different owner namespace).
        conn.execute(
            "INSERT INTO attachments
             (attachmentId, childId, ownerTable, ownerId, filePath, fileName, mimeType, caption, metadataJson, createdAt)
             VALUES ('att-4', 'child-1', 'health_record_events', 'sess-1', '/tmp/evt-clash.jpg', 'evt-clash.jpg', 'image/jpeg', NULL, '{\"angle\":\"front\"}', '2026-05-11T00:00:00Z')",
            [],
        )
        .expect("unique-angle index must NOT apply to non-photo-session owners");
    }

    #[test]
    fn trigger_cascades_attachments_when_session_deleted() {
        let conn = Connection::open_in_memory().unwrap();
        bootstrap_required_tables(&conn);
        apply_v18(&conn).expect("v18 apply");

        conn.execute(
            "INSERT INTO orthodontic_photo_sessions
             (sessionId, childId, caseId, applianceId, trayIndex, sessionDate, note, createdAt, updatedAt)
             VALUES ('sess-1', 'child-1', 'case-1', 'app-1', NULL, '2026-05-11', NULL, '2026-05-11T00:00:00Z', '2026-05-11T00:00:00Z')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO attachments
             (attachmentId, childId, ownerTable, ownerId, filePath, fileName, mimeType, caption, metadataJson, createdAt)
             VALUES ('att-1', 'child-1', 'orthodontic_photo_sessions', 'sess-1', '/tmp/sess-1/front.jpg', 'front.jpg', 'image/jpeg', NULL, '{\"angle\":\"front\"}', '2026-05-11T00:00:00Z'),
                    ('att-2', 'child-1', 'orthodontic_photo_sessions', 'sess-1', '/tmp/sess-1/side.jpg',  'side.jpg',  'image/jpeg', NULL, '{\"angle\":\"side\"}',  '2026-05-11T00:00:00Z')",
            [],
        )
        .unwrap();
        // Sibling attachment that points elsewhere — must survive.
        conn.execute(
            "INSERT INTO attachments
             (attachmentId, childId, ownerTable, ownerId, filePath, fileName, mimeType, caption, metadataJson, createdAt)
             VALUES ('att-evt', 'child-1', 'health_record_events', 'evt-1', '/tmp/evt-1.jpg', 'evt.jpg', 'image/jpeg', NULL, NULL, '2026-05-11T00:00:00Z')",
            [],
        )
        .unwrap();

        // Direct session delete — trigger fires.
        conn.execute(
            "DELETE FROM orthodontic_photo_sessions WHERE sessionId = 'sess-1'",
            [],
        )
        .unwrap();

        let photo_atts: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM attachments WHERE ownerTable = 'orthodontic_photo_sessions'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(
            photo_atts, 0,
            "trigger must purge all photo-session attachments"
        );
        let sibling: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM attachments WHERE attachmentId = 'att-evt'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(sibling, 1, "trigger must NOT touch unrelated attachments");
    }

    #[test]
    fn trigger_cascades_through_case_delete_chain() {
        let conn = Connection::open_in_memory().unwrap();
        bootstrap_required_tables(&conn);
        apply_v18(&conn).expect("v18 apply");

        // session + attachment, then nuke the case. cases ON DELETE CASCADE
        // sweeps sessions; the v18 trigger then sweeps attachments. Whole
        // chain atomic at DB layer.
        conn.execute(
            "INSERT INTO orthodontic_photo_sessions
             (sessionId, childId, caseId, applianceId, trayIndex, sessionDate, note, createdAt, updatedAt)
             VALUES ('sess-1', 'child-1', 'case-1', 'app-1', NULL, '2026-05-11', NULL, '2026-05-11T00:00:00Z', '2026-05-11T00:00:00Z')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO attachments
             (attachmentId, childId, ownerTable, ownerId, filePath, fileName, mimeType, caption, metadataJson, createdAt)
             VALUES ('att-1', 'child-1', 'orthodontic_photo_sessions', 'sess-1', '/tmp/sess-1/front.jpg', 'front.jpg', 'image/jpeg', NULL, '{\"angle\":\"front\"}', '2026-05-11T00:00:00Z')",
            [],
        )
        .unwrap();
        conn.execute("DELETE FROM orthodontic_cases WHERE caseId = 'case-1'", [])
            .unwrap();
        let leftover_sessions: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM orthodontic_photo_sessions",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let leftover_atts: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM attachments WHERE ownerTable = 'orthodontic_photo_sessions'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(leftover_sessions, 0, "case cascade must sweep sessions");
        assert_eq!(
            leftover_atts, 0,
            "trigger must run on cascade-driven session delete (W3)"
        );
    }

    #[test]
    fn graceful_when_attachments_absent() {
        // Mirrors the repair_missing_tables_for_version_5_db scenario: an
        // older stamped DB that hasn't replayed v5 yet. v18 must not fault.
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "
            CREATE TABLE children (childId TEXT PRIMARY KEY);
            CREATE TABLE orthodontic_cases (caseId TEXT PRIMARY KEY, childId TEXT NOT NULL);
            CREATE TABLE orthodontic_appliances (
                applianceId TEXT PRIMARY KEY,
                caseId TEXT NOT NULL REFERENCES orthodontic_cases(caseId) ON DELETE CASCADE
            );
            ",
        )
        .unwrap();
        // No attachments table in this fixture — exactly the v5-stamped case.
        apply_v18(&conn).expect("v18 must succeed even when attachments is absent");
        let attachments_present: bool = conn
            .query_row(
                "SELECT 1 FROM sqlite_master WHERE type='table' AND name='attachments'",
                [],
                |_| Ok(true),
            )
            .or_else(|err| match err {
                rusqlite::Error::QueryReturnedNoRows => Ok(false),
                other => Err(other),
            })
            .unwrap();
        assert!(
            !attachments_present,
            "v18 must not surreptitiously create attachments — that is v5's job"
        );
    }
}
