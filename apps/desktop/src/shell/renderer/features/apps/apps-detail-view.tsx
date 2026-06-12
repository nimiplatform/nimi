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
import {
  actionPlanForCardState,
  type AppCardActionId,
} from './apps-card-actions.js';
import { postureForCardState } from './apps-card-state.js';
import {
  deriveIconGlyph,
  deriveRequirementSummary,
  deriveVersionState,
} from './apps-card-fields.js';
import type { DesktopAppsEntry } from './apps-panel-projection.js';

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

  // The card state is always one of the 11 canonical states (the 12th
  // `status_unavailable` bucket was hard-cut in T4-W5).
  const plan = actionPlanForCardState(cardState);
  const disabled = postureForCardState(cardState) === 'disabled';

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
              disabled={disabled}
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
                disabled={disabled && !secondary.destructive}
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
        <DetailRow label={t('Apps.detail.publisher')} value={app.publisher} />
        <DetailRow label={t('Apps.detail.trustTier')} value={t(trustTierLabelKey(app.trustTier))} />
        <DetailRow
          label={t('Apps.detail.installState')}
          value={t(cardStateLabelKey(cardState))}
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

function trustTierLabelKey(tier: string): string {
  switch (tier) {
    case 'nimi-first-party':
      return 'Apps.trustTier.firstParty';
    case 'nimi-verified-partner':
      return 'Apps.trustTier.verifiedPartner';
    default:
      return 'Apps.trustTier.community';
  }
}

function cardStateLabelKey(state: string): string {
  return `Apps.state.${camelCase(state)}`;
}

function actionLabelKey(action: AppCardActionId): string {
  return camelCase(action);
}

function camelCase(value: string): string {
  return value.replace(/_([a-z])/g, (_match, ch: string) => ch.toUpperCase());
}
