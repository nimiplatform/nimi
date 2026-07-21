import { useMemo } from 'react';
import { normalizeNimiRuntimeLocalProfilesDeclaration } from '@nimiplatform/sdk/runtime';
import {
  type CapabilityV11,
  type ProviderStatusV11,
  type RuntimeConfigStateV11,
} from './runtime-config-state-types';
import {
  selectAllLocalModelsV11,
  selectFilteredConnectorModelsV11,
  selectFilteredLocalModelsV11,
  selectOrderedConnectorsV11,
} from './runtime-config-selectors-v11';

export type RuntimeConfigPanelDerivedModel = {
  selectedConnector: RuntimeConfigStateV11['connectors'][number] | null;
  orderedConnectors: RuntimeConfigStateV11['connectors'];
  filteredLocalModels: string[];
  filteredConnectorModels: string[];
  runtimeProfileTargets: Array<{
    targetId: string;
    targetName: string;
    consumeCapabilities: CapabilityV11[];
    profiles: ReturnType<typeof normalizeNimiRuntimeLocalProfilesDeclaration>;
  }>;
  runtimeStatus: ProviderStatusV11 | null;
};

export function useRuntimeConfigPanelDerived(input: {
  state: RuntimeConfigStateV11 | null;
  localModelQuery: string;
  connectorModelQuery: string;
}): RuntimeConfigPanelDerivedModel {
  const selectedConnector = input.state
    ? input.state.connectors.find((connector) => connector.id === input.state?.selectedConnectorId) || input.state.connectors[0] || null
    : null;

  const orderedConnectors = useMemo(
    () => selectOrderedConnectorsV11(input.state),
    [input.state],
  );

  const allLocalModels = useMemo(() => selectAllLocalModelsV11(input.state), [input.state]);

  const filteredLocalModels = useMemo(
    () => selectFilteredLocalModelsV11(allLocalModels, input.localModelQuery),
    [allLocalModels, input.localModelQuery],
  );

  const filteredConnectorModels = useMemo(
    () => selectFilteredConnectorModelsV11(selectedConnector, input.connectorModelQuery),
    [input.connectorModelQuery, selectedConnector],
  );

  const runtimeStatus: ProviderStatusV11 | null = input.state
    ? (input.state.local.status === 'healthy' ? 'healthy' : (selectedConnector?.status || input.state.local.status))
    : null;

  const runtimeProfileTargets = useMemo<Array<{
    targetId: string;
    targetName: string;
    consumeCapabilities: CapabilityV11[];
    profiles: ReturnType<typeof normalizeNimiRuntimeLocalProfilesDeclaration>;
  }>>(() => [], []);

  return {
    selectedConnector,
    orderedConnectors,
    filteredLocalModels,
    filteredConnectorModels,
    runtimeProfileTargets,
    runtimeStatus,
  };
}
