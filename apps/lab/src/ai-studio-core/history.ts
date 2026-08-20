import { isJsonObject } from '@nimiplatform/sdk/types';
import type {
  StudioCapabilityRunResult,
  StudioManagedArtifact,
  StudioNonSuccessDiagnostics,
  StudioNonSuccessReason,
} from './runtime-types.js';
import type { StudioRunTargetSource } from './parameters.js';
import type { StudioMediaHistoryRecord } from './contexts.js';

export type StudioRunTargetSnapshot = {
  readonly capabilityId: string;
  readonly capabilityContract: string | null;
  readonly section: string;
  readonly status: StudioRunTargetStatus;
  readonly source: StudioRunTargetSource;
  readonly intentLabel: string;
  readonly detail: string;
  readonly params: Readonly<Record<string, unknown>>;
  readonly paramsSummary: readonly string[];
  readonly profileOrigin: null;
};

export type StudioRunTargetSummary = StudioRunTargetSnapshot & {
  readonly canDispatch: boolean;
};

export type StudioRunTargetStatus =
  | 'checking'
  | 'configured'
  | 'blocked'
  | 'tauri-only'
  | 'sdk-gap'
  | 'not-admitted';

export type StudioCapabilityLabelResolver = (capabilityId: string) => string | null | undefined;

export type StudioRunConfigSnapshot = {
  target: StudioRunTargetSnapshot;
  promptControls: {
    tone?: string;
    toneSelected?: boolean;
    length?: string;
    lengthSelected?: boolean;
    contextAttached: boolean;
    context?: string;
    attachmentCount: number;
  };
  traceId?: string;
};

export type StudioRunHistoryResultSnapshot =
  | {
      ok: true;
      kind: 'text';
      summary: string;
      body: string;
      charCount: number;
      finishReason: string;
      streamed: boolean;
      inputTokens?: number;
      outputTokens?: number;
      totalTokens?: number;
      traceId?: string;
    }
  | {
      ok: true;
      kind: 'embedding';
      summary: string;
      vectorCount: number;
      dimensions: number;
      sample: number[];
      totalTokens?: number;
      traceId?: string;
    }
  | {
      ok: true;
      kind: 'artifacts';
      summary: string;
      jobId: string;
      jobState: string;
      artifactCount: number;
      artifacts?: StudioManagedArtifact[];
      firstArtifact?: StudioManagedArtifact;
      traceId?: string;
    }
  | {
      ok: true;
      kind: 'transcript';
      summary: string;
      body: string;
      charCount: number;
      jobId: string;
      jobState: string;
      artifactCount: number;
      traceId?: string;
    }
  | {
      ok: true;
      kind: 'voice-asset';
      summary: string;
      jobId: string;
      jobState: string;
      voiceAssetId: string;
      creationSource: 'reference-audio' | 'text-description';
      assetStatus: string;
      traceId?: string;
    }
  | {
      ok: true;
      kind: 'voice-catalog';
      summary: string;
      voiceCount: number;
      sample: Array<{ voiceId: string; creationSource: string; status: string }>;
      traceId?: string;
    }
  | {
      ok: false;
      kind: 'non-success';
      summary: string;
      reason: StudioNonSuccessReason;
      message: string;
      actionHint: string;
      missingSurface?: string;
      diagnostics?: StudioNonSuccessDiagnostics;
    };

export type StudioRunHistoryRecord = {
  id: string;
  capabilityId: string;
  prompt: string;
  status: string;
  message: string;
  createdAt: string;
  result?: StudioRunHistoryResultSnapshot;
  runConfig?: StudioRunConfigSnapshot;
};

export type StudioRunHistory = Record<string, StudioRunHistoryRecord[]>;

async function verifyStudioManagedArtifact(
  statArtifact: (
    artifact: StudioManagedArtifact,
    record: StudioRunHistoryRecord,
  ) => Promise<{ readonly sha256: string; readonly sizeBytes: number }>,
  artifact: StudioManagedArtifact,
  record: StudioRunHistoryRecord,
): Promise<{ readonly status: 'ready' | 'unavailable'; readonly message: string }> {
  try {
    const stored = await statArtifact(artifact, record);
    if (stored.sha256 !== artifact.sha256 || stored.sizeBytes !== artifact.sizeBytes) {
      return {
        status: 'unavailable',
        message: `Managed artifact verification failed: ${artifact.relativePath}`,
      };
    }
    return { status: 'ready', message: record.message };
  } catch {
    return {
      status: 'unavailable',
      message: `Managed artifact is unavailable: ${artifact.relativePath}`,
    };
  }
}

export async function projectStudioManagedHistory(input: {
  readonly runHistory: StudioRunHistory;
  readonly existingMediaHistory?: readonly StudioMediaHistoryRecord[];
  readonly retainUnprojectedMedia?: boolean;
  readonly resolveCapabilityLabel?: StudioCapabilityLabelResolver;
  readonly statArtifact: (
    artifact: StudioManagedArtifact,
    record: StudioRunHistoryRecord,
  ) => Promise<{ readonly sha256: string; readonly sizeBytes: number }>;
}): Promise<{
  readonly runHistory: StudioRunHistory;
  readonly mediaHistory: readonly StudioMediaHistoryRecord[];
}> {
  const existingMediaHistory = input.existingMediaHistory ?? [];
  const storedByID = new Map(existingMediaHistory.map((record) => [record.id, record]));
  const projectedIDs = new Set<string>();
  const mediaHistory: StudioMediaHistoryRecord[] = [];
  const projectedRunHistory: StudioRunHistory = {};

  for (const [capabilityId, records] of Object.entries(input.runHistory)) {
    const projectedRecords: StudioRunHistoryRecord[] = [];
    for (const record of records) {
      const result = record.result;
      let projectedRecord = record;
      let unavailableReason = '';
      if (result?.ok === true && result.kind === 'artifacts') {
        const artifacts = result.artifacts?.length
          ? result.artifacts
          : result.firstArtifact ? [result.firstArtifact] : [];
        for (const [index, artifact] of artifacts.entries()) {
          const id = index === 0 ? record.id : `${record.id}:${index}`;
          const verification = await verifyStudioManagedArtifact(input.statArtifact, artifact, record);
          const { status, message } = verification;
          if (status === 'unavailable' && !unavailableReason) unavailableReason = message;
          const capabilityLabel = input.resolveCapabilityLabel?.(record.capabilityId) || undefined;
          mediaHistory.push({
            ...storedByID.get(id),
            id,
            runId: record.id,
            kind: 'runtime-media',
            capabilityId: record.capabilityId,
            ...(capabilityLabel ? { capabilityLabel } : {}),
            title: artifact.displayName || artifact.relativePath || result.jobId || record.capabilityId,
            status,
            createdAt: record.createdAt,
            artifactCount: result.artifactCount,
            artifactLabel: artifact.displayName || artifact.relativePath,
            relativePath: artifact.relativePath,
            ...(artifact.mediaType ? { mediaType: artifact.mediaType } : {}),
            sizeBytes: artifact.sizeBytes,
            sha256: artifact.sha256,
            jobId: result.jobId,
            jobState: result.jobState,
            message,
            traceState: result.traceId ? 'captured' : 'not-captured',
            ...(result.traceId ? { traceId: result.traceId } : {}),
          });
          projectedIDs.add(id);
        }
      }
      if (unavailableReason && record.status === 'ready') {
        projectedRecord = { ...record, status: 'unavailable', message: unavailableReason };
      }
      projectedRecords.push(projectedRecord);
    }
    projectedRunHistory[capabilityId] = projectedRecords;
  }

  if (input.retainUnprojectedMedia) {
    for (const stored of existingMediaHistory) {
      if (projectedIDs.has(stored.id)) continue;
      if (stored.kind !== 'runtime-media') {
        mediaHistory.push(stored);
        continue;
      }
      if (!stored.relativePath || stored.sizeBytes === undefined || !stored.sha256) {
        mediaHistory.push({
          ...stored,
          status: 'unavailable',
          message: `Managed artifact metadata is unavailable: ${stored.relativePath || stored.id}`,
        });
        continue;
      }
      const artifact: StudioManagedArtifact = {
        relativePath: stored.relativePath,
        ...(stored.mediaType ? { mediaType: stored.mediaType } : {}),
        sizeBytes: stored.sizeBytes,
        sha256: stored.sha256,
        ...(stored.artifactLabel ? { displayName: stored.artifactLabel } : {}),
        previewSource: 'managed-asset',
      };
      const verification = await verifyStudioManagedArtifact(input.statArtifact, artifact, {
        id: stored.runId || stored.id,
        capabilityId: stored.capabilityId,
        prompt: '',
        status: stored.status,
        message: stored.message || '',
        createdAt: stored.createdAt,
      });
      mediaHistory.push({ ...stored, status: verification.status, message: verification.message });
    }
  }
  return { runHistory: projectedRunHistory, mediaHistory };
}

export type StudioFlatRunRecord = StudioRunHistoryRecord & {
  capabilityLabel: string;
};

export type StudioRunStatusTone = 'success' | 'warning' | 'danger' | 'info';
export type StudioRunIntentSource = 'local' | 'cloud' | 'unknown';
type StudioNonSuccessRunResult = Extract<StudioCapabilityRunResult, { ok: false }>;
type StudioNonSuccessHistorySnapshot = Extract<StudioRunHistoryResultSnapshot, { ok: false }>;
export type StudioRunPromptControlFact = {
  label: string;
  value: string;
  code?: boolean;
};
export type StudioRunConfigParamRow = {
  group: string;
  key: string;
  label: string;
  value: string;
  code: boolean;
};

export function studioCapabilityResultTraceId(
  result: StudioCapabilityRunResult,
): string | undefined {
  return isStudioNonSuccessRunResult(result) ? result.diagnostics?.traceId : result.trace?.traceId;
}

export function studioCapabilityResultHasTrace(
  result: StudioCapabilityRunResult,
): boolean {
  return Boolean(studioCapabilityResultTraceId(result));
}

export function studioRunHistoryStatus(result: StudioCapabilityRunResult): string {
  if (!isStudioNonSuccessRunResult(result)) return 'ready';
  if (result.reason === 'runtime-canceled' || result.reason === 'operation-aborted') return 'canceled';
  if (result.reason === 'runtime-timeout') return 'timed-out';
  return result.reason === 'runtime-call-failed' ? 'failed' : 'unavailable';
}

export function createStudioRunHistoryRecord(input: {
  readonly result: StudioCapabilityRunResult;
  readonly prompt: string;
  readonly runId: string;
  readonly createdAt: string;
  readonly runConfig?: StudioRunConfigSnapshot;
  readonly status?: string;
}): StudioRunHistoryRecord {
  const traceId = studioCapabilityResultTraceId(input.result);
  return {
    id: input.runId,
    capabilityId: input.result.capabilityId,
    prompt: input.prompt,
    status: input.status ?? studioRunHistoryStatus(input.result),
    message: input.result.message,
    createdAt: input.createdAt,
    result: createStudioRunHistoryResultSnapshot(input.result),
    runConfig: input.runConfig ? { ...input.runConfig, traceId } : undefined,
  };
}

export function flattenStudioRunHistory(
  history: StudioRunHistory | null,
  resolveCapabilityLabel: StudioCapabilityLabelResolver,
): StudioFlatRunRecord[] {
  if (!history) return [];
  const records: StudioFlatRunRecord[] = [];
  for (const [capabilityId, list] of Object.entries(history)) {
    let capabilityLabel = capabilityId;
    try {
      capabilityLabel = resolveCapabilityLabel(capabilityId) || capabilityId;
    } catch {
      capabilityLabel = capabilityId;
    }
    for (const record of list) {
      records.push({ ...record, capabilityLabel });
    }
  }
  records.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return records;
}

export function getStudioRunStatusLabel(status: StudioRunHistoryRecord['status']): string {
  if (status === 'ready') return 'runtime ready';
  if (status === 'unavailable') return 'sdk unavailable';
  if (status === 'failed') return 'failed';
  if (status === 'canceled') return 'canceled';
  if (status === 'timed-out') return 'timed out';
  return status.replaceAll('-', ' ');
}

export function getStudioRunStatusTone(status: StudioRunHistoryRecord['status']): StudioRunStatusTone {
  if (status === 'ready') return 'success';
  if (status === 'failed') return 'danger';
  if (status === 'canceled') return 'warning';
  if (status === 'timed-out') return 'warning';
  return 'info';
}

const studioRunTimeFormatter = new Intl.DateTimeFormat('en-US', {
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

const studioRunDateTimeFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

const studioRunDateTimeWithYearFormatter = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

function isSameLocalCalendarDate(left: Date, right: Date): boolean {
  return left.getFullYear() === right.getFullYear() && left.getMonth() === right.getMonth() && left.getDate() === right.getDate();
}

export function formatStudioRunTimestamp(value: string, now: Date): string {
  try {
    const date = new Date(value);
    if (Number.isNaN(date.valueOf())) return value;
    if (isSameLocalCalendarDate(date, now)) return studioRunTimeFormatter.format(date);
    if (date.getFullYear() === now.getFullYear()) return studioRunDateTimeFormatter.format(date);
    return studioRunDateTimeWithYearFormatter.format(date);
  } catch {
    return value;
  }
}

export function formatStudioRunHistoryTimestamp(value: string, now: Date): string {
  try {
    if (!value.trim()) return 'Unknown date';
    const date = new Date(value);
    if (Number.isNaN(date.valueOf())) return 'Unknown date';
    if (isSameLocalCalendarDate(date, now)) return studioRunTimeFormatter.format(date);
    if (date.getFullYear() === now.getFullYear()) return studioRunDateTimeFormatter.format(date);
    return studioRunDateTimeWithYearFormatter.format(date);
  } catch {
    return 'Unknown date';
  }
}

function compactBodySummary(value: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized) return '(empty result)';
  return normalized.length > 180 ? `${normalized.slice(0, 177)}...` : normalized;
}

function traceFields(result: StudioCapabilityRunResult): Pick<Extract<StudioRunHistoryResultSnapshot, { ok: true }>, 'traceId'> {
  if (isStudioNonSuccessRunResult(result)) return {};
  return {
    traceId: result.trace?.traceId,
  };
}

function isStudioNonSuccessRunResult(result: StudioCapabilityRunResult): result is StudioNonSuccessRunResult {
  return result.ok === false;
}

function isStudioNonSuccessHistorySnapshot(result: StudioRunHistoryResultSnapshot): result is StudioNonSuccessHistorySnapshot {
  return result.ok === false;
}

export function createStudioRunHistoryResultSnapshot(result: StudioCapabilityRunResult): StudioRunHistoryResultSnapshot {
  if (isStudioNonSuccessRunResult(result)) {
    return {
      ok: false,
      kind: 'non-success',
      summary: result.message,
      reason: result.reason,
      message: result.message,
      actionHint: result.actionHint,
      missingSurface: result.missingSurface,
      ...(result.diagnostics ? { diagnostics: { ...result.diagnostics } } : {}),
    };
  }

  const trace = traceFields(result);
  const output = result.output;
  if (output.kind === 'text') {
    return {
      ok: true,
      kind: 'text',
      summary: compactBodySummary(output.text),
      body: output.text,
      charCount: output.text.length,
      finishReason: output.finishReason,
      streamed: output.streamed,
      inputTokens: output.inputTokens,
      outputTokens: output.outputTokens,
      totalTokens: output.totalTokens,
      ...trace,
    };
  }
  if (output.kind === 'embedding') {
    return {
      ok: true,
      kind: 'embedding',
      summary: `${output.vectorCount} vector${output.vectorCount === 1 ? '' : 's'} / ${output.dimensions} dimensions`,
      vectorCount: output.vectorCount,
      dimensions: output.dimensions,
      sample: output.sample,
      totalTokens: output.totalTokens,
      ...trace,
    };
  }
  if (output.kind === 'artifacts') {
    const artifacts = output.artifacts.map((artifact) => ({ ...artifact }));
    const firstArtifact = artifacts[0];
    return {
      ok: true,
      kind: 'artifacts',
      summary: `${output.jobState || 'unknown'} / ${output.artifactCount} artifact${output.artifactCount === 1 ? '' : 's'}${firstArtifact?.mediaType ? ` / ${firstArtifact.mediaType}` : ''}`,
      jobId: output.jobId,
      jobState: output.jobState,
      artifactCount: output.artifactCount,
      artifacts,
      firstArtifact,
      ...trace,
    };
  }
  if (output.kind === 'transcript') {
    return {
      ok: true,
      kind: 'transcript',
      summary: compactBodySummary(output.text),
      body: output.text,
      charCount: output.text.length,
      jobId: output.jobId,
      jobState: output.jobState,
      artifactCount: output.artifactCount,
      ...trace,
    };
  }
  if (output.kind === 'voice-asset') {
    return {
      ok: true,
      kind: 'voice-asset',
      summary: `${output.creationSource} / ${output.assetStatus} / ${output.voiceAssetId}`,
      jobId: output.jobId,
      jobState: output.jobState,
      voiceAssetId: output.voiceAssetId,
      creationSource: output.creationSource,
      assetStatus: output.assetStatus,
      ...trace,
    };
  }
  return {
    ok: true,
    kind: 'voice-catalog',
    summary: `${output.voiceCount} voice${output.voiceCount === 1 ? '' : 's'}${output.sample.length ? ` / ${output.sample.map((voice) => voice.voiceId).filter(Boolean).join(', ')}` : ''}`,
    voiceCount: output.voiceCount,
    sample: output.sample,
    traceId: result.trace?.traceId,
  };
}

export function restoreStudioCapabilityRunResult(
  record: StudioRunHistoryRecord,
  resolveCapabilityLabel: StudioCapabilityLabelResolver,
): StudioCapabilityRunResult | null {
  const snapshot = record.result;
  if (!snapshot) return null;
  if (isStudioNonSuccessHistorySnapshot(snapshot)) {
    return {
      ok: false,
      capabilityId: record.capabilityId,
      reason: snapshot.reason,
      message: snapshot.message,
      actionHint: snapshot.actionHint,
      ...(snapshot.missingSurface ? { missingSurface: snapshot.missingSurface } : {}),
      ...(snapshot.diagnostics ? { diagnostics: { ...snapshot.diagnostics } } : {}),
    };
  }

  let capabilityLabel: string;
  try {
    capabilityLabel = resolveCapabilityLabel(record.capabilityId) || '';
    if (!capabilityLabel) return null;
  } catch {
    return null;
  }
  const trace = snapshot.traceId
    ? { traceId: snapshot.traceId }
    : undefined;
  const common = {
    ok: true as const,
    capabilityId: record.capabilityId,
    capabilityLabel,
    message: record.message,
    ...(trace ? { trace } : {}),
  };
  if (snapshot.kind === 'text') {
    return {
      ...common,
      output: {
        kind: 'text',
        text: snapshot.body,
        finishReason: snapshot.finishReason,
        streamed: snapshot.streamed,
        inputTokens: snapshot.inputTokens,
        outputTokens: snapshot.outputTokens,
        totalTokens: snapshot.totalTokens,
      },
    };
  }
  if (snapshot.kind === 'embedding') {
    return {
      ...common,
      output: {
        kind: 'embedding',
        vectorCount: snapshot.vectorCount,
        dimensions: snapshot.dimensions,
        sample: snapshot.sample,
        totalTokens: snapshot.totalTokens,
      },
    };
  }
  if (snapshot.kind === 'artifacts') {
    const artifacts = snapshot.artifacts?.map((artifact) => ({ ...artifact }))
      ?? (snapshot.firstArtifact ? [{ ...snapshot.firstArtifact }] : []);
    return {
      ...common,
      output: {
        kind: 'artifacts',
        jobId: snapshot.jobId,
        jobState: snapshot.jobState,
        artifactCount: snapshot.artifactCount,
        artifacts,
        ...(artifacts[0] ? { firstArtifact: artifacts[0] } : {}),
      },
    };
  }
  if (snapshot.kind === 'transcript') {
    return {
      ...common,
      output: {
        kind: 'transcript',
        text: snapshot.body,
        jobId: snapshot.jobId,
        jobState: snapshot.jobState,
        artifactCount: snapshot.artifactCount,
      },
    };
  }
  if (snapshot.kind === 'voice-asset') {
    return {
      ...common,
      output: {
        kind: 'voice-asset',
        jobId: snapshot.jobId,
        jobState: snapshot.jobState,
        voiceAssetId: snapshot.voiceAssetId,
        creationSource: snapshot.creationSource,
        assetStatus: snapshot.assetStatus,
        voiceReference: { kind: 'voice_asset_id', voiceAssetId: snapshot.voiceAssetId },
      },
    };
  }
  return {
    ...common,
    output: {
      kind: 'voice-catalog',
      voiceCount: snapshot.voiceCount,
      sample: snapshot.sample,
    },
  };
}

export function getStudioRunResultSummary(record: StudioRunHistoryRecord): string {
  return record.result?.summary || record.message;
}

export function getStudioRunPromptSummary(record: StudioRunHistoryRecord): string {
  const normalized = record.prompt.replace(/\s+/g, ' ').trim();
  return normalized.length > 130 ? `${normalized.slice(0, 127)}...` : normalized;
}

function formatStudioTokenUsage(inputTokens?: number, outputTokens?: number, totalTokens?: number): string {
  const resolvedTotal = totalTokens ?? (inputTokens !== undefined && outputTokens !== undefined ? inputTokens + outputTokens : undefined);
  if (resolvedTotal !== undefined) return `${resolvedTotal} tokens`;
  return '';
}

function compactSettingValue(value: string, maxLength = 220): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 3)}...` : normalized;
}

function formatStudioRunConfigValue(value: unknown): { value: string; code: boolean } {
  if (value === null) return { value: 'null', code: true };
  if (typeof value === 'string') return { value: value.length > 0 ? value : '""', code: false };
  if (typeof value === 'number' || typeof value === 'boolean') return { value: String(value), code: true };
  if (Array.isArray(value) && value.every((entry) => typeof entry === 'string')) {
    return { value: value.join(', '), code: false };
  }
  if (Array.isArray(value) || isJsonObject(value)) {
    try {
      return { value: JSON.stringify(value), code: true };
    } catch {
      return { value: String(value), code: true };
    }
  }
  return { value: String(value), code: false };
}

function pushFact(out: StudioRunPromptControlFact[], label: string, value: string | null | undefined, code = false): void {
  const normalized = typeof value === 'string' ? compactSettingValue(value) : '';
  if (normalized) out.push({ label, value: normalized, code });
}

export function getStudioRunPromptControlFacts(runConfig: StudioRunConfigSnapshot): StudioRunPromptControlFact[] {
  const facts: StudioRunPromptControlFact[] = [];
  if (runConfig.promptControls.toneSelected) {
    pushFact(facts, 'Tone', runConfig.promptControls.tone);
  }
  if (runConfig.promptControls.lengthSelected) {
    pushFact(facts, 'Length', runConfig.promptControls.length);
  }
  if (runConfig.promptControls.attachmentCount > 0) {
    facts.push({
      label: 'Attachments',
      value: String(runConfig.promptControls.attachmentCount),
      code: true,
    });
  }
  return facts;
}

const PARAM_GROUP_LABELS = {
  prompt: 'Prompt controls',
  generation: 'Generation defaults',
  response: 'Response controls',
  advanced: 'Advanced settings',
} as const;

const TEXT_REQUEST_PARAM_ORDER: ReadonlyArray<{ key: string; label: string; group: string }> = [
  { key: 'tone', label: 'Tone', group: PARAM_GROUP_LABELS.prompt },
  { key: 'length', label: 'Length', group: PARAM_GROUP_LABELS.prompt },
  { key: 'temperature', label: 'Temperature', group: PARAM_GROUP_LABELS.generation },
  { key: 'maxTokens', label: 'Max Tokens', group: PARAM_GROUP_LABELS.generation },
  { key: 'topP', label: 'Top P', group: PARAM_GROUP_LABELS.generation },
  { key: 'topK', label: 'Top K', group: PARAM_GROUP_LABELS.generation },
  { key: 'stop', label: 'Stop Sequences', group: PARAM_GROUP_LABELS.response },
  { key: 'seed', label: 'Seed', group: PARAM_GROUP_LABELS.response },
  { key: 'presencePenalty', label: 'Presence Penalty', group: PARAM_GROUP_LABELS.advanced },
  { key: 'frequencyPenalty', label: 'Frequency Penalty', group: PARAM_GROUP_LABELS.advanced },
];

const HIDDEN_REQUEST_PARAM_KEYS = Object.freeze([
  'companionSlots',
  'profileEntries',
  'profile_entries',
  'entryOverrides',
  'entry_overrides',
] as const);

function hasRunConfigParam(value: unknown): boolean {
  if (typeof value === 'string') return value.trim().length > 0;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'boolean') return true;
  if (Array.isArray(value)) return value.length > 0;
  return Boolean(value);
}

function runConfigParamDefinitions(runConfig: StudioRunConfigSnapshot): ReadonlyArray<{ key: string; label: string; group: string }> {
  if (runConfig.target.capabilityId === 'text.generate' || runConfig.target.capabilityId === 'chat.stream') {
    return TEXT_REQUEST_PARAM_ORDER;
  }
  return Object.keys(runConfig.target.params)
    .filter((key) => !HIDDEN_REQUEST_PARAM_KEYS.includes(key as (typeof HIDDEN_REQUEST_PARAM_KEYS)[number]))
    .map((key) => ({ key, label: key, group: 'Request parameters' }));
}

export function getStudioRunConfigParamRows(runConfig: StudioRunConfigSnapshot): StudioRunConfigParamRow[] {
  const params = runConfig.target.params;
  if (!isJsonObject(params)) return [];
  return runConfigParamDefinitions(runConfig).flatMap((definition) => {
    const value = params[definition.key];
    if (!hasRunConfigParam(value)) return [];
    const formatted = formatStudioRunConfigValue(value);
    return [{
      group: definition.group,
      key: definition.key,
      label: definition.label,
      value: formatted.value,
      code: formatted.code,
    }];
  });
}

export function getStudioRunIntentLabel(record: StudioRunHistoryRecord): string {
  const label = record.runConfig?.target.intentLabel?.trim();
  if (label) return label;
  return getStudioRunStatusLabel(record.status);
}

export function getStudioRunIntentSource(record: StudioRunHistoryRecord): StudioRunIntentSource {
  const targetSource = record.runConfig?.target.source;
  if (targetSource === 'local') return 'local';
  if (targetSource === 'cloud') return 'cloud';
  return 'unknown';
}

export function getStudioRunMetricSummary(record: StudioRunHistoryRecord): string {
  const result = record.result;
  if (!result) return getStudioRunResultSummary(record);
  if (isStudioNonSuccessHistorySnapshot(result)) return result.reason;
  if (result.kind === 'text') {
    return [
      formatStudioTokenUsage(result.inputTokens, result.outputTokens, result.totalTokens),
      `${result.charCount} chars`,
    ].filter(Boolean).join(' / ');
  }
  if (result.kind === 'embedding') {
    return [
      formatStudioTokenUsage(undefined, undefined, result.totalTokens),
      `${result.vectorCount} vector${result.vectorCount === 1 ? '' : 's'}`,
      `${result.dimensions} dims`,
    ].filter(Boolean).join(' / ');
  }
  if (result.kind === 'artifacts') return `${result.jobState || 'unknown'} / ${result.artifactCount} artifact${result.artifactCount === 1 ? '' : 's'}`;
  if (result.kind === 'transcript') return `${result.jobState || 'unknown'} / ${result.charCount} chars / ${result.artifactCount} artifact${result.artifactCount === 1 ? '' : 's'}`;
  if (result.kind === 'voice-asset') return `${result.jobState || 'unknown'} / ${result.creationSource} / ${result.assetStatus}`;
  return `${result.voiceCount} voice${result.voiceCount === 1 ? '' : 's'}`;
}

export function getStudioRunResultTags(record: StudioRunHistoryRecord): string[] {
  const result = record.result;
  if (!result) return [record.status === 'ready' ? 'Runtime' : getStudioRunStatusLabel(record.status)];
  if (isStudioNonSuccessHistorySnapshot(result)) return [result.reason];
  if (result.kind === 'text') {
    return [
      result.streamed ? 'Stream' : 'Runtime',
      `${result.charCount} chars`,
      result.totalTokens === undefined ? '' : `${result.totalTokens} tokens`,
    ].filter(Boolean);
  }
  if (result.kind === 'embedding') return ['Embedding ready'];
  if (result.kind === 'artifacts') return ['Ready'];
  if (result.kind === 'transcript') return ['Ready'];
  if (result.kind === 'voice-asset') return ['VoiceAsset ready', result.creationSource];
  return [`${result.voiceCount} voices`];
}
