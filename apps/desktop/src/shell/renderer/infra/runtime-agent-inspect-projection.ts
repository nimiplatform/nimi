import { asNimiError } from '@nimiplatform/sdk/runtime';
import type { AvatarPresentationProfile } from '@nimiplatform/nimi-kit/features/avatar/headless';
import { ReasonCode } from '@nimiplatform/sdk/types';
import { summarizeCanonicalMemoryView } from './runtime-agent-memory';

export type RuntimeAgentPendingHookInspect = {
  hookId: string;
  status: string | null;
  triggerKind: string | null;
  scheduledFor: string | null;
  admittedAt?: string | null;
};

export type RuntimeAgentInspectEventSummary = {
  agentId: string;
  eventType: number;
  eventTypeLabel: string | null;
  sequence: string;
  detailKind: string | null;
  timestamp: string | null;
  summaryText: string | null;
  hookId: string | null;
  hookStatus: string | null;
  lifecycleStatus: string | null;
  budgetExhausted: boolean | null;
  remainingTokens: number | null;
};

export type RuntimeAgentCanonicalMemoryInspect = {
  memoryId: string;
  canonicalClass: string | null;
  kind: string | null;
  summary: string;
  updatedAt: string | null;
  sourceEventId: string | null;
  policyReason: string | null;
  recallScore: number | null;
};

export type RuntimeAgentAutonomyMode = 'off' | 'low' | 'medium' | 'high';

type ProtoStructLike = {
  fields?: Record<string, ProtoValueLike>;
};

type ProtoValueLike = {
  kind?: {
    oneofKind?: 'nullValue' | 'numberValue' | 'stringValue' | 'boolValue' | 'structValue' | 'listValue';
    nullValue?: number;
    numberValue?: number;
    stringValue?: string;
    boolValue?: boolean;
    structValue?: ProtoStructLike;
    listValue?: {
      values?: ProtoValueLike[];
    };
  };
};

export function normalizeNonNegativeInteger(value: unknown): string {
  const normalized = Number(value);
  if (!Number.isFinite(normalized) || normalized < 0) {
    return '0';
  }
  return String(Math.trunc(normalized));
}

export function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function normalizeRuntimeError(error: unknown, actionHint: string) {
  return asNimiError(error, {
    reasonCode: ReasonCode.RUNTIME_CALL_FAILED,
    actionHint,
    source: 'runtime',
  });
}

export function timestampToIso(timestamp?: { seconds: string; nanos: number }): string | null {
  if (!timestamp) {
    return null;
  }
  const seconds = Number(timestamp.seconds);
  const nanos = Number(timestamp.nanos);
  if (!Number.isFinite(seconds)) {
    return null;
  }
  const millis = seconds * 1000 + (Number.isFinite(nanos) ? Math.floor(nanos / 1_000_000) : 0);
  return Number.isFinite(millis) ? new Date(millis).toISOString() : null;
}

export function normalizeOptionalNumber(value: unknown): number | null {
  const normalized = Number(value);
  return Number.isFinite(normalized) ? normalized : null;
}

function protoValueToJson(value?: ProtoValueLike): unknown {
  switch (value?.kind?.oneofKind) {
    case 'boolValue':
      return value.kind.boolValue ?? false;
    case 'numberValue':
      return value.kind.numberValue ?? 0;
    case 'stringValue':
      return value.kind.stringValue ?? '';
    case 'structValue':
      return protoStructToJson(value.kind.structValue);
    case 'listValue':
      return (value.kind.listValue?.values || []).map((item) => protoValueToJson(item));
    default:
      return null;
  }
}

function protoStructToJson(value?: ProtoStructLike): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value?.fields || {})) {
    output[key] = protoValueToJson(item);
  }
  return output;
}

function parseAvatarBackendKind(value: unknown): AvatarPresentationProfile['backendKind'] | null {
  const normalized = normalizeText(value);
  if (
    normalized === 'vrm'
    || normalized === 'live2d'
    || normalized === 'sprite2d'
    || normalized === 'canvas2d'
    || normalized === 'video'
  ) {
    return normalized;
  }
  return null;
}

function parseAvatarPresentationProfile(value: unknown): AvatarPresentationProfile | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const backendKind = parseAvatarBackendKind(record.backendKind);
  const avatarAssetRef = normalizeText(record.avatarAssetRef);
  if (!backendKind || !avatarAssetRef) {
    return null;
  }
  return {
    backendKind,
    avatarAssetRef,
    expressionProfileRef: normalizeText(record.expressionProfileRef) || null,
    idlePreset: normalizeText(record.idlePreset) || null,
    interactionPolicyRef: normalizeText(record.interactionPolicyRef) || null,
    defaultVoiceReference: normalizeText(record.defaultVoiceReference) || null,
  };
}

export function readAgentPresentationProfile(metadata?: ProtoStructLike): AvatarPresentationProfile | null {
  const json = protoStructToJson(metadata);
  return parseAvatarPresentationProfile(json.presentationProfile);
}

export function formatLifecycleStatus(value: unknown): string | null {
  switch (Number(value)) {
    case 1:
      return 'initializing';
    case 2:
      return 'active';
    case 3:
      return 'suspended';
    case 4:
      return 'terminating';
    case 5:
      return 'terminated';
    default:
      return null;
  }
}

export function formatExecutionState(value: unknown): string | null {
  switch (Number(value)) {
    case 1:
      return 'idle';
    case 2:
      return 'chat-active';
    case 3:
      return 'life-pending';
    case 4:
      return 'life-running';
    case 5:
      return 'suspended';
    default:
      return null;
  }
}

export function formatAutonomyMode(value: unknown): RuntimeAgentAutonomyMode | null {
  switch (Number(value)) {
    case 1:
      return 'off';
    case 2:
      return 'low';
    case 3:
      return 'medium';
    case 4:
      return 'high';
    default:
      return null;
  }
}

export function formatHookStatus(value: unknown): string | null {
  switch (Number(value)) {
    case 1:
      return 'proposed';
    case 2:
      return 'pending';
    case 3:
      return 'rejected';
    case 4:
      return 'running';
    case 5:
      return 'completed';
    case 6:
      return 'failed';
    case 7:
      return 'canceled';
    case 8:
      return 'rescheduled';
    default:
      return null;
  }
}

function formatHookTriggerKind(input?: {
  triggerFamily?: unknown;
  triggerDetail?: {
    detail?: {
      oneofKind?: string;
    };
  } | null;
} | null): string | null {
  switch (Number(input?.triggerFamily)) {
    case 1:
      return 'scheduled-time';
    case 2:
      switch (input?.triggerDetail?.detail?.oneofKind) {
        case 'eventUserIdle':
          return 'user-idle';
        case 'eventChatEnded':
          return 'chat-ended';
        default:
          return null;
      }
    default:
      return null;
  }
}

export function formatEventType(value: unknown): string | null {
  switch (Number(value)) {
    case 1:
      return 'lifecycle';
    case 2:
      return 'hook';
    case 3:
      return 'memory';
    case 4:
      return 'budget';
    case 5:
      return 'replication';
    default:
      return null;
  }
}

function formatCanonicalClass(value: unknown): string | null {
  switch (Number(value)) {
    case 2:
      return 'public-shared';
    case 3:
      return 'world-shared';
    case 4:
      return 'dyadic';
    default:
      return null;
  }
}

function formatMemoryRecordKind(value: unknown): string | null {
  switch (Number(value)) {
    case 1:
      return 'episodic';
    case 2:
      return 'semantic';
    case 3:
      return 'observational';
    default:
      return null;
  }
}

export function formatMemoryReplicationOutcome(value: unknown): string | null {
  switch (Number(value)) {
    case 1:
      return 'pending';
    case 2:
      return 'synced';
    case 3:
      return 'conflict';
    case 4:
      return 'invalidated';
    default:
      return null;
  }
}

export function projectPendingHookInspect(hook: {
  intent?: {
    intentId?: unknown;
    admissionState?: unknown;
    triggerFamily?: unknown;
    triggerDetail?: {
      detail?: {
        oneofKind?: string;
      };
    } | null;
  } | null;
  scheduledFor?: { seconds: string; nanos: number } | undefined;
  admittedAt?: { seconds: string; nanos: number } | undefined;
}): RuntimeAgentPendingHookInspect {
  return {
    hookId: normalizeText(hook.intent?.intentId),
    status: formatHookStatus(hook.intent?.admissionState),
    triggerKind: formatHookTriggerKind(hook.intent),
    scheduledFor: timestampToIso(hook.scheduledFor),
    admittedAt: timestampToIso(hook.admittedAt),
  };
}

export function projectCanonicalMemoryInspect(view: {
  canonicalClass?: unknown;
  record?: {
    memoryId?: unknown;
    kind?: unknown;
    updatedAt?: { seconds: string; nanos: number } | undefined;
    createdAt?: { seconds: string; nanos: number } | undefined;
    provenance?: { sourceEventId?: unknown } | null;
    payload?: unknown;
  } | null;
  policyReason?: unknown;
  recallScore?: unknown;
}): RuntimeAgentCanonicalMemoryInspect | null {
  const memoryId = normalizeText(view.record?.memoryId);
  const summary = summarizeCanonicalMemoryView(view as never).trim();
  if (!memoryId || !summary) {
    return null;
  }
  return {
    memoryId,
    canonicalClass: formatCanonicalClass(view.canonicalClass),
    kind: formatMemoryRecordKind(view.record?.kind),
    summary,
    updatedAt: timestampToIso(view.record?.updatedAt || view.record?.createdAt),
    sourceEventId: normalizeText(view.record?.provenance?.sourceEventId) || null,
    policyReason: normalizeText(view.policyReason) || null,
    recallScore: normalizeOptionalNumber(view.recallScore),
  };
}
