import { inferVendorFromEndpoint, addConnectorToState, removeSelectedConnector, updateConnectorField, replaceConnectorsInState } from './provider-connectors/connector-actions';
import { ProviderConnectorsPanelView } from './provider-connectors/view';
import type { ProviderConnectorsPanelProps } from './provider-connectors/types';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import {
  sdkCreateConnector,
  sdkDeleteConnector,
  sdkUpdateConnector,
  sdkListConnectors,
  sdkListProviderCatalog,
  resolveProviderEndpoint,
  vendorToProvider,
} from '../domain/provider-connectors/connector-sdk-service';
import { VENDOR_CATALOGS_V11, randomIdV11, type ApiVendor } from '../state/types';
import { formatRuntimeConfigErrorBanner } from '../domain/provider-connectors/error';

export function ProviderConnectorsPanel({
  stateModel,
  viewModel,
  commandModel,
}: ProviderConnectorsPanelProps) {
  const { selectedConnector, updateState } = stateModel;
  const selectedConnectorId = selectedConnector?.id || null;
  const setStatusBanner = useAppStore((state) => state.setStatusBanner);

  const reportError = (label: string, error: unknown) => {
    setStatusBanner({
      kind: 'error',
      message: formatRuntimeConfigErrorBanner(label, error),
    });
  };

  const refreshConnectorsFromSdk = async () => {
    const connectors = await sdkListConnectors();
    updateState((prev) => {
      const drafts = prev.connectors.filter((c) => c.isDraft);
      return replaceConnectorsInState(prev, [...connectors, ...drafts]);
    });
  };

  const onAddConnector = async () => {
    const vendor: ApiVendor = 'openrouter';
    const provider = vendorToProvider(vendor);
    const runtimeCatalog = await sdkListProviderCatalog();
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
      models: [],
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
    await sdkDeleteConnector(selectedConnectorId);
    await refreshConnectorsFromSdk();
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
    const previousLabel = String(selectedConnector?.label || '');
    updateState((prev) => updateConnectorField(prev, selectedConnectorId, { label }));
    if (selectedConnectorId && !selectedConnector?.isDraft) {
      void (async () => {
        try {
          await sdkUpdateConnector({ connectorId: selectedConnectorId, label });
        } catch (error) {
          updateState((prev) => updateConnectorField(prev, selectedConnectorId, { label: previousLabel }));
          reportError('Update connector failed', error);
        }
      })();
    }
  };

  const onChangeConnectorEndpoint = (endpoint: string) => {
    if (!selectedConnector || selectedConnector.isSystemOwned) return;
    const previousConnector = selectedConnector;
    updateState((prev) => {
      const currentVendor = prev.connectors.find((c) => c.id === selectedConnectorId)?.vendor;
      const inferredVendor = inferVendorFromEndpoint(endpoint);
      if (inferredVendor && inferredVendor !== currentVendor) {
        return updateConnectorField(prev, selectedConnectorId, {
          vendor: inferredVendor,
          endpoint,
          models: [],
          provider: vendorToProvider(inferredVendor),
        });
      }
      return updateConnectorField(prev, selectedConnectorId, { endpoint });
    });
    if (selectedConnectorId && !selectedConnector?.isDraft) {
      void (async () => {
        try {
          await sdkUpdateConnector({ connectorId: selectedConnectorId, endpoint });
        } catch (error) {
          updateState((prev) => updateConnectorField(prev, selectedConnectorId, {
            vendor: previousConnector.vendor,
            endpoint: previousConnector.endpoint,
            models: previousConnector.models,
            provider: previousConnector.provider,
          }));
          reportError('Update connector failed', error);
        }
      })();
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
      if (!created) {
        throw new Error('create connector returned empty payload');
      }
      updateState((prev) => {
        const withoutDraft = prev.connectors.filter((c) => c.id !== selectedConnectorId);
        return {
          ...prev,
          connectors: [...withoutDraft, created],
          selectedConnectorId: created.id,
        };
      });
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
    const previousConnector = selectedConnector;
    const normalizedVendor = vendor as typeof selectedConnector.vendor;
    const catalog = VENDOR_CATALOGS_V11[normalizedVendor];
    if (!catalog) return;
    const provider = vendorToProvider(normalizedVendor);
    const runtimeCatalog = await sdkListProviderCatalog();
    const endpoint = resolveProviderEndpoint(provider, runtimeCatalog)
      || catalog.defaultEndpoint;
    updateState((prev) => updateConnectorField(prev, selectedConnectorId, {
      vendor: normalizedVendor,
      endpoint,
      models: [],
      provider,
    }));
    if (selectedConnectorId && !selectedConnector.isDraft) {
      try {
        await sdkUpdateConnector({
          connectorId: selectedConnectorId,
          endpoint,
        });
      } catch (error) {
        updateState((prev) => updateConnectorField(prev, selectedConnectorId, {
          vendor: previousConnector.vendor,
          endpoint: previousConnector.endpoint,
          models: previousConnector.models,
          provider: previousConnector.provider,
        }));
        throw error;
      }
    }
  };

  return (
    <ProviderConnectorsPanelView
      onAddConnector={() => {
        void onAddConnector().catch((error) => {
          reportError('Add connector failed', error);
        });
      }}
      onRemoveSelectedConnector={() => {
        void onRemoveSelectedConnector().catch((error) => {
          reportError('Remove connector failed', error);
        });
      }}
      onSelectConnector={onSelectConnector}
      onChangeLocalRuntimeEndpoint={onChangeLocalRuntimeEndpoint}
      onRenameSelectedConnector={onRenameSelectedConnector}
      onChangeConnectorEndpoint={onChangeConnectorEndpoint}
      onChangeConnectorToken={async (secret) => {
        try {
          await onChangeConnectorToken(secret);
        } catch (error) {
          reportError('Update connector token failed', error);
        }
      }}
      onChangeConnectorVendor={(vendor) => {
        void onChangeConnectorVendor(vendor).catch((error) => {
          reportError('Switch connector vendor failed', error);
        });
      }}
      stateModel={stateModel}
      viewModel={viewModel}
      commandModel={commandModel}
    />
  );
}
