// Relay proactive policy-store — adapted from local-chat proactive/policy-store.ts
// Adapted: uses RelayChatStorage instead of mod SDK ModKvStore

import { createRelayChatStorage, type RelayChatStorage } from '../session-store/relay-chat-storage.js';

const LOCAL_CHAT_PROACTIVE_POLICY_STORE_KEY = 'nimi.local-chat.proactive.policy.v1';

let proactivePolicyStore: RelayChatStorage | null = null;

type DailyCounter = {
  day: string;
  count: number;
};

type ProactivePolicyStoreState = {
  lastSentAtByTargetId: Record<string, number>;
  dailyByTargetId: Record<string, DailyCounter>;
};

const DEFAULT_POLICY_STORE_STATE: ProactivePolicyStoreState = {
  lastSentAtByTargetId: {},
  dailyByTargetId: {},
};

function getPolicyStore(): RelayChatStorage {
  if (!proactivePolicyStore) {
    proactivePolicyStore = createRelayChatStorage('local-chat.proactive-policy');
  }
  return proactivePolicyStore;
}

function normalizeTargetId(value: unknown): string {
  return String(value || '').trim();
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function normalizeDailyCounter(value: unknown): DailyCounter | null {
  const record = asRecord(value);
  const day = String(record.day || '').trim();
  const count = Number(record.count);
  if (!day) return null;
  if (!Number.isFinite(count) || count < 0) {
    return { day, count: 0 };
  }
  return { day, count: Math.floor(count) };
}

function normalizePolicyStoreState(value: unknown): ProactivePolicyStoreState {
  const record = asRecord(value);
  const lastRaw = asRecord(record.lastSentAtByTargetId);
  const dailyRaw = asRecord(record.dailyByTargetId);
  const lastSentAtByTargetId: Record<string, number> = {};
  const dailyByTargetId: Record<string, DailyCounter> = {};
  for (const [rawTargetId, rawValue] of Object.entries(lastRaw)) {
    const targetId = normalizeTargetId(rawTargetId);
    if (!targetId) continue;
    const parsedAt = Number(rawValue);
    if (!Number.isFinite(parsedAt) || parsedAt <= 0) continue;
    lastSentAtByTargetId[targetId] = Math.floor(parsedAt);
  }
  for (const [rawTargetId, rawValue] of Object.entries(dailyRaw)) {
    const targetId = normalizeTargetId(rawTargetId);
    if (!targetId) continue;
    const normalized = normalizeDailyCounter(rawValue);
    if (!normalized) continue;
    dailyByTargetId[targetId] = normalized;
  }
  return {
    lastSentAtByTargetId,
    dailyByTargetId,
  };
}

async function loadPolicyStoreState(): Promise<ProactivePolicyStoreState> {
  const raw = await getPolicyStore().getJson<ProactivePolicyStoreState>(LOCAL_CHAT_PROACTIVE_POLICY_STORE_KEY);
  return normalizePolicyStoreState(raw || { ...DEFAULT_POLICY_STORE_STATE });
}

async function persistPolicyStoreState(state: ProactivePolicyStoreState): Promise<void> {
  await getPolicyStore().setJson(LOCAL_CHAT_PROACTIVE_POLICY_STORE_KEY, state);
}

function dayKeyFromMs(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

export async function readProactivePolicyTargetState(input: {
  targetId: string;
  nowMs: number;
}): Promise<{
  lastSentAtMs: number;
  dailyCount: number;
}> {
  const targetId = normalizeTargetId(input.targetId);
  if (!targetId) {
    return {
      lastSentAtMs: 0,
      dailyCount: 0,
    };
  }
  const state = await loadPolicyStoreState();
  const today = dayKeyFromMs(input.nowMs);
  const daily = state.dailyByTargetId[targetId];
  const dailyCount = daily && daily.day === today ? daily.count : 0;
  if (daily && daily.day !== today) {
    state.dailyByTargetId[targetId] = { day: today, count: 0 };
    await persistPolicyStoreState(state);
  }
  return {
    lastSentAtMs: Number(state.lastSentAtByTargetId[targetId] || 0),
    dailyCount,
  };
}

export async function markProactiveContactSent(input: {
  targetId: string;
  atMs: number;
}): Promise<void> {
  const targetId = normalizeTargetId(input.targetId);
  if (!targetId) return;
  const atMs = Number(input.atMs);
  if (!Number.isFinite(atMs) || atMs <= 0) return;
  const state = await loadPolicyStoreState();
  const today = dayKeyFromMs(atMs);
  const currentDaily = state.dailyByTargetId[targetId];
  const nextCount = currentDaily && currentDaily.day === today
    ? currentDaily.count + 1
    : 1;
  state.lastSentAtByTargetId[targetId] = Math.floor(atMs);
  state.dailyByTargetId[targetId] = {
    day: today,
    count: nextCount,
  };
  await persistPolicyStoreState(state);
}
