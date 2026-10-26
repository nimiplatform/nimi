import { ConfirmDialog, IconButton, StatusBadge, Tooltip, TextField, SegmentedControl } from '@nimiplatform/kit/ui';
import { Trash2 } from 'lucide-react';
import { useState } from 'react';
import { ProviderLogoTile } from '../../components/provider-logo-tile.js';
import { E2E_IDS } from '../../testability/e2e-ids';
import { endpointHost } from './runtime-config-page-cloud-primitives';
import type { RuntimeConfigStateV11 } from './runtime-config-state-types';
import { getVendorLabelV11 } from './runtime-config-state-types';
import { humanizeConnectorError } from './runtime-config-connector-error-copy.js';
import { CloudConnectorReferences } from './runtime-config-cloud-observation.js';

type Translate = (key: string, options?: Record<string, unknown>) => string;
type Connector = RuntimeConfigStateV11['connectors'][number];

export type ConnectorPresentationState = 'healthy' | 'unchecked' | 'needs-credential' | 'attention' | 'disabled';

/** One reading of a connection's state shared by the list and the detail header. */
export function connectorPresentationState(connector: Pick<Connector, 'hasCredential' | 'status'> & Partial<Pick<Connector, 'managementStatus'>>): ConnectorPresentationState {
  if (connector.managementStatus === 'disabled') return 'disabled';
  if (!connector.hasCredential) return 'needs-credential';
  if (connector.status === 'healthy') return 'healthy';
  if (connector.status === 'idle') return 'unchecked';
  return 'attention';
}

// @nimi-authority: rule.nimi.runtime.ai-provider.r025
export function CloudConnectorStatus({ connector, checking = false, t }: { connector: Connector; checking?: boolean; t: Translate }) {
  const state = connectorPresentationState(connector);
  const tone = checking || state === 'unchecked' || state === 'disabled' ? 'neutral' : state === 'healthy' ? 'success' : 'danger';
  const label = t(state === 'disabled' ? 'runtimeConfig.cloudWorkspace.disabled' : checking ? 'runtimeConfig.cloud.testing' : `runtimeConfig.product.${state === 'healthy' ? 'checkedBadge' : state === 'attention' ? 'attentionBadge' : state === 'needs-credential' ? 'credentialMissing' : 'uncheckedBadge'}`);
  return <Tooltip placement="bottom" contentClassName="max-w-xs text-left" content={<div className="space-y-1.5">
    <p>{state === 'disabled' ? t('runtimeConfig.cloudWorkspace.disabledHelp') : checking ? t('runtimeConfig.cloud.testing') : state === 'healthy' ? t('runtimeConfig.product.connectionChecked')
      : state === 'needs-credential' ? t('runtimeConfig.product.connectionNeedsCredential')
        : state === 'unchecked' ? t('runtimeConfig.product.connectionUnchecked') : humanizeConnectorError(connector.lastDetail, t, 'check')}</p>
    {connector.lastCheckedAt ? <p>{t('runtimeConfig.product.lastConnectionCheck', { time: new Date(connector.lastCheckedAt).toLocaleString() })}</p> : null}
  </div>}>
    <span tabIndex={0} className="rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--nimi-focus-ring-color)]" aria-label={label}>
      <StatusBadge tone={tone}>{label}</StatusBadge>
    </span>
  </Tooltip>;
}

/**
 * Connections as a gallery of cards rather than an admin rail: each service
 * reads as a product tile with its identity, host and one quiet status line.
 * The selected card lifts; everything else stays flat on the panel.
 */
export function CloudConnectorListPanel(props: {
  connectors: Connector[];
  deletingConnectorId: string;
  defaultEndpointFor: (connector: Connector) => string;
  onDeleteConnector: (connectorId: string) => Promise<void>;
  onSelectConnector: (connectorId: string) => void;
  selectedConnectorId: string;
  uncheckedCount: number;
  checkingConnectorId?: string;
  t: Translate;
}) {
  const { connectors, t, uncheckedCount } = props;
  const [pendingDelete, setPendingDelete] = useState<Connector | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const visibleConnectors = connectors.filter(connector => {
    const state = connectorPresentationState(connector);
    return `${connector.label} ${connector.vendor} ${connector.accountLabel ?? ''}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
      && (filter === 'all' || filter === 'unchecked' && state === 'unchecked' || filter === 'attention' && ['attention', 'needs-credential', 'disabled'].includes(state));
  });
  const selectedHidden = connectors.some(connector => connector.id === props.selectedConnectorId)
    && !visibleConnectors.some(connector => connector.id === props.selectedConnectorId);
  return (
    <section className="min-w-0" aria-label={t('runtimeConfig.product.yourConnections', { count: connectors.length })}>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2 px-1">
        <h2 className="text-sm font-semibold text-[var(--nimi-text-primary)]">
          {t('runtimeConfig.product.yourConnections', { count: connectors.length })}
        </h2>
        {uncheckedCount > 0 ? (
          <p className="text-xs text-[var(--nimi-text-muted)]">
            {t('runtimeConfig.product.cloudSummaryUnchecked', { count: uncheckedCount })}
          </p>
        ) : null}
      </div>
      <div className="mb-4 space-y-3">
        <TextField value={query} onChange={event => setQuery(event.target.value)} aria-label={t('runtimeConfig.cloudWorkspace.searchConnections')} placeholder={t('runtimeConfig.cloudWorkspace.searchConnections')} />
        <SegmentedControl size="sm" ariaLabel={t('runtimeConfig.cloudWorkspace.filterConnections')} value={filter} onValueChange={setFilter} items={['all', 'attention', 'unchecked'].map(value => ({ value, label: t(`runtimeConfig.cloudWorkspace.filter.${value}`) }))} />
        {selectedHidden ? <p className="text-xs text-[var(--nimi-text-secondary)]">{t('runtimeConfig.cloudWorkspace.selectedHidden')} <button className="underline" onClick={() => { setQuery(''); setFilter('all'); }}>{t('runtimeConfig.cloudWorkspace.clearFilters')}</button></p> : null}
      </div>
      {!visibleConnectors.length ? <p className="py-4 text-sm text-[var(--nimi-text-muted)]">{t('runtimeConfig.product.noServicesMatch')}</p> : null}
      <div className="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(230px,1fr))] xl:grid-cols-1" role="list">
        {visibleConnectors.map((connector) => (
          <CloudConnectorCard
            key={connector.id}
            active={connector.id === props.selectedConnectorId}
            connector={connector}
            checking={connector.id === props.checkingConnectorId}
            duplicateLabel={connectors.some(other => other.id !== connector.id && other.label.trim().toLocaleLowerCase() === connector.label.trim().toLocaleLowerCase())}
            showEndpoint={!props.defaultEndpointFor(connector)
              || connector.endpoint.replace(/\/+$/, '') !== props.defaultEndpointFor(connector).replace(/\/+$/, '')
              || connectors.some((other) => other.id !== connector.id && other.label.trim().toLowerCase() === connector.label.trim().toLowerCase())}
            deleting={connector.id === props.deletingConnectorId}
            onDeleteConnector={async () => setPendingDelete(connector)}
            onSelectConnector={props.onSelectConnector}
            t={t}
          />
        ))}
      </div>
      <ConfirmDialog open={pendingDelete !== null} title={t('runtimeConfig.product.removeConnectionTitle', { name: pendingDelete?.label ?? '' })} message={<><span>{t('runtimeConfig.product.removeConnectionHelp')}</span>{pendingDelete ? <CloudConnectorReferences connectorId={pendingDelete.id} compact /> : null}</>} confirmLabel={t('runtimeConfig.cloud.deleteConnector')} cancelLabel={t('Common.cancel')} confirmTone="danger" onClose={() => setPendingDelete(null)} onConfirm={() => { if (!pendingDelete) return; void props.onDeleteConnector(pendingDelete.id).finally(() => setPendingDelete(null)); }} />
    </section>
  );
}

function CloudConnectorCard(props: {
  active: boolean;
  connector: Connector;
  checking?: boolean;
  duplicateLabel: boolean;
  showEndpoint: boolean;
  deleting: boolean;
  onDeleteConnector: (connectorId: string) => Promise<void>;
  onSelectConnector: (connectorId: string) => void;
  t: Translate;
}) {
  const { active, connector, t } = props;
  const canDelete = !connector.isSystemOwned && connector.scope !== 'runtime-system';
  const vendorLabel = getVendorLabelV11(connector.vendor);
  const host = connector.endpoint ? endpointHost(connector.endpoint) : '';
  const subtitle = [
    vendorLabel.toLowerCase() !== connector.label.toLowerCase() ? vendorLabel : '',
    props.showEndpoint ? host : '',
  ].filter(Boolean).join(' · ');
  return (
    <div
      role="listitem"
      className={`group relative flex flex-col rounded-[16px] p-3 transition-[background-color,box-shadow] duration-200 ${active
        ? 'bg-[var(--nimi-surface-active)] ring-2 ring-inset ring-[var(--nimi-action-primary-bg)]'
        : 'bg-[color-mix(in_srgb,var(--nimi-surface-card)_55%,transparent)] ring-1 ring-inset ring-[var(--nimi-border-subtle)] hover:bg-[var(--nimi-surface-card)]'
        }`}
    >
      <button
        type="button"
        onClick={() => props.onSelectConnector(connector.id)}
        aria-current={active ? 'true' : undefined}
        className="flex min-w-0 flex-1 flex-col text-left focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--nimi-focus-ring-color)] rounded-lg"
      >
        <span className="flex min-w-0 items-start gap-3">
          <ProviderLogoTile provider={connector.provider || connector.vendor} label={vendorLabel} size="md" />
          <span className="min-w-0 flex-1 pr-7">
            <span className="flex min-w-0 items-center gap-2">
              <span className="truncate text-[15px] font-semibold text-[var(--nimi-text-primary)]">{connector.label}</span>
              <CloudConnectorScopeBadge connector={connector} t={t} />
            </span>
            {subtitle ? <span className="mt-0.5 block truncate text-xs text-[var(--nimi-text-muted)]">{subtitle}</span> : null}
            {props.duplicateLabel ? <span className="mt-1 block break-all font-mono text-[11px] text-[var(--nimi-text-muted)]">{connector.id}</span> : null}
          </span>
        </span>
      </button>
      <div className="mt-3"><CloudConnectorStatus connector={connector} checking={props.checking} t={t} /></div>
      {canDelete ? (
        <IconButton
          size="sm"
          tone="ghost"
          aria-label={t('runtimeConfig.cloud.deleteConnector')}
          title={t('runtimeConfig.cloud.deleteConnector')}
          disabled={props.deleting}
          icon={<Trash2 size={14} />}
          className={`absolute right-2.5 top-2.5 text-[var(--nimi-text-muted)] transition-opacity hover:text-[var(--nimi-status-danger)] focus-visible:opacity-100 ${active ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
          onClick={() => { void props.onDeleteConnector(connector.id); }}
        />
      ) : null}
    </div>
  );
}

function CloudConnectorScopeBadge(props: {
  connector: Connector;
  t: Translate;
}) {
  const { connector, t } = props;
  if (connector.scope === 'runtime-system') {
    return (
      <span
        data-testid={E2E_IDS.runtimeConnectorScopeBadge(connector.id)}
        className="shrink-0 rounded-full bg-[var(--nimi-status-neutral-soft-bg)] px-1.5 py-0.5 text-[length:var(--nimi-type-caption-size)] text-[var(--nimi-status-neutral-soft-text)]"
      >
        {t('runtimeConfig.cloud.runtimeSystem', { defaultValue: 'runtime managed' })}
      </span>
    );
  }
  if (connector.scope === 'machine-global') {
    return (
      <span
        data-testid={E2E_IDS.runtimeConnectorScopeBadge(connector.id)}
        className="shrink-0 rounded-full bg-[var(--nimi-status-info-soft-bg)] px-1.5 py-0.5 text-[length:var(--nimi-type-caption-size)] text-[var(--nimi-status-info-soft-text)]"
      >
        {t('runtimeConfig.cloud.machineGlobal', { defaultValue: 'machine global' })}
      </span>
    );
  }
  if (connector.isDraft) {
    return (
      <span className="shrink-0 rounded-full bg-[var(--nimi-status-warning-soft-bg)] px-1.5 py-0.5 text-[length:var(--nimi-type-caption-size)] text-[var(--nimi-status-warning-soft-text)]">
        {t('runtimeConfig.cloud.draft', { defaultValue: 'draft' })}
      </span>
    );
  }
  return null;
}
