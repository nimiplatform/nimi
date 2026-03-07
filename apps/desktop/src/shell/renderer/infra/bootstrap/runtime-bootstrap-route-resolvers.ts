import type {
  LocalRuntimeEngine,
  ResolvedRuntimeRouteBinding,
  RuntimeModality,
} from '@nimiplatform/sdk/mod/types';
import type { RuntimeRouteBinding } from '@nimiplatform/sdk/mod/runtime-route';
import type { SourceIdV11 } from '@renderer/features/runtime-config/state/types';

type RuntimeFields = {
  provider: string;
  runtimeModelType: string;
  localProviderEndpoint: string;
  localProviderModel: string;
  localOpenAiEndpoint: string;
  connectorId: string;
};

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
export function createResolveRuntimeBinding(getRuntimeFields: () => RuntimeFields) {
  return async ({ modId: _modId, binding }: {
    modId?: string;
    binding?: RuntimeRouteBinding;
  }): Promise<ResolvedRuntimeRouteBinding> => {
    const fields = getRuntimeFields();
    const source = binding?.source === 'token-api' || binding?.source === 'local-runtime'
      ? binding.source
      : inferSource(fields.provider);
    const model = binding?.model || fields.localProviderModel || '';
    const connectorId = binding?.connectorId || fields.connectorId || '';
    const provider = String(binding?.provider || fields.provider || '').trim();

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
      provider,
      model,
      endpoint: '',
      localOpenAiEndpoint: '',
      connectorId,
    };
  };
}
