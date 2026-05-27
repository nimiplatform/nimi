use rusqlite::params;
use serde::{Deserialize, Serialize};

use super::with_db;

// ── Learner Profiles ─────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LearnerProfileRow {
    pub id: String,
    pub auth_user_id: String,
    pub display_name: String,
    pub age: i64,
    pub communication_style: String,
    pub guardian_goals: String,
    pub profile_version: i64,
    pub is_active: bool,
    pub encounter_completed_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub strength_tags: String,
    pub interest_tags: String,
    pub support_notes: String,
    pub guardian_guidance: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateLearnerProfileInput {
    pub id: String,
    pub auth_user_id: String,
    pub display_name: String,
    pub age: i64,
    pub communication_style: String,
    pub guardian_goals: String,
    pub strength_tags: String,
    pub interest_tags: String,
    pub support_notes: String,
    pub guardian_guidance: String,
    pub created_at: String,
    pub updated_at: String,
}

#[tauri::command]
pub fn create_learner_profile(input: CreateLearnerProfileInput) -> Result<LearnerProfileRow, String> {
    with_db(|conn| {
        conn.execute(
            "INSERT INTO learner_profiles
             (id, authUserId, displayName, age, communicationStyle, guardianGoals,
              profileVersion, isActive, encounterCompletedAt, createdAt, updatedAt,
              strengthTags, interestTags, supportNotes, guardianGuidance)
             VALUES (?1,?2,?3,?4,?5,?6,1,0,NULL,?7,?8,?9,?10,?11,?12)",
            params![
                input.id, input.auth_user_id, input.display_name, input.age,
                input.communication_style, input.guardian_goals,
                input.created_at, input.updated_at,
                input.strength_tags, input.interest_tags, input.support_notes, input.guardian_guidance
            ],
        )?;
        conn.query_row(
            "SELECT id, authUserId, displayName, age, communicationStyle, guardianGoals,
                    profileVersion, isActive, encounterCompletedAt, createdAt, updatedAt,
                    strengthTags, interestTags, supportNotes, guardianGuidance
             FROM learner_profiles WHERE id = ?1",
            [&input.id],
            row_to_learner_profile,
        )
    })
}

#[tauri::command]
pub fn get_learner_profiles(auth_user_id: String) -> Result<Vec<LearnerProfileRow>, String> {
    with_db(|conn| {
        let mut stmt = conn.prepare(
            "SELECT id, authUserId, displayName, age, communicationStyle, guardianGoals,
                    profileVersion, isActive, encounterCompletedAt, createdAt, updatedAt,
                    strengthTags, interestTags, supportNotes, guardianGuidance
             FROM learner_profiles WHERE authUserId = ?1 ORDER BY createdAt ASC"
        )?;
        let rows = stmt.query_map([&auth_user_id], row_to_learner_profile)?;
        rows.collect()
    })
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateLearnerProfileInput {
    pub id: String,
    pub display_name: String,
    pub age: i64,
    pub communication_style: String,
    pub guardian_goals: String,
    pub strength_tags: String,
    pub interest_tags: String,
    pub support_notes: String,
    pub guardian_guidance: String,
    pub encounter_completed_at: Option<String>,
    pub updated_at: String,
}

#[tauri::command]
pub fn update_learner_profile(input: UpdateLearnerProfileInput) -> Result<LearnerProfileRow, String> {
    with_db(|conn| {
        let updated = conn.execute(
            "UPDATE learner_profiles SET
                displayName = ?1, age = ?2, communicationStyle = ?3, guardianGoals = ?4,
                strengthTags = ?5, interestTags = ?6, supportNotes = ?7, guardianGuidance = ?8,
                encounterCompletedAt = ?9, updatedAt = ?10,
                profileVersion = profileVersion + 1
             WHERE id = ?11",
            params![
                input.display_name, input.age, input.communication_style, input.guardian_goals,
                input.strength_tags, input.interest_tags, input.support_notes, input.guardian_guidance,
                input.encounter_completed_at, input.updated_at, input.id
            ],
        )?;
        if updated == 0 {
            return Err(rusqlite::Error::QueryReturnedNoRows);
        }
        conn.query_row(
            "SELECT id, authUserId, displayName, age, communicationStyle, guardianGoals,
                    profileVersion, isActive, encounterCompletedAt, createdAt, updatedAt,
                    strengthTags, interestTags, supportNotes, guardianGuidance
             FROM learner_profiles WHERE id = ?1",
            [&input.id],
            row_to_learner_profile,
        )
    })
}

#[tauri::command]
pub fn set_active_profile(auth_user_id: String, profile_id: String) -> Result<(), String> {
    with_db(|conn| {
        conn.execute(
            "UPDATE learner_profiles SET isActive = 0 WHERE authUserId = ?1",
            [&auth_user_id],
        )?;
        conn.execute(
            "UPDATE learner_profiles SET isActive = 1 WHERE id = ?1 AND authUserId = ?2",
            params![profile_id, auth_user_id],
        )?;
        Ok(())
    })
}

fn row_to_learner_profile(row: &rusqlite::Row<'_>) -> rusqlite::Result<LearnerProfileRow> {
    Ok(LearnerProfileRow {
        id: row.get(0)?,
        auth_user_id: row.get(1)?,
        display_name: row.get(2)?,
        age: row.get(3)?,
        communication_style: row.get(4)?,
        guardian_goals: row.get(5)?,
        profile_version: row.get(6)?,
        is_active: row.get::<_, i64>(7)? != 0,
        encounter_completed_at: row.get(8)?,
        created_at: row.get(9)?,
        updated_at: row.get(10)?,
        strength_tags: row.get(11)?,
        interest_tags: row.get(12)?,
        support_notes: row.get(13)?,
        guardian_guidance: row.get(14)?,
    })
}

// ── Sessions ─────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionRow {
    pub id: String,
    pub learner_id: String,
    pub learner_profile_version: i64,
    pub world_id: String,
    pub agent_id: String,
    pub content_type: String,
    pub truth_mode: String,
    pub session_status: String,
    pub chapter_index: i64,
    pub scene_type: String,
    pub rhythm_counter: i64,
    pub trunk_event_index: i64,
    pub started_at: String,
    pub updated_at: String,
    pub completed_at: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateSessionInput {
    pub id: String,
    pub learner_id: String,
    pub learner_profile_version: i64,
    pub world_id: String,
    pub agent_id: String,
    pub content_type: String,
    pub truth_mode: String,
    pub started_at: String,
    pub updated_at: String,
}

#[tauri::command]
pub fn create_session(input: CreateSessionInput) -> Result<SessionRow, String> {
    with_db(|conn| {
        conn.execute(
            "INSERT INTO sessions
             (id, learnerId, learnerProfileVersion, worldId, agentId, contentType, truthMode,
              sessionStatus, chapterIndex, sceneType, rhythmCounter, trunkEventIndex, startedAt, updatedAt, completedAt)
             VALUES (?1,?2,?3,?4,?5,?6,?7,'active',1,'campfire',0,0,?8,?9,NULL)",
            params![
                input.id, input.learner_id, input.learner_profile_version,
                input.world_id, input.agent_id, input.content_type, input.truth_mode,
                input.started_at, input.updated_at
            ],
        )?;
        conn.query_row(
            "SELECT id,learnerId,learnerProfileVersion,worldId,agentId,contentType,truthMode,
                    sessionStatus,chapterIndex,sceneType,rhythmCounter,trunkEventIndex,
                    startedAt,updatedAt,completedAt
             FROM sessions WHERE id=?1",
            [&input.id],
            row_to_session,
        )
    })
}

#[tauri::command]
pub fn get_session(session_id: String) -> Result<Option<SessionRow>, String> {
    with_db(|conn| {
        let result = conn.query_row(
            "SELECT id,learnerId,learnerProfileVersion,worldId,agentId,contentType,truthMode,
                    sessionStatus,chapterIndex,sceneType,rhythmCounter,trunkEventIndex,
                    startedAt,updatedAt,completedAt
             FROM sessions WHERE id=?1",
            [&session_id],
            row_to_session,
        );
        match result {
            Ok(row) => Ok(Some(row)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e),
        }
    })
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateSessionInput {
    pub id: String,
    pub session_status: String,
    pub chapter_index: i64,
    pub scene_type: String,
    pub rhythm_counter: i64,
    pub trunk_event_index: i64,
    pub updated_at: String,
    pub completed_at: Option<String>,
}

#[tauri::command]
pub fn update_session(input: UpdateSessionInput) -> Result<SessionRow, String> {
    with_db(|conn| {
        conn.execute(
            "UPDATE sessions SET
                sessionStatus=?1, chapterIndex=?2, sceneType=?3, rhythmCounter=?4,
                trunkEventIndex=?5, updatedAt=?6, completedAt=?7
             WHERE id=?8",
            params![
                input.session_status, input.chapter_index, input.scene_type,
                input.rhythm_counter, input.trunk_event_index, input.updated_at,
                input.completed_at, input.id
            ],
        )?;
        conn.query_row(
            "SELECT id,learnerId,learnerProfileVersion,worldId,agentId,contentType,truthMode,
                    sessionStatus,chapterIndex,sceneType,rhythmCounter,trunkEventIndex,
                    startedAt,updatedAt,completedAt
             FROM sessions WHERE id=?1",
            [&input.id],
            row_to_session,
        )
    })
}

#[tauri::command]
pub fn get_sessions_for_learner(learner_id: String) -> Result<Vec<SessionRow>, String> {
    with_db(|conn| {
        let mut stmt = conn.prepare(
            "SELECT id,learnerId,learnerProfileVersion,worldId,agentId,contentType,truthMode,
                    sessionStatus,chapterIndex,sceneType,rhythmCounter,trunkEventIndex,
                    startedAt,updatedAt,completedAt
             FROM sessions WHERE learnerId=?1 ORDER BY updatedAt DESC"
        )?;
        let rows = stmt.query_map([&learner_id], row_to_session)?;
        rows.collect()
    })
}

fn row_to_session(row: &rusqlite::Row<'_>) -> rusqlite::Result<SessionRow> {
    Ok(SessionRow {
        id: row.get(0)?,
        learner_id: row.get(1)?,
        learner_profile_version: row.get(2)?,
        world_id: row.get(3)?,
        agent_id: row.get(4)?,
        content_type: row.get(5)?,
        truth_mode: row.get(6)?,
        session_status: row.get(7)?,
        chapter_index: row.get(8)?,
        scene_type: row.get(9)?,
        rhythm_counter: row.get(10)?,
        trunk_event_index: row.get(11)?,
        started_at: row.get(12)?,
        updated_at: row.get(13)?,
        completed_at: row.get(14)?,
    })
}

// ── Dialogue Turns ───────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DialogueTurnRow {
    pub id: String,
    pub session_id: String,
    pub seq: i64,
    pub role: String,
    pub content: String,
    pub scene_type: String,
    pub created_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InsertDialogueTurnInput {
    pub id: String,
    pub session_id: String,
    pub seq: i64,
    pub role: String,
    pub content: String,
    pub scene_type: String,
    pub created_at: String,
}

#[tauri::command]
pub fn insert_dialogue_turn(input: InsertDialogueTurnInput) -> Result<(), String> {
    with_db(|conn| {
        conn.execute(
            "INSERT INTO dialogue_turns (id,sessionId,seq,role,content,sceneType,createdAt)
             VALUES (?1,?2,?3,?4,?5,?6,?7)",
            params![input.id, input.session_id, input.seq, input.role, input.content, input.scene_type, input.created_at],
        )?;
        Ok(())
    })
}

#[tauri::command]
pub fn get_dialogue_turns(session_id: String) -> Result<Vec<DialogueTurnRow>, String> {
    with_db(|conn| {
        let mut stmt = conn.prepare(
            "SELECT id,sessionId,seq,role,content,sceneType,createdAt
             FROM dialogue_turns WHERE sessionId=?1 ORDER BY seq ASC"
        )?;
        let rows = stmt.query_map([&session_id], |row| Ok(DialogueTurnRow {
            id: row.get(0)?,
            session_id: row.get(1)?,
            seq: row.get(2)?,
            role: row.get(3)?,
            content: row.get(4)?,
            scene_type: row.get(5)?,
            created_at: row.get(6)?,
        }))?;
        rows.collect()
    })
}

// ── Choices ──────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChoiceRow {
    pub id: String,
    pub session_id: String,
    pub turn_id: String,
    pub choice_key: String,
    pub choice_label: String,
    pub choice_description: String,
    pub consequence_preview: String,
    pub selected_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InsertChoiceInput {
    pub id: String,
    pub session_id: String,
    pub turn_id: String,
    pub choice_key: String,
    pub choice_label: String,
    pub choice_description: String,
    pub consequence_preview: String,
    pub selected_at: String,
}

#[tauri::command]
pub fn insert_choice(input: InsertChoiceInput) -> Result<(), String> {
    with_db(|conn| {
        conn.execute(
            "INSERT INTO choices (id,sessionId,turnId,choiceKey,choiceLabel,choiceDescription,consequencePreview,selectedAt)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
            params![input.id, input.session_id, input.turn_id, input.choice_key,
                    input.choice_label, input.choice_description, input.consequence_preview, input.selected_at],
        )?;
        Ok(())
    })
}

#[tauri::command]
pub fn get_choices_for_session(session_id: String) -> Result<Vec<ChoiceRow>, String> {
    with_db(|conn| {
        let mut stmt = conn.prepare(
            "SELECT id,sessionId,turnId,choiceKey,choiceLabel,choiceDescription,consequencePreview,selectedAt
             FROM choices WHERE sessionId=?1 ORDER BY selectedAt ASC"
        )?;
        let rows = stmt.query_map([&session_id], |row| Ok(ChoiceRow {
            id: row.get(0)?,
            session_id: row.get(1)?,
            turn_id: row.get(2)?,
            choice_key: row.get(3)?,
            choice_label: row.get(4)?,
            choice_description: row.get(5)?,
            consequence_preview: row.get(6)?,
            selected_at: row.get(7)?,
        }))?;
        rows.collect()
    })
}

// ── Knowledge Entries ────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeEntryRow {
    pub id: String,
    pub learner_id: String,
    pub world_id: String,
    pub concept_key: String,
    pub domain: String,
    pub depth: i64,
    pub content_type: String,
    pub truth_mode: String,
    pub first_seen_at: String,
    pub updated_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpsertKnowledgeEntryInput {
    pub id: String,
    pub learner_id: String,
    pub world_id: String,
    pub concept_key: String,
    pub domain: String,
    pub depth: i64,
    pub content_type: String,
    pub truth_mode: String,
    pub first_seen_at: String,
    pub updated_at: String,
}

#[tauri::command]
pub fn upsert_knowledge_entry(input: UpsertKnowledgeEntryInput) -> Result<(), String> {
    with_db(|conn| {
        conn.execute(
            "INSERT INTO knowledge_entries
             (id,learnerId,worldId,conceptKey,domain,depth,contentType,truthMode,firstSeenAt,updatedAt)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)
             ON CONFLICT(learnerId,worldId,conceptKey) DO UPDATE SET
               domain=excluded.domain,
               depth=MAX(knowledge_entries.depth, excluded.depth),
               contentType=excluded.contentType,
               truthMode=excluded.truthMode,
               updatedAt=excluded.updatedAt",
            params![input.id, input.learner_id, input.world_id, input.concept_key,
                    input.domain, input.depth, input.content_type, input.truth_mode,
                    input.first_seen_at, input.updated_at],
        )?;
        Ok(())
    })
}

#[tauri::command]
pub fn get_knowledge_entries(learner_id: String, world_id: Option<String>) -> Result<Vec<KnowledgeEntryRow>, String> {
    with_db(|conn| {
        let rows: Vec<KnowledgeEntryRow> = if let Some(wid) = world_id {
            let mut stmt = conn.prepare(
                "SELECT id,learnerId,worldId,conceptKey,domain,depth,contentType,truthMode,firstSeenAt,updatedAt
                 FROM knowledge_entries WHERE learnerId=?1 AND worldId=?2"
            )?;
            let results = stmt.query_map(params![learner_id, wid], row_to_knowledge_entry)?.collect::<rusqlite::Result<Vec<_>>>()?;
            results
        } else {
            let mut stmt = conn.prepare(
                "SELECT id,learnerId,worldId,conceptKey,domain,depth,contentType,truthMode,firstSeenAt,updatedAt
                 FROM knowledge_entries WHERE learnerId=?1"
            )?;
            let results = stmt.query_map([&learner_id], row_to_knowledge_entry)?.collect::<rusqlite::Result<Vec<_>>>()?;
            results
        };
        Ok(rows)
    })
}

fn row_to_knowledge_entry(row: &rusqlite::Row<'_>) -> rusqlite::Result<KnowledgeEntryRow> {
    Ok(KnowledgeEntryRow {
        id: row.get(0)?,
        learner_id: row.get(1)?,
        world_id: row.get(2)?,
        concept_key: row.get(3)?,
        domain: row.get(4)?,
        depth: row.get(5)?,
        content_type: row.get(6)?,
        truth_mode: row.get(7)?,
        first_seen_at: row.get(8)?,
        updated_at: row.get(9)?,
    })
}

// ── Chapter Progress ──────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChapterProgressRow {
    pub id: String,
    pub learner_id: String,
    pub session_id: String,
    pub world_id: String,
    pub chapter_index: i64,
    pub title: String,
    pub summary: String,
    pub verification_score: Option<f64>,
    pub metacognition_completed: bool,
    pub started_at: String,
    pub completed_at: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpsertChapterProgressInput {
    pub id: String,
    pub learner_id: String,
    pub session_id: String,
    pub world_id: String,
    pub chapter_index: i64,
    pub title: String,
    pub summary: String,
    pub verification_score: Option<f64>,
    pub metacognition_completed: bool,
    pub started_at: String,
    pub completed_at: Option<String>,
}

#[tauri::command]
pub fn upsert_chapter_progress(input: UpsertChapterProgressInput) -> Result<(), String> {
    with_db(|conn| {
        conn.execute(
            "INSERT INTO chapter_progress
             (id,learnerId,sessionId,worldId,chapterIndex,title,summary,verificationScore,metacognitionCompleted,startedAt,completedAt)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)
             ON CONFLICT(id) DO UPDATE SET
               title=excluded.title, summary=excluded.summary,
               verificationScore=excluded.verificationScore,
               metacognitionCompleted=excluded.metacognitionCompleted,
               completedAt=excluded.completedAt",
            params![
                input.id, input.learner_id, input.session_id, input.world_id,
                input.chapter_index, input.title, input.summary,
                input.verification_score, input.metacognition_completed as i64,
                input.started_at, input.completed_at
            ],
        )?;
        Ok(())
    })
}

#[tauri::command]
pub fn get_chapter_progress(learner_id: String, session_id: Option<String>) -> Result<Vec<ChapterProgressRow>, String> {
    with_db(|conn| {
        let rows = if let Some(sid) = session_id {
            let mut stmt = conn.prepare(
                "SELECT id,learnerId,sessionId,worldId,chapterIndex,title,summary,verificationScore,metacognitionCompleted,startedAt,completedAt
                 FROM chapter_progress WHERE learnerId=?1 AND sessionId=?2 ORDER BY chapterIndex ASC"
            )?;
            let results = stmt.query_map(params![learner_id, sid], row_to_chapter_progress)?.collect::<rusqlite::Result<Vec<_>>>()?;
            results
        } else {
            let mut stmt = conn.prepare(
                "SELECT id,learnerId,sessionId,worldId,chapterIndex,title,summary,verificationScore,metacognitionCompleted,startedAt,completedAt
                 FROM chapter_progress WHERE learnerId=?1 ORDER BY startedAt DESC"
            )?;
            let results = stmt.query_map([&learner_id], row_to_chapter_progress)?.collect::<rusqlite::Result<Vec<_>>>()?;
            results
        };
        Ok(rows)
    })
}

fn row_to_chapter_progress(row: &rusqlite::Row<'_>) -> rusqlite::Result<ChapterProgressRow> {
    Ok(ChapterProgressRow {
        id: row.get(0)?,
        learner_id: row.get(1)?,
        session_id: row.get(2)?,
        world_id: row.get(3)?,
        chapter_index: row.get(4)?,
        title: row.get(5)?,
        summary: row.get(6)?,
        verification_score: row.get(7)?,
        metacognition_completed: row.get::<_, i64>(8)? != 0,
        started_at: row.get(9)?,
        completed_at: row.get(10)?,
    })
}

// ── Achievements ──────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AchievementRow {
    pub id: String,
    pub learner_id: String,
    pub achievement_key: String,
    pub unlocked_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UnlockAchievementInput {
    pub id: String,
    pub learner_id: String,
    pub achievement_key: String,
    pub unlocked_at: String,
}

#[tauri::command]
pub fn unlock_achievement(input: UnlockAchievementInput) -> Result<(), String> {
    with_db(|conn| {
        conn.execute(
            "INSERT OR IGNORE INTO achievements (id,learnerId,achievementKey,unlockedAt)
             VALUES (?1,?2,?3,?4)",
            params![input.id, input.learner_id, input.achievement_key, input.unlocked_at],
        )?;
        Ok(())
    })
}

#[tauri::command]
pub fn get_achievements(learner_id: String) -> Result<Vec<AchievementRow>, String> {
    with_db(|conn| {
        let mut stmt = conn.prepare(
            "SELECT id,learnerId,achievementKey,unlockedAt
             FROM achievements WHERE learnerId=?1 ORDER BY unlockedAt DESC"
        )?;
        let rows = stmt.query_map([&learner_id], |row| Ok(AchievementRow {
            id: row.get(0)?,
            learner_id: row.get(1)?,
            achievement_key: row.get(2)?,
            unlocked_at: row.get(3)?,
        }))?;
        rows.collect()
    })
}

// ── Learner Context Notes ─────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LearnerContextNoteRow {
    pub id: String,
    pub learner_id: String,
    pub source_type: String,
    pub note_type: String,
    pub note_key: String,
    pub note_value: String,
    pub status: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InsertContextNoteInput {
    pub id: String,
    pub learner_id: String,
    pub source_type: String,
    pub note_type: String,
    pub note_key: String,
    pub note_value: String,
    pub status: String,
    pub created_at: String,
    pub updated_at: String,
}

#[tauri::command]
pub fn insert_learner_context_note(input: InsertContextNoteInput) -> Result<(), String> {
    with_db(|conn| {
        conn.execute(
            "INSERT INTO learner_context_notes (id,learnerId,sourceType,noteType,noteKey,noteValue,status,createdAt,updatedAt)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)",
            params![input.id, input.learner_id, input.source_type, input.note_type,
                    input.note_key, input.note_value, input.status, input.created_at, input.updated_at],
        )?;
        Ok(())
    })
}

#[tauri::command]
pub fn get_learner_context_notes(learner_id: String, status: Option<String>) -> Result<Vec<LearnerContextNoteRow>, String> {
    with_db(|conn| {
        let rows = if let Some(s) = status {
            let mut stmt = conn.prepare(
                "SELECT id,learnerId,sourceType,noteType,noteKey,noteValue,status,createdAt,updatedAt
                 FROM learner_context_notes WHERE learnerId=?1 AND status=?2 ORDER BY createdAt ASC"
            )?;
            let results = stmt.query_map(params![learner_id, s], row_to_context_note)?.collect::<rusqlite::Result<Vec<_>>>()?;
            results
        } else {
            let mut stmt = conn.prepare(
                "SELECT id,learnerId,sourceType,noteType,noteKey,noteValue,status,createdAt,updatedAt
                 FROM learner_context_notes WHERE learnerId=?1 ORDER BY createdAt ASC"
            )?;
            let results = stmt.query_map([&learner_id], row_to_context_note)?.collect::<rusqlite::Result<Vec<_>>>()?;
            results
        };
        Ok(rows)
    })
}

fn row_to_context_note(row: &rusqlite::Row<'_>) -> rusqlite::Result<LearnerContextNoteRow> {
    Ok(LearnerContextNoteRow {
        id: row.get(0)?,
        learner_id: row.get(1)?,
        source_type: row.get(2)?,
        note_type: row.get(3)?,
        note_key: row.get(4)?,
        note_value: row.get(5)?,
        status: row.get(6)?,
        created_at: row.get(7)?,
        updated_at: row.get(8)?,
    })
}
