import { useMemo } from 'react';
import type { RuntimeLocalManifestSummary } from '@renderer/bridge';
import {
  CAPABILITIES_V11,
  VENDOR_ORDER_V11,
  type CapabilityV11,
  type ProviderStatusV11,
  type RuntimeConfigStateV11,
} from '@renderer/features/runtime-config/state/v11/types';
import {
  selectAllLocalRuntimeModelsV11,
  selectFilteredConnectorModelsV11,
  selectFilteredLocalRuntimeModelsV11,
  selectOrderedConnectorsV11,
} from '@renderer/features/runtime-config/state/runtime-config-selectors-v11';

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function normalizeCapability(value: unknown): CapabilityV11 | null {
  const normalized = String(value || '').trim();
  return CAPABILITIES_V11.includes(normalized as CapabilityV11)
    ? normalized as CapabilityV11
    : null;
}

export type RuntimeConfigPanelDerivedModel = {
  selectedConnector: RuntimeConfigStateV11['connectors'][number] | null;
  orderedConnectors: RuntimeConfigStateV11['connectors'];
  filteredLocalRuntimeModels: string[];
  filteredConnectorModels: string[];
  runtimeDependencyTargets: Array<{
    modId: string;
    modName: string;
    consumeCapabilities: CapabilityV11[];
  }>;
  runtimeStatus: ProviderStatusV11 | null;
};

export function useRuntimeConfigPanelDerived(input: {
  state: RuntimeConfigStateV11 | null;
  localRuntimeModelQuery: string;
  connectorModelQuery: string;
  localManifestSummaries: RuntimeLocalManifestSummary[];
  registeredRuntimeModIds: string[];
}): RuntimeConfigPanelDerivedModel {
  const selectedConnector = input.state
    ? input.state.connectors.find((connector) => connector.id === input.state?.selectedConnectorId) || input.state.connectors[0] || null
    : null;

  const vendorOrderIndex = useMemo(
    () => new Map(VENDOR_ORDER_V11.map((vendor, index) => [vendor, index])),
    [],
  );

  const orderedConnectors = useMemo(
    () => selectOrderedConnectorsV11(input.state, vendorOrderIndex),
    [input.state, vendorOrderIndex],
  );

  const allLocalRuntimeModels = useMemo(() => selectAllLocalRuntimeModelsV11(input.state), [input.state]);

  const filteredLocalRuntimeModels = useMemo(
    () => selectFilteredLocalRuntimeModelsV11(allLocalRuntimeModels, input.localRuntimeModelQuery),
    [allLocalRuntimeModels, input.localRuntimeModelQuery],
  );

  const filteredConnectorModels = useMemo(
    () => selectFilteredConnectorModelsV11(selectedConnector, input.connectorModelQuery),
    [input.connectorModelQuery, selectedConnector],
  );

  const runtimeStatus: ProviderStatusV11 | null = input.state
    ? (input.state.localRuntime.status === 'healthy' ? 'healthy' : (selectedConnector?.status || input.state.localRuntime.status))
    : null;

  const runtimeDependencyTargets = useMemo(() => {
    const registeredOrder = new Map(input.registeredRuntimeModIds.map((modId, index) => [String(modId || '').trim(), index]));
    const targets: Array<{
      modId: string;
      modName: string;
      consumeCapabilities: CapabilityV11[];
    }> = [];
    for (const summary of input.localManifestSummaries) {
      const modId = String(summary.id || '').trim();
      if (!modId || !input.registeredRuntimeModIds.includes(modId)) continue;
      const manifest = asRecord(summary.manifest);
      const ai = asRecord(manifest.ai);
      const dependencies = asRecord(ai.dependencies);
      const hasDependencies = (
        Array.isArray(dependencies.required)
        || Array.isArray(dependencies.optional)
        || Array.isArray(dependencies.alternatives)
        || (
          dependencies.preferred
          && typeof dependencies.preferred === 'object'
          && !Array.isArray(dependencies.preferred)
          && Object.keys(dependencies.preferred as Record<string, unknown>).length > 0
        )
      );
      if (!hasDependencies) continue;
      const consumeCapabilities = Array.isArray(ai.consume)
        ? Array.from(new Set(
          ai.consume
            .map((item) => normalizeCapability(item))
            .filter((item): item is CapabilityV11 => Boolean(item)),
        ))
        : [];
      targets.push({
        modId,
        modName: String(summary.name || '').trim() || modId,
        consumeCapabilities: consumeCapabilities.length > 0 ? consumeCapabilities : ['chat'],
      });
    }
    targets.sort((left, right) => {
      const leftOrder = registeredOrder.get(left.modId) ?? Number.MAX_SAFE_INTEGER;
      const rightOrder = registeredOrder.get(right.modId) ?? Number.MAX_SAFE_INTEGER;
      const orderDelta = leftOrder - rightOrder;
      if (orderDelta !== 0) {
        return orderDelta;
      }
      const nameDelta = left.modName.localeCompare(right.modName);
      if (nameDelta !== 0) {
        return nameDelta;
      }
      return left.modId.localeCompare(right.modId);
    });
    return targets;
  }, [input.localManifestSummaries, input.registeredRuntimeModIds]);

  return {
    selectedConnector,
    orderedConnectors,
    filteredLocalRuntimeModels,
    filteredConnectorModels,
    runtimeDependencyTargets,
    runtimeStatus,
  };
}
