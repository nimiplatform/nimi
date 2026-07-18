// Read-only detail view for one unified Apps inventory entry.

import type { ReactElement } from 'react';
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
import { actionPlanForInventoryEntry, type AppCardActionId } from './apps-card-actions.js';
import { deriveIconGlyph, deriveRequirementSummary } from './apps-card-fields.js';
import type { AppInventoryPresenceState } from './apps-card-state.js';
import type { DesktopAppsEntry } from './apps-panel-projection.js';

type InventorySourceKey = keyof NimiAppInventorySources;

const INVENTORY_SOURCE_KEYS: readonly InventorySourceKey[] = [
  'catalog',
  'account',
  'localRecord',
  'packageReadiness',
];

const SOURCE_STATUS_LABEL_KEYS: Record<NimiAppInventorySourceStatus, string> = {
  present: 'Apps.sourceStatus.present',
  absent: 'Apps.sourceStatus.absent',
  degraded: 'Apps.sourceStatus.degraded',
};

const OPEN_READINESS_LABEL_KEYS: Record<NimiAppOpenReadiness, string> = {
  ready: 'Apps.openReadiness.ready',
  'package-unavailable': 'Apps.state.immutablePackageUnavailable',
  'local-record-dormant': 'Apps.state.localRecordDormant',
  'blocked-by-master-gate': 'Apps.state.blockedByPolicy',
  unsupported: 'Apps.openReadiness.unsupported',
  'sign-in-required': 'Apps.openReadiness.signInRequired',
};

const INSTALL_STATE_LABEL_KEYS: Record<NimiAppInventoryInstallState, string> = {
  'not-present': 'Apps.installState.notInstalled',
  'local-record-active': 'Apps.state.localRecordActive',
  'local-record-dormant': 'Apps.state.localRecordDormant',
  removed: 'Apps.installState.removed',
  unknown: 'Apps.installState.unknown',
};

export interface AppsDetailViewProps {
  readonly entry: DesktopAppsEntry | null;
  readonly onCardAction: (appId: string, action: AppCardActionId) => void;
  readonly onClose: () => void;
}

export function AppsDetailView({
  entry,
  onCardAction,
  onClose,
}: AppsDetailViewProps): ReactElement | null {
  const { t } = useTranslation();
  if (!entry) return null;

  const { app, cardState } = entry;
  const requirements = deriveRequirementSummary(app);
  const plan = actionPlanForInventoryEntry(app);
  const packageSource = app.sources.packageReadiness;

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
          {plan.primary?.id === 'sign_in' ? (
            <Button
              data-testid="apps-detail-action-sign_in"
              tone="primary"
              onClick={() => onCardAction(app.appId, 'sign_in')}
            >
              {t('Apps.action.signIn')}
            </Button>
          ) : null}
          <Button tone="secondary" onClick={onClose}>{t('Apps.action.close')}</Button>
        </div>
      }
    >
      <div data-testid="apps-detail-body" className="flex flex-col gap-4 text-sm">
        <dl className="flex flex-col gap-2">
          <DetailRow label={t('Apps.detail.publisher')} value={app.publisher ?? 'Local'} />
          <DetailRow label={t('Apps.detail.trustTier')} value={t(trustTierLabelKey(app.trustTier))} />
          <DetailRow
            label={t('Apps.detail.installState')}
            value={t(INSTALL_STATE_LABEL_KEYS[app.installState], {
              defaultValue: inventoryStateFallback(cardState.inventory),
            })}
          />
          <DetailRow
            label={t('Apps.detail.openReadiness')}
            value={t(OPEN_READINESS_LABEL_KEYS[app.openReadiness], {
              defaultValue: accessStateFallback(app.openReadiness),
            })}
          />
          <DetailRow
            label={t('Apps.requirement.runtime')}
            value={t('Apps.state.immutablePackageUnavailable', {
              defaultValue: 'Immutable package unavailable (0K)',
            })}
          />
        </dl>

        <DetailSourceRows sources={app.sources} />

        <div data-testid="apps-detail-package-readiness" className="rounded-lg border border-[color-mix(in_srgb,var(--nimi-status-warning)_24%,transparent)] bg-[color-mix(in_srgb,var(--nimi-status-warning)_8%,transparent)] px-3 py-2 text-xs leading-5 text-[var(--nimi-status-warning)]">
          <p className="font-semibold">
            {t('Apps.state.immutablePackageUnavailable', {
              defaultValue: 'Immutable package unavailable (0K)',
            })}
          </p>
          <p className="mt-1 break-words font-mono">
            {packageSource.value?.reasonCode ?? packageSource.reasonCode ?? 'IMMUTABLE_PROFILE_UNAVAILABLE'}
          </p>
          {packageSource.value?.detail || packageSource.detail ? (
            <p className="mt-1 break-words text-[color:var(--nimi-text-secondary)]">
              {packageSource.value?.detail ?? packageSource.detail}
            </p>
          ) : null}
        </div>

        <div data-testid="apps-detail-requirements" className="flex flex-col gap-1">
          <span className="text-xs font-semibold uppercase text-[color:var(--nimi-text-muted)]">
            {t('Apps.detail.requirements')}
          </span>
          <ul className="flex flex-col gap-0.5 text-[color:var(--nimi-text-secondary)]">
            {requirements.ai ? <li data-requirement="ai">{t('Apps.requirement.aiDetail')}</li> : null}
            {requirements.permissions ? <li data-requirement="permissions">{t('Apps.requirement.permissionsDetail')}</li> : null}
            {requirements.data ? <li data-requirement="data">{t('Apps.requirement.dataDetail')}</li> : null}
            {requirements.runtime ? <li data-requirement="runtime">{t('Apps.requirement.runtimeDetail')}</li> : null}
          </ul>
        </div>

        {entry.detail ? (
          <p data-testid="apps-detail-status-detail" className="break-words text-xs leading-5 text-[color:var(--nimi-text-muted)]">
            {entry.detail}
          </p>
        ) : null}
      </div>
    </OverlayShell>
  );
}

function DetailRow({ label, value }: { readonly label: string; readonly value: string }): ReactElement {
  return (
    <div className="flex items-start justify-between gap-4">
      <dt className="shrink-0 text-[color:var(--nimi-text-muted)]">{label}</dt>
      <dd className="min-w-0 break-words text-right text-[color:var(--nimi-text-primary)]">{value}</dd>
    </div>
  );
}

function DetailSourceRows({ sources }: { readonly sources: NimiAppInventorySources }): ReactElement {
  const { t } = useTranslation();
  const degraded = INVENTORY_SOURCE_KEYS.filter((key) => sources[key].status === 'degraded');
  return (
    <div data-testid="apps-detail-sources" className="flex flex-col gap-1">
      <span className="text-xs font-semibold uppercase text-[color:var(--nimi-text-muted)]">
        {t('Apps.detail.sources')}
      </span>
      <div className="flex flex-wrap gap-1.5">
        {INVENTORY_SOURCE_KEYS.map((key) => (
          <span
            key={key}
            data-testid={`apps-detail-source-${sourceTestId(key)}`}
            data-source-status={sources[key].status}
            className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${sourceStatusTone(sources[key].status)}`}
            title={sourceTooltip(sources[key])}
          >
            {sourceLabel(key, t)}
            <span className="ml-1 opacity-80">{t(SOURCE_STATUS_LABEL_KEYS[sources[key].status])}</span>
          </span>
        ))}
      </div>
      {degraded.length > 0 ? (
        <ul className="flex flex-col gap-1 text-xs text-[var(--nimi-status-warning)]">
          {degraded.map((key) => (
            <li key={key} data-testid={`apps-detail-source-${sourceTestId(key)}-degraded`} className="break-words">
              {t('Apps.sourceDegradedDetail', {
                source: sourceLabel(key, t),
                reasonCode: sources[key].reasonCode ?? 'UNKNOWN',
                detail: sources[key].detail ?? '',
              })}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function sourceLabel(key: InventorySourceKey, t: ReturnType<typeof useTranslation>['t']): string {
  switch (key) {
    case 'catalog': return t('Apps.source.catalog');
    case 'account': return t('Apps.source.account');
    case 'localRecord': return t('Apps.source.local');
    case 'packageReadiness': return t('Apps.requirement.runtime');
    default: {
      const exhaustive: never = key;
      return exhaustive;
    }
  }
}

function sourceTestId(key: InventorySourceKey): string {
  return key === 'localRecord' ? 'local-record' : key === 'packageReadiness' ? 'package-readiness' : key;
}

function sourceTooltip(source: NimiAppInventorySource<unknown>): string | undefined {
  if (source.status !== 'degraded') return undefined;
  const reason = source.reasonCode ?? 'UNKNOWN';
  return source.detail ? `${reason}: ${source.detail}` : reason;
}

function sourceStatusTone(status: NimiAppInventorySourceStatus): string {
  switch (status) {
    case 'present': return 'bg-[color-mix(in_srgb,var(--nimi-status-success)_12%,transparent)] text-[var(--nimi-status-success)]';
    case 'degraded': return 'bg-[color-mix(in_srgb,var(--nimi-status-warning)_14%,transparent)] text-[var(--nimi-status-warning)]';
    case 'absent': return 'bg-[color-mix(in_srgb,var(--nimi-text-muted)_8%,transparent)] text-[color:var(--nimi-text-muted)]';
    default: {
      const exhaustive: never = status;
      return exhaustive;
    }
  }
}

function trustTierLabelKey(tier: NimiAppInventoryTrustTier): string {
  switch (tier) {
    case 'nimi-first-party': return 'Apps.trustTier.firstParty';
    case 'nimi-verified-partner': return 'Apps.trustTier.verifiedPartner';
    case 'nimi-community': return 'Apps.trustTier.community';
    case 'verified': return 'Apps.trustTier.verifiedPartner';
    case 'user_imported': return 'Apps.trustTier.community';
    case 'local_development': return 'LocalDevelopment.trustClass';
    case 'unknown': return 'Apps.trustTier.unknown';
    default: {
      const exhaustive: never = tier;
      return exhaustive;
    }
  }
}

function inventoryStateFallback(state: AppInventoryPresenceState): string {
  return state.replaceAll('_', ' ');
}

function accessStateFallback(state: NimiAppOpenReadiness): string {
  return state.replaceAll('-', ' ');
}
