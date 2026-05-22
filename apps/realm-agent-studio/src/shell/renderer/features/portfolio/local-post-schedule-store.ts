import type { LocalPostScheduleCandidate } from './post-draft.js';

export type LocalPostScheduleRecord = {
  localKey: string;
  agentId: string;
  savedAt: string;
  localRunAt: string;
  source: 'realm-agent-studio.local-single-post-schedule-store';
  appLocalOnly: true;
  execution: {
    mode: 'foreground-when-due';
    realmPublish: 'pending-owner-app-open';
  };
  candidate: LocalPostScheduleCandidate;
};

type LocalStorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const SCHEDULE_PREFIX = 'realm-agent-studio.local-post-schedule.';

function scheduleKey(agentId: string): string {
  return `${SCHEDULE_PREFIX}${agentId}`;
}

function resolveStorage(storage?: LocalStorageLike | null): LocalStorageLike | null {
  if (storage !== undefined) {
    return storage;
  }
  return typeof window !== 'undefined' ? window.localStorage : null;
}

function normalizeRecord(value: unknown, agentId: string): LocalPostScheduleRecord | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const record = value as Record<string, unknown>;
  const localKey = typeof record.localKey === 'string' && record.localKey.trim() ? record.localKey : null;
  const savedAt = typeof record.savedAt === 'string' && record.savedAt.trim() ? record.savedAt : null;
  const localRunAt = typeof record.localRunAt === 'string' && record.localRunAt.trim() ? record.localRunAt : null;
  const candidate = record.candidate && typeof record.candidate === 'object'
    ? record.candidate as LocalPostScheduleCandidate
    : null;

  if (
    !localKey
    || !savedAt
    || !localRunAt
    || record.agentId !== agentId
    || record.source !== 'realm-agent-studio.local-single-post-schedule-store'
    || record.appLocalOnly !== true
    || !candidate
    || candidate.source !== 'realm-agent-studio.local-single-post-schedule'
    || candidate.appLocalOnly !== true
  ) {
    return null;
  }

  return {
    localKey,
    agentId,
    savedAt,
    localRunAt,
    source: 'realm-agent-studio.local-single-post-schedule-store',
    appLocalOnly: true,
    execution: {
      mode: 'foreground-when-due',
      realmPublish: 'pending-owner-app-open',
    },
    candidate,
  };
}

export function loadLocalPostSchedule(agentId: string, storage?: LocalStorageLike | null): LocalPostScheduleRecord | null {
  const targetStorage = resolveStorage(storage);
  if (!targetStorage) {
    return null;
  }

  try {
    const raw = targetStorage.getItem(scheduleKey(agentId));
    return raw ? normalizeRecord(JSON.parse(raw), agentId) : null;
  } catch {
    return null;
  }
}

export function saveLocalPostSchedule(
  agentId: string,
  candidate: LocalPostScheduleCandidate,
  storage?: LocalStorageLike | null,
  now = new Date(),
): LocalPostScheduleRecord {
  const record: LocalPostScheduleRecord = {
    localKey: `${agentId}:${candidate.localRunAt}`,
    agentId,
    savedAt: now.toISOString(),
    localRunAt: candidate.localRunAt,
    source: 'realm-agent-studio.local-single-post-schedule-store',
    appLocalOnly: true,
    execution: {
      mode: 'foreground-when-due',
      realmPublish: 'pending-owner-app-open',
    },
    candidate,
  };
  const targetStorage = resolveStorage(storage);
  if (targetStorage) {
    targetStorage.setItem(scheduleKey(agentId), JSON.stringify(record));
  }
  return record;
}

export function clearLocalPostSchedule(agentId: string, storage?: LocalStorageLike | null): void {
  const targetStorage = resolveStorage(storage);
  targetStorage?.removeItem(scheduleKey(agentId));
}

export function isLocalPostScheduleDue(record: LocalPostScheduleRecord, now = new Date()): boolean {
  const runAt = new Date(record.candidate.localRunAt);
  return !Number.isNaN(runAt.getTime()) && runAt.getTime() <= now.getTime();
}
