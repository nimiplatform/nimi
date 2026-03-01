import { inferVendorFromEndpoint, addConnectorToState, removeSelectedConnector, updateConnectorField, replaceConnectorsInState } from './provider-connectors/connector-actions';
import { ProviderConnectorsPanelView } from './provider-connectors/view';
import type { ProviderConnectorsPanelProps } from './provider-connectors/types';
import {
  sdkCreateConnector,
  sdkDeleteConnector,
  sdkUpdateConnector,
  sdkListConnectors,
  sdkListProviderCatalog,
  resolveProviderEndpoint,
  vendorToProvider,
} from '../domain/provider-connectors/connector-sdk-service';
import { VENDOR_CATALOGS_V11, catalogModelsV11, randomIdV11, type ApiVendor } from '../state/v11/types';
import { logRendererEvent } from '@renderer/infra/telemetry/renderer-log';

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
      updateState((prev) => {
        const drafts = prev.connectors.filter((c) => c.isDraft);
        return replaceConnectorsInState(prev, [...connectors, ...drafts]);
      });
    } catch { /* SDK unavailable — keep current state */ }
  };

  const onAddConnector = async () => {
    const vendor: ApiVendor = 'openrouter';
    const provider = vendorToProvider(vendor);
    const runtimeCatalog = await sdkListProviderCatalog().catch(() => []);
    const endpoint = resolveProviderEndpoint(provider, runtimeCatalog)
      || VENDOR_CATALOGS_V11[vendor].defaultEndpoint;
    const draft = {
      id: randomIdV11('draft'),
      label: `API Connector ${stateModel.state.connectors.length + 1}`,
      vendor,
      provider,
      endpoint,
      hasCredential: false,
      isSystemOwned: false,
      models: catalogModelsV11(vendor),
      status: 'idle' as const,
      lastCheckedAt: null,
      lastDetail: '',
      isDraft: true,
    };
    updateState((prev) => addConnectorToState(prev, draft));
  };

  const onRemoveSelectedConnector = async () => {
    if (!selectedConnectorId) return;
    if (selectedConnector?.isSystemOwned) return;
    if (selectedConnector?.isDraft) {
      updateState((prev) => removeSelectedConnector(prev, selectedConnectorId));
      return;
    }
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
    if (selectedConnectorId && !selectedConnector?.isDraft) {
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
    if (selectedConnectorId && !selectedConnector?.isDraft) {
      void sdkUpdateConnector({ connectorId: selectedConnectorId, endpoint }).catch(() => {});
    }
  };

  const onChangeConnectorToken = async (secret: string) => {
    if (!selectedConnectorId || !selectedConnector) return;
    const normalizedSecret = String(secret || '').trim();
    if (!normalizedSecret) return;

    if (selectedConnector.isDraft) {
      const created = await sdkCreateConnector({
        provider: selectedConnector.provider,
        endpoint: selectedConnector.endpoint,
        label: selectedConnector.label,
        apiKey: normalizedSecret,
      });
      if (created) {
        updateState((prev) => {
          const withoutDraft = prev.connectors.filter((c) => c.id !== selectedConnectorId);
          return {
            ...prev,
            connectors: [...withoutDraft, created],
            selectedConnectorId: created.id,
          };
        });
      }
      commandModel.onVaultChanged();
      return;
    }

    await sdkUpdateConnector({
      connectorId: selectedConnectorId,
      apiKey: normalizedSecret,
    });
    updateState((prev) => updateConnectorField(prev, selectedConnectorId, { hasCredential: true }));
    commandModel.onVaultChanged();
  };

  const onChangeConnectorVendor = async (vendor: string) => {
    if (!selectedConnector || selectedConnector.isSystemOwned) return;
    const normalizedVendor = vendor as typeof selectedConnector.vendor;
    const catalog = VENDOR_CATALOGS_V11[normalizedVendor];
    if (!catalog) return;
    const provider = vendorToProvider(normalizedVendor);
    const runtimeCatalog = await sdkListProviderCatalog().catch(() => []);
    const endpoint = resolveProviderEndpoint(provider, runtimeCatalog)
      || catalog.defaultEndpoint;
    updateState((prev) => updateConnectorField(prev, selectedConnectorId, {
      vendor: normalizedVendor,
      endpoint,
      models: catalogModelsV11(normalizedVendor),
      provider,
    }));
    if (selectedConnectorId && !selectedConnector.isDraft) {
      void sdkUpdateConnector({
        connectorId: selectedConnectorId,
        endpoint,
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
