import type { RelayMediaRouteOptionsResponse } from '../../../shared/ipc-contract.js';

type ConnectorOption = RelayMediaRouteOptionsResponse['connectors'][number];

function normalize(value: string | undefined | null): string {
  return String(value || '').trim();
}

export type MediaRouteDisplayState = {
  activeConnectorId: string;
  selectedConnector: ConnectorOption | null;
  models: ConnectorOption['models'];
  displayModel: string;
  invalidConnector: boolean;
  invalidModel: boolean;
};

export function deriveMediaRouteDisplayState(
  connectors: ConnectorOption[],
  connectorId: string,
  model: string,
): MediaRouteDisplayState {
  const normalizedConnectorId = normalize(connectorId);
  const normalizedModel = normalize(model);
  const selectedConnector = connectors.find((item) => item.connectorId === normalizedConnectorId) || null;
  const models = selectedConnector?.models || [];
  const invalidConnector = Boolean(normalizedConnectorId && !selectedConnector);
  const invalidModel = Boolean(
    selectedConnector
      && normalizedModel
      && !models.some((item) => item.modelId === normalizedModel),
  );

  return {
    activeConnectorId: selectedConnector?.connectorId || '',
    selectedConnector,
    models,
    displayModel: normalizedModel,
    invalidConnector,
    invalidModel,
  };
}
