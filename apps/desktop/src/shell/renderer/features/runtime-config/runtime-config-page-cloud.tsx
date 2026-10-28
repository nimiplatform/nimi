import {
  isNimiBrowserManagedConnectorProfile,
  NIMI_CHATGPT_PLAN_REVOCATION_UNCONFIRMED_ACTION_HINT,
  type NimiRuntimeConnectorCatalogEntry,
} from '@nimiplatform/sdk/runtime';
import {
  ChatGPTPlanWelcomeDialog,
  chatGPTPlanDisclosureSeen,
  markChatGPTPlanDisclosureSeen,
} from './runtime-config-chatgpt-plan';
import {
  formatNimiRuntimeErrorBanner as formatRuntimeConfigErrorBanner,
} from '@nimiplatform/sdk/runtime';
import { type ProviderCatalogEntry, type DesktopConnectorReference } from '@nimiplatform/sdk/runtime/wire-types';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollArea, Surface } from '@nimiplatform/kit/ui';
import { useAppStore, useHomeDestination, useHomeNavigation } from '../../app-shell/providers/app-store';
import { useDesktopRendererBindings } from '../../renderer/binding-context.js';
import { CatalogOverridesDrawer } from './runtime-config-catalog-overrides-drawer';
import { removeConnectorFromState, replaceConnectorsInState, updateConnectorField } from './runtime-config-connector-actions';
import { RuntimeConfigConnectorCreateDialog } from './runtime-config-connector-create-form';
import {
  useConnectorOAuthAcquisition,
  useInvalidateManagedOAuthOnConfigurationChange,
} from './runtime-config-connector-oauth-session';
import { useRuntimeConfigConnectorSdk } from './runtime-config-connector-sdk-context.js';
import { defaultConnectorAuthOptionForProvider, listConnectorAuthOptionsForProvider, providerToVendor, resolveProviderEndpoint, vendorToProvider } from './runtime-config-connector-sdk-service';
import { CloudConnectorListPanel } from './runtime-config-page-cloud-connector-list';
import { CloudConnectorDetailPanel } from './runtime-config-page-cloud-detail-panel';
import { CloudConnectorUseDialog } from './runtime-config-cloud-use-dialog.js';
import { CloudHistoryDialog } from './runtime-config-cloud-observation.js';
import { openRuntimeSetupTaskFromEntry } from './runtime-setup-task-open.js';
import { currentDesktopAccountIdForSetup } from './runtime-setup-task-ports.js';
import { getRuntimeSetupTaskStore } from './runtime-setup-task-store.js';
import { CloudEmptyState } from './runtime-config-page-cloud-primitives';
import { resetRuntimePageViewport } from './runtime-config-page-shell';
import type { RuntimeConfigPanelControllerModel } from './runtime-config-panel-types';
import { testSelectedConnectorCommand } from './runtime-config-provider-commands.js';
import type { RuntimeConfigStateV11 } from './runtime-config-state-types';
import { getVendorLabelV11, type ApiVendor } from './runtime-config-state-types';
type CloudPageProps = { model: RuntimeConfigPanelControllerModel; state: RuntimeConfigStateV11; };
const PROVIDER_CATALOG_ERROR_LABEL = 'Load provider catalog failed';
const CONNECTORS_LOAD_ERROR_LABEL = 'Load connectors failed';

export function CloudServicesPage({ model, state }: CloudPageProps) {
  const navigation = useHomeNavigation();
  const destination = useHomeDestination();
  const refineConnector = (previousId: string, connectorId: string) => {
    const current = navigation.getSnapshot().current.destination;
    if (current.id === 'cloud' && current.runtime?.connectorId === previousId) void navigation.replace({ id: 'cloud', runtime: { connectorId } });
  };
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
  const [chatGPTPlanWelcomeOpen, setChatGPTPlanWelcomeOpen] = useState(false);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [configureEntry, setConfigureEntry] = useState<{ connectorId: string; entry: NimiRuntimeConnectorCatalogEntry } | null>(null);
  const [historyConnectorRef, setHistoryConnectorRef] = useState<string | null>(null);
  const [catalogOverrideProviderId, setCatalogOverrideProviderId] = useState('');
  const [connectorsLoaded, setConnectorsLoaded] = useState(false);
  const [autoCheckingId, setAutoCheckingId] = useState('');
  const autoChecked = useRef(new Set<string>());
  const connectorsRef = useRef(state.connectors);
  connectorsRef.current = state.connectors;
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
      if (operation.connector.isDraft && !chatGPTPlanDisclosureSeen()) {
        setChatGPTPlanWelcomeOpen(true);
      }
      const acquiredConnectorId = acquired.connectorId;
      autoChecked.current.delete(acquiredConnectorId);
      connectorSdk.clearCaches();
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
            return next;
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
            };
          });
          reportError(CONNECTORS_LOAD_ERROR_LABEL, error);
        }
        if (isCurrent()) refineConnector(operation.connector.id, acquiredConnectorId);
      } else {
        try {
          const connectors = await sdkListConnectors();
          updateState((prev) => {
            const currentConnector = prev.connectors.find((connector) => connector.id === operation.connector.id);
            return isCurrent(currentConnector ?? null)
              ? replaceConnectorsInState(prev, [...connectors, ...prev.connectors.filter(connector => connector.isDraft)]) : prev;
          });
        } catch (error) {
          if (isCurrent()) reportError(CONNECTORS_LOAD_ERROR_LABEL, error);
        }
      }
      if (isCurrent()) {
        model.onVaultChanged();
      }
    },
  });
  const managedOAuthBusy = connectorOAuth.busy;
  const managedOAuthPending = connectorOAuth.pending;
  const selectedConnectorId = selectedConnector?.id || '';
  const contentViewportRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    resetRuntimePageViewport(contentViewportRef.current);
  }, [selectedConnectorId]);
  useEffect(() => {
    if (destination.id === 'cloud' && !destination.runtime?.connectorId && selectedConnectorId) {
      const current = navigation.getSnapshot().current;
      if (current.destination === destination) void navigation.replace({ id: 'cloud', runtime: { connectorId: selectedConnectorId } });
    }
  }, [destination, navigation, selectedConnectorId]);
  const connectorScope = selectedConnector?.scope || 'user';
  const isRuntimeSystem = connectorScope === 'runtime-system';
  const isMachineGlobal = connectorScope === 'machine-global';
  const isSystemOwned = isRuntimeSystem || Boolean(selectedConnector?.isSystemOwned);
  const isDraft = selectedConnector?.isDraft || false;
  const canEditVendor = !isSystemOwned && isDraft && !managedOAuthBusy;
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
  const canEditCredentialMode = !isSystemOwned && isDraft && !managedOAuthBusy && authOptions.length > 1;
  const isBrowserManagedConnector = selectedConnector?.authMode === 'oauth_managed'
    && isNimiBrowserManagedConnectorProfile(selectedConnector?.providerAuthProfile);
  const canStartManagedOAuth = Boolean(selectedConnectorId)
    && !isSystemOwned
    && isBrowserManagedConnector
    && authStatus === 'authenticated'
    && !savingToken
    && !managedOAuthBusy;
  const invalidateManagedOAuth = useCallback((message: string) => {
    connectorOAuth.invalidate(message);
    setTokenSavedConnectorId('');
  }, [connectorOAuth.invalidate]);
  useEffect(() => {
    invalidateManagedOAuth('Managed connector selection changed');
    setTokenDraft('');
    setTokenSaveError('');
  }, [invalidateManagedOAuth, selectedConnectorId]);
  // An account switch invalidates any in-flight OAuth operation.
  const oauthAuthStatusRef = useRef(authStatus);
  useEffect(() => {
    if (oauthAuthStatusRef.current !== authStatus) {
      oauthAuthStatusRef.current = authStatus;
      invalidateManagedOAuth('Account changed');
    }
  }, [authStatus, invalidateManagedOAuth]);
  useInvalidateManagedOAuthOnConfigurationChange({
    busy: managedOAuthBusy,
    configuration: JSON.stringify([
      selectedConnector?.authMode,
      selectedConnector?.endpoint,
      selectedConnector?.isDraft,
      selectedConnector?.label,
      selectedConnector?.provider,
      selectedConnector?.providerAuthProfile,
      selectedConnector?.vendor,
    ]),
    invalidate: invalidateManagedOAuth,
  });
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
        setConnectorsLoaded(true);
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
  // @nimi-authority: rule.nimi.runtime.ai-provider.r025
  useEffect(() => {
    if (!connectorsLoaded || autoCheckingId || model.testingConnector) return;
    const candidate = state.connectors.find(connector => connector.hasCredential && !connector.isDraft && connector.managementStatus !== 'disabled'
      && !connector.lastCheckedAt && !autoChecked.current.has(connector.id));
    if (!candidate) return;
    autoChecked.current.add(candidate.id);
    setAutoCheckingId(candidate.id);
    void testSelectedConnectorCommand({ state, selectedConnector: candidate, connectorSdk, now: bindings.clock.now,
      testingConnector: false, updateState, setStatusBanner: () => {}, setControlFeedback: () => {} })
      .finally(() => setAutoCheckingId(''));
  }, [connectorsLoaded, autoCheckingId, state, model.testingConnector, connectorSdk, bindings.clock.now, updateState]);
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
    const actionFocus = model.actionFocus;
    if (actionFocus?.focus !== 'runtime-config-action-focus.cloud-connector-draft') {
      return;
    }
    setCreateDialogOpen(true);
    model.clearActionFocus();
  }, [model.actionFocus, model.clearActionFocus, state.connectors.length]);
  const onDeleteConnector = useCallback(async (connectorId: string) => {
    const connector = state.connectors.find((item) => item.id === connectorId) || null;
    if (!connector || connector.scope === 'runtime-system' || connector.isSystemOwned || deletingConnectorId) return;
    if (connectorId === selectedConnectorId && managedOAuthBusy) {
      invalidateManagedOAuth('Managed connector was deleted');
    }
    setDeletingConnectorId(connectorId);
    try {
      if (connector.isDraft) {
        updateState((prev) => removeConnectorFromState(prev, connectorId));
        return;
      }
      const deleted = await sdkDeleteConnector(connectorId);
      if (deleted.actionHint === NIMI_CHATGPT_PLAN_REVOCATION_UNCONFIRMED_ACTION_HINT) {
        model.setPageFeedback({
          kind: 'warning',
          message: t('runtimeConfig.cloud.chatgptPlanSignOutUnconfirmed', {
            defaultValue: 'The ChatGPT connection was removed and Nimi deleted its saved sign-in, but ChatGPT did not confirm the sign-out on its side.',
          }),
        });
      }
      await refreshConnectorsFromSdk();
    } finally {
      setDeletingConnectorId('');
    }
  }, [deletingConnectorId, invalidateManagedOAuth, model, refreshConnectorsFromSdk, selectedConnectorId, state.connectors, t, updateState]);
  const onSelectConnector = useCallback((connectorId: string) => {
    if (connectorId !== selectedConnectorId && managedOAuthBusy) {
      invalidateManagedOAuth('Managed connector selection changed');
    }
    void navigation.push({ id: 'cloud', runtime: { connectorId } });
  }, [invalidateManagedOAuth, selectedConnectorId, navigation]);
  const onAcquireManagedOAuth = useCallback(() => {
    if (!selectedConnector || !selectedConnectorId || !isBrowserManagedConnector) {
      return;
    }
    setTokenSaveError('');
    setTokenSavedConnectorId('');
    void connectorOAuth.start(selectedConnector);
  }, [connectorOAuth, isBrowserManagedConnector, selectedConnector, selectedConnectorId]);
  const onChangeConnectorVendor = useCallback(async (vendor: string) => {
    if (!selectedConnector || !canEditVendor) return;
    const previousConnector = selectedConnector;
    const normalizedVendor = vendor as typeof selectedConnector.vendor;
    const provider = vendorToProvider(normalizedVendor);
    const runtimeCatalog = await sdkListProviderCatalog();
    const defaultAuthOption = defaultConnectorAuthOptionForProvider(provider, runtimeCatalog);
    const endpoint = resolveProviderEndpoint(provider, runtimeCatalog);
    if (managedOAuthBusy) {
      invalidateManagedOAuth('Managed connector vendor changed');
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
  }, [canEditVendor, invalidateManagedOAuth, sdkListProviderCatalog, selectedConnector, selectedConnectorId, updateState]);
  const onChangeConnectorAuthOption = useCallback((nextValue: string) => {
    if (!selectedConnector || isRuntimeSystem || !isDraft) return;
    const nextOption = authOptions.find((option) => option.value === nextValue) || null;
    if (!nextOption) return;
    if (managedOAuthBusy) {
      invalidateManagedOAuth('Managed connector credential type changed');
    }
    updateState((prev) => updateConnectorField(prev, selectedConnectorId, {
      authMode: nextOption.authMode,
      providerAuthProfile: nextOption.providerAuthProfile,
      hasCredential: false,
    }));
    setTokenDraft('');
    setTokenSaveError('');
    setTokenSavedConnectorId('');
  }, [authOptions, invalidateManagedOAuth, isDraft, isRuntimeSystem, selectedConnector, selectedConnectorId, updateState]);
  const saveConnectionDetails = async (draft: { label: string; endpoint: string; credentialValue: string; }) => {
    const selected = selectedConnector;
    if (!selected || isSystemOwned || managedOAuthBusy) return;
    setSavingToken(true);
    setTokenSaveError('');
    try {
      if (selected.isDraft && selected.authMode !== 'api_key') throw new Error(t('runtimeConfig.cloud.managedOAuthHostOwned'));
      const credentialValue = selected.authMode === 'api_key' ? draft.credentialValue.trim() : '';
      const saved = selected.isDraft
        ? await sdkCreateConnector({ provider: selected.provider, endpoint: draft.endpoint.trim(), label: draft.label.trim() || selected.label, credentialValue, authMode: 'api_key' })
        : await sdkUpdateConnector({ connectorId: selected.id, label: draft.label.trim() || selected.label, endpoint: draft.endpoint.trim(), ...(credentialValue ? { credentialValue, authMode: 'api_key' as const } : {}) });
      if (!saved) throw new Error(t('runtimeConfig.product.connectionSaveFailed'));
      if (!saved.lastCheckedAt) autoChecked.current.delete(saved.id);
      updateState(prev => ({ ...prev, connectors: prev.connectors.map(item => item.id === selected.id ? saved : item) }));
      refineConnector(selected.id, saved.id);
      setTokenDraft('');
      setTokenSavedConnectorId(saved.id);
      model.onVaultChanged();
    } catch (error) {
      setTokenSaveError(error instanceof Error ? error.message : String(error));
      throw error;
    } finally { setSavingToken(false); }
  };
  const uncheckedConnectors = state.connectors.filter((connector) => connector.hasCredential && !connector.isDraft && connector.status === 'idle');
  const hasConnectors = state.connectors.length > 0;
  const openReferencedOwner = (reference: DesktopConnectorReference) => {
    const owner = reference.owner?.owner;
    if (!selectedConnector || !owner || (owner.oneofKind !== 'app' && owner.oneofKind !== 'runtimeLocalAgentSubsystem')) return;
    const connectorRef = selectedConnector.id;
    const store = getRuntimeSetupTaskStore();
    void openRuntimeSetupTaskFromEntry(store, {
      navigation, capabilityContract: reference.capabilityContract,
      loadSource: async origin => {
        const accountId = await currentDesktopAccountIdForSetup();
        if (!accountId) throw new Error('Account required');
        return { kind: owner.oneofKind === 'app' ? 'app' : 'local-agent',
          ...(owner.oneofKind === 'app' ? { ownerAppId: owner.app.appId } : {}), accountId,
          returnFocus: 'home:' + encodeURIComponent(JSON.stringify(origin)) };
      },
      openTask: taskId => {
        const task = store.getSnapshot().tasks.find(item => item.taskId === taskId);
        if (task && !task.draft) store.updateTask(taskId, () => ({ draft: { route: 'cloud', cloudConnectorRef: connectorRef } }));
        model.onOpenSetupTask(taskId);
      },
    }).catch(() => model.setPageFeedback({ kind: 'error', message: t('runtimeConfig.cloudWorkspace.configureFailed') }));
  };
  return (
    <div className="desktop-module-workspace" data-testid="cloud-services-workspace">
      <CloudConnectorListPanel
        defaultEndpointFor={(connector) => resolveProviderEndpoint(connector.provider || vendorToProvider(connector.vendor), providerCatalog)}
        connectors={orderedConnectors}
        deletingConnectorId={deletingConnectorId}
        onDeleteConnector={(connectorId) => onDeleteConnector(connectorId).catch((e) => reportError('Remove connector failed', e))}
        onSelectConnector={onSelectConnector}
        selectedConnectorId={selectedConnectorId}
        checkingConnectorId={autoCheckingId || (model.testingConnector ? selectedConnectorId : '')}
        uncheckedCount={uncheckedConnectors.length}
        onAddConnector={onAddConnector}
        onOpenHistory={() => setHistoryConnectorRef('')}
        t={t}
      />
      <Surface
        as="main"
        tone="panel"
        material="glass-regular"
        padding="none"
        className="desktop-module-panel flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
        data-testid="cloud-services-detail-pane"
      >
        <ScrollArea viewportRef={contentViewportRef} className="min-h-0 flex-1" viewportClassName="[&>div]:!block" contentClassName="desktop-module-content">
          {hasConnectors ? (
            <CloudConnectorDetailPanel
              key={selectedConnector?.id ?? 'empty'}
              onConfigure={entry => { if (selectedConnector) setConfigureEntry({ connectorId: selectedConnector.id, entry }); }}
              onOpenHistory={() => { if (selectedConnector) setHistoryConnectorRef(selectedConnector.id); }}
              onOpenOwner={openReferencedOwner}
              onSaveConnection={saveConnectionDetails}
              authOptions={authOptions}
              authStatus={authStatus}
              canEditCredentialMode={canEditCredentialMode}
              canEditVendor={canEditVendor}
              canStartManagedOAuth={canStartManagedOAuth}
              canManageCatalogOverrides={canManageCatalogOverrides}
              managedOAuthBusy={managedOAuthBusy}
              managedOAuthPending={managedOAuthPending}
              connectorConfigurationLocked={managedOAuthBusy}
              connectorLabelDraft={connectorLabelDraft}
              isBrowserManagedConnector={isBrowserManagedConnector}
              isDraft={isDraft}
              isMachineGlobal={isMachineGlobal}
              isRuntimeSystem={isRuntimeSystem}
              isSystemOwned={isSystemOwned}
              model={{ ...model, testingConnector: model.testingConnector || autoCheckingId === selectedConnectorId }}
              onAcquireManagedOAuth={onAcquireManagedOAuth}
              onCancelManagedOAuth={() => invalidateManagedOAuth('ChatGPT sign-in was canceled')}
              onManageCatalogOverrides={() => setCatalogOverrideProviderId(selectedConnector?.provider || '')}
              onConnectorLabelDraftChange={(label) => {
                if (!managedOAuthBusy) setConnectorLabelDraft(label);
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
          ) : (
            <CloudEmptyState onAddConnector={onAddConnector} t={t} />
          )}
        </ScrollArea>
      </Surface>
      <CatalogOverridesDrawer
        open={Boolean(catalogOverrideProviderId)}
        providerId={catalogOverrideProviderId}
        onClose={() => setCatalogOverrideProviderId('')}
      />
      {configureEntry ? <CloudConnectorUseDialog key={configureEntry.connectorId} connectorId={configureEntry.connectorId} entry={configureEntry.entry} onClose={() => setConfigureEntry(null)} onOpenTask={model.onOpenSetupTask} /> : null}
      {historyConnectorRef !== null ? <CloudHistoryDialog connectorId={historyConnectorRef} onClose={() => setHistoryConnectorRef(null)} /> : null}
      <RuntimeConfigConnectorCreateDialog
        submitLabel={t('runtimeConfig.product.saveAndCheck')}
        open={createDialogOpen}
        connectedProviders={state.connectors.map((connector) => connector.provider)}
        onClose={() => setCreateDialogOpen(false)}
        onCreated={(connectorId) => {
          const entry = navigation.getSnapshot();
          setCreateDialogOpen(false);
          void (async () => {
            try {
              const connectors = await sdkListConnectors();
              updateState((prev) => {
                const drafts = prev.connectors.filter((connector) => connector.isDraft);
                const next = replaceConnectorsInState(prev, [...connectors, ...drafts]);
                return next;
              });
              if (navigation.getSnapshot().generation === entry.generation && navigation.getSnapshot().current.key === entry.current.key) void navigation.push({ id: 'cloud', runtime: { connectorId } });
              const created = connectors.find(connector => connector.id === connectorId);
              if (created && created.authMode === 'oauth_managed' && isNimiBrowserManagedConnectorProfile(created.providerAuthProfile) && !chatGPTPlanDisclosureSeen()) {
                setChatGPTPlanWelcomeOpen(true);
              }
            } catch (error) {
              reportError(CONNECTORS_LOAD_ERROR_LABEL, error);
            }
            model.onVaultChanged();
          })();
        }}
      />
      <ChatGPTPlanWelcomeDialog
        open={chatGPTPlanWelcomeOpen}
        onClose={() => {
          markChatGPTPlanDisclosureSeen();
          setChatGPTPlanWelcomeOpen(false);
        }}
        t={t}
      />
    </div>
  );
}
