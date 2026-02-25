import { localAiRuntime } from '@runtime/local-ai-runtime';
import { emitRuntimeLog } from '../../telemetry/logger';

export type InferenceRouteSource = 'local-runtime' | 'token-api';
export type InferencePersistMode = 'persist' | 'log-only';
export type InferenceAuditModality =
  | 'chat'
  | 'image'
  | 'video'
  | 'tts'
  | 'stt'
  | 'embedding'
  | 'rerank'
  | 'cv'
  | 'diarize'
  | string;

export type InferenceAuditInput = {
  eventType: 'inference_invoked' | 'inference_failed' | 'fallback_to_token_api';
  modId: string;
  source: InferenceRouteSource;
  provider: string;
  modality: InferenceAuditModality;
  adapter: 'openai_compat_adapter' | 'localai_native_adapter' | string;
  model?: string;
  localModelId?: string;
  endpoint?: string | null;
  reasonCode?: string;
  detail?: string;
  policyGate?: string | Record<string, unknown>;
  persistMode?: InferencePersistMode;
  adapterFamily?: string;
  protocol?: string;
  providerNamespace?: string;
  extra?: Record<string, unknown>;
};

function isPersistedModality(modality: InferenceAuditModality): modality is 'chat' | 'image' | 'video' | 'tts' | 'stt' | 'embedding' {
  return (
    modality === 'chat'
    || modality === 'image'
    || modality === 'video'
    || modality === 'tts'
    || modality === 'stt'
    || modality === 'embedding'
  );
}

function isLoopbackHost(host: string): boolean {
  const normalized = String(host || '').trim().toLowerCase();
  if (!normalized) return false;
  if (normalized === 'localhost') return true;
  if (normalized === '127.0.0.1' || normalized === '::1' || normalized === '[::1]') return true;
  return normalized.startsWith('127.');
}

export function inferRouteSourceFromEndpoint(endpoint: string | null | undefined): InferenceRouteSource {
  const normalized = String(endpoint || '').trim();
  if (!normalized) return 'token-api';
  try {
    const parsed = new URL(normalized);
    return isLoopbackHost(parsed.hostname) ? 'local-runtime' : 'token-api';
  } catch {
    const lowered = normalized.toLowerCase();
    if (lowered.includes('localhost') || lowered.includes('127.0.0.1') || lowered.includes('[::1]')) {
      return 'local-runtime';
    }
    return 'token-api';
  }
}

export function parseReasonCode(input: unknown): string {
  const raw = String(input || '').trim();
  if (!raw) return 'LOCAL_AI_PROVIDER_INTERNAL_ERROR';
  const matched = raw.match(/(LOCAL_AI_[A-Z_]+)/);
  if (matched?.[1]) return matched[1];
  const normalized = raw.toLowerCase();
  if (normalized.includes('adapter mismatch')) return 'LOCAL_AI_ADAPTER_MISMATCH';
  if (normalized.includes('timeout') || normalized.includes('timed out')) {
    return 'LOCAL_AI_PROVIDER_TIMEOUT';
  }
  if (
    normalized.includes('unauthorized')
    || normalized.includes('forbidden')
    || normalized.includes('401')
    || normalized.includes('403')
    || normalized.includes('auth')
  ) {
    return 'LOCAL_AI_AUTH_FAILED';
  }
  if (
    normalized.includes('capability')
    || normalized.includes('model required')
    || normalized.includes('model missing')
    || normalized.includes('404')
    || normalized.includes('unsupported')
  ) {
    return 'LOCAL_AI_CAPABILITY_MISSING';
  }
  if (
    normalized.includes('unreachable')
    || normalized.includes('connection refused')
    || normalized.includes('network')
    || normalized.includes('failed to fetch')
    || normalized.includes('econnrefused')
  ) {
    return 'LOCAL_AI_SERVICE_UNREACHABLE';
  }
  return 'LOCAL_AI_PROVIDER_INTERNAL_ERROR';
}

export function emitInferenceAudit(input: InferenceAuditInput): void {
  const level = input.eventType === 'inference_invoked'
    ? 'info'
    : 'warn';
  const model = String(input.model || '').trim() || null;
  const adapter = String(input.adapter || '').trim();
  const localModelId = String(input.localModelId || '').trim() || null;
  const endpoint = String(input.endpoint || '').trim() || null;
  const reasonCode = input.reasonCode ? String(input.reasonCode).trim() : null;
  const detail = input.detail ? String(input.detail).trim() : null;
  const policyGate = input.policyGate ?? null;
  const extra = input.extra || {};
  const persistMode = input.persistMode || 'persist';

  emitRuntimeLog({
    level,
    area: 'local-ai-runtime-audit',
    message: input.eventType,
    details: {
      modId: input.modId,
      source: input.source,
      provider: input.provider,
      modality: input.modality,
      adapter,
      model,
      localModelId,
      endpoint,
      reasonCode,
      detail,
      policyGate,
      persistMode,
      adapterFamily: input.adapterFamily || null,
      protocol: input.protocol || null,
      providerNamespace: input.providerNamespace || null,
      ...extra,
    },
  });

  if (persistMode !== 'persist') {
    return;
  }
  if (!isPersistedModality(input.modality)) {
    emitRuntimeLog({
      level: 'debug',
      area: 'local-ai-runtime-audit',
      message: 'inference_audit_skip_persist_non_standard_modality',
      details: {
        eventType: input.eventType,
        modId: input.modId,
        modality: input.modality,
      },
    });
    return;
  }

  void localAiRuntime.appendInferenceAudit({
    eventType: input.eventType,
    modId: input.modId,
    source: input.source,
    provider: input.provider,
    modality: input.modality,
    adapter,
    model: model || undefined,
    localModelId: localModelId || undefined,
    endpoint: endpoint || undefined,
    reasonCode: reasonCode || undefined,
    detail: detail || undefined,
    policyGate: policyGate && typeof policyGate === 'object'
      ? policyGate as Record<string, unknown>
      : typeof policyGate === 'string'
        ? policyGate
        : undefined,
    extra,
  }).catch((error) => {
    emitRuntimeLog({
      level: 'warn',
      area: 'local-ai-runtime-audit',
      message: 'inference_audit_persist_failed',
      details: {
        eventType: input.eventType,
        modId: input.modId,
        reasonCode: 'LOCAL_AI_AUDIT_WRITE_FAILED',
        detail: error instanceof Error ? error.message : String(error || ''),
      },
    });
  });
}
