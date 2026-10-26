import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TextField } from '@nimiplatform/kit/ui';
import { normalizeNimiRuntimeReasonCode, type NimiRuntimeConnectorCatalogEntry } from '@nimiplatform/sdk/runtime';
import { asNimiError } from '@nimiplatform/sdk/types';
import { useAppStore } from '../../app-shell/providers/app-store.js';
import { useRuntimeConfigConnectorSdk } from './runtime-config-connector-sdk-context.js';
import { Button } from './runtime-config-page-cloud-primitives.js';
import type { ApiConnector } from './runtime-config-state-types.js';
import { displayRuntimeConfigCapabilityLabel } from './runtime-config-capability-labels.js';

type CatalogRead = {
  key: string;
  rows: readonly NimiRuntimeConnectorCatalogEntry[];
  loaded: boolean;
  loading: boolean;
  error: string;
};

// @nimi-authority: rule.nimi.desktop.ai-consumption.cloud-services-workspace
export function CloudConnectorCatalog({ connector, onConfigure }: {
  connector: ApiConnector;
  onConfigure?: (entry: NimiRuntimeConnectorCatalogEntry) => void;
}) {
  const { t } = useTranslation();
  const sdk = useRuntimeConfigConnectorSdk();
  const account = useAppStore(state => JSON.stringify([state.auth.status, state.auth.authorizationRevision, state.auth.user?.id]));
  const key = JSON.stringify([account, connector.id, connector.configurationVersion, connector.managementStatus, connector.hasCredential]);
  const [read, setRead] = useState<CatalogRead>({ key: '', rows: [], loaded: false, loading: true, error: '' });
  const [reload, setReload] = useState(0);
  const [query, setQuery] = useState('');
  useEffect(() => {
    let current = true;
    setRead(previous => ({ key, rows: previous.key === key ? previous.rows : [],
      loaded: previous.key === key && previous.loaded, loading: true, error: '' }));
    void sdk.sdkListConnectorCatalog(connector.id, true).then(rows => {
      if (current) setRead({ key, rows, loaded: true, loading: false, error: '' });
    }, error => {
      if (!current) return;
      const reason = normalizeNimiRuntimeReasonCode(asNimiError(error).reasonCode) || 'RUNTIME_CALL_FAILED';
      setRead(previous => ({ ...previous, loading: false, error: reason }));
    });
    return () => { current = false; };
  }, [sdk, key, connector.id, reload]);
  const visible = read.key === key ? read : { key, rows: [], loaded: false, loading: true, error: '' };
  const filtered = visible.rows.filter(row => `${row.modelLabel} ${row.providerModelId} ${row.capabilities.join(' ')}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  return <section className="border-t border-[var(--nimi-border-subtle)] p-6 lg:p-7" data-testid="cloud-model-catalog" aria-busy={visible.loading}>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h3 className="text-base font-semibold text-[var(--nimi-text-primary)]">{t('runtimeConfig.cloudWorkspace.catalogTitle')}
        {visible.loaded && !visible.error ? <span className="ml-2 text-sm font-normal text-[var(--nimi-text-muted)]">{visible.rows.length}</span> : null}
      </h3>
      <Button size="sm" variant="ghost" disabled={visible.loading} onClick={() => setReload(value => value + 1)}>{t('runtimeConfig.cloudWorkspace.reloadCatalog')}</Button>
    </div>
    {visible.loaded && visible.rows.length > 0 ? <div className="mt-4">
      <TextField value={query} onChange={event => setQuery(event.target.value)} aria-label={t('runtimeConfig.cloudWorkspace.searchModels')} placeholder={t('runtimeConfig.cloudWorkspace.searchModels')} />
    </div> : null}
    <div aria-live="polite" className="mt-3 text-sm text-[var(--nimi-text-secondary)]">
      {visible.loading ? <p>{t(visible.loaded ? 'runtimeConfig.cloudWorkspace.refreshingCatalog' : 'Common.loading')}</p> : null}
      {visible.error ? <div role="alert"><p>{t(visible.loaded ? 'runtimeConfig.cloudWorkspace.catalogStale' : 'runtimeConfig.cloudWorkspace.catalogFailed')}</p><p className="mt-1 text-xs">{visible.error}</p></div> : null}
      {visible.loaded && !visible.error && !visible.rows.length ? <p>{t('runtimeConfig.cloudWorkspace.catalogEmpty')}</p> : null}
      {visible.loaded && visible.rows.length > 0 && !filtered.length ? <p>{t('runtimeConfig.setupTask.cloud.noSearchMatches')}</p> : null}
    </div>
    {filtered.length ? <ul className="mt-4 divide-y divide-[var(--nimi-border-subtle)]">
      {filtered.map(row => <li key={row.remoteModelCatalogId} className="flex flex-wrap items-center justify-between gap-3 py-3" data-testid={`cloud-model:${row.remoteModelCatalogId}`}>
        <div className="min-w-0 flex-1">
          <p className="break-words text-sm font-medium text-[var(--nimi-text-primary)]">{row.modelLabel}</p>
          {row.modelLabel !== row.providerModelId ? <p className="mt-1 break-all font-mono text-xs text-[var(--nimi-text-muted)]">{row.providerModelId}</p> : null}
          <p className="mt-1 text-xs text-[var(--nimi-text-secondary)]">{row.capabilities.length ? row.capabilities.map(capability => displayRuntimeConfigCapabilityLabel(capability, t)).join(' · ') : t('runtimeConfig.cloudWorkspace.capabilitiesUnknown')}</p>
          {!row.available ? <p className="mt-1 text-xs text-[var(--nimi-status-warning)]">{t('runtimeConfig.cloudWorkspace.unavailableInCatalog')}</p> : null}
        </div>
        {onConfigure ? <Button size="sm" variant="secondary" disabled={!row.available || connector.managementStatus === 'disabled'} onClick={() => onConfigure(row)}>{t('runtimeConfig.cloudWorkspace.configureUse')}</Button> : null}
      </li>)}
    </ul> : null}
    <details className="mt-4 text-xs text-[var(--nimi-text-muted)]"><summary className="cursor-pointer">{t('runtimeConfig.cloudWorkspace.catalogMeaning')}</summary><p className="mt-2">{t('runtimeConfig.cloudWorkspace.catalogScope')}</p></details>
  </section>;
}
