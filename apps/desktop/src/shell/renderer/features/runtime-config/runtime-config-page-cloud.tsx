import {
  formatNimiRuntimeErrorBanner as formatRuntimeConfigErrorBanner,
} from '@nimiplatform/sdk/runtime';
import { type ProviderCatalogEntry } from '@nimiplatform/sdk/runtime/wire-types';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../../app-shell/providers/app-store';
import { useDesktopRendererBindings } from '../../renderer/binding-context.js';
import { CatalogOverridesDrawer } from './runtime-config-catalog-overrides-drawer';
import { removeConnectorFromState, replaceConnectorsInState, updateConnectorField } from './runtime-config-connector-actions';
import { RuntimeConfigConnectorCreateDialog } from './runtime-config-connector-create-form';
import {
  useConnectorOAuthAcquisition,
} from './runtime-config-connector-oauth-session';
import { useRuntimeConfigConnectorSdk } from './runtime-config-connector-sdk-context.js';
import { connectorAuthProfileForId, defaultConnectorAuthOptionForProvider, listConnectorAuthOptionsForProvider, providerToVendor, resolveProviderEndpoint, vendorToProvider } from './runtime-config-connector-sdk-service';
import { CloudConnectorListPanel } from './runtime-config-page-cloud-connector-list';
import { CloudConnectorDetailPanel } from './runtime-config-page-cloud-detail-panel';
import { Button, CloudEmptyState, PlusIcon } from './runtime-config-page-cloud-primitives';
import { RuntimePageHeader, RuntimePageShell } from './runtime-config-page-shell';
import type { RuntimeConfigPanelControllerModel } from './runtime-config-panel-types';
import { testSelectedConnectorCommand } from './runtime-config-provider-commands.js';
import type { RuntimeConfigStateV11 } from './runtime-config-state-types';
import { getVendorLabelV11, type ApiVendor } from './runtime-config-state-types';
type CloudPageProps = { model: RuntimeConfigPanelControllerModel; state: RuntimeConfigStateV11; };
const PROVIDER_CATALOG_ERROR_LABEL = 'Load provider catalog failed';
const CONNECTORS_LOAD_ERROR_LABEL = 'Load connectors failed';

export function CloudServicesPage({ model, state }: CloudPageProps) {
  const { t } = useTranslation();
  const bindings = useDesktopRendererBindings();
  const connectorSdk = useRuntimeConfigConnectorSdk();
  const {
    sdkCreateConnector,
    sdkDeleteConnector,
    sdkListConnectors,
    sdkListProviderCatalog,
    sdkUpdateConnector,
  } = connectorSdk;
  const { selectedConnector, orderedConnectors, updateState } = model;
  const authStatus = useAppStore((s) => s.auth.status);
  const [providerCatalog, setProviderCatalog] = useState<ProviderCatalogEntry[]>([]);
  const [tokenDraft, setTokenDraft] = useState('');
  const [connectorLabelDraft, setConnectorLabelDraft] = useState('');
  const [savingToken, setSavingToken] = useState(false);
  const [tokenSaveError, setTokenSaveError] = useState('');
  const [tokenSavedConnectorId, setTokenSavedConnectorId] = useState('');
  const [deletingConnectorId, setDeletingConnectorId] = useState('');
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [catalogOverrideProviderId, setCatalogOverrideProviderId] = useState('');
  const connectorsRef = useRef(state.connectors);
  connectorsRef.current = state.connectors;
  const consumedActionFocusRef = useRef('');
  const reportError = useCallback((label: string, error: unknown) => {
    model.setPageFeedback({
      kind: 'error',
      message: formatRuntimeConfigErrorBanner(label, error),
    });
  }, [model]);
  // Shared managed-OAuth orchestration: the same hook backs the in-task
  // connector creation form; generation + snapshot guards make a stale
  // completion after a page switch, cancel, or account change a no-op.
  const connectorOAuth = useConnectorOAuthAcquisition({
    host: bindings.app.commands.connectorAuth,
    findConnector: (connectorId) => connectorsRef.current.find((connector) => connector.id === connectorId) ?? null,
    onError: (message) => setTokenSaveError(message),
    onAcquired: async (acquired, operation, isCurrent) => {
      setTokenDraft('');
      const acquiredConnectorId = acquired.connectorId;
      setTokenSavedConnectorId(acquiredConnectorId);
      if (operation.connector.isDraft) {
        try {
          const connectors = await sdkListConnectors();
          updateState((prev) => {
            const currentConnector = prev.connectors.find((connector) => connector.id === operation.connector.id);
            if (!isCurrent(currentConnector ?? null)) {
              return prev;
            }
            const drafts = prev.connectors.filter((connector) => (
              connector.isDraft && connector.id !== operation.connector.id
            ));
            const next = replaceConnectorsInState(prev, [...connectors, ...drafts]);
            return { ...next, selectedConnectorId: acquiredConnectorId };
          });
        } catch (error) {
          if (!isCurrent()) {
            return;
          }
          updateState((prev) => {
            const currentConnector = prev.connectors.find((connector) => connector.id === operation.connector.id);
            if (!isCurrent(currentConnector ?? null)) {
              return prev;
            }
            return {
              ...prev,
              connectors: prev.connectors.map((connector) => (
                connector.id === operation.connector.id
                  ? { ...connector, id: acquiredConnectorId, isDraft: false, hasCredential: true }
                  : connector
              )),
              selectedConnectorId: acquiredConnectorId,
            };
          });
          reportError(CONNECTORS_LOAD_ERROR_LABEL, error);
        }
      } else {
        updateState((prev) => {
          const currentConnector = prev.connectors.find((connector) => connector.id === operation.connector.id);
          return isCurrent(currentConnector ?? null)
            ? updateConnectorField(prev, acquiredConnectorId, { hasCredential: true })
            : prev;
        });
      }
      if (isCurrent()) {
        model.onVaultChanged();
      }
    },
  });
  const codexOAuthBusy = connectorOAuth.busy;
  const codexOAuthPending = connectorOAuth.pending;
  const selectedConnectorId = selectedConnector?.id || '';
  const connectorScope = selectedConnector?.scope || 'user';
  const isRuntimeSystem = connectorScope === 'runtime-system';
  const isMachineGlobal = connectorScope === 'machine-global';
  const isSystemOwned = isRuntimeSystem;
  const isDraft = selectedConnector?.isDraft || false;
  const canEditVendor = !isRuntimeSystem && isDraft && !codexOAuthBusy;
  const authOptions = useMemo(
    () => listConnectorAuthOptionsForProvider(selectedConnector?.provider || '', providerCatalog),
    [providerCatalog, selectedConnector?.provider],
  );
  const selectedAuthOptionValue = useMemo(() => {
    if (!selectedConnector) {
      return 'api_key';
    }
    if (selectedConnector.authMode === 'oauth_managed' && selectedConnector.providerAuthProfile) {
      return `oauth:${selectedConnector.providerAuthProfile}`;
    }
    return 'api_key';
  }, [selectedConnector]);
  const canEditCredentialMode = !isRuntimeSystem && isDraft && !codexOAuthBusy && authOptions.length > 1;
  const selectedAuthProfile = connectorAuthProfileForId(selectedConnector?.providerAuthProfile);
  const isCodexManagedConnector = selectedConnector?.authMode === 'oauth_managed'
    && selectedAuthProfile?.headerBehavior === 'codex_oauth';
  const canStartCodexOAuth = Boolean(selectedConnectorId)
    && isCodexManagedConnector
    && authStatus === 'authenticated'
    && !savingToken
    && !codexOAuthBusy;
  const invalidateCodexOAuth = useCallback((message: string) => {
    connectorOAuth.invalidate(message);
    setTokenSavedConnectorId('');
  }, [connectorOAuth.invalidate]);
  useEffect(() => {
    invalidateCodexOAuth('Managed connector selection changed');
    setTokenDraft('');
    setTokenSaveError('');
  }, [invalidateCodexOAuth, selectedConnectorId]);
  // An account switch invalidates any in-flight OAuth operation.
  const oauthAuthStatusRef = useRef(authStatus);
  useEffect(() => {
    if (oauthAuthStatusRef.current !== authStatus) {
      oauthAuthStatusRef.current = authStatus;
      invalidateCodexOAuth('Account changed');
    }
  }, [authStatus, invalidateCodexOAuth]);
  useEffect(() => {
    if (codexOAuthBusy) {
      invalidateCodexOAuth('Managed connector configuration changed');
    }
  }, [
    codexOAuthBusy,
    invalidateCodexOAuth,
    selectedConnector?.authMode,
    selectedConnector?.endpoint,
    selectedConnector?.isDraft,
    selectedConnector?.label,
    selectedConnector?.provider,
    selectedConnector?.providerAuthProfile,
    selectedConnector?.vendor,
  ]);
  useEffect(() => {
    setConnectorLabelDraft(String(selectedConnector?.label || ''));
  }, [selectedConnectorId, selectedConnector?.label]);
  const selectedProviderCatalogEntry = useMemo(
    () => providerCatalog.find((entry) => entry.provider === selectedConnector?.provider) || null,
    [providerCatalog, selectedConnector?.provider],
  );
  const developerModeEnabled = bindings.app.projection.developerModeEnabled();
  const canManageCatalogOverrides = developerModeEnabled
    && Boolean(selectedConnector?.provider)
    && selectedProviderCatalogEntry?.inventoryMode !== 'dynamic_endpoint';
  const managedProviderCatalog = useMemo(
    () => providerCatalog.filter((entry) => entry.managedSupported && entry.provider !== 'local'),
    [providerCatalog],
  );
  const loadProviderCatalog = useCallback(async () => {
    const providers = await sdkListProviderCatalog();
    setProviderCatalog(Array.isArray(providers) ? providers : []);
  }, [sdkListProviderCatalog]);
  const vendorOptions = useMemo(() => {
    const visibleVendors = new Set<ApiVendor>();
    for (const entry of managedProviderCatalog) {
      const vendor = providerToVendor(entry.provider);
      if (vendor) visibleVendors.add(vendor);
    }
    for (const connector of state.connectors) {
      if (connector.vendor) visibleVendors.add(connector.vendor);
    }
    return Array.from(visibleVendors)
      .sort((left, right) => getVendorLabelV11(left).localeCompare(getVendorLabelV11(right)))
      .map((vendor) => ({
        value: vendor,
        label: getVendorLabelV11(vendor),
      }));
  }, [managedProviderCatalog, state.connectors]);
  const refreshConnectorsFromSdk = useCallback(async () => {
    const connectors = await sdkListConnectors();
    updateState((prev) => {
      const drafts = prev.connectors.filter((c) => c.isDraft);
      return replaceConnectorsInState(prev, [...connectors, ...drafts]);
    });
  }, [updateState]);
  const connectorLoadCallbacksRef = useRef({
    reportError,
    updateState,
  });
  const connectorListFromSdkRef = useRef(sdkListConnectors);
  connectorLoadCallbacksRef.current = {
    reportError,
    updateState,
  };
  connectorListFromSdkRef.current = sdkListConnectors;
  useEffect(() => {
    let cancelled = false;
    void connectorListFromSdkRef.current()
      .then((connectors) => {
        if (cancelled) return;
        const callbacks = connectorLoadCallbacksRef.current;
        callbacks.updateState((prev) => {
          const drafts = prev.connectors.filter((c) => c.isDraft);
          return replaceConnectorsInState(prev, [...connectors, ...drafts]);
        });
      })
      .catch((error) => {
        if (!cancelled) {
          connectorLoadCallbacksRef.current.reportError(CONNECTORS_LOAD_ERROR_LABEL, error);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    let cancelled = false;
    void loadProviderCatalog()
      .catch((error) => {
        if (!cancelled) {
          reportError(PROVIDER_CATALOG_ERROR_LABEL, error);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [loadProviderCatalog, reportError]);
  const onAddConnector = useCallback(() => {
    // The Add journey is the shared creation form; the Cloud page and the
    // in-task entry render the same implementation.
    setCreateDialogOpen(true);
  }, []);
  useEffect(() => {
    const actionFocus = state.actionFocus;
    if (actionFocus?.focus !== 'runtime-config-action-focus.cloud-connector-draft') {
      return;
    }
    const focusKey = `${actionFocus.page}:${actionFocus.action}:${state.connectors.length}`;
    if (consumedActionFocusRef.current === focusKey) {
      return;
    }
    consumedActionFocusRef.current = focusKey;
    setCreateDialogOpen(true);
    updateState((prev) => ({
      ...prev,
      actionFocus: null,
    }));
  }, [state.actionFocus, state.connectors.length, updateState]);
  const onDeleteConnector = useCallback(async (connectorId: string) => {
    const connector = state.connectors.find((item) => item.id === connectorId) || null;
    if (!connector || connector.scope === 'runtime-system' || connector.isSystemOwned || deletingConnectorId) return;
    if (connectorId === selectedConnectorId && codexOAuthBusy) {
      invalidateCodexOAuth('Managed connector was deleted');
    }
    setDeletingConnectorId(connectorId);
    try {
      if (connector.isDraft) {
        updateState((prev) => removeConnectorFromState(prev, connectorId));
        return;
      }
      await sdkDeleteConnector(connectorId);
      await refreshConnectorsFromSdk();
    } finally {
      setDeletingConnectorId('');
    }
  }, [deletingConnectorId, invalidateCodexOAuth, refreshConnectorsFromSdk, selectedConnectorId, state.connectors, updateState]);
  const onSelectConnector = useCallback((connectorId: string) => {
    if (connectorId !== selectedConnectorId && codexOAuthBusy) {
      invalidateCodexOAuth('Managed connector selection changed');
    }
    const connector = state.connectors.find((item) => item.id === connectorId) || null;
    if (connector) {
      setConnectorLabelDraft(String(connector.label || ''));
    }
    updateState((prev) => ({ ...prev, selectedConnectorId: connectorId }));
  }, [invalidateCodexOAuth, selectedConnectorId, state.connectors, updateState]);
  const onAcquireCodexOAuth = useCallback(() => {
    if (!selectedConnector || !selectedConnectorId || !isCodexManagedConnector) {
      return;
    }
    setTokenSaveError('');
    setTokenSavedConnectorId('');
    void connectorOAuth.start(selectedConnector);
  }, [connectorOAuth, isCodexManagedConnector, selectedConnector, selectedConnectorId]);
  const onChangeConnectorVendor = useCallback(async (vendor: string) => {
    if (!selectedConnector || !canEditVendor) return;
    const previousConnector = selectedConnector;
    const normalizedVendor = vendor as typeof selectedConnector.vendor;
    const provider = vendorToProvider(normalizedVendor);
    const runtimeCatalog = await sdkListProviderCatalog();
    const defaultAuthOption = defaultConnectorAuthOptionForProvider(provider, runtimeCatalog);
    const endpoint = resolveProviderEndpoint(provider, runtimeCatalog);
    if (codexOAuthBusy) {
      invalidateCodexOAuth('Managed connector vendor changed');
    }
    updateState((prev) => updateConnectorField(prev, selectedConnectorId, {
      vendor: normalizedVendor,
      endpoint,
      models: [],
      provider,
      authMode: defaultAuthOption.authMode,
      providerAuthProfile: defaultAuthOption.providerAuthProfile,
    }));
    if (selectedConnectorId && !selectedConnector.isDraft) {
      try { await sdkUpdateConnector({ connectorId: selectedConnectorId, endpoint }); }
      catch (error) {
        updateState((prev) => updateConnectorField(prev, selectedConnectorId, {
          vendor: previousConnector.vendor,
          endpoint: previousConnector.endpoint,
          models: previousConnector.models,
          provider: previousConnector.provider,
          authMode: previousConnector.authMode,
          providerAuthProfile: previousConnector.providerAuthProfile,
        }));
        throw error;
      }
    }
  }, [canEditVendor, invalidateCodexOAuth, sdkListProviderCatalog, selectedConnector, selectedConnectorId, updateState]);
  const onChangeConnectorAuthOption = useCallback((nextValue: string) => {
    if (!selectedConnector || isRuntimeSystem || !isDraft) return;
    const nextOption = authOptions.find((option) => option.value === nextValue) || null;
    if (!nextOption) return;
    if (codexOAuthBusy) {
      invalidateCodexOAuth('Managed connector credential type changed');
    }
    updateState((prev) => updateConnectorField(prev, selectedConnectorId, {
      authMode: nextOption.authMode,
      providerAuthProfile: nextOption.providerAuthProfile,
      hasCredential: false,
    }));
    setTokenDraft('');
    setTokenSaveError('');
    setTokenSavedConnectorId('');
  }, [authOptions, invalidateCodexOAuth, isDraft, isRuntimeSystem, selectedConnector, selectedConnectorId, updateState]);
  const saveConnectionDetails = async (draft: { label: string; endpoint: string; credentialValue: string; }) => {
    const selected = selectedConnector;
    if (!selected || isSystemOwned || codexOAuthBusy) return;
    setSavingToken(true);
    setTokenSaveError('');
    try {
      if (selected.isDraft && selected.authMode !== 'api_key') throw new Error(t('runtimeConfig.cloud.managedOAuthHostOwned'));
      const credentialValue = selected.authMode === 'api_key' ? draft.credentialValue.trim() : '';
      const saved = selected.isDraft
        ? await sdkCreateConnector({ provider: selected.provider, endpoint: draft.endpoint.trim(), label: draft.label.trim() || selected.label, credentialValue, authMode: 'api_key' })
        : await sdkUpdateConnector({ connectorId: selected.id, label: draft.label.trim() || selected.label, endpoint: draft.endpoint.trim(), ...(credentialValue ? { credentialValue, authMode: 'api_key' as const } : {}) });
      if (!saved) throw new Error(t('runtimeConfig.product.connectionSaveFailed'));
      updateState(prev => ({ ...prev, connectors: prev.connectors.map(item => item.id === selected.id ? saved : item), selectedConnectorId: prev.selectedConnectorId === selected.id ? saved.id : prev.selectedConnectorId }));
      setTokenDraft('');
      setTokenSavedConnectorId(saved.id);
      model.onVaultChanged();
      await testSelectedConnectorCommand({ state, selectedConnector: saved, connectorSdk, now: bindings.clock.now, testingConnector: false, updateState, setStatusBanner: model.setPageFeedback, setControlFeedback: model.setPageFeedback });
    } catch (error) {
      setTokenSaveError(error instanceof Error ? error.message : String(error));
      throw error;
    } finally { setSavingToken(false); }
  };
  const uncheckedConnectors = state.connectors.filter((connector) => connector.hasCredential && !connector.isDraft && connector.status === 'idle');
  const [checkingAll, setCheckingAll] = useState(false);
  const onCheckAll = useCallback(async () => {
    if (checkingAll) return;
    setCheckingAll(true);
    try {
      for (const connector of uncheckedConnectors) {
        await testSelectedConnectorCommand({ state, selectedConnector: connector, connectorSdk, now: bindings.clock.now, testingConnector: false, updateState, setStatusBanner: model.setPageFeedback, setControlFeedback: model.setPageFeedback });
      }
    } finally {
      setCheckingAll(false);
    }
  }, [bindings.clock.now, checkingAll, connectorSdk, model.setPageFeedback, state, uncheckedConnectors, updateState]);
  const hasConnectors = state.connectors.length > 0;
  return (
    <RuntimePageShell className='space-y-6 pt-1'>
      <RuntimePageHeader
        title={t('runtimeConfig.nav.cloudServices', { defaultValue: 'Cloud Services' })}
        description={t('runtimeConfig.product.cloudLead')}
        actions={hasConnectors ? (
          <>
            {uncheckedConnectors.length > 1 ? (
              <Button variant='secondary' size='sm' disabled={checkingAll || model.testingConnector} onClick={() => { void onCheckAll(); }}>
                {t(checkingAll ? 'runtimeConfig.cloud.testing' : 'runtimeConfig.product.checkAll', { count: uncheckedConnectors.length })}
              </Button>
            ) : null}
            <Button
              variant='primary'
              size='sm'
              onClick={onAddConnector}
              icon={<PlusIcon />}
            >
              {t('runtimeConfig.cloud.addConnector', { defaultValue: 'Add' })}
            </Button>
          </>
        ) : null}
      />
      {hasConnectors ? (
        <>
          <CloudConnectorListPanel
            connectors={orderedConnectors}
            deletingConnectorId={deletingConnectorId}
            onAddConnector={onAddConnector}
            onDeleteConnector={(connectorId) => onDeleteConnector(connectorId).catch((e) => reportError('Remove connector failed', e))}
            onSelectConnector={onSelectConnector}
            selectedConnectorId={state.selectedConnectorId}
            uncheckedCount={uncheckedConnectors.length}
            t={t}
          />
          <CloudConnectorDetailPanel
            key={selectedConnector?.id ?? 'empty'}
            onSaveConnection={saveConnectionDetails}
            authOptions={authOptions}
            authStatus={authStatus}
            canEditCredentialMode={canEditCredentialMode}
            canEditVendor={canEditVendor}
            canStartCodexOAuth={canStartCodexOAuth}
            canManageCatalogOverrides={canManageCatalogOverrides}
            codexOAuthBusy={codexOAuthBusy}
            codexOAuthPending={codexOAuthPending}
            connectorConfigurationLocked={codexOAuthBusy}
            connectorLabelDraft={connectorLabelDraft}
            isCodexManagedConnector={isCodexManagedConnector}
            isDraft={isDraft}
            isMachineGlobal={isMachineGlobal}
            isRuntimeSystem={isRuntimeSystem}
            isSystemOwned={isSystemOwned}
            model={model}
            onAcquireCodexOAuth={onAcquireCodexOAuth}
            onManageCatalogOverrides={() => setCatalogOverrideProviderId(selectedConnector?.provider || '')}
            onConnectorLabelDraftChange={(label) => {
              if (!codexOAuthBusy) setConnectorLabelDraft(label);
            }}
            onChangeConnectorAuthOption={onChangeConnectorAuthOption}
            onChangeConnectorVendor={onChangeConnectorVendor}
            reportError={reportError}
            savingToken={savingToken}
            selectedAuthOptionValue={selectedAuthOptionValue}
            selectedConnector={selectedConnector}
            selectedProviderCatalogEntry={selectedProviderCatalogEntry}
            setTokenDraft={setTokenDraft}
            t={t}
            tokenDraft={tokenDraft}
            tokenSaveError={tokenSaveError}
            tokenSavedConnectorId={tokenSavedConnectorId}
            vendorOptions={vendorOptions}
          />
        </>
      ) : (
        <CloudEmptyState onAddConnector={onAddConnector} t={t} />
      )}
      <CatalogOverridesDrawer
        open={Boolean(catalogOverrideProviderId)}
        providerId={catalogOverrideProviderId}
        onClose={() => setCatalogOverrideProviderId('')}
      />
      <RuntimeConfigConnectorCreateDialog
        submitLabel={t('runtimeConfig.product.saveAndCheck')}
        open={createDialogOpen}
        connectedProviders={state.connectors.map((connector) => connector.provider)}
        onClose={() => setCreateDialogOpen(false)}
        onCreated={(connectorId) => {
          setCreateDialogOpen(false);
          void (async () => {
            setSavingToken(true);
            try {
              const connectors = await sdkListConnectors();
              updateState((prev) => {
                const drafts = prev.connectors.filter((connector) => connector.isDraft);
                const next = replaceConnectorsInState(prev, [...connectors, ...drafts]);
                return { ...next, selectedConnectorId: connectorId };
              });
              const created = connectors.find(connector => connector.id === connectorId);
              if (created) await testSelectedConnectorCommand({ state, selectedConnector: created, connectorSdk, now: bindings.clock.now, testingConnector: false, updateState, setStatusBanner: model.setPageFeedback, setControlFeedback: model.setPageFeedback });
            } catch (error) {
              reportError(CONNECTORS_LOAD_ERROR_LABEL, error);
            } finally { setSavingToken(false); }
            model.onVaultChanged();
          })();
        }}
      />
    </RuntimePageShell>
  );
}
