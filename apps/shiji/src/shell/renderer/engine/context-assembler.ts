import {
  sqliteGetSession,
  sqliteGetDialogueTurns,
  sqliteGetKnowledgeEntries,
  sqliteGetContextNotes,
} from '@renderer/bridge/sqlite-bridge.js';
import {
  getWorldRules,
  getAgentRules,
  getLorebooks,
  type WorldRuleRecord,
  type AgentRuleRecord,
} from '@renderer/data/content-client.js';
import { recallAgentMemory, type AgentMemoryRecord } from '@renderer/data/memory-client.js';
import type {
  AssembledContext,
  SessionSnapshot,
  LearnerProfileContext,
  LoreEntry,
  TrunkEvent,
  KnowledgeFlag,
  ContentType,
  TruthMode,
  SceneType,
  DialogueTurn,
  TurnRole,
} from './types.js';
import { getInitialTemporalContext } from './temporal-tracker.js';
import { useAppStore } from '@renderer/app-shell/app-store.js';

const DIALOGUE_HISTORY_WINDOW = 20;
const TTL_REALM_DEFAULT_MS = 15 * 60 * 1000;

type CacheEntry<T> = { data: T; expiresAt: number };
const cache = new Map<string, CacheEntry<unknown>>();

function getCached<T>(key: string): T | null {
  const entry = cache.get(key) as CacheEntry<T> | undefined;
  if (!entry || Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return entry.data;
}

function setCached<T>(key: string, data: T, ttlMs: number): void {
  cache.set(key, { data, expiresAt: Date.now() + ttlMs });
}

export function clearContextCache(): void {
  cache.clear();
}

function formatWorldRules(rules: WorldRuleRecord[]): string {
  const lines = rules.map((rule) => `- [${rule.ruleKey}] ${rule.title}: ${rule.statement}`);
  const formatted = lines.join('\n');
  if (!formatted) {
    throw new Error('context-assembler: world rules resolved to an empty prompt block');
  }
  return formatted;
}

function formatAgentRules(rules: AgentRuleRecord[]): string {
  const lines = rules.map((rule) => `- [${rule.ruleKey}] ${rule.title}: ${rule.statement}`);
  const formatted = lines.join('\n');
  if (!formatted) {
    throw new Error('context-assembler: agent rules resolved to an empty prompt block');
  }
  return formatted;
}

function formatAgentMemory(memories: AgentMemoryRecord[]): string {
  return memories
    .map((memory) => `- (${memory.class}) ${memory.content}`)
    .join('\n');
}

function normalizeLorebooks(entries: Awaited<ReturnType<typeof getLorebooks>>): LoreEntry[] {
  return entries.map((entry) => ({
    key: entry.key,
    value: entry.content,
  }));
}

export async function assembleContext(sessionId: string): Promise<AssembledContext> {
  const session = await sqliteGetSession(sessionId);
  if (!session) {
    throw new Error(`[context-assembler] Session not found: ${sessionId}`);
  }

  const sessionSnapshot: SessionSnapshot = {
    worldId: session.worldId,
    agentId: session.agentId,
    contentType: session.contentType as ContentType,
    truthMode: session.truthMode as TruthMode,
    chapterIndex: session.chapterIndex,
    sceneType: session.sceneType as SceneType,
    rhythmCounter: session.rhythmCounter,
    trunkEventIndex: session.trunkEventIndex,
  };

  const storeState = useAppStore.getState();
  const storeProfile = storeState.activeProfile;
  if (!storeProfile) {
    throw new Error(
      '[context-assembler] No active learner profile. Stable dialogue requires a profile (SJ-SHELL-008).',
    );
  }

  const learnerProfile: LearnerProfileContext = {
    age: storeProfile.age,
    interestTags: storeProfile.interestTags,
    strengthTags: storeProfile.strengthTags,
    communicationStyle: storeProfile.communicationStyle,
    guardianGuidance: Object.values(storeProfile.guardianGuidance).join('; '),
    guardianGoals: storeProfile.guardianGoals,
  };

  const contextNotes = await sqliteGetContextNotes(session.learnerId, 'approved');
  const adaptationNotes = contextNotes.map((note) => `${note.noteKey}: ${note.noteValue}`).join('\n');

  const allTurns = await sqliteGetDialogueTurns(sessionId);
  const recentTurns = allTurns.slice(-DIALOGUE_HISTORY_WINDOW);
  const dialogueHistory: DialogueTurn[] = recentTurns.map((turn) => ({
    id: turn.id,
    sessionId: turn.sessionId,
    seq: turn.seq,
    role: turn.role as TurnRole,
    content: turn.content,
    sceneType: turn.sceneType as SceneType,
    createdAt: turn.createdAt,
  }));

  const knowledgeEntries = await sqliteGetKnowledgeEntries(session.learnerId, session.worldId);
  const knowledgeFlags: KnowledgeFlag[] = knowledgeEntries.map((entry) => ({
    conceptKey: entry.conceptKey,
    domain: entry.domain,
    depth: entry.depth,
  }));

  const worldRulesKey = `wr:${session.worldId}`;
  let worldRules = getCached<string>(worldRulesKey);
  if (worldRules === null) {
    worldRules = formatWorldRules(await getWorldRules(session.worldId));
    setCached(worldRulesKey, worldRules, TTL_REALM_DEFAULT_MS);
  }

  const agentRulesKey = `ar:${session.worldId}:${session.agentId}`;
  let agentRules = getCached<string>(agentRulesKey);
  if (agentRules === null) {
    agentRules = formatAgentRules(await getAgentRules(session.worldId, session.agentId));
    setCached(agentRulesKey, agentRules, TTL_REALM_DEFAULT_MS);
  }

  const lorebookKey = `lb:${session.worldId}`;
  let lorebooks = getCached<LoreEntry[]>(lorebookKey);
  if (lorebooks === null) {
    lorebooks = normalizeLorebooks(await getLorebooks(session.worldId));
    setCached(lorebookKey, lorebooks, TTL_REALM_DEFAULT_MS);
  }

  const trunkEvents: TrunkEvent[] = [];

  const memoryKey = `mem:${session.agentId}:${session.learnerId}`;
  let agentMemory = getCached<string>(memoryKey);
  if (agentMemory === null) {
    agentMemory = formatAgentMemory(await recallAgentMemory(session.agentId, session.learnerId));
    setCached(memoryKey, agentMemory, TTL_REALM_DEFAULT_MS);
  }

  return {
    worldRules,
    agentRules,
    lorebooks,
    sessionSnapshot,
    trunkEvents,
    learnerProfile,
    dialogueHistory,
    knowledgeFlags,
    agentMemory,
    temporalContext: getInitialTemporalContext(session.worldId),
    sceneContext: null,
    adaptationNotes,
  };
}
