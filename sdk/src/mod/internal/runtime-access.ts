import { getModSdkHost } from '../host';
import type {
  RuntimeLlmHealthInput,
  RuntimeLlmHealthResult,
  RuntimeRouteHealthResult,
} from '../types';
import type { RuntimeHookRuntimeFacade } from '../types/runtime-hook/runtime-facade';
import type {
  ModRuntimeContext,
  ModRuntimeContextInput,
  ModRuntimeHost,
} from '../types/runtime-mod';
import type { ModRuntimeDependencySnapshot } from '../runtime/types';
import type { RuntimeCanonicalCapability } from '../runtime-route.js';

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

export async function getModAiDependencySnapshot(input: {
  modId: string;
  capability?: RuntimeCanonicalCapability;
  routeSourceHint?: 'token-api' | 'local-runtime';
}, context?: ModRuntimeContextInput): Promise<ModRuntimeDependencySnapshot> {
  return resolveRuntimeHost(context).getModAiDependencySnapshot({
    modId: String(input.modId || '').trim(),
    capability: input.capability,
    routeSourceHint: input.routeSourceHint,
  });
}
