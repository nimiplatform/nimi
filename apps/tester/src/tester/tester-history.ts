import { invokeTesterCommand } from './tester-tauri.js';
import { getTesterCapability, type TesterCapabilityId } from './tester-capabilities.js';
import { withTesterDataStorageRoot } from './tester-app-storage.js';
import { isJsonObject } from '@nimiplatform/sdk/types';
import type { TesterCapabilityRunResult } from './tester-runtime.js';
import type { TesterRunTargetSummary } from './tester-run-target.js';

export type TesterRunConfigSnapshot = {
  target: Pick<
    TesterRunTargetSummary,
    | 'capabilityId'
    | 'bindingCapabilityId'
    | 'section'
    | 'status'
    | 'source'
    | 'modelLabel'
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

export type TesterRunHistoryResultSnapshot =
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
      modelResolved?: string;
      routeDecision?: string;
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
      modelResolved?: string;
      routeDecision?: string;
    }
  | {
      ok: true;
      kind: 'artifacts';
      summary: string;
      jobId: string;
      jobState: string;
      artifactCount: number;
      firstArtifact?: {
        artifactId?: string;
        mimeType?: string;
        url?: string;
        displayName?: string;
      };
      traceId?: string;
      modelResolved?: string;
      routeDecision?: string;
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
      modelResolved?: string;
      routeDecision?: string;
    }
  | {
      ok: true;
      kind: 'voice-catalog';
      summary: string;
      modelResolved: string;
      voiceCount: number;
      sample: Array<{ voiceId: string; name: string; lang: string }>;
      traceId?: string;
      routeDecision?: string;
    }
  | {
      ok: false;
      kind: 'unavailable';
      summary: string;
      reason: string;
      message: string;
      actionHint: string;
      missingSurface?: string;
      runtimeRequest?: {
        request?: unknown;
        options?: unknown;
      };
    };

export type TesterRunHistoryRecord = {
  id: string;
  capabilityId: string;
  prompt: string;
  status: 'unavailable' | 'ready' | 'failed' | 'local-fixture';
  message: string;
  createdAt: string;
  result?: TesterRunHistoryResultSnapshot;
  runConfig?: TesterRunConfigSnapshot;
};

export type TesterRunHistory = Record<string, TesterRunHistoryRecord[]>;

export type TesterFlatRunRecord = TesterRunHistoryRecord & {
  capabilityLabel: string;
};

export type TesterRunStatusTone = 'success' | 'warning' | 'danger' | 'info';
export type TesterRunModelSource = 'local' | 'cloud' | 'unknown';
type TesterUnavailableRunResult = Extract<TesterCapabilityRunResult, { ok: false }>;
type TesterUnavailableHistorySnapshot = Extract<TesterRunHistoryResultSnapshot, { ok: false }>;
export type TesterRunPromptControlFact = {
  label: string;
  value: string;
  code?: boolean;
};
export type TesterRunConfigParamRow = {
  group: string;
  key: string;
  label: string;
  value: string;
  code: boolean;
};

export function flattenTesterRunHistory(history: TesterRunHistory | null): TesterFlatRunRecord[] {
  if (!history) return [];
  const records: TesterFlatRunRecord[] = [];
  for (const [capabilityId, list] of Object.entries(history)) {
    let capabilityLabel = capabilityId;
    try {
      capabilityLabel = getTesterCapability(capabilityId as TesterCapabilityId).label;
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

export function getTesterRunStatusLabel(status: TesterRunHistoryRecord['status']): string {
  if (status === 'ready') return 'runtime ready';
  if (status === 'unavailable') return 'sdk unavailable';
  if (status === 'failed') return 'failed';
  return 'local fixture';
}

export function getTesterRunStatusTone(status: TesterRunHistoryRecord['status']): TesterRunStatusTone {
  if (status === 'ready') return 'success';
  if (status === 'local-fixture') return 'info';
  if (status === 'failed') return 'danger';
  return 'warning';
}

const testerRunTimeFormatter = new Intl.DateTimeFormat('en-US', {
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

const testerRunDateTimeFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

const testerRunDateTimeWithYearFormatter = new Intl.DateTimeFormat('en-US', {
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

export function formatTesterRunTimestamp(value: string, now = new Date()): string {
  try {
    const date = new Date(value);
    if (Number.isNaN(date.valueOf())) return value;
    if (isSameLocalCalendarDate(date, now)) return testerRunTimeFormatter.format(date);
    if (date.getFullYear() === now.getFullYear()) return testerRunDateTimeFormatter.format(date);
    return testerRunDateTimeWithYearFormatter.format(date);
  } catch {
    return value;
  }
}

export function formatTesterRunHistoryTimestamp(value: string, now = new Date()): string {
  try {
    if (!value.trim()) return 'Unknown date';
    const date = new Date(value);
    if (Number.isNaN(date.valueOf())) return 'Unknown date';
    if (isSameLocalCalendarDate(date, now)) return testerRunTimeFormatter.format(date);
    if (date.getFullYear() === now.getFullYear()) return testerRunDateTimeFormatter.format(date);
    return testerRunDateTimeWithYearFormatter.format(date);
  } catch {
    return 'Unknown date';
  }
}

function compactBodySummary(value: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized) return '(empty result)';
  return normalized.length > 180 ? `${normalized.slice(0, 177)}...` : normalized;
}

function traceFields(result: TesterCapabilityRunResult): Pick<Extract<TesterRunHistoryResultSnapshot, { ok: true }>, 'traceId' | 'modelResolved' | 'routeDecision'> {
  if (isTesterUnavailableRunResult(result)) return {};
  return {
    traceId: result.trace?.traceId,
    modelResolved: result.trace?.modelResolved,
    routeDecision: result.trace?.routeDecision,
  };
}

function isTesterUnavailableRunResult(result: TesterCapabilityRunResult): result is TesterUnavailableRunResult {
  return result.ok === false;
}

function isTesterUnavailableHistorySnapshot(result: TesterRunHistoryResultSnapshot): result is TesterUnavailableHistorySnapshot {
  return result.ok === false;
}

function hostedArtifactUrl(url: string | undefined): string | undefined {
  if (!url || url.startsWith('data:')) return undefined;
  return url;
}

export function createTesterRunHistoryResultSnapshot(result: TesterCapabilityRunResult): TesterRunHistoryResultSnapshot {
  if (isTesterUnavailableRunResult(result)) {
    return {
      ok: false,
      kind: 'unavailable',
      summary: result.message,
      reason: result.reason,
      message: result.message,
      actionHint: result.actionHint,
      missingSurface: result.missingSurface,
      runtimeRequest: result.runtimeRequest,
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
    const firstArtifact = output.firstArtifact
      ? {
          artifactId: output.firstArtifact.artifactId,
          mimeType: output.firstArtifact.mimeType,
          url: hostedArtifactUrl(output.firstArtifact.url),
          displayName: output.firstArtifact.displayName,
        }
      : undefined;
    return {
      ok: true,
      kind: 'artifacts',
      summary: `${output.jobState || 'unknown'} / ${output.artifactCount} artifact${output.artifactCount === 1 ? '' : 's'}${firstArtifact?.mimeType ? ` / ${firstArtifact.mimeType}` : ''}`,
      jobId: output.jobId,
      jobState: output.jobState,
      artifactCount: output.artifactCount,
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
  return {
    ok: true,
    kind: 'voice-catalog',
    summary: `${output.voiceCount} voice${output.voiceCount === 1 ? '' : 's'}${output.sample.length ? ` / ${output.sample.map((voice) => voice.name || voice.voiceId).filter(Boolean).join(', ')}` : ''}`,
    modelResolved: output.modelResolved,
    voiceCount: output.voiceCount,
    sample: output.sample,
    traceId: result.trace?.traceId,
    routeDecision: result.trace?.routeDecision,
  };
}

export function getTesterRunResultSummary(record: TesterRunHistoryRecord): string {
  return record.result?.summary || record.message;
}

export function getTesterRunPromptSummary(record: TesterRunHistoryRecord): string {
  const normalized = record.prompt.replace(/\s+/g, ' ').trim();
  return normalized.length > 130 ? `${normalized.slice(0, 127)}...` : normalized;
}

function formatTesterTokenUsage(inputTokens?: number, outputTokens?: number, totalTokens?: number): string {
  const resolvedTotal = totalTokens ?? (inputTokens !== undefined && outputTokens !== undefined ? inputTokens + outputTokens : undefined);
  if (resolvedTotal !== undefined) return `${resolvedTotal} tokens`;
  return '';
}

function cleanTesterRunModelName(value: string): string {
  const normalized = value.trim();
  return normalized.replace(/^(local-import|local|cloud)\//i, '').trim() || normalized;
}

function isOpaqueRuntimeModelId(value: string): boolean {
  return /^[0-9A-HJKMNP-TV-Z]{20,32}$/u.test(value.trim());
}

function genericTesterRunModelLabel(source: TesterRunModelSource): string {
  if (source === 'local') return 'Local runtime model';
  if (source === 'cloud') return 'Cloud model';
  return 'Runtime model';
}

function compactSettingValue(value: string, maxLength = 220): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 3)}...` : normalized;
}

function formatTesterRunConfigValue(value: unknown): { value: string; code: boolean } {
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

function pushFact(out: TesterRunPromptControlFact[], label: string, value: string | null | undefined, code = false): void {
  const normalized = typeof value === 'string' ? compactSettingValue(value) : '';
  if (normalized) out.push({ label, value: normalized, code });
}

export function getTesterRunPromptControlFacts(runConfig: TesterRunConfigSnapshot): TesterRunPromptControlFact[] {
  const facts: TesterRunPromptControlFact[] = [];
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

const TEXT_MODEL_PARAM_ORDER: ReadonlyArray<{ key: string; label: string; group: string }> = [
  { key: 'tone', label: 'Tone', group: PARAM_GROUP_LABELS.prompt },
  { key: 'length', label: 'Length', group: PARAM_GROUP_LABELS.prompt },
  { key: 'temperature', label: 'Temperature', group: PARAM_GROUP_LABELS.generation },
  { key: 'maxTokens', label: 'Max Tokens', group: PARAM_GROUP_LABELS.generation },
  { key: 'topP', label: 'Top P', group: PARAM_GROUP_LABELS.generation },
  { key: 'topK', label: 'Top K', group: PARAM_GROUP_LABELS.generation },
  { key: 'timeoutMs', label: 'Timeout', group: PARAM_GROUP_LABELS.response },
  { key: 'stopSequences', label: 'Stop Sequences', group: PARAM_GROUP_LABELS.response },
  { key: 'presencePenalty', label: 'Presence Penalty', group: PARAM_GROUP_LABELS.advanced },
  { key: 'frequencyPenalty', label: 'Frequency Penalty', group: PARAM_GROUP_LABELS.advanced },
];

const HIDDEN_MODEL_PARAM_KEYS = new Set([
  'companionSlots',
  'profileEntries',
  'profile_entries',
  'entryOverrides',
  'entry_overrides',
]);

function hasRunConfigParam(value: unknown): boolean {
  if (typeof value === 'string') return value.trim().length > 0;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.length > 0;
  return Boolean(value);
}

function runConfigParamDefinitions(runConfig: TesterRunConfigSnapshot): ReadonlyArray<{ key: string; label: string; group: string }> {
  if (runConfig.target.capabilityId === 'text.generate' || runConfig.target.capabilityId === 'chat.stream') {
    return TEXT_MODEL_PARAM_ORDER;
  }
  return Object.keys(runConfig.target.params)
    .filter((key) => !HIDDEN_MODEL_PARAM_KEYS.has(key))
    .map((key) => ({ key, label: key, group: 'Model parameters' }));
}

export function getTesterRunConfigParamRows(runConfig: TesterRunConfigSnapshot): TesterRunConfigParamRow[] {
  const params = runConfig.target.params;
  if (!isJsonObject(params)) return [];
  return runConfigParamDefinitions(runConfig).flatMap((definition) => {
    const value = params[definition.key];
    if (!hasRunConfigParam(value)) return [];
    const formatted = formatTesterRunConfigValue(value);
    return [{
      group: definition.group,
      key: definition.key,
      label: definition.label,
      value: formatted.value,
      code: formatted.code,
    }];
  });
}

function routeDecisionModelSource(value: string | undefined): TesterRunModelSource {
  const normalized = (value || '').trim().toLowerCase();
  if (normalized === 'local' || normalized === '1' || normalized === 'route_policy_local') return 'local';
  if (normalized === 'cloud' || normalized === '2' || normalized === 'route_policy_cloud') return 'cloud';
  return 'unknown';
}

function modelNameSource(value: string | undefined): TesterRunModelSource {
  const normalized = (value || '').trim().toLowerCase();
  if (/^(local-import|local)\//.test(normalized)) return 'local';
  if (/^cloud\//.test(normalized)) return 'cloud';
  return 'unknown';
}

export function getTesterRunModelLabel(record: TesterRunHistoryRecord): string {
  if (record.runConfig?.target.modelLabel) {
    const modelLabel = cleanTesterRunModelName(record.runConfig.target.modelLabel);
    if (isOpaqueRuntimeModelId(modelLabel)) {
      return genericTesterRunModelLabel(getTesterRunModelSource(record));
    }
    return modelLabel;
  }
  const result = record.result;
  if (result?.ok) {
    const modelResolved = 'modelResolved' in result ? result.modelResolved?.trim() : '';
    if (modelResolved) {
      const modelLabel = cleanTesterRunModelName(modelResolved);
      return isOpaqueRuntimeModelId(modelLabel)
        ? genericTesterRunModelLabel(getTesterRunModelSource(record))
        : modelLabel;
    }
  }
  if (record.status === 'local-fixture') return 'local fixture';
  if (!result) return 'model not captured';
  return getTesterRunStatusLabel(record.status);
}

export function getTesterRunModelSource(record: TesterRunHistoryRecord): TesterRunModelSource {
  const targetSource = record.runConfig?.target.source;
  if (targetSource === 'local' || targetSource === 'local-fixture') return 'local';
  if (targetSource === 'cloud') return 'cloud';
  const result = record.result;
  if (!result?.ok) return record.status === 'local-fixture' ? 'local' : 'unknown';
  const routeDecision = 'routeDecision' in result ? result.routeDecision : undefined;
  const fromRoute = routeDecisionModelSource(routeDecision);
  if (fromRoute !== 'unknown') return fromRoute;
  const modelResolved = 'modelResolved' in result ? result.modelResolved : undefined;
  return modelNameSource(modelResolved);
}

export function getTesterRunMetricSummary(record: TesterRunHistoryRecord): string {
  const result = record.result;
  if (!result) return getTesterRunResultSummary(record);
  if (isTesterUnavailableHistorySnapshot(result)) return result.reason;
  if (result.kind === 'text') {
    return [
      formatTesterTokenUsage(result.inputTokens, result.outputTokens, result.totalTokens),
      `${result.charCount} chars`,
    ].filter(Boolean).join(' / ');
  }
  if (result.kind === 'embedding') {
    return [
      formatTesterTokenUsage(undefined, undefined, result.totalTokens),
      `${result.vectorCount} vector${result.vectorCount === 1 ? '' : 's'}`,
      `${result.dimensions} dims`,
    ].filter(Boolean).join(' / ');
  }
  if (result.kind === 'artifacts') return `${result.jobState || 'unknown'} / ${result.artifactCount} artifact${result.artifactCount === 1 ? '' : 's'}`;
  if (result.kind === 'transcript') return `${result.jobState || 'unknown'} / ${result.charCount} chars / ${result.artifactCount} artifact${result.artifactCount === 1 ? '' : 's'}`;
  return `${result.voiceCount} voice${result.voiceCount === 1 ? '' : 's'}`;
}

export function getTesterRunResultTags(record: TesterRunHistoryRecord): string[] {
  const result = record.result;
  if (!result) return [record.status === 'ready' ? 'Runtime' : getTesterRunStatusLabel(record.status)];
  if (isTesterUnavailableHistorySnapshot(result)) return [result.reason];
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
  return [`${result.voiceCount} voices`, result.modelResolved].filter(Boolean);
}

function parseHistory(raw: string): TesterRunHistory {
  const parsed = JSON.parse(raw || '{}');
  if (!isJsonObject(parsed)) {
    throw new Error('Tester run history payload must be an object.');
  }
  return parsed as TesterRunHistory;
}

export async function loadTesterRunHistory(): Promise<TesterRunHistory> {
  return parseHistory(await invokeTesterCommand<string>('tester_run_history_load', {
    payload: await withTesterDataStorageRoot({}),
  }));
}

export async function saveTesterRunHistory(history: TesterRunHistory): Promise<void> {
  await invokeTesterCommand('tester_run_history_save', {
    payload: await withTesterDataStorageRoot({ recordsJson: JSON.stringify(history) }),
  });
}

export async function appendTesterRunHistory(record: TesterRunHistoryRecord): Promise<TesterRunHistory> {
  const history = await loadTesterRunHistory().catch(() => ({} as TesterRunHistory));
  const existing = history[record.capabilityId] || [];
  const next = {
    ...history,
    [record.capabilityId]: [record, ...existing].slice(0, 40),
  };
  await saveTesterRunHistory(next);
  return next;
}
