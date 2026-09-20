import type { ProviderCatalogEntry } from '@nimiplatform/sdk/runtime/wire-types';
import type { TFunction } from 'i18next';
import { CheckCircle2, CircleAlert, CircleHelp, KeyRound, LoaderCircle, PencilLine } from 'lucide-react';
import { motion } from 'motion/react';
import { useState } from 'react';
import { IdentityTile } from '../../components/identity-tile.js';
import { useDesktopReducedMotion } from '../../ui/motion/desktop-motion';
import type { CodexOAuthPendingState } from './runtime-config-codex-oauth';
import {
  Button,
  CheckIcon,
  CloudIcon,
  EyeIcon,
  EyeOffIcon,
  Input,
  KeyIcon,
  SearchIcon,
  ServerIcon,
} from './runtime-config-page-cloud-primitives';
import { connectorPresentationState } from './runtime-config-page-cloud-connector-list';
import type { RuntimeConfigPanelControllerModel } from './runtime-config-panel-types';
import { ModelChips, RuntimeSelect } from './runtime-config-primitives';
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
  onSaveConnection: (draft: { label: string; endpoint: string; credentialValue: string; }) => Promise<void>;
  authOptions: CloudConnectorAuthOption[];
  authStatus: string;
  canEditCredentialMode: boolean;
  canEditVendor: boolean;
  canStartCodexOAuth: boolean;
  canManageCatalogOverrides: boolean;
  codexOAuthBusy: boolean;
  codexOAuthPending: CodexOAuthPendingState | null;
  connectorConfigurationLocked: boolean;
  connectorLabelDraft: string;
  isCodexManagedConnector: boolean;
  isDraft: boolean;
  isMachineGlobal: boolean;
  isRuntimeSystem: boolean;
  isSystemOwned: boolean;
  model: RuntimeConfigPanelControllerModel;
  onAcquireCodexOAuth: () => void;
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

/** Plain-language reading of a save/check failure; the raw text stays in details. */
export function humanizeConnectorError(raw: string, t: TFunction): string {
  const text = raw.toUpperCase();
  if (text.includes('AI_CONNECTOR_INVALID') || text.includes('UNAUTHORIZED') || text.includes('401') || text.includes('INVALID_API_KEY'))
    return t('runtimeConfig.product.errorCredentialRejected');
  if (text.includes('UNREACHABLE') || text.includes('ECONNREFUSED') || text.includes('ENOTFOUND') || text.includes('TIMEOUT') || text.includes('NETWORK'))
    return t('runtimeConfig.product.errorEndpointUnreachable');
  return t('runtimeConfig.product.connectionSaveFailed');
}

function endpointHost(endpoint: string): string {
  try {
    return new URL(endpoint).host;
  } catch {
    return endpoint;
  }
}

export function CloudConnectorDetailPanel(props: CloudConnectorDetailPanelProps) {
  const {
    authOptions,
    authStatus,
    canEditCredentialMode,
    canEditVendor,
    canStartCodexOAuth,
    canManageCatalogOverrides,
    codexOAuthBusy,
    codexOAuthPending,
    connectorConfigurationLocked,
    connectorLabelDraft,
    isCodexManagedConnector,
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
  const reducedMotion = useDesktopReducedMotion();
  const [editing, setEditing] = useState(isDraft || !selectedConnector?.hasCredential);
  const [endpointDraft, setEndpointDraft] = useState(selectedConnector?.endpoint ?? '');
  const pendingEdits = connectorLabelDraft.trim() !== selectedConnector?.label || endpointDraft.trim() !== selectedConnector?.endpoint || !!tokenDraft.trim();
  const save = async () => {
    try { await props.onSaveConnection({ label: connectorLabelDraft, endpoint: endpointDraft, credentialValue: tokenDraft }); setEditing(false); } catch { /* The owner projects the saved/failed state and error. */ }
  };
  if (!selectedConnector) {
    return (
      <div className="min-w-0 rounded-2xl bg-[var(--nimi-surface-card)] p-5 lg:p-6">
        <div className="flex h-full min-h-[160px] flex-col items-center justify-center text-center">
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-[var(--nimi-surface-panel)] ring-1 ring-[var(--nimi-border-subtle)]">
            <CloudIcon className="h-6 w-6 text-[color-mix(in_srgb,var(--nimi-text-muted)_80%,transparent)]" />
          </div>
          <p className="text-sm font-medium text-[var(--nimi-text-primary)]">
            {t('runtimeConfig.cloud.noConnectorSelected', { defaultValue: 'No Connector Selected' })}
          </p>
          <p className="mt-1 text-xs text-[var(--nimi-text-muted)]">
            {t('runtimeConfig.cloud.noConnectorSelectedHint', { defaultValue: 'Select a connector above or create a new one' })}
          </p>
        </div>
      </div>
    );
  }
  const presentation = connectorPresentationState(selectedConnector);
  const vendorLabel = vendorOptions.find(item => item.value === selectedConnector.vendor)?.label ?? selectedConnector.vendor;
  const checking = model.testingConnector;
  const statusCard = {
    healthy: { Icon: CheckCircle2, iconClass: 'text-[var(--nimi-status-success)]', bg: 'bg-[var(--nimi-status-success-soft-bg)]', title: t('runtimeConfig.product.connectionChecked') },
    unchecked: { Icon: CircleHelp, iconClass: 'text-[var(--nimi-text-secondary)]', bg: 'bg-[var(--nimi-surface-panel)]', title: t('runtimeConfig.product.connectionUnchecked') },
    'needs-credential': { Icon: KeyRound, iconClass: 'text-[var(--nimi-status-warning)]', bg: 'bg-[var(--nimi-status-warning-soft-bg)]', title: t('runtimeConfig.product.connectionNeedsCredential') },
    attention: { Icon: CircleAlert, iconClass: 'text-[var(--nimi-status-danger)]', bg: 'bg-[var(--nimi-status-danger-soft-bg)]', title: t('runtimeConfig.product.connectionNeedsAttention') },
  }[presentation];
  const modelCount = selectedConnector.models.length;
  const humanError = tokenSaveError ? humanizeConnectorError(tokenSaveError, t) : '';
  const detailError = selectedConnector.lastDetail && presentation === 'attention' ? humanizeConnectorError(selectedConnector.lastDetail, t) : '';

  return (
    <div className="min-w-0 rounded-2xl bg-[var(--nimi-surface-card)] p-5 lg:p-6">
      <div className="space-y-5">
        <header className="space-y-4" data-testid="cloud-connection-summary">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <IdentityTile seed={selectedConnector.provider || selectedConnector.vendor} label={vendorLabel} size="lg" />
              <div className="min-w-0">
                <h2 className="break-words text-xl font-semibold">{selectedConnector.label}</h2>
                <p className="mt-0.5 truncate text-sm text-[var(--nimi-text-secondary)]">
                  {[
                    vendorLabel.toLowerCase() !== selectedConnector.label.toLowerCase() ? vendorLabel : '',
                    selectedConnector.endpoint ? endpointHost(selectedConnector.endpoint) : '',
                  ].filter(Boolean).join(' · ')}
                </p>
              </div>
            </div>
            {!isSystemOwned ? (
              <Button variant="ghost" size="sm" disabled={savingToken || codexOAuthBusy} onClick={() => { setEditing(value => !value); setEndpointDraft(selectedConnector.endpoint); props.onConnectorLabelDraftChange(selectedConnector.label); props.setTokenDraft(''); }} icon={<PencilLine size={15} />}>{t(editing ? 'Common.cancel' : 'runtimeConfig.product.editConnection')}</Button>
            ) : null}
          </div>
          <motion.div
            key={`${presentation}:${selectedConnector.lastCheckedAt ?? ''}:${modelCount}`}
            initial={reducedMotion ? false : { opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25 }}
            className={`flex flex-wrap items-center gap-3 rounded-xl p-4 ${statusCard.bg}`}
            data-testid={`cloud-connection-state:${presentation}`}
          >
            {checking ? <LoaderCircle size={19} className="shrink-0 animate-spin text-[var(--nimi-text-secondary)]" /> : <statusCard.Icon size={19} className={`shrink-0 ${statusCard.iconClass}`} />}
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">
                {checking
                  ? t('runtimeConfig.cloud.testing')
                  : presentation === 'healthy' && modelCount > 0
                    ? t('runtimeConfig.product.connectionCheckedModels', { count: modelCount })
                    : statusCard.title}
              </p>
              {detailError && !checking ? <p className="mt-0.5 text-xs text-[var(--nimi-text-secondary)]">{detailError}</p> : null}
              {selectedConnector.lastCheckedAt && !checking ? <p className="mt-0.5 text-xs text-[var(--nimi-text-secondary)]">{t('runtimeConfig.product.lastConnectionCheck', { time: new Date(selectedConnector.lastCheckedAt).toLocaleString() })}</p> : null}
            </div>
            {!editing && presentation !== 'needs-credential' ? (
              <Button variant={presentation === 'healthy' ? 'secondary' : 'primary'} size="sm" disabled={checking || savingToken || isDraft} onClick={() => { void model.testSelectedConnector(); }}>{t(presentation === 'healthy' ? 'runtimeConfig.product.checkAgain' : 'runtimeConfig.product.checkConnection')}</Button>
            ) : null}
            {!editing && presentation === 'needs-credential' && !isSystemOwned ? (
              <Button variant="primary" size="sm" onClick={() => { setEditing(true); setEndpointDraft(selectedConnector.endpoint); props.onConnectorLabelDraftChange(selectedConnector.label); }}>{t('runtimeConfig.product.addCredential')}</Button>
            ) : null}
          </motion.div>
          {selectedConnector.lastDetail ? <details className="text-xs text-[var(--nimi-text-secondary)]"><summary className="cursor-pointer">{t('runtimeConfig.product.checkDetails')}</summary><p className="mt-2 break-words">{selectedConnector.lastDetail}</p></details> : null}
        </header>

        {editing ? <div className="space-y-4 border-t border-[var(--nimi-border-subtle)] pt-5">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {isRuntimeSystem ? (
              <div>
                <label className="mb-1.5 block text-sm font-medium text-[var(--nimi-text-secondary)]">
                  {t('runtimeConfig.cloud.apiKey', { defaultValue: 'API Key' })}
                </label>
                <div className="rounded-xl bg-[color-mix(in_srgb,var(--nimi-surface-card)_90%,var(--nimi-surface-panel))] px-4 py-3 ring-1 ring-[var(--nimi-border-subtle)]">
                  <p className="text-xs text-[var(--nimi-text-muted)]">
                    {selectedConnector.hasCredential
                      ? t('runtimeConfig.cloud.managedByRuntime', { defaultValue: 'Managed by runtime (environment variable)' })
                      : t('runtimeConfig.cloud.notConfigured', { defaultValue: 'Not configured — set the environment variable in config.json' })}
                  </p>
                </div>
              </div>
            ) : selectedConnector.authMode === 'oauth_managed' ? (
              <div>
                <label className="mb-1.5 block text-sm font-medium text-[var(--nimi-text-secondary)]">
                  {t('runtimeConfig.cloud.managedOAuthCredential', { defaultValue: 'Managed OAuth credential' })}
                </label>
                <div className="rounded-xl bg-[color-mix(in_srgb,var(--nimi-surface-card)_90%,var(--nimi-surface-panel))] px-4 py-3 ring-1 ring-[var(--nimi-border-subtle)]">
                  <p className="text-xs text-[var(--nimi-text-muted)]">
                    {t('runtimeConfig.cloud.managedOAuthHostOwned', {
                      defaultValue: 'Use the native sign-in flow below. OAuth tokens are never shown or entered here.',
                    })}
                  </p>
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

          <details className="rounded-xl border border-[var(--nimi-border-subtle)] p-3" open={Boolean(selectedProviderCatalogEntry?.requiresExplicitEndpoint)}>
            <summary className="cursor-pointer text-sm text-[var(--nimi-text-secondary)]">{t('runtimeConfig.product.connectionOptions')}</summary>
            <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-2">
              <Input
                label={t('runtimeConfig.cloud.endpoint', { defaultValue: 'Endpoint' })}
                value={endpointDraft}
                onChange={setEndpointDraft}
                placeholder={selectedProviderCatalogEntry?.defaultEndpoint || DEFAULT_CONNECTOR_ENDPOINT_V11}
                disabled={isRuntimeSystem || connectorConfigurationLocked}
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
            <p className="mt-3 text-xs text-[var(--nimi-text-muted)]">ID: {selectedConnector.id}</p>
          </details>

          <div className="flex flex-wrap items-center gap-2 pt-1">
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
            {isCodexManagedConnector ? (
              <Button
                variant="secondary"
                size="sm"
                disabled={!canStartCodexOAuth}
                onClick={() => { void props.onAcquireCodexOAuth(); }}
              >
                {codexOAuthBusy
                  ? t('runtimeConfig.cloud.codexOauthSigningIn', { defaultValue: 'Waiting for Codex...' })
                  : t('runtimeConfig.cloud.codexOauthStart', { defaultValue: 'Sign in with Codex' })}
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

          <div className="space-y-2">
            {isMachineGlobal ? (
              <p className="text-xs text-[var(--nimi-text-secondary)]">
                {t('runtimeConfig.cloud.managedMachineGlobal', { defaultValue: 'Shared across accounts on this machine' })}
              </p>
            ) : null}
            {selectedConnector.authMode === 'oauth_managed' && authStatus !== 'authenticated' ? (
              <p className="rounded-lg bg-[var(--nimi-status-warning-soft-bg)] px-3 py-2 text-xs text-[var(--nimi-status-warning-soft-text)]">
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
              <div className="rounded-lg bg-[var(--nimi-status-danger-soft-bg)] px-3 py-2 text-sm text-[var(--nimi-status-danger-soft-text)]">
                <p>{humanError}</p>
                <details className="mt-2 text-xs"><summary className="cursor-pointer">{t('runtimeConfig.profiles.technicalDetails')}</summary><p className="mt-1 break-words">{tokenSaveError}</p></details>
              </div>
            )}
          </div>
        </div> : null}

        <div className="border-t border-[var(--nimi-border-subtle)] pt-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-sm font-semibold">
              {t('runtimeConfig.cloud.availableModels', { defaultValue: 'Available Models' })}
              {modelCount ? <span className="ml-2 text-sm font-normal text-[var(--nimi-text-muted)]">{modelCount}</span> : null}
            </h3>
            {selectedConnector.models.length > 6 ? (
              <div className="w-full sm:w-60">
                <Input
                  value={model.connectorModelQuery}
                  onChange={model.setConnectorModelQuery}
                  placeholder={t('runtimeConfig.cloud.searchModelsPlaceholder', { defaultValue: 'Search by model name...' })}
                  icon={<SearchIcon />}
                />
              </div>
            ) : null}
          </div>
          {model.filteredConnectorModels.length ? (
            <ModelChips
              models={model.filteredConnectorModels}
              prefix={`connector-${selectedConnector.id}`}
            />
          ) : (
            <p className="py-4 text-sm text-[var(--nimi-text-secondary)]">
              {t(
                !selectedConnector.hasCredential
                  ? 'runtimeConfig.product.modelsNeedCredential'
                  : selectedConnector.status === 'idle'
                    ? 'runtimeConfig.product.modelsNeedCheck'
                    : presentation === 'attention'
                      ? 'runtimeConfig.product.modelsAfterFix'
                      : 'runtimeConfig.product.modelsNotListed',
              )}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
