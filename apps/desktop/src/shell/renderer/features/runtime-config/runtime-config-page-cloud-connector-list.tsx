import type { RuntimeConfigStateV11 } from '@renderer/features/runtime-config/runtime-config-state-types';
import { getVendorLabelV11 } from '@renderer/features/runtime-config/runtime-config-state-types';
import { ScrollArea } from '@nimiplatform/kit/ui';
import { E2E_IDS } from '@renderer/testability/e2e-ids';
import { Card as PrimitiveCard } from './runtime-config-primitives';
import { CloudIcon, TrashIcon } from './runtime-config-page-cloud-primitives';

type Translate = (key: string, options?: Record<string, unknown>) => string;
type Connector = RuntimeConfigStateV11['connectors'][number];

export function CloudConnectorListPanel(props: {
  connectors: Connector[];
  deletingConnectorId: string;
  onDeleteConnector: (connectorId: string) => Promise<void>;
  onSelectConnector: (connectorId: string) => void;
  selectedConnectorId: string;
  t: Translate;
}) {
  const { connectors, t } = props;
  return (
    <PrimitiveCard className="h-[600px] overflow-hidden" hoverMotion={false}>
      <ScrollArea className="h-full" contentClassName="p-4">
        {connectors.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--nimi-surface-card)_78%,var(--nimi-surface-panel))]">
              <CloudIcon className="h-6 w-6 text-[color-mix(in_srgb,var(--nimi-text-muted)_80%,transparent)]" />
            </div>
            <p className="text-sm font-medium text-[var(--nimi-text-primary)]">{t('runtimeConfig.cloud.noConnectors', { defaultValue: 'No Connectors' })}</p>
            <p className="text-xs text-[var(--nimi-text-muted)] mt-1">
              {t('runtimeConfig.cloud.noConnectorsHint', { defaultValue: 'Click "Add" to create your first connector' })}
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {connectors.map((connector) => (
              <CloudConnectorListItem
                key={connector.id}
                active={connector.id === props.selectedConnectorId}
                connector={connector}
                deleting={connector.id === props.deletingConnectorId}
                onDeleteConnector={props.onDeleteConnector}
                onSelectConnector={props.onSelectConnector}
                t={t}
              />
            ))}
          </div>
        )}
      </ScrollArea>
    </PrimitiveCard>
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
  const isHealthy = connector.status === 'healthy';
  const canDelete = !connector.isSystemOwned && connector.scope !== 'runtime-system';
  const deleteLabel = props.deleting
    ? t('runtimeConfig.cloud.deletingConnector', { defaultValue: 'Deleting...' })
    : t('runtimeConfig.cloud.deleteConnector', { defaultValue: 'Delete' });
  return (
    <div
      className={`w-full rounded-xl border px-4 py-3 text-left text-xs transition-all ${
        active
          ? 'border-transparent bg-[var(--nimi-sidebar-item-active)] text-[var(--nimi-text-primary)]'
          : 'border-[var(--nimi-border-subtle)] bg-white/90 hover:border-[color-mix(in_srgb,var(--nimi-action-primary-bg)_24%,transparent)] hover:bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_10%,transparent)]/30'
      }`}
    >
      <div className="flex items-start gap-2">
        <button
          type="button"
          onClick={() => props.onSelectConnector(connector.id)}
          className="min-w-0 flex-1 text-left focus:outline-none"
        >
          <div className="flex items-center gap-2">
            <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${
              isHealthy ? 'bg-[var(--nimi-status-success)]' : connector.status === 'unreachable' || connector.status === 'degraded' || connector.status === 'unsupported' ? 'bg-[var(--nimi-status-danger)]' : 'bg-[color-mix(in_srgb,var(--nimi-text-muted)_35%,transparent)]'
            }`} />
            <p className="truncate font-semibold text-[var(--nimi-text-primary)]">{connector.label}</p>
            <CloudConnectorScopeBadge connector={connector} t={t} />
          </div>
          <p className="mt-0.5 text-[10px] text-[var(--nimi-text-muted)]">{getVendorLabelV11(connector.vendor)}</p>
        </button>
        {canDelete ? (
          <button
            type="button"
            onClick={() => { void props.onDeleteConnector(connector.id); }}
            disabled={props.deleting}
            aria-label={deleteLabel}
            title={deleteLabel}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--nimi-status-danger)] transition-colors hover:bg-[color-mix(in_srgb,var(--nimi-status-danger)_12%,transparent)] focus:outline-none focus:ring-2 focus:ring-[var(--nimi-status-danger)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <TrashIcon />
          </button>
        ) : null}
      </div>
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
        className="shrink-0 rounded-full bg-[color-mix(in_srgb,var(--nimi-surface-card)_78%,var(--nimi-surface-panel))] px-1.5 py-0.5 text-[9px] text-[var(--nimi-text-muted)]"
      >
        {t('runtimeConfig.cloud.runtimeSystem', { defaultValue: 'runtime managed' })}
      </span>
    );
  }
  if (connector.scope === 'machine-global') {
    return (
      <span
        data-testid={E2E_IDS.runtimeConnectorScopeBadge(connector.id)}
        className="shrink-0 rounded-full bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_12%,transparent)] px-1.5 py-0.5 text-[9px] text-[var(--nimi-action-primary-bg)]"
      >
        {t('runtimeConfig.cloud.machineGlobal', { defaultValue: 'machine global' })}
      </span>
    );
  }
  if (connector.isDraft) {
    return (
      <span className="shrink-0 rounded-full bg-[color-mix(in_srgb,var(--nimi-status-warning)_18%,transparent)] px-1.5 py-0.5 text-[9px] text-[var(--nimi-status-warning)]">
        {t('runtimeConfig.cloud.draft', { defaultValue: 'draft' })}
      </span>
    );
  }
  return null;
}
