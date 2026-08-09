import type { JsonValue } from '@nimiplatform/kit/shell/renderer/bridge';
import { isJsonObject } from '@nimiplatform/sdk/types';

import type { TesterRunHistory, TesterRunHistoryRecord } from './tester-history.js';
import {
  normalizeTesterStandardStorageJsonValue,
  readTesterStandardStorageJson,
  writeTesterStandardStorageJson,
} from './tester-standard-storage.js';

const TESTER_RUN_HISTORY_STORAGE_PATH = 'tester-run-history.json';
const MAX_TESTER_RUN_HISTORY_PER_CAPABILITY = 40;
const MAX_TESTER_RUN_HISTORY_RECORDS = 160;
const MAX_TESTER_RUN_HISTORY_BYTES = 240 * 1024;
const runHistoryMutationQueue = { tail: Promise.resolve() };

function historyPayloadError(path: string, detail: string): never {
  throw new Error(`Tester run history payload ${detail} at ${path}.`);
}

function requiredString(value: unknown, path: string): string {
  if (typeof value !== 'string') return historyPayloadError(path, 'requires a string');
  return value;
}

function optionalString(value: unknown, path: string): void {
  if (value !== undefined && typeof value !== 'string') historyPayloadError(path, 'requires a string when present');
}

function nonNegativeNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return historyPayloadError(path, 'requires a non-negative finite number');
  }
  return value;
}

function optionalNonNegativeNumber(value: unknown, path: string): void {
  if (value !== undefined) nonNegativeNumber(value, path);
}

function validateTraceFields(value: Record<string, JsonValue>, path: string): void {
  optionalString(value.traceId, `${path}.traceId`);
  if (value.simulated !== undefined && typeof value.simulated !== 'boolean') {
    historyPayloadError(`${path}.simulated`, 'requires a boolean when present');
  }
}

function validateHistoryResult(value: unknown, path: string): void {
  if (!isJsonObject(value) || typeof value.ok !== 'boolean') {
    historyPayloadError(path, 'requires a discriminated result object');
  }
  requiredString(value.kind, `${path}.kind`);
  requiredString(value.summary, `${path}.summary`);
  if (value.ok === false) {
    if (value.kind !== 'unavailable') historyPayloadError(`${path}.kind`, 'requires unavailable for a failed result');
    if (!['runtime-unavailable', 'input-invalid', 'sdk-method-unavailable', 'principal-unauthorized', 'runtime-call-failed'].includes(String(value.reason))) {
      historyPayloadError(`${path}.reason`, 'has an unsupported value');
    }
    requiredString(value.message, `${path}.message`);
    requiredString(value.actionHint, `${path}.actionHint`);
    optionalString(value.missingSurface, `${path}.missingSurface`);
    return;
  }
  validateTraceFields(value, path);
  if (value.kind === 'text') {
    requiredString(value.body, `${path}.body`);
    nonNegativeNumber(value.charCount, `${path}.charCount`);
    requiredString(value.finishReason, `${path}.finishReason`);
    if (typeof value.streamed !== 'boolean') historyPayloadError(`${path}.streamed`, 'requires a boolean');
    optionalNonNegativeNumber(value.inputTokens, `${path}.inputTokens`);
    optionalNonNegativeNumber(value.outputTokens, `${path}.outputTokens`);
    optionalNonNegativeNumber(value.totalTokens, `${path}.totalTokens`);
    return;
  }
  if (value.kind === 'embedding') {
    nonNegativeNumber(value.vectorCount, `${path}.vectorCount`);
    nonNegativeNumber(value.dimensions, `${path}.dimensions`);
    optionalNonNegativeNumber(value.totalTokens, `${path}.totalTokens`);
    if (!Array.isArray(value.sample) || value.sample.some((entry) => typeof entry !== 'number' || !Number.isFinite(entry))) {
      historyPayloadError(`${path}.sample`, 'requires an array of finite numbers');
    }
    return;
  }
  if (value.kind === 'artifacts') {
    requiredString(value.jobId, `${path}.jobId`);
    requiredString(value.jobState, `${path}.jobState`);
    nonNegativeNumber(value.artifactCount, `${path}.artifactCount`);
    if (value.firstArtifact !== undefined) {
      if (!isJsonObject(value.firstArtifact)) historyPayloadError(`${path}.firstArtifact`, 'requires an object when present');
      requiredString(value.firstArtifact.relativePath, `${path}.firstArtifact.relativePath`);
      optionalString(value.firstArtifact.mediaType, `${path}.firstArtifact.mediaType`);
      nonNegativeNumber(value.firstArtifact.sizeBytes, `${path}.firstArtifact.sizeBytes`);
      requiredString(value.firstArtifact.sha256, `${path}.firstArtifact.sha256`);
      if (!/^sha256:[0-9a-f]{64}$/u.test(value.firstArtifact.sha256 as string)) {
        historyPayloadError(`${path}.firstArtifact.sha256`, 'requires a canonical SHA-256 digest');
      }
      optionalString(value.firstArtifact.displayName, `${path}.firstArtifact.displayName`);
      if (value.firstArtifact.previewSource !== 'managed-asset') {
        historyPayloadError(`${path}.firstArtifact.previewSource`, 'requires managed-asset');
      }
    }
    return;
  }
  if (value.kind === 'transcript') {
    requiredString(value.body, `${path}.body`);
    nonNegativeNumber(value.charCount, `${path}.charCount`);
    requiredString(value.jobId, `${path}.jobId`);
    requiredString(value.jobState, `${path}.jobState`);
    nonNegativeNumber(value.artifactCount, `${path}.artifactCount`);
    return;
  }
  if (value.kind === 'voice-catalog') {
    nonNegativeNumber(value.voiceCount, `${path}.voiceCount`);
    if (!Array.isArray(value.sample)) historyPayloadError(`${path}.sample`, 'requires an array');
    value.sample.forEach((entry, index) => {
      if (!isJsonObject(entry)) historyPayloadError(`${path}.sample[${index}]`, 'requires an object');
      requiredString(entry.voiceId, `${path}.sample[${index}].voiceId`);
      requiredString(entry.workflowType, `${path}.sample[${index}].workflowType`);
      requiredString(entry.status, `${path}.sample[${index}].status`);
    });
    return;
  }
  historyPayloadError(`${path}.kind`, `has unsupported value ${String(value.kind)}`);
}

function validateRunConfig(value: unknown, path: string): void {
  if (!isJsonObject(value) || !isJsonObject(value.target) || !isJsonObject(value.promptControls)) {
    historyPayloadError(path, 'requires target and promptControls objects');
  }
  const target = value.target;
  requiredString(target.capabilityId, `${path}.target.capabilityId`);
  if (target.capabilityContract !== null) requiredString(target.capabilityContract, `${path}.target.capabilityContract`);
  requiredString(target.section, `${path}.target.section`);
  requiredString(target.status, `${path}.target.status`);
  requiredString(target.source, `${path}.target.source`);
  requiredString(target.intentLabel, `${path}.target.intentLabel`);
  requiredString(target.detail, `${path}.target.detail`);
  if (!isJsonObject(target.params)) historyPayloadError(`${path}.target.params`, 'requires an object');
  if (!Array.isArray(target.paramsSummary) || target.paramsSummary.some((entry) => typeof entry !== 'string')) {
    historyPayloadError(`${path}.target.paramsSummary`, 'requires an array of strings');
  }
  if (target.profileOrigin !== null) historyPayloadError(`${path}.target.profileOrigin`, 'requires null');

  const controls = value.promptControls;
  optionalString(controls.tone, `${path}.promptControls.tone`);
  optionalString(controls.length, `${path}.promptControls.length`);
  if (controls.toneSelected !== undefined && typeof controls.toneSelected !== 'boolean') {
    historyPayloadError(`${path}.promptControls.toneSelected`, 'requires a boolean when present');
  }
  if (controls.lengthSelected !== undefined && typeof controls.lengthSelected !== 'boolean') {
    historyPayloadError(`${path}.promptControls.lengthSelected`, 'requires a boolean when present');
  }
  if (typeof controls.contextAttached !== 'boolean') {
    historyPayloadError(`${path}.promptControls.contextAttached`, 'requires a boolean');
  }
  optionalString(controls.context, `${path}.promptControls.context`);
  nonNegativeNumber(controls.attachmentCount, `${path}.promptControls.attachmentCount`);
  optionalString(value.traceId, `${path}.traceId`);
}

function parseHistoryRecord(value: unknown, path: string, capabilityId: string): TesterRunHistoryRecord {
  if (!isJsonObject(value)) historyPayloadError(path, 'requires an object');
  requiredString(value.id, `${path}.id`);
  if (requiredString(value.capabilityId, `${path}.capabilityId`) !== capabilityId) {
    historyPayloadError(`${path}.capabilityId`, `must match ${capabilityId}`);
  }
  requiredString(value.prompt, `${path}.prompt`);
  if (!['unavailable', 'ready', 'simulated', 'failed', 'local-fixture'].includes(String(value.status))) {
    historyPayloadError(`${path}.status`, 'has an unsupported value');
  }
  requiredString(value.message, `${path}.message`);
  const createdAt = requiredString(value.createdAt, `${path}.createdAt`);
  if (Number.isNaN(new Date(createdAt).valueOf())) historyPayloadError(`${path}.createdAt`, 'requires a valid timestamp');
  if (value.result !== undefined) validateHistoryResult(value.result, `${path}.result`);
  if (value.runConfig !== undefined) validateRunConfig(value.runConfig, `${path}.runConfig`);
  return value as unknown as TesterRunHistoryRecord;
}

function parseHistory(value: JsonValue | undefined): TesterRunHistory {
  if (value === undefined) return {};
  if (!isJsonObject(value)) {
    throw new Error('Tester run history payload must be an object.');
  }
  const history: TesterRunHistory = {};
  for (const [capabilityId, entries] of Object.entries(value)) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(capabilityId)) {
      historyPayloadError('$', `contains an invalid capability id ${capabilityId}`);
    }
    if (!Array.isArray(entries)) historyPayloadError(`$.${capabilityId}`, 'requires an array');
    Object.defineProperty(history, capabilityId, {
      value: entries.map((entry, index) => parseHistoryRecord(entry, `$.${capabilityId}[${index}]`, capabilityId)),
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  return history;
}

function allHistoryRecords(history: TesterRunHistory): TesterRunHistoryRecord[] {
  return Object.values(history).flatMap((records) => records);
}

function historyFromRecords(records: readonly TesterRunHistoryRecord[]): TesterRunHistory {
  const history: TesterRunHistory = {};
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

function serializedHistoryBytes(history: TesterRunHistory): number {
  const json = JSON.stringify(normalizeTesterStandardStorageJsonValue(history));
  return new TextEncoder().encode(json).byteLength;
}

function boundedHistoryWithRecord(history: TesterRunHistory, record: TesterRunHistoryRecord): TesterRunHistory {
  const perCapabilityCounts = new Map<string, number>();
  const candidates = [
    record,
    ...allHistoryRecords(history).filter((existing) => existing.id !== record.id),
  ].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  const retained = candidates.filter((candidate) => {
    const count = perCapabilityCounts.get(candidate.capabilityId) ?? 0;
    if (count >= MAX_TESTER_RUN_HISTORY_PER_CAPABILITY) return false;
    perCapabilityCounts.set(candidate.capabilityId, count + 1);
    return true;
  }).slice(0, MAX_TESTER_RUN_HISTORY_RECORDS);

  let next = historyFromRecords(retained);
  while (serializedHistoryBytes(next) > MAX_TESTER_RUN_HISTORY_BYTES) {
    if (retained.length <= 1) {
      throw new Error('Tester run history record exceeds the standard storage document limit.');
    }
    retained.pop();
    next = historyFromRecords(retained);
  }
  if (!retained.some((candidate) => candidate.id === record.id)) {
    throw new Error('Tester run history could not retain the newly completed run.');
  }
  return next;
}

function enqueueHistoryMutation<T>(operation: () => Promise<T>): Promise<T> {
  const result = runHistoryMutationQueue.tail.then(operation, operation);
  runHistoryMutationQueue.tail = result.then(() => undefined, () => undefined);
  return result;
}

export async function loadTesterRunHistory(): Promise<TesterRunHistory> {
  return parseHistory(await readTesterStandardStorageJson(TESTER_RUN_HISTORY_STORAGE_PATH));
}

export async function saveTesterRunHistory(history: TesterRunHistory): Promise<void> {
  await writeTesterStandardStorageJson(TESTER_RUN_HISTORY_STORAGE_PATH, history);
}

export async function appendTesterRunHistory(record: TesterRunHistoryRecord): Promise<TesterRunHistory> {
  return enqueueHistoryMutation(async () => {
    const history = await loadTesterRunHistory();
    const next = boundedHistoryWithRecord(history, record);
    await saveTesterRunHistory(next);
    return next;
  });
}

export async function removeTesterRunHistoryRecord(recordId: string): Promise<TesterRunHistory> {
  return enqueueHistoryMutation(async () => {
    const history = await loadTesterRunHistory();
    const retained = allHistoryRecords(history).filter((existing) => existing.id !== recordId);
    const next = historyFromRecords(retained);
    await saveTesterRunHistory(next);
    return next;
  });
}

export async function clearTesterRunHistory(capabilityId?: string): Promise<TesterRunHistory> {
  return enqueueHistoryMutation(async () => {
    if (!capabilityId) {
      const next: TesterRunHistory = {};
      await saveTesterRunHistory(next);
      return next;
    }
    const history = await loadTesterRunHistory();
    const retained = allHistoryRecords(history).filter((existing) => existing.capabilityId !== capabilityId);
    const next = historyFromRecords(retained);
    await saveTesterRunHistory(next);
    return next;
  });
}
