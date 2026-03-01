import {
  createConnectorV11,
  VENDOR_CATALOGS_V11,
  type ApiVendor,
  type RuntimeConfigStateV11,
} from '@renderer/features/runtime-config/state/v11/types';

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

export function addConnector(prev: RuntimeConfigStateV11): RuntimeConfigStateV11 {
  const connector = createConnectorV11('openrouter', `API Connector ${prev.connectors.length + 1}`);
  return {
    ...prev,
    connectors: [...prev.connectors, connector],
    selectedConnectorId: connector.id,
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
