import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  formatNimiRuntimeErrorBanner as formatRuntimeConfigErrorBanner,
} from '@nimiplatform/sdk/runtime';
import { type ProviderCatalogEntry } from '@nimiplatform/sdk/runtime/wire-types';
import type { RuntimeConfigStateV11 } from './runtime-config-state-types';
import { getVendorLabelV11, randomIdV11, type ApiVendor } from './runtime-config-state-types';
import { useAppStore } from '../../app-shell/providers/app-store';
import { useDesktopRendererBindings } from '../../renderer/binding-context.js';
import { connectorAuthProfileForId, defaultConnectorAuthOptionForProvider, listConnectorAuthOptionsForProvider, providerToVendor, resolveProviderEndpoint, vendorToProvider } from './runtime-config-connector-sdk-service';
import { useRuntimeConfigConnectorSdk } from './runtime-config-connector-sdk-context.js';
import { addConnectorToState, removeConnectorFromState, replaceConnectorsInState, updateConnectorField } from './runtime-config-connector-actions';
import type { RuntimeConfigPanelControllerModel } from './runtime-config-panel-types';
import { RuntimePageHeader, RuntimePageShell } from './runtime-config-page-shell';
import {
  acquireCodexManagedCredential,
  createCodexOAuthConnectorOperationSnapshot,
  isCodexOAuthConnectorOperationCurrent,
  type CodexOAuthPendingState,
} from './runtime-config-codex-oauth';
import { BoltIcon, Button, PlusIcon } from './runtime-config-page-cloud-primitives';
import { CloudConnectorListPanel } from './runtime-config-page-cloud-connector-list';
import { CloudConnectorDetailPanel } from './runtime-config-page-cloud-detail-panel';
import { CatalogOverridesDrawer } from './runtime-config-catalog-overrides-drawer';
type CloudPageProps = { model: RuntimeConfigPanelControllerModel; state: RuntimeConfigStateV11 };
const PROVIDER_CATALOG_ERROR_LABEL = 'Load provider catalog failed';
const CONNECTORS_LOAD_ERROR_LABEL = 'Load connectors failed';

export function CloudPage({ model, state }: CloudPageProps) {
  const { t } = useTranslation();
  const bindings = useDesktopRendererBindings();
  const {
    sdkCreateConnector,
    sdkDeleteConnector,
    sdkListConnectors,
    sdkListProviderCatalog,
    sdkUpdateConnector,
  } = useRuntimeConfigConnectorSdk();
  const { selectedConnector, orderedConnectors, updateState } = model;
  const authStatus = useAppStore((s) => s.auth.status);
  const [providerCatalog, setProviderCatalog] = useState<ProviderCatalogEntry[]>([]);
  const [tokenDraft, setTokenDraft] = useState('');
  const [connectorLabelDraft, setConnectorLabelDraft] = useState('');
  const [savingToken, setSavingToken] = useState(false);
  const [tokenSaveError, setTokenSaveError] = useState('');
  const [tokenSavedConnectorId, setTokenSavedConnectorId] = useState('');
  const [deletingConnectorId, setDeletingConnectorId] = useState('');
  const [codexOAuthPending, setCodexOAuthPending] = useState<CodexOAuthPendingState | null>(null);
  const [codexOAuthBusy, setCodexOAuthBusy] = useState(false);
  const [catalogOverrideProviderId, setCatalogOverrideProviderId] = useState('');
  const codexOAuthAbortRef = useRef<AbortController | null>(null);
  const codexOAuthGenerationRef = useRef(0);
  const connectorsRef = useRef(state.connectors);
  connectorsRef.current = state.connectors;
  const consumedActionFocusRef = useRef('');
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
    codexOAuthGenerationRef.current += 1;
    codexOAuthAbortRef.current?.abort(new DOMException(message, 'AbortError'));
    codexOAuthAbortRef.current = null;
    setCodexOAuthPending(null);
    setCodexOAuthBusy(false);
    setTokenSavedConnectorId('');
  }, []);
  useEffect(() => {
    invalidateCodexOAuth('Managed connector selection changed');
    setTokenDraft('');
    setTokenSaveError('');
  }, [invalidateCodexOAuth, selectedConnectorId]);
  useEffect(() => () => {
    codexOAuthGenerationRef.current += 1;
    codexOAuthAbortRef.current?.abort(new DOMException('Managed connector page closed', 'AbortError'));
    codexOAuthAbortRef.current = null;
  }, []);
  useEffect(() => {
    if (codexOAuthAbortRef.current) {
      invalidateCodexOAuth('Managed connector configuration changed');
    }
  }, [
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
  const canSaveToken = useMemo(
    () => (
      Boolean(selectedConnectorId)
      && selectedConnector?.authMode !== 'oauth_managed'
      && tokenDraft.trim().length > 0
      && !savingToken
      && !codexOAuthBusy
    ),
    [codexOAuthBusy, savingToken, selectedConnector?.authMode, tokenDraft, selectedConnectorId],
  );
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
  const reportError = useCallback((label: string, error: unknown) => {
    model.setPageFeedback({
      kind: 'error',
      message: formatRuntimeConfigErrorBanner(label, error),
    });
  }, [model]);
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
  const onAddConnector = useCallback(async () => {
    const runtimeCatalog = await sdkListProviderCatalog();
    const providerEntry = runtimeCatalog.find((entry) => entry.managedSupported && entry.provider !== 'local');
    if (!providerEntry?.provider) {
      throw new Error('Runtime provider catalog returned no managed cloud providers.');
    }
    const provider = providerEntry.provider;
    const vendor: ApiVendor = providerToVendor(provider);
    const defaultAuthOption = defaultConnectorAuthOptionForProvider(provider, runtimeCatalog);
    const endpoint = resolveProviderEndpoint(provider, runtimeCatalog);
    const draft = {
      id: randomIdV11('draft'),
      label: `API Connector ${state.connectors.length + 1}`,
      vendor,
      provider,
      authMode: defaultAuthOption.authMode,
      providerAuthProfile: defaultAuthOption.providerAuthProfile,
      endpoint,
      scope: authStatus === 'authenticated' ? 'user' as const : 'machine-global' as const,
      hasCredential: false,
      isSystemOwned: false,
      models: [],
      status: 'idle' as const,
      lastCheckedAt: null,
      lastDetail: '',
      isDraft: true,
    };
    setConnectorLabelDraft(draft.label);
    updateState((prev) => addConnectorToState(prev, draft));
  }, [authStatus, state.connectors.length, updateState]);
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
    void onAddConnector().finally(() => {
      updateState((prev) => ({
        ...prev,
        actionFocus: null,
      }));
    });
  }, [onAddConnector, state.actionFocus, state.connectors.length, updateState]);
  const onDeleteConnector = useCallback(async (connectorId: string) => {
    const connector = state.connectors.find((item) => item.id === connectorId) || null;
    if (!connector || connector.scope === 'runtime-system' || connector.isSystemOwned || deletingConnectorId) return;
    if (connectorId === selectedConnectorId && codexOAuthAbortRef.current) {
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
    if (connectorId !== selectedConnectorId && codexOAuthAbortRef.current) {
      invalidateCodexOAuth('Managed connector selection changed');
    }
    const connector = state.connectors.find((item) => item.id === connectorId) || null;
    if (connector) {
      setConnectorLabelDraft(String(connector.label || ''));
    }
    updateState((prev) => ({ ...prev, selectedConnectorId: connectorId }));
  }, [invalidateCodexOAuth, selectedConnectorId, state.connectors, updateState]);
  const onRenameSelectedConnector = useCallback((label: string) => {
    if (isRuntimeSystem) return;
    if (codexOAuthAbortRef.current) {
      invalidateCodexOAuth('Managed connector label changed');
    }
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
  }, [invalidateCodexOAuth, isRuntimeSystem, selectedConnector, selectedConnectorId, updateState, reportError]);
  const commitConnectorLabelDraft = useCallback(() => {
    if (!selectedConnector || isRuntimeSystem) return;
    if (connectorLabelDraft === selectedConnector.label) return;
    onRenameSelectedConnector(connectorLabelDraft);
  }, [connectorLabelDraft, isRuntimeSystem, onRenameSelectedConnector, selectedConnector]);
  const onChangeConnectorEndpoint = useCallback((endpoint: string) => {
    if (!selectedConnector || isRuntimeSystem) return;
    if (codexOAuthAbortRef.current) {
      invalidateCodexOAuth('Managed connector endpoint changed');
    }
    const previousConnector = selectedConnector;
    updateState((prev) => updateConnectorField(prev, selectedConnectorId, { endpoint }));
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
  }, [invalidateCodexOAuth, isRuntimeSystem, selectedConnector, selectedConnectorId, updateState, reportError]);
  const onSaveConnectorCredential = useCallback(async (input: {
    credentialValue?: string;
    label?: string;
  }) => {
    if (!selectedConnectorId || !selectedConnector) return '';
    if (selectedConnector.authMode === 'oauth_managed') {
      throw new Error('Managed OAuth credentials must be acquired by the Desktop native host.');
    }
    const normalizedSecret = String(input.credentialValue || '').trim();
    if (!normalizedSecret) return '';
    if (selectedConnector.isDraft) {
      const created = await sdkCreateConnector({
        provider: selectedConnector.provider,
        endpoint: selectedConnector.endpoint,
        label: input.label ?? selectedConnector.label,
        credentialValue: normalizedSecret,
        authMode: selectedConnector.authMode,
      });
      if (!created) throw new Error('create connector returned empty payload');
      updateState((prev) => {
        const withoutDraft = prev.connectors.filter((c) => c.id !== selectedConnectorId);
        return { ...prev, connectors: [...withoutDraft, created], selectedConnectorId: created.id };
      });
      model.onVaultChanged();
      return created.id;
    }
    await sdkUpdateConnector({
      connectorId: selectedConnectorId,
      credentialValue: normalizedSecret,
      authMode: selectedConnector.authMode,
    });
    updateState((prev) => updateConnectorField(prev, selectedConnectorId, { hasCredential: true }));
    model.onVaultChanged();
    return selectedConnectorId;
  }, [selectedConnectorId, selectedConnector, updateState, model]);
  const onAcquireCodexOAuth = useCallback(async () => {
    if (!selectedConnector || !selectedConnectorId || !isCodexManagedConnector) {
      return;
    }
    const profileId = String(selectedConnector.providerAuthProfile || '').trim();
    if (!profileId) {
      setTokenSaveError('Managed OAuth connector is missing provider auth profile.');
      return;
    }
    setCodexOAuthBusy(true);
    setTokenSaveError('');
    setTokenSavedConnectorId('');
    codexOAuthAbortRef.current?.abort(new DOMException('Managed connector acquisition was replaced', 'AbortError'));
    const abortController = new AbortController();
    codexOAuthAbortRef.current = abortController;
    const generation = codexOAuthGenerationRef.current + 1;
    codexOAuthGenerationRef.current = generation;
    const operation = createCodexOAuthConnectorOperationSnapshot(generation, selectedConnector);
    const operationIsCurrent = () => {
      const currentConnector = connectorsRef.current.find((connector) => connector.id === operation.connector.id);
      return codexOAuthAbortRef.current === abortController
        && !abortController.signal.aborted
        && isCodexOAuthConnectorOperationCurrent(
          operation,
          codexOAuthGenerationRef.current,
          currentConnector,
        );
    };
    try {
      const acquired = await acquireCodexManagedCredential({
        profileId,
        connectorId: operation.connector.isDraft ? undefined : operation.connector.id,
        provider: operation.connector.provider,
        endpoint: operation.connector.endpoint,
        label: operation.connector.label,
        onPending: (pending) => {
          if (operationIsCurrent()) {
            setCodexOAuthPending(pending);
          }
        },
        signal: abortController.signal,
      }, bindings.app.commands.connectorAuth);
      if (!operationIsCurrent()) {
        return;
      }
      setTokenDraft('');
      setCodexOAuthPending(null);
      const acquiredConnectorId = acquired.connectorId;
      setTokenSavedConnectorId(acquiredConnectorId);
      if (operation.connector.isDraft) {
        try {
          const connectors = await sdkListConnectors();
          updateState((prev) => {
            const currentConnector = prev.connectors.find((connector) => connector.id === operation.connector.id);
            if (!isCodexOAuthConnectorOperationCurrent(
              operation,
              codexOAuthGenerationRef.current,
              currentConnector,
            )) {
              return prev;
            }
            const drafts = prev.connectors.filter((connector) => (
              connector.isDraft && connector.id !== operation.connector.id
            ));
            const next = replaceConnectorsInState(prev, [...connectors, ...drafts]);
            return { ...next, selectedConnectorId: acquiredConnectorId };
          });
        } catch (error) {
          if (!operationIsCurrent()) {
            return;
          }
          updateState((prev) => {
            const currentConnector = prev.connectors.find((connector) => connector.id === operation.connector.id);
            if (!isCodexOAuthConnectorOperationCurrent(
              operation,
              codexOAuthGenerationRef.current,
              currentConnector,
            )) {
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
          return isCodexOAuthConnectorOperationCurrent(
            operation,
            codexOAuthGenerationRef.current,
            currentConnector,
          )
            ? updateConnectorField(prev, acquiredConnectorId, { hasCredential: true })
            : prev;
        });
      }
      if (operationIsCurrent()) {
        model.onVaultChanged();
      }
    } catch (error) {
      if (!abortController.signal.aborted) {
        setTokenSaveError(error instanceof Error ? error.message : String(error || 'Codex sign-in failed'));
      }
    } finally {
      if (codexOAuthAbortRef.current === abortController) {
        codexOAuthAbortRef.current = null;
        setCodexOAuthBusy(false);
      }
    }
  }, [bindings, isCodexManagedConnector, model, reportError, sdkListConnectors, selectedConnector, selectedConnectorId, updateState]);
  const onChangeConnectorVendor = useCallback(async (vendor: string) => {
    if (!selectedConnector || !canEditVendor) return;
    const previousConnector = selectedConnector;
    const normalizedVendor = vendor as typeof selectedConnector.vendor;
    const provider = vendorToProvider(normalizedVendor);
    const runtimeCatalog = await sdkListProviderCatalog();
    const defaultAuthOption = defaultConnectorAuthOptionForProvider(provider, runtimeCatalog);
    const endpoint = resolveProviderEndpoint(provider, runtimeCatalog);
    if (codexOAuthAbortRef.current) {
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
    if (codexOAuthAbortRef.current) {
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
  const saveTokenToVault = async () => {
    if (!selectedConnectorId) return;
    if (selectedConnector?.authMode === 'oauth_managed') {
      setTokenSaveError('Managed OAuth credentials must be acquired by the Desktop native host.');
      return;
    }
    const secret = tokenDraft.trim();
    if (!secret) return;
    setSavingToken(true);
    setTokenSaveError('');
    try {
      const persistedConnectorId = await onSaveConnectorCredential({
        credentialValue: secret,
        label: connectorLabelDraft,
      });
      setTokenDraft('');
      setTokenSavedConnectorId(persistedConnectorId || selectedConnectorId);
    } catch (error) {
      setTokenSaveError(error instanceof Error ? error.message : String(error || 'Save failed'));
    } finally {
      setSavingToken(false);
    }
  };
  return (
    <RuntimePageShell className="space-y-4">
      <RuntimePageHeader
        title={t('runtimeConfig.sidebar.cloud')}
        actions={(
          <>
            <Button
              variant="primary"
              size="sm"
              onClick={() => { void onAddConnector().catch((e) => reportError('Add connector failed', e)); }}
              icon={<PlusIcon />}
            >
              {t('runtimeConfig.cloud.addConnector', { defaultValue: 'Add' })}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={model.testingConnector || !selectedConnector}
              onClick={() => void model.testSelectedConnector()}
              icon={<BoltIcon className="text-[var(--nimi-action-primary-bg)]" />}
            >
              {model.testingConnector
                ? t('runtimeConfig.cloud.testing', { defaultValue: 'Testing...' })
                : t('runtimeConfig.cloud.testConnector', { defaultValue: 'Test' })}
            </Button>
          </>
        )}
      />
      {/* Split panel: connector list (left) + config (right) */}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <CloudConnectorListPanel
          connectors={orderedConnectors}
          deletingConnectorId={deletingConnectorId}
          onDeleteConnector={(connectorId) => onDeleteConnector(connectorId).catch((e) => reportError('Remove connector failed', e))}
          onSelectConnector={onSelectConnector}
          selectedConnectorId={state.selectedConnectorId}
          t={t}
        />
        <CloudConnectorDetailPanel
          authOptions={authOptions}
          authStatus={authStatus}
          canEditCredentialMode={canEditCredentialMode}
          canEditVendor={canEditVendor}
          canSaveToken={canSaveToken}
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
          onCommitConnectorLabelDraft={commitConnectorLabelDraft}
          onConnectorLabelDraftChange={(label) => {
            if (!codexOAuthBusy) setConnectorLabelDraft(label);
          }}
          onChangeConnectorAuthOption={onChangeConnectorAuthOption}
          onChangeConnectorEndpoint={onChangeConnectorEndpoint}
          onChangeConnectorVendor={onChangeConnectorVendor}
          reportError={reportError}
          saveTokenToVault={saveTokenToVault}
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
      </div>
      <CatalogOverridesDrawer
        open={Boolean(catalogOverrideProviderId)}
        providerId={catalogOverrideProviderId}
        onClose={() => setCatalogOverrideProviderId('')}
      />
    </RuntimePageShell>
  );
}
