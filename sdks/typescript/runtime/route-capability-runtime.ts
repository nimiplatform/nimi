export {
  NIMI_RUNTIME_ROUTE_DESCRIBE_RESULT_RESPONSE_METADATA_KEY,
  NIMI_RUNTIME_ROUTE_DESCRIBE_TIMEOUT_MS,
} from './route-capability-types';
export type {
  NimiRuntimeResolvedBinding,
  NimiRuntimeRouteCapabilityDescribeHost,
  NimiRuntimeRouteCapabilityHostRuntimeDeps,
  NimiRuntimeRouteCapabilityOptionsLoader,
  NimiRuntimeRouteCapabilityRuntime,
  NimiRuntimeRouteDescribeCallOptions,
  NimiRuntimeRouteDescribeCallOptionsBuilder,
  NimiRuntimeRouteDescribeCallOptionsInput,
  NimiRuntimeRouteDescribeResult,
  NimiRuntimeRouteExecuteScenario,
  NimiRuntimeRouteHealthInput,
  NimiRuntimeRouteHealthResult,
  NimiRuntimeRouteHostProviderHealth,
  NimiRuntimeRouteMetadataKind,
  NimiRuntimeRouteMetadataVersion,
  NimiRuntimeRouteResolvedBindingRef,
} from './route-capability-types';

import {
  listNimiRuntimeRouteOptions,
  nimiRuntimeRouteTargetRefKey,
  type NimiRuntimeRouteTargetRef,
} from './route-options';
import {
  nimiRuntimeRouteHealthInputFromResolvedBinding,
  nimiRuntimeRouteHealthResultFromProviderHealth,
  normalizeRequiredNimiRuntimeRouteCapability,
  normalizeText,
  resolveNimiRuntimeRouteTargetRefFromSnapshot,
} from './route-capability-binding';
import { describeNimiRuntimeRouteWithHost } from './route-capability-describe';
import type {
  NimiRuntimeResolvedBinding,
  NimiRuntimeRouteCapabilityHostRuntimeDeps,
  NimiRuntimeRouteCapabilityRuntime,
} from './route-capability-types';

export const NIMI_RUNTIME_ROUTE_OPTIONS_CACHE_DEFAULT_TTL_MS = 300_000;

export function createNimiRuntimeRouteCapabilityRuntimeWithHost(
  deps: NimiRuntimeRouteCapabilityHostRuntimeDeps,
): NimiRuntimeRouteCapabilityRuntime {
  const resolvedByRef = new Map<string, NimiRuntimeResolvedBinding>();
  const resolvedByTarget = new Map<string, NimiRuntimeResolvedBinding>();
  let cacheCreatedAtMs: number | null = null;
  let cacheRevision = normalizeRouteOptionsCacheRevision(deps.getRouteOptionsCacheRevision?.());

  function nowMs(): number {
    const value = deps.routeOptionsCacheNowMs?.() ?? Date.now();
    return Number.isFinite(value) ? value : Date.now();
  }

  function clearResolvedRouteTargets(): void {
    resolvedByRef.clear();
    resolvedByTarget.clear();
    cacheCreatedAtMs = nowMs();
  }

  function refreshCacheBoundary(): void {
    const nextRevision = normalizeRouteOptionsCacheRevision(deps.getRouteOptionsCacheRevision?.());
    if (nextRevision !== cacheRevision) {
      cacheRevision = nextRevision;
      clearResolvedRouteTargets();
      return;
    }
    const ttlMs = deps.routeOptionsCacheTtlMs ?? NIMI_RUNTIME_ROUTE_OPTIONS_CACHE_DEFAULT_TTL_MS;
    if (typeof ttlMs === 'number' && Number.isFinite(ttlMs) && ttlMs >= 0) {
      const currentMs = nowMs();
      if (cacheCreatedAtMs === null) {
        cacheCreatedAtMs = currentMs;
      }
      if (currentMs - cacheCreatedAtMs >= ttlMs) {
        clearResolvedRouteTargets();
      }
    }
  }

  async function resolve(input: {
    readonly capability: string;
    readonly targetRef?: NimiRuntimeRouteTargetRef;
  }): Promise<NimiRuntimeResolvedBinding> {
    if (!input.targetRef) {
      throw new Error('NIMI_RUNTIME_ROUTE_TARGET_REF_REQUIRED');
    }
    const capability = normalizeRequiredNimiRuntimeRouteCapability(input.capability);
    refreshCacheBoundary();
    const cacheKey = routeTargetCacheKey(capability, input.targetRef);
    const cached = resolvedByTarget.get(cacheKey);
    if (cached) {
      return cached;
    }
    const snapshot = await listNimiRuntimeRouteOptions({
      listRuntimeRouteOptions(routeInput) {
        return deps.loadRuntimeRouteOptions({
          capability: routeInput.capability,
          targetId: routeInput.targetId,
          selectedTargetRef: routeInput.selectedTargetRef,
        });
      },
    }, {
      capability,
      targetId: deps.routeOptionsTargetId,
      selectedTargetRef: input.targetRef,
    });
    const resolved = resolveNimiRuntimeRouteTargetRefFromSnapshot({
      capability,
      targetRef: input.targetRef,
      snapshot,
    });
    resolvedByRef.set(resolved.resolvedBindingRef, resolved);
    resolvedByTarget.set(cacheKey, resolved);
    if (cacheCreatedAtMs === null) {
      cacheCreatedAtMs = nowMs();
    }
    return resolved;
  }

  return {
    resolve,
    checkHealth: async (input) => {
      const resolved = await resolve(input);
      const health = await deps.checkHealth(nimiRuntimeRouteHealthInputFromResolvedBinding(resolved));
      return nimiRuntimeRouteHealthResultFromProviderHealth({
        resolved,
        health,
      });
    },
    describe: async (input) => {
      const capability = normalizeRequiredNimiRuntimeRouteCapability(input.capability);
      refreshCacheBoundary();
      const resolvedBindingRef = normalizeText(input.resolvedBindingRef);
      const resolved = resolvedByRef.get(resolvedBindingRef);
      if (!resolved) {
        throw new Error('NIMI_RUNTIME_ROUTE_DESCRIBE_BINDING_REF_MISSING');
      }
      const describeHost = deps.getDescribeHost();
      return describeNimiRuntimeRouteWithHost({
        appId: describeHost.appId,
        subjectUserId: describeHost.subjectUserId,
        targetId: deps.describeTargetId,
        capability,
        resolvedBindingRef,
        resolved,
        buildCallOptions: deps.buildDescribeCallOptions,
        executeScenario: describeHost.executeScenario,
        timeoutMs: deps.describeTimeoutMs,
      });
    },
    invalidateResolvedRouteTargets: clearResolvedRouteTargets,
  };
}

function routeTargetCacheKey(capability: string, targetRef: NimiRuntimeRouteTargetRef): string {
  return `${capability}:${nimiRuntimeRouteTargetRefKey(targetRef)}`;
}

function normalizeRouteOptionsCacheRevision(input: string | number | null | undefined): string {
  return input === null || input === undefined ? '' : String(input);
}
