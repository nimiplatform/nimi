import type { TFunction } from 'i18next';
import type { ProviderCatalogEntry } from '@nimiplatform/sdk/runtime/wire-types';
import { ScrollArea } from '@nimiplatform/kit/ui';
import type { RuntimeConfigStateV11 } from './runtime-config-state-types';
import { DEFAULT_CONNECTOR_ENDPOINT_V11 } from './runtime-config-state-types';
import type { RuntimeConfigPanelControllerModel } from './runtime-config-panel-types';
import { Card as PrimitiveCard, ModelChips, RuntimeSelect, StatusBadge } from './runtime-config-primitives';
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
  authOptions: CloudConnectorAuthOption[];
  authStatus: string;
  canEditCredentialMode: boolean;
  canEditVendor: boolean;
  canSaveToken: boolean;
  canStartCodexOAuth: boolean;
  codexOAuthBusy: boolean;
  codexOAuthPending: CodexOAuthPendingState | null;
  connectorLabelDraft: string;
  isCodexManagedConnector: boolean;
  isDraft: boolean;
  isMachineGlobal: boolean;
  isRuntimeSystem: boolean;
  isSystemOwned: boolean;
  model: RuntimeConfigPanelControllerModel;
  onAcquireCodexOAuth: () => void;
  onCommitConnectorLabelDraft: () => void;
  onConnectorLabelDraftChange: (label: string) => void;
  onChangeConnectorAuthOption: (nextValue: string) => void;
  onChangeConnectorEndpoint: (endpoint: string) => void;
  onChangeConnectorVendor: (vendor: string) => Promise<void>;
  reportError: (label: string, error: unknown) => void;
  saveTokenToVault: () => Promise<void>;
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

export function CloudConnectorDetailPanel(props: CloudConnectorDetailPanelProps) {
  const {
    authOptions,
    authStatus,
    canEditCredentialMode,
    canEditVendor,
    canSaveToken,
    canStartCodexOAuth,
    codexOAuthBusy,
    codexOAuthPending,
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

  return (
    <PrimitiveCard className="h-[600px] overflow-hidden" hoverMotion={false}>
      <ScrollArea className="h-full" contentClassName="p-5">
        {selectedConnector ? (
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Input
                label={t('runtimeConfig.cloud.connectorName', { defaultValue: 'Connector Name' })}
                value={connectorLabelDraft}
                onChange={props.onConnectorLabelDraftChange}
                onBlur={props.onCommitConnectorLabelDraft}
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
                  onChange={(nextVendor) => { void props.onChangeConnectorVendor(nextVendor).catch((err) => props.reportError('Switch vendor failed', err)); }}
                  disabled={!canEditVendor}
                  className="w-full"
                  options={vendorOptions}
                  searchable
                  searchPlaceholder={t('runtimeConfig.cloud.searchVendors', { defaultValue: 'Search vendors...' })}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Input
                label={t('runtimeConfig.cloud.endpoint', { defaultValue: 'Endpoint' })}
                value={selectedConnector.endpoint}
                onChange={props.onChangeConnectorEndpoint}
                placeholder={selectedProviderCatalogEntry?.defaultEndpoint || DEFAULT_CONNECTOR_ENDPOINT_V11}
                disabled={isRuntimeSystem}
              />
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
              ) : (
                <Input
                  label={selectedConnector.authMode === 'oauth_managed'
                    ? t('runtimeConfig.cloud.oauthTokenRequired', { defaultValue: 'Managed OAuth Token (required)' })
                    : isDraft
                      ? t('runtimeConfig.cloud.apiKeyRequired', { defaultValue: 'API Key (required)' })
                      : t('runtimeConfig.cloud.sessionApiKey', { defaultValue: 'Session API Key' })}
                  value={tokenDraft}
                  onChange={props.setTokenDraft}
                  type={model.showCloudApiKey ? 'text' : 'password'}
                  placeholder={selectedConnector.authMode === 'oauth_managed' ? 'access token' : 'sk-...'}
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
            </div>

            {!isRuntimeSystem ? (
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

            {selectedProviderCatalogEntry?.inventoryMode === 'dynamic_endpoint' ? (
              <div className="rounded-xl border border-[color-mix(in_srgb,var(--nimi-action-primary-bg)_20%,transparent)] bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_10%,transparent)] px-4 py-3">
                <p className="text-sm font-medium text-[var(--nimi-text-primary)]">
                  {t('runtimeConfig.cloud.liveInventoryTitle', { defaultValue: 'Live inventory provider' })}
                </p>
                <p className="mt-1 text-xs text-[var(--nimi-text-muted)]">
                  {t('runtimeConfig.cloud.liveInventoryHint', {
                    defaultValue: 'This provider loads its catalog from the connector endpoint. Runtime selects an admitted implementation when execution starts.',
                  })}
                </p>
              </div>
            ) : null}

            <div className="flex flex-wrap items-center gap-2 pt-2">
              {!isSystemOwned && (
                <Button
                  variant="primary"
                  size="sm"
                  disabled={!canSaveToken}
                  onClick={() => void props.saveTokenToVault()}
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
                  onClick={() => { void props.onAcquireCodexOAuth(); }}
                >
                  {codexOAuthBusy
                    ? t('runtimeConfig.cloud.codexOauthSigningIn', { defaultValue: 'Waiting for Codex...' })
                    : t('runtimeConfig.cloud.codexOauthStart', { defaultValue: 'Sign in with Codex' })}
                </Button>
              ) : null}
              <div className="flex-1" />
              <StatusBadge status={selectedConnector.status} />
            </div>

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
                <p className="rounded-lg bg-[var(--nimi-status-danger-soft-bg)] px-3 py-2 text-xs text-[var(--nimi-status-danger-soft-text)]">{tokenSaveError}</p>
              )}
            </div>

            <div className="h-px bg-[color-mix(in_srgb,var(--nimi-border-subtle)_70%,transparent)]" />
            <div className="space-y-3">
              <Input
                label={t('runtimeConfig.cloud.searchModels', { defaultValue: 'Search Models' })}
                value={model.connectorModelQuery}
                onChange={model.setConnectorModelQuery}
                placeholder={t('runtimeConfig.cloud.searchModelsPlaceholder', { defaultValue: 'Search by model name...' })}
                icon={<SearchIcon />}
              />
              <div>
                <p className="mb-2 text-sm font-medium text-[var(--nimi-text-secondary)]">
                  {t('runtimeConfig.cloud.availableModels', { defaultValue: 'Available Models' })}
                </p>
                <ModelChips
                  models={model.filteredConnectorModels}
                  prefix={`connector-${selectedConnector.id}`}
                />
              </div>
            </div>
          </div>
        ) : (
          <div className="flex h-full flex-col items-center justify-center text-center">
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
        )}
      </ScrollArea>
    </PrimitiveCard>
  );
}
