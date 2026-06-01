import { localRuntime } from '@runtime/local-runtime';
import {
  isLocalRuntimeRunnableAssetKindId,
  type LocalRuntimeRunnableAssetKindId,
} from '@nimiplatform/sdk/runtime';
import type { LocalProviderAdapter } from '@nimiplatform/sdk/runtime';
import { emitRuntimeLog } from '@nimiplatform/kit/telemetry';
import { ReasonCode } from '@nimiplatform/sdk/types';

export type InferenceRouteSource = 'local' | 'cloud';
type InferencePersistMode = 'persist' | 'log-only';
type InferenceAuditModality =
  | LocalRuntimeRunnableAssetKindId
  | 'rerank'
  | 'cv'
  | 'diarize'
  | string;

type InferenceAuditInput = {
  eventType: 'inference_invoked' | 'inference_failed' | 'fallback_to_cloud';
  targetId: string;
  source: InferenceRouteSource;
  routeSource?: InferenceRouteSource;
  provider: string;
  modality: InferenceAuditModality;
  adapter: LocalProviderAdapter;
  traceId: string;
  model?: string;
  localModelId?: string;
  endpoint?: string | null;
  reasonCode: string;
  detail?: string;
  policyGate?: string | Record<string, unknown>;
  persistMode?: InferencePersistMode;
  extra?: Record<string, unknown>;
};

function isPersistedModality(modality: InferenceAuditModality): modality is LocalRuntimeRunnableAssetKindId {
  return isLocalRuntimeRunnableAssetKindId(modality);
}

export function emitInferenceAudit(input: InferenceAuditInput): void {
  const level = input.eventType === 'inference_invoked'
    ? 'info'
    : 'warn';
  const model = String(input.model || '').trim() || null;
  const adapter = String(input.adapter || '').trim();
  const traceId = String(input.traceId || '').trim() || null;
  const localModelId = String(input.localModelId || '').trim() || null;
  const endpoint = String(input.endpoint || '').trim() || null;
  const reasonCode = input.reasonCode ? String(input.reasonCode).trim() : null;
  const detail = input.detail ? String(input.detail).trim() : null;
  const policyGate = input.policyGate ?? null;
  const extra = input.extra || {};
  const persistMode = input.persistMode || 'persist';

  if (!traceId) {
    throw new Error('LOCAL_AI_AUDIT_TRACE_ID_MISSING: traceId is required');
  }
  if (!reasonCode) {
    throw new Error('LOCAL_AI_AUDIT_REASON_CODE_MISSING: reasonCode is required');
  }

  emitRuntimeLog({
    level,
    area: 'local-ai-runtime-audit',
    message: input.eventType,
    details: {
      targetId: input.targetId,
      source: input.source,
      routeSource: input.routeSource || input.source,
      provider: input.provider,
      modality: input.modality,
      adapter,
      traceId,
      model,
      localModelId,
      endpoint,
      reasonCode,
      detail,
      policyGate,
      persistMode,
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
        targetId: input.targetId,
        modality: input.modality,
      },
    });
    return;
  }

  void localRuntime.appendInferenceAudit({
    eventType: input.eventType,
    targetId: input.targetId,
    source: input.source,
    routeSource: input.routeSource || input.source,
    provider: input.provider,
    modality: input.modality,
    adapter,
    traceId: traceId || undefined,
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
        targetId: input.targetId,
        reasonCode: ReasonCode.LOCAL_AI_AUDIT_WRITE_FAILED,
        detail: error instanceof Error ? error.message : String(error || ''),
      },
    });
  });
}
