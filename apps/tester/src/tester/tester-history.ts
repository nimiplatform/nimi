import { invokeTesterCommand } from './tester-tauri.js';
import { getTesterCapability, type TesterCapabilityId } from './tester-capabilities.js';
import { withTesterDataStorageRoot } from './tester-app-storage.js';
import { isJsonObject } from '@nimiplatform/sdk/types';
import type { TesterCapabilityRunResult } from './tester-runtime.js';

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
    };

export type TesterRunHistoryRecord = {
  id: string;
  capabilityId: string;
  prompt: string;
  status: 'unavailable' | 'ready' | 'failed' | 'local-fixture';
  message: string;
  createdAt: string;
  result?: TesterRunHistoryResultSnapshot;
};

export type TesterRunHistory = Record<string, TesterRunHistoryRecord[]>;

export type TesterFlatRunRecord = TesterRunHistoryRecord & {
  capabilityLabel: string;
};

export type TesterRunStatusTone = 'success' | 'warning' | 'danger' | 'info';
export type TesterRunModelSource = 'local' | 'cloud' | 'unknown';

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

function compactBodySummary(value: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized) return '(empty result)';
  return normalized.length > 180 ? `${normalized.slice(0, 177)}...` : normalized;
}

function traceFields(result: TesterCapabilityRunResult): Pick<Extract<TesterRunHistoryResultSnapshot, { ok: true }>, 'traceId' | 'modelResolved' | 'routeDecision'> {
  if (!result.ok) return {};
  return {
    traceId: result.trace?.traceId,
    modelResolved: result.trace?.modelResolved,
    routeDecision: result.trace?.routeDecision,
  };
}

function hostedArtifactUrl(url: string | undefined): string | undefined {
  if (!url || url.startsWith('data:')) return undefined;
  return url;
}

export function createTesterRunHistoryResultSnapshot(result: TesterCapabilityRunResult): TesterRunHistoryResultSnapshot {
  if (!result.ok) {
    return {
      ok: false,
      kind: 'unavailable',
      summary: result.message,
      reason: result.reason,
      message: result.message,
      actionHint: result.actionHint,
      missingSurface: result.missingSurface,
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
  if (inputTokens !== undefined && outputTokens !== undefined) {
    return `${inputTokens} in / ${outputTokens} out / ${totalTokens ?? inputTokens + outputTokens} total`;
  }
  if (totalTokens !== undefined) return `${totalTokens} tokens`;
  return '';
}

function cleanTesterRunModelName(value: string): string {
  const normalized = value.trim();
  return normalized.replace(/^(local-import|local|cloud)\//i, '').trim() || normalized;
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
  const result = record.result;
  if (result?.ok) {
    const modelResolved = 'modelResolved' in result ? result.modelResolved?.trim() : '';
    if (modelResolved) return cleanTesterRunModelName(modelResolved);
  }
  if (record.status === 'local-fixture') return 'local fixture';
  if (!result) return 'model not captured';
  return getTesterRunStatusLabel(record.status);
}

export function getTesterRunModelSource(record: TesterRunHistoryRecord): TesterRunModelSource {
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
  if (!result.ok) return result.reason;
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
  if (!result.ok) return [result.reason];
  if (result.kind === 'text') {
    return [
      result.streamed ? 'Stream' : 'Runtime',
      `${result.charCount} chars`,
      result.totalTokens === undefined ? '' : `${result.totalTokens} tokens`,
    ].filter(Boolean);
  }
  if (result.kind === 'embedding') return [`${result.dimensions} dims`, `${result.vectorCount} vector${result.vectorCount === 1 ? '' : 's'}`];
  if (result.kind === 'artifacts') return [result.jobState || 'unknown', `${result.artifactCount} artifact${result.artifactCount === 1 ? '' : 's'}`];
  if (result.kind === 'transcript') return [result.jobState || 'unknown', `${result.charCount} chars`];
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
