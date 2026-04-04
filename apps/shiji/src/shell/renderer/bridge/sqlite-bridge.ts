import { invokeChecked } from './invoke.js';

export class BridgeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BridgeError';
  }
}

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
  strengthTags: string;
  interestTags: string;
  supportNotes: string;
  guardianGuidance: string;
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

type JsonRecord = Record<string, unknown>;

function expectRecord(value: unknown, label: string): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new BridgeError(`${label}: expected object`);
  }
  return value as JsonRecord;
}

function expectArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new BridgeError(`${label}: expected array`);
  }
  return value;
}

function expectString(record: JsonRecord, key: string, label: string, allowEmpty = false): string {
  const value = record[key];
  if (typeof value !== 'string') {
    throw new BridgeError(`${label}.${key}: expected string`);
  }
  const normalized = value.trim();
  if (!allowEmpty && !normalized) {
    throw new BridgeError(`${label}.${key}: expected non-empty string`);
  }
  return normalized;
}

function expectNumber(record: JsonRecord, key: string, label: string): number {
  const value = record[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new BridgeError(`${label}.${key}: expected finite number`);
  }
  return value;
}

function expectBoolean(record: JsonRecord, key: string, label: string): boolean {
  if (typeof record[key] !== 'boolean') {
    throw new BridgeError(`${label}.${key}: expected boolean`);
  }
  return record[key] as boolean;
}

function expectNullableString(record: JsonRecord, key: string, label: string): string | null {
  const value = record[key];
  if (value == null) {
    return null;
  }
  if (typeof value !== 'string') {
    throw new BridgeError(`${label}.${key}: expected string or null`);
  }
  return value.trim();
}

function expectNullableNumber(record: JsonRecord, key: string, label: string): number | null {
  const value = record[key];
  if (value == null) {
    return null;
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new BridgeError(`${label}.${key}: expected number or null`);
  }
  return value;
}

function parseProfile(raw: unknown): LearnerProfile {
  const record = expectRecord(raw, 'learner_profile');
  return {
    id: expectString(record, 'id', 'learner_profile'),
    authUserId: expectString(record, 'authUserId', 'learner_profile'),
    displayName: expectString(record, 'displayName', 'learner_profile'),
    age: expectNumber(record, 'age', 'learner_profile'),
    communicationStyle: expectString(record, 'communicationStyle', 'learner_profile', true),
    guardianGoals: expectString(record, 'guardianGoals', 'learner_profile', true),
    profileVersion: expectNumber(record, 'profileVersion', 'learner_profile'),
    isActive: expectBoolean(record, 'isActive', 'learner_profile'),
    encounterCompletedAt: expectNullableString(record, 'encounterCompletedAt', 'learner_profile'),
    createdAt: expectString(record, 'createdAt', 'learner_profile'),
    updatedAt: expectString(record, 'updatedAt', 'learner_profile'),
    strengthTags: expectString(record, 'strengthTags', 'learner_profile'),
    interestTags: expectString(record, 'interestTags', 'learner_profile'),
    supportNotes: expectString(record, 'supportNotes', 'learner_profile'),
    guardianGuidance: expectString(record, 'guardianGuidance', 'learner_profile'),
  };
}

function parseSession(raw: unknown): Session {
  const record = expectRecord(raw, 'session');
  return {
    id: expectString(record, 'id', 'session'),
    learnerId: expectString(record, 'learnerId', 'session'),
    learnerProfileVersion: expectNumber(record, 'learnerProfileVersion', 'session'),
    worldId: expectString(record, 'worldId', 'session'),
    agentId: expectString(record, 'agentId', 'session'),
    contentType: expectString(record, 'contentType', 'session'),
    truthMode: expectString(record, 'truthMode', 'session'),
    sessionStatus: expectString(record, 'sessionStatus', 'session'),
    chapterIndex: expectNumber(record, 'chapterIndex', 'session'),
    sceneType: expectString(record, 'sceneType', 'session'),
    rhythmCounter: expectNumber(record, 'rhythmCounter', 'session'),
    trunkEventIndex: expectNumber(record, 'trunkEventIndex', 'session'),
    startedAt: expectString(record, 'startedAt', 'session'),
    updatedAt: expectString(record, 'updatedAt', 'session'),
    completedAt: expectNullableString(record, 'completedAt', 'session'),
  };
}

function parseDialogueTurn(raw: unknown): DialogueTurn {
  const record = expectRecord(raw, 'dialogue_turn');
  return {
    id: expectString(record, 'id', 'dialogue_turn'),
    sessionId: expectString(record, 'sessionId', 'dialogue_turn'),
    seq: expectNumber(record, 'seq', 'dialogue_turn'),
    role: expectString(record, 'role', 'dialogue_turn'),
    content: expectString(record, 'content', 'dialogue_turn'),
    sceneType: expectString(record, 'sceneType', 'dialogue_turn'),
    createdAt: expectString(record, 'createdAt', 'dialogue_turn'),
  };
}

function parseChoice(raw: unknown): Choice {
  const record = expectRecord(raw, 'choice');
  return {
    id: expectString(record, 'id', 'choice'),
    sessionId: expectString(record, 'sessionId', 'choice'),
    turnId: expectString(record, 'turnId', 'choice'),
    choiceKey: expectString(record, 'choiceKey', 'choice'),
    choiceLabel: expectString(record, 'choiceLabel', 'choice'),
    choiceDescription: expectString(record, 'choiceDescription', 'choice', true),
    consequencePreview: expectString(record, 'consequencePreview', 'choice', true),
    selectedAt: expectString(record, 'selectedAt', 'choice', true),
  };
}

function parseKnowledgeEntry(raw: unknown): KnowledgeEntry {
  const record = expectRecord(raw, 'knowledge_entry');
  return {
    id: expectString(record, 'id', 'knowledge_entry'),
    learnerId: expectString(record, 'learnerId', 'knowledge_entry'),
    worldId: expectString(record, 'worldId', 'knowledge_entry'),
    conceptKey: expectString(record, 'conceptKey', 'knowledge_entry'),
    domain: expectString(record, 'domain', 'knowledge_entry'),
    depth: expectNumber(record, 'depth', 'knowledge_entry'),
    contentType: expectString(record, 'contentType', 'knowledge_entry'),
    truthMode: expectString(record, 'truthMode', 'knowledge_entry'),
    firstSeenAt: expectString(record, 'firstSeenAt', 'knowledge_entry'),
    updatedAt: expectString(record, 'updatedAt', 'knowledge_entry'),
  };
}

function parseChapterProgress(raw: unknown): ChapterProgress {
  const record = expectRecord(raw, 'chapter_progress');
  return {
    id: expectString(record, 'id', 'chapter_progress'),
    learnerId: expectString(record, 'learnerId', 'chapter_progress'),
    sessionId: expectString(record, 'sessionId', 'chapter_progress'),
    worldId: expectString(record, 'worldId', 'chapter_progress'),
    chapterIndex: expectNumber(record, 'chapterIndex', 'chapter_progress'),
    title: expectString(record, 'title', 'chapter_progress', true),
    summary: expectString(record, 'summary', 'chapter_progress', true),
    verificationScore: expectNullableNumber(record, 'verificationScore', 'chapter_progress'),
    metacognitionCompleted: expectBoolean(record, 'metacognitionCompleted', 'chapter_progress'),
    startedAt: expectString(record, 'startedAt', 'chapter_progress'),
    completedAt: expectNullableString(record, 'completedAt', 'chapter_progress'),
  };
}

function parseAchievement(raw: unknown): Achievement {
  const record = expectRecord(raw, 'achievement');
  return {
    id: expectString(record, 'id', 'achievement'),
    learnerId: expectString(record, 'learnerId', 'achievement'),
    achievementKey: expectString(record, 'achievementKey', 'achievement'),
    unlockedAt: expectString(record, 'unlockedAt', 'achievement'),
  };
}

function parseContextNote(raw: unknown): LearnerContextNote {
  const record = expectRecord(raw, 'learner_context_note');
  return {
    id: expectString(record, 'id', 'learner_context_note'),
    learnerId: expectString(record, 'learnerId', 'learner_context_note'),
    sourceType: expectString(record, 'sourceType', 'learner_context_note'),
    noteType: expectString(record, 'noteType', 'learner_context_note'),
    noteKey: expectString(record, 'noteKey', 'learner_context_note'),
    noteValue: expectString(record, 'noteValue', 'learner_context_note'),
    status: expectString(record, 'status', 'learner_context_note'),
    createdAt: expectString(record, 'createdAt', 'learner_context_note'),
    updatedAt: expectString(record, 'updatedAt', 'learner_context_note'),
  };
}

function parseList<T>(value: unknown, label: string, parseItem: (item: unknown) => T): T[] {
  return expectArray(value, label).map((item) => parseItem(item));
}

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
  return invokeChecked('get_learner_profiles', { authUserId }, (value) => parseList(value, 'learner_profiles', parseProfile));
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
  return invokeChecked('get_session', { sessionId }, (value) => (value == null ? null : parseSession(value)));
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
  return invokeChecked('get_sessions_for_learner', { learnerId }, (value) => parseList(value, 'sessions', parseSession));
}

export async function sqliteInsertDialogueTurn(turn: Omit<DialogueTurn, never>): Promise<void> {
  return invokeChecked('insert_dialogue_turn', turn, () => undefined);
}

export async function sqliteGetDialogueTurns(sessionId: string): Promise<DialogueTurn[]> {
  return invokeChecked('get_dialogue_turns', { sessionId }, (value) => parseList(value, 'dialogue_turns', parseDialogueTurn));
}

export async function sqliteInsertChoice(choice: Choice): Promise<void> {
  return invokeChecked('insert_choice', choice, () => undefined);
}

export async function sqliteGetChoicesForSession(sessionId: string): Promise<Choice[]> {
  return invokeChecked('get_choices_for_session', { sessionId }, (value) => parseList(value, 'choices', parseChoice));
}

export async function sqliteUpsertKnowledgeEntry(entry: KnowledgeEntry): Promise<void> {
  return invokeChecked('upsert_knowledge_entry', entry, () => undefined);
}

export async function sqliteGetKnowledgeEntries(learnerId: string, worldId?: string): Promise<KnowledgeEntry[]> {
  return invokeChecked(
    'get_knowledge_entries',
    { learnerId, worldId: worldId ?? null },
    (value) => parseList(value, 'knowledge_entries', parseKnowledgeEntry),
  );
}

export async function sqliteUpsertChapterProgress(progress: ChapterProgress): Promise<void> {
  return invokeChecked('upsert_chapter_progress', progress, () => undefined);
}

export async function sqliteGetChapterProgress(learnerId: string, sessionId?: string): Promise<ChapterProgress[]> {
  return invokeChecked(
    'get_chapter_progress',
    { learnerId, sessionId: sessionId ?? null },
    (value) => parseList(value, 'chapter_progress', parseChapterProgress),
  );
}

export async function sqliteUnlockAchievement(achievement: Achievement): Promise<void> {
  return invokeChecked('unlock_achievement', achievement, () => undefined);
}

export async function sqliteGetAchievements(learnerId: string): Promise<Achievement[]> {
  return invokeChecked('get_achievements', { learnerId }, (value) => parseList(value, 'achievements', parseAchievement));
}

export async function sqliteInsertContextNote(note: LearnerContextNote): Promise<void> {
  return invokeChecked('insert_learner_context_note', note, () => undefined);
}

export async function sqliteGetContextNotes(learnerId: string, status?: string): Promise<LearnerContextNote[]> {
  return invokeChecked(
    'get_learner_context_notes',
    { learnerId, status: status ?? null },
    (value) => parseList(value, 'learner_context_notes', parseContextNote),
  );
}
