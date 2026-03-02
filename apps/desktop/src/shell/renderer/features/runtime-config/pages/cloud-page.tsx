import { useCallback, useEffect, useMemo, useState } from 'react';
import type { RuntimeConfigStateV11 } from '@renderer/features/runtime-config/state/types';
import {
  DEFAULT_OPENAI_ENDPOINT_V11,
  VENDOR_CATALOGS_V11,
  VENDOR_ORDER_V11,
  randomIdV11,
  type ApiVendor,
} from '@renderer/features/runtime-config/state/types';
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
import {
  inferVendorFromEndpoint,
  addConnectorToState,
  removeSelectedConnector,
  updateConnectorField,
  replaceConnectorsInState,
} from '../panels/provider-connectors/connector-actions';
import { formatRuntimeConfigErrorBanner } from '../domain/provider-connectors/error';
import type { RuntimeConfigPanelControllerModel } from '../runtime-config-panel-types';
import { Button, Card, Input, StatusBadge, renderModelChips } from '../panels/primitives';

type CloudPageProps = {
  model: RuntimeConfigPanelControllerModel;
  state: RuntimeConfigStateV11;
};

export function CloudPage({ model, state }: CloudPageProps) {
  const { selectedConnector, orderedConnectors, updateState } = model;
  const setStatusBanner = useAppStore((s) => s.setStatusBanner);

  const [tokenDraft, setTokenDraft] = useState('');
  const [savingToken, setSavingToken] = useState(false);
  const [tokenSaveError, setTokenSaveError] = useState('');
  const [tokenSavedConnectorId, setTokenSavedConnectorId] = useState('');

  const selectedConnectorId = selectedConnector?.id || '';
  const isSystemOwned = selectedConnector?.isSystemOwned || false;
  const isDraft = selectedConnector?.isDraft || false;

  useEffect(() => {
    setTokenDraft('');
    setTokenSaveError('');
  }, [selectedConnectorId]);

  const canSaveToken = useMemo(
    () => Boolean(selectedConnectorId) && tokenDraft.trim().length > 0 && !savingToken,
    [savingToken, tokenDraft, selectedConnectorId],
  );

  const reportError = useCallback((label: string, error: unknown) => {
    setStatusBanner({
      kind: 'error',
      message: formatRuntimeConfigErrorBanner(label, error),
    });
  }, [setStatusBanner]);

  const refreshConnectorsFromSdk = useCallback(async () => {
    const connectors = await sdkListConnectors();
    updateState((prev) => {
      const drafts = prev.connectors.filter((c) => c.isDraft);
      return replaceConnectorsInState(prev, [...connectors, ...drafts]);
    });
  }, [updateState]);

  const onAddConnector = useCallback(async () => {
    const vendor: ApiVendor = 'openrouter';
    const provider = vendorToProvider(vendor);
    const runtimeCatalog = await sdkListProviderCatalog();
    const endpoint = resolveProviderEndpoint(provider, runtimeCatalog)
      || VENDOR_CATALOGS_V11[vendor].defaultEndpoint;
    const draft = {
      id: randomIdV11('draft'),
      label: `API Connector ${state.connectors.length + 1}`,
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
  }, [state.connectors.length, updateState]);

  const onRemoveSelectedConnector = useCallback(async () => {
    if (!selectedConnectorId) return;
    if (selectedConnector?.isSystemOwned) return;
    if (selectedConnector?.isDraft) {
      updateState((prev) => removeSelectedConnector(prev, selectedConnectorId));
      return;
    }
    await sdkDeleteConnector(selectedConnectorId);
    await refreshConnectorsFromSdk();
  }, [selectedConnectorId, selectedConnector, updateState, refreshConnectorsFromSdk]);

  const onSelectConnector = useCallback((connectorId: string) => {
    updateState((prev) => ({ ...prev, selectedConnectorId: connectorId }));
  }, [updateState]);

  const onRenameSelectedConnector = useCallback((label: string) => {
    if (selectedConnector?.isSystemOwned) return;
    const previousLabel = String(selectedConnector?.label || '');
    updateState((prev) => updateConnectorField(prev, selectedConnectorId, { label }));
    if (selectedConnectorId && !selectedConnector?.isDraft) {
      void (async () => {
        try { await sdkUpdateConnector({ connectorId: selectedConnectorId, label }); }
        catch (error) {
          updateState((prev) => updateConnectorField(prev, selectedConnectorId, { label: previousLabel }));
          reportError('Update connector failed', error);
        }
      })();
    }
  }, [selectedConnector, selectedConnectorId, updateState, reportError]);

  const onChangeConnectorEndpoint = useCallback((endpoint: string) => {
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
        try { await sdkUpdateConnector({ connectorId: selectedConnectorId, endpoint }); }
        catch (error) {
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
  }, [selectedConnector, selectedConnectorId, updateState, reportError]);

  const onChangeConnectorToken = useCallback(async (secret: string) => {
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
      if (!created) throw new Error('create connector returned empty payload');
      updateState((prev) => {
        const withoutDraft = prev.connectors.filter((c) => c.id !== selectedConnectorId);
        return { ...prev, connectors: [...withoutDraft, created], selectedConnectorId: created.id };
      });
      model.onVaultChanged();
      return;
    }

    await sdkUpdateConnector({ connectorId: selectedConnectorId, apiKey: normalizedSecret });
    updateState((prev) => updateConnectorField(prev, selectedConnectorId, { hasCredential: true }));
    model.onVaultChanged();
  }, [selectedConnectorId, selectedConnector, updateState, model]);

  const onChangeConnectorVendor = useCallback(async (vendor: string) => {
    if (!selectedConnector || selectedConnector.isSystemOwned) return;
    const previousConnector = selectedConnector;
    const normalizedVendor = vendor as typeof selectedConnector.vendor;
    const catalog = VENDOR_CATALOGS_V11[normalizedVendor];
    if (!catalog) return;
    const provider = vendorToProvider(normalizedVendor);
    const runtimeCatalog = await sdkListProviderCatalog();
    const endpoint = resolveProviderEndpoint(provider, runtimeCatalog) || catalog.defaultEndpoint;
    updateState((prev) => updateConnectorField(prev, selectedConnectorId, {
      vendor: normalizedVendor, endpoint, models: [], provider,
    }));
    if (selectedConnectorId && !selectedConnector.isDraft) {
      try { await sdkUpdateConnector({ connectorId: selectedConnectorId, endpoint }); }
      catch (error) {
        updateState((prev) => updateConnectorField(prev, selectedConnectorId, {
          vendor: previousConnector.vendor,
          endpoint: previousConnector.endpoint,
          models: previousConnector.models,
          provider: previousConnector.provider,
        }));
        throw error;
      }
    }
  }, [selectedConnector, selectedConnectorId, updateState]);

  const saveTokenToVault = async () => {
    if (!selectedConnectorId) return;
    const secret = tokenDraft.trim();
    if (!secret) return;
    setSavingToken(true);
    setTokenSaveError('');
    try {
      await onChangeConnectorToken(secret);
      setTokenDraft('');
      setTokenSavedConnectorId(selectedConnectorId);
    } catch (error) {
      setTokenSaveError(error instanceof Error ? error.message : String(error || 'Save failed'));
    } finally {
      setSavingToken(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card className="space-y-4 p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-gray-900">Cloud API Connectors</p>
            <p className="text-xs text-gray-500">Configure API keys for cloud-based AI providers. Used as fallback when local runtime is unavailable.</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={() => { void onAddConnector().catch((e) => reportError('Add connector failed', e)); }}>
              Add Connector
            </Button>
            {!isSystemOwned && selectedConnectorId ? (
              <Button variant="ghost" size="sm" onClick={() => { void onRemoveSelectedConnector().catch((e) => reportError('Remove connector failed', e)); }}>
                Delete
              </Button>
            ) : null}
            <Button
              variant="secondary"
              size="sm"
              disabled={model.testingConnector || !selectedConnector}
              onClick={() => void model.testSelectedConnector()}
            >
              {model.testingConnector ? 'Testing...' : 'Test'}
            </Button>
          </div>
        </div>

        {/* Connector chips */}
        <div className="flex flex-wrap gap-2">
          {orderedConnectors.map((connector) => {
            const active = connector.id === state.selectedConnectorId;
            return (
              <button
                key={connector.id}
                type="button"
                onClick={() => onSelectConnector(connector.id)}
                className={`rounded-[10px] border px-3 py-2 text-left text-xs transition-colors ${
                  active
                    ? 'border-brand-500 bg-brand-50 text-brand-700'
                    : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                }`}
              >
                <div className="flex items-center gap-1.5">
                  <span className={`inline-block h-2 w-2 rounded-full ${
                    connector.status === 'healthy' ? 'bg-emerald-500' : 'bg-gray-300'
                  }`} />
                  <p className="font-semibold">{connector.label}</p>
                  {connector.isSystemOwned ? (
                    <span className="text-[9px] text-gray-400">system</span>
                  ) : connector.isDraft ? (
                    <span className="text-[9px] text-amber-500">draft</span>
                  ) : null}
                </div>
                <p className="text-[10px] text-gray-500">{VENDOR_CATALOGS_V11[connector.vendor].label}</p>
              </button>
            );
          })}
        </div>
      </Card>

      {/* Selected connector config */}
      {selectedConnector ? (
        <Card className="space-y-4 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Connector Configuration</p>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Input
              label="Connector Name"
              value={selectedConnector.label}
              onChange={onRenameSelectedConnector}
              disabled={isSystemOwned}
            />
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700">Vendor</label>
              <select
                value={selectedConnector.vendor}
                onChange={(e) => { void onChangeConnectorVendor(e.target.value).catch((err) => reportError('Switch vendor failed', err)); }}
                disabled={isSystemOwned}
                className="h-[46px] w-full rounded-[10px] border border-gray-200 bg-white px-3 text-sm text-gray-900 outline-none transition-colors focus:border-brand-500 focus:ring-1 focus:ring-brand-500 disabled:opacity-60"
              >
                {VENDOR_ORDER_V11.map((vendor) => (
                  <option key={vendor} value={vendor}>{VENDOR_CATALOGS_V11[vendor].label}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Input
              label="Endpoint"
              value={selectedConnector.endpoint}
              onChange={onChangeConnectorEndpoint}
              placeholder={DEFAULT_OPENAI_ENDPOINT_V11}
              disabled={isSystemOwned}
            />
            {isSystemOwned ? (
              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700">API Key</label>
                <p className="mt-2 text-xs text-gray-500">
                  {selectedConnector.hasCredential
                    ? 'Managed by runtime (environment variable)'
                    : 'Not configured — set the environment variable in config.json'}
                </p>
              </div>
            ) : (
              <Input
                label={isDraft ? 'API Key (required)' : 'Session API Key'}
                value={tokenDraft}
                onChange={setTokenDraft}
                type={model.showTokenApiKey ? 'text' : 'password'}
                placeholder="sk-..."
              />
            )}
          </div>

          <div className="flex items-center gap-2">
            {!isSystemOwned ? (
              <Button variant="primary" size="sm" disabled={!canSaveToken} onClick={() => void saveTokenToVault()}>
                {savingToken ? 'Saving...' : isDraft ? 'Create Connector' : 'Save API Key'}
              </Button>
            ) : null}
            <Button variant="secondary" size="sm" onClick={() => model.setShowTokenApiKey((v) => !v)}>
              {model.showTokenApiKey ? 'Hide API Key' : 'Show API Key'}
            </Button>
            <StatusBadge status={selectedConnector.status} />
          </div>

          <p className="text-xs text-gray-500">Connector ID: {selectedConnector.id}</p>
          {selectedConnector.hasCredential ? (
            <p className="text-xs text-emerald-600">Credential configured.</p>
          ) : null}
          {tokenSavedConnectorId === selectedConnector.id ? (
            <p className="text-xs text-emerald-600">API Key saved.</p>
          ) : null}
          {tokenSaveError ? (
            <p className="text-xs text-rose-600">Save failed: {tokenSaveError}</p>
          ) : null}

          <Input
            label="Search Models"
            value={model.connectorModelQuery}
            onChange={model.setConnectorModelQuery}
            placeholder="Search by model name..."
          />
          <div>
            <p className="text-sm font-medium text-gray-700">Connector Models</p>
            {renderModelChips(model.filteredConnectorModels, `connector-${selectedConnector.id}`)}
          </div>
        </Card>
      ) : (
        <Card className="p-6 text-center">
          <p className="text-sm text-gray-500">No connector selected. Click &quot;Add Connector&quot; to create one.</p>
        </Card>
      )}
    </div>
  );
}
