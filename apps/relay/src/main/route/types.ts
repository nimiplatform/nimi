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
  models: RelayConnectorModelOption[];
};

export type RelayRouteOptions = {
  local: { models: RelayLocalModelOption[] };
  connectors: RelayConnectorOption[];
  selected: RelayRouteBinding | null;
};
