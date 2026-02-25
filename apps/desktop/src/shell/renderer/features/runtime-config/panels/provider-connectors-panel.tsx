import { addConnector, inferVendorFromEndpoint, removeSelectedConnector, updateConnectorField } from './provider-connectors/connector-actions';
import { ProviderConnectorsPanelView } from './provider-connectors/view';
import type { ProviderConnectorsPanelProps } from './provider-connectors/types';
import { applyProviderConnectorRoutePatch } from '../domain/provider-connectors/route-patch';

export function ProviderConnectorsPanel({
  stateModel,
  viewModel,
  commandModel,
}: ProviderConnectorsPanelProps) {
  const { selectedConnector, updateState } = stateModel;
  const selectedConnectorId = selectedConnector?.id || null;

  const onAddConnector = () => {
    updateState((prev) => addConnector(prev));
  };

  const onRemoveSelectedConnector = () => {
    updateState((prev) => removeSelectedConnector(prev, selectedConnectorId));
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
    updateState((prev) => updateConnectorField(prev, selectedConnectorId, { label }));
  };

  const onChangeConnectorEndpoint = (endpoint: string) => {
    updateState((prev) => {
      const currentVendor = prev.connectors.find((c) => c.id === selectedConnectorId)?.vendor;
      const inferredVendor = inferVendorFromEndpoint(endpoint);
      if (inferredVendor && inferredVendor !== currentVendor) {
        const patched = applyProviderConnectorRoutePatch(prev, selectedConnectorId, inferredVendor);
        return updateConnectorField(patched, selectedConnectorId, { endpoint });
      }
      return updateConnectorField(prev, selectedConnectorId, { endpoint });
    });
  };

  const onChangeConnectorToken = (tokenApiKey: string) => {
    updateState((prev) => updateConnectorField(prev, selectedConnectorId, { tokenApiKey }));
  };

  const onChangeConnectorVendor = (vendor: string) => {
    updateState((prev) => applyProviderConnectorRoutePatch(prev, selectedConnectorId, vendor));
  };

  return (
    <ProviderConnectorsPanelView
      onAddConnector={onAddConnector}
      onRemoveSelectedConnector={onRemoveSelectedConnector}
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
