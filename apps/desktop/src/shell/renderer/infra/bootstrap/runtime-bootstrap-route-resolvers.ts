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
    if (lower.startsWith('local') || lower === 'localai' || lower === 'nexa' || lower === 'nimi_media') {
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
        const source = binding?.source === 'cloud' || binding?.source === 'local'
            ? binding.source
            : inferSource(fields.provider);
        const boundModel = String(binding?.model || '').trim();
        const boundModelId = String(binding?.modelId || '').trim();
        const modelId = normalizeLocalModelRoot(boundModelId || boundModel || fields.localProviderModel || '');
        const model = binding?.source === 'local'
            ? modelId
            : (boundModel || fields.localProviderModel || '');
        const connectorId = binding?.connectorId || fields.connectorId || '';
        const provider = String(binding?.provider || fields.provider || '').trim();
        if (source === 'local') {
            const engine = normalizeLocalEngine(binding?.engine || binding?.provider || fields.provider);
            const selector = buildLocalSelector(modelId, engine);
            const endpoint = String(binding?.endpoint || fields.localProviderEndpoint || fields.localOpenAiEndpoint || '').trim();
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
                localOpenAiEndpoint: fields.localOpenAiEndpoint,
                goRuntimeLocalModelId: String(binding?.goRuntimeLocalModelId || '').trim() || undefined,
                goRuntimeStatus: String(binding?.goRuntimeStatus || '').trim() || undefined,
                connectorId: '' as const,
            };
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
