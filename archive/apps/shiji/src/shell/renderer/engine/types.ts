// ── Content Classification (SJ-content-classification.yaml) ──────────────

export type ContentType = 'history' | 'literature' | 'mythology';
export type TruthMode = 'factual' | 'dramatized' | 'legendary';

export type ClassificationPair = {
  contentType: ContentType;
  truthMode: TruthMode;
};

export const ALLOWED_CLASSIFICATION_PAIRS: ClassificationPair[] = [
  { contentType: 'history', truthMode: 'factual' },
  { contentType: 'literature', truthMode: 'dramatized' },
  { contentType: 'mythology', truthMode: 'legendary' },
];

export function isValidClassificationPair(pair: ClassificationPair): boolean {
  return ALLOWED_CLASSIFICATION_PAIRS.some(
    (p) => p.contentType === pair.contentType && p.truthMode === pair.truthMode,
  );
}

// ── Scene Types (SJ-DIAL-006:8) ──────────────────────────────────────────
// ShiJi app-layer enums; NOT from Realm /scenes endpoint

export type SceneType = 'crisis' | 'campfire' | 'verification' | 'metacognition' | 'transition';

// ── Session State ─────────────────────────────────────────────────────────

export type SessionStatus = 'active' | 'paused' | 'completed' | 'abandoned';

export type DialogueSession = {
  id: string;
  learnerId: string;
  learnerProfileVersion: number;
  worldId: string;
  agentId: string;
  contentType: ContentType;
  truthMode: TruthMode;
  sessionStatus: SessionStatus;
  chapterIndex: number;
  sceneType: SceneType;
  rhythmCounter: number;
  trunkEventIndex: number;
  startedAt: string;
  updatedAt: string;
  completedAt: string | null;
};

// ── Dialogue Turn ─────────────────────────────────────────────────────────

export type TurnRole = 'user' | 'assistant' | 'system';

export type DialogueTurn = {
  id: string;
  sessionId: string;
  seq: number;
  role: TurnRole;
  content: string;
  sceneType: SceneType;
  createdAt: string;
};

// ── Choices ───────────────────────────────────────────────────────────────

export type Choice = {
  key: string;
  label: string;
  description: string;
  consequencePreview: string;
};

export type ParsedChoices = {
  choices: Choice[];
  /** True if this is a crisis scene that requires choices */
  isCrisisScene: boolean;
};

// ── Context Assembly (SJ-DIAL-002) ───────────────────────────────────────

export type AssembledContext = {
  worldRules: string;
  agentRules: string;
  lorebooks: LoreEntry[];
  sessionSnapshot: SessionSnapshot;
  trunkEvents: TrunkEvent[];
  learnerProfile: LearnerProfileContext;
  dialogueHistory: DialogueTurn[];
  knowledgeFlags: KnowledgeFlag[];
  agentMemory: string;
  temporalContext: TemporalContext;
  sceneContext: SceneContext | null;
  adaptationNotes: string;
};

export type SessionSnapshot = {
  worldId: string;
  agentId: string;
  contentType: ContentType;
  truthMode: TruthMode;
  chapterIndex: number;
  sceneType: SceneType;
  rhythmCounter: number;
  trunkEventIndex: number;
};

export type LearnerProfileContext = {
  age: number;
  interestTags: string[];
  strengthTags: string[];
  communicationStyle: string;
  guardianGuidance: string;
  guardianGoals: string;
};

export type LoreEntry = {
  key: string;
  value: string;
};

export type TrunkEvent = {
  index: number;
  title: string;
  content: string;
  requiresChoice: boolean;
};

export type KnowledgeFlag = {
  conceptKey: string;
  domain: string;
  depth: number;
};

export type TemporalContext = {
  /** Chinese era notation, e.g. "建安十二年" */
  eraNotation: string;
  /** Gregorian CE year */
  ceYear: number;
  /** Display string: "建安十二年（公元207年）" */
  displayLabel: string;
};

export type SceneContext = {
  locationName: string;
  setting: string;
};

// ── Pacing (SJ-DIAL-006) ─────────────────────────────────────────────────

export type PacingDecision = {
  nextSceneType: SceneType;
  rhythmCounter: number;
  shouldTriggerVerification: boolean;
  shouldTriggerMetacognition: boolean;
};

// ── Generation Result ─────────────────────────────────────────────────────

export type GenerationChunk = {
  text: string;
  done: boolean;
};

export type GenerationResult = {
  fullText: string;
  interrupted: boolean;
};
