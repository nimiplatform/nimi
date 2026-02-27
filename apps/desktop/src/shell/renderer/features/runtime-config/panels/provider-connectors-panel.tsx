import { addConnector, inferVendorFromEndpoint, removeSelectedConnector, updateConnectorField } from './provider-connectors/connector-actions';
import { ProviderConnectorsPanelView } from './provider-connectors/view';
import type { ProviderConnectorsPanelProps } from './provider-connectors/types';
import { applyProviderConnectorRoutePatch } from '../domain/provider-connectors/route-patch';
import { TauriCredentialVault, createCredential } from '@runtime/llm-adapter/credential-vault.js';

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

  const onRemoveSelectedConnector = async () => {
    if (selectedConnectorId) {
      const vault = new TauriCredentialVault();
      try {
        await vault.deleteCredentialEntry(selectedConnectorId);
        await vault.deleteCredentialSecret(selectedConnectorId);
      } catch { /* vault cleanup best-effort */ }
      commandModel.onVaultChanged();
    }
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

  const onChangeConnectorToken = async (secret: string) => {
    if (!selectedConnectorId) return;
    const vault = new TauriCredentialVault();
    await createCredential(vault, {
      provider: 'OPENAI_COMPATIBLE',
      refId: selectedConnectorId,
      label: `connector:${selectedConnectorId}`,
      secret,
    });
    commandModel.onVaultChanged();
  };

  const onChangeConnectorTokenEnv = (tokenApiKeyEnv: string) => {
    updateState((prev) => updateConnectorField(prev, selectedConnectorId, { tokenApiKeyEnv }));
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
      onChangeConnectorTokenEnv={onChangeConnectorTokenEnv}
      onChangeConnectorVendor={onChangeConnectorVendor}
      stateModel={stateModel}
      viewModel={viewModel}
      commandModel={commandModel}
    />
  );
}
