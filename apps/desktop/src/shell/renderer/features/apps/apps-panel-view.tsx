import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, ProgressIndicator } from '@nimiplatform/nimi-kit/ui';
import type { TrustTierId } from '@nimiplatform/sdk/app';
import {
  actionPlanForCardState,
  type AppCardAction,
  type AppCardActionId,
} from './apps-card-actions.js';
import {
  postureForCardState,
  type CanonicalAppCardState,
} from './apps-card-state.js';
import {
  deriveIconGlyph,
  deriveRequirementSummary,
  deriveVersionState,
  type AppCardRequirementSummary,
} from './apps-card-fields.js';
import type { DesktopAppsCardState, DesktopAppsEntry, DesktopAppsPanelProjection } from './apps-panel-projection.js';

const TRUST_TIER_LABEL_KEYS: Record<TrustTierId, string> = {
  'nimi-first-party': 'Apps.trustTier.firstParty',
  'nimi-verified-partner': 'Apps.trustTier.verifiedPartner',
  'nimi-community': 'Apps.trustTier.community',
};

const CARD_STATE_LABEL_KEYS: Record<DesktopAppsCardState, string> = {
  not_installed_installable: 'Apps.state.notInstalledInstallable',
  installing: 'Apps.state.installing',
  installed_ready: 'Apps.state.installedReady',
  update_available: 'Apps.state.updateAvailable',
  update_required: 'Apps.state.updateRequired',
  permission_required: 'Apps.state.permissionRequired',
  repair_required: 'Apps.state.repairRequired',
  unsupported_on_this_device: 'Apps.state.unsupportedOnThisDevice',
  blocked_by_policy: 'Apps.state.blockedByPolicy',
  install_failed: 'Apps.state.installFailed',
  uninstalling: 'Apps.state.uninstalling',
  status_unavailable: 'Apps.state.statusUnavailable',
};

const CARD_STATE_TONES: Record<DesktopAppsCardState, string> = {
  not_installed_installable: 'bg-[color-mix(in_srgb,var(--nimi-status-info)_14%,transparent)] text-[var(--nimi-status-info)]',
  installing: 'bg-[color-mix(in_srgb,var(--nimi-status-info)_14%,transparent)] text-[var(--nimi-status-info)]',
  installed_ready: 'bg-[color-mix(in_srgb,var(--nimi-status-success)_14%,transparent)] text-[var(--nimi-status-success)]',
  update_available: 'bg-[color-mix(in_srgb,var(--nimi-status-warning)_16%,transparent)] text-[var(--nimi-status-warning)]',
  update_required: 'bg-[color-mix(in_srgb,var(--nimi-status-warning)_16%,transparent)] text-[var(--nimi-status-warning)]',
  permission_required: 'bg-[color-mix(in_srgb,var(--nimi-status-warning)_16%,transparent)] text-[var(--nimi-status-warning)]',
  repair_required: 'bg-[color-mix(in_srgb,var(--nimi-status-warning)_16%,transparent)] text-[var(--nimi-status-warning)]',
  unsupported_on_this_device: 'bg-[color-mix(in_srgb,var(--nimi-status-danger)_14%,transparent)] text-[var(--nimi-status-danger)]',
  blocked_by_policy: 'bg-[color-mix(in_srgb,var(--nimi-text-muted)_12%,transparent)] text-[color:var(--nimi-text-muted)]',
  install_failed: 'bg-[color-mix(in_srgb,var(--nimi-status-danger)_14%,transparent)] text-[var(--nimi-status-danger)]',
  uninstalling: 'bg-[color-mix(in_srgb,var(--nimi-status-info)_14%,transparent)] text-[var(--nimi-status-info)]',
  status_unavailable: 'bg-[color-mix(in_srgb,var(--nimi-text-muted)_10%,transparent)] text-[color:var(--nimi-text-muted)]',
};

const ACTION_LABEL_KEYS: Record<AppCardActionId, string> = {
  install: 'Apps.action.install',
  open: 'Apps.action.open',
  update: 'Apps.action.update',
  repair: 'Apps.action.repair',
  retry: 'Apps.action.retry',
  cancel: 'Apps.action.cancel',
  uninstall: 'Apps.action.uninstall',
  delete_app_data: 'Apps.action.deleteAppData',
  review_permissions: 'Apps.action.reviewPermissions',
  details: 'Apps.action.details',
};

const REQUIREMENT_LABEL_KEYS: Record<keyof AppCardRequirementSummary, string> = {
  ai: 'Apps.requirement.ai',
  permissions: 'Apps.requirement.permissions',
  data: 'Apps.requirement.data',
  runtime: 'Apps.requirement.runtime',
};

/** A card whose posture is a disabled posture renders all actions disabled. */
function isDisabledPosture(cardState: DesktopAppsCardState): boolean {
  if (cardState === 'status_unavailable') {
    return false;
  }
  return postureForCardState(cardState as CanonicalAppCardState) === 'disabled';
}

export interface AppsPanelViewProps {
  readonly projection: DesktopAppsPanelProjection;
  /** Run a card action for an app. */
  readonly onCardAction: (appId: string, action: AppCardActionId) => void;
  /** The appId of an in-flight card action — disables that card's buttons. */
  readonly busyAppId: string | null;
  /** The last card-action failure detail, or `null`. */
  readonly actionError: string | null;
}

export function AppsPanelView({
  projection,
  onCardAction,
  busyAppId,
  actionError,
}: AppsPanelViewProps): ReactElement {
  const { t } = useTranslation();

  if (projection.status === 'error') {
    return (
      <section data-testid="apps-view" aria-labelledby="apps-view-title" className="flex h-full flex-col gap-3">
        <h2 id="apps-view-title" className="text-base font-semibold text-[color:var(--nimi-text-primary)]">
          {t('Apps.title')}
        </h2>
        <p data-testid="apps-error" data-state="error" className="rounded-lg border border-[color-mix(in_srgb,var(--nimi-status-danger)_24%,transparent)] bg-[color-mix(in_srgb,var(--nimi-status-danger)_8%,transparent)] px-3 py-2 text-sm leading-6 text-[var(--nimi-status-danger)]">
          {t('Apps.error', { detail: projection.detail })}
        </p>
      </section>
    );
  }

  return (
    <section data-testid="apps-view" aria-labelledby="apps-view-title" className="flex h-full flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 id="apps-view-title" className="text-base font-semibold text-[color:var(--nimi-text-primary)]">
            {t('Apps.title')}
          </h2>
          <p className="mt-1 text-sm text-[color:var(--nimi-text-secondary)]">{t('Apps.description')}</p>
        </div>
        <span data-testid="apps-entry-count" className="rounded-full bg-[color-mix(in_srgb,var(--nimi-surface-card)_80%,transparent)] px-3 py-1 text-xs font-medium text-[color:var(--nimi-text-muted)]">
          {projection.entries.length}
        </span>
      </div>

      {actionError ? (
        <p data-testid="apps-action-error" role="alert" className="rounded-lg border border-[color-mix(in_srgb,var(--nimi-status-danger)_24%,transparent)] bg-[color-mix(in_srgb,var(--nimi-status-danger)_8%,transparent)] px-3 py-2 text-sm leading-6 text-[var(--nimi-status-danger)]">
          {actionError}
        </p>
      ) : null}

      {projection.entries.length === 0 ? (
        <p data-testid="apps-empty" data-state="empty" className="rounded-lg border border-dashed border-[color:var(--nimi-border-subtle)] px-4 py-8 text-center text-sm text-[color:var(--nimi-text-muted)]">
          {t('Apps.empty')}
        </p>
      ) : (
        <ul data-testid="apps-entry-list" className="flex flex-col gap-2">
          {projection.entries.map((entry) => (
            <AppCard
              key={entry.app.appId}
              entry={entry}
              busy={busyAppId === entry.app.appId}
              onCardAction={onCardAction}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

interface AppCardProps {
  readonly entry: DesktopAppsEntry;
  readonly busy: boolean;
  readonly onCardAction: (appId: string, action: AppCardActionId) => void;
}

function AppCard({ entry, busy, onCardAction }: AppCardProps): ReactElement {
  const { t } = useTranslation();
  const { app, cardState, job } = entry;
  const version = deriveVersionState(entry);
  const requirements = deriveRequirementSummary(entry);
  const disabled = isDisabledPosture(cardState);

  // `status_unavailable` is a typed fail-closed bucket (W5 hard-cut target);
  // it carries only the Details secondary action.
  const plan =
    cardState === 'status_unavailable'
      ? { primary: null, secondary: [{ id: 'details' as AppCardActionId, destructive: false }] }
      : actionPlanForCardState(cardState as CanonicalAppCardState);

  return (
    <li
      data-testid={`apps-entry-${app.appId}`}
      data-app-card-state={cardState}
      data-trust-tier={app.trustTier}
      data-launch-readiness={entry.status?.launchReadiness ?? 'unknown'}
      className="flex flex-col gap-3 rounded-lg border border-[color:var(--nimi-border-subtle)] bg-[color-mix(in_srgb,var(--nimi-surface-card)_82%,transparent)] px-3 py-3"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <span
            data-testid={`apps-entry-${app.appId}-icon`}
            aria-hidden="true"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[color-mix(in_srgb,var(--nimi-surface-active)_70%,transparent)] text-sm font-semibold text-[color:var(--nimi-text-primary)]"
          >
            {deriveIconGlyph(app.displayName)}
          </span>
          <div className="min-w-0">
            <span data-testid={`apps-entry-${app.appId}-name`} className="block truncate text-sm font-medium text-[color:var(--nimi-text-primary)]">
              {app.displayName}
            </span>
            <span data-testid={`apps-entry-${app.appId}-tier`} className="mt-0.5 block truncate text-xs text-[color:var(--nimi-text-muted)]">
              {t(TRUST_TIER_LABEL_KEYS[app.trustTier])}
            </span>
          </div>
        </div>
        <span data-testid={`apps-entry-${app.appId}-state`} className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium ${CARD_STATE_TONES[cardState]}`}>
          {t(CARD_STATE_LABEL_KEYS[cardState])}
        </span>
      </div>

      {/* Version state */}
      {version.installed || version.available ? (
        <span data-testid={`apps-entry-${app.appId}-version`} className="text-xs text-[color:var(--nimi-text-secondary)]">
          {version.installed
            ? t('Apps.version.installed', { version: version.installed })
            : t('Apps.version.notInstalled')}
          {version.available
            ? ` · ${t('Apps.version.available', { version: version.available })}`
            : ''}
        </span>
      ) : null}

      {/* Install / uninstall progress — phase, not a generic spinner */}
      {(cardState === 'installing' || cardState === 'uninstalling') && job ? (
        <div data-testid={`apps-entry-${app.appId}-progress`} data-job-phase={job.phase} className="flex flex-col gap-1">
          <ProgressIndicator value={progressForPhase(job.phase)} />
          <span className="text-xs text-[color:var(--nimi-text-muted)]">
            {t(`Apps.phase.${job.phase}`, { defaultValue: job.phase })}
          </span>
        </div>
      ) : null}

      {/* Failure / status detail */}
      {cardState === 'install_failed' && job?.reasonCode ? (
        <span data-testid={`apps-entry-${app.appId}-failure`} className="text-xs text-[var(--nimi-status-danger)]">
          {t('Apps.failure.detail', {
            reasonCode: job.reasonCode,
            detail: job.failureDetail ?? '',
          })}
        </span>
      ) : null}

      {/* Requirement summary */}
      <div data-testid={`apps-entry-${app.appId}-requirements`} className="flex flex-wrap gap-1.5">
        {(Object.keys(requirements) as Array<keyof AppCardRequirementSummary>)
          .filter((key) => requirements[key])
          .map((key) => (
            <span
              key={key}
              data-requirement={key}
              className="rounded-full bg-[color-mix(in_srgb,var(--nimi-surface-active)_60%,transparent)] px-2 py-0.5 text-[10px] font-medium text-[color:var(--nimi-text-muted)]"
            >
              {t(REQUIREMENT_LABEL_KEYS[key])}
            </span>
          ))}
      </div>

      {/* Actions — every action routes onto the lifecycle bridge */}
      <div data-testid={`apps-entry-${app.appId}-actions`} className="flex flex-wrap items-center gap-2">
        {plan.primary ? (
          <CardActionButton
            appId={app.appId}
            action={plan.primary}
            primary
            disabled={disabled || busy}
            busy={busy}
            onCardAction={onCardAction}
          />
        ) : null}
        {plan.secondary.map((secondary) => (
          <CardActionButton
            key={secondary.id}
            appId={app.appId}
            action={secondary}
            primary={false}
            disabled={disabled && secondary.id !== 'details' ? true : busy}
            busy={busy}
            onCardAction={onCardAction}
          />
        ))}
      </div>

      {entry.detail ? (
        <span data-testid={`apps-entry-${app.appId}-detail`} className="sr-only">{entry.detail}</span>
      ) : null}
    </li>
  );
}

interface CardActionButtonProps {
  readonly appId: string;
  readonly action: AppCardAction;
  readonly primary: boolean;
  readonly disabled: boolean;
  readonly busy: boolean;
  readonly onCardAction: (appId: string, action: AppCardActionId) => void;
}

function CardActionButton({
  appId,
  action,
  primary,
  disabled,
  busy,
  onCardAction,
}: CardActionButtonProps): ReactElement {
  const { t } = useTranslation();
  const tone = action.destructive ? 'danger' : primary ? 'primary' : 'ghost';
  return (
    <Button
      data-testid={`apps-action-${appId}-${action.id}`}
      data-action-destructive={action.destructive ? 'true' : 'false'}
      tone={tone}
      size="sm"
      disabled={disabled}
      loading={busy && primary}
      onClick={() => onCardAction(appId, action.id)}
    >
      {t(ACTION_LABEL_KEYS[action.id])}
    </Button>
  );
}

/**
 * Map a typed `RuntimeAppInstallJob` phase to a coarse progress percentage for
 * the ProgressIndicator. The phase label itself is shown verbatim beneath the
 * bar — the bar is a coarse position cue, not a fabricated byte-progress.
 */
function progressForPhase(phase: string): number {
  switch (phase) {
    case 'queued':
      return 5;
    case 'resolve_descriptor':
      return 15;
    case 'download':
      return 40;
    case 'verify':
      return 60;
    case 'materialize':
    case 'unpack':
      return 75;
    case 'evidence':
      return 90;
    case 'swap':
      return 95;
    case 'installed':
    case 'uninstalled':
      return 100;
    default:
      return 50;
  }
}
