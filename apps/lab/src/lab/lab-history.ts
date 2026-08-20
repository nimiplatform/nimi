import { getLabCapability, type LabCapabilityId } from './lab-capabilities.js';
import { isJsonObject } from '@nimiplatform/sdk/types';
import type { LabCapabilityRunResult, LabManagedArtifact } from './lab-runtime.js';
import type { LabRunTargetSummary } from './lab-run-target.js';
import type { LabNonSuccessDiagnostics, LabNonSuccessReason } from './lab-non-success.js';

export type LabRunConfigSnapshot = {
  target: Pick<
    LabRunTargetSummary,
    | 'capabilityId'
    | 'capabilityContract'
    | 'section'
    | 'status'
    | 'source'
    | 'intentLabel'
    | 'detail'
    | 'params'
    | 'paramsSummary'
    | 'profileOrigin'
  >;
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

export type LabRunHistoryResultSnapshot =
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
      simulated?: boolean;
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
      simulated?: boolean;
    }
  | {
      ok: true;
      kind: 'artifacts';
      summary: string;
      jobId: string;
      jobState: string;
      artifactCount: number;
      artifacts?: LabManagedArtifact[];
      firstArtifact?: LabManagedArtifact;
      traceId?: string;
      simulated?: boolean;
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
      simulated?: boolean;
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
      simulated?: boolean;
    }
  | {
      ok: true;
      kind: 'voice-catalog';
      summary: string;
      voiceCount: number;
      sample: Array<{ voiceId: string; creationSource: string; status: string }>;
      traceId?: string;
      simulated?: boolean;
    }
  | {
      ok: false;
      kind: 'non-success';
      summary: string;
      reason: LabNonSuccessReason;
      message: string;
      actionHint: string;
      missingSurface?: string;
      diagnostics?: LabNonSuccessDiagnostics;
    };

export type LabRunHistoryRecord = {
  id: string;
  capabilityId: string;
  prompt: string;
  status: 'unavailable' | 'ready' | 'simulated' | 'failed' | 'canceled' | 'timed-out' | 'local-fixture';
  message: string;
  createdAt: string;
  result?: LabRunHistoryResultSnapshot;
  runConfig?: LabRunConfigSnapshot;
};

export type LabRunHistory = Record<string, LabRunHistoryRecord[]>;

export type LabFlatRunRecord = LabRunHistoryRecord & {
  capabilityLabel: string;
};

export type LabRunStatusTone = 'success' | 'warning' | 'danger' | 'info';
export type LabRunIntentSource = 'local' | 'cloud' | 'unknown';
type LabNonSuccessRunResult = Extract<LabCapabilityRunResult, { ok: false }>;
type LabNonSuccessHistorySnapshot = Extract<LabRunHistoryResultSnapshot, { ok: false }>;
export type LabRunPromptControlFact = {
  label: string;
  value: string;
  code?: boolean;
};
export type LabRunConfigParamRow = {
  group: string;
  key: string;
  label: string;
  value: string;
  code: boolean;
};

export function flattenLabRunHistory(history: LabRunHistory | null): LabFlatRunRecord[] {
  if (!history) return [];
  const records: LabFlatRunRecord[] = [];
  for (const [capabilityId, list] of Object.entries(history)) {
    let capabilityLabel = capabilityId;
    try {
      capabilityLabel = getLabCapability(capabilityId as LabCapabilityId).label;
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

export function getLabRunStatusLabel(status: LabRunHistoryRecord['status']): string {
  if (status === 'ready') return 'runtime ready';
  if (status === 'simulated') return 'simulated result';
  if (status === 'unavailable') return 'sdk unavailable';
  if (status === 'failed') return 'failed';
  if (status === 'canceled') return 'canceled';
  if (status === 'timed-out') return 'timed out';
  return 'local fixture';
}

export function getLabRunStatusTone(status: LabRunHistoryRecord['status']): LabRunStatusTone {
  if (status === 'ready') return 'success';
  if (status === 'simulated') return 'info';
  if (status === 'local-fixture') return 'info';
  if (status === 'failed') return 'danger';
  if (status === 'canceled') return 'warning';
  if (status === 'timed-out') return 'warning';
  return 'warning';
}

const labRunTimeFormatter = new Intl.DateTimeFormat('en-US', {
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

const labRunDateTimeFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

const labRunDateTimeWithYearFormatter = new Intl.DateTimeFormat('en-US', {
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

export function formatLabRunTimestamp(value: string, now: Date): string {
  try {
    const date = new Date(value);
    if (Number.isNaN(date.valueOf())) return value;
    if (isSameLocalCalendarDate(date, now)) return labRunTimeFormatter.format(date);
    if (date.getFullYear() === now.getFullYear()) return labRunDateTimeFormatter.format(date);
    return labRunDateTimeWithYearFormatter.format(date);
  } catch {
    return value;
  }
}

export function formatLabRunHistoryTimestamp(value: string, now: Date): string {
  try {
    if (!value.trim()) return 'Unknown date';
    const date = new Date(value);
    if (Number.isNaN(date.valueOf())) return 'Unknown date';
    if (isSameLocalCalendarDate(date, now)) return labRunTimeFormatter.format(date);
    if (date.getFullYear() === now.getFullYear()) return labRunDateTimeFormatter.format(date);
    return labRunDateTimeWithYearFormatter.format(date);
  } catch {
    return 'Unknown date';
  }
}

function compactBodySummary(value: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized) return '(empty result)';
  return normalized.length > 180 ? `${normalized.slice(0, 177)}...` : normalized;
}

function traceFields(result: LabCapabilityRunResult): Pick<Extract<LabRunHistoryResultSnapshot, { ok: true }>, 'traceId' | 'simulated'> {
  if (isLabNonSuccessRunResult(result)) return {};
  return {
    traceId: result.trace?.traceId,
    simulated: result.trace?.simulated,
  };
}

function isLabNonSuccessRunResult(result: LabCapabilityRunResult): result is LabNonSuccessRunResult {
  return result.ok === false;
}

function isLabNonSuccessHistorySnapshot(result: LabRunHistoryResultSnapshot): result is LabNonSuccessHistorySnapshot {
  return result.ok === false;
}

export function createLabRunHistoryResultSnapshot(result: LabCapabilityRunResult): LabRunHistoryResultSnapshot {
  if (isLabNonSuccessRunResult(result)) {
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
    simulated: result.trace?.simulated,
  };
}

export function restoreLabCapabilityRunResult(record: LabRunHistoryRecord): LabCapabilityRunResult | null {
  const snapshot = record.result;
  if (!snapshot) return null;
  if (isLabNonSuccessHistorySnapshot(snapshot)) {
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
    capabilityLabel = getLabCapability(record.capabilityId as LabCapabilityId).label;
  } catch {
    return null;
  }
  const trace = snapshot.traceId || snapshot.simulated !== undefined
    ? { traceId: snapshot.traceId, simulated: snapshot.simulated }
    : undefined;
  const common = {
    ok: true as const,
    capabilityId: record.capabilityId as LabCapabilityId,
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

export function getLabRunResultSummary(record: LabRunHistoryRecord): string {
  return record.result?.summary || record.message;
}

export function getLabRunPromptSummary(record: LabRunHistoryRecord): string {
  const normalized = record.prompt.replace(/\s+/g, ' ').trim();
  return normalized.length > 130 ? `${normalized.slice(0, 127)}...` : normalized;
}

function formatLabTokenUsage(inputTokens?: number, outputTokens?: number, totalTokens?: number): string {
  const resolvedTotal = totalTokens ?? (inputTokens !== undefined && outputTokens !== undefined ? inputTokens + outputTokens : undefined);
  if (resolvedTotal !== undefined) return `${resolvedTotal} tokens`;
  return '';
}

function compactSettingValue(value: string, maxLength = 220): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 3)}...` : normalized;
}

function formatLabRunConfigValue(value: unknown): { value: string; code: boolean } {
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

function pushFact(out: LabRunPromptControlFact[], label: string, value: string | null | undefined, code = false): void {
  const normalized = typeof value === 'string' ? compactSettingValue(value) : '';
  if (normalized) out.push({ label, value: normalized, code });
}

export function getLabRunPromptControlFacts(runConfig: LabRunConfigSnapshot): LabRunPromptControlFact[] {
  const facts: LabRunPromptControlFact[] = [];
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

function runConfigParamDefinitions(runConfig: LabRunConfigSnapshot): ReadonlyArray<{ key: string; label: string; group: string }> {
  if (runConfig.target.capabilityId === 'text.generate' || runConfig.target.capabilityId === 'chat.stream') {
    return TEXT_REQUEST_PARAM_ORDER;
  }
  return Object.keys(runConfig.target.params)
    .filter((key) => !HIDDEN_REQUEST_PARAM_KEYS.includes(key as (typeof HIDDEN_REQUEST_PARAM_KEYS)[number]))
    .map((key) => ({ key, label: key, group: 'Request parameters' }));
}

export function getLabRunConfigParamRows(runConfig: LabRunConfigSnapshot): LabRunConfigParamRow[] {
  const params = runConfig.target.params;
  if (!isJsonObject(params)) return [];
  return runConfigParamDefinitions(runConfig).flatMap((definition) => {
    const value = params[definition.key];
    if (!hasRunConfigParam(value)) return [];
    const formatted = formatLabRunConfigValue(value);
    return [{
      group: definition.group,
      key: definition.key,
      label: definition.label,
      value: formatted.value,
      code: formatted.code,
    }];
  });
}

export function getLabRunIntentLabel(record: LabRunHistoryRecord): string {
  const label = record.runConfig?.target.intentLabel?.trim();
  if (label) return label;
  if (record.status === 'local-fixture') return 'Local fixture';
  return getLabRunStatusLabel(record.status);
}

export function getLabRunIntentSource(record: LabRunHistoryRecord): LabRunIntentSource {
  const targetSource = record.runConfig?.target.source;
  if (targetSource === 'local' || targetSource === 'local-fixture') return 'local';
  if (targetSource === 'cloud') return 'cloud';
  return record.status === 'local-fixture' ? 'local' : 'unknown';
}

export function getLabRunMetricSummary(record: LabRunHistoryRecord): string {
  const result = record.result;
  if (!result) return getLabRunResultSummary(record);
  if (isLabNonSuccessHistorySnapshot(result)) return result.reason;
  if (result.kind === 'text') {
    return [
      formatLabTokenUsage(result.inputTokens, result.outputTokens, result.totalTokens),
      `${result.charCount} chars`,
    ].filter(Boolean).join(' / ');
  }
  if (result.kind === 'embedding') {
    return [
      formatLabTokenUsage(undefined, undefined, result.totalTokens),
      `${result.vectorCount} vector${result.vectorCount === 1 ? '' : 's'}`,
      `${result.dimensions} dims`,
    ].filter(Boolean).join(' / ');
  }
  if (result.kind === 'artifacts') return `${result.jobState || 'unknown'} / ${result.artifactCount} artifact${result.artifactCount === 1 ? '' : 's'}`;
  if (result.kind === 'transcript') return `${result.jobState || 'unknown'} / ${result.charCount} chars / ${result.artifactCount} artifact${result.artifactCount === 1 ? '' : 's'}`;
  if (result.kind === 'voice-asset') return `${result.jobState || 'unknown'} / ${result.creationSource} / ${result.assetStatus}`;
  return `${result.voiceCount} voice${result.voiceCount === 1 ? '' : 's'}`;
}

export function getLabRunResultTags(record: LabRunHistoryRecord): string[] {
  const result = record.result;
  if (!result) return [record.status === 'ready' ? 'Runtime' : getLabRunStatusLabel(record.status)];
  if (isLabNonSuccessHistorySnapshot(result)) return [result.reason];
  if (result.kind === 'text') {
    return [
      record.status === 'simulated' ? 'Simulator' : result.streamed ? 'Stream' : 'Runtime',
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
