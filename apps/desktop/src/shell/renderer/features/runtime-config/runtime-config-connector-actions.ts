import {
  type ApiConnector,
  type RuntimeConfigStateV11,
} from './runtime-config-state-types';

export function addConnectorToState(
  prev: RuntimeConfigStateV11,
  connector: ApiConnector,
): RuntimeConfigStateV11 {
  return {
    ...prev,
    connectors: [...prev.connectors, connector],
    selectedConnectorId: connector.id,
  };
}

export function replaceConnectorsInState(
  prev: RuntimeConfigStateV11,
  connectors: ApiConnector[],
): RuntimeConfigStateV11 {
  const previousSelectedId = prev.selectedConnectorId;
  const selectedStillExists = connectors.some((c) => c.id === previousSelectedId);
  const previousById = new Map(prev.connectors.map((connector) => [connector.id, connector]));
  return {
    ...prev,
    connectors: connectors.map((connector) => {
      const previous = previousById.get(connector.id);
      // Inventory refreshes contain configuration, not connection-check results.
      // Keep the last observed result across navigation for the same connection;
      // changed settings and explicit save results must still require a new check.
      if (!previous?.lastCheckedAt || connector.lastCheckedAt
        || connector.status !== 'idle'
        || previous.provider !== connector.provider
        || previous.endpoint !== connector.endpoint
        || previous.authMode !== connector.authMode
        || previous.providerAuthProfile !== connector.providerAuthProfile
        || previous.accountLabel !== connector.accountLabel
        || previous.scope !== connector.scope
        || previous.hasCredential !== connector.hasCredential
        || previous.isDraft !== connector.isDraft) {
        return connector;
      }
      return {
        ...connector,
        status: previous.status,
        lastCheckedAt: previous.lastCheckedAt,
        lastDetail: previous.lastDetail,
        models: previous.models,
        modelCapabilities: previous.modelCapabilities,
      };
    }),
    selectedConnectorId: selectedStillExists
      ? previousSelectedId
      : (connectors[0]?.id || ''),
  };
}

export function removeSelectedConnector(
  prev: RuntimeConfigStateV11,
  selectedConnectorId: string | null,
): RuntimeConfigStateV11 {
  if (!selectedConnectorId) return prev;
  const remaining = prev.connectors.filter((connector) => connector.id !== selectedConnectorId);
  if (remaining.length === 0) {
    return {
      ...prev,
      connectors: [],
      selectedConnectorId: '',
    };
  }
  const fallback = remaining[0];
  if (!fallback) return prev;
  return {
    ...prev,
    connectors: remaining,
    selectedConnectorId: fallback.id,
  };
}

export function removeConnectorFromState(
  prev: RuntimeConfigStateV11,
  connectorId: string | null,
): RuntimeConfigStateV11 {
  if (!connectorId) return prev;
  if (prev.selectedConnectorId === connectorId) {
    return removeSelectedConnector(prev, connectorId);
  }
  return {
    ...prev,
    connectors: prev.connectors.filter((connector) => connector.id !== connectorId),
  };
}

export function updateConnectorField(
  prev: RuntimeConfigStateV11,
  connectorId: string | null,
  patch: Partial<RuntimeConfigStateV11['connectors'][number]>,
): RuntimeConfigStateV11 {
  if (!connectorId) return prev;
  return {
    ...prev,
    connectors: prev.connectors.map((connector) => (
      connector.id === connectorId ? { ...connector, ...patch } : connector
    )),
  };
}
