import type { JsonValue } from '@nimiplatform/kit/shell/renderer/bridge';
import { isJsonObject } from '@nimiplatform/sdk/types';

import type { StudioRunHistory, StudioRunHistoryRecord } from '../ai-studio-core/index.js';
import {
  normalizeLabStandardStorageJsonValue,
  readLabStandardStorageJson,
  writeLabStandardStorageJson,
} from './lab-standard-storage.js';

const LAB_RUN_HISTORY_STORAGE_PATH = 'lab-run-history.json';
const MAX_LAB_RUN_HISTORY_PER_CAPABILITY = 40;
const MAX_LAB_RUN_HISTORY_RECORDS = 160;
const MAX_LAB_RUN_HISTORY_BYTES = 240 * 1024;
const runHistoryMutationQueue = { tail: Promise.resolve() };

function historyPayloadError(path: string, detail: string): never {
  throw new Error(`Lab run history payload ${detail} at ${path}.`);
}

function requiredString(value: unknown, path: string): string {
  if (typeof value !== 'string') return historyPayloadError(path, 'requires a string');
  return value;
}

function optionalString(value: unknown, path: string): string {
  if (value === undefined) return '';
  if (typeof value !== 'string') return historyPayloadError(path, 'requires a string when present');
  return value;
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
}

function validateManagedArtifact(value: unknown, path: string): void {
  if (!isJsonObject(value)) historyPayloadError(path, 'requires an object');
  requiredString(value.relativePath, `${path}.relativePath`);
  optionalString(value.mediaType, `${path}.mediaType`);
  nonNegativeNumber(value.sizeBytes, `${path}.sizeBytes`);
  requiredString(value.sha256, `${path}.sha256`);
  if (!/^sha256:[0-9a-f]{64}$/u.test(value.sha256 as string)) {
    historyPayloadError(`${path}.sha256`, 'requires a canonical SHA-256 digest');
  }
  optionalString(value.displayName, `${path}.displayName`);
  if (value.previewSource !== 'managed-asset') {
    historyPayloadError(`${path}.previewSource`, 'requires managed-asset');
  }
}

function validateHistoryResult(value: unknown, path: string): void {
  if (!isJsonObject(value) || typeof value.ok !== 'boolean') {
    historyPayloadError(path, 'requires a discriminated result object');
  }
  requiredString(value.kind, `${path}.kind`);
  requiredString(value.summary, `${path}.summary`);
  if (value.ok === false) {
    if (value.kind !== 'non-success') historyPayloadError(`${path}.kind`, 'requires non-success for a failed result');
    if (!['runtime-unavailable', 'input-invalid', 'sdk-method-unavailable', 'principal-unauthorized', 'operation-aborted', 'runtime-canceled', 'runtime-timeout', 'stream-interrupted', 'runtime-call-failed'].includes(String(value.reason))) {
      historyPayloadError(`${path}.reason`, 'has an unsupported value');
    }
    requiredString(value.message, `${path}.message`);
    requiredString(value.actionHint, `${path}.actionHint`);
    optionalString(value.missingSurface, `${path}.missingSurface`);
    if (value.diagnostics !== undefined) {
      if (!isJsonObject(value.diagnostics)) historyPayloadError(`${path}.diagnostics`, 'requires an object');
      const reasonCode = requiredString(value.diagnostics.reasonCode, `${path}.diagnostics.reasonCode`);
      if (!/^[A-Z][A-Z0-9_]{0,127}$/u.test(reasonCode)) historyPayloadError(`${path}.diagnostics.reasonCode`, 'is invalid');
      const actionHint = optionalString(value.diagnostics.actionHint, `${path}.diagnostics.actionHint`);
      if (actionHint && !/^[A-Za-z0-9_.-]{1,256}$/u.test(actionHint)) historyPayloadError(`${path}.diagnostics.actionHint`, 'is invalid');
      const traceId = optionalString(value.diagnostics.traceId, `${path}.diagnostics.traceId`);
      if (traceId && !/^[A-Za-z0-9_.:-]{1,512}$/u.test(traceId)) historyPayloadError(`${path}.diagnostics.traceId`, 'is invalid');
      const source = optionalString(value.diagnostics.source, `${path}.diagnostics.source`);
      if (source && !['runtime', 'sdk', 'realm'].includes(source)) historyPayloadError(`${path}.diagnostics.source`, 'is invalid');
      if (value.diagnostics.retryable !== undefined && typeof value.diagnostics.retryable !== 'boolean') {
        historyPayloadError(`${path}.diagnostics.retryable`, 'requires a boolean');
      }
    }
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
    if (value.artifacts !== undefined) {
      if (!Array.isArray(value.artifacts)) historyPayloadError(`${path}.artifacts`, 'requires an array when present');
      value.artifacts.forEach((artifact, index) => validateManagedArtifact(artifact, `${path}.artifacts[${index}]`));
      if (value.artifacts.length !== value.artifactCount) {
        historyPayloadError(`${path}.artifacts`, 'must match artifactCount when present');
      }
    }
    if (value.firstArtifact !== undefined) {
      validateManagedArtifact(value.firstArtifact, `${path}.firstArtifact`);
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
  if (value.kind === 'voice-asset') {
    requiredString(value.jobId, `${path}.jobId`);
    requiredString(value.jobState, `${path}.jobState`);
    requiredString(value.voiceAssetId, `${path}.voiceAssetId`);
    if (value.creationSource !== 'reference-audio' && value.creationSource !== 'text-description') {
      historyPayloadError(`${path}.creationSource`, 'requires a canonical voice creation source');
    }
    requiredString(value.assetStatus, `${path}.assetStatus`);
    return;
  }
  if (value.kind === 'voice-catalog') {
    nonNegativeNumber(value.voiceCount, `${path}.voiceCount`);
    if (!Array.isArray(value.sample)) historyPayloadError(`${path}.sample`, 'requires an array');
    value.sample.forEach((entry, index) => {
      if (!isJsonObject(entry)) historyPayloadError(`${path}.sample[${index}]`, 'requires an object');
      requiredString(entry.voiceId, `${path}.sample[${index}].voiceId`);
      requiredString(entry.creationSource, `${path}.sample[${index}].creationSource`);
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

function parseHistoryRecord(value: unknown, path: string, capabilityId: string): StudioRunHistoryRecord {
  if (!isJsonObject(value)) historyPayloadError(path, 'requires an object');
  requiredString(value.id, `${path}.id`);
  if (requiredString(value.capabilityId, `${path}.capabilityId`) !== capabilityId) {
    historyPayloadError(`${path}.capabilityId`, `must match ${capabilityId}`);
  }
  requiredString(value.prompt, `${path}.prompt`);
  if (!['unavailable', 'ready', 'failed', 'canceled', 'timed-out', 'local-fixture'].includes(String(value.status))) {
    historyPayloadError(`${path}.status`, 'has an unsupported value');
  }
  requiredString(value.message, `${path}.message`);
  const createdAt = requiredString(value.createdAt, `${path}.createdAt`);
  if (Number.isNaN(new Date(createdAt).valueOf())) historyPayloadError(`${path}.createdAt`, 'requires a valid timestamp');
  if (value.result !== undefined) validateHistoryResult(value.result, `${path}.result`);
  if (value.runConfig !== undefined) validateRunConfig(value.runConfig, `${path}.runConfig`);
  return value as unknown as StudioRunHistoryRecord;
}

function parseHistory(value: JsonValue | undefined): StudioRunHistory {
  if (value === undefined) return {};
  if (!isJsonObject(value)) {
    throw new Error('Lab run history payload must be an object.');
  }
  const history: StudioRunHistory = {};
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

function allHistoryRecords(history: StudioRunHistory): StudioRunHistoryRecord[] {
  return Object.values(history).flatMap((records) => records);
}

function historyFromRecords(records: readonly StudioRunHistoryRecord[]): StudioRunHistory {
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

function serializedHistoryBytes(history: StudioRunHistory): number {
  const json = JSON.stringify(normalizeLabStandardStorageJsonValue(history));
  return new TextEncoder().encode(json).byteLength;
}

function boundedHistoryWithRecord(history: StudioRunHistory, record: StudioRunHistoryRecord): StudioRunHistory {
  const perCapabilityCounts = new Map<string, number>();
  const candidates = [
    record,
    ...allHistoryRecords(history).filter((existing) => existing.id !== record.id),
  ].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  const retained = candidates.filter((candidate) => {
    const count = perCapabilityCounts.get(candidate.capabilityId) ?? 0;
    if (count >= MAX_LAB_RUN_HISTORY_PER_CAPABILITY) return false;
    perCapabilityCounts.set(candidate.capabilityId, count + 1);
    return true;
  }).slice(0, MAX_LAB_RUN_HISTORY_RECORDS);

  let next = historyFromRecords(retained);
  while (serializedHistoryBytes(next) > MAX_LAB_RUN_HISTORY_BYTES) {
    if (retained.length <= 1) {
      throw new Error('Lab run history record exceeds the standard storage document limit.');
    }
    retained.pop();
    next = historyFromRecords(retained);
  }
  if (!retained.some((candidate) => candidate.id === record.id)) {
    throw new Error('Lab run history could not retain the newly completed run.');
  }
  return next;
}

function enqueueHistoryMutation<T>(operation: () => Promise<T>): Promise<T> {
  const result = runHistoryMutationQueue.tail.then(operation, operation);
  runHistoryMutationQueue.tail = result.then(() => undefined, () => undefined);
  return result;
}

export async function loadLabRunHistory(): Promise<StudioRunHistory> {
  return parseHistory(await readLabStandardStorageJson(LAB_RUN_HISTORY_STORAGE_PATH));
}

export async function saveLabRunHistory(history: StudioRunHistory): Promise<void> {
  await writeLabStandardStorageJson(LAB_RUN_HISTORY_STORAGE_PATH, history);
}

export async function appendLabRunHistory(record: StudioRunHistoryRecord): Promise<StudioRunHistory> {
  return enqueueHistoryMutation(async () => {
    const history = await loadLabRunHistory();
    const next = boundedHistoryWithRecord(history, record);
    await saveLabRunHistory(next);
    return next;
  });
}

export async function removeLabRunHistoryRecord(recordId: string): Promise<StudioRunHistory> {
  return enqueueHistoryMutation(async () => {
    const history = await loadLabRunHistory();
    const retained = allHistoryRecords(history).filter((existing) => existing.id !== recordId);
    const next = historyFromRecords(retained);
    await saveLabRunHistory(next);
    return next;
  });
}

export async function clearLabRunHistory(capabilityId?: string): Promise<StudioRunHistory> {
  return enqueueHistoryMutation(async () => {
    if (!capabilityId) {
      const next: StudioRunHistory = {};
      await saveLabRunHistory(next);
      return next;
    }
    const history = await loadLabRunHistory();
    const retained = allHistoryRecords(history).filter((existing) => existing.capabilityId !== capabilityId);
    const next = historyFromRecords(retained);
    await saveLabRunHistory(next);
    return next;
  });
}
