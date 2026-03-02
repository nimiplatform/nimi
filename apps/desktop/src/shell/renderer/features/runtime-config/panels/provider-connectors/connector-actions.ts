import {
  VENDOR_CATALOGS_V11,
  type ApiVendor,
  type ApiConnector,
  type RuntimeConfigStateV11,
} from '@renderer/features/runtime-config/state/types';

export function inferVendorFromEndpoint(endpoint: string): ApiVendor | null {
  const normalized = String(endpoint || '').trim().toLowerCase().replace(/\/+$/, '');
  if (!normalized) return null;
  const entries = Object.entries(VENDOR_CATALOGS_V11) as Array<[ApiVendor, { defaultEndpoint: string }]>;
  for (const [vendor, catalog] of entries) {
    const catalogEndpoint = catalog.defaultEndpoint.toLowerCase().replace(/\/+$/, '');
    if (normalized === catalogEndpoint || normalized.startsWith(catalogEndpoint)) {
      return vendor;
    }
  }
  const hostPatterns: Array<[string, ApiVendor]> = [
    ['api.deepseek.com', 'deepseek'],
    ['api.openai.com', 'gpt'],
    ['api.anthropic.com', 'claude'],
    ['generativelanguage.googleapis.com', 'gemini'],
    ['api.moonshot.cn', 'kimi'],
    ['volces.com', 'volcengine'],
    ['openrouter.ai', 'openrouter'],
  ];
  for (const [host, vendor] of hostPatterns) {
    if (normalized.includes(host)) return vendor;
  }
  return null;
}

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
  return {
    ...prev,
    connectors,
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
