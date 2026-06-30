import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'motion/react';
import { Button, ProgressIndicator } from '@nimiplatform/kit/ui';
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
  type AppCardAction,
  type AppCardActionId,
} from './apps-card-actions.js';
import { postureForCardState } from './apps-card-state.js';
import {
  deriveIconGlyph,
  deriveRequirementSummary,
  deriveVersionState,
  type AppCardRequirementSummary,
} from './apps-card-fields.js';
import type { DesktopAppsCardState, DesktopAppsEntry, DesktopAppsPanelProjection } from './apps-panel-projection.js';
import { useDesktopCardMotion } from '@renderer/ui/motion/desktop-motion';

const TRUST_TIER_LABEL_KEYS: Record<NimiAppInventoryTrustTier, string> = {
  'nimi-first-party': 'Apps.trustTier.firstParty',
  'nimi-verified-partner': 'Apps.trustTier.verifiedPartner',
  'nimi-community': 'Apps.trustTier.community',
  'local-explicit': 'Apps.trustTier.localExplicit',
  'local-developer': 'Apps.trustTier.localDeveloper',
  unknown: 'Apps.trustTier.unknown',
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
};

const ACTION_LABEL_KEYS: Record<AppCardActionId, string> = {
  install: 'Apps.action.install',
  open: 'Apps.action.open',
  connect_local: 'Apps.action.connectLocal',
  update: 'Apps.action.update',
  repair: 'Apps.action.repair',
  retry: 'Apps.action.retry',
  cancel: 'Apps.action.cancel',
  uninstall: 'Apps.action.uninstall',
  remove_local_adoption: 'Apps.action.removeLocalAdoption',
  sign_in: 'Apps.action.signIn',
  delete_app_data: 'Apps.action.deleteAppData',
  review_permissions: 'Apps.action.reviewPermissions',
  details: 'Apps.action.details',
};

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

const REQUIREMENT_LABEL_KEYS: Record<keyof AppCardRequirementSummary, string> = {
  ai: 'Apps.requirement.ai',
  permissions: 'Apps.requirement.permissions',
  data: 'Apps.requirement.data',
  runtime: 'Apps.requirement.runtime',
};

/** A card whose posture is a disabled posture renders all actions disabled. */
function isDisabledPosture(cardState: DesktopAppsCardState): boolean {
  return postureForCardState(cardState) === 'disabled';
}

interface SourceSummary {
  readonly catalog: number;
  readonly account: number;
  readonly local: number;
  readonly degraded: number;
}

function buildSourceSummary(entries: readonly DesktopAppsEntry[]): SourceSummary {
  return entries.reduce<SourceSummary>((summary, entry) => {
    const sources = entry.app.sources;
    return {
      catalog: summary.catalog + (sources.catalog.status === 'present' ? 1 : 0),
      account: summary.account + (sources.account.status === 'present' ? 1 : 0),
      local: summary.local + (sources.local.status === 'present' ? 1 : 0),
      degraded: summary.degraded + INVENTORY_SOURCE_KEYS.filter((key) => sources[key].status === 'degraded').length,
    };
  }, { catalog: 0, account: 0, local: 0, degraded: 0 });
}

function SummaryChip(props: {
  readonly testId: string;
  readonly label: string;
  readonly count: number;
  readonly degraded?: boolean;
}): ReactElement {
  const tone = props.degraded && props.count > 0
    ? 'bg-[color-mix(in_srgb,var(--nimi-status-warning)_14%,transparent)] text-[var(--nimi-status-warning)]'
    : 'bg-[color-mix(in_srgb,var(--nimi-surface-active)_58%,transparent)] text-[color:var(--nimi-text-muted)]';
  return (
    <span data-testid={props.testId} data-count={props.count} className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${tone}`}>
      {props.label}: {props.count}
    </span>
  );
}

export interface AppsPanelViewProps {
  readonly projection: DesktopAppsPanelProjection;
  /** Run a card action for an app. */
  readonly onCardAction: (appId: string, action: AppCardActionId) => void;
  /** Open the native folder picker and adopt a local app through Runtime. */
  readonly onConnectLocalApp: () => void;
  /** The appId of an in-flight card action — disables that card's buttons. */
  readonly busyAppId: string | null;
  /** The last card-action failure detail, or `null`. */
  readonly actionError: string | null;
}

export function AppsPanelView({
  projection,
  onCardAction,
  onConnectLocalApp,
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

  const sourceSummary = buildSourceSummary(projection.entries);

  return (
    <section data-testid="apps-view" aria-labelledby="apps-view-title" className="flex h-full flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 id="apps-view-title" className="text-base font-semibold text-[color:var(--nimi-text-primary)]">
            {t('Apps.title')}
          </h2>
          <p className="mt-1 text-sm text-[color:var(--nimi-text-secondary)]">{t('Apps.description')}</p>
          <div data-testid="apps-source-summary" className="mt-3 flex flex-wrap gap-1.5">
            <SummaryChip testId="apps-source-summary-catalog" label={t('Apps.source.catalog')} count={sourceSummary.catalog} />
            <SummaryChip testId="apps-source-summary-account" label={t('Apps.source.account')} count={sourceSummary.account} />
            <SummaryChip testId="apps-source-summary-local" label={t('Apps.source.local')} count={sourceSummary.local} />
            <SummaryChip testId="apps-source-summary-degraded" label={t('Apps.source.degraded')} count={sourceSummary.degraded} degraded />
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span data-testid="apps-entry-count" className="rounded-full bg-[color-mix(in_srgb,var(--nimi-surface-card)_80%,transparent)] px-3 py-1 text-xs font-medium text-[color:var(--nimi-text-muted)]">
            {t('Apps.inventoryCount', { count: projection.entries.length })}
          </span>
          <Button data-testid="apps-connect-local-top" tone="secondary" size="sm" onClick={onConnectLocalApp}>
            {t('Apps.action.connectLocal')}
          </Button>
        </div>
      </div>

      {actionError ? (
        <p data-testid="apps-action-error" role="alert" className="rounded-lg border border-[color-mix(in_srgb,var(--nimi-status-danger)_24%,transparent)] bg-[color-mix(in_srgb,var(--nimi-status-danger)_8%,transparent)] px-3 py-2 text-sm leading-6 text-[var(--nimi-status-danger)]">
          {actionError}
        </p>
      ) : null}

      {projection.entries.length === 0 ? (
        <div data-testid="apps-empty" data-state="empty" className="flex flex-col gap-3 rounded-lg border border-dashed border-[color:var(--nimi-border-subtle)] px-4 py-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium text-[color:var(--nimi-text-primary)]">{t('Apps.emptyTitle')}</p>
            <p className="mt-1 text-sm text-[color:var(--nimi-text-muted)]">{t('Apps.empty')}</p>
          </div>
          <Button data-testid="apps-connect-local-empty" tone="primary" size="sm" onClick={onConnectLocalApp}>
            {t('Apps.action.connectLocal')}
          </Button>
        </div>
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
  const cardMotion = useDesktopCardMotion();
  const { app, cardState, job } = entry;
  const version = deriveVersionState(entry);
  const requirements = deriveRequirementSummary(entry);

  const plan = actionPlanForInventoryEntry({
    nextActions: app.nextActions,
    cardState,
  });

  return (
    <motion.li
      layout
      data-testid={`apps-entry-${app.appId}`}
      data-app-card-state={cardState}
      data-trust-tier={app.trustTier}
      data-install-state={app.installState}
      data-open-readiness={app.openReadiness}
      data-launch-readiness={entry.status?.launchReadiness ?? 'unknown'}
      whileHover={cardMotion.whileHover}
      whileTap={cardMotion.whileTap}
      transition={cardMotion.transition}
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
        <span data-testid={`apps-entry-${app.appId}-state`} className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium ${stateToneForEntry(entry)}`}>
          {t(stateLabelKeyForEntry(entry))}
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

      <SourceChips appId={app.appId} sources={app.sources} />
      <span data-testid={`apps-entry-${app.appId}-install-state`} className="sr-only">
        {t(INSTALL_STATE_LABEL_KEYS[app.installState])}
      </span>
      <SourceDegradedDetails appId={app.appId} sources={app.sources} />

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
            disabled={isActionDisabled(cardState, plan.primary.id, busy)}
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
            disabled={isActionDisabled(cardState, secondary.id, busy)}
            busy={busy}
            onCardAction={onCardAction}
          />
        ))}
      </div>

      {entry.detail ? (
        <span data-testid={`apps-entry-${app.appId}-detail`} className="sr-only">{entry.detail}</span>
      ) : null}
    </motion.li>
  );
}

function SourceChips(props: {
  readonly appId: string;
  readonly sources: NimiAppInventorySources;
}): ReactElement {
  const { t } = useTranslation();
  return (
    <div data-testid={`apps-entry-${props.appId}-sources`} className="flex flex-wrap gap-1.5">
      {INVENTORY_SOURCE_KEYS.map((sourceKey) => {
        const source = props.sources[sourceKey];
        return (
          <span
            key={sourceKey}
            data-testid={`apps-entry-${props.appId}-source-${sourceKey}`}
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
  );
}

function SourceDegradedDetails(props: {
  readonly appId: string;
  readonly sources: NimiAppInventorySources;
}): ReactElement | null {
  const { t } = useTranslation();
  const degraded = INVENTORY_SOURCE_KEYS
    .map((sourceKey) => ({ sourceKey, source: props.sources[sourceKey] }))
    .filter((item) => item.source.status === 'degraded');

  if (degraded.length === 0) {
    return null;
  }

  return (
    <ul data-testid={`apps-entry-${props.appId}-source-degraded-details`} className="flex flex-col gap-1 text-xs text-[var(--nimi-status-warning)]">
      {degraded.map(({ sourceKey, source }) => (
        <li key={sourceKey} data-testid={`apps-entry-${props.appId}-source-${sourceKey}-degraded`}>
          {t('Apps.sourceDegradedDetail', {
            source: t(SOURCE_LABEL_KEYS[sourceKey]),
            reasonCode: source.reasonCode ?? 'UNKNOWN',
            detail: source.detail ?? '',
          })}
        </li>
      ))}
    </ul>
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

function stateLabelKeyForEntry(entry: DesktopAppsEntry): string {
  if (entry.app.openReadiness === 'sign-in-required' || entry.app.openReadiness === 'connect-required') {
    return OPEN_READINESS_LABEL_KEYS[entry.app.openReadiness];
  }
  return CARD_STATE_LABEL_KEYS[entry.cardState];
}

function stateToneForEntry(entry: DesktopAppsEntry): string {
  if (entry.app.openReadiness === 'sign-in-required' || entry.app.openReadiness === 'connect-required') {
    return 'bg-[color-mix(in_srgb,var(--nimi-status-warning)_16%,transparent)] text-[var(--nimi-status-warning)]';
  }
  return CARD_STATE_TONES[entry.cardState];
}

function isActionDisabled(
  cardState: DesktopAppsCardState,
  actionId: AppCardActionId,
  busy: boolean,
): boolean {
  if (busy) {
    return true;
  }
  if (!isDisabledPosture(cardState)) {
    return false;
  }
  return actionId !== 'details'
    && actionId !== 'sign_in'
    && actionId !== 'connect_local'
    && actionId !== 'remove_local_adoption';
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
 * Map a typed `NimiRuntimeAppInstallJob` phase to a coarse progress percentage for
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
