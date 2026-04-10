import type { RuntimeRouteBinding } from '@nimiplatform/sdk/mod';
import type { NimiRoutePolicy } from '@nimiplatform/sdk/runtime';
import type { ResolvedRouteInfo } from './tester-types.js';
import { asString } from './tester-utils.js';
import {
  buildRuntimeRequestMetadata,
  createRuntimeTraceId,
  resolveSourceAndModel,
} from '@runtime/llm-adapter/execution/runtime-ai-bridge.js';

export { getRuntimeClient } from '@runtime/llm-adapter/execution/runtime-ai-bridge.js';

export type TesterCallParams = {
  model: string;
  route: NimiRoutePolicy;
  connectorId?: string;
  metadata: Record<string, string>;
};

export async function resolveCallParams(binding: RuntimeRouteBinding | undefined): Promise<TesterCallParams> {
  if (!binding) {
    return {
      model: '',
      route: 'local',
      metadata: await buildRuntimeRequestMetadata({ source: 'local' }),
    };
  }
  const source = asString(binding.source) || 'local';
  const connectorId = asString(binding.connectorId) || undefined;
  const model = asString(binding.modelId || binding.model);
  const provider = asString(binding.provider);
  const endpoint = asString(binding.endpoint);

  let resolvedModel = model;
  try {
    const resolved = resolveSourceAndModel({
      provider: provider || (source === 'local' ? 'local' : 'cloud'),
      model,
      connectorId,
      localProviderEndpoint: source === 'local' ? endpoint : undefined,
    });
    resolvedModel = resolved.modelId;
  } catch {
    // If resolveSourceAndModel fails, use model as-is with engine prefix for local
    if (source === 'local' && model) {
      const engine = asString(binding.engine) || 'local';
      resolvedModel = model.includes('/') ? model : `${engine}/${model}`;
    }
  }

  const metadata = await buildRuntimeRequestMetadata({
    source: source as 'local' | 'cloud',
    connectorId,
    providerEndpoint: endpoint || undefined,
  });

  return {
    model: resolvedModel,
    route: source as NimiRoutePolicy,
    connectorId,
    metadata,
  };
}

export function bindingToRouteInfo(binding: RuntimeRouteBinding | null | undefined): ResolvedRouteInfo | null {
  if (!binding) return null;
  return {
    source: asString(binding.source) || undefined,
    provider: asString(binding.provider) || undefined,
    model: asString(binding.model) || undefined,
    modelId: asString(binding.modelId) || undefined,
    connectorId: asString(binding.connectorId) || undefined,
    endpoint: asString(binding.endpoint) || undefined,
    adapter: asString(binding.adapter) || undefined,
    engine: asString(binding.engine) || undefined,
    localModelId: asString(binding.localModelId) || undefined,
    goRuntimeLocalModelId: asString(binding.goRuntimeLocalModelId) || undefined,
    goRuntimeStatus: asString(binding.goRuntimeStatus) || undefined,
    localProviderEndpoint: asString(binding.endpoint) || undefined,
  };
}

export { createRuntimeTraceId };
