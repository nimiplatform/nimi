use rusqlite::Connection;

const SCHEMA_VERSION: u32 = 2;

pub fn run_migrations(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS _schema_version (
            version INTEGER NOT NULL,
            applied_at TEXT NOT NULL
        );",
    )
    .map_err(|e| format!("migration: failed to create _schema_version: {e}"))?;

    let current_version: u32 = conn
        .query_row(
            "SELECT COALESCE(MAX(version), 0) FROM _schema_version",
            [],
            |row| row.get(0),
        )
        .map_err(|e| format!("migration: failed to read schema version: {e}"))?;

    if current_version >= SCHEMA_VERSION {
        return Ok(());
    }

    if current_version < 1 {
        apply_v1(conn)?;
        conn.execute(
            "INSERT INTO _schema_version (version, applied_at) VALUES (?1, datetime('now'))",
            [&1i64],
        )
        .map_err(|e| format!("migration: failed to record v1: {e}"))?;
    }

    if current_version < 2 {
        apply_v2(conn)?;
        conn.execute(
            "INSERT INTO _schema_version (version, applied_at) VALUES (?1, datetime('now'))",
            [&2i64],
        )
        .map_err(|e| format!("migration: failed to record v2: {e}"))?;
    }

    Ok(())
}

fn apply_v1(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS sessions (
            id                    TEXT PRIMARY KEY NOT NULL,
            learnerId             TEXT NOT NULL,
            learnerProfileVersion INTEGER NOT NULL,
            worldId               TEXT NOT NULL,
            agentId               TEXT NOT NULL,
            contentType           TEXT NOT NULL,
            truthMode             TEXT NOT NULL,
            sessionStatus         TEXT NOT NULL,
            chapterIndex          INTEGER NOT NULL DEFAULT 1,
            sceneType             TEXT NOT NULL DEFAULT 'campfire',
            rhythmCounter         INTEGER NOT NULL DEFAULT 0,
            trunkEventIndex       INTEGER NOT NULL DEFAULT 0,
            startedAt             TEXT NOT NULL,
            updatedAt             TEXT NOT NULL,
            completedAt           TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_sessions_learner_updated ON sessions (learnerId, updatedAt DESC);
        CREATE INDEX IF NOT EXISTS idx_sessions_learner_world_agent_status ON sessions (learnerId, worldId, agentId, sessionStatus);

        CREATE TABLE IF NOT EXISTS dialogue_turns (
            id        TEXT PRIMARY KEY NOT NULL,
            sessionId TEXT NOT NULL REFERENCES sessions(id),
            seq       INTEGER NOT NULL,
            role      TEXT NOT NULL,
            content   TEXT NOT NULL,
            sceneType TEXT NOT NULL,
            createdAt TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_dialogue_turns_session_seq ON dialogue_turns (sessionId, seq);
        CREATE INDEX IF NOT EXISTS idx_dialogue_turns_session_created ON dialogue_turns (sessionId, createdAt);

        CREATE TABLE IF NOT EXISTS choices (
            id                 TEXT PRIMARY KEY NOT NULL,
            sessionId          TEXT NOT NULL REFERENCES sessions(id),
            turnId             TEXT NOT NULL REFERENCES dialogue_turns(id),
            choiceKey          TEXT NOT NULL,
            choiceLabel        TEXT NOT NULL,
            choiceDescription  TEXT NOT NULL DEFAULT '',
            consequencePreview TEXT NOT NULL DEFAULT '',
            selectedAt         TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_choices_session_selected ON choices (sessionId, selectedAt);
        CREATE INDEX IF NOT EXISTS idx_choices_turn ON choices (turnId);

        CREATE TABLE IF NOT EXISTS knowledge_entries (
            id          TEXT PRIMARY KEY NOT NULL,
            learnerId   TEXT NOT NULL,
            worldId     TEXT NOT NULL,
            conceptKey  TEXT NOT NULL,
            domain      TEXT NOT NULL,
            depth       INTEGER NOT NULL DEFAULT 1,
            contentType TEXT NOT NULL,
            truthMode   TEXT NOT NULL,
            firstSeenAt TEXT NOT NULL,
            updatedAt   TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_knowledge_learner_world_concept ON knowledge_entries (learnerId, worldId, conceptKey);
        CREATE INDEX IF NOT EXISTS idx_knowledge_learner_content_truth ON knowledge_entries (learnerId, contentType, truthMode);

        CREATE TABLE IF NOT EXISTS learner_profiles (
            id                   TEXT PRIMARY KEY NOT NULL,
            authUserId           TEXT NOT NULL,
            displayName          TEXT NOT NULL,
            age                  INTEGER NOT NULL,
            communicationStyle   TEXT NOT NULL DEFAULT '',
            guardianGoals        TEXT NOT NULL DEFAULT '',
            profileVersion       INTEGER NOT NULL DEFAULT 1,
            isActive             INTEGER NOT NULL DEFAULT 0,
            encounterCompletedAt TEXT,
            createdAt            TEXT NOT NULL,
            updatedAt            TEXT NOT NULL,
            strengthTags         TEXT NOT NULL DEFAULT '[]',
            interestTags         TEXT NOT NULL DEFAULT '[]',
            supportNotes         TEXT NOT NULL DEFAULT '[]',
            guardianGuidance     TEXT NOT NULL DEFAULT '{}'
        );
        CREATE INDEX IF NOT EXISTS idx_learner_profiles_auth ON learner_profiles (authUserId);
        CREATE INDEX IF NOT EXISTS idx_learner_profiles_auth_active ON learner_profiles (authUserId, isActive);

        CREATE TABLE IF NOT EXISTS learner_context_notes (
            id         TEXT PRIMARY KEY NOT NULL,
            learnerId  TEXT NOT NULL,
            sourceType TEXT NOT NULL,
            noteType   TEXT NOT NULL,
            noteKey    TEXT NOT NULL,
            noteValue  TEXT NOT NULL,
            status     TEXT NOT NULL DEFAULT 'pending',
            createdAt  TEXT NOT NULL,
            updatedAt  TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_context_notes_learner_status ON learner_context_notes (learnerId, status, noteType);
        CREATE INDEX IF NOT EXISTS idx_context_notes_learner_source ON learner_context_notes (learnerId, sourceType, updatedAt DESC);

        CREATE TABLE IF NOT EXISTS chapter_progress (
            id                     TEXT PRIMARY KEY NOT NULL,
            learnerId              TEXT NOT NULL,
            sessionId              TEXT NOT NULL REFERENCES sessions(id),
            worldId                TEXT NOT NULL,
            chapterIndex           INTEGER NOT NULL,
            title                  TEXT NOT NULL DEFAULT '',
            summary                TEXT NOT NULL DEFAULT '',
            verificationScore      REAL,
            metacognitionCompleted INTEGER NOT NULL DEFAULT 0,
            startedAt              TEXT NOT NULL,
            completedAt            TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_chapter_progress_learner_world ON chapter_progress (learnerId, worldId, chapterIndex);
        CREATE INDEX IF NOT EXISTS idx_chapter_progress_session ON chapter_progress (sessionId, chapterIndex);

        CREATE TABLE IF NOT EXISTS achievements (
            id             TEXT PRIMARY KEY NOT NULL,
            learnerId      TEXT NOT NULL,
            achievementKey TEXT NOT NULL,
            unlockedAt     TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_achievements_learner_key ON achievements (learnerId, achievementKey);
        CREATE INDEX IF NOT EXISTS idx_achievements_learner_unlocked ON achievements (learnerId, unlockedAt DESC);
    "#,
    )
    .map_err(|e| format!("migration v1 failed: {e}"))
}

fn apply_v2(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        r#"
        DROP INDEX IF EXISTS idx_knowledge_learner_world_concept;

        CREATE TABLE knowledge_entries_v2 (
            id          TEXT PRIMARY KEY NOT NULL,
            learnerId   TEXT NOT NULL,
            worldId     TEXT NOT NULL,
            conceptKey  TEXT NOT NULL,
            domain      TEXT NOT NULL,
            depth       INTEGER NOT NULL DEFAULT 1,
            contentType TEXT NOT NULL,
            truthMode   TEXT NOT NULL,
            firstSeenAt TEXT NOT NULL,
            updatedAt   TEXT NOT NULL,
            UNIQUE (learnerId, worldId, conceptKey)
        );

        WITH dedup AS (
            SELECT
                learnerId,
                worldId,
                conceptKey,
                MIN(id) AS canonicalId,
                MIN(firstSeenAt) AS firstSeenAt,
                MAX(updatedAt) AS updatedAt,
                MAX(depth) AS depth
            FROM knowledge_entries
            GROUP BY learnerId, worldId, conceptKey
        )
        INSERT INTO knowledge_entries_v2 (
            id,
            learnerId,
            worldId,
            conceptKey,
            domain,
            depth,
            contentType,
            truthMode,
            firstSeenAt,
            updatedAt
        )
        SELECT
            dedup.canonicalId,
            dedup.learnerId,
            dedup.worldId,
            dedup.conceptKey,
            (
                SELECT domain
                FROM knowledge_entries source
                WHERE source.learnerId = dedup.learnerId
                  AND source.worldId = dedup.worldId
                  AND source.conceptKey = dedup.conceptKey
                ORDER BY source.updatedAt DESC, source.id ASC
                LIMIT 1
            ),
            dedup.depth,
            (
                SELECT contentType
                FROM knowledge_entries source
                WHERE source.learnerId = dedup.learnerId
                  AND source.worldId = dedup.worldId
                  AND source.conceptKey = dedup.conceptKey
                ORDER BY source.updatedAt DESC, source.id ASC
                LIMIT 1
            ),
            (
                SELECT truthMode
                FROM knowledge_entries source
                WHERE source.learnerId = dedup.learnerId
                  AND source.worldId = dedup.worldId
                  AND source.conceptKey = dedup.conceptKey
                ORDER BY source.updatedAt DESC, source.id ASC
                LIMIT 1
            ),
            dedup.firstSeenAt,
            dedup.updatedAt
        FROM dedup;

        DROP TABLE knowledge_entries;
        ALTER TABLE knowledge_entries_v2 RENAME TO knowledge_entries;

        CREATE UNIQUE INDEX IF NOT EXISTS idx_knowledge_learner_world_concept ON knowledge_entries (learnerId, worldId, conceptKey);
        CREATE INDEX IF NOT EXISTS idx_knowledge_learner_content_truth ON knowledge_entries (learnerId, contentType, truthMode);
    "#,
    )
    .map_err(|e| format!("migration v2 failed: {e}"))
}
