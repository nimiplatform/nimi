import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatNimiRuntimeErrorBanner as formatRuntimeConfigErrorBanner } from '@nimiplatform/sdk/runtime';
import { type ProviderCatalogEntry } from '@nimiplatform/sdk/runtime/wire-types';
import type { RuntimeConfigStateV11 } from './runtime-config-state-types';
import { getVendorLabelV11, randomIdV11, type ApiVendor } from './runtime-config-state-types';
import { useAppStore } from '../../app-shell/providers/app-store';
import { connectorAuthProfileForId, defaultConnectorAuthOptionForProvider, listConnectorAuthOptionsForProvider, providerToVendor, resolveProviderEndpoint, runtimeConnectors, sdkCreateConnector, sdkDeleteConnector, sdkListConnectors, sdkListProviderCatalog, sdkUpdateConnector, vendorToProvider } from './runtime-config-connector-sdk-service';
import { addConnectorToState, removeConnectorFromState, replaceConnectorsInState, updateConnectorField } from './runtime-config-connector-actions';
import type { RuntimeConfigPanelControllerModel } from './runtime-config-panel-types';
import { RuntimePageShell } from './runtime-config-page-shell';
import { SectionTitle as SharedSectionTitle } from '../settings/settings-layout-components';
import { InlineFeedback } from '../../ui/feedback/inline-feedback';
import { acquireCodexManagedCredential, type CodexOAuthPendingState } from './runtime-config-codex-oauth';
import { BoltIcon, Button, PlusIcon } from './runtime-config-page-cloud-primitives';
import { CloudConnectorListPanel } from './runtime-config-page-cloud-connector-list';
import { CloudConnectorDetailPanel } from './runtime-config-page-cloud-detail-panel';
type CloudPageProps = { model: RuntimeConfigPanelControllerModel; state: RuntimeConfigStateV11 };
const SectionTitle = SharedSectionTitle;
export function CloudPage({ model, state }: CloudPageProps) {
  const PROVIDER_CATALOG_ERROR_LABEL = 'Load provider catalog failed';
  const CONNECTORS_LOAD_ERROR_LABEL = 'Load connectors failed';
  const { t } = useTranslation();
  const { selectedConnector, orderedConnectors, updateState } = model;
  const authStatus = useAppStore((s) => s.auth.status);
  const [providerCatalog, setProviderCatalog] = useState<ProviderCatalogEntry[]>([]);
  const pageFeedbackRef = useRef(model.pageFeedback);
  const [tokenDraft, setTokenDraft] = useState('');
  const [connectorLabelDraft, setConnectorLabelDraft] = useState('');
  const [savingToken, setSavingToken] = useState(false);
  const [tokenSaveError, setTokenSaveError] = useState('');
  const [tokenSavedConnectorId, setTokenSavedConnectorId] = useState('');
  const [deletingConnectorId, setDeletingConnectorId] = useState('');
  const [codexOAuthPending, setCodexOAuthPending] = useState<CodexOAuthPendingState | null>(null);
  const [codexOAuthBusy, setCodexOAuthBusy] = useState(false);
  const consumedActionFocusRef = useRef('');
  const selectedConnectorId = selectedConnector?.id || '';
  const connectorScope = selectedConnector?.scope || 'user';
  const isRuntimeSystem = connectorScope === 'runtime-system';
  const isMachineGlobal = connectorScope === 'machine-global';
  const isSystemOwned = isRuntimeSystem;
  const isDraft = selectedConnector?.isDraft || false;
  const canEditVendor = !isRuntimeSystem && isDraft;
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
  const canEditCredentialMode = !isRuntimeSystem && isDraft && authOptions.length > 1;
  const oauthManagedRequiresAuth = selectedConnector?.authMode === 'oauth_managed';
  const selectedAuthProfile = connectorAuthProfileForId(selectedConnector?.providerAuthProfile);
  const isCodexManagedConnector = selectedConnector?.authMode === 'oauth_managed'
    && selectedAuthProfile?.headerBehavior === 'codex_oauth';
  const canStartCodexOAuth = Boolean(selectedConnectorId)
    && isCodexManagedConnector
    && authStatus === 'authenticated'
    && !savingToken
    && !codexOAuthBusy;
  useEffect(() => {
    pageFeedbackRef.current = model.pageFeedback;
  }, [model.pageFeedback]);
  useEffect(() => {
    setTokenDraft('');
    setTokenSaveError('');
    setCodexOAuthPending(null);
    setCodexOAuthBusy(false);
  }, [selectedConnectorId]);
  useEffect(() => {
    setConnectorLabelDraft(String(selectedConnector?.label || ''));
  }, [selectedConnectorId, selectedConnector?.label]);
  const canSaveToken = useMemo(
    () => (
      Boolean(selectedConnectorId)
      && tokenDraft.trim().length > 0
      && !savingToken
      && !codexOAuthBusy
      && (!oauthManagedRequiresAuth || authStatus === 'authenticated')
    ),
    [authStatus, codexOAuthBusy, oauthManagedRequiresAuth, savingToken, tokenDraft, selectedConnectorId],
  );
  const selectedProviderCatalogEntry = useMemo(
    () => providerCatalog.find((entry) => entry.provider === selectedConnector?.provider) || null,
    [providerCatalog, selectedConnector?.provider],
  );
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
  const clearPageErrorByLabel = useCallback((label: string) => {
    if (
      pageFeedbackRef.current?.kind === 'error'
      && String(pageFeedbackRef.current.message || '').includes(label)
    ) {
      model.setPageFeedback(null);
    }
  }, [model]);
  useEffect(() => {
    model.setConnectorTestFeedback(null);
  }, [model, selectedConnectorId]);
  const loadProviderCatalog = useCallback(async () => {
    const providers = await sdkListProviderCatalog();
    setProviderCatalog(Array.isArray(providers) ? providers : []);
    clearPageErrorByLabel(PROVIDER_CATALOG_ERROR_LABEL);
  }, [clearPageErrorByLabel, PROVIDER_CATALOG_ERROR_LABEL]);
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
    clearPageErrorByLabel(CONNECTORS_LOAD_ERROR_LABEL);
  }, [clearPageErrorByLabel, updateState, CONNECTORS_LOAD_ERROR_LABEL]);
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
  }, [loadProviderCatalog, reportError, PROVIDER_CATALOG_ERROR_LABEL]);
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
  }, [deletingConnectorId, state.connectors, updateState, refreshConnectorsFromSdk]);
  const onSelectConnector = useCallback((connectorId: string) => {
    const connector = state.connectors.find((item) => item.id === connectorId) || null;
    if (connector) {
      setConnectorLabelDraft(String(connector.label || ''));
    }
    updateState((prev) => ({ ...prev, selectedConnectorId: connectorId }));
  }, [state.connectors, updateState]);
  const onRenameSelectedConnector = useCallback((label: string) => {
    if (isRuntimeSystem) return;
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
  }, [isRuntimeSystem, selectedConnector, selectedConnectorId, updateState, reportError]);
  const commitConnectorLabelDraft = useCallback(() => {
    if (!selectedConnector || isRuntimeSystem) return;
    if (connectorLabelDraft === selectedConnector.label) return;
    onRenameSelectedConnector(connectorLabelDraft);
  }, [connectorLabelDraft, isRuntimeSystem, onRenameSelectedConnector, selectedConnector]);
  const onChangeConnectorEndpoint = useCallback((endpoint: string) => {
    if (!selectedConnector || isRuntimeSystem) return;
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
  }, [isRuntimeSystem, selectedConnector, selectedConnectorId, updateState, reportError]);
  const onSaveConnectorCredential = useCallback(async (input: {
    credentialValue?: string;
    credentialJson?: string;
    label?: string;
  }) => {
    if (!selectedConnectorId || !selectedConnector) return '';
    const normalizedSecret = String(input.credentialValue || '').trim();
    const normalizedCredentialJson = String(input.credentialJson || '').trim();
    if (!normalizedSecret && !normalizedCredentialJson) return '';
    if (selectedConnector.authMode === 'oauth_managed' && authStatus !== 'authenticated') {
      throw new Error('Managed OAuth connectors require an authenticated desktop session.');
    }
    if (selectedConnector.isDraft) {
      const created = await sdkCreateConnector({
        provider: selectedConnector.provider,
        endpoint: selectedConnector.endpoint,
        label: input.label ?? selectedConnector.label,
        credentialValue: normalizedSecret,
        credentialJson: normalizedCredentialJson,
        authMode: selectedConnector.authMode,
        providerAuthProfile: selectedConnector.providerAuthProfile,
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
      credentialJson: normalizedCredentialJson,
      authMode: selectedConnector.authMode,
      providerAuthProfile: selectedConnector.providerAuthProfile,
    });
    updateState((prev) => updateConnectorField(prev, selectedConnectorId, { hasCredential: true }));
    model.onVaultChanged();
    return selectedConnectorId;
  }, [authStatus, selectedConnectorId, selectedConnector, updateState, model]);
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
    try {
      const acquired = await acquireCodexManagedCredential({
        profileId,
        runtime: runtimeConnectors,
        connectorId: selectedConnectorId,
        provider: selectedConnector.provider,
        endpoint: selectedConnector.endpoint,
        label: selectedConnector.label,
        onPending: (pending) => {
          setCodexOAuthPending(pending);
        },
      });
      setTokenDraft('');
      setCodexOAuthPending(null);
      setTokenSavedConnectorId(acquired.connectorId || selectedConnectorId);
      updateState((prev) => updateConnectorField(prev, acquired.connectorId || selectedConnectorId, { hasCredential: true }));
      model.onVaultChanged();
    } catch (error) {
      setTokenSaveError(error instanceof Error ? error.message : String(error || 'Codex sign-in failed'));
    } finally {
      setCodexOAuthBusy(false);
    }
  }, [isCodexManagedConnector, model, selectedConnector, selectedConnectorId, updateState]);
  const onChangeConnectorVendor = useCallback(async (vendor: string) => {
    if (!selectedConnector || !canEditVendor) return;
    const previousConnector = selectedConnector;
    const normalizedVendor = vendor as typeof selectedConnector.vendor;
    const provider = vendorToProvider(normalizedVendor);
    const runtimeCatalog = await sdkListProviderCatalog();
    const defaultAuthOption = defaultConnectorAuthOptionForProvider(provider, runtimeCatalog);
    const endpoint = resolveProviderEndpoint(provider, runtimeCatalog);
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
  }, [canEditVendor, selectedConnector, selectedConnectorId, updateState]);
  const onChangeConnectorAuthOption = useCallback((nextValue: string) => {
    if (!selectedConnector || isRuntimeSystem || !isDraft) return;
    const nextOption = authOptions.find((option) => option.value === nextValue) || null;
    if (!nextOption) return;
    updateState((prev) => updateConnectorField(prev, selectedConnectorId, {
      authMode: nextOption.authMode,
      providerAuthProfile: nextOption.providerAuthProfile,
      hasCredential: false,
    }));
    setTokenDraft('');
    setTokenSaveError('');
    setTokenSavedConnectorId('');
  }, [authOptions, isDraft, isRuntimeSystem, selectedConnector, selectedConnectorId, updateState]);
  const saveTokenToVault = async () => {
    if (!selectedConnectorId) return;
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
      {/* Top bar: actions */}
      <div className="flex items-center justify-between gap-3">
        <SectionTitle>
          {t('runtimeConfig.cloud.connectors')}
        </SectionTitle>
        <div className="flex items-center gap-2">
          <Button
            variant="primary"
            size="sm"
            onClick={() => { void onAddConnector().catch((e) => reportError('Add connector failed', e)); }}
            icon={<PlusIcon />}
          >
            {t('runtimeConfig.cloud.addConnector', { defaultValue: 'Add' })}
          </Button>
          <button
            type="button"
            disabled={model.testingConnector || !selectedConnector}
            onClick={() => void model.testSelectedConnector()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-sm font-medium text-[var(--nimi-text-secondary)] shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-[color-mix(in_srgb,var(--nimi-surface-card)_90%,var(--nimi-surface-panel))] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <BoltIcon className="text-[var(--nimi-action-primary-bg)]" />
            {model.testingConnector
              ? t('runtimeConfig.cloud.testing', { defaultValue: 'Testing...' })
              : t('runtimeConfig.cloud.testConnector', { defaultValue: 'Test' })}
          </button>
        </div>
      </div>
      {model.connectorTestFeedback ? (
        <InlineFeedback
          feedback={model.connectorTestFeedback}
          className="w-full"
          title={t('runtimeConfig.cloud.testResult', { defaultValue: 'Connector test' })}
          onDismiss={() => model.setConnectorTestFeedback(null)}
        />
      ) : null}
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
          codexOAuthBusy={codexOAuthBusy}
          codexOAuthPending={codexOAuthPending}
          connectorLabelDraft={connectorLabelDraft}
          isCodexManagedConnector={isCodexManagedConnector}
          isDraft={isDraft}
          isMachineGlobal={isMachineGlobal}
          isRuntimeSystem={isRuntimeSystem}
          isSystemOwned={isSystemOwned}
          model={model}
          onAcquireCodexOAuth={onAcquireCodexOAuth}
          onCommitConnectorLabelDraft={commitConnectorLabelDraft}
          onConnectorLabelDraftChange={setConnectorLabelDraft}
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
    </RuntimePageShell>
  );
}
