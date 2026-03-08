import { ReasonCode, type NimiError } from '../types/index.js';
import { createNimiError } from './errors.js';
import {
  FallbackPolicy,
  FinishReason,
  ScenarioJobEventType,
  ScenarioJobStatus,
  RoutePolicy,
  type ScenarioJobEvent,
} from './generated/runtime/v1/ai';
import {
  WorkflowEventType,
  type WorkflowEvent,
} from './generated/runtime/v1/workflow';
import { RuntimeHealthStatus } from './generated/runtime/v1/audit';
import { Struct } from './generated/google/protobuf/struct.js';
import { RuntimeMethodIds, isRuntimeStreamMethod } from './method-ids.js';
import type {
  NimiFallbackPolicy,
  NimiFinishReason,
  NimiRoutePolicy,
  NimiTokenUsage,
  NimiTraceInfo,
  RuntimeHealth,
  TextMessage,
} from './types.js';

export type RuntimeMethodLookupEntry = {
  moduleKey: keyof typeof RuntimeMethodIds;
  methodKey: string;
  stream: boolean;
};

export const DEFAULT_WAIT_FOR_READY_TIMEOUT_MS = 10000;
export const DEFAULT_MEDIA_POLL_INTERVAL_MS = 250;
export const DEFAULT_MEDIA_TIMEOUT_MS = 120000;
export const DEFAULT_RETRY_MAX_ATTEMPTS = 3;
export const DEFAULT_RETRY_BACKOFF_MS = 200;
export const MAX_RETRY_BACKOFF_MS = 3000;

export const SDK_RUNTIME_MAJOR_VERSION = 0;

export const PHASE2_MODULE_KEYS: ReadonlySet<string> = new Set([
  'workflow',
  'model',
  'knowledge',
  'app',
]);

export const PHASE2_AUDIT_METHOD_IDS: ReadonlySet<string> = new Set([
  RuntimeMethodIds.audit.listAuditEvents,
  RuntimeMethodIds.audit.exportAuditEvents,
  RuntimeMethodIds.audit.listUsageStats,
]);

export function parseSemverMajor(version: string): number | null {
  const match = /^v?(\d+)/.exec(version);
  return match ? Number(match[1]) : null;
}

export const RETRYABLE_RUNTIME_REASON_CODES: ReadonlySet<string> = new Set([
  ReasonCode.RUNTIME_UNAVAILABLE,
  ReasonCode.RUNTIME_BRIDGE_DAEMON_UNAVAILABLE,
  ReasonCode.SDK_RUNTIME_NODE_GRPC_UNARY_FAILED,
  ReasonCode.SDK_RUNTIME_NODE_GRPC_STREAM_OPEN_FAILED,
  ReasonCode.SDK_RUNTIME_TAURI_UNARY_FAILED,
  ReasonCode.SDK_RUNTIME_TAURI_STREAM_OPEN_FAILED,
  ReasonCode.SDK_RUNTIME_TAURI_STREAM_FAILED,
  ReasonCode.SDK_RUNTIME_TAURI_INVOKE_MISSING,
  ReasonCode.SDK_RUNTIME_TAURI_LISTEN_MISSING,
]);

export const RUNTIME_METHOD_LOOKUP: Readonly<Record<string, RuntimeMethodLookupEntry>> = buildRuntimeMethodLookup();

function buildRuntimeMethodLookup(): Readonly<Record<string, RuntimeMethodLookupEntry>> {
  const lookup: Record<string, RuntimeMethodLookupEntry> = {};
  const groups = Object.entries(RuntimeMethodIds) as Array<
    [keyof typeof RuntimeMethodIds, Record<string, string>]
  >;

  for (const [moduleKey, methods] of groups) {
    for (const [methodKey, methodId] of Object.entries(methods)) {
      lookup[methodId] = {
        moduleKey,
        methodKey,
        stream: isRuntimeStreamMethod(methodId),
      };
    }
  }

  return Object.freeze(lookup);
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function normalizeText(value: unknown): string {
  return String(value || '').trim();
}

export function ensureText(value: unknown, fieldName: string): string {
  const normalized = normalizeText(value);
  if (!normalized) {
    throw createNimiError({
      message: `${fieldName} is required`,
      reasonCode: ReasonCode.ACTION_INPUT_INVALID,
      actionHint: `set_${fieldName}`,
      source: 'sdk',
    });
  }
  return normalized;
}

export function toRoutePolicy(value: NimiRoutePolicy | undefined): RoutePolicy {
  return value === 'cloud' ? RoutePolicy.CLOUD : RoutePolicy.LOCAL;
}

export function fromRoutePolicy(value: RoutePolicy): NimiRoutePolicy {
  return value === RoutePolicy.CLOUD ? 'cloud' : 'local';
}

export function toFallbackPolicy(value: NimiFallbackPolicy | undefined): FallbackPolicy {
  return value === 'allow' ? FallbackPolicy.ALLOW : FallbackPolicy.DENY;
}

export function toFinishReason(value: FinishReason): NimiFinishReason {
  switch (value) {
    case FinishReason.LENGTH:
      return 'length';
    case FinishReason.CONTENT_FILTER:
      return 'content-filter';
    case FinishReason.TOOL_CALL:
      return 'tool-calls';
    case FinishReason.ERROR:
      return 'error';
    case FinishReason.STOP:
    default:
      return 'stop';
  }
}

export function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

export function parseCount(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return value;
  }
  const parsed = Number(value);
  if (Number.isFinite(parsed) && parsed >= 0) {
    return parsed;
  }
  return undefined;
}

export function toUsage(value: unknown): NimiTokenUsage {
  const usage = asRecord(value);
  const inputTokens = parseCount(usage.inputTokens);
  const outputTokens = parseCount(usage.outputTokens);
  const totalTokens = typeof inputTokens === 'number' && typeof outputTokens === 'number'
    ? inputTokens + outputTokens
    : undefined;

  return {
    inputTokens,
    outputTokens,
    totalTokens,
  };
}

export function toTraceInfo(input: {
  traceId?: unknown;
  modelResolved?: unknown;
  routeDecision?: unknown;
}): NimiTraceInfo {
  return {
    traceId: normalizeText(input.traceId) || undefined,
    modelResolved: normalizeText(input.modelResolved) || undefined,
    routeDecision: Number(input.routeDecision) === RoutePolicy.CLOUD ? 'cloud' : 'local',
  };
}

export function extractGenerateText(output: unknown): string {
  const fields = asRecord(asRecord(output).fields);
  const text = asRecord(fields.text);
  const kind = asRecord(text.kind);

  if (kind.oneofKind === 'stringValue') {
    return normalizeText(kind.stringValue);
  }
  if (typeof text.stringValue === 'string') {
    return normalizeText(text.stringValue);
  }
  return '';
}

export function toRuntimeMessages(input: string | TextMessage[], system?: string): {
  systemPrompt: string;
  input: Array<{ role: string; content: string; name: string }>;
} {
  if (typeof input === 'string') {
    const content = normalizeText(input);
    if (!content) {
      throw createNimiError({
        message: 'text input is required',
        reasonCode: ReasonCode.AI_INPUT_INVALID,
        actionHint: 'set_text_input',
        source: 'sdk',
      });
    }
    return {
      systemPrompt: normalizeText(system),
      input: [{ role: 'user', content, name: '' }],
    };
  }

  const systemParts: string[] = [];
  const messages: Array<{ role: string; content: string; name: string }> = [];

  if (Array.isArray(input)) {
    for (const message of input) {
      const content = normalizeText(message.content);
      if (!content) {
        continue;
      }
      if (message.role === 'system') {
        systemParts.push(content);
        continue;
      }
      messages.push({
        role: message.role,
        content,
        name: normalizeText(message.name),
      });
    }
  }

  const explicitSystem = normalizeText(system);
  if (explicitSystem) {
    systemParts.push(explicitSystem);
  }

  if (messages.length === 0) {
    throw createNimiError({
      message: 'text input must include at least one non-system message',
      reasonCode: ReasonCode.AI_INPUT_INVALID,
      actionHint: 'add_user_or_assistant_message',
      source: 'sdk',
    });
  }

  return {
    systemPrompt: systemParts.join('\n\n'),
    input: messages,
  };
}

export function toEmbeddingVectors(vectors: unknown): number[][] {
  const items = Array.isArray(vectors) ? vectors : [];
  return items.map((entry) => {
    const values = Array.isArray(asRecord(entry).values)
      ? asRecord(entry).values as unknown[]
      : [];
    return values
      .map((value) => {
        const kind = asRecord(asRecord(value).kind);
        if (kind.oneofKind === 'numberValue') {
          const parsed = Number(kind.numberValue);
          return Number.isFinite(parsed) ? parsed : null;
        }
        return null;
      })
      .filter((value): value is number => value !== null);
  });
}

export function toProtoStruct(input: Record<string, unknown> | undefined): Struct | undefined {
  if (!input || Object.keys(input).length === 0) {
    return undefined;
  }
  try {
    return Struct.fromJson(input as never);
  } catch {
    return undefined;
  }
}

export function toLabels(input: unknown): Record<string, string> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return {};
  }

  const labels: Record<string, string> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    const normalizedKey = normalizeText(key);
    const normalizedValue = normalizeText(value);
    if (!normalizedKey || !normalizedValue) {
      continue;
    }
    labels[normalizedKey] = normalizedValue;
  }
  return labels;
}

export const MEDIA_JOB_TERMINAL_EVENT_TYPES: ReadonlySet<ScenarioJobEventType> = new Set([
  ScenarioJobEventType.SCENARIO_JOB_EVENT_COMPLETED,
  ScenarioJobEventType.SCENARIO_JOB_EVENT_FAILED,
  ScenarioJobEventType.SCENARIO_JOB_EVENT_CANCELED,
  ScenarioJobEventType.SCENARIO_JOB_EVENT_TIMEOUT,
]);

export const WORKFLOW_TERMINAL_EVENT_TYPES: ReadonlySet<WorkflowEventType> = new Set([
  WorkflowEventType.WORKFLOW_EVENT_COMPLETED,
  WorkflowEventType.WORKFLOW_EVENT_FAILED,
  WorkflowEventType.WORKFLOW_EVENT_CANCELED,
]);

export function wrapModeBMediaStream(source: AsyncIterable<ScenarioJobEvent>): AsyncIterable<ScenarioJobEvent> {
  return {
    async *[Symbol.asyncIterator]() {
      for await (const event of source) {
        yield event;
        if (MEDIA_JOB_TERMINAL_EVENT_TYPES.has(event.eventType)) {
          return;
        }
      }
    },
  };
}

export function wrapModeBWorkflowStream(source: AsyncIterable<WorkflowEvent>): AsyncIterable<WorkflowEvent> {
  return {
    async *[Symbol.asyncIterator]() {
      for await (const event of source) {
        yield event;
        if (WORKFLOW_TERMINAL_EVENT_TYPES.has(event.eventType)) {
          return;
        }
      }
    },
  };
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function toIsoFromTimestamp(value: unknown): string | undefined {
  const record = asRecord(value);
  if (Object.keys(record).length === 0) {
    return undefined;
  }

  const secondsRaw = record.seconds;
  const nanosRaw = record.nanos;
  const seconds = Number(secondsRaw);
  const nanos = Number(nanosRaw);
  if (!Number.isFinite(seconds)) {
    return undefined;
  }

  const millis = (seconds * 1000) + (Number.isFinite(nanos) ? Math.floor(nanos / 1_000_000) : 0);
  const date = new Date(millis);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

export function mediaStatusToString(status: ScenarioJobStatus): string {
  switch (status) {
    case ScenarioJobStatus.SUBMITTED:
      return 'SUBMITTED';
    case ScenarioJobStatus.QUEUED:
      return 'QUEUED';
    case ScenarioJobStatus.RUNNING:
      return 'RUNNING';
    case ScenarioJobStatus.COMPLETED:
      return 'COMPLETED';
    case ScenarioJobStatus.FAILED:
      return 'FAILED';
    case ScenarioJobStatus.CANCELED:
      return 'CANCELED';
    case ScenarioJobStatus.TIMEOUT:
      return 'TIMEOUT';
    default:
      return 'UNSPECIFIED';
  }
}

export function resolveHealthStatus(status: RuntimeHealthStatus): RuntimeHealth['status'] {
  if (status === RuntimeHealthStatus.READY) {
    return 'healthy';
  }
  if (status === RuntimeHealthStatus.DEGRADED) {
    return 'degraded';
  }
  return 'unavailable';
}

export function decodeUtf8(input: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(input).toString('utf8');
  }
  if (typeof TextDecoder !== 'undefined') {
    return new TextDecoder('utf-8').decode(input);
  }
  let output = '';
  for (let index = 0; index < input.length; index += 1) {
    output += String.fromCharCode(input[index] || 0);
  }
  return output;
}
