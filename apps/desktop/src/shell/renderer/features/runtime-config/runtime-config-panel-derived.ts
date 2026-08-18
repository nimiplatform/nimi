import { useMemo } from 'react';
import {
  type RuntimeConfigStatusV11,
  type RuntimeConfigStateV11,
} from './runtime-config-state-types';
import {
  selectFilteredConnectorModelsV11,
  selectOrderedConnectorsV11,
} from './runtime-config-selectors-v11';

export type RuntimeConfigPanelDerivedModel = {
  selectedConnector: RuntimeConfigStateV11['connectors'][number] | null;
  orderedConnectors: RuntimeConfigStateV11['connectors'];
  filteredConnectorModels: string[];
  runtimeStatus: RuntimeConfigStatusV11 | null;
};

export function useRuntimeConfigPanelDerived(input: {
  state: RuntimeConfigStateV11 | null;
  connectorModelQuery: string;
}): RuntimeConfigPanelDerivedModel {
  const selectedConnector = input.state
    ? input.state.connectors.find((connector) => connector.id === input.state?.selectedConnectorId) || input.state.connectors[0] || null
    : null;

  const orderedConnectors = useMemo(
    () => selectOrderedConnectorsV11(input.state),
    [input.state],
  );

  const filteredConnectorModels = useMemo(
    () => selectFilteredConnectorModelsV11(selectedConnector, input.connectorModelQuery),
    [input.connectorModelQuery, selectedConnector],
  );

  const runtimeStatus: RuntimeConfigStatusV11 | null = input.state
    ? (input.state.local.status === 'healthy' ? 'healthy' : (selectedConnector?.status || input.state.local.status))
    : null;

  return {
    selectedConnector,
    orderedConnectors,
    filteredConnectorModels,
    runtimeStatus,
  };
}
