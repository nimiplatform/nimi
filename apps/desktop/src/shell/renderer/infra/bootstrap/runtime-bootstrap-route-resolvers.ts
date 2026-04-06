import type { SourceIdV11 } from '@renderer/features/runtime-config/runtime-config-state-types';
import { type LocalEngine, type ResolvedRuntimeRouteBinding, type RuntimeModality, type RuntimeRouteBinding } from "@nimiplatform/sdk/mod";
import { normalizeLocalEngine, normalizeLocalModelRoot } from './runtime-bootstrap-utils';
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
    if (lower.startsWith('local') || lower === 'llama' || lower === 'media' || lower === 'speech' || lower === 'sidecar') {
        return 'local';
    }
    return 'cloud';
}
function buildLocalSelector(modelId: string, engine: string): string {
    const normalizedModelId = normalizeLocalModelRoot(modelId);
    const normalizedEngine = normalizeLocalEngine(engine);
    return normalizedModelId ? `${normalizedEngine}/${normalizedModelId}` : normalizedEngine;
}
export function createResolveRuntimeBinding(getRuntimeFields: () => RuntimeFields) {
    return async ({ modId: _modId, binding }: {
        modId?: string;
        binding?: RuntimeRouteBinding;
    }): Promise<ResolvedRuntimeRouteBinding> => {
        const fields = getRuntimeFields();
        if (!binding) {
            throw new Error('RUNTIME_ROUTE_BINDING_REQUIRED');
        }
        const source = binding.source === 'cloud' || binding.source === 'local'
            ? binding.source
            : inferSource(String(binding.provider || binding.engine || '').trim());
        const boundModel = String(binding?.model || '').trim();
        const boundModelId = String(binding?.modelId || '').trim();
        const modelId = normalizeLocalModelRoot(boundModelId || boundModel || binding.localModelId || '');
        const model = binding?.source === 'local'
            ? modelId
            : (boundModel || boundModelId);
        const connectorId = String(binding?.connectorId || '').trim();
        const provider = String(binding?.provider || binding?.engine || '').trim();
        if (source === 'local') {
            if (!modelId) {
                throw new Error('RUNTIME_ROUTE_BINDING_MODEL_REQUIRED');
            }
            const engine = normalizeLocalEngine(binding?.engine || binding?.provider || '');
            const selector = buildLocalSelector(modelId, engine);
            if (!engine) {
                throw new Error('RUNTIME_ROUTE_BINDING_ENGINE_REQUIRED');
            }
            const endpoint = String(binding?.endpoint || '').trim();
            return {
                source: 'local',
                runtimeModelType: fields.runtimeModelType as RuntimeModality,
                provider: provider || engine,
                adapter: binding?.adapter,
                providerHints: binding?.providerHints,
                modelId,
                localModelId: String(binding?.localModelId || '').trim(),
                engine: engine as LocalEngine,
                model: selector,
                endpoint,
                localProviderEndpoint: endpoint,
                localProviderModel: modelId,
                localOpenAiEndpoint: endpoint,
                goRuntimeLocalModelId: String(binding?.goRuntimeLocalModelId || '').trim() || undefined,
                goRuntimeStatus: String(binding?.goRuntimeStatus || '').trim() || undefined,
                connectorId: '' as const,
            };
        }
        if (!connectorId) {
            throw new Error('RUNTIME_ROUTE_BINDING_CONNECTOR_REQUIRED');
        }
        if (!model) {
            throw new Error('RUNTIME_ROUTE_BINDING_MODEL_REQUIRED');
        }
        if (!provider) {
            throw new Error('RUNTIME_ROUTE_BINDING_PROVIDER_REQUIRED');
        }
        return {
            source: 'cloud',
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
