import {
  dedupeStringsV11,
  type ApiConnector,
  type RuntimeConfigStateV11,
} from './runtime-config-state-types';

export function selectOrderedConnectorsV11(
  state: RuntimeConfigStateV11 | null,
): ApiConnector[] {
  if (!state) return [];
  return [...state.connectors].sort((left, right) => {
    const labelOrder = String(left.label || '').localeCompare(String(right.label || ''));
    if (labelOrder !== 0) return labelOrder;
    return String(left.vendor || '').localeCompare(String(right.vendor || ''));
  });
}

export function selectFilteredConnectorModelsV11(
  connector: ApiConnector | null,
  queryInput: string,
): string[] {
  const models = dedupeStringsV11(connector?.models || []);
  const query = queryInput.trim().toLowerCase();
  if (!query) return models;
  return models.filter((model) => model.toLowerCase().includes(query));
}
