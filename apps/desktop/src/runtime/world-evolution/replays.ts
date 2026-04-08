import type {
  WorldEvolutionEvidenceRef,
  WorldEvolutionReplaySelector,
  WorldEvolutionReplayView,
} from '@nimiplatform/sdk/runtime';

import { createSecureIdSuffix } from '../id.js';

const MAX_REPLAYS = 1000;

type DesktopReplayRecord = {
  replayRefId: string;
  createdAt: string;
  settledAt?: string;
  outcomeStatus: 'pending' | 'passed' | 'failed';
  outcomeReason?: string;
  view: WorldEvolutionReplayView;
};

const replayRecords: DesktopReplayRecord[] = [];

function normalizeText(value: unknown): string {
  return String(value || '').trim();
}

function normalizeOptionalText(value: unknown): string | undefined {
  const normalized = normalizeText(value);
  return normalized || undefined;
}

function normalizeTick(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
    ? value
    : undefined;
}

function createReplayRefId(): string {
  return `wee:replay:${Date.now().toString(36)}:${createSecureIdSuffix()}`;
}

function createReplayRef(refId: string): WorldEvolutionEvidenceRef {
  return {
    kind: 'replay',
    refId,
  };
}

function cloneReplayRef(replayRef: WorldEvolutionEvidenceRef): WorldEvolutionEvidenceRef {
  return replayRef.uri
    ? {
      kind: replayRef.kind,
      refId: replayRef.refId,
      uri: replayRef.uri,
    }
    : {
      kind: replayRef.kind,
      refId: replayRef.refId,
    };
}

function cloneReplayView(view: WorldEvolutionReplayView): WorldEvolutionReplayView {
  return {
    replayRef: cloneReplayRef(view.replayRef),
    replayMode: view.replayMode,
    ...(view.replayResult ? { replayResult: view.replayResult } : {}),
    ...(view.worldId ? { worldId: view.worldId } : {}),
    ...(view.sessionId ? { sessionId: view.sessionId } : {}),
    ...(view.traceId ? { traceId: view.traceId } : {}),
    ...(view.eventId ? { eventId: view.eventId } : {}),
    ...(view.tick !== undefined ? { tick: view.tick } : {}),
  };
}

function appendReplayRecord(record: DesktopReplayRecord): void {
  replayRecords.push(record);
  if (replayRecords.length > MAX_REPLAYS) {
    replayRecords.splice(0, replayRecords.length - MAX_REPLAYS);
  }
}

function matchesReplayRef(expected: WorldEvolutionEvidenceRef, actual: WorldEvolutionEvidenceRef): boolean {
  if (expected.kind !== actual.kind || expected.refId !== actual.refId) {
    return false;
  }
  return expected.uri === undefined || expected.uri === actual.uri;
}

function matchesReplayFilter(
  view: WorldEvolutionReplayView,
  selector: WorldEvolutionReplaySelector,
): boolean {
  if (selector.replayRef && !matchesReplayRef(selector.replayRef, view.replayRef)) return false;
  if (selector.replayMode && view.replayMode !== selector.replayMode) return false;
  if (selector.worldId && view.worldId !== selector.worldId) return false;
  if (selector.sessionId && view.sessionId !== selector.sessionId) return false;
  if (selector.traceId && view.traceId !== selector.traceId) return false;
  if (selector.eventId && view.eventId !== selector.eventId) return false;
  if (selector.tick !== undefined && view.tick !== selector.tick) return false;
  return true;
}

export function createDesktopWorldEvolutionReplayRecord(input: {
  replayMode: string;
  replayResult?: string;
  worldId?: string;
  sessionId?: string;
  traceId?: string;
  eventId?: string;
  tick?: number;
}): DesktopReplayRecord | null {
  const replayMode = normalizeText(input.replayMode);
  if (!replayMode) {
    return null;
  }
  const replayRefId = createReplayRefId();
  const record: DesktopReplayRecord = {
    replayRefId,
    createdAt: new Date().toISOString(),
    outcomeStatus: 'pending',
    view: {
      replayRef: createReplayRef(replayRefId),
      replayMode,
      ...(normalizeOptionalText(input.replayResult) ? { replayResult: normalizeOptionalText(input.replayResult) } : {}),
      ...(normalizeOptionalText(input.worldId) ? { worldId: normalizeOptionalText(input.worldId) } : {}),
      ...(normalizeOptionalText(input.sessionId) ? { sessionId: normalizeOptionalText(input.sessionId) } : {}),
      ...(normalizeOptionalText(input.traceId) ? { traceId: normalizeOptionalText(input.traceId) } : {}),
      ...(normalizeOptionalText(input.eventId) ? { eventId: normalizeOptionalText(input.eventId) } : {}),
      ...(normalizeTick(input.tick) !== undefined ? { tick: normalizeTick(input.tick) } : {}),
    },
  };
  appendReplayRecord(record);
  return {
    ...record,
    view: cloneReplayView(record.view),
  };
}

export function settleDesktopWorldEvolutionReplayRecord(input: {
  replayRefId: string;
  outcomeStatus: 'passed' | 'failed';
  outcomeReason?: string;
  replayResult?: string;
  worldId?: string;
  sessionId?: string;
  traceId?: string;
  eventId?: string;
  tick?: number;
}): DesktopReplayRecord | null {
  const replayRefId = normalizeText(input.replayRefId);
  if (!replayRefId) {
    return null;
  }
  const record = replayRecords.find((entry) => entry.replayRefId === replayRefId);
  if (!record) {
    return null;
  }
  record.outcomeStatus = input.outcomeStatus;
  record.outcomeReason = normalizeOptionalText(input.outcomeReason);
  record.settledAt = new Date().toISOString();
  const replayResult = normalizeOptionalText(input.replayResult);
  const worldId = normalizeOptionalText(input.worldId);
  const sessionId = normalizeOptionalText(input.sessionId);
  const traceId = normalizeOptionalText(input.traceId);
  const eventId = normalizeOptionalText(input.eventId);
  const tick = normalizeTick(input.tick);
  record.view = {
    ...record.view,
    ...(replayResult ? { replayResult } : {}),
    ...(worldId ? { worldId } : {}),
    ...(sessionId ? { sessionId } : {}),
    ...(traceId ? { traceId } : {}),
    ...(eventId ? { eventId } : {}),
    ...(tick !== undefined ? { tick } : {}),
  };
  return {
    ...record,
    view: cloneReplayView(record.view),
  };
}

export function queryDesktopWorldEvolutionReplays(
  selector: WorldEvolutionReplaySelector,
): WorldEvolutionReplayView[] {
  return replayRecords
    .map((record) => record.view)
    .filter((view) => matchesReplayFilter(view, selector))
    .map((view) => cloneReplayView(view));
}

export function getDesktopWorldEvolutionReplayRecordsForTest(): Array<{
  replayRefId: string;
  createdAt: string;
  settledAt?: string;
  outcomeStatus: 'pending' | 'passed' | 'failed';
  outcomeReason?: string;
  view: WorldEvolutionReplayView;
}> {
  return replayRecords.map((record) => ({
    replayRefId: record.replayRefId,
    createdAt: record.createdAt,
    ...(record.settledAt ? { settledAt: record.settledAt } : {}),
    outcomeStatus: record.outcomeStatus,
    ...(record.outcomeReason ? { outcomeReason: record.outcomeReason } : {}),
    view: cloneReplayView(record.view),
  }));
}

export function clearDesktopWorldEvolutionReplaysForTest(): void {
  replayRecords.splice(0, replayRecords.length);
}
