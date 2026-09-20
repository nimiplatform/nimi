import { ConfirmDialog, IconButton, ScrollArea } from '@nimiplatform/kit/ui';
import { CircleAlert, KeyRound, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { IdentityTile } from '../../components/identity-tile.js';
import { E2E_IDS } from '../../testability/e2e-ids';
import { CloudIcon } from './runtime-config-page-cloud-primitives';
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

export function CloudConnectorListPanel(props: {
  connectors: Connector[];
  deletingConnectorId: string;
  onDeleteConnector: (connectorId: string) => Promise<void>;
  onSelectConnector: (connectorId: string) => void;
  selectedConnectorId: string;
  t: Translate;
}) {
  const { connectors, t } = props;
  const [pendingDelete, setPendingDelete] = useState<Connector | null>(null);
  return (
    <div className="min-w-0">
      <h2 className="mb-3 text-sm font-semibold text-[var(--nimi-text-secondary)]">{t('runtimeConfig.product.yourConnections', { count: connectors.length })}</h2>
      <ScrollArea className="max-h-[540px]" contentClassName="space-y-1">
        {connectors.length === 0 ? (
          <div className="flex h-full min-h-[160px] flex-col items-center justify-center text-center">
            <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--nimi-surface-card)_78%,var(--nimi-surface-panel))]">
              <CloudIcon className="h-6 w-6 text-[color-mix(in_srgb,var(--nimi-text-muted)_80%,transparent)]" />
            </div>
            <p className="text-sm font-medium text-[var(--nimi-text-primary)]">{t('runtimeConfig.cloud.noConnectors', { defaultValue: 'No Connectors' })}</p>
            <p className="text-xs text-[var(--nimi-text-muted)] mt-1">
              {t('runtimeConfig.cloud.noConnectorsHint', { defaultValue: 'Click "Add" to create your first connector' })}
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            {connectors.map((connector) => (
              <CloudConnectorListItem
                key={connector.id}
                active={connector.id === props.selectedConnectorId}
                connector={connector}
                deleting={connector.id === props.deletingConnectorId}
                onDeleteConnector={async () => setPendingDelete(connector)}
                onSelectConnector={props.onSelectConnector}
                t={t}
              />
            ))}
          </div>
        )}
      </ScrollArea>
      <ConfirmDialog open={pendingDelete !== null} title={t('runtimeConfig.product.removeConnectionTitle', { name: pendingDelete?.label ?? '' })} message={t('runtimeConfig.product.removeConnectionHelp')} confirmLabel={t('runtimeConfig.cloud.deleteConnector')} cancelLabel={t('Common.cancel')} confirmTone="danger" onClose={() => setPendingDelete(null)} onConfirm={() => { if (!pendingDelete) return; void props.onDeleteConnector(pendingDelete.id).finally(() => setPendingDelete(null)); }} />
    </div>
  );
}

function CloudConnectorListItem(props: {
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
  const showVendor = vendorLabel.toLowerCase() !== connector.label.toLowerCase();
  // Only exceptions get words. A checked connection shows a green dot on its
  // tile and nothing else; "not checked" stays quiet and muted.
  const exception =
    presentation === 'needs-credential'
      ? { text: t('runtimeConfig.product.credentialMissing'), className: 'text-[var(--nimi-status-warning)]', Icon: KeyRound }
      : presentation === 'attention'
        ? { text: t('runtimeConfig.product.attentionBadge'), className: 'text-[var(--nimi-status-danger)]', Icon: CircleAlert }
        : presentation === 'unchecked'
          ? { text: t('runtimeConfig.product.uncheckedBadge'), className: 'text-[var(--nimi-text-muted)]', Icon: null }
          : null;
  return (
    <div
      className={`group flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-xs transition-colors ${active
        ? 'bg-[var(--nimi-sidebar-item-active)] text-[var(--nimi-text-primary)]'
        : 'hover:bg-[var(--nimi-surface-active)]'
        }`}
    >
      <button
        type="button"
        onClick={() => props.onSelectConnector(connector.id)}
        aria-current={active ? 'page' : undefined}
        className="flex min-w-0 flex-1 items-center gap-2.5 rounded-md text-left focus-visible:outline-2 focus-visible:outline-[var(--nimi-focus-ring-color)]"
      >
        <IdentityTile seed={connector.provider || connector.vendor} label={vendorLabel} size="sm">
          {presentation === 'healthy' ? (
            <span className="absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full border-2 border-[var(--nimi-surface-panel)] bg-[var(--nimi-status-success)]" />
          ) : null}
        </IdentityTile>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate text-sm font-semibold text-[var(--nimi-text-primary)]">{connector.label}</span>
            <CloudConnectorScopeBadge connector={connector} t={t} />
          </span>
          {showVendor || exception ? (
            <span className="mt-0.5 flex items-center gap-1.5 text-xs text-[var(--nimi-text-secondary)]">
              {showVendor ? <span className="truncate">{vendorLabel}</span> : null}
              {showVendor && exception ? <span aria-hidden="true">·</span> : null}
              {exception ? (
                <span className={`flex items-center gap-1 ${exception.className}`}>
                  {exception.Icon ? <exception.Icon size={12} /> : null}
                  {exception.text}
                </span>
              ) : null}
            </span>
          ) : null}
        </span>
      </button>
      {canDelete && active ? (
        <IconButton
          size="sm"
          tone="ghost"
          aria-label={t('runtimeConfig.cloud.deleteConnector')}
          title={t('runtimeConfig.cloud.deleteConnector')}
          disabled={props.deleting}
          icon={<Trash2 size={15} />}
          className="shrink-0 text-[var(--nimi-text-muted)] hover:text-[var(--nimi-status-danger)]"
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
