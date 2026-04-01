/**
 * context-assembler.ts — SJ-DIAL-002
 * Assembles all 10 context sources for dialogue prompt construction.
 *
 * Sources:
 *  1. Catalog metadata (world-catalog.yaml)
 *  2. Learner profile (app store / SQLite)
 *  3. Learner adaptation notes (local SQLite)
 *  4. WorldRules (Realm API, cached 15 min)
 *  5. AgentRules (Realm API, cached 15 min)
 *  6. Lorebook entries (Realm API, cached 15 min)
 *  7. Trunk events (Realm API / world history, cached 30 min)
 *  8. Agent DYADIC memory (Realm API, cached 15 min)
 *  9. Session state (local SQLite, always fresh)
 * 10. Dialogue history (local SQLite, always fresh)
 *
 * Cache TTLs per SJ-DIAL-002: 15 min for WorldRules/AgentRules/Lorebooks,
 * 30 min for trunk events. Local state is always read fresh.
 */
import {
  sqliteGetSession,
  sqliteGetDialogueTurns,
  sqliteGetKnowledgeEntries,
  sqliteGetContextNotes,
} from '@renderer/bridge/sqlite-bridge.js';
import { getWorldRules, getAgentRules, getLorebooks } from '@renderer/data/content-client.js';
import { recallAgentMemory } from '@renderer/data/memory-client.js';
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

// ── Constants ─────────────────────────────────────────────────────────────

const DIALOGUE_HISTORY_WINDOW = 20; // SJ-DIAL-009:3
const TTL_REALM_DEFAULT_MS = 15 * 60 * 1000; // 15 min
const TTL_TRUNK_EVENTS_MS = 30 * 60 * 1000;  // 30 min

// ── TTL cache ─────────────────────────────────────────────────────────────

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

/** Clear all cached context (e.g. on session switch). */
export function clearContextCache(): void {
  cache.clear();
}

// ── Helpers ───────────────────────────────────────────────────────────────

function safeStringify(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!value) return '';
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function safeParseJson<T>(value: string | undefined | null, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

// ── Main assembler ────────────────────────────────────────────────────────

export async function assembleContext(sessionId: string): Promise<AssembledContext> {
  // ── 1. Session state (always fresh) ────────────────────────────────────
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

  // ── 2. Learner profile (from Zustand store — already parsed) ───────────
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

  // ── 3. Learner adaptation notes (always fresh) ─────────────────────────
  const contextNotes = await sqliteGetContextNotes(session.learnerId, 'approved');
  const adaptationNotes = contextNotes
    .map((n) => `${n.noteKey}: ${n.noteValue}`)
    .join('\n');

  // ── 4. Dialogue history (always fresh, last 20 turns) ──────────────────
  const allTurns = await sqliteGetDialogueTurns(sessionId);
  const recentTurns = allTurns.slice(-DIALOGUE_HISTORY_WINDOW);
  const dialogueHistory: DialogueTurn[] = recentTurns.map((t) => ({
    id: t.id,
    sessionId: t.sessionId,
    seq: t.seq,
    role: t.role as TurnRole,
    content: t.content,
    sceneType: t.sceneType as SceneType,
    createdAt: t.createdAt,
  }));

  // ── 5. Knowledge flags (always fresh) ──────────────────────────────────
  const knowledgeEntries = await sqliteGetKnowledgeEntries(
    session.learnerId,
    session.worldId,
  );
  const knowledgeFlags: KnowledgeFlag[] = knowledgeEntries.map((e) => ({
    conceptKey: e.conceptKey,
    domain: e.domain,
    depth: e.depth,
  }));

  // ── 6. WorldRules (cached 15 min) ─────────────────────────────────────
  const worldRulesKey = `wr:${session.worldId}`;
  let worldRules = getCached<string>(worldRulesKey);
  if (worldRules === null) {
    const raw = await getWorldRules(session.worldId);
    worldRules = safeStringify(raw);
    setCached(worldRulesKey, worldRules, TTL_REALM_DEFAULT_MS);
  }

  // ── 7. AgentRules (cached 15 min) ─────────────────────────────────────
  const agentRulesKey = `ar:${session.worldId}:${session.agentId}`;
  let agentRules = getCached<string>(agentRulesKey);
  if (agentRules === null) {
    const raw = await getAgentRules(session.worldId, session.agentId);
    agentRules = safeStringify(raw);
    setCached(agentRulesKey, agentRules, TTL_REALM_DEFAULT_MS);
  }

  // ── 8. Lorebook entries (cached 15 min) ────────────────────────────────
  const lorebookKey = `lb:${session.worldId}`;
  let lorebooks = getCached<LoreEntry[]>(lorebookKey);
  if (lorebooks === null) {
    const raw = await getLorebooks(session.worldId);
    lorebooks = normalizeLorebookEntries(raw);
    setCached(lorebookKey, lorebooks, TTL_REALM_DEFAULT_MS);
  }

  // ── 9. Trunk events — Phase 2 (endpoint unavailable) ─────────────────
  // SJ-DIAL-007 Phase 2 note: pipeline runs without trunk convergence.
  // Empty array is the honest representation; NOT a fallback.
  const trunkEvents: TrunkEvent[] = [];

  // ── 10. Agent DYADIC memory (cached 15 min) ───────────────────────────
  const memoryKey = `mem:${session.agentId}:${session.learnerId}`;
  let agentMemory = getCached<string>(memoryKey);
  if (agentMemory === null) {
    const raw = await recallAgentMemory(session.agentId, session.learnerId);
    agentMemory = safeStringify(raw);
    setCached(memoryKey, agentMemory, TTL_REALM_DEFAULT_MS);
  }

  // ── Temporal context ──────────────────────────────────────────────────
  const temporalContext = getInitialTemporalContext(session.worldId);

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
    temporalContext,
    sceneContext: null, // Phase 3: scene location metadata from Realm
    adaptationNotes,
  };
}

// ── Lorebook normalization ──────────────────────────────────────────────

function normalizeLorebookEntries(raw: unknown): LoreEntry[] {
  if (!raw || typeof raw !== 'object') return [];
  const record = raw as Record<string, unknown>;

  // API may return { data: [...] }, { entries: [...] }, or a raw array
  const entries: unknown[] = Array.isArray(raw)
    ? raw
    : Array.isArray(record['data'])
      ? (record['data'] as unknown[])
      : Array.isArray(record['entries'])
        ? (record['entries'] as unknown[])
        : [];

  return entries
    .map((e): LoreEntry | null => {
      if (!e || typeof e !== 'object') return null;
      const entry = e as Record<string, unknown>;
      const key = String(
        entry['key'] || entry['keyword'] || entry['name'] || '',
      );
      const value = String(
        entry['value'] || entry['content'] || entry['description'] || '',
      );
      if (!key) return null;
      return { key, value };
    })
    .filter((e): e is LoreEntry => e !== null);
}

// ── Trunk event loading — Phase 2 ──────────────────────────────────────
// SJ-DIAL-007 Phase 2 note: trunk events require GET /api/world/by-id/{worldId}/events
// which is not yet available. Trunk event loading will be implemented when the endpoint ships.
