import { getModSdkHost } from '../host';
import type {
  RuntimeLlmHealthInput,
  RuntimeLlmHealthResult,
  ResolvedRuntimeRouteBinding,
  RuntimeRouteHealthResult,
  RuntimeRouteHint,
  RuntimeRouteOverride,
} from '../types';
import type { RuntimeHookRuntimeFacade } from '../types/runtime-hook/runtime-facade';
import type { AiRuntimeDependencySnapshot } from '../ai/types';
import type {
  ModRuntimeContext,
  ModRuntimeContextInput,
  ModRuntimeHost,
} from '../types/runtime-mod';

export function getRuntimeHost(): ModRuntimeHost {
  return getModSdkHost().runtime;
}

function resolveRuntimeHost(input?: ModRuntimeContextInput): ModRuntimeHost {
  return input?.runtimeHost || getRuntimeHost();
}

export function getHookRuntimeFacade(input?: ModRuntimeContextInput): RuntimeHookRuntimeFacade {
  if (input?.runtime) {
    return input.runtime;
  }
  return resolveRuntimeHost(input).getRuntimeHookRuntime();
}

export function resolveModRuntimeContext(input?: ModRuntimeContextInput): ModRuntimeContext {
  const runtimeHost = resolveRuntimeHost(input);
  const runtime = getHookRuntimeFacade({
    runtimeHost,
    runtime: input?.runtime,
  });
  return {
    runtimeHost,
    runtime,
  };
}

export async function resolveModRouteBinding(input: {
  modId: string;
  routeHint: RuntimeRouteHint;
  routeOverride?: RuntimeRouteOverride;
}, context?: ModRuntimeContextInput): Promise<ResolvedRuntimeRouteBinding> {
  return resolveRuntimeHost(context).resolveRouteBinding({
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
      connectorId: route.connectorId,
    };
  }

  return {
    provider: route.provider,
    localProviderModel: route.model,
    localOpenAiEndpoint: route.localOpenAiEndpoint || route.endpoint,
    connectorId: route.connectorId,
  };
}

export async function checkResolvedRouteHealth(
  route: ResolvedRuntimeRouteBinding,
  context?: ModRuntimeContextInput,
): Promise<RuntimeRouteHealthResult> {
  const payload = toRuntimeHealthInput(route);
  const result = await resolveRuntimeHost(context).checkLocalLlmHealth(payload);
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
}, context?: ModRuntimeContextInput): Promise<AiRuntimeDependencySnapshot> {
  return resolveRuntimeHost(context).getModAiDependencySnapshot({
    modId: String(input.modId || '').trim(),
    capability: String(input.capability || '').trim() || undefined,
    routeSourceHint: input.routeSourceHint,
  });
}
