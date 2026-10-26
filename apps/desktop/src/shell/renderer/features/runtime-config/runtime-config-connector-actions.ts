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
  };
}

export function replaceConnectorsInState(
  prev: RuntimeConfigStateV11,
  connectors: ApiConnector[],
): RuntimeConfigStateV11 {
  // Runtime owns persisted observations and their invalidation. An absent
  // result must never revive an older renderer-local check after token changes.
  return {
    ...prev,
    connectors,
  };
}

export function removeConnectorFromState(prev: RuntimeConfigStateV11, connectorId: string | null): RuntimeConfigStateV11 {
  if (!connectorId) return prev;
  return { ...prev, connectors: prev.connectors.filter(connector => connector.id !== connectorId) };
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
