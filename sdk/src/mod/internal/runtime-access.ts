import { getModSdkHost } from '../host';
import type {
  RuntimeLlmHealthInput,
  RuntimeLlmHealthResult,
  ResolvedRuntimeRouteBinding,
  RuntimeRouteHealthResult,
  RuntimeRouteHint,
  RuntimeRouteOverride,
} from '../types';
import type { AiRuntimeDependencySnapshot } from '../ai/types';
import type { RuntimeHookRuntimeFacade } from '../types/runtime-hook/runtime-facade';

export function getRuntimeHost() {
  return getModSdkHost().runtime;
}

export function getHookRuntimeFacade(): RuntimeHookRuntimeFacade {
  return getRuntimeHost().getRuntimeHookRuntime();
}

export async function resolveModRouteBinding(input: {
  modId: string;
  routeHint: RuntimeRouteHint;
  routeOverride?: RuntimeRouteOverride;
}): Promise<ResolvedRuntimeRouteBinding> {
  return getRuntimeHost().resolveRouteBinding({
    routeHint: input.routeHint,
    modId: input.modId,
    routeOverride: input.routeOverride,
  });
}

function toRuntimeHealthInput(route: ResolvedRuntimeRouteBinding): RuntimeLlmHealthInput {
  if (route.source === 'local-runtime') {
    return {
      provider: route.provider,
      localProviderEndpoint: route.localProviderEndpoint || route.endpoint,
      localProviderModel: route.localProviderModel || route.model,
      localOpenAiEndpoint: route.localOpenAiEndpoint || route.endpoint,
      localOpenAiApiKey: route.localOpenAiApiKey,
    };
  }

  return {
    provider: route.provider,
    localProviderModel: route.model,
    localOpenAiEndpoint: route.localOpenAiEndpoint || route.endpoint,
    localOpenAiApiKey: route.localOpenAiApiKey,
  };
}

export async function checkResolvedRouteHealth(
  route: ResolvedRuntimeRouteBinding,
): Promise<RuntimeRouteHealthResult> {
  const payload = toRuntimeHealthInput(route);
  const result = await getRuntimeHost().checkLocalLlmHealth(payload);
  const provider = typeof result.provider === 'string' ? result.provider : route.provider;
  const status = String(result.status || '').trim().toLowerCase();
  const reasonCode = status === 'healthy'
    ? 'RUNTIME_ROUTE_HEALTHY'
    : status === 'degraded'
      ? 'RUNTIME_ROUTE_DEGRADED'
      : 'RUNTIME_ROUTE_UNAVAILABLE';
  const actionHint = status === 'healthy'
    ? 'none'
    : route.source === 'local-runtime'
      ? (status === 'degraded' ? 'install-local-model' : 'switch-to-token-api')
      : (status === 'degraded' ? 'retry' : 'verify-connector');
  const healthy = status === 'healthy' || status === 'degraded';
  return {
    ...result,
    healthy,
    provider,
    reasonCode,
    actionHint,
  };
}

export async function getModAiDependencySnapshot(input: {
  modId: string;
  capability?: string;
  routeSourceHint?: 'token-api' | 'local-runtime';
}): Promise<AiRuntimeDependencySnapshot> {
  return getRuntimeHost().getModAiDependencySnapshot({
    modId: String(input.modId || '').trim(),
    capability: String(input.capability || '').trim() || undefined,
    routeSourceHint: input.routeSourceHint,
  });
}
