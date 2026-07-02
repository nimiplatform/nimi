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

import { listNimiRuntimeRouteOptions, type NimiRuntimeRouteTargetRef } from './route-options';
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

export function createNimiRuntimeRouteCapabilityRuntimeWithHost(
  deps: NimiRuntimeRouteCapabilityHostRuntimeDeps,
): NimiRuntimeRouteCapabilityRuntime {
  const resolvedByRef = new Map<string, NimiRuntimeResolvedBinding>();

  async function resolve(input: {
    readonly capability: string;
    readonly targetRef?: NimiRuntimeRouteTargetRef;
  }): Promise<NimiRuntimeResolvedBinding> {
    if (!input.targetRef) {
      throw new Error('NIMI_RUNTIME_ROUTE_TARGET_REF_REQUIRED');
    }
    const capability = normalizeRequiredNimiRuntimeRouteCapability(input.capability);
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
  };
}
