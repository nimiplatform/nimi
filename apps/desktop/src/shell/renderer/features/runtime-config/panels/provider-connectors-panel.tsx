import { inferVendorFromEndpoint, removeSelectedConnector, updateConnectorField, replaceConnectorsInState } from './provider-connectors/connector-actions';
import { ProviderConnectorsPanelView } from './provider-connectors/view';
import type { ProviderConnectorsPanelProps } from './provider-connectors/types';
import {
  sdkCreateConnector,
  sdkDeleteConnector,
  sdkUpdateConnector,
  sdkListConnectors,
  vendorToProvider,
} from '../domain/provider-connectors/connector-sdk-service';
import { VENDOR_CATALOGS_V11, catalogModelsV11 } from '../state/v11/types';

export function ProviderConnectorsPanel({
  stateModel,
  viewModel,
  commandModel,
}: ProviderConnectorsPanelProps) {
  const { selectedConnector, updateState } = stateModel;
  const selectedConnectorId = selectedConnector?.id || null;

  const refreshConnectorsFromSdk = async () => {
    try {
      const connectors = await sdkListConnectors();
      updateState((prev) => replaceConnectorsInState(prev, connectors));
    } catch { /* SDK unavailable — keep current state */ }
  };

  const onAddConnector = async () => {
    try {
      const vendor = 'openrouter';
      const catalog = VENDOR_CATALOGS_V11[vendor];
      await sdkCreateConnector({
        provider: vendorToProvider(vendor),
        endpoint: catalog.defaultEndpoint,
        label: `API Connector ${stateModel.state.connectors.length + 1}`,
        apiKey: '',
      });
      await refreshConnectorsFromSdk();
    } catch { /* connector create failed */ }
  };

  const onRemoveSelectedConnector = async () => {
    if (!selectedConnectorId) return;
    if (selectedConnector?.isSystemOwned) return;
    try {
      await sdkDeleteConnector(selectedConnectorId);
      await refreshConnectorsFromSdk();
    } catch {
      updateState((prev) => removeSelectedConnector(prev, selectedConnectorId));
    }
  };

  const onSelectConnector = (connectorId: string) => {
    updateState((prev) => ({ ...prev, selectedConnectorId: connectorId }));
  };

  const onChangeLocalRuntimeEndpoint = (endpoint: string) => {
    updateState((prev) => ({
      ...prev,
      localRuntime: {
        ...prev.localRuntime,
        endpoint,
      },
    }));
  };

  const onRenameSelectedConnector = (label: string) => {
    if (selectedConnector?.isSystemOwned) return;
    updateState((prev) => updateConnectorField(prev, selectedConnectorId, { label }));
    if (selectedConnectorId) {
      void sdkUpdateConnector({ connectorId: selectedConnectorId, label }).catch(() => {});
    }
  };

  const onChangeConnectorEndpoint = (endpoint: string) => {
    if (selectedConnector?.isSystemOwned) return;
    updateState((prev) => {
      const currentVendor = prev.connectors.find((c) => c.id === selectedConnectorId)?.vendor;
      const inferredVendor = inferVendorFromEndpoint(endpoint);
      if (inferredVendor && inferredVendor !== currentVendor) {
        return updateConnectorField(prev, selectedConnectorId, {
          vendor: inferredVendor,
          endpoint,
          models: catalogModelsV11(inferredVendor),
          provider: vendorToProvider(inferredVendor),
        });
      }
      return updateConnectorField(prev, selectedConnectorId, { endpoint });
    });
    if (selectedConnectorId) {
      void sdkUpdateConnector({ connectorId: selectedConnectorId, endpoint }).catch(() => {});
    }
  };

  const onChangeConnectorToken = async (secret: string) => {
    if (!selectedConnectorId) return;
    const normalizedSecret = String(secret || '').trim();
    if (!normalizedSecret) return;
    await sdkUpdateConnector({
      connectorId: selectedConnectorId,
      apiKey: normalizedSecret,
    });
    updateState((prev) => updateConnectorField(prev, selectedConnectorId, { hasCredential: true }));
    commandModel.onVaultChanged();
  };

  const onChangeConnectorVendor = (vendor: string) => {
    if (!selectedConnector || selectedConnector.isSystemOwned) return;
    const normalizedVendor = vendor as typeof selectedConnector.vendor;
    const catalog = VENDOR_CATALOGS_V11[normalizedVendor];
    if (!catalog) return;
    updateState((prev) => updateConnectorField(prev, selectedConnectorId, {
      vendor: normalizedVendor,
      endpoint: catalog.defaultEndpoint,
      models: catalogModelsV11(normalizedVendor),
      provider: vendorToProvider(normalizedVendor),
    }));
    if (selectedConnectorId) {
      void sdkUpdateConnector({
        connectorId: selectedConnectorId,
        endpoint: catalog.defaultEndpoint,
      }).catch(() => {});
    }
  };

  return (
    <ProviderConnectorsPanelView
      onAddConnector={() => void onAddConnector()}
      onRemoveSelectedConnector={() => void onRemoveSelectedConnector()}
      onSelectConnector={onSelectConnector}
      onChangeLocalRuntimeEndpoint={onChangeLocalRuntimeEndpoint}
      onRenameSelectedConnector={onRenameSelectedConnector}
      onChangeConnectorEndpoint={onChangeConnectorEndpoint}
      onChangeConnectorToken={onChangeConnectorToken}
      onChangeConnectorVendor={onChangeConnectorVendor}
      stateModel={stateModel}
      viewModel={viewModel}
      commandModel={commandModel}
    />
  );
}
