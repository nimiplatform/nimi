import {
  VENDOR_CATALOGS_V11,
  catalogModelsV11,
  normalizeConnectorModelsV11,
  normalizeVendorV11,
  type RuntimeConfigStateV11,
} from '@renderer/features/runtime-config/state/v11/types';

export function applyProviderConnectorRoutePatch(
  prev: RuntimeConfigStateV11,
  connectorId: string | null,
  vendorInput: string,
): RuntimeConfigStateV11 {
  if (!connectorId) return prev;
  const vendor = normalizeVendorV11(vendorInput);
  const catalog = VENDOR_CATALOGS_V11[vendor];
  const nextModels = catalogModelsV11(vendor);

  return {
    ...prev,
    connectors: prev.connectors.map((connector) => (
      connector.id === connectorId
        ? {
            ...connector,
            vendor,
            endpoint: catalog.defaultEndpoint,
            models: normalizeConnectorModelsV11(vendor, nextModels),
            catalogVersion: catalog.version,
            catalogUpdatedAt: catalog.updatedAt,
          }
        : connector
    )),
  };
}
