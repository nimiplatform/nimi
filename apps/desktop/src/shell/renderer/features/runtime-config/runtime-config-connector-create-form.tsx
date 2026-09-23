// @nimi-authority: rule.nimi.desktop.ai-consumption.r023

import { InlineAlert, OverlayShell, ScrollArea, TextField } from '@nimiplatform/kit/ui';
import type { ProviderCatalogEntry } from '@nimiplatform/sdk/runtime/wire-types';
import { ArrowLeft } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../../app-shell/providers/app-store';
import { ProviderLogoTile } from '../../components/provider-logo-tile.js';
import { useDesktopRendererBindings } from '../../renderer/binding-context.js';
import { useConnectorOAuthAcquisition } from './runtime-config-connector-oauth-session.js';
import { useRuntimeConfigConnectorSdk } from './runtime-config-connector-sdk-context.js';
import {
  connectorAuthProfileForId,
  defaultConnectorAuthOptionForProvider,
  listConnectorAuthOptionsForProvider,
  providerToVendor,
  resolveProviderEndpoint,
} from './runtime-config-connector-sdk-service.js';
import { Button, Input, KeyIcon, ServerIcon } from './runtime-config-page-cloud-primitives.js';
import { RuntimeSelect } from './runtime-config-primitives.js';
import {
  getVendorLabelV11,
  normalizeConnectorV11,
  randomIdV11,
  type ApiConnector,
} from './runtime-config-state-types.js';

/**
 * The single connector creation form: the Cloud page's Add action and the
 * in-task "add a connection" entry render this same implementation. API-key
 * creation goes through the connector SDK service; managed OAuth reuses the
 * shared generation/snapshot acquisition hook, so a stale callback after a
 * page switch, cancel, or account change never writes into newer state.
 */

export function RuntimeConfigConnectorCreateForm(props: {
  readonly onCreated: (connectorId: string) => void;
  readonly onCancel?: () => void;
  readonly testIdPrefix?: string;
  readonly submitLabel?: string;
  /** Provider ids that already have a connection; listed first in the picker. */
  readonly connectedProviders?: readonly string[];
}) {
  const { t } = useTranslation();
  const bindings = useDesktopRendererBindings();
  const { sdkCreateConnector, sdkListProviderCatalog } = useRuntimeConfigConnectorSdk();
  const authStatus = useAppStore((s) => s.auth.status);
  const testId = props.testIdPrefix ?? 'runtime-connector-create';
  const [providerCatalog, setProviderCatalog] = useState<ProviderCatalogEntry[]>([]);
  const [catalogError, setCatalogError] = useState('');
  const [provider, setProvider] = useState('');
  const [label, setLabel] = useState('');
  const [endpoint, setEndpoint] = useState('');
  const [authOptionValue, setAuthOptionValue] = useState('');
  const [tokenDraft, setTokenDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [providerQuery, setProviderQuery] = useState('');

  useEffect(() => {
    let active = true;
    void sdkListProviderCatalog()
      .then((catalog) => {
        if (!active) return;
        setProviderCatalog(Array.isArray(catalog) ? catalog : []);
      })
      .catch((error: unknown) => {
        if (!active) return;
        setCatalogError(error instanceof Error ? error.message : String(error || 'Load provider catalog failed'));
      });
    return () => {
      active = false;
    };
  }, [sdkListProviderCatalog]);

  const managedProviders = useMemo(
    () => providerCatalog.filter((entry) => entry.managedSupported && entry.provider !== 'local').sort((a, b) => getVendorLabelV11(providerToVendor(a.provider)).localeCompare(getVendorLabelV11(providerToVendor(b.provider)))),
    [providerCatalog],
  );
  const resolvedProvider = provider;
  const authOptions = useMemo(
    () => listConnectorAuthOptionsForProvider(resolvedProvider, providerCatalog),
    [providerCatalog, resolvedProvider],
  );
  const resolvedAuthOption = authOptions.find((option) => option.value === authOptionValue)
    ?? (resolvedProvider ? defaultConnectorAuthOptionForProvider(resolvedProvider, providerCatalog) : null);
  const resolvedEndpoint = endpoint || (resolvedProvider ? resolveProviderEndpoint(resolvedProvider, providerCatalog) : '');
  const isOAuthManaged = resolvedAuthOption?.authMode === 'oauth_managed';
  const oauthProfile = connectorAuthProfileForId(resolvedAuthOption?.providerAuthProfile);
  const isCodexManaged = isOAuthManaged && oauthProfile?.headerBehavior === 'codex_oauth';
  const oauthRequiresAuth = isOAuthManaged && authStatus !== 'authenticated';

  // The not-yet-created connector the OAuth operation is bound to. Field
  // changes rebuild it; the acquisition hook's snapshot check then rejects a
  // completion that raced the edit.
  const draftConnectorRef = useRef<ApiConnector | null>(null);
  const buildDraft = useCallback((): ApiConnector => normalizeConnectorV11({
    id: draftConnectorRef.current?.id || randomIdV11('connector-create'),
    label: label.trim() || resolvedProvider,
    vendor: providerToVendor(resolvedProvider),
    provider: resolvedProvider,
    authMode: isOAuthManaged ? 'oauth_managed' : 'api_key',
    providerAuthProfile: resolvedAuthOption?.providerAuthProfile,
    endpoint: resolvedEndpoint,
    scope: authStatus === 'authenticated' ? 'user' : 'machine-global',
    hasCredential: false,
    isDraft: true,
  }), [authStatus, isOAuthManaged, label, resolvedAuthOption?.providerAuthProfile, resolvedEndpoint, resolvedProvider]);
  draftConnectorRef.current = buildDraft();

  const oauth = useConnectorOAuthAcquisition({
    host: bindings.app.commands.connectorAuth,
    findConnector: (connectorId) => (
      draftConnectorRef.current && draftConnectorRef.current.id === connectorId
        ? draftConnectorRef.current
        : null
    ),
    onAcquired: (acquired) => {
      props.onCreated(acquired.connectorId);
    },
    onError: (message) => setSaveError(message),
  });
  const oauthBusy = oauth.busy;

  // Account changes mid-flow invalidate the in-flight OAuth operation.
  const authStatusRef = useRef(authStatus);
  useEffect(() => {
    if (authStatusRef.current !== authStatus) {
      authStatusRef.current = authStatus;
      oauth.invalidate('Account changed');
    }
  }, [authStatus, oauth]);

  const onChangeField = useCallback((apply: () => void) => {
    if (oauthBusy) oauth.invalidate('Connector configuration changed');
    setSaveError('');
    apply();
  }, [oauth, oauthBusy]);

  const submitApiKey = useCallback(async () => {
    const secret = tokenDraft.trim();
    if (!secret || !resolvedProvider || saving || oauthBusy) return;
    setSaving(true);
    setSaveError('');
    try {
      const created = await sdkCreateConnector({
        provider: resolvedProvider,
        endpoint: resolvedEndpoint,
        label: label.trim() || resolvedProvider,
        credentialValue: secret,
        authMode: 'api_key',
      });
      if (!created) throw new Error('create connector returned empty payload');
      props.onCreated(created.id);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error || 'Save failed'));
    } finally {
      setSaving(false);
    }
  }, [label, oauthBusy, props, resolvedEndpoint, resolvedProvider, saving, sdkCreateConnector, tokenDraft]);

  const startOAuth = useCallback(() => {
    if (!draftConnectorRef.current || oauthBusy || oauthRequiresAuth) return;
    setSaveError('');
    void oauth.start(draftConnectorRef.current);
  }, [oauth, oauthBusy, oauthRequiresAuth]);

  const providerLabel = (providerId: string) => getVendorLabelV11(providerToVendor(providerId));
  const query = providerQuery.trim().toLocaleLowerCase();
  const matchingProviders = managedProviders.filter(entry => providerLabel(entry.provider).toLocaleLowerCase().includes(query));
  const connected = new Set(props.connectedProviders ?? []);
  // "Already connected" first: these are the services the person has used
  // before. Everything else stays alphabetical; the catalog carries no
  // category, so none is invented.
  const providerGroups = [
    { key: 'connected', items: matchingProviders.filter(entry => connected.has(entry.provider)) },
    { key: connected.size ? 'others' : 'all', items: matchingProviders.filter(entry => !connected.has(entry.provider)) },
  ].filter(group => group.items.length > 0);
  const chooseProvider = (providerId: string) => onChangeField(() => { setProvider(providerId); setEndpoint(''); setAuthOptionValue(''); setTokenDraft(''); });

  if (!resolvedProvider) return <div className="space-y-4" data-testid={testId}>
    <p className="text-sm text-[var(--nimi-text-secondary)]">{t('runtimeConfig.product.chooseServiceLead')}</p>
    <TextField autoFocus aria-label={t('runtimeConfig.cloud.searchVendors')} placeholder={t('runtimeConfig.cloud.searchVendors')} value={providerQuery} onChange={event => setProviderQuery(event.currentTarget.value)} />
    {catalogError ? <InlineAlert tone="danger">{catalogError}</InlineAlert> : null}
    <ScrollArea className="h-[min(46vh,360px)]" contentClassName="space-y-4 pr-2">
      {providerGroups.map(group => (
        <div key={group.key} className="space-y-1.5">
          {providerGroups.length > 1 || group.key === 'connected' ? (
            <p className="px-1 text-[11px] font-medium uppercase tracking-wide text-[var(--nimi-text-muted)]">{t(`runtimeConfig.product.providerGroup.${group.key}`)}</p>
          ) : null}
          <div className="grid gap-1.5 sm:grid-cols-2">
            {group.items.map(entry => {
              const label = providerLabel(entry.provider);
              return (
                <button
                  key={entry.provider}
                  type="button"
                  className="flex items-center gap-3 rounded-xl px-3 py-2 text-left text-sm hover:bg-[var(--nimi-surface-active)] focus-visible:outline-2 focus-visible:outline-[var(--nimi-focus-ring-color)]"
                  onClick={() => chooseProvider(entry.provider)}
                  data-testid={`${testId}-provider:${entry.provider}`}
                >
                  <ProviderLogoTile provider={entry.provider} label={label} size="sm" />
                  <span className="min-w-0 flex-1 truncate font-medium text-[var(--nimi-text-primary)]">{label}</span>
                  {entry.requiresExplicitEndpoint ? <span className="text-xs text-[var(--nimi-text-muted)]">{t('runtimeConfig.product.needsEndpoint')}</span> : null}
                </button>
              );
            })}
          </div>
        </div>
      ))}
      {managedProviders.length > 0 && !matchingProviders.length ? <p className="py-6 text-sm text-[var(--nimi-text-secondary)]">{t('runtimeConfig.product.noServicesMatch')}</p> : null}
    </ScrollArea>
    {!providerCatalog.length && !catalogError ? <p className="text-sm text-[var(--nimi-text-secondary)]">{t('Common.loading')}</p> : null}
    {props.onCancel ? <Button variant="secondary" size="sm" onClick={props.onCancel}>{t('Common.cancel')}</Button> : null}
  </div>;

  return (
    <div className="space-y-4" data-testid={testId}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <ProviderLogoTile provider={resolvedProvider} label={providerLabel(resolvedProvider)} size="md" />
          <h3 className="text-base font-semibold">{providerLabel(resolvedProvider)}</h3>
        </div>
        <Button variant="ghost" size="sm" disabled={saving || oauthBusy} onClick={() => onChangeField(() => { setProvider(''); setTokenDraft(''); })}><ArrowLeft size={14} />{t('runtimeConfig.product.changeService')}</Button>
      </div>
      {catalogError ? (
        <InlineAlert tone="danger">{catalogError}</InlineAlert>
      ) : null}
      <details className="space-y-3 rounded-xl border border-[var(--nimi-border-subtle)] p-3" open={!resolveProviderEndpoint(resolvedProvider, providerCatalog)}>
        <summary className="cursor-pointer text-sm text-[var(--nimi-text-secondary)]">{t('runtimeConfig.product.connectionOptions')}</summary>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Input
            label={t('runtimeConfig.product.optionalConnectionName')}
            value={label}
            onChange={(next) => onChangeField(() => setLabel(next))}
            placeholder={t('runtimeConfig.cloud.connectorNamePlaceholder', { defaultValue: 'My API Connector' })}
            disabled={oauthBusy}
            icon={<ServerIcon />}
          />
          <div>
            <label className="mb-1.5 block text-sm font-medium text-[var(--nimi-text-secondary)]">
              {t('runtimeConfig.cloud.vendor', { defaultValue: 'Vendor' })}
            </label>
            <RuntimeSelect
              value={resolvedProvider}
              onChange={(nextProvider) => onChangeField(() => {
                setProvider(nextProvider);
                setEndpoint('');
                setAuthOptionValue('');
              })}
              disabled={oauthBusy || managedProviders.length === 0}
              className="w-full"
              options={managedProviders.map((entry) => ({
                value: entry.provider,
                label: getVendorLabelV11(providerToVendor(entry.provider)),
              }))}
              searchable
              searchPlaceholder={t('runtimeConfig.cloud.searchVendors', { defaultValue: 'Search vendors...' })}
            />
          </div>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Input
            label={t('runtimeConfig.cloud.endpoint', { defaultValue: 'Endpoint' })}
            value={resolvedEndpoint}
            onChange={(next) => onChangeField(() => setEndpoint(next))}
            disabled={oauthBusy}
          />
          {authOptions.length > 1 ? (
            <div>
              <label className="mb-1.5 block text-sm font-medium text-[var(--nimi-text-secondary)]">
                {t('runtimeConfig.cloud.credentialType', { defaultValue: 'Credential Type' })}
              </label>
              <RuntimeSelect
                value={resolvedAuthOption?.value ?? ''}
                onChange={(next) => onChangeField(() => {
                  setAuthOptionValue(next);
                  setTokenDraft('');
                })}
                disabled={oauthBusy}
                className="w-full"
                options={authOptions}
              />
            </div>
          ) : null}
        </div>
      </details>
      {!isOAuthManaged ? (
        <Input
          label={t('runtimeConfig.cloud.apiKeyRequired', { defaultValue: 'API Key (required)' })}
          value={tokenDraft}
          onChange={(next) => onChangeField(() => setTokenDraft(next))}
          type="password"
          placeholder={t('runtimeConfig.product.keyPlaceholder')}
          icon={<KeyIcon />}
          disabled={oauthBusy}
        />
      ) : (
        <p className="rounded-xl bg-[color-mix(in_srgb,var(--nimi-surface-card)_90%,var(--nimi-surface-panel))] px-4 py-3 text-xs text-[var(--nimi-text-muted)]">
          {t('runtimeConfig.cloud.managedOAuthHostOwned', {
            defaultValue: 'Use the native sign-in flow below. OAuth tokens are never shown or entered here.',
          })}
        </p>
      )}
      {oauth.pending ? (
        <div className="rounded-lg bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_10%,transparent)] px-3 py-2 text-xs text-[var(--nimi-text-secondary)]">
          <p className="font-medium text-[var(--nimi-text-primary)]">
            {t('runtimeConfig.cloud.codexOauthPendingTitle', { defaultValue: 'Complete Codex sign-in' })}
          </p>
          <p className="mt-2 font-mono text-sm tracking-[0.2em] text-[var(--nimi-action-primary-bg)]">
            {oauth.pending.userCode}
          </p>
          <p className="mt-2 break-all">
            <a
              href={oauth.pending.verificationUrl}
              target="_blank"
              rel="noreferrer"
              className="text-[var(--nimi-action-primary-bg)] underline"
            >
              {oauth.pending.verificationUrl}
            </a>
          </p>
        </div>
      ) : null}
      {oauthRequiresAuth ? (
        <p className="rounded-lg bg-[var(--nimi-status-warning-soft-bg)] px-3 py-2 text-xs text-[var(--nimi-status-warning-soft-text)]">
          {t('runtimeConfig.cloud.oauthRequiresAuth', {
            defaultValue: 'Managed OAuth connectors require an authenticated desktop session before they can be created.',
          })}
        </p>
      ) : null}
      {saveError ? (
        <p className="rounded-lg bg-[var(--nimi-status-danger-soft-bg)] px-3 py-2 text-xs text-[var(--nimi-status-danger-soft-text)]">{saveError}</p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        {!isOAuthManaged ? (
          <Button
            variant="primary"
            size="sm"
            disabled={!tokenDraft.trim() || !resolvedProvider || saving || oauthBusy}
            onClick={() => void submitApiKey()}
          >
            {saving
              ? t('runtimeConfig.cloud.saving', { defaultValue: 'Saving...' })
              : props.submitLabel ?? t('runtimeConfig.cloud.createConnector', { defaultValue: 'Create Connector' })}
          </Button>
        ) : isCodexManaged ? (
          <Button
            variant="primary"
            size="sm"
            disabled={oauthBusy || oauthRequiresAuth || !resolvedProvider}
            onClick={startOAuth}
          >
            {oauthBusy
              ? t('runtimeConfig.cloud.codexOauthSigningIn', { defaultValue: 'Waiting for Codex...' })
              : t('runtimeConfig.cloud.codexOauthStart', { defaultValue: 'Sign in with Codex' })}
          </Button>
        ) : null}
        {props.onCancel ? (
          <Button variant="secondary" size="sm" onClick={props.onCancel} disabled={saving}>
            {t('Common.cancel', { defaultValue: 'Cancel' })}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export function RuntimeConfigConnectorCreateDialog(props: {
  readonly submitLabel?: string;
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onCreated: (connectorId: string) => void;
  readonly connectedProviders?: readonly string[];
}) {
  const { t } = useTranslation();
  if (!props.open) return null;
  return (
    <OverlayShell
      open
      kind="dialog"
      size="md"
      onClose={props.onClose}
      title={t('runtimeConfig.cloud.addConnector', { defaultValue: 'Add' })}
      dataTestId="runtime-connector-create-dialog"
    >
      <RuntimeConfigConnectorCreateForm
        submitLabel={props.submitLabel}
        onCreated={props.onCreated}
        onCancel={props.onClose}
        testIdPrefix="runtime-connector-create"
        connectedProviders={props.connectedProviders}
      />
    </OverlayShell>
  );
}
