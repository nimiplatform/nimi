import type {
  WorldEvolutionActorRef,
  WorldEvolutionCommitRequestSelector,
  WorldEvolutionCommitRequestView,
  WorldEvolutionEffectClass,
  WorldEvolutionEvidenceRef,
} from '@nimiplatform/sdk/runtime';

import { createSecureIdSuffix } from '../id.js';

const MAX_COMMIT_REQUESTS = 1000;
const EFFECT_CLASSES = new Set<WorldEvolutionEffectClass>([
  'NONE',
  'MEMORY_ONLY',
  'STATE_ONLY',
  'STATE_AND_HISTORY',
]);

type DesktopCommitRequestCandidateInput = {
  worldId: string;
  appId: string;
  sessionId: string;
  effectClass: WorldEvolutionEffectClass;
  scope: string;
  schemaId: string;
  schemaVersion: string;
  actorRefs: WorldEvolutionActorRef[];
  reason: string;
  evidenceRefs?: WorldEvolutionEvidenceRef[];
  sourceEventIds?: string[];
  traceId?: string;
  tick?: number;
  causation?: string;
  correlation?: string;
  checkpointRefs?: string[];
  supervisionRefs?: string[];
};

type DesktopCommitRequestRecord = {
  commitRequestRecordId: string;
  createdAt: string;
  settledAt?: string;
  outcomeStatus: 'pending' | 'committed' | 'failed';
  outcomeReason?: string;
  view: WorldEvolutionCommitRequestView;
};

const commitRequestRecords: DesktopCommitRequestRecord[] = [];

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

function cloneActorRefs(actorRefs: WorldEvolutionActorRef[]): WorldEvolutionActorRef[] {
  return actorRefs.map((actorRef) => (
    actorRef.role
      ? {
        actorId: actorRef.actorId,
        actorType: actorRef.actorType,
        role: actorRef.role,
      }
      : {
        actorId: actorRef.actorId,
        actorType: actorRef.actorType,
      }
  ));
}

function cloneEvidenceRefs(evidenceRefs: WorldEvolutionEvidenceRef[]): WorldEvolutionEvidenceRef[] {
  return evidenceRefs.map((evidenceRef) => (
    evidenceRef.uri
      ? {
        kind: evidenceRef.kind,
        refId: evidenceRef.refId,
        uri: evidenceRef.uri,
      }
      : {
        kind: evidenceRef.kind,
        refId: evidenceRef.refId,
      }
  ));
}

function normalizeActorRefs(actorRefs: WorldEvolutionActorRef[] | undefined): WorldEvolutionActorRef[] | null {
  if (!Array.isArray(actorRefs) || actorRefs.length === 0) {
    return null;
  }
  const normalized = actorRefs
    .map((actorRef) => {
      const actorId = normalizeText(actorRef.actorId);
      const actorType = normalizeText(actorRef.actorType);
      const role = normalizeOptionalText(actorRef.role);
      if (!actorId || !actorType) {
        return null;
      }
      return role ? { actorId, actorType, role } : { actorId, actorType };
    })
    .filter((actorRef): actorRef is WorldEvolutionActorRef => actorRef !== null);
  return normalized.length > 0 ? normalized : null;
}

function normalizeEvidenceRefs(evidenceRefs: WorldEvolutionEvidenceRef[] | undefined): WorldEvolutionEvidenceRef[] | null {
  if (!Array.isArray(evidenceRefs) || evidenceRefs.length === 0) {
    return null;
  }
  const normalized = evidenceRefs
    .map((evidenceRef) => {
      const kind = normalizeText(evidenceRef.kind);
      const refId = normalizeText(evidenceRef.refId);
      const uri = normalizeOptionalText(evidenceRef.uri);
      if (!kind || !refId) {
        return null;
      }
      return uri ? { kind, refId, uri } : { kind, refId };
    })
    .filter((evidenceRef): evidenceRef is WorldEvolutionEvidenceRef => evidenceRef !== null);
  return normalized.length > 0 ? normalized : null;
}

function normalizeStringArray(values: string[] | undefined): string[] | undefined {
  if (!Array.isArray(values)) {
    return undefined;
  }
  const normalized = values
    .map((value) => normalizeText(value))
    .filter((value) => value.length > 0);
  return normalized.length > 0 ? normalized : undefined;
}

function createCommitRequestRecordId(): string {
  return `wee:commit:${Date.now().toString(36)}:${createSecureIdSuffix()}`;
}

function cloneCommitRequestView(view: WorldEvolutionCommitRequestView): WorldEvolutionCommitRequestView {
  return {
    worldId: view.worldId,
    appId: view.appId,
    sessionId: view.sessionId,
    effectClass: view.effectClass,
    scope: view.scope,
    schemaId: view.schemaId,
    schemaVersion: view.schemaVersion,
    actorRefs: cloneActorRefs(view.actorRefs),
    reason: view.reason,
    evidenceRefs: cloneEvidenceRefs(view.evidenceRefs),
    ...(view.sourceEventIds ? { sourceEventIds: [...view.sourceEventIds] } : {}),
    ...(view.traceId ? { traceId: view.traceId } : {}),
    ...(view.tick !== undefined ? { tick: view.tick } : {}),
    ...(view.causation ? { causation: view.causation } : {}),
    ...(view.correlation ? { correlation: view.correlation } : {}),
    ...(view.checkpointRefs ? { checkpointRefs: [...view.checkpointRefs] } : {}),
    ...(view.supervisionRefs ? { supervisionRefs: [...view.supervisionRefs] } : {}),
  };
}

function appendCommitRequestRecord(record: DesktopCommitRequestRecord): void {
  commitRequestRecords.push(record);
  if (commitRequestRecords.length > MAX_COMMIT_REQUESTS) {
    commitRequestRecords.splice(0, commitRequestRecords.length - MAX_COMMIT_REQUESTS);
  }
}

function maybeBuildCommitRequestView(
  input: DesktopCommitRequestCandidateInput,
): WorldEvolutionCommitRequestView | null {
  const worldId = normalizeText(input.worldId);
  const appId = normalizeText(input.appId);
  const sessionId = normalizeText(input.sessionId);
  const effectClass = normalizeText(input.effectClass) as WorldEvolutionEffectClass;
  const scope = normalizeText(input.scope);
  const schemaId = normalizeText(input.schemaId);
  const schemaVersion = normalizeText(input.schemaVersion);
  const reason = normalizeText(input.reason);
  const actorRefs = normalizeActorRefs(input.actorRefs);
  const evidenceRefs = normalizeEvidenceRefs(input.evidenceRefs);

  if (
    !worldId
    || !appId
    || !sessionId
    || !scope
    || !schemaId
    || !schemaVersion
    || !reason
    || !EFFECT_CLASSES.has(effectClass)
    || !actorRefs
    || !evidenceRefs
  ) {
    return null;
  }

  const sourceEventIds = normalizeStringArray(input.sourceEventIds);
  const checkpointRefs = normalizeStringArray(input.checkpointRefs);
  const supervisionRefs = normalizeStringArray(input.supervisionRefs);
  const traceId = normalizeOptionalText(input.traceId);
  const causation = normalizeOptionalText(input.causation);
  const correlation = normalizeOptionalText(input.correlation);
  const tick = normalizeTick(input.tick);

  return {
    worldId,
    appId,
    sessionId,
    effectClass,
    scope,
    schemaId,
    schemaVersion,
    actorRefs,
    reason,
    evidenceRefs,
    ...(sourceEventIds ? { sourceEventIds } : {}),
    ...(traceId ? { traceId } : {}),
    ...(tick !== undefined ? { tick } : {}),
    ...(causation ? { causation } : {}),
    ...(correlation ? { correlation } : {}),
    ...(checkpointRefs ? { checkpointRefs } : {}),
    ...(supervisionRefs ? { supervisionRefs } : {}),
  };
}

function matchesActorRef(expected: WorldEvolutionActorRef, actual: WorldEvolutionActorRef): boolean {
  return expected.actorId === actual.actorId
    && expected.actorType === actual.actorType
    && (expected.role === undefined || expected.role === actual.role);
}

function matchesEvidenceRef(expected: WorldEvolutionEvidenceRef, actual: WorldEvolutionEvidenceRef): boolean {
  if (expected.kind !== actual.kind || expected.refId !== actual.refId) {
    return false;
  }
  return expected.uri === undefined || expected.uri === actual.uri;
}

function includesStringArray(expected: string[] | undefined, actual: string[] | undefined): boolean {
  if (!expected) {
    return true;
  }
  if (!actual) {
    return false;
  }
  return expected.every((value) => actual.includes(value));
}

function matchesCommitRequestFilter(
  view: WorldEvolutionCommitRequestView,
  selector: WorldEvolutionCommitRequestSelector,
): boolean {
  if (selector.worldId && view.worldId !== selector.worldId) return false;
  if (selector.appId && view.appId !== selector.appId) return false;
  if (selector.sessionId && view.sessionId !== selector.sessionId) return false;
  if (selector.effectClass && view.effectClass !== selector.effectClass) return false;
  if (selector.scope && view.scope !== selector.scope) return false;
  if (selector.schemaId && view.schemaId !== selector.schemaId) return false;
  if (selector.schemaVersion && view.schemaVersion !== selector.schemaVersion) return false;
  if (selector.reason && view.reason !== selector.reason) return false;
  if (selector.traceId && view.traceId !== selector.traceId) return false;
  if (selector.tick !== undefined && view.tick !== selector.tick) return false;
  if (selector.causation !== undefined && view.causation !== selector.causation) return false;
  if (selector.correlation !== undefined && view.correlation !== selector.correlation) return false;
  if (selector.actorRefs && !selector.actorRefs.every((expected) => view.actorRefs.some((actual) => matchesActorRef(expected, actual)))) {
    return false;
  }
  if (selector.evidenceRefs && !selector.evidenceRefs.every((expected) => view.evidenceRefs.some((actual) => matchesEvidenceRef(expected, actual)))) {
    return false;
  }
  if (!includesStringArray(selector.sourceEventIds, view.sourceEventIds)) return false;
  if (!includesStringArray(selector.checkpointRefs, view.checkpointRefs)) return false;
  if (!includesStringArray(selector.supervisionRefs, view.supervisionRefs)) return false;
  return true;
}

export function recordDesktopWorldEvolutionCommitRequestCandidate(
  input: DesktopCommitRequestCandidateInput,
): DesktopCommitRequestRecord | null {
  const view = maybeBuildCommitRequestView(input);
  if (!view) {
    return null;
  }
  const record: DesktopCommitRequestRecord = {
    commitRequestRecordId: createCommitRequestRecordId(),
    createdAt: new Date().toISOString(),
    outcomeStatus: 'pending',
    view,
  };
  appendCommitRequestRecord(record);
  return {
    ...record,
    view: cloneCommitRequestView(record.view),
  };
}

export function settleDesktopWorldEvolutionCommitRequestRecord(input: {
  commitRequestRecordId: string;
  outcomeStatus: 'committed' | 'failed';
  outcomeReason?: string;
}): DesktopCommitRequestRecord | null {
  const commitRequestRecordId = normalizeText(input.commitRequestRecordId);
  if (!commitRequestRecordId) {
    return null;
  }
  const record = commitRequestRecords.find((entry) => entry.commitRequestRecordId === commitRequestRecordId);
  if (!record) {
    return null;
  }
  record.outcomeStatus = input.outcomeStatus;
  record.settledAt = new Date().toISOString();
  record.outcomeReason = normalizeOptionalText(input.outcomeReason);
  return {
    ...record,
    view: cloneCommitRequestView(record.view),
  };
}

export function queryDesktopWorldEvolutionCommitRequests(
  selector: WorldEvolutionCommitRequestSelector,
): WorldEvolutionCommitRequestView[] {
  return commitRequestRecords
    .map((record) => record.view)
    .filter((view) => matchesCommitRequestFilter(view, selector))
    .map((view) => cloneCommitRequestView(view));
}

export function getDesktopWorldEvolutionCommitRequestRecordsForTest(): Array<{
  commitRequestRecordId: string;
  createdAt: string;
  settledAt?: string;
  outcomeStatus: 'pending' | 'committed' | 'failed';
  outcomeReason?: string;
  view: WorldEvolutionCommitRequestView;
}> {
  return commitRequestRecords.map((record) => ({
    commitRequestRecordId: record.commitRequestRecordId,
    createdAt: record.createdAt,
    ...(record.settledAt ? { settledAt: record.settledAt } : {}),
    outcomeStatus: record.outcomeStatus,
    ...(record.outcomeReason ? { outcomeReason: record.outcomeReason } : {}),
    view: cloneCommitRequestView(record.view),
  }));
}

export function clearDesktopWorldEvolutionCommitRequestsForTest(): void {
  commitRequestRecords.splice(0, commitRequestRecords.length);
}
