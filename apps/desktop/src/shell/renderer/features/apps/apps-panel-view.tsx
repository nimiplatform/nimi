import type { ReactElement } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { motion } from 'motion/react';
import { Code2, UserRound } from 'lucide-react';
import { Button } from '@nimiplatform/kit/ui';
import type {
  NimiAppInventoryInstallState,
  NimiAppInventorySource,
  NimiAppInventorySourceStatus,
  NimiAppInventorySources,
  NimiAppInventoryTrustTier,
  NimiAppOpenReadiness,
} from '@nimiplatform/sdk/app';
import { actionPlanForInventoryEntry, type AppCardAction, type AppCardActionId } from './apps-card-actions.js';
import { deriveIconGlyph, deriveRequirementSummary, type AppCardRequirementSummary } from './apps-card-fields.js';
import type { AppAccessState, AppInventoryPresenceState } from './apps-card-state.js';
import type { DesktopAppsEntry, DesktopAppsPanelProjection } from './apps-panel-projection.js';
import { useDesktopCardMotion } from '@renderer/ui/motion/desktop-motion';

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

const REQUIREMENT_LABEL_KEYS: Record<keyof AppCardRequirementSummary, string> = {
  ai: 'Apps.requirement.ai',
  platformFeatures: 'Apps.requirement.platformFeatures',
  data: 'Apps.requirement.data',
  runtime: 'Apps.requirement.runtime',
};

interface SourceSummary {
  readonly catalog: number;
  readonly account: number;
  readonly localRecord: number;
  readonly packageReadiness: number;
  readonly degraded: number;
}

function buildSourceSummary(entries: readonly DesktopAppsEntry[]): SourceSummary {
  return entries.reduce<SourceSummary>((summary, entry) => {
    const sources = entry.app.sources;
    return {
      catalog: summary.catalog + Number(sources.catalog.status === 'present'),
      account: summary.account + Number(sources.account.status === 'present'),
      localRecord: summary.localRecord + Number(sources.localRecord.status === 'present'),
      packageReadiness: summary.packageReadiness + Number(sources.packageReadiness.status === 'present'),
      degraded: summary.degraded + INVENTORY_SOURCE_KEYS.filter((key) => sources[key].status === 'degraded').length,
    };
  }, { catalog: 0, account: 0, localRecord: 0, packageReadiness: 0, degraded: 0 });
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
    <span data-testid={props.testId} data-count={props.count} className={`rounded-full px-2 py-0.5 text-xs font-medium ${tone}`}>
      {props.label}: {props.count}
    </span>
  );
}

export interface AppsPanelViewProps {
  readonly projection: DesktopAppsPanelProjection;
  readonly onCardAction: (appId: string, action: AppCardActionId) => void;
  readonly onOpenDeveloperMode: () => void;
  readonly onManageAccount: () => void;
  readonly onRetry: () => void;
  readonly accountName: string;
  readonly actionError: string | null;
}

export function AppsPanelView({
  projection,
  onCardAction,
  onOpenDeveloperMode,
  onManageAccount,
  onRetry,
  accountName,
  actionError,
}: AppsPanelViewProps): ReactElement {
  const { t } = useTranslation();

  if (projection.status === 'error') {
    return (
      <section data-testid="apps-view" aria-labelledby="apps-view-title" className="flex h-full flex-col gap-3">
        <h2 id="apps-view-title" className="text-base font-semibold text-[color:var(--nimi-text-primary)]">{t('Apps.title')}</h2>
        <p data-testid="apps-error" role="alert" data-state="error" className="break-words rounded-lg border border-[color-mix(in_srgb,var(--nimi-status-danger)_24%,transparent)] bg-[color-mix(in_srgb,var(--nimi-status-danger)_8%,transparent)] px-3 py-2 text-sm leading-6 text-[var(--nimi-status-danger)]">
          {t('Apps.error', { detail: projection.detail })}
        </p>
        <Button data-testid="apps-retry-projection" tone="secondary" size="sm" className="self-start" onClick={onRetry}>
          {t('DeveloperTools.developerModeRetry')}
        </Button>
      </section>
    );
  }

  if (projection.entries.length === 0) {
    return (
      <section data-testid="apps-view" aria-labelledby="apps-source-manager-title" className="flex h-full flex-col gap-4">
        {actionError ? <ActionError detail={actionError} /> : null}
        <EmptyAppsSourceManager accountName={accountName} onManageAccount={onManageAccount} onOpenDeveloperMode={onOpenDeveloperMode} />
      </section>
    );
  }

  const sourceSummary = buildSourceSummary(projection.entries);

  return (
    <section data-testid="apps-view" aria-labelledby="apps-view-title" className="flex h-full flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="apps-view-title" className="text-base font-semibold text-[color:var(--nimi-text-primary)]">{t('Apps.inventoryTitle')}</h2>
          <div data-testid="apps-source-summary" className="mt-3 flex flex-wrap gap-1.5">
            <SummaryChip testId="apps-source-summary-catalog" label={t('Apps.source.catalog')} count={sourceSummary.catalog} />
            <SummaryChip testId="apps-source-summary-account" label={t('Apps.source.account')} count={sourceSummary.account} />
            <SummaryChip testId="apps-source-summary-local" label={t('Apps.source.local')} count={sourceSummary.localRecord} />
            <SummaryChip testId="apps-source-summary-package" label={t('Apps.requirement.runtime')} count={sourceSummary.packageReadiness} />
            <SummaryChip testId="apps-source-summary-degraded" label={t('Apps.source.degraded')} count={sourceSummary.degraded} degraded />
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <span data-testid="apps-entry-count" className="rounded-full bg-[color-mix(in_srgb,var(--nimi-surface-card)_80%,transparent)] px-3 py-1 text-xs font-medium text-[color:var(--nimi-text-muted)]">
            {t('Apps.inventoryCount', { count: projection.entries.length })}
          </span>
          <Button data-testid="apps-open-developer-mode-top" tone="secondary" size="sm" onClick={onOpenDeveloperMode}>
            {t('DeveloperTools.developerModeTitle')}
          </Button>
        </div>
      </div>

      {actionError ? <ActionError detail={actionError} /> : null}

      <ul data-testid="apps-entry-list" className="flex flex-col gap-2">
        {projection.entries.map((entry) => (
          <AppCard key={entry.app.appId} entry={entry} onCardAction={onCardAction} />
        ))}
      </ul>
    </section>
  );
}

function ActionError({ detail }: { readonly detail: string }): ReactElement {
  return (
    <p data-testid="apps-action-error" role="alert" className="break-words rounded-lg border border-[color-mix(in_srgb,var(--nimi-status-danger)_24%,transparent)] bg-[color-mix(in_srgb,var(--nimi-status-danger)_8%,transparent)] px-3 py-2 text-sm leading-6 text-[var(--nimi-status-danger)]">
      {detail}
    </p>
  );
}

function EmptyAppsSourceManager(props: {
  readonly accountName: string;
  readonly onManageAccount: () => void;
  readonly onOpenDeveloperMode: () => void;
}): ReactElement {
  const { t } = useTranslation();
  return (
    <div data-testid="apps-empty-source-manager" data-state="empty" className="flex min-h-[260px] flex-col">
      <h2 id="apps-source-manager-title" className="text-base font-semibold text-[color:var(--nimi-text-primary)]">{t('Apps.sourceManager.title')}</h2>

      <div data-testid="apps-empty-account-source" className="mt-3 flex flex-col gap-3 border-b border-[color:var(--nimi-border-subtle)] py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-[color:var(--nimi-border-subtle)] text-[color:var(--nimi-text-primary)]"><UserRound className="h-5 w-5" /></span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-[color:var(--nimi-text-primary)]">{t('Apps.sourceManager.accountTitle')}</p>
            <p className="mt-1 break-words text-sm text-[color:var(--nimi-text-secondary)]">{t('Apps.sourceManager.connectedAs', { name: props.accountName })}</p>
          </div>
        </div>
        <Button data-testid="apps-empty-manage-account" tone="ghost" size="sm" onClick={props.onManageAccount}>{t('Apps.sourceManager.manageAccount')}</Button>
      </div>

      <div data-testid="apps-empty-local-source" className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-[color:var(--nimi-border-subtle)] text-[color:var(--nimi-text-primary)]"><Code2 className="h-5 w-5" /></span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-[color:var(--nimi-text-primary)]">{t('DeveloperTools.developerModeTitle')}</p>
            <p className="mt-1 max-w-2xl break-words text-sm leading-6 text-[color:var(--nimi-text-secondary)]">{t('DeveloperTools.developerModeDescription')}</p>
          </div>
        </div>
        <Button data-testid="apps-open-developer-mode-empty" tone="primary" size="sm" onClick={props.onOpenDeveloperMode} className="self-start sm:self-auto">
          {t('DeveloperTools.developerModeTitle')}
        </Button>
      </div>
    </div>
  );
}

function AppCard({ entry, onCardAction }: {
  readonly entry: DesktopAppsEntry;
  readonly onCardAction: (appId: string, action: AppCardActionId) => void;
}): ReactElement {
  const { t } = useTranslation();
  const cardMotion = useDesktopCardMotion();
  const { app, cardState } = entry;
  const requirements = deriveRequirementSummary(app);
  const plan = actionPlanForInventoryEntry(app);
  const packageReason = app.sources.packageReadiness.value?.reasonCode
    ?? app.sources.packageReadiness.reasonCode
    ?? 'IMMUTABLE_PROFILE_UNAVAILABLE';

  return (
    <motion.li
      layout
      data-testid={`apps-entry-${app.appId}`}
      data-inventory-state={cardState.inventory}
      data-access-state={cardState.access}
      data-package-state={cardState.immutablePackage}
      data-package-projection-status={cardState.packageProjectionStatus}
      data-trust-tier={app.trustTier}
      data-install-state={app.installState}
      data-open-readiness={app.openReadiness}
      data-ordinary-visibility={entry.catalogDiscoveryProof.ordinaryVisibility}
      data-ordinary-catalog-discovery={String(entry.catalogDiscoveryProof.admittedCatalogDiscovery)}
      whileHover={cardMotion.whileHover}
      whileTap={cardMotion.whileTap}
      transition={cardMotion.transition}
      className="flex flex-col gap-3 rounded-lg border border-[color:var(--nimi-border-subtle)] bg-[color-mix(in_srgb,var(--nimi-surface-card)_82%,transparent)] px-3 py-3"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span data-testid={`apps-entry-${app.appId}-icon`} aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[color-mix(in_srgb,var(--nimi-surface-active)_70%,transparent)] text-sm font-semibold text-[color:var(--nimi-text-primary)]">
            {deriveIconGlyph(app.displayName)}
          </span>
          <div className="min-w-0">
            <span data-testid={`apps-entry-${app.appId}-name`} className="block break-words text-sm font-medium text-[color:var(--nimi-text-primary)]">{app.displayName}</span>
            <span data-testid={`apps-entry-${app.appId}-tier`} className="mt-0.5 block break-words text-xs text-[color:var(--nimi-text-muted)]">{t(trustTierLabelKey(app.trustTier))}</span>
          </div>
        </div>
        <div className="flex flex-wrap justify-end gap-1.5">
          <StateBadge testId={`apps-entry-${app.appId}-inventory-state`} tone="neutral">
            {inventoryStateLabel(cardState.inventory, t)}
          </StateBadge>
          <StateBadge testId={`apps-entry-${app.appId}-access-state`} tone={accessTone(cardState.access)}>
            {t(OPEN_READINESS_LABEL_KEYS[app.openReadiness], { defaultValue: accessFallback(cardState.access) })}
          </StateBadge>
          <StateBadge testId={`apps-entry-${app.appId}-package-state`} tone="warning">
            {t('Apps.state.immutablePackageUnavailable', { defaultValue: 'Immutable package unavailable (0K)' })}
          </StateBadge>
        </div>
      </div>

      <SourceChips appId={app.appId} sources={app.sources} />
      <span data-testid={`apps-entry-${app.appId}-install-state`} className="sr-only">
        {t(INSTALL_STATE_LABEL_KEYS[app.installState], { defaultValue: app.installState })}
      </span>
      <SourceDegradedDetails appId={app.appId} sources={app.sources} />

      <p data-testid={`apps-entry-${app.appId}-package-unavailable`} className="break-words rounded-md bg-[color-mix(in_srgb,var(--nimi-status-warning)_8%,transparent)] px-2 py-1.5 text-xs leading-5 text-[var(--nimi-status-warning)]">
        <span className="font-mono">{packageReason}</span>
        {app.sources.packageReadiness.value?.detail || app.sources.packageReadiness.detail
          ? ` · ${app.sources.packageReadiness.value?.detail ?? app.sources.packageReadiness.detail}`
          : ''}
      </p>

      <div data-testid={`apps-entry-${app.appId}-requirements`} className="flex flex-wrap gap-1.5">
        {(Object.keys(requirements) as Array<keyof AppCardRequirementSummary>)
          .filter((key) => requirements[key])
          .map((key) => (
            <span key={key} data-requirement={key} className="rounded-full bg-[color-mix(in_srgb,var(--nimi-surface-active)_60%,transparent)] px-2 py-0.5 text-xs font-medium text-[color:var(--nimi-text-muted)]">
              {t(REQUIREMENT_LABEL_KEYS[key])}
            </span>
          ))}
      </div>

      <div data-testid={`apps-entry-${app.appId}-actions`} className="flex flex-wrap items-center gap-2">
        {plan.primary ? <CardActionButton appId={app.appId} action={plan.primary} primary onCardAction={onCardAction} /> : null}
        {plan.secondary.map((action) => <CardActionButton key={action.id} appId={app.appId} action={action} primary={false} onCardAction={onCardAction} />)}
      </div>

      {entry.detail ? <span data-testid={`apps-entry-${app.appId}-detail`} className="break-words text-xs leading-5 text-[color:var(--nimi-text-muted)]">{entry.detail}</span> : null}
    </motion.li>
  );
}

function StateBadge({ testId, tone, children }: {
  readonly testId: string;
  readonly tone: 'neutral' | 'success' | 'warning' | 'danger';
  readonly children: string;
}): ReactElement {
  const classes = {
    neutral: 'bg-[color-mix(in_srgb,var(--nimi-text-muted)_10%,transparent)] text-[color:var(--nimi-text-muted)]',
    success: 'bg-[color-mix(in_srgb,var(--nimi-status-success)_14%,transparent)] text-[var(--nimi-status-success)]',
    warning: 'bg-[color-mix(in_srgb,var(--nimi-status-warning)_14%,transparent)] text-[var(--nimi-status-warning)]',
    danger: 'bg-[color-mix(in_srgb,var(--nimi-status-danger)_14%,transparent)] text-[var(--nimi-status-danger)]',
  } as const;
  return <span data-testid={testId} className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${classes[tone]}`}>{children}</span>;
}

function SourceChips({ appId, sources }: { readonly appId: string; readonly sources: NimiAppInventorySources }): ReactElement {
  const { t } = useTranslation();
  return (
    <div data-testid={`apps-entry-${appId}-sources`} className="flex flex-wrap gap-1.5">
      {INVENTORY_SOURCE_KEYS.map((key) => (
        <span
          key={key}
          data-testid={`apps-entry-${appId}-source-${sourceTestId(key)}`}
          data-source-status={sources[key].status}
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${sourceStatusTone(sources[key].status)}`}
          title={sourceTooltip(sources[key])}
        >
          {sourceLabel(key, t)}
          <span className="ml-1 opacity-80">{t(SOURCE_STATUS_LABEL_KEYS[sources[key].status])}</span>
        </span>
      ))}
    </div>
  );
}

function SourceDegradedDetails({ appId, sources }: { readonly appId: string; readonly sources: NimiAppInventorySources }): ReactElement | null {
  const { t } = useTranslation();
  const degraded = INVENTORY_SOURCE_KEYS.filter((key) => sources[key].status === 'degraded');
  if (degraded.length === 0) return null;
  return (
    <ul data-testid={`apps-entry-${appId}-source-degraded-details`} className="flex flex-col gap-1 text-xs text-[var(--nimi-status-warning)]">
      {degraded.map((key) => (
        <li key={key} data-testid={`apps-entry-${appId}-source-${sourceTestId(key)}-degraded`} className="break-words">
          {t('Apps.sourceDegradedDetail', {
            source: sourceLabel(key, t),
            reasonCode: sources[key].reasonCode ?? 'UNKNOWN',
            detail: sources[key].detail ?? '',
          })}
        </li>
      ))}
    </ul>
  );
}

function CardActionButton({ appId, action, primary, onCardAction }: {
  readonly appId: string;
  readonly action: AppCardAction;
  readonly primary: boolean;
  readonly onCardAction: (appId: string, action: AppCardActionId) => void;
}): ReactElement {
  const { t } = useTranslation();
  return (
    <Button data-testid={`apps-action-${appId}-${action.id}`} tone={primary ? 'primary' : 'ghost'} size="sm" onClick={() => onCardAction(appId, action.id)}>
      {t(action.id === 'sign_in' ? 'Apps.action.signIn' : 'Apps.action.details')}
    </Button>
  );
}

function inventoryStateLabel(state: AppInventoryPresenceState, t: TFunction): string {
  switch (state) {
    case 'catalog_only': return t('Apps.state.catalogOnly', { defaultValue: 'Catalog only' });
    case 'account_visible': return t('Apps.state.accountVisible', { defaultValue: 'Account visible' });
    case 'local_record_active': return t('Apps.state.localRecordActive', { defaultValue: 'Local record active' });
    case 'local_record_dormant': return t('Apps.state.localRecordDormant', { defaultValue: 'Local record dormant' });
    case 'local_record_removed': return t('Apps.state.localRecordRemoved', { defaultValue: 'Local record removed' });
    default: {
      const exhaustive: never = state;
      return exhaustive;
    }
  }
}

function accessTone(state: AppAccessState): 'success' | 'warning' | 'danger' | 'neutral' {
  switch (state) {
    case 'ready': return 'success';
    case 'sign_in_required':
    case 'local_record_dormant': return 'warning';
    case 'package_unavailable':
    case 'blocked_by_policy': return 'neutral';
    case 'unsupported': return 'danger';
    default: {
      const exhaustive: never = state;
      return exhaustive;
    }
  }
}

function accessFallback(state: AppAccessState): string {
  return state.replaceAll('_', ' ');
}

function sourceLabel(key: InventorySourceKey, t: TFunction): string {
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
