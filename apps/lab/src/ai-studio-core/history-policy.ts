import { isJsonObject } from '@nimiplatform/sdk/types';

import type { AIStudioHistoryPanelPreferences } from './workspace.js';
import type { StudioRunHistory, StudioRunHistoryRecord } from './history.js';

export const STUDIO_HISTORY_LIMIT_PER_CAPABILITY = 40;
export const STUDIO_HISTORY_LIMIT_TOTAL_RECORDS = 160;
export const STUDIO_HISTORY_LIMIT_BYTES = 240 * 1024;

export const DEFAULT_AI_STUDIO_HISTORY_PANEL_PREFERENCES: AIStudioHistoryPanelPreferences = Object.freeze({
  collapsed: true,
  scope: 'capability',
  hideFailures: false,
});

function historyError(path: string, detail: string): never {
  throw new Error(`AI Studio history payload ${detail} at ${path}.`);
}

function requiredString(value: unknown, path: string): string {
  if (typeof value !== 'string') return historyError(path, 'requires a string');
  return value;
}

function optionalString(value: unknown, path: string): void {
  if (value !== undefined && typeof value !== 'string') historyError(path, 'requires a string when present');
}

function nonNegativeNumber(value: unknown, path: string): void {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    historyError(path, 'requires a non-negative finite number');
  }
}

function optionalNonNegativeNumber(value: unknown, path: string): void {
  if (value !== undefined) nonNegativeNumber(value, path);
}

function validateManagedArtifact(value: unknown, path: string): void {
  if (!isJsonObject(value)) historyError(path, 'requires an object');
  requiredString(value.relativePath, `${path}.relativePath`);
  optionalString(value.mediaType, `${path}.mediaType`);
  nonNegativeNumber(value.sizeBytes, `${path}.sizeBytes`);
  const sha256 = requiredString(value.sha256, `${path}.sha256`);
  if (!/^sha256:[0-9a-f]{64}$/u.test(sha256)) historyError(`${path}.sha256`, 'requires a canonical SHA-256 digest');
  optionalString(value.displayName, `${path}.displayName`);
  if (value.previewSource !== 'managed-asset') historyError(`${path}.previewSource`, 'requires managed-asset');
}

function validateHistoryResult(value: unknown, path: string): void {
  if (!isJsonObject(value) || typeof value.ok !== 'boolean') historyError(path, 'requires a discriminated result object');
  const kind = requiredString(value.kind, `${path}.kind`);
  requiredString(value.summary, `${path}.summary`);
  if (value.ok === false) {
    if (kind !== 'non-success') historyError(`${path}.kind`, 'requires non-success for a failed result');
    if (!['runtime-unavailable', 'input-invalid', 'sdk-method-unavailable', 'principal-unauthorized', 'operation-aborted', 'runtime-canceled', 'runtime-timeout', 'stream-interrupted', 'runtime-call-failed'].includes(String(value.reason))) {
      historyError(`${path}.reason`, 'has an unsupported value');
    }
    requiredString(value.message, `${path}.message`);
    requiredString(value.actionHint, `${path}.actionHint`);
    optionalString(value.missingSurface, `${path}.missingSurface`);
    if (value.diagnostics !== undefined) {
      if (!isJsonObject(value.diagnostics)) historyError(`${path}.diagnostics`, 'requires an object');
      const reasonCode = requiredString(value.diagnostics.reasonCode, `${path}.diagnostics.reasonCode`);
      if (!/^[A-Z][A-Z0-9_]{0,127}$/u.test(reasonCode)) historyError(`${path}.diagnostics.reasonCode`, 'is invalid');
      const actionHint = value.diagnostics.actionHint;
      optionalString(actionHint, `${path}.diagnostics.actionHint`);
      if (typeof actionHint === 'string' && actionHint && !/^[A-Za-z0-9_.-]{1,256}$/u.test(actionHint)) {
        historyError(`${path}.diagnostics.actionHint`, 'is invalid');
      }
      const traceId = value.diagnostics.traceId;
      optionalString(traceId, `${path}.diagnostics.traceId`);
      if (typeof traceId === 'string' && traceId && !/^[A-Za-z0-9_.:-]{1,512}$/u.test(traceId)) {
        historyError(`${path}.diagnostics.traceId`, 'is invalid');
      }
      const source = value.diagnostics.source;
      optionalString(source, `${path}.diagnostics.source`);
      if (typeof source === 'string' && source && !['runtime', 'sdk', 'realm'].includes(source)) {
        historyError(`${path}.diagnostics.source`, 'is invalid');
      }
      if (value.diagnostics.retryable !== undefined && typeof value.diagnostics.retryable !== 'boolean') {
        historyError(`${path}.diagnostics.retryable`, 'requires a boolean');
      }
    }
    return;
  }
  optionalString(value.traceId, `${path}.traceId`);
  if (kind === 'text') {
    requiredString(value.body, `${path}.body`);
    nonNegativeNumber(value.charCount, `${path}.charCount`);
    requiredString(value.finishReason, `${path}.finishReason`);
    if (typeof value.streamed !== 'boolean') historyError(`${path}.streamed`, 'requires a boolean');
    optionalNonNegativeNumber(value.inputTokens, `${path}.inputTokens`);
    optionalNonNegativeNumber(value.outputTokens, `${path}.outputTokens`);
    optionalNonNegativeNumber(value.totalTokens, `${path}.totalTokens`);
    return;
  }
  if (kind === 'embedding') {
    nonNegativeNumber(value.vectorCount, `${path}.vectorCount`);
    nonNegativeNumber(value.dimensions, `${path}.dimensions`);
    if (!Array.isArray(value.sample) || value.sample.some((entry) => typeof entry !== 'number' || !Number.isFinite(entry))) {
      historyError(`${path}.sample`, 'requires finite numbers');
    }
    optionalNonNegativeNumber(value.totalTokens, `${path}.totalTokens`);
    return;
  }
  if (kind === 'artifacts') {
    requiredString(value.jobId, `${path}.jobId`);
    requiredString(value.jobState, `${path}.jobState`);
    nonNegativeNumber(value.artifactCount, `${path}.artifactCount`);
    if (value.artifacts !== undefined) {
      if (!Array.isArray(value.artifacts)) historyError(`${path}.artifacts`, 'requires an array');
      value.artifacts.forEach((artifact, index) => validateManagedArtifact(artifact, `${path}.artifacts[${index}]`));
      if (value.artifacts.length !== value.artifactCount) historyError(`${path}.artifacts`, 'must match artifactCount');
    }
    if (value.firstArtifact !== undefined) validateManagedArtifact(value.firstArtifact, `${path}.firstArtifact`);
    return;
  }
  if (kind === 'transcript') {
    requiredString(value.body, `${path}.body`);
    nonNegativeNumber(value.charCount, `${path}.charCount`);
    requiredString(value.jobId, `${path}.jobId`);
    requiredString(value.jobState, `${path}.jobState`);
    nonNegativeNumber(value.artifactCount, `${path}.artifactCount`);
    return;
  }
  if (kind === 'voice-asset') {
    requiredString(value.jobId, `${path}.jobId`);
    requiredString(value.jobState, `${path}.jobState`);
    requiredString(value.voiceAssetId, `${path}.voiceAssetId`);
    if (value.creationSource !== 'reference-audio' && value.creationSource !== 'text-description') historyError(`${path}.creationSource`, 'is invalid');
    requiredString(value.assetStatus, `${path}.assetStatus`);
    return;
  }
  if (kind === 'voice-catalog') {
    nonNegativeNumber(value.voiceCount, `${path}.voiceCount`);
    if (!Array.isArray(value.sample)) historyError(`${path}.sample`, 'requires an array');
    value.sample.forEach((entry, index) => {
      if (!isJsonObject(entry)) historyError(`${path}.sample[${index}]`, 'requires an object');
      requiredString(entry.voiceId, `${path}.sample[${index}].voiceId`);
      requiredString(entry.creationSource, `${path}.sample[${index}].creationSource`);
      requiredString(entry.status, `${path}.sample[${index}].status`);
    });
    return;
  }
  historyError(`${path}.kind`, `has unsupported value ${kind}`);
}

function validateRunConfig(value: unknown, path: string): void {
  if (!isJsonObject(value) || !isJsonObject(value.target) || !isJsonObject(value.promptControls)) {
    historyError(path, 'requires target and promptControls objects');
  }
  const target = value.target;
  requiredString(target.capabilityId, `${path}.target.capabilityId`);
  if (target.capabilityContract !== null) requiredString(target.capabilityContract, `${path}.target.capabilityContract`);
  for (const field of ['section', 'status', 'source', 'intentLabel', 'detail'] as const) requiredString(target[field], `${path}.target.${field}`);
  if (!isJsonObject(target.params)) historyError(`${path}.target.params`, 'requires an object');
  if (!Array.isArray(target.paramsSummary) || target.paramsSummary.some((entry) => typeof entry !== 'string')) historyError(`${path}.target.paramsSummary`, 'requires strings');
  if (target.profileOrigin !== null) historyError(`${path}.target.profileOrigin`, 'requires null');
  const controls = value.promptControls;
  optionalString(controls.tone, `${path}.promptControls.tone`);
  optionalString(controls.length, `${path}.promptControls.length`);
  if (controls.toneSelected !== undefined && typeof controls.toneSelected !== 'boolean') historyError(`${path}.promptControls.toneSelected`, 'requires a boolean');
  if (controls.lengthSelected !== undefined && typeof controls.lengthSelected !== 'boolean') historyError(`${path}.promptControls.lengthSelected`, 'requires a boolean');
  if (typeof controls.contextAttached !== 'boolean') historyError(`${path}.promptControls.contextAttached`, 'requires a boolean');
  optionalString(controls.context, `${path}.promptControls.context`);
  nonNegativeNumber(controls.attachmentCount, `${path}.promptControls.attachmentCount`);
  optionalString(value.traceId, `${path}.traceId`);
}

function parseHistoryRecord(value: unknown, path: string, capabilityId: string): StudioRunHistoryRecord {
  if (!isJsonObject(value)) historyError(path, 'requires an object');
  requiredString(value.id, `${path}.id`);
  if (requiredString(value.capabilityId, `${path}.capabilityId`) !== capabilityId) historyError(`${path}.capabilityId`, `must match ${capabilityId}`);
  requiredString(value.prompt, `${path}.prompt`);
  if (!['unavailable', 'ready', 'failed', 'canceled', 'timed-out', 'local-fixture'].includes(String(value.status))) historyError(`${path}.status`, 'has an unsupported value');
  requiredString(value.message, `${path}.message`);
  const createdAt = requiredString(value.createdAt, `${path}.createdAt`);
  if (Number.isNaN(new Date(createdAt).valueOf())) historyError(`${path}.createdAt`, 'requires a valid timestamp');
  if (value.result !== undefined) validateHistoryResult(value.result, `${path}.result`);
  if (value.runConfig !== undefined) validateRunConfig(value.runConfig, `${path}.runConfig`);
  return value as unknown as StudioRunHistoryRecord;
}

export function parseStudioRunHistory(value: unknown): StudioRunHistory {
  if (value === undefined) return {};
  if (!isJsonObject(value)) throw new Error('AI Studio history payload must be an object.');
  const history: StudioRunHistory = {};
  for (const [capabilityId, entries] of Object.entries(value)) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(capabilityId)) historyError('$', `contains invalid capability id ${capabilityId}`);
    if (!Array.isArray(entries)) historyError(`$.${capabilityId}`, 'requires an array');
    history[capabilityId] = entries.map((entry, index) => parseHistoryRecord(entry, `$.${capabilityId}[${index}]`, capabilityId));
  }
  return history;
}

export function flattenStudioHistoryRecords(history: StudioRunHistory): StudioRunHistoryRecord[] {
  return Object.values(history).flatMap((records) => records);
}

export function studioHistoryFromRecords(records: readonly StudioRunHistoryRecord[]): StudioRunHistory {
  const history: StudioRunHistory = {};
  for (const record of records) {
    const existing = Object.hasOwn(history, record.capabilityId) ? history[record.capabilityId] ?? [] : [];
    Object.defineProperty(history, record.capabilityId, {
      value: [...existing, record],
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  return history;
}

export function boundStudioRunHistoryWithRecord(history: StudioRunHistory, record: StudioRunHistoryRecord): StudioRunHistory {
  const counts = new Map<string, number>();
  const retained = [record, ...flattenStudioHistoryRecords(history).filter((existing) => existing.id !== record.id)]
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .filter((candidate) => {
      const count = counts.get(candidate.capabilityId) ?? 0;
      if (count >= STUDIO_HISTORY_LIMIT_PER_CAPABILITY) return false;
      counts.set(candidate.capabilityId, count + 1);
      return true;
    })
    .slice(0, STUDIO_HISTORY_LIMIT_TOTAL_RECORDS);
  let next = studioHistoryFromRecords(retained);
  while (new TextEncoder().encode(JSON.stringify(next)).byteLength > STUDIO_HISTORY_LIMIT_BYTES) {
    if (retained.length <= 1) throw new Error('AI Studio history record exceeds the storage document limit.');
    retained.pop();
    next = studioHistoryFromRecords(retained);
  }
  if (!retained.some((candidate) => candidate.id === record.id)) throw new Error('AI Studio history could not retain the newly completed run.');
  return next;
}

export function removeStudioRunHistoryRecord(history: StudioRunHistory, recordId: string): StudioRunHistory {
  return studioHistoryFromRecords(flattenStudioHistoryRecords(history).filter((record) => record.id !== recordId));
}

export function clearStudioRunHistory(history: StudioRunHistory, capabilityId: string | null): StudioRunHistory {
  if (capabilityId === null) return {};
  return studioHistoryFromRecords(flattenStudioHistoryRecords(history).filter((record) => record.capabilityId !== capabilityId));
}

export type StudioHistoryPolicyMutationIssue = {
  readonly runId: string;
  readonly step: 'asset' | 'history';
  readonly message: string;
};

export type StudioHistoryPolicyMutationOutcome<TProjection> = {
  readonly completed: number;
  readonly skipped: number;
  readonly failed: number;
  readonly projection: TProjection;
  readonly issues: readonly StudioHistoryPolicyMutationIssue[];
};

export type StudioHistoryMutationSubject = {
  readonly id: string;
  readonly capabilityId: string;
  readonly artifactPaths: readonly string[];
};

export function studioHistoryArtifactPaths(record: StudioRunHistoryRecord): string[] {
  const result = record.result;
  if (!result || result.ok === false || result.kind !== 'artifacts') return [];
  const artifacts = result.artifacts?.length ? result.artifacts : result.firstArtifact ? [result.firstArtifact] : [];
  return artifacts.map((artifact) => artifact.relativePath).filter(Boolean);
}

export async function cleanupStudioHistoryArtifacts(input: {
  readonly relativePaths: readonly string[];
  readonly removeArtifact: (relativePath: string) => Promise<unknown>;
  readonly isNotFound?: (error: unknown) => boolean;
}): Promise<{ readonly failures: readonly string[]; readonly remainingCleanupPaths: readonly string[] }> {
  const failures: string[] = [];
  const remainingCleanupPaths: string[] = [];
  for (const relativePath of [...new Set(input.relativePaths)]) {
    try {
      await input.removeArtifact(relativePath);
    } catch (error) {
      if (input.isNotFound?.(error)) continue;
      failures.push(`${relativePath}: ${error instanceof Error ? error.message : String(error)}`);
      remainingCleanupPaths.push(relativePath);
    }
  }
  return { failures, remainingCleanupPaths };
}

type StudioHistoryMutationPolicyPort<TProjection> = {
  readonly deleteAssets: boolean;
  readonly additionalSubjects?: readonly StudioHistoryMutationSubject[];
  readonly removeArtifact: (relativePath: string) => Promise<unknown>;
  readonly isNotFound?: (error: unknown) => boolean;
  readonly resolveArtifactPaths?: (record: StudioRunHistoryRecord) => readonly string[];
  readonly commit: (
    next: StudioRunHistory,
    removed: readonly StudioHistoryMutationSubject[],
  ) => Promise<void>;
  readonly project: (history: StudioRunHistory) => Promise<TProjection>;
};

function mutationIssue(
  subject: StudioHistoryMutationSubject,
  step: 'asset' | 'history',
  message: string,
): StudioHistoryPolicyMutationIssue {
  return { runId: subject.id, step, message: message || 'History mutation failed.' };
}

function mutationSubjects<TProjection>(
  input: StudioHistoryMutationPolicyPort<TProjection>,
  history: StudioRunHistory,
): StudioHistoryMutationSubject[] {
  const subjects = flattenStudioHistoryRecords(history).map((record) => ({
    id: record.id,
    capabilityId: record.capabilityId,
    artifactPaths: input.resolveArtifactPaths?.(record) ?? studioHistoryArtifactPaths(record),
  }));
  const runOwnedIDs = new Set(subjects.map((subject) => subject.id));
  for (const subject of input.additionalSubjects ?? []) {
    if (!subject.id || !subject.capabilityId || !Array.isArray(subject.artifactPaths)) {
      throw new Error('AI Studio history mutation subject is invalid.');
    }
    if (subject.artifactPaths.some((relativePath) => typeof relativePath !== 'string' || !relativePath)) {
      throw new Error(`AI Studio history mutation subject has an invalid artifact path: ${subject.id}`);
    }
    if (!runOwnedIDs.has(subject.id)) {
      subjects.push(subject);
      runOwnedIDs.add(subject.id);
    }
  }
  return subjects;
}

export async function removeStudioHistoryWithPolicy<TProjection>(input: {
  readonly history: StudioRunHistory;
  readonly recordId: string;
} & StudioHistoryMutationPolicyPort<TProjection>): Promise<StudioHistoryPolicyMutationOutcome<TProjection>> {
  const removed = mutationSubjects(input, input.history).filter((subject) => subject.id === input.recordId);
  const currentProjection = await input.project(input.history);
  if (removed.length === 0) return { completed: 0, skipped: 1, failed: 0, projection: currentProjection, issues: [] };
  if (input.deleteAssets) {
    const cleanup = await cleanupStudioHistoryArtifacts({
      relativePaths: removed.flatMap((subject) => subject.artifactPaths),
      removeArtifact: input.removeArtifact,
      isNotFound: input.isNotFound,
    });
    if (cleanup.failures.length > 0) {
      const message = cleanup.failures.join('; ');
      return {
        completed: 0,
        skipped: removed.length,
        failed: 0,
        projection: currentProjection,
        issues: removed.map((subject) => mutationIssue(subject, 'asset', message)),
      };
    }
  }
  const next = removeStudioRunHistoryRecord(input.history, input.recordId);
  try {
    await input.commit(next, removed);
    return { completed: removed.length, skipped: 0, failed: 0, projection: await input.project(next), issues: [] };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      completed: 0,
      skipped: 0,
      failed: removed.length,
      projection: await input.project(input.history),
      issues: removed.map((subject) => mutationIssue(subject, 'history', message)),
    };
  }
}

export async function clearStudioHistoryWithPolicy<TProjection>(input: {
  readonly history: StudioRunHistory;
  readonly capabilityId: string | null;
} & StudioHistoryMutationPolicyPort<TProjection>): Promise<StudioHistoryPolicyMutationOutcome<TProjection>> {
  const removed = mutationSubjects(input, input.history).filter((subject) => (
    input.capabilityId === null || subject.capabilityId === input.capabilityId
  ));
  if (!input.deleteAssets) {
    const next = clearStudioRunHistory(input.history, input.capabilityId);
    try {
      await input.commit(next, removed);
      return { completed: removed.length, skipped: 0, failed: 0, projection: await input.project(next), issues: [] };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        completed: 0,
        skipped: 0,
        failed: removed.length || 1,
        projection: await input.project(input.history),
        issues: removed.map((subject) => mutationIssue(subject, 'history', message)),
      };
    }
  }

  let history = input.history;
  let completed = 0;
  let skipped = 0;
  let failed = 0;
  const issues: StudioHistoryPolicyMutationIssue[] = [];
  for (const subject of removed) {
    const cleanup = await cleanupStudioHistoryArtifacts({
      relativePaths: subject.artifactPaths,
      removeArtifact: input.removeArtifact,
      isNotFound: input.isNotFound,
    });
    if (cleanup.failures.length > 0) {
      skipped += 1;
      issues.push(mutationIssue(subject, 'asset', cleanup.failures.join('; ')));
      continue;
    }
    const next = removeStudioRunHistoryRecord(history, subject.id);
    try {
      await input.commit(next, [subject]);
      history = next;
      completed += 1;
    } catch (error) {
      failed += 1;
      issues.push(mutationIssue(subject, 'history', error instanceof Error ? error.message : String(error)));
    }
  }
  return { completed, skipped, failed, projection: await input.project(history), issues };
}

export function parseAIStudioHistoryPanelPreferences(value: unknown): AIStudioHistoryPanelPreferences {
  if (!isJsonObject(value)
    || typeof value.collapsed !== 'boolean'
    || typeof value.hideFailures !== 'boolean'
    || !['capability', 'all', 'media'].includes(String(value.scope))) {
    throw new Error('AI Studio history panel preferences are invalid.');
  }
  return { collapsed: value.collapsed, scope: value.scope as AIStudioHistoryPanelPreferences['scope'], hideFailures: value.hideFailures };
}
