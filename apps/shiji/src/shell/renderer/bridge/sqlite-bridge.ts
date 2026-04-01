import { invokeChecked } from './invoke.js';

// ── Types (mirror Rust query.rs structs) ─────────────────────────────────

export type LearnerProfile = {
  id: string;
  authUserId: string;
  displayName: string;
  age: number;
  communicationStyle: string;
  guardianGoals: string;
  profileVersion: number;
  isActive: boolean;
  encounterCompletedAt: string | null;
  createdAt: string;
  updatedAt: string;
  strengthTags: string; // JSON string — parse on use
  interestTags: string; // JSON string
  supportNotes: string; // JSON string
  guardianGuidance: string; // JSON string
};

export type Session = {
  id: string;
  learnerId: string;
  learnerProfileVersion: number;
  worldId: string;
  agentId: string;
  contentType: string;
  truthMode: string;
  sessionStatus: string;
  chapterIndex: number;
  sceneType: string;
  rhythmCounter: number;
  trunkEventIndex: number;
  startedAt: string;
  updatedAt: string;
  completedAt: string | null;
};

export type DialogueTurn = {
  id: string;
  sessionId: string;
  seq: number;
  role: string;
  content: string;
  sceneType: string;
  createdAt: string;
};

export type Choice = {
  id: string;
  sessionId: string;
  turnId: string;
  choiceKey: string;
  choiceLabel: string;
  choiceDescription: string;
  consequencePreview: string;
  selectedAt: string;
};

export type KnowledgeEntry = {
  id: string;
  learnerId: string;
  worldId: string;
  conceptKey: string;
  domain: string;
  depth: number;
  contentType: string;
  truthMode: string;
  firstSeenAt: string;
  updatedAt: string;
};

export type ChapterProgress = {
  id: string;
  learnerId: string;
  sessionId: string;
  worldId: string;
  chapterIndex: number;
  title: string;
  summary: string;
  verificationScore: number | null;
  metacognitionCompleted: boolean;
  startedAt: string;
  completedAt: string | null;
};

export type Achievement = {
  id: string;
  learnerId: string;
  achievementKey: string;
  unlockedAt: string;
};

export type LearnerContextNote = {
  id: string;
  learnerId: string;
  sourceType: string;
  noteType: string;
  noteKey: string;
  noteValue: string;
  status: string;
  createdAt: string;
  updatedAt: string;
};

// ── Parse helpers ─────────────────────────────────────────────────────────

function parseProfile(raw: unknown): LearnerProfile {
  const r = raw as Record<string, unknown>;
  return {
    id: String(r['id'] ?? ''),
    authUserId: String(r['authUserId'] ?? ''),
    displayName: String(r['displayName'] ?? ''),
    age: Number(r['age'] ?? 0),
    communicationStyle: String(r['communicationStyle'] ?? ''),
    guardianGoals: String(r['guardianGoals'] ?? ''),
    profileVersion: Number(r['profileVersion'] ?? 1),
    isActive: Boolean(r['isActive']),
    encounterCompletedAt: r['encounterCompletedAt'] != null ? String(r['encounterCompletedAt']) : null,
    createdAt: String(r['createdAt'] ?? ''),
    updatedAt: String(r['updatedAt'] ?? ''),
    strengthTags: String(r['strengthTags'] ?? '[]'),
    interestTags: String(r['interestTags'] ?? '[]'),
    supportNotes: String(r['supportNotes'] ?? '[]'),
    guardianGuidance: String(r['guardianGuidance'] ?? '{}'),
  };
}

function parseSession(raw: unknown): Session {
  const r = raw as Record<string, unknown>;
  return {
    id: String(r['id'] ?? ''),
    learnerId: String(r['learnerId'] ?? ''),
    learnerProfileVersion: Number(r['learnerProfileVersion'] ?? 1),
    worldId: String(r['worldId'] ?? ''),
    agentId: String(r['agentId'] ?? ''),
    contentType: String(r['contentType'] ?? ''),
    truthMode: String(r['truthMode'] ?? ''),
    sessionStatus: String(r['sessionStatus'] ?? ''),
    chapterIndex: Number(r['chapterIndex'] ?? 1),
    sceneType: String(r['sceneType'] ?? 'campfire'),
    rhythmCounter: Number(r['rhythmCounter'] ?? 0),
    trunkEventIndex: Number(r['trunkEventIndex'] ?? 0),
    startedAt: String(r['startedAt'] ?? ''),
    updatedAt: String(r['updatedAt'] ?? ''),
    completedAt: r['completedAt'] != null ? String(r['completedAt']) : null,
  };
}

// ── Learner Profile commands ──────────────────────────────────────────────

export type CreateProfileInput = {
  id: string;
  authUserId: string;
  displayName: string;
  age: number;
  communicationStyle: string;
  guardianGoals: string;
  strengthTags: string;
  interestTags: string;
  supportNotes: string;
  guardianGuidance: string;
  createdAt: string;
  updatedAt: string;
};

export async function sqliteCreateLearnerProfile(input: CreateProfileInput): Promise<LearnerProfile> {
  return invokeChecked('create_learner_profile', input, parseProfile);
}

export async function sqliteGetLearnerProfiles(authUserId: string): Promise<LearnerProfile[]> {
  return invokeChecked('get_learner_profiles', { authUserId }, (v) => (v as unknown[]).map(parseProfile));
}

export type UpdateProfileInput = {
  id: string;
  displayName: string;
  age: number;
  communicationStyle: string;
  guardianGoals: string;
  strengthTags: string;
  interestTags: string;
  supportNotes: string;
  guardianGuidance: string;
  encounterCompletedAt: string | null;
  updatedAt: string;
};

export async function sqliteUpdateLearnerProfile(input: UpdateProfileInput): Promise<LearnerProfile> {
  return invokeChecked('update_learner_profile', input, parseProfile);
}

export async function sqliteSetActiveProfile(authUserId: string, profileId: string): Promise<void> {
  return invokeChecked('set_active_profile', { authUserId, profileId }, () => undefined);
}

// ── Session commands ──────────────────────────────────────────────────────

export type CreateSessionInput = {
  id: string;
  learnerId: string;
  learnerProfileVersion: number;
  worldId: string;
  agentId: string;
  contentType: string;
  truthMode: string;
  startedAt: string;
  updatedAt: string;
};

export async function sqliteCreateSession(input: CreateSessionInput): Promise<Session> {
  return invokeChecked('create_session', input, parseSession);
}

export async function sqliteGetSession(sessionId: string): Promise<Session | null> {
  return invokeChecked('get_session', { sessionId }, (v) => v != null ? parseSession(v) : null);
}

export type UpdateSessionInput = {
  id: string;
  sessionStatus: string;
  chapterIndex: number;
  sceneType: string;
  rhythmCounter: number;
  trunkEventIndex: number;
  updatedAt: string;
  completedAt: string | null;
};

export async function sqliteUpdateSession(input: UpdateSessionInput): Promise<Session> {
  return invokeChecked('update_session', input, parseSession);
}

export async function sqliteGetSessionsForLearner(learnerId: string): Promise<Session[]> {
  return invokeChecked('get_sessions_for_learner', { learnerId }, (v) => (v as unknown[]).map(parseSession));
}

// ── Dialogue Turn commands ────────────────────────────────────────────────

export async function sqliteInsertDialogueTurn(turn: Omit<DialogueTurn, never>): Promise<void> {
  return invokeChecked('insert_dialogue_turn', turn, () => undefined);
}

export async function sqliteGetDialogueTurns(sessionId: string): Promise<DialogueTurn[]> {
  return invokeChecked('get_dialogue_turns', { sessionId }, (v) => v as DialogueTurn[]);
}

// ── Choice commands ───────────────────────────────────────────────────────

export async function sqliteInsertChoice(choice: Choice): Promise<void> {
  return invokeChecked('insert_choice', choice, () => undefined);
}

export async function sqliteGetChoicesForSession(sessionId: string): Promise<Choice[]> {
  return invokeChecked('get_choices_for_session', { sessionId }, (v) => v as Choice[]);
}

// ── Knowledge Entry commands ──────────────────────────────────────────────

export async function sqliteUpsertKnowledgeEntry(entry: KnowledgeEntry): Promise<void> {
  return invokeChecked('upsert_knowledge_entry', entry, () => undefined);
}

export async function sqliteGetKnowledgeEntries(learnerId: string, worldId?: string): Promise<KnowledgeEntry[]> {
  return invokeChecked('get_knowledge_entries', { learnerId, worldId: worldId ?? null }, (v) => v as KnowledgeEntry[]);
}

// ── Chapter Progress commands ─────────────────────────────────────────────

export async function sqliteUpsertChapterProgress(progress: ChapterProgress): Promise<void> {
  return invokeChecked('upsert_chapter_progress', progress, () => undefined);
}

export async function sqliteGetChapterProgress(learnerId: string, sessionId?: string): Promise<ChapterProgress[]> {
  return invokeChecked('get_chapter_progress', { learnerId, sessionId: sessionId ?? null }, (v) => v as ChapterProgress[]);
}

// ── Achievement commands ──────────────────────────────────────────────────

export async function sqliteUnlockAchievement(achievement: Achievement): Promise<void> {
  return invokeChecked('unlock_achievement', achievement, () => undefined);
}

export async function sqliteGetAchievements(learnerId: string): Promise<Achievement[]> {
  return invokeChecked('get_achievements', { learnerId }, (v) => v as Achievement[]);
}

// ── Context Note commands ─────────────────────────────────────────────────

export async function sqliteInsertContextNote(note: LearnerContextNote): Promise<void> {
  return invokeChecked('insert_learner_context_note', note, () => undefined);
}

export async function sqliteGetContextNotes(learnerId: string, status?: string): Promise<LearnerContextNote[]> {
  return invokeChecked('get_learner_context_notes', { learnerId, status: status ?? null }, (v) => v as LearnerContextNote[]);
}
