import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getPlatformClient } from '@nimiplatform/sdk';
import type { ProviderCatalogEntry } from '@nimiplatform/sdk/runtime';
import type { RuntimeConfigStateV11 } from '@renderer/features/runtime-config/runtime-config-state-types';
import { DEFAULT_OPENAI_ENDPOINT_V11, VENDOR_ORDER_V11, getVendorLabelV11, randomIdV11, type ApiVendor } from '@renderer/features/runtime-config/runtime-config-state-types';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { defaultConnectorAuthOptionForProvider, listConnectorAuthOptionsForProvider, providerToVendor, resolveProviderEndpoint, sdkCreateConnector, sdkDeleteConnector, sdkListConnectors, sdkListProviderCatalog, sdkUpdateConnector, vendorToProvider } from './runtime-config-connector-sdk-service';
import { addConnectorToState, inferVendorFromEndpoint, removeSelectedConnector, replaceConnectorsInState, updateConnectorField } from './runtime-config-connector-actions';
import { formatRuntimeConfigErrorBanner } from './runtime-config-connector-error';
import type { RuntimeConfigPanelControllerModel } from './runtime-config-panel-types';
import { Card as PrimitiveCard, RuntimeSelect, StatusBadge, renderModelChips } from './runtime-config-primitives';
import { RuntimePageShell } from './runtime-config-page-shell';
import { SectionTitle as SharedSectionTitle } from '@renderer/features/settings/settings-layout-components';
import { E2E_IDS } from '@renderer/testability/e2e-ids';
import { InlineFeedback } from '@renderer/ui/feedback/inline-feedback';
import { acquireCodexManagedCredential, type CodexOAuthPendingState } from './runtime-config-codex-oauth';
import { BoltIcon, Button, CheckIcon, CloudIcon, EyeIcon, EyeOffIcon, Input, KeyIcon, PlusIcon, SearchIcon, ServerIcon, TrashIcon } from './runtime-config-page-cloud-primitives';
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
  const [savingToken, setSavingToken] = useState(false);
  const [tokenSaveError, setTokenSaveError] = useState('');
  const [tokenSavedConnectorId, setTokenSavedConnectorId] = useState('');
  const [codexOAuthPending, setCodexOAuthPending] = useState<CodexOAuthPendingState | null>(null);
  const [codexOAuthBusy, setCodexOAuthBusy] = useState(false);
  const selectedConnectorId = selectedConnector?.id || '';
  const connectorScope = selectedConnector?.scope || 'user';
  const isRuntimeSystem = connectorScope === 'runtime-system';
  const isMachineGlobal = connectorScope === 'machine-global';
  const isSystemOwned = isRuntimeSystem;
  const isDraft = selectedConnector?.isDraft || false;
  const canEditVendor = !isRuntimeSystem && isDraft;
  const authOptions = useMemo(
    () => listConnectorAuthOptionsForProvider(selectedConnector?.provider || ''),
    [selectedConnector?.provider],
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
  const isCodexManagedConnector = selectedConnector?.authMode === 'oauth_managed'
    && selectedConnector?.providerAuthProfile === 'openai_codex';
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
    const known = [...VENDOR_ORDER_V11];
    const knownSet = new Set(known);
    const dynamicProviders = providerCatalog
      .filter((entry) => entry.managedSupported && entry.provider !== 'local')
      .map((entry) => providerToVendor(entry.provider))
      .filter((vendor) => Boolean(vendor) && !knownSet.has(vendor));
    const orderedDynamicProviders = Array.from(new Set(dynamicProviders))
      .sort((left, right) => getVendorLabelV11(left).localeCompare(getVendorLabelV11(right)));
    return [...known, ...orderedDynamicProviders].map((vendor) => ({
      value: vendor,
      label: getVendorLabelV11(vendor),
    }));
  }, [providerCatalog]);
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
  useEffect(() => {
    const unsubscribe = getPlatformClient().runtime.events.on('runtime.connected', () => {
      void loadProviderCatalog()
        .catch((error) => {
          reportError(PROVIDER_CATALOG_ERROR_LABEL, error);
        });
      void refreshConnectorsFromSdk()
        .catch((error) => {
          reportError(CONNECTORS_LOAD_ERROR_LABEL, error);
        });
    });
    return unsubscribe;
  }, [
    loadProviderCatalog,
    refreshConnectorsFromSdk,
    reportError,
    PROVIDER_CATALOG_ERROR_LABEL,
    CONNECTORS_LOAD_ERROR_LABEL,
  ]);
  const onAddConnector = useCallback(async () => {
    const vendor: ApiVendor = 'openrouter';
    const provider = vendorToProvider(vendor);
    const defaultAuthOption = defaultConnectorAuthOptionForProvider(provider);
    const runtimeCatalog = await sdkListProviderCatalog();
    const endpoint = resolveProviderEndpoint(provider, runtimeCatalog)
      || DEFAULT_OPENAI_ENDPOINT_V11;
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
    updateState((prev) => addConnectorToState(prev, draft));
  }, [authStatus, state.connectors.length, updateState]);
  const onRemoveSelectedConnector = useCallback(async () => {
    if (!selectedConnectorId) return;
    if (isRuntimeSystem) return;
    if (selectedConnector?.isDraft) {
      updateState((prev) => removeSelectedConnector(prev, selectedConnectorId));
      return;
    }
    await sdkDeleteConnector(selectedConnectorId);
    await refreshConnectorsFromSdk();
  }, [isRuntimeSystem, selectedConnectorId, selectedConnector, updateState, refreshConnectorsFromSdk]);
  const onSelectConnector = useCallback((connectorId: string) => {
    updateState((prev) => ({ ...prev, selectedConnectorId: connectorId }));
  }, [updateState]);
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
  const onChangeConnectorEndpoint = useCallback((endpoint: string) => {
    if (!selectedConnector || isRuntimeSystem) return;
    const previousConnector = selectedConnector;
    updateState((prev) => {
      const currentVendor = prev.connectors.find((c) => c.id === selectedConnectorId)?.vendor;
      const inferredVendor = inferVendorFromEndpoint(endpoint);
      if (inferredVendor && inferredVendor !== currentVendor) {
        const inferredProvider = vendorToProvider(inferredVendor);
        const defaultAuthOption = defaultConnectorAuthOptionForProvider(inferredProvider);
        return updateConnectorField(prev, selectedConnectorId, {
          vendor: inferredVendor,
          endpoint,
          models: [],
          provider: inferredProvider,
          authMode: defaultAuthOption.authMode,
          providerAuthProfile: defaultAuthOption.providerAuthProfile,
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
  }, [isRuntimeSystem, selectedConnector, selectedConnectorId, updateState, reportError]);
  const onSaveConnectorCredential = useCallback(async (input: {
    credentialValue?: string;
    credentialJson?: string;
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
        label: selectedConnector.label,
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
    setCodexOAuthBusy(true);
    setTokenSaveError('');
    setTokenSavedConnectorId('');
    try {
      const acquired = await acquireCodexManagedCredential({
        onPending: (pending) => {
          setCodexOAuthPending(pending);
        },
      });
      const persistedConnectorId = await onSaveConnectorCredential({
        credentialValue: acquired.accessToken,
        credentialJson: acquired.credentialJson,
      });
      setTokenDraft('');
      setCodexOAuthPending(null);
      setTokenSavedConnectorId(persistedConnectorId || selectedConnectorId);
    } catch (error) {
      setTokenSaveError(error instanceof Error ? error.message : String(error || 'Codex sign-in failed'));
    } finally {
      setCodexOAuthBusy(false);
    }
  }, [isCodexManagedConnector, onSaveConnectorCredential, selectedConnector, selectedConnectorId]);
  const onChangeConnectorVendor = useCallback(async (vendor: string) => {
    if (!selectedConnector || !canEditVendor) return;
    const previousConnector = selectedConnector;
    const normalizedVendor = vendor as typeof selectedConnector.vendor;
    const provider = vendorToProvider(normalizedVendor);
    const defaultAuthOption = defaultConnectorAuthOptionForProvider(provider);
    const runtimeCatalog = await sdkListProviderCatalog();
    const endpoint = resolveProviderEndpoint(provider, runtimeCatalog) || DEFAULT_OPENAI_ENDPOINT_V11;
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
      const persistedConnectorId = await onSaveConnectorCredential({ credentialValue: secret });
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
        {/* Left panel — connector list */}
        <PrimitiveCard className="h-[600px] overflow-y-auto p-4">
          {orderedConnectors.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center text-center">
              <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--nimi-surface-card)_78%,var(--nimi-surface-panel))]">
                <CloudIcon className="h-6 w-6 text-[color-mix(in_srgb,var(--nimi-text-muted)_80%,transparent)]" />
              </div>
              <p className="text-sm font-medium text-[var(--nimi-text-primary)]">{t('runtimeConfig.cloud.noConnectors', { defaultValue: 'No Connectors' })}</p>
              <p className="text-xs text-[var(--nimi-text-muted)] mt-1">
                {t('runtimeConfig.cloud.noConnectorsHint', { defaultValue: 'Click "Add" to create your first connector' })}
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {orderedConnectors.map((connector) => {
                const active = connector.id === state.selectedConnectorId;
                const isHealthy = connector.status === 'healthy';
                return (
                  <button
                    key={connector.id}
                    type="button"
                    onClick={() => onSelectConnector(connector.id)}
                    className={`w-full rounded-xl border px-4 py-3 text-left text-xs transition-all ${
                      active
                        ? 'border-[color-mix(in_srgb,var(--nimi-action-primary-bg)_32%,transparent)] bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_10%,transparent)] ring-1 ring-mint-200'
                        : 'border-[var(--nimi-border-subtle)] bg-white/90 hover:border-[color-mix(in_srgb,var(--nimi-action-primary-bg)_24%,transparent)] hover:bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_10%,transparent)]/30'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${
                        isHealthy ? 'bg-[var(--nimi-status-success)]' : connector.status === 'unreachable' || connector.status === 'degraded' || connector.status === 'unsupported' ? 'bg-[var(--nimi-status-danger)]' : 'bg-[color-mix(in_srgb,var(--nimi-text-muted)_35%,transparent)]'
                      }`} />
                      <p className="truncate font-semibold text-[var(--nimi-text-primary)]">{connector.label}</p>
                      {connector.scope === 'runtime-system' ? (
                        <span
                          data-testid={E2E_IDS.runtimeConnectorScopeBadge(connector.id)}
                          className="shrink-0 rounded-full bg-[color-mix(in_srgb,var(--nimi-surface-card)_78%,var(--nimi-surface-panel))] px-1.5 py-0.5 text-[9px] text-[var(--nimi-text-muted)]"
                        >
                          {t('runtimeConfig.cloud.runtimeSystem', { defaultValue: 'runtime managed' })}
                        </span>
                      ) : connector.scope === 'machine-global' ? (
                        <span
                          data-testid={E2E_IDS.runtimeConnectorScopeBadge(connector.id)}
                          className="shrink-0 rounded-full bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_12%,transparent)] px-1.5 py-0.5 text-[9px] text-[var(--nimi-action-primary-bg)]"
                        >
                          {t('runtimeConfig.cloud.machineGlobal', { defaultValue: 'machine global' })}
                        </span>
                      ) : connector.isDraft ? (
                        <span className="shrink-0 rounded-full bg-[color-mix(in_srgb,var(--nimi-status-warning)_18%,transparent)] px-1.5 py-0.5 text-[9px] text-[var(--nimi-status-warning)]">
                          {t('runtimeConfig.cloud.draft', { defaultValue: 'draft' })}
                        </span>
                      ) : null}
                    </div>
                    <p className="text-[10px] text-[var(--nimi-text-muted)] mt-0.5">{getVendorLabelV11(connector.vendor)}</p>
                  </button>
                );
              })}
            </div>
          )}
        </PrimitiveCard>
        {/* Right panel — connector config */}
        <PrimitiveCard className="h-[600px] overflow-y-auto p-5">
          {selectedConnector ? (
            <div className="space-y-4">
              {/* Name and Vendor */}
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <Input
                  label={t('runtimeConfig.cloud.connectorName', { defaultValue: 'Connector Name' })}
                  value={selectedConnector.label}
                  onChange={onRenameSelectedConnector}
                  placeholder={t('runtimeConfig.cloud.connectorNamePlaceholder', { defaultValue: 'My API Connector' })}
                  disabled={isRuntimeSystem}
                  icon={<ServerIcon />}
                />
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-[var(--nimi-text-secondary)]">
                    {t('runtimeConfig.cloud.vendor', { defaultValue: 'Vendor' })}
                  </label>
                  <RuntimeSelect
                    value={selectedConnector.vendor}
                    onChange={(nextVendor) => { void onChangeConnectorVendor(nextVendor).catch((err) => reportError('Switch vendor failed', err)); }}
                    disabled={!canEditVendor}
                    className="w-full"
                    options={vendorOptions}
                  />
                  {!canEditVendor ? (
                    <p className="mt-1 text-xs text-[var(--nimi-text-muted)]">
                      {t('runtimeConfig.cloud.vendorImmutableAfterCreate', {
                        defaultValue: 'Vendor is fixed after connector creation. Create a new connector to switch provider.',
                      })}
                    </p>
                  ) : null}
                </div>
              </div>
              {/* Endpoint and Credential */}
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <Input
                  label={t('runtimeConfig.cloud.endpoint', { defaultValue: 'Endpoint' })}
                  value={selectedConnector.endpoint}
                  onChange={onChangeConnectorEndpoint}
                  placeholder={DEFAULT_OPENAI_ENDPOINT_V11}
                  disabled={isRuntimeSystem}
                />
                {isRuntimeSystem ? (
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-[var(--nimi-text-secondary)]">
                      {t('runtimeConfig.cloud.apiKey', { defaultValue: 'API Key' })}
                    </label>
                    <div className="rounded-xl bg-[color-mix(in_srgb,var(--nimi-surface-card)_90%,var(--nimi-surface-panel))] px-4 py-3 ring-1 ring-black/5">
                      <p className="text-xs text-[var(--nimi-text-muted)]">
                        {selectedConnector.hasCredential
                          ? t('runtimeConfig.cloud.managedByRuntime', { defaultValue: 'Managed by runtime (environment variable)' })
                          : t('runtimeConfig.cloud.notConfigured', { defaultValue: 'Not configured — set the environment variable in config.json' })}
                      </p>
                    </div>
                  </div>
                ) : (
                  <Input
                    label={selectedConnector.authMode === 'oauth_managed'
                      ? t('runtimeConfig.cloud.oauthTokenRequired', { defaultValue: 'Managed OAuth Token (required)' })
                      : isDraft
                        ? t('runtimeConfig.cloud.apiKeyRequired', { defaultValue: 'API Key (required)' })
                        : t('runtimeConfig.cloud.sessionApiKey', { defaultValue: 'Session API Key' })}
                    value={tokenDraft}
                    onChange={setTokenDraft}
                    type={model.showCloudApiKey ? 'text' : 'password'}
                    placeholder={selectedConnector.authMode === 'oauth_managed' ? 'access token' : 'sk-...'}
                    icon={<KeyIcon />}
                  />
                )}
              </div>
              {!isRuntimeSystem ? (
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-[var(--nimi-text-secondary)]">
                    {t('runtimeConfig.cloud.credentialType', { defaultValue: 'Credential Type' })}
                  </label>
                  <RuntimeSelect
                    value={selectedAuthOptionValue}
                    onChange={onChangeConnectorAuthOption}
                    disabled={!canEditCredentialMode}
                    className="w-full"
                    options={authOptions}
                  />
                  {!canEditCredentialMode ? (
                    <p className="mt-1 text-xs text-[var(--nimi-text-muted)]">
                      {isDraft
                        ? t('runtimeConfig.cloud.credentialTypeFixedForProvider', {
                          defaultValue: 'This provider exposes a single admitted credential shape in the current runtime profile.',
                        })
                        : t('runtimeConfig.cloud.credentialTypeImmutableAfterCreate', {
                          defaultValue: 'Credential type is fixed after connector creation. Create a new connector to switch auth shape.',
                        })}
                    </p>
                  ) : null}
                </div>
              ) : null}
              {selectedProviderCatalogEntry?.inventoryMode === 'dynamic_endpoint' ? (
                <div className="rounded-xl border border-[color-mix(in_srgb,var(--nimi-action-primary-bg)_20%,transparent)] bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_10%,transparent)] px-4 py-3">
                  <p className="text-sm font-medium text-[var(--nimi-text-primary)]">
                    {t('runtimeConfig.cloud.liveInventoryTitle', { defaultValue: 'Live inventory provider' })}
                  </p>
                  <p className="mt-1 text-xs text-[var(--nimi-text-muted)]">
                    {t('runtimeConfig.cloud.liveInventoryHint', {
                      defaultValue: 'This provider loads models from the connector endpoint at runtime. Configure an explicit default model or choose a live model in route/chat settings.',
                    })}
                  </p>
                </div>
              ) : null}
              {/* Actions */}
              <div className="flex flex-wrap items-center gap-2 pt-2">
                {!isSystemOwned && (
                  <Button
                    variant="primary"
                    size="sm"
                    disabled={!canSaveToken}
                    onClick={() => void saveTokenToVault()}
                    icon={savingToken ? undefined : <CheckIcon />}
                  >
                    {savingToken
                      ? t('runtimeConfig.cloud.saving', { defaultValue: 'Saving...' })
                      : isDraft
                        ? t('runtimeConfig.cloud.createConnector', { defaultValue: 'Create Connector' })
                        : selectedConnector.authMode === 'oauth_managed'
                          ? t('runtimeConfig.cloud.saveManagedToken', { defaultValue: 'Save Token' })
                          : t('runtimeConfig.cloud.saveApiKey', { defaultValue: 'Save API Key' })}
                  </Button>
                )}
                {isCodexManagedConnector ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={!canStartCodexOAuth}
                    onClick={() => { void onAcquireCodexOAuth(); }}
                  >
                    {codexOAuthBusy
                      ? t('runtimeConfig.cloud.codexOauthSigningIn', { defaultValue: 'Waiting for Codex...' })
                      : t('runtimeConfig.cloud.codexOauthStart', { defaultValue: 'Sign in with Codex' })}
                  </Button>
                ) : null}
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => model.setShowCloudApiKey((v) => !v)}
                  icon={model.showCloudApiKey ? <EyeOffIcon /> : <EyeIcon />}
                >
                  {model.showCloudApiKey
                    ? t('Auth.hidePassword', { defaultValue: 'Hide' })
                    : t('Auth.showPassword', { defaultValue: 'Show' })}
                </Button>
                {!isSystemOwned && selectedConnectorId && (
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => { void onRemoveSelectedConnector().catch((e) => reportError('Remove connector failed', e)); }}
                    icon={<TrashIcon />}
                  >
                    {t('runtimeConfig.cloud.deleteConnector', { defaultValue: 'Delete' })}
                  </Button>
                )}
                <div className="flex-1" />
                <StatusBadge status={selectedConnector.status} />
              </div>
              {/* Info Messages */}
              <div className="space-y-2">
                <p className="text-xs text-[color-mix(in_srgb,var(--nimi-text-muted)_80%,transparent)]">ID: {selectedConnector.id}</p>
                {isMachineGlobal ? (
                  <p className="text-xs text-[var(--nimi-action-primary-bg)]">
                    {t('runtimeConfig.cloud.managedMachineGlobal', { defaultValue: 'Shared across accounts on this machine' })}
                  </p>
                ) : null}
                {selectedConnector.hasCredential && (
                  <p className="flex items-center gap-1.5 text-xs text-[var(--nimi-status-success)]">
                    <CheckIcon className="h-3.5 w-3.5" />
                    {t('runtimeConfig.cloud.credentialConfigured', { defaultValue: 'Credential configured' })}
                  </p>
                )}
                {selectedConnector.authMode === 'oauth_managed' && authStatus !== 'authenticated' ? (
                  <p className="text-xs text-[var(--nimi-status-warning)] bg-[color-mix(in_srgb,var(--nimi-status-warning)_12%,transparent)] rounded-lg px-3 py-2">
                    {t('runtimeConfig.cloud.oauthRequiresAuth', {
                      defaultValue: 'Managed OAuth connectors require an authenticated desktop session before they can be created.',
                    })}
                  </p>
                ) : null}
                {isCodexManagedConnector && codexOAuthPending ? (
                  <div className="rounded-lg bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_10%,transparent)] px-3 py-2 text-xs text-[var(--nimi-text-secondary)]">
                    <p className="font-medium text-[var(--nimi-text-primary)]">
                      {t('runtimeConfig.cloud.codexOauthPendingTitle', { defaultValue: 'Complete Codex sign-in' })}
                    </p>
                    <p className="mt-1">
                      {t('runtimeConfig.cloud.codexOauthPendingBody', {
                        defaultValue: 'The browser was opened for Codex sign-in. Enter the code below if prompted, then return here.',
                      })}
                    </p>
                    <p className="mt-2 font-mono text-sm tracking-[0.2em] text-[var(--nimi-action-primary-bg)]">
                      {codexOAuthPending.userCode}
                    </p>
                    <p className="mt-2 break-all">
                      <a
                        href={codexOAuthPending.verificationUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[var(--nimi-action-primary-bg)] underline"
                      >
                        {codexOAuthPending.verificationUrl}
                      </a>
                    </p>
                  </div>
                ) : null}
                {tokenSavedConnectorId === selectedConnector.id && (
                  <p className="flex items-center gap-1.5 text-xs text-[var(--nimi-status-success)]">
                    <CheckIcon className="h-3.5 w-3.5" />
                    {selectedConnector.authMode === 'oauth_managed'
                      ? t('runtimeConfig.cloud.managedCredentialSaved', { defaultValue: 'Managed credential saved successfully' })
                      : t('runtimeConfig.cloud.apiKeySaved', { defaultValue: 'API Key saved successfully' })}
                  </p>
                )}
                {tokenSaveError && (
                  <p className="text-xs text-[var(--nimi-status-danger)] bg-[color-mix(in_srgb,var(--nimi-status-danger)_12%,transparent)] rounded-lg px-3 py-2">{tokenSaveError}</p>
                )}
              </div>
              <div className="h-px bg-[color-mix(in_srgb,var(--nimi-border-subtle)_70%,transparent)]" />
              {/* Models Section */}
              <div className="space-y-3">
                <Input
                  label={t('runtimeConfig.cloud.searchModels', { defaultValue: 'Search Models' })}
                  value={model.connectorModelQuery}
                  onChange={model.setConnectorModelQuery}
                  placeholder={t('runtimeConfig.cloud.searchModelsPlaceholder', { defaultValue: 'Search by model name...' })}
                  icon={<SearchIcon />}
                />
                <div>
                  <p className="text-sm font-medium text-[var(--nimi-text-secondary)] mb-2">
                    {t('runtimeConfig.cloud.availableModels', { defaultValue: 'Available Models' })}
                  </p>
                  {renderModelChips(model.filteredConnectorModels, `connector-${selectedConnector.id}`)}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex h-full flex-col items-center justify-center text-center">
              <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-white/80 ring-1 ring-gray-200">
                <CloudIcon className="h-6 w-6 text-[color-mix(in_srgb,var(--nimi-text-muted)_80%,transparent)]" />
              </div>
              <p className="text-sm font-medium text-[var(--nimi-text-primary)]">
                {t('runtimeConfig.cloud.noConnectorSelected', { defaultValue: 'No Connector Selected' })}
              </p>
              <p className="text-xs text-[var(--nimi-text-muted)] mt-1">
                {t('runtimeConfig.cloud.noConnectorSelectedHint', { defaultValue: 'Select a connector above or create a new one' })}
              </p>
            </div>
          )}
        </PrimitiveCard>
      </div>
    </RuntimePageShell>
  );
}
