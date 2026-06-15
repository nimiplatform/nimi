// Apps detail / requirement-preview view (T4-W4).
//
// The detail surface a card's `Details` action opens, and the D-HOME-005
// Install flow's requirement preview step. It projects the typed
// registry/status/job surfaces for one app:
// identity, install + version state, the requirement summary, the install
// storage roots, and the same primary/secondary actions as the card.
//
// It reads only already-typed projections — no app-local spec/asset read.

import type { ReactElement, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, OverlayShell } from '@nimiplatform/kit/ui';
import type {
  NimiAppInventoryInstallState,
  NimiAppInventorySource,
  NimiAppInventorySourceStatus,
  NimiAppInventorySources,
  NimiAppInventoryTrustTier,
  NimiAppOpenReadiness,
} from '@nimiplatform/sdk/app';
import {
  actionPlanForInventoryEntry,
  type AppCardActionId,
} from './apps-card-actions.js';
import { postureForCardState } from './apps-card-state.js';
import {
  deriveIconGlyph,
  deriveRequirementSummary,
  deriveVersionState,
} from './apps-card-fields.js';
import type { DesktopAppsEntry } from './apps-panel-projection.js';

type InventorySourceKey = 'catalog' | 'account' | 'local';

const INVENTORY_SOURCE_KEYS: readonly InventorySourceKey[] = ['catalog', 'account', 'local'];

const SOURCE_LABEL_KEYS: Record<InventorySourceKey, string> = {
  catalog: 'Apps.source.catalog',
  account: 'Apps.source.account',
  local: 'Apps.source.local',
};

const SOURCE_STATUS_LABEL_KEYS: Record<NimiAppInventorySourceStatus, string> = {
  present: 'Apps.sourceStatus.present',
  absent: 'Apps.sourceStatus.absent',
  degraded: 'Apps.sourceStatus.degraded',
};

const OPEN_READINESS_LABEL_KEYS: Record<NimiAppOpenReadiness, string> = {
  ready: 'Apps.openReadiness.ready',
  'install-required': 'Apps.openReadiness.installRequired',
  'update-required': 'Apps.openReadiness.updateRequired',
  'repair-required': 'Apps.openReadiness.repairRequired',
  'permission-required': 'Apps.openReadiness.permissionRequired',
  'blocked-by-master-gate': 'Apps.openReadiness.blockedByMasterGate',
  unsupported: 'Apps.openReadiness.unsupported',
  'sign-in-required': 'Apps.openReadiness.signInRequired',
  'connect-required': 'Apps.openReadiness.connectRequired',
};

const INSTALL_STATE_LABEL_KEYS: Record<NimiAppInventoryInstallState, string> = {
  'not-installed': 'Apps.installState.notInstalled',
  installed: 'Apps.installState.installed',
  'adopted-local': 'Apps.installState.adoptedLocal',
  installing: 'Apps.installState.installing',
  updating: 'Apps.installState.updating',
  'repair-required': 'Apps.installState.repairRequired',
  removed: 'Apps.installState.removed',
  unknown: 'Apps.installState.unknown',
};

export interface AppsDetailViewProps {
  /** The entry to detail, or `null` to close the overlay. */
  readonly entry: DesktopAppsEntry | null;
  /** Optional app-scope AIProfile repair/apply surface. */
  readonly aiProfileSection?: ReactNode;
  /** Run a card action. */
  readonly onCardAction: (appId: string, action: AppCardActionId) => void;
  /** Close the detail view. */
  readonly onClose: () => void;
}

export function AppsDetailView({
  entry,
  aiProfileSection,
  onCardAction,
  onClose,
}: AppsDetailViewProps): ReactElement | null {
  const { t } = useTranslation();
  if (!entry) {
    return null;
  }
  const { app, status, cardState, job } = entry;
  const version = deriveVersionState(entry);
  const requirements = deriveRequirementSummary(entry);
  const storageRoots = status?.storageRoots;

  const plan = actionPlanForInventoryEntry({
    nextActions: app.nextActions,
    cardState,
  });

  return (
    <OverlayShell
      open
      kind="dialog"
      onClose={onClose}
      title={
        <span data-testid="apps-detail-title" className="flex items-center gap-2">
          <span aria-hidden="true" className="flex h-7 w-7 items-center justify-center rounded-md bg-[color-mix(in_srgb,var(--nimi-surface-active)_70%,transparent)] text-xs font-semibold">
            {deriveIconGlyph(app.displayName)}
          </span>
          {app.displayName}
        </span>
      }
      footer={
        <div className="flex flex-wrap gap-2">
          {plan.primary ? (
            <Button
              data-testid={`apps-detail-action-${plan.primary.id}`}
              tone={plan.primary.destructive ? 'danger' : 'primary'}
              disabled={isDetailActionDisabled(cardState, plan.primary.id)}
              onClick={() => onCardAction(app.appId, plan.primary!.id)}
            >
              {t(`Apps.action.${actionLabelKey(plan.primary.id)}`)}
            </Button>
          ) : null}
          {plan.secondary
            .filter((secondary) => secondary.id !== 'details')
            .map((secondary) => (
              <Button
                key={secondary.id}
                data-testid={`apps-detail-action-${secondary.id}`}
                tone={secondary.destructive ? 'danger' : 'ghost'}
                disabled={isDetailActionDisabled(cardState, secondary.id)}
                onClick={() => onCardAction(app.appId, secondary.id)}
              >
                {t(`Apps.action.${actionLabelKey(secondary.id)}`)}
              </Button>
            ))}
          <Button tone="secondary" onClick={onClose}>
            {t('Apps.action.close')}
          </Button>
        </div>
      }
    >
      <div data-testid="apps-detail-body" className="flex flex-col gap-4 text-sm">
        <DetailRow label={t('Apps.detail.publisher')} value={app.publisher ?? 'Local'} />
        <DetailRow label={t('Apps.detail.trustTier')} value={t(trustTierLabelKey(app.trustTier))} />
        <DetailRow
          label={t('Apps.detail.installState')}
          value={t(INSTALL_STATE_LABEL_KEYS[app.installState])}
        />
        <DetailRow
          label={t('Apps.detail.openReadiness')}
          value={t(OPEN_READINESS_LABEL_KEYS[app.openReadiness])}
        />
        <DetailRow
          label={t('Apps.detail.versionState')}
          value={
            version.installed
              ? t('Apps.version.installed', { version: version.installed }) +
                (version.available ? ` · ${t('Apps.version.available', { version: version.available })}` : '')
              : t('Apps.version.notInstalled')
          }
        />
        <DetailSourceRows sources={app.sources} />

        <div data-testid="apps-detail-requirements" className="flex flex-col gap-1">
          <span className="text-xs font-semibold uppercase text-[color:var(--nimi-text-muted)]">
            {t('Apps.detail.requirements')}
          </span>
          <ul className="flex flex-col gap-0.5 text-[color:var(--nimi-text-secondary)]">
            {requirements.ai ? <li data-requirement="ai">{t('Apps.requirement.aiDetail')}</li> : null}
            {requirements.permissions ? (
              <li data-requirement="permissions">{t('Apps.requirement.permissionsDetail')}</li>
            ) : null}
            {requirements.data ? <li data-requirement="data">{t('Apps.requirement.dataDetail')}</li> : null}
            {requirements.runtime ? (
              <li data-requirement="runtime">{t('Apps.requirement.runtimeDetail')}</li>
            ) : null}
          </ul>
        </div>

        {aiProfileSection}

        {storageRoots ? (
          <div data-testid="apps-detail-storage" className="flex flex-col gap-1">
            <span className="text-xs font-semibold uppercase text-[color:var(--nimi-text-muted)]">
              {t('Apps.detail.storageRoots')}
            </span>
            <dl className="flex flex-col gap-0.5 font-mono text-xs text-[color:var(--nimi-text-secondary)]">
              <DetailRow label={t('Apps.detail.releaseRoot')} value={storageRoots.releaseRoot} />
              <DetailRow label={t('Apps.detail.dataRoot')} value={storageRoots.dataRoot} />
              <DetailRow label={t('Apps.detail.cacheRoot')} value={storageRoots.cacheRoot} />
              <DetailRow label={t('Apps.detail.tempRoot')} value={storageRoots.tempRoot} />
            </dl>
          </div>
        ) : null}

        {cardState === 'install_failed' && job?.reasonCode ? (
          <p data-testid="apps-detail-failure" className="rounded-md bg-[color-mix(in_srgb,var(--nimi-status-danger)_8%,transparent)] px-2 py-1.5 text-xs text-[var(--nimi-status-danger)]">
            {t('Apps.failure.detail', { reasonCode: job.reasonCode, detail: job.failureDetail ?? '' })}
          </p>
        ) : null}

        {entry.detail ? (
          <p data-testid="apps-detail-status-detail" className="text-xs text-[color:var(--nimi-text-muted)]">
            {entry.detail}
          </p>
        ) : null}
      </div>
    </OverlayShell>
  );
}

function DetailRow({ label, value }: { label: string; value: string }): ReactElement {
  return (
    <div className="flex justify-between gap-4">
      <dt className="shrink-0 text-[color:var(--nimi-text-muted)]">{label}</dt>
      <dd className="min-w-0 truncate text-right text-[color:var(--nimi-text-primary)]">{value}</dd>
    </div>
  );
}

function DetailSourceRows(props: { readonly sources: NimiAppInventorySources }): ReactElement {
  const { t } = useTranslation();
  const degraded = INVENTORY_SOURCE_KEYS
    .map((sourceKey) => ({ sourceKey, source: props.sources[sourceKey] }))
    .filter((item) => item.source.status === 'degraded');
  return (
    <div data-testid="apps-detail-sources" className="flex flex-col gap-1">
      <span className="text-xs font-semibold uppercase text-[color:var(--nimi-text-muted)]">
        {t('Apps.detail.sources')}
      </span>
      <div className="flex flex-wrap gap-1.5">
        {INVENTORY_SOURCE_KEYS.map((sourceKey) => {
          const source = props.sources[sourceKey];
          return (
            <span
              key={sourceKey}
              data-testid={`apps-detail-source-${sourceKey}`}
              data-source-status={source.status}
              className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${sourceStatusTone(source.status)}`}
              title={sourceTooltip(source)}
            >
              {t(SOURCE_LABEL_KEYS[sourceKey])}
              <span className="ml-1 opacity-80">{t(SOURCE_STATUS_LABEL_KEYS[source.status])}</span>
            </span>
          );
        })}
      </div>
      {degraded.length > 0 ? (
        <ul className="flex flex-col gap-1 text-xs text-[var(--nimi-status-warning)]">
          {degraded.map(({ sourceKey, source }) => (
            <li key={sourceKey} data-testid={`apps-detail-source-${sourceKey}-degraded`}>
              {t('Apps.sourceDegradedDetail', {
                source: t(SOURCE_LABEL_KEYS[sourceKey]),
                reasonCode: source.reasonCode ?? 'UNKNOWN',
                detail: source.detail ?? '',
              })}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function sourceTooltip(source: NimiAppInventorySource<unknown>): string | undefined {
  if (source.status !== 'degraded') {
    return undefined;
  }
  const reason = source.reasonCode ?? 'UNKNOWN';
  return source.detail ? `${reason}: ${source.detail}` : reason;
}

function sourceStatusTone(status: NimiAppInventorySourceStatus): string {
  switch (status) {
    case 'present':
      return 'bg-[color-mix(in_srgb,var(--nimi-status-success)_12%,transparent)] text-[var(--nimi-status-success)]';
    case 'degraded':
      return 'bg-[color-mix(in_srgb,var(--nimi-status-warning)_14%,transparent)] text-[var(--nimi-status-warning)]';
    case 'absent':
      return 'bg-[color-mix(in_srgb,var(--nimi-text-muted)_8%,transparent)] text-[color:var(--nimi-text-muted)]';
    default: {
      const exhaustive: never = status;
      return exhaustive;
    }
  }
}

function trustTierLabelKey(tier: NimiAppInventoryTrustTier): string {
  switch (tier) {
    case 'nimi-first-party':
      return 'Apps.trustTier.firstParty';
    case 'nimi-verified-partner':
      return 'Apps.trustTier.verifiedPartner';
    case 'nimi-community':
      return 'Apps.trustTier.community';
    case 'local-explicit':
      return 'Apps.trustTier.localExplicit';
    case 'local-developer':
      return 'Apps.trustTier.localDeveloper';
    case 'unknown':
      return 'Apps.trustTier.unknown';
    default:
      return 'Apps.trustTier.unknown';
  }
}

function isDetailActionDisabled(cardState: DesktopAppsEntry['cardState'], actionId: AppCardActionId): boolean {
  if (postureForCardState(cardState) !== 'disabled') {
    return false;
  }
  return actionId !== 'details'
    && actionId !== 'sign_in'
    && actionId !== 'connect_local'
    && actionId !== 'remove_local_adoption';
}

function actionLabelKey(action: AppCardActionId): string {
  return camelCase(action);
}

function camelCase(value: string): string {
  return value.replace(/_([a-z])/g, (_match, ch: string) => ch.toUpperCase());
}
