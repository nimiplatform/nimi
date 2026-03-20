// Route types for relay model selection
// Compatible with ChatRouteSnapshot used by send-flow

export type RelayRouteSource = 'local' | 'cloud';

export type RelayRouteBinding = {
  source: RelayRouteSource;
  model?: string;
  connectorId?: string;
  localModelId?: string;
};

export type ResolvedRelayRoute = {
  source: RelayRouteSource;
  model: string;
  connectorId?: string;
  localModelId?: string;
  provider?: string;
};

export type RelayLocalModelOption = {
  localModelId: string;
  modelId: string;
  engine: string;
  status: 'active' | 'installed' | 'unhealthy' | 'removed' | 'unspecified';
  capabilities: string[];
};

export type RelayConnectorModelOption = {
  modelId: string;
  modelLabel: string;
  available: boolean;
  capabilities: string[];
};

export type RelayConnectorOption = {
  connectorId: string;
  provider: string;
  label: string;
  status: string;
  modelsStatus: 'ready' | 'unavailable';
  modelsError?: string;
  models: RelayConnectorModelOption[];
};

export type RelayRouteLoadIssue = {
  scope: 'local-models' | 'connectors' | 'connector-models';
  kind: 'timeout' | 'runtime-error';
  message: string;
  connectorId?: string;
  capability?: string;
};

export type RelayRouteOptions = {
  local: {
    models: RelayLocalModelOption[];
    status: 'ready' | 'unavailable';
    error?: string;
  };
  connectors: RelayConnectorOption[];
  selected: RelayRouteBinding | null;
  loadStatus: 'ready' | 'degraded' | 'failed';
  issues: RelayRouteLoadIssue[];
};
