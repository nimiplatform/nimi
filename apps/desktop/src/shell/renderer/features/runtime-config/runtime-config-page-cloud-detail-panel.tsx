import { humanizeConnectorError } from './runtime-config-connector-error-copy.js';
import type { ProviderCatalogEntry, DesktopConnectorReference } from '@nimiplatform/sdk/runtime/wire-types';
import type { TFunction } from 'i18next';
import { KeyRound, PencilLine } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { ConfirmDialog, Surface } from '@nimiplatform/kit/ui';
import type { NimiRuntimeConnectorCatalogEntry } from '@nimiplatform/sdk/runtime';
import { useHomeNavigation } from '../../app-shell/providers/app-store.js';
import { homeRuntimeDestination } from '../../app-shell/providers/home-navigation.js';
import { CloudConnectorCatalog } from './runtime-config-cloud-catalog.js';
import { CloudConnectorReferences, CloudConnectorUsage } from './runtime-config-cloud-observation.js';
import { ProviderLogoTile } from '../../components/provider-logo-tile.js';
import type { ManagedOAuthPendingState } from './runtime-config-managed-oauth';
import { ChatGPTPlanAccountNotice, ChatGPTPlanPendingNotice, chatGPTPlanSignInLabel } from './runtime-config-chatgpt-plan';
import {
  Button,
  CheckIcon,
  EyeIcon,
  EyeOffIcon,
  Input,
  KeyIcon,
  ServerIcon,
  endpointHost,
} from './runtime-config-page-cloud-primitives';
import { CloudConnectorStatus, connectorPresentationState } from './runtime-config-page-cloud-connector-list';
import type { RuntimeConfigPanelControllerModel } from './runtime-config-panel-types';
import { RuntimeSelect } from './runtime-config-primitives';
import type { RuntimeConfigStateV11 } from './runtime-config-state-types';
import { DEFAULT_CONNECTOR_ENDPOINT_V11 } from './runtime-config-state-types';

type CloudConnector = RuntimeConfigStateV11['connectors'][number];

type CloudConnectorAuthOption = {
  label: string;
  value: string;
};

type CloudConnectorVendorOption = {
  label: string;
  value: string;
};

type CloudConnectorDetailPanelProps = {
  onConfigure?: (entry: NimiRuntimeConnectorCatalogEntry) => void;
  onOpenHistory: () => void;
  onOpenOwner: (reference: DesktopConnectorReference) => void;
  onSaveConnection: (draft: { label: string; endpoint: string; credentialValue: string; }) => Promise<void>;
  authOptions: CloudConnectorAuthOption[];
  authStatus: string;
  canEditCredentialMode: boolean;
  canEditVendor: boolean;
  canStartManagedOAuth: boolean;
  canManageCatalogOverrides: boolean;
  managedOAuthBusy: boolean;
  managedOAuthPending: ManagedOAuthPendingState | null;
  connectorConfigurationLocked: boolean;
  connectorLabelDraft: string;
  isBrowserManagedConnector: boolean;
  isDraft: boolean;
  isMachineGlobal: boolean;
  isRuntimeSystem: boolean;
  isSystemOwned: boolean;
  model: RuntimeConfigPanelControllerModel;
  onAcquireManagedOAuth: () => void;
  onCancelManagedOAuth: () => void;
  onManageCatalogOverrides: () => void;
  onConnectorLabelDraftChange: (label: string) => void;
  onChangeConnectorAuthOption: (nextValue: string) => void;
  onChangeConnectorVendor: (vendor: string) => Promise<void>;
  reportError: (label: string, error: unknown) => void;
  savingToken: boolean;
  selectedAuthOptionValue: string;
  selectedConnector: CloudConnector | null;
  selectedProviderCatalogEntry: ProviderCatalogEntry | null;
  setTokenDraft: (value: string) => void;
  t: TFunction;
  tokenDraft: string;
  tokenSaveError: string;
  tokenSavedConnectorId: string;
  vendorOptions: CloudConnectorVendorOption[];
};

// The selected connection owns the page header, status summary and detail card.
// Connection settings appear only while editing; catalog reads stay independent.
const SECTION_CLASS = 'border-t border-[var(--nimi-border-subtle)] p-4';
const FIELD_NOTE_CLASS = 'rounded-[var(--nimi-radius-field)] bg-[var(--nimi-surface-panel)] px-4 py-3 text-xs text-[var(--nimi-text-muted)]';

export function CloudConnectorDetailPanel(props: CloudConnectorDetailPanelProps) {
  const {
    authOptions,
    authStatus,
    canEditCredentialMode,
    canEditVendor,
    canStartManagedOAuth,
    canManageCatalogOverrides,
    managedOAuthBusy,
    managedOAuthPending,
    connectorConfigurationLocked,
    connectorLabelDraft,
    isBrowserManagedConnector,
    isDraft,
    isMachineGlobal,
    isRuntimeSystem,
    isSystemOwned,
    model,
    savingToken,
    selectedAuthOptionValue,
    selectedConnector,
    selectedProviderCatalogEntry,
    t,
    tokenDraft,
    tokenSaveError,
    tokenSavedConnectorId,
    vendorOptions,
  } = props;
  const navigation = useHomeNavigation();
  const [editing, setEditing] = useState(!isSystemOwned && (isDraft || !selectedConnector?.hasCredential));
  const [endpointDraft, setEndpointDraft] = useState(selectedConnector?.endpoint ?? '');
  const pendingEdits = connectorLabelDraft.trim() !== selectedConnector?.label || endpointDraft.trim() !== selectedConnector?.endpoint || !!tokenDraft.trim();
  const leaveState = useRef({ dirty: editing && pendingEdits, busy: savingToken || managedOAuthBusy });
  leaveState.current = { dirty: editing && pendingEdits, busy: savingToken || managedOAuthBusy };
  const [leavePrompt, setLeavePrompt] = useState<null | ((discard: boolean) => void)>(null);
  const cancelLeave = useRef<(() => void) | null>(null);
  const needsLeaveGuard = Boolean(selectedConnector) && (editing && pendingEdits || savingToken || managedOAuthBusy);
  useEffect(() => {
    if (!needsLeaveGuard) return undefined;
    const unregister = navigation.registerLeaveGuard(({ signal }) => {
      if (signal.aborted) return 'cancel';
      if (leaveState.current.busy) return 'busy';
      if (!leaveState.current.dirty) return 'allow';
      return new Promise<'allow' | 'cancel'>(resolve => {
        const finish = (discard: boolean) => {
          signal.removeEventListener('abort', abort);
          cancelLeave.current = null;
          setLeavePrompt(null);
          resolve(discard ? 'allow' : 'cancel');
        };
        const abort = () => finish(false);
        cancelLeave.current = abort;
        signal.addEventListener('abort', abort, { once: true });
        setLeavePrompt(() => finish);
      });
    });
    return () => { unregister(); cancelLeave.current?.(); };
  }, [navigation, needsLeaveGuard]);
  const save = async () => {
    try { await props.onSaveConnection({ label: connectorLabelDraft, endpoint: endpointDraft, credentialValue: tokenDraft }); setEditing(false); } catch { /* The owner projects the saved/failed state and error. */ }
  };
  if (!selectedConnector) {
    return null;
  }
  const presentation = connectorPresentationState(selectedConnector);
  const vendorLabel = vendorOptions.find(item => item.value === selectedConnector.vendor)?.label ?? selectedConnector.vendor;
  const checking = model.testingConnector;
  const credentialRejected = ['AI_PROVIDER_AUTH_FAILED', 'AI_CONNECTOR_CREDENTIAL_MISSING'].includes(selectedConnector.lastDetail);
  const canRepairCredential = !isSystemOwned && (isBrowserManagedConnector || selectedConnector.authMode === 'api_key');
  const humanError = tokenSaveError ? humanizeConnectorError(tokenSaveError, t, 'save') : '';
  const subtitle = [
    vendorLabel.toLowerCase() !== selectedConnector.label.toLowerCase() ? vendorLabel : '',
    selectedConnector.endpoint ? endpointHost(selectedConnector.endpoint) : '',
  ].filter(Boolean).join(' · ');
  const startEditing = () => {
    setEditing(true);
    setEndpointDraft(selectedConnector.endpoint);
    props.onConnectorLabelDraftChange(selectedConnector.label);
    props.setTokenDraft('');
  };
  const stopEditing = () => {
    setEditing(false);
    setEndpointDraft(selectedConnector.endpoint);
    props.onConnectorLabelDraftChange(selectedConnector.label);
    props.setTokenDraft('');
  };

  return (
    <div className="desktop-module-stack">
      <header className="desktop-module-header">
        <div className="flex min-w-0 flex-1 basis-64 items-start gap-3">
          <ProviderLogoTile provider={selectedConnector.provider || selectedConnector.vendor} label={vendorLabel} size="lg" className="desktop-module-header-icon" />
          <div className="min-w-0">
            <h1 className="desktop-module-title">{selectedConnector.label}</h1>
            {subtitle ? <p className="mt-1 break-words text-sm text-[var(--nimi-text-secondary)]">{subtitle}</p> : null}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {!isSystemOwned && (editing || !credentialRejected || !canRepairCredential) ? (
            <Button variant="ghost" size="sm" disabled={checking || savingToken || managedOAuthBusy} onClick={editing ? stopEditing : startEditing} icon={editing ? undefined : <PencilLine size={15} />}>
              {t(editing ? 'Common.cancel' : 'runtimeConfig.product.editConnection')}
            </Button>
          ) : null}
          {!editing && presentation !== 'needs-credential' && presentation !== 'disabled' ? (
            <Button variant="ghost" size="sm" disabled={checking || savingToken || isDraft} onClick={() => { void model.testSelectedConnector(); }}>
              {t(presentation === 'healthy' ? 'runtimeConfig.product.checkAgain' : 'runtimeConfig.product.checkConnection')}
            </Button>
          ) : null}
          {!editing && presentation === 'needs-credential' && !isSystemOwned ? (
            <Button variant="primary" size="sm" onClick={startEditing} icon={<KeyRound size={14} />}>
              {t('runtimeConfig.product.addCredential')}
            </Button>
          ) : null}
        </div>
      </header>
      <Surface
        as="section"
        tone="hero"
        padding="none"
        className="desktop-module-card"
        data-testid="cloud-connection-summary"
      >
        <div data-testid={`cloud-connection-state:${presentation}`}>
          <CloudConnectorStatus connector={selectedConnector} checking={checking} t={t} />
          {selectedConnector.lastCheckedAt ? <p className="mt-2 text-xs text-[var(--nimi-text-muted)]">{t('runtimeConfig.product.lastConnectionCheck', { time: new Date(selectedConnector.lastCheckedAt).toLocaleString() })}</p> : null}
          {presentation === 'attention' ? <div className="mt-3 space-y-2" role="alert">
            <p className="text-sm text-[var(--nimi-status-danger-soft-text)]">{humanizeConnectorError(selectedConnector.lastDetail, t, 'check')}</p>
            {!editing && credentialRejected && canRepairCredential ? <Button size="sm" variant="primary" disabled={checking || savingToken || (isBrowserManagedConnector && !canStartManagedOAuth)} onClick={() => { startEditing(); if (isBrowserManagedConnector) props.onAcquireManagedOAuth(); }}>
              {isBrowserManagedConnector ? chatGPTPlanSignInLabel({ busy: managedOAuthBusy, isDraft, hasCredential: selectedConnector.hasCredential, t }) : t('runtimeConfig.product.replaceKey')}
            </Button> : null}
            <Button size="sm" variant="secondary" onClick={() => { void navigation.push(homeRuntimeDestination('advancedDiagnostics', { pane: 'activity' })); }}>{t('runtimeConfig.cloudWorkspace.openDiagnostics')}</Button>
          </div> : null}
          {presentation === 'disabled' ? <p className="mt-2 text-sm text-[var(--nimi-text-secondary)]">{t('runtimeConfig.cloudWorkspace.disabledHelp')}</p> : null}
        </div>
        {!editing ? <div className="mt-4 text-xs text-[var(--nimi-text-secondary)]">
          {isBrowserManagedConnector ? <ChatGPTPlanAccountNotice connector={selectedConnector} t={t} /> : <p>{t('runtimeConfig.cloudWorkspace.apiBilling')}</p>}
          <p className="mt-2">{t(isMachineGlobal ? 'runtimeConfig.cloud.managedMachineGlobal' : isRuntimeSystem ? 'runtimeConfig.cloudWorkspace.systemScope' : 'runtimeConfig.cloudWorkspace.accountScope')}</p>
          <details className="mt-2"><summary className="cursor-pointer">{t('runtimeConfig.cloudWorkspace.cloudDataTitle')}</summary><p className="mt-2">{t('runtimeConfig.cloudWorkspace.cloudDataBody')}</p></details>
        </div> : null}
      </Surface>

      <Surface tone="card" padding="none" className="desktop-module-card desktop-module-card--flush overflow-hidden [&>section:first-child]:border-t-0">
        {editing ? (
          <section className={SECTION_CLASS} aria-label={t('runtimeConfig.product.connectionSettingsTitle')}>
            <h2 className="desktop-module-section-title">{t('runtimeConfig.product.connectionSettingsTitle')}</h2>
            <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2">
              {isRuntimeSystem ? (
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-[var(--nimi-text-secondary)]">
                    {t('runtimeConfig.cloud.apiKey', { defaultValue: 'API Key' })}
                  </label>
                  <div className={FIELD_NOTE_CLASS}>
                    {selectedConnector.hasCredential
                      ? t('runtimeConfig.cloud.managedByRuntime', { defaultValue: 'Managed by runtime (environment variable)' })
                      : t('runtimeConfig.cloud.notConfigured', { defaultValue: 'Not configured — set the environment variable in config.json' })}
                  </div>
                </div>
              ) : selectedConnector.authMode === 'oauth_managed' ? (
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-[var(--nimi-text-secondary)]">
                    {t('runtimeConfig.cloud.managedOAuthCredential', { defaultValue: 'Managed OAuth credential' })}
                  </label>
                  <div className={FIELD_NOTE_CLASS}>
                    {t('runtimeConfig.cloud.managedOAuthHostOwned', {
                      defaultValue: 'Use the native sign-in flow below. OAuth tokens are never shown or entered here.',
                    })}
                  </div>
                </div>
              ) : (
                <Input
                  label={isDraft
                    ? t('runtimeConfig.cloud.apiKeyRequired', { defaultValue: 'API Key (required)' })
                    : t('runtimeConfig.product.replaceKey')}
                  value={tokenDraft}
                  onChange={props.setTokenDraft}
                  type={model.showCloudApiKey ? 'text' : 'password'}
                  placeholder={t('runtimeConfig.product.keyPlaceholder')}
                  icon={<KeyIcon />}
                  rightAccessory={(
                    <button
                      type="button"
                      onClick={() => model.setShowCloudApiKey((v) => !v)}
                      aria-label={model.showCloudApiKey
                        ? t('Auth.hidePassword', { defaultValue: 'Hide' })
                        : t('Auth.showPassword', { defaultValue: 'Show' })}
                      title={model.showCloudApiKey
                        ? t('Auth.hidePassword', { defaultValue: 'Hide' })
                        : t('Auth.showPassword', { defaultValue: 'Show' })}
                      className="flex h-7 w-7 items-center justify-center rounded-md text-[var(--nimi-text-muted)] transition-colors hover:bg-[var(--nimi-action-ghost-hover)] hover:text-[var(--nimi-action-primary-bg)] focus:outline-none focus:ring-2 focus:ring-[var(--nimi-focus-ring-color)]"
                    >
                      {model.showCloudApiKey ? <EyeOffIcon /> : <EyeIcon />}
                    </button>
                  )}
                />
              )}
              <Input
                label={t('runtimeConfig.product.optionalConnectionName')}
                value={connectorLabelDraft}
                onChange={props.onConnectorLabelDraftChange}
                placeholder={vendorLabel}
                disabled={isRuntimeSystem || connectorConfigurationLocked}
                icon={<ServerIcon />}
              />
            </div>

            <details className="mt-4 rounded-[var(--nimi-radius-lg)] bg-[var(--nimi-surface-panel)] p-4" open={Boolean(selectedProviderCatalogEntry?.requiresExplicitEndpoint)}>
              <summary className="cursor-pointer text-sm font-medium text-[var(--nimi-text-secondary)]">{t('runtimeConfig.product.connectionOptions')}</summary>
              <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
                <Input
                  label={t('runtimeConfig.cloud.endpoint', { defaultValue: 'Endpoint' })}
                  value={endpointDraft}
                  onChange={setEndpointDraft}
                  placeholder={selectedProviderCatalogEntry?.defaultEndpoint || DEFAULT_CONNECTOR_ENDPOINT_V11}
                  // Browser sign-in Connectors keep the provider's fixed endpoint.
                  disabled={isRuntimeSystem || connectorConfigurationLocked || isBrowserManagedConnector}
                />
                {canEditVendor ? (
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-[var(--nimi-text-secondary)]">
                      {t('runtimeConfig.cloud.vendor', { defaultValue: 'Vendor' })}
                    </label>
                    <RuntimeSelect
                      value={selectedConnector.vendor}
                      onChange={(nextVendor) => { void props.onChangeConnectorVendor(nextVendor).catch((err) => props.reportError('Switch vendor failed', err)); }}
                      disabled={!canEditVendor}
                      className="w-full"
                      options={vendorOptions}
                      searchable
                      searchPlaceholder={t('runtimeConfig.cloud.searchVendors', { defaultValue: 'Search vendors...' })}
                    />
                  </div>
                ) : null}
                {!isRuntimeSystem && authOptions.length > 1 ? (
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-[var(--nimi-text-secondary)]">
                      {t('runtimeConfig.cloud.credentialType', { defaultValue: 'Credential Type' })}
                    </label>
                    <RuntimeSelect
                      value={selectedAuthOptionValue}
                      onChange={props.onChangeConnectorAuthOption}
                      disabled={!canEditCredentialMode}
                      className="w-full"
                      options={authOptions}
                    />
                  </div>
                ) : null}
              </div>
              {selectedProviderCatalogEntry?.inventoryMode === 'dynamic_endpoint' ? (
                <p className="mt-3 text-xs text-[var(--nimi-text-muted)]">
                  {t('runtimeConfig.cloud.liveInventoryHint', {
                    defaultValue: 'This provider loads its catalog from the connector endpoint. Runtime selects an admitted implementation when execution starts.',
                  })}
                </p>
              ) : null}
              <p className="mt-3 font-mono text-[11px] text-[var(--nimi-text-muted)]">ID: {selectedConnector.id}</p>
            </details>

            <div className="mt-5 flex flex-wrap items-center gap-2">
              {!isSystemOwned && (!isDraft || selectedConnector.authMode !== 'oauth_managed') && (
                <Button
                  variant="primary"
                  size="sm"
                  disabled={savingToken || connectorConfigurationLocked || (!pendingEdits && !isDraft) || (isDraft && !tokenDraft.trim())}
                  onClick={() => void save()}
                  icon={savingToken ? undefined : <CheckIcon />}
                >
                  {savingToken
                    ? t('runtimeConfig.cloud.saving', { defaultValue: 'Saving...' })
                    : t('runtimeConfig.product.saveAndCheck')}
                </Button>
              )}
              {isBrowserManagedConnector ? (
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={!canStartManagedOAuth}
                  onClick={() => { void props.onAcquireManagedOAuth(); }}
                >
                  {chatGPTPlanSignInLabel({ busy: managedOAuthBusy, isDraft, hasCredential: selectedConnector.hasCredential, t })}
                </Button>
              ) : null}
              {canManageCatalogOverrides ? (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={props.onManageCatalogOverrides}
                >
                  {t('runtimeConfig.catalogOverrides.manage', { defaultValue: 'Manage custom models' })}
                </Button>
              ) : null}
            </div>

            <div className="mt-4 space-y-2 empty:hidden">
              {isMachineGlobal ? (
                <p className="text-xs text-[var(--nimi-text-secondary)]">
                  {t('runtimeConfig.cloud.managedMachineGlobal', { defaultValue: 'Shared across accounts on this machine' })}
                </p>
              ) : null}
              {selectedConnector.authMode === 'oauth_managed' && authStatus !== 'authenticated' ? (
                <p className="rounded-[var(--nimi-radius-md)] bg-[var(--nimi-status-warning-soft-bg)] px-3 py-2 text-xs text-[var(--nimi-status-warning-soft-text)]">
                  {t('runtimeConfig.cloud.oauthRequiresAuth', {
                    defaultValue: 'Managed OAuth connectors require an authenticated desktop session before they can be created.',
                  })}
                </p>
              ) : null}
              {isBrowserManagedConnector && managedOAuthPending ? (
                <ChatGPTPlanPendingNotice pending={managedOAuthPending} onCancel={props.onCancelManagedOAuth} t={t} />
              ) : null}
              {isBrowserManagedConnector && !isDraft ? (
                <ChatGPTPlanAccountNotice connector={selectedConnector} t={t} />
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
                <div className="rounded-[var(--nimi-radius-md)] bg-[var(--nimi-status-danger-soft-bg)] px-3 py-2 text-sm text-[var(--nimi-status-danger-soft-text)]">
                  <p>{humanError}</p>
                </div>
              )}
            </div>
          </section>
        ) : null}

        {!isDraft ? <CloudConnectorCatalog connector={selectedConnector} onConfigure={props.onConfigure} /> : null}
        {!isDraft ? <CloudConnectorReferences connectorId={selectedConnector.id} onOpenOwner={props.onOpenOwner} /> : null}
        {!isDraft ? <CloudConnectorUsage connectorId={selectedConnector.id} onOpenHistory={props.onOpenHistory} /> : null}
      </Surface>
      <ConfirmDialog open={leavePrompt !== null} title={t('runtimeConfig.cloudWorkspace.unsavedTitle')} message={t('runtimeConfig.cloudWorkspace.unsavedBody')} confirmLabel={t('runtimeConfig.cloudWorkspace.discard')} cancelLabel={t('Common.cancel')} confirmTone="danger" onClose={() => leavePrompt?.(false)} onConfirm={() => leavePrompt?.(true)} />
    </div>
  );
}
