import type {
  LocalRuntimeEngine,
  ResolvedRuntimeRouteBinding,
  RuntimeModality,
} from '@nimiplatform/sdk/mod/types';
import type { RuntimeRouteBinding } from '@nimiplatform/sdk/mod/runtime-route';
import type { SourceIdV11 } from '@renderer/features/runtime-config/runtime-config-state-types';

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

function normalizeLocalEngine(value: unknown): string {
  return String(value || '').trim().toLowerCase() === 'nexa' ? 'nexa' : 'localai';
}

function normalizeLocalRuntimeModelRoot(value: unknown): string {
  const trimmed = String(value || '').trim();
  if (!trimmed) return '';
  const lower = trimmed.toLowerCase();
  if (lower.startsWith('localai/')) return trimmed.slice('localai/'.length).trim();
  if (lower.startsWith('nexa/')) return trimmed.slice('nexa/'.length).trim();
  if (lower.startsWith('local/')) return trimmed.slice('local/'.length).trim();
  return trimmed;
}

function buildLocalRuntimeSelector(modelId: string, engine: string): string {
  const normalizedModelId = normalizeLocalRuntimeModelRoot(modelId);
  const normalizedEngine = normalizeLocalEngine(engine);
  return normalizedModelId ? `${normalizedEngine}/${normalizedModelId}` : normalizedEngine;
}

export function createResolveRuntimeBinding(getRuntimeFields: () => RuntimeFields) {
  return async ({ modId: _modId, binding }: {
    modId?: string;
    binding?: RuntimeRouteBinding;
  }): Promise<ResolvedRuntimeRouteBinding> => {
    const fields = getRuntimeFields();
    const source = binding?.source === 'token-api' || binding?.source === 'local-runtime'
      ? binding.source
      : inferSource(fields.provider);
    const boundModel = String(binding?.model || '').trim();
    const boundModelId = String(binding?.modelId || '').trim();
    const modelId = normalizeLocalRuntimeModelRoot(boundModelId || boundModel || fields.localProviderModel || '');
    const model = binding?.source === 'local-runtime'
      ? modelId
      : (boundModel || fields.localProviderModel || '');
    const connectorId = binding?.connectorId || fields.connectorId || '';
    const provider = String(binding?.provider || fields.provider || '').trim();

    if (source === 'local-runtime') {
      const engine = normalizeLocalEngine(binding?.engine || binding?.provider || fields.provider);
      const selector = buildLocalRuntimeSelector(modelId, engine);
      const endpoint = String(binding?.endpoint || fields.localProviderEndpoint || fields.localOpenAiEndpoint || '').trim();
      return {
        source: 'local-runtime',
        runtimeModelType: fields.runtimeModelType as RuntimeModality,
        provider: provider || engine,
        adapter: binding?.adapter,
        providerHints: binding?.providerHints,
        modelId,
        localModelId: String(binding?.localModelId || '').trim(),
        engine: engine as LocalRuntimeEngine,
        model: selector,
        endpoint,
        localProviderEndpoint: endpoint,
        localProviderModel: modelId,
        localOpenAiEndpoint: fields.localOpenAiEndpoint,
        goRuntimeLocalModelId: String(binding?.goRuntimeLocalModelId || '').trim() || undefined,
        goRuntimeStatus: String(binding?.goRuntimeStatus || '').trim() || undefined,
        connectorId: '' as const,
      };
    }

    return {
      source: 'token-api',
      runtimeModelType: fields.runtimeModelType as RuntimeModality,
      provider,
      adapter: binding?.adapter,
      providerHints: binding?.providerHints,
      modelId: model,
      model,
      endpoint: String(binding?.endpoint || '').trim(),
      localOpenAiEndpoint: '',
      connectorId,
    };
  };
}
