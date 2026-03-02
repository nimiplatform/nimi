import type {
  LocalRuntimeEngine,
  ResolvedRuntimeRouteBinding,
  RuntimeModality,
  RuntimeRouteHint,
  RuntimeRouteOverride,
} from '@nimiplatform/sdk/mod/types';
import {
  normalizeCapabilityV11,
  type SourceIdV11,
} from '@renderer/features/runtime-config/state/v11/types';

type RuntimeFields = {
  provider: string;
  runtimeModelType: string;
  localProviderEndpoint: string;
  localProviderModel: string;
  localOpenAiEndpoint: string;
  connectorId: string;
};

function hintToCapability(hint: string): string {
  const normalized = String(hint || 'chat/default').trim().toLowerCase();
  if (normalized.startsWith('image/')) return 'image';
  if (normalized.startsWith('video/')) return 'video';
  if (normalized.startsWith('tts/')) return 'tts';
  if (normalized.startsWith('stt/')) return 'stt';
  if (normalized.startsWith('embedding/')) return 'embedding';
  return 'chat';
}

function inferSource(provider: string): SourceIdV11 {
  const lower = String(provider || '').trim().toLowerCase();
  if (lower.startsWith('local-runtime') || lower === 'localai' || lower === 'nexa') {
    return 'local-runtime';
  }
  return 'token-api';
}

/**
 * Thin passthrough: reads `{ model, connectorId, source }` from runtime fields
 * and returns a binding without any local routing logic. The Go runtime handles
 * all model resolution, capability detection, and provider routing.
 */
export function createResolveRouteBinding(getRuntimeFields: () => RuntimeFields) {
  return async ({ routeHint, modId, routeOverride }: {
    routeHint: RuntimeRouteHint;
    modId?: string;
    routeOverride?: RuntimeRouteOverride;
  }): Promise<ResolvedRuntimeRouteBinding> => {
    const capability = normalizeCapabilityV11(hintToCapability(String(routeHint || '')));
    const fields = getRuntimeFields();
    const source = routeOverride?.source === 'token-api' || routeOverride?.source === 'local-runtime'
      ? routeOverride.source
      : inferSource(fields.provider);
    const model = routeOverride?.model || fields.localProviderModel || '';
    const connectorId = routeOverride?.connectorId || fields.connectorId || '';

    if (source === 'local-runtime') {
      return {
        source: 'local-runtime',
        runtimeModelType: fields.runtimeModelType as RuntimeModality,
        provider: fields.provider,
        adapter: 'openai_compat_adapter',
        localModelId: model,
        engine: (fields.provider || 'localai') as LocalRuntimeEngine,
        model,
        endpoint: fields.localProviderEndpoint || fields.localOpenAiEndpoint,
        localProviderEndpoint: fields.localProviderEndpoint,
        localProviderModel: model,
        localOpenAiEndpoint: fields.localOpenAiEndpoint,
        connectorId: '' as const,
      };
    }

    return {
      source: 'token-api',
      runtimeModelType: fields.runtimeModelType as RuntimeModality,
      provider: fields.provider,
      adapter: 'openai_compat_adapter',
      model,
      endpoint: '',
      localOpenAiEndpoint: '',
      connectorId,
    };
  };
}

/**
 * Thin passthrough for speech route resolution. No local route decision logic —
 * the Go runtime resolves model capabilities and provider routing via connectorId.
 */
export function createSpeechRouteResolver(getRuntimeFields: () => RuntimeFields) {
  return async ({
    modId,
    providerId,
    routeSource,
    connectorId,
    model: explicitModel,
  }: {
    modId?: string;
    providerId?: string;
    routeSource?: 'auto' | 'local-runtime' | 'token-api';
    connectorId?: string;
    model?: string;
  }) => {
    const fields = getRuntimeFields();
    const source = routeSource === 'local-runtime' || routeSource === 'token-api'
      ? routeSource
      : inferSource(providerId || fields.provider);
    const model = String(explicitModel || fields.localProviderModel || '').trim();
    const resolvedConnectorId = String(connectorId || fields.connectorId || '').trim();

    if (source === 'local-runtime') {
      return {
        source,
        provider: fields.provider,
        adapter: 'openai_compat_adapter',
        localProviderEndpoint: fields.localProviderEndpoint,
        localOpenAiEndpoint: fields.localOpenAiEndpoint,
        connectorId: resolvedConnectorId,
        model,
        engine: (providerId || 'localai') as string,
      };
    }

    return {
      source,
      provider: fields.provider,
      adapter: 'openai_compat_adapter',
      localProviderEndpoint: '',
      localOpenAiEndpoint: '',
      connectorId: resolvedConnectorId,
      model,
      engine: undefined,
    };
  };
}
