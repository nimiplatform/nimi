import {
  resolveRuntimeRouteBindingFromSnapshot,
  type RuntimeResolvedBinding,
  type RuntimeRouteBinding,
  type RuntimeRouteOptionsSnapshot,
} from './runtime-route.js';
import {
  checkRuntimeRouteHealthWithHost,
  describeRuntimeRouteWithHost,
  type RuntimeRouteDescribeCallOptionsBuilder,
  type RuntimeRouteExecuteScenario,
  type RuntimeRouteHostHealthInput,
  type RuntimeRouteHostProviderHealth,
} from './runtime-route-host-facade.js';
import {
  toRuntimeRouteCanonicalCapability,
  type RuntimeRouteAppCapability,
  type RuntimeRouteCapabilityRuntime,
} from './runtime-route-capability-projection.js';

export type RuntimeRouteCapabilityOptionsLoader = (input: {
  capability: RuntimeRouteAppCapability;
  targetId?: string;
}) => Promise<RuntimeRouteOptionsSnapshot>;

export type RuntimeRouteCapabilityDescribeHost = {
  appId: string;
  executeScenario: RuntimeRouteExecuteScenario;
};

export type RuntimeRouteCapabilityHostRuntimeDeps = {
  loadRuntimeRouteOptions: RuntimeRouteCapabilityOptionsLoader;
  checkHealth: (request: RuntimeRouteHostHealthInput) => Promise<RuntimeRouteHostProviderHealth>;
  getDescribeHost: () => RuntimeRouteCapabilityDescribeHost;
  buildDescribeCallOptions: RuntimeRouteDescribeCallOptionsBuilder;
  describeTargetId: string;
  routeOptionsTargetId?: string;
  describeTimeoutMs?: number;
};

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function createRuntimeRouteCapabilityRuntimeWithHost(
  deps: RuntimeRouteCapabilityHostRuntimeDeps,
): RuntimeRouteCapabilityRuntime {
  const resolvedByRef = new Map<string, RuntimeResolvedBinding>();

  async function resolve(input: {
    capability: RuntimeRouteAppCapability;
    binding?: RuntimeRouteBinding;
  }): Promise<RuntimeResolvedBinding> {
    if (!input.binding) {
      throw new Error('RUNTIME_ROUTE_BINDING_REQUIRED');
    }
    const capability = toRuntimeRouteCanonicalCapability(input.capability);
    const snapshot = await deps.loadRuntimeRouteOptions({
      capability: input.capability,
      targetId: deps.routeOptionsTargetId,
    });
    const resolved = resolveRuntimeRouteBindingFromSnapshot({
      capability,
      binding: input.binding,
      snapshot,
    });
    if (resolved.resolvedBindingRef) {
      resolvedByRef.set(resolved.resolvedBindingRef, resolved);
    }
    return resolved;
  }

  return {
    resolve,
    checkHealth: async (input) => {
      const resolved = await resolve(input);
      return checkRuntimeRouteHealthWithHost({
        resolved,
        checkHealth: deps.checkHealth,
      });
    },
    describe: async (input) => {
      const capability = toRuntimeRouteCanonicalCapability(input.capability);
      const resolvedBindingRef = normalizeText(input.resolvedBindingRef);
      const resolved = resolvedByRef.get(resolvedBindingRef);
      if (!resolved) {
        throw new Error('RUNTIME_ROUTE_DESCRIBE_BINDING_REF_MISSING');
      }
      const describeHost = deps.getDescribeHost();
      return describeRuntimeRouteWithHost({
        appId: describeHost.appId,
        targetId: deps.describeTargetId,
        capability,
        resolvedBindingRef,
        resolved,
        buildCallOptions: deps.buildDescribeCallOptions,
        executeScenario: describeHost.executeScenario,
        timeoutMs: deps.describeTimeoutMs,
      });
    },
  };
}
