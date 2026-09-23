import { ConfirmDialog, IconButton } from '@nimiplatform/kit/ui';
import { CircleAlert, KeyRound, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { ProviderLogoTile } from '../../components/provider-logo-tile.js';
import { E2E_IDS } from '../../testability/e2e-ids';
import { endpointHost } from './runtime-config-page-cloud-primitives';
import type { RuntimeConfigStateV11 } from './runtime-config-state-types';
import { getVendorLabelV11 } from './runtime-config-state-types';

type Translate = (key: string, options?: Record<string, unknown>) => string;
type Connector = RuntimeConfigStateV11['connectors'][number];

export type ConnectorPresentationState = 'healthy' | 'unchecked' | 'needs-credential' | 'attention';

/** One reading of a connection's state shared by the list and the detail header. */
export function connectorPresentationState(connector: Pick<Connector, 'hasCredential' | 'status'>): ConnectorPresentationState {
  if (!connector.hasCredential) return 'needs-credential';
  if (connector.status === 'healthy') return 'healthy';
  if (connector.status === 'idle') return 'unchecked';
  return 'attention';
}

/**
 * Connections as a gallery of cards rather than an admin rail: each service
 * reads as a product tile with its identity, host and one quiet status line.
 * The selected card lifts; everything else stays flat on the panel.
 */
export function CloudConnectorListPanel(props: {
  connectors: Connector[];
  deletingConnectorId: string;
  onAddConnector: () => void;
  onDeleteConnector: (connectorId: string) => Promise<void>;
  onSelectConnector: (connectorId: string) => void;
  selectedConnectorId: string;
  uncheckedCount: number;
  t: Translate;
}) {
  const { connectors, t, uncheckedCount } = props;
  const [pendingDelete, setPendingDelete] = useState<Connector | null>(null);
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
      <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(230px,1fr))]" role="list">
        {connectors.map((connector) => (
          <CloudConnectorCard
            key={connector.id}
            active={connector.id === props.selectedConnectorId}
            connector={connector}
            deleting={connector.id === props.deletingConnectorId}
            onDeleteConnector={async () => setPendingDelete(connector)}
            onSelectConnector={props.onSelectConnector}
            t={t}
          />
        ))}
        <button
          type="button"
          role="listitem"
          onClick={props.onAddConnector}
          className="group flex min-h-[112px] items-center justify-center gap-2 rounded-[20px] border border-dashed border-[var(--nimi-border-strong)] px-4 text-sm font-medium text-[var(--nimi-text-secondary)] transition-colors hover:border-[var(--nimi-action-primary-bg)] hover:bg-[color-mix(in_srgb,var(--nimi-surface-card)_70%,transparent)] hover:text-[var(--nimi-action-primary-bg)] focus-visible:outline-2 focus-visible:outline-[var(--nimi-focus-ring-color)]"
        >
          <span className="flex size-8 items-center justify-center rounded-full bg-[var(--nimi-surface-panel)] text-[var(--nimi-text-muted)] transition-colors group-hover:bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_12%,transparent)] group-hover:text-[var(--nimi-action-primary-bg)]">
            <Plus size={16} />
          </span>
          {t('runtimeConfig.cloud.addConnector', { defaultValue: 'Add' })}
        </button>
      </div>
      <ConfirmDialog open={pendingDelete !== null} title={t('runtimeConfig.product.removeConnectionTitle', { name: pendingDelete?.label ?? '' })} message={t('runtimeConfig.product.removeConnectionHelp')} confirmLabel={t('runtimeConfig.cloud.deleteConnector')} cancelLabel={t('Common.cancel')} confirmTone="danger" onClose={() => setPendingDelete(null)} onConfirm={() => { if (!pendingDelete) return; void props.onDeleteConnector(pendingDelete.id).finally(() => setPendingDelete(null)); }} />
    </section>
  );
}

function CloudConnectorCard(props: {
  active: boolean;
  connector: Connector;
  deleting: boolean;
  onDeleteConnector: (connectorId: string) => Promise<void>;
  onSelectConnector: (connectorId: string) => void;
  t: Translate;
}) {
  const { active, connector, t } = props;
  const presentation = connectorPresentationState(connector);
  const canDelete = !connector.isSystemOwned && connector.scope !== 'runtime-system';
  const vendorLabel = getVendorLabelV11(connector.vendor);
  const host = connector.endpoint ? endpointHost(connector.endpoint) : '';
  const subtitle = [
    vendorLabel.toLowerCase() !== connector.label.toLowerCase() ? vendorLabel : '',
    host,
  ].filter(Boolean).join(' · ');
  const status =
    presentation === 'healthy'
      ? { text: t('runtimeConfig.product.checkedBadge'), className: 'text-[var(--nimi-text-secondary)]', dot: 'bg-[var(--nimi-status-success)]', Icon: null }
      : presentation === 'needs-credential'
        ? { text: t('runtimeConfig.product.credentialMissing'), className: 'text-[var(--nimi-status-warning)]', dot: '', Icon: KeyRound }
        : presentation === 'attention'
          ? { text: t('runtimeConfig.product.attentionBadge'), className: 'text-[var(--nimi-status-danger)]', dot: '', Icon: CircleAlert }
          : { text: t('runtimeConfig.product.uncheckedBadge'), className: 'text-[var(--nimi-text-muted)]', dot: 'bg-[var(--nimi-border-strong)]', Icon: null };
  return (
    <div
      role="listitem"
      className={`group relative flex min-h-[112px] flex-col rounded-[20px] p-4 transition-[background-color,box-shadow] duration-200 ${active
        ? 'bg-[var(--nimi-surface-card)] shadow-[var(--nimi-elevation-base)] ring-1 ring-inset ring-[var(--nimi-border-strong)]'
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
          </span>
        </span>
        <span className={`mt-auto flex items-center gap-1.5 pt-4 text-xs ${status.className}`}>
          {status.Icon ? <status.Icon size={12} /> : <span className={`size-1.5 rounded-full ${status.dot}`} aria-hidden="true" />}
          {status.text}
        </span>
      </button>
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
