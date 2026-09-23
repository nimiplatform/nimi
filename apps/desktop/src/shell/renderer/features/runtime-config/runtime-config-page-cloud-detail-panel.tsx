import type { ProviderCatalogEntry } from '@nimiplatform/sdk/runtime/wire-types';
import type { TFunction } from 'i18next';
import { CheckCircle2, CircleAlert, CircleHelp, KeyRound, LoaderCircle, PencilLine, Sparkles } from 'lucide-react';
import { motion } from 'motion/react';
import { useState } from 'react';
import { ProviderLogoTile } from '../../components/provider-logo-tile.js';
import { useDesktopReducedMotion } from '../../ui/motion/desktop-motion';
import type { CodexOAuthPendingState } from './runtime-config-codex-oauth';
import {
  Button,
  CheckIcon,
  EyeIcon,
  EyeOffIcon,
  Input,
  KeyIcon,
  SearchIcon,
  ServerIcon,
  endpointHost,
} from './runtime-config-page-cloud-primitives';
import { connectorPresentationState } from './runtime-config-page-cloud-connector-list';
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

// One elevated card per concern: the service itself (hero), its settings
// while editing, and the models it exposes. Nothing here reads as a form
// until the person asks to edit.
const CARD_CLASS = 'min-w-0 rounded-[24px] bg-[var(--nimi-surface-card)] p-6 ring-1 ring-inset ring-[var(--nimi-border-subtle)] lg:p-7';
const FIELD_NOTE_CLASS = 'rounded-[var(--nimi-radius-field)] bg-[var(--nimi-surface-panel)] px-4 py-3 text-xs text-[var(--nimi-text-muted)]';

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
    return null;
  }
  const presentation = connectorPresentationState(selectedConnector);
  const vendorLabel = vendorOptions.find(item => item.value === selectedConnector.vendor)?.label ?? selectedConnector.vendor;
  const checking = model.testingConnector;
  const statusPill = {
    healthy: { Icon: CheckCircle2, className: 'bg-[var(--nimi-status-success-soft-bg)] text-[var(--nimi-status-success-soft-text)]', title: t('runtimeConfig.product.connectionChecked') },
    unchecked: { Icon: CircleHelp, className: 'bg-[var(--nimi-surface-panel)] text-[var(--nimi-text-secondary)]', title: t('runtimeConfig.product.connectionUnchecked') },
    'needs-credential': { Icon: KeyRound, className: 'bg-[var(--nimi-status-warning-soft-bg)] text-[var(--nimi-status-warning-soft-text)]', title: t('runtimeConfig.product.connectionNeedsCredential') },
    attention: { Icon: CircleAlert, className: 'bg-[var(--nimi-status-danger-soft-bg)] text-[var(--nimi-status-danger-soft-text)]', title: t('runtimeConfig.product.connectionNeedsAttention') },
  }[presentation];
  const modelCount = selectedConnector.models.length;
  const humanError = tokenSaveError ? humanizeConnectorError(tokenSaveError, t) : '';
  const detailError = selectedConnector.lastDetail && presentation === 'attention' ? humanizeConnectorError(selectedConnector.lastDetail, t) : '';
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
    <div className="space-y-4">
      <section
        className="min-w-0 overflow-hidden rounded-[24px] p-6 ring-1 ring-inset ring-[var(--nimi-border-subtle)] lg:p-7"
        style={{ background: 'var(--nimi-surface-hero)' }}
        data-testid="cloud-connection-summary"
      >
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-center gap-4">
            <ProviderLogoTile provider={selectedConnector.provider || selectedConnector.vendor} label={vendorLabel} size="lg" className="shadow-[var(--nimi-elevation-base)]" />
            <div className="min-w-0">
              <h2 className="break-words text-[22px] font-semibold leading-tight tracking-tight text-[var(--nimi-text-primary)]">{selectedConnector.label}</h2>
              {subtitle ? <p className="mt-1 truncate text-sm text-[var(--nimi-text-secondary)]">{subtitle}</p> : null}
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {!isSystemOwned ? (
              <Button variant="ghost" size="sm" disabled={savingToken || codexOAuthBusy} onClick={editing ? stopEditing : startEditing} icon={editing ? undefined : <PencilLine size={15} />}>
                {t(editing ? 'Common.cancel' : 'runtimeConfig.product.editConnection')}
              </Button>
            ) : null}
            {!editing && presentation !== 'needs-credential' ? (
              <Button variant={presentation === 'healthy' ? 'secondary' : 'primary'} size="sm" disabled={checking || savingToken || isDraft} onClick={() => { void model.testSelectedConnector(); }}>
                {t(presentation === 'healthy' ? 'runtimeConfig.product.checkAgain' : 'runtimeConfig.product.checkConnection')}
              </Button>
            ) : null}
            {!editing && presentation === 'needs-credential' && !isSystemOwned ? (
              <Button variant="primary" size="sm" onClick={startEditing} icon={<KeyRound size={14} />}>
                {t('runtimeConfig.product.addCredential')}
              </Button>
            ) : null}
          </div>
        </div>

        <motion.div
          key={`${presentation}:${selectedConnector.lastCheckedAt ?? ''}:${modelCount}:${checking ? 'checking' : 'idle'}`}
          initial={reducedMotion ? false : { opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25 }}
          className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2"
          data-testid={`cloud-connection-state:${presentation}`}
        >
          <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium ${statusPill.className}`}>
            {checking
              ? <LoaderCircle size={15} className="shrink-0 animate-spin" />
              : <statusPill.Icon size={15} className="shrink-0" />}
            {checking
              ? t('runtimeConfig.cloud.testing')
              : presentation === 'healthy' && modelCount > 0
                ? t('runtimeConfig.product.connectionCheckedModels', { count: modelCount })
                : statusPill.title}
          </span>
          {selectedConnector.lastCheckedAt && !checking ? (
            <span className="text-xs text-[var(--nimi-text-muted)]">
              {t('runtimeConfig.product.lastConnectionCheck', { time: new Date(selectedConnector.lastCheckedAt).toLocaleString() })}
            </span>
          ) : null}
          {selectedConnector.lastDetail ? (
            <details className="text-xs text-[var(--nimi-text-muted)]">
              <summary className="cursor-pointer rounded-md hover:text-[var(--nimi-text-secondary)]">{t('runtimeConfig.product.checkDetails')}</summary>
              <p className="mt-2 max-w-2xl break-words rounded-[var(--nimi-radius-field)] bg-[color-mix(in_srgb,var(--nimi-surface-card)_70%,transparent)] px-3 py-2 font-mono text-[11px] leading-relaxed text-[var(--nimi-text-secondary)]">{selectedConnector.lastDetail}</p>
            </details>
          ) : null}
        </motion.div>
        {detailError && !checking ? <p className="mt-3 text-sm text-[var(--nimi-text-secondary)]">{detailError}</p> : null}
      </section>

      {editing ? (
        <section className={CARD_CLASS} aria-label={t('runtimeConfig.product.connectionSettingsTitle')}>
          <h3 className="text-base font-semibold text-[var(--nimi-text-primary)]">{t('runtimeConfig.product.connectionSettingsTitle')}</h3>
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
            {isCodexManagedConnector && codexOAuthPending ? (
              <div className="rounded-[var(--nimi-radius-md)] bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_10%,transparent)] px-3 py-2 text-xs text-[var(--nimi-text-secondary)]">
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
              <div className="rounded-[var(--nimi-radius-md)] bg-[var(--nimi-status-danger-soft-bg)] px-3 py-2 text-sm text-[var(--nimi-status-danger-soft-text)]">
                <p>{humanError}</p>
                <details className="mt-2 text-xs"><summary className="cursor-pointer">{t('runtimeConfig.profiles.technicalDetails')}</summary><p className="mt-1 break-words">{tokenSaveError}</p></details>
              </div>
            )}
          </div>
        </section>
      ) : null}

      <section className={CARD_CLASS} aria-label={t('runtimeConfig.cloud.availableModels', { defaultValue: 'Available Models' })}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="flex items-baseline gap-2 text-base font-semibold text-[var(--nimi-text-primary)]">
            {t('runtimeConfig.cloud.availableModels', { defaultValue: 'Available Models' })}
            {modelCount ? <span className="text-sm font-normal text-[var(--nimi-text-muted)]">{modelCount}</span> : null}
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
          <ul className="mt-4 flex flex-wrap gap-2">
            {model.filteredConnectorModels.map((name) => (
              <li
                key={`connector-${selectedConnector.id}-${name}`}
                className="rounded-full bg-[var(--nimi-surface-panel)] px-3 py-1.5 text-xs font-medium text-[var(--nimi-text-primary)] ring-1 ring-inset ring-[var(--nimi-border-subtle)]"
              >
                {name}
              </li>
            ))}
          </ul>
        ) : (
          <div className="mt-4 flex items-center gap-3 rounded-[var(--nimi-radius-lg)] bg-[var(--nimi-surface-panel)] px-4 py-4">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[var(--nimi-surface-card)] text-[var(--nimi-text-muted)]">
              <Sparkles size={16} />
            </span>
            <p className="text-sm text-[var(--nimi-text-secondary)]">
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
          </div>
        )}
      </section>
    </div>
  );
}
