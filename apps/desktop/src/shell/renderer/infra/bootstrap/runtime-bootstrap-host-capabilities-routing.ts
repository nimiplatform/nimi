import { localAiRuntime, listGoRuntimeModelsSnapshot, reconcileModelsToGoRuntime, type LocalAiModelRecord, } from '@runtime/local-ai-runtime';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { createResolveRuntimeBinding } from './runtime-bootstrap-route-resolvers';
import { pickPreferredGoRuntimeModel } from './runtime-bootstrap-route-options';
import { createNimiError } from '@nimiplatform/sdk/runtime';
import { type ModRuntimeResolvedBinding, type RuntimeCanonicalCapability, type RuntimeLlmHealthResult, type RuntimeRouteBinding, type RuntimeRouteOptionsSnapshot } from "@nimiplatform/sdk/mod";
export function getRuntimeFieldsFromStore() {
    const runtime = useAppStore.getState().runtimeFields;
    return {
        provider: runtime.provider,
        runtimeModelType: runtime.runtimeModelType,
        localProviderEndpoint: runtime.localProviderEndpoint,
        localProviderModel: runtime.localProviderModel,
        localOpenAiEndpoint: runtime.localOpenAiEndpoint,
        connectorId: runtime.connectorId,
    };
}
export function toResolvedBinding(capability: RuntimeCanonicalCapability, resolved: Awaited<ReturnType<ReturnType<typeof createResolveRuntimeBinding>>>): ModRuntimeResolvedBinding {
    return {
        capability,
        source: resolved.source,
        provider: String(resolved.provider || '').trim(),
        model: String(resolved.model || '').trim(),
        modelId: 'modelId' in resolved ? String(resolved.modelId || '').trim() || undefined : undefined,
        connectorId: String(resolved.connectorId || '').trim(),
        endpoint: String(resolved.endpoint || '').trim() || undefined,
        localModelId: 'localModelId' in resolved ? String(resolved.localModelId || '').trim() || undefined : undefined,
        engine: 'engine' in resolved ? String(resolved.engine || '').trim() || undefined : undefined,
        adapter: String(resolved.adapter || '').trim() || undefined,
        localProviderEndpoint: 'localProviderEndpoint' in resolved ? String(resolved.localProviderEndpoint || '').trim() || undefined : undefined,
        localOpenAiEndpoint: String(resolved.localOpenAiEndpoint || '').trim() || undefined,
        goRuntimeLocalModelId: 'goRuntimeLocalModelId' in resolved
            ? String(resolved.goRuntimeLocalModelId || '').trim() || undefined
            : undefined,
        goRuntimeStatus: 'goRuntimeStatus' in resolved
            ? String(resolved.goRuntimeStatus || '').trim() || undefined
            : undefined,
    };
}
export function hydrateCloudRouteBindingFromOptions(binding: RuntimeRouteBinding, options: RuntimeRouteOptionsSnapshot): RuntimeRouteBinding {
    if (binding.source !== 'cloud') {
        return binding;
    }
    const connectorId = String(binding.connectorId || '').trim();
    const selected = options.selected.source === 'cloud' ? options.selected : null;
    const connector = options.connectors.find((item) => item.id === connectorId) || null;
    if (!connectorId && selected) {
        return {
            ...selected,
            model: String(binding.model || selected.model || '').trim(),
        };
    }
    if (!connector) {
        return binding;
    }
    return {
        ...binding,
        provider: String(binding.provider || connector.provider || '').trim() || undefined,
    };
}
export function hydrateLocalRouteBindingFromOptions(binding: RuntimeRouteBinding, options: RuntimeRouteOptionsSnapshot): RuntimeRouteBinding {
    if (binding.source !== 'local') {
        return binding;
    }
    const selected = options.selected.source === 'local' ? options.selected : null;
    const targetLocalModelId = String(binding.localModelId || '').trim();
    const targetModelId = String(binding.modelId || binding.model || '').trim().replace(/^(localai|nexa|local)\//i, '');
    const targetEngine = String(binding.engine || binding.provider || '').trim().toLowerCase();
    const localModel = options.local.models.find((item) => ((targetLocalModelId && String(item.localModelId || '').trim() === targetLocalModelId)
        || (String(item.modelId || item.model || '').trim() === targetModelId
            && (!targetEngine || String(item.engine || item.provider || '').trim().toLowerCase() === targetEngine)))) || null;
    if (!localModel && selected) {
        return {
            ...selected,
            model: String(binding.model || binding.modelId || selected.model || '').trim(),
            modelId: String(binding.modelId || selected.modelId || selected.model || '').trim() || undefined,
            localModelId: String(binding.localModelId || selected.localModelId || '').trim() || undefined,
            engine: String(binding.engine || selected.engine || '').trim() || undefined,
            provider: String(binding.provider || selected.provider || '').trim() || undefined,
        };
    }
    if (!localModel) {
        return binding;
    }
    const bindingGoRuntimeStatus = String(binding.goRuntimeStatus || '').trim().toLowerCase();
    const localModelGoRuntimeStatus = String(localModel.goRuntimeStatus || '').trim().toLowerCase();
    const clearStaleBindingGoRuntime = bindingGoRuntimeStatus === 'removed' && !localModelGoRuntimeStatus;
    const preferLocalModelGoRuntime = Boolean(localModelGoRuntimeStatus)
        && (!bindingGoRuntimeStatus
            || bindingGoRuntimeStatus === 'removed'
            || bindingGoRuntimeStatus !== localModelGoRuntimeStatus);
    return {
        ...binding,
        model: String(binding.model || binding.modelId || localModel.modelId || localModel.model || '').trim(),
        modelId: String(binding.modelId || localModel.modelId || localModel.model || '').trim() || undefined,
        localModelId: String(binding.localModelId || localModel.localModelId || '').trim() || undefined,
        engine: String(binding.engine || localModel.engine || '').trim() || undefined,
        provider: String(binding.provider || localModel.provider || localModel.engine || '').trim() || undefined,
        adapter: String(binding.adapter || localModel.adapter || '').trim() || undefined,
        providerHints: binding.providerHints || localModel.providerHints,
        endpoint: String(binding.endpoint || localModel.endpoint || '').trim() || undefined,
        goRuntimeLocalModelId: String((clearStaleBindingGoRuntime
            ? ''
            : (preferLocalModelGoRuntime ? localModel.goRuntimeLocalModelId : binding.goRuntimeLocalModelId))
            || localModel.goRuntimeLocalModelId
            || (clearStaleBindingGoRuntime ? '' : binding.goRuntimeLocalModelId)
            || '').trim() || undefined,
        goRuntimeStatus: String((clearStaleBindingGoRuntime
            ? ''
            : (preferLocalModelGoRuntime ? localModel.goRuntimeStatus : binding.goRuntimeStatus))
            || localModel.goRuntimeStatus
            || (clearStaleBindingGoRuntime ? '' : binding.goRuntimeStatus)
            || '').trim() || undefined,
    };
}
function localModelStatusPriority(status: string): number {
    const normalized = String(status || '').trim().toLowerCase();
    if (normalized === 'active')
        return 0;
    if (normalized === 'unhealthy')
        return 1;
    if (normalized === 'installed')
        return 2;
    if (normalized === 'removed')
        return 3;
    return 4;
}
function normalizeLocalModelRoot(value: unknown): string {
    const trimmed = String(value || '').trim();
    const lower = trimmed.toLowerCase();
    if (lower.startsWith('localai/'))
        return trimmed.slice('localai/'.length).trim();
    if (lower.startsWith('nexa/'))
        return trimmed.slice('nexa/'.length).trim();
    if (lower.startsWith('local/'))
        return trimmed.slice('local/'.length).trim();
    return trimmed;
}
function normalizeLocalEngine(value: unknown): string {
    return String(value || '').trim().toLowerCase() === 'nexa' ? 'nexa' : 'localai';
}
function pickDesktopLocalModel(models: LocalAiModelRecord[], resolved: ModRuntimeResolvedBinding): LocalAiModelRecord | null {
    const targetLocalModelId = String(resolved.localModelId || '').trim();
    const targetModelId = normalizeLocalModelRoot(resolved.modelId || resolved.model);
    const targetEngine = normalizeLocalEngine(resolved.engine || resolved.provider || '');
    const candidates = models
        .filter((model) => model.status !== 'removed')
        .filter((model) => ((targetLocalModelId && String(model.localModelId || '').trim() === targetLocalModelId)
        || (normalizeLocalModelRoot(model.modelId) === targetModelId
            && normalizeLocalEngine(model.engine) === targetEngine)))
        .sort((left, right) => {
        const priorityDelta = localModelStatusPriority(left.status) - localModelStatusPriority(right.status);
        if (priorityDelta !== 0) {
            return priorityDelta;
        }
        return String(left.localModelId || '').localeCompare(String(right.localModelId || ''));
    });
    return candidates[0] || null;
}
export async function ensureResolvedLocalModelAvailable(resolved: ModRuntimeResolvedBinding): Promise<ModRuntimeResolvedBinding> {
    if (resolved.source !== 'local') {
        return resolved;
    }
    const desktopModels = await localAiRuntime.list();
    const desktopModel = pickDesktopLocalModel(desktopModels, resolved);
    if (!desktopModel) {
        return resolved;
    }
    const goRuntimeStatus = String(resolved.goRuntimeStatus || '').trim().toLowerCase();
    const needsRepair = !String(resolved.goRuntimeLocalModelId || '').trim() || goRuntimeStatus === 'removed';
    if (!needsRepair) {
        return resolved;
    }
    await reconcileModelsToGoRuntime([desktopModel]);
    const goRuntimeModels = await listGoRuntimeModelsSnapshot();
    const repaired = pickPreferredGoRuntimeModel(goRuntimeModels, desktopModel.modelId, desktopModel.engine);
    return {
        ...resolved,
        localModelId: String(resolved.localModelId || desktopModel.localModelId || '').trim() || undefined,
        endpoint: String(resolved.endpoint || desktopModel.endpoint || '').trim() || undefined,
        localProviderEndpoint: String(resolved.localProviderEndpoint || desktopModel.endpoint || resolved.endpoint || '').trim() || undefined,
        goRuntimeLocalModelId: String(repaired?.localModelId || '').trim() || undefined,
        goRuntimeStatus: String(repaired?.status || '').trim() || undefined,
    };
}
export function toRouteHealthResult(result: RuntimeLlmHealthResult, provider: string, source: 'local' | 'cloud'): RuntimeLlmHealthResult & {
    provider: string;
    reasonCode: string;
    actionHint: 'none' | 'install-local-model' | 'switch-to-cloud' | 'verify-connector' | 'retry';
} {
    const status = String(result.status || '').trim().toLowerCase();
    const reasonCode = status === 'healthy'
        ? 'RUNTIME_ROUTE_HEALTHY'
        : status === 'degraded'
            ? 'RUNTIME_ROUTE_DEGRADED'
            : 'RUNTIME_ROUTE_UNAVAILABLE';
    const actionHint = status === 'healthy'
        ? 'none'
        : source === 'local'
            ? (status === 'degraded' ? 'install-local-model' : 'switch-to-cloud')
            : (status === 'degraded' ? 'retry' : 'verify-connector');
    return {
        ...result,
        healthy: status === 'healthy' || status === 'degraded',
        provider,
        reasonCode,
        actionHint,
    };
}
export function requireModel(model: unknown, reasonCode: string): string {
    const normalized = String(model || '').trim();
    if (!normalized) {
        throw createNimiError({
            message: 'runtime model is required',
            reasonCode,
            actionHint: 'select_runtime_route_binding',
            source: 'runtime',
        });
    }
    return normalized;
}
