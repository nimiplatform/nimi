import {
  dedupeStringsV11,
  type ApiConnector,
  type RuntimeConfigStateV11,
} from './runtime-config-state-types';

export function selectOrderedConnectorsV11(
  state: RuntimeConfigStateV11 | null,
  vendorOrderIndex: Map<string, number>,
): ApiConnector[] {
  if (!state) return [];
  return [...state.connectors].sort((left, right) => {
    const leftRank = vendorOrderIndex.get(left.vendor) ?? Number.MAX_SAFE_INTEGER;
    const rightRank = vendorOrderIndex.get(right.vendor) ?? Number.MAX_SAFE_INTEGER;
    if (leftRank !== rightRank) return leftRank - rightRank;
    return String(left.label || '').localeCompare(String(right.label || ''));
  });
}

export function selectAllLocalModelsV11(state: RuntimeConfigStateV11 | null): string[] {
  return dedupeStringsV11([...(state?.local.models || []).map((item) => item.model)]);
}

export function selectFilteredLocalModelsV11(models: string[], queryInput: string): string[] {
  const query = queryInput.trim().toLowerCase();
  if (!query) return models;
  return models.filter((model) => model.toLowerCase().includes(query));
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
