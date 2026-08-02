import { useState, type ReactElement, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'motion/react';
import { CheckCircle2, Code2, FolderOpen, ShieldCheck } from 'lucide-react';
import { Button, StatusBadge } from '@nimiplatform/kit/ui';
import {
  actionPlanForLocalDevelopmentEntry,
  type AppCardAction,
  type AppCardActionId,
} from './apps-card-actions.js';
import { deriveIconGlyph } from './apps-card-fields.js';
import type { DesktopAppsEntry, DesktopAppsPanelProjection } from './apps-panel-projection.js';
import { useDesktopCardMotion } from '../../ui/motion/desktop-motion';

export interface AppsPanelViewProps {
  readonly projection: DesktopAppsPanelProjection;
  readonly onCardAction: (appId: string, action: AppCardActionId) => void;
  readonly onOpenDeveloperMode: () => void;
  readonly onRetry: () => void;
  readonly actionError: string | null;
}

type AppsFilter = 'all' | 'active' | 'permissions';

export function AppsPanelView({
  projection,
  onCardAction,
  onOpenDeveloperMode,
  onRetry,
  actionError,
}: AppsPanelViewProps): ReactElement {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<AppsFilter>('all');

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
        <EmptyLocalDevelopmentApps onOpenDeveloperMode={onOpenDeveloperMode} />
      </section>
    );
  }

  const activeCount = projection.entries.filter((entry) => entry.authorization.state === 'active').length;
  const permissionCount = projection.entries.filter((entry) => entry.authorization.permissionRequirements.length > 0).length;
  const visibleEntries = projection.entries.filter((entry) => {
    if (filter === 'active') return entry.authorization.state === 'active';
    if (filter === 'permissions') return entry.authorization.permissionRequirements.length > 0;
    return true;
  });

  return (
    <section data-testid="apps-view" aria-labelledby="apps-view-title" className="flex h-full flex-col gap-4">
      <div className="flex flex-col gap-4 rounded-xl border border-[color:var(--nimi-border-subtle)] bg-[color-mix(in_srgb,var(--nimi-surface-card)_82%,transparent)] p-4 sm:p-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--nimi-action-primary-bg)]">
            {t('Apps.collectionEyebrow')}
          </p>
          <h2 id="apps-view-title" className="mt-2 text-xl font-semibold text-[color:var(--nimi-text-primary)]">
            {t('Apps.inventoryTitle')}
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[color:var(--nimi-text-secondary)]">
            {t('Apps.inventoryDescription')}
          </p>
        </div>
        <Button data-testid="apps-open-developer-mode-top" tone="secondary" size="sm" onClick={onOpenDeveloperMode} className="shrink-0 self-start lg:self-auto">
          {t('Apps.developerCard.action')}
        </Button>
      </div>

      <div data-testid="apps-overview" className="grid gap-3 sm:grid-cols-3">
        <OverviewStat
          icon={<Code2 className="h-5 w-5" />}
          label={t('Apps.overview.connected')}
          value={projection.entries.length}
          detail={t('Apps.overview.connectedDetail')}
        />
        <OverviewStat
          icon={<CheckCircle2 className="h-5 w-5" />}
          label={t('Apps.overview.active')}
          value={activeCount}
          detail={t('Apps.overview.activeDetail')}
        />
        <OverviewStat
          icon={<ShieldCheck className="h-5 w-5" />}
          label={t('Apps.overview.permissions')}
          value={permissionCount}
          detail={t('Apps.overview.permissionsDetail')}
        />
      </div>

      {actionError ? <ActionError detail={actionError} /> : null}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h3 className="text-base font-semibold text-[color:var(--nimi-text-primary)]">{t('Apps.listTitle')}</h3>
          <p className="mt-1 text-sm text-[color:var(--nimi-text-secondary)]">{t('Apps.listDescription')}</p>
        </div>
        <div role="group" aria-label={t('Apps.filter.label')} className="flex w-fit flex-wrap gap-1 rounded-full border border-[color:var(--nimi-border-subtle)] bg-[color-mix(in_srgb,var(--nimi-surface-card)_68%,transparent)] p-1">
          <FilterButton filter="all" activeFilter={filter} onSelect={setFilter} label={t('Apps.filter.all')} />
          <FilterButton filter="active" activeFilter={filter} onSelect={setFilter} label={t('Apps.filter.active')} />
          <FilterButton filter="permissions" activeFilter={filter} onSelect={setFilter} label={t('Apps.filter.permissions')} />
        </div>
      </div>

      {visibleEntries.length === 0 ? (
        <FilteredEmpty onReset={() => setFilter('all')} />
      ) : (
        <ul data-testid="apps-entry-list" className="grid gap-3 md:grid-cols-2">
          {visibleEntries.map((entry) => (
            <AppCard
              key={entry.authorization.selector}
              entry={entry}
              onCardAction={onCardAction}
            />
          ))}
        </ul>
      )}

      <div className="flex flex-col gap-3 rounded-xl border border-dashed border-[color:var(--nimi-border-subtle)] bg-[color-mix(in_srgb,var(--nimi-surface-active)_28%,transparent)] p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
        <div className="flex min-w-0 items-start gap-3">
          <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_12%,transparent)] text-[var(--nimi-action-primary-bg)]">
            <Code2 className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-[color:var(--nimi-text-primary)]">{t('Apps.developerCard.title')}</h3>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-[color:var(--nimi-text-secondary)]">{t('Apps.developerCard.description')}</p>
          </div>
        </div>
        <Button data-testid="apps-open-developer-mode-bottom" tone="ghost" size="sm" onClick={onOpenDeveloperMode} className="shrink-0 self-start sm:self-auto">
          {t('Apps.developerCard.action')}
        </Button>
      </div>
    </section>
  );
}

function OverviewStat({ icon, label, value, detail }: {
  readonly icon: ReactNode;
  readonly label: string;
  readonly value: number;
  readonly detail: string;
}): ReactElement {
  return (
    <div className="flex min-w-0 items-center gap-3 rounded-xl border border-[color:var(--nimi-border-subtle)] bg-[color-mix(in_srgb,var(--nimi-surface-card)_72%,transparent)] p-4">
      <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_10%,transparent)] text-[var(--nimi-action-primary-bg)]">
        {icon}
      </span>
      <div className="min-w-0">
        <p className="truncate text-xs font-medium text-[color:var(--nimi-text-secondary)]">{label}</p>
        <div className="mt-1 flex items-baseline gap-2">
          <span className="text-2xl font-semibold leading-none text-[color:var(--nimi-text-primary)]">{value}</span>
          <span className="truncate text-xs text-[color:var(--nimi-text-muted)]">{detail}</span>
        </div>
      </div>
    </div>
  );
}

function FilterButton({ filter, activeFilter, onSelect, label }: {
  readonly filter: AppsFilter;
  readonly activeFilter: AppsFilter;
  readonly onSelect: (filter: AppsFilter) => void;
  readonly label: string;
}): ReactElement {
  const active = filter === activeFilter;
  return (
    <button
      type="button"
      aria-pressed={active}
      data-testid={`apps-filter-${filter}`}
      onClick={() => onSelect(filter)}
      className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${active
        ? 'bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_14%,transparent)] text-[var(--nimi-action-primary-bg)]'
        : 'text-[color:var(--nimi-text-secondary)] hover:bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_8%,transparent)] hover:text-[color:var(--nimi-text-primary)]'
      }`}
    >
      {label}
    </button>
  );
}

function ActionError({ detail }: { readonly detail: string }): ReactElement {
  return (
    <p data-testid="apps-action-error" role="alert" className="break-words rounded-lg border border-[color-mix(in_srgb,var(--nimi-status-danger)_24%,transparent)] bg-[color-mix(in_srgb,var(--nimi-status-danger)_8%,transparent)] px-3 py-2 text-sm leading-6 text-[var(--nimi-status-danger)]">
      {detail}
    </p>
  );
}

function EmptyLocalDevelopmentApps(props: {
  readonly onOpenDeveloperMode: () => void;
}): ReactElement {
  const { t } = useTranslation();
  return (
    <div data-testid="apps-empty-local-development" data-state="empty" className="flex min-h-[300px] flex-col justify-center rounded-xl border border-dashed border-[color:var(--nimi-border-subtle)] bg-[color-mix(in_srgb,var(--nimi-surface-active)_28%,transparent)] p-6 sm:p-8">
      <div className="mx-auto flex max-w-xl flex-col items-center text-center">
        <span aria-hidden="true" className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_12%,transparent)] text-[var(--nimi-action-primary-bg)]">
          <Code2 className="h-7 w-7" />
        </span>
        <h2 id="apps-source-manager-title" className="mt-4 text-lg font-semibold text-[color:var(--nimi-text-primary)]">
          {t('Apps.emptyConnectedTitle')}
        </h2>
        <p className="mt-2 text-sm leading-6 text-[color:var(--nimi-text-secondary)]">
          {t('Apps.emptyConnectedDescription')}
        </p>
        <Button data-testid="apps-open-developer-mode-empty" tone="primary" size="sm" onClick={props.onOpenDeveloperMode} className="mt-5">
          {t('Apps.developerCard.action')}
        </Button>
      </div>
    </div>
  );
}

function FilteredEmpty({ onReset }: { readonly onReset: () => void }): ReactElement {
  const { t } = useTranslation();
  return (
    <div data-testid="apps-filter-empty" className="flex min-h-32 flex-col items-center justify-center rounded-xl border border-dashed border-[color:var(--nimi-border-subtle)] px-4 py-8 text-center">
      <p className="text-sm font-medium text-[color:var(--nimi-text-primary)]">{t('Apps.filter.empty')}</p>
      <Button tone="ghost" size="sm" onClick={onReset} className="mt-2">
        {t('Apps.filter.reset')}
      </Button>
    </div>
  );
}

function AppCard({ entry, onCardAction }: {
  readonly entry: DesktopAppsEntry;
  readonly onCardAction: (appId: string, action: AppCardActionId) => void;
}): ReactElement {
  const { t } = useTranslation();
  const cardMotion = useDesktopCardMotion();
  const { authorization } = entry;
  const plan = actionPlanForLocalDevelopmentEntry();

  return (
    <motion.li
      layout
      data-testid={`apps-entry-${authorization.appId}`}
      data-local-development-state={authorization.state}
      data-local-development-shell={authorization.shell}
      data-local-development-persistence={authorization.persistence}
      whileHover={cardMotion.whileHover}
      whileTap={cardMotion.whileTap}
      transition={cardMotion.transition}
      className="group flex min-h-[228px] flex-col rounded-xl border border-[color:var(--nimi-border-subtle)] bg-[color-mix(in_srgb,var(--nimi-surface-card)_82%,transparent)] p-4 transition-colors hover:border-[color-mix(in_srgb,var(--nimi-action-primary-bg)_28%,var(--nimi-border-subtle))]"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span data-testid={`apps-entry-${authorization.appId}-icon`} aria-hidden="true" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_10%,var(--nimi-surface-active))] text-base font-semibold text-[color:var(--nimi-text-primary)]">
            {deriveIconGlyph(authorization.displayName)}
          </span>
          <div className="min-w-0">
            <span data-testid={`apps-entry-${authorization.appId}-name`} className="block break-words text-base font-semibold text-[color:var(--nimi-text-primary)]">{authorization.displayName}</span>
            <span data-testid={`apps-entry-${authorization.appId}-kind`} className="mt-1 block text-xs text-[color:var(--nimi-text-muted)]">{t('Apps.card.local')}</span>
          </div>
        </div>
        <div className="flex flex-wrap justify-end gap-1.5">
          <StatusBadge
            data-testid={`apps-entry-${authorization.appId}-state`}
            tone={authorizationStateTone(authorization.state)}
          >
            {t(`LocalDevelopment.state.${authorization.state}`, { defaultValue: authorization.state })}
          </StatusBadge>
          <StatusBadge data-testid={`apps-entry-${authorization.appId}-shell`} tone="info">
            {t(`LocalDevelopment.shell.${authorization.shell}`, { defaultValue: authorization.shell })}
          </StatusBadge>
        </div>
      </div>

      <div className="mt-5 rounded-lg bg-[color-mix(in_srgb,var(--nimi-surface-active)_46%,transparent)] px-3 py-2.5">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold text-[color:var(--nimi-text-muted)]">
          <FolderOpen className="h-3.5 w-3.5" aria-hidden="true" />
          {t('Apps.card.projectRoot')}
        </div>
        <p data-testid={`apps-entry-${authorization.appId}-project-root`} title={authorization.canonicalProjectRoot} className="mt-1 truncate font-mono text-xs leading-5 text-[color:var(--nimi-text-secondary)]">
          {authorization.canonicalProjectRoot}
        </p>
      </div>

      <div data-testid={`apps-entry-${authorization.appId}-permissions`} className="mt-4 min-h-8">
        {authorization.permissionRequirements.length === 0 ? (
          <span className="inline-flex items-center gap-1.5 text-xs text-[color:var(--nimi-text-muted)]">
            <CheckCircle2 className="h-3.5 w-3.5 text-[var(--nimi-status-success)]" aria-hidden="true" />
            {t('Apps.card.noExtraPermissions')}
          </span>
        ) : (
          <div>
            <p className="mb-2 text-[11px] font-semibold text-[color:var(--nimi-text-muted)]">{t('Apps.card.permissions')}</p>
            <div className="flex flex-wrap gap-1.5">
              {authorization.permissionRequirements.map((requirement) => (
                <span key={requirement.permissionId} data-permission-id={requirement.permissionId} title={requirement.reason} className="max-w-full truncate rounded-full bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_10%,transparent)] px-2 py-1 text-xs font-medium text-[color:var(--nimi-text-secondary)]">
                  {requirement.permissionId}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      <div data-testid={`apps-entry-${authorization.appId}-actions`} className="mt-auto flex flex-wrap items-center justify-end gap-2 border-t border-[color:var(--nimi-border-subtle)] pt-3">
        {plan.secondary.map((action) => (
          <CardActionButton
            key={action.id}
            appId={authorization.appId}
            action={action}
            onCardAction={onCardAction}
          />
        ))}
      </div>
    </motion.li>
  );
}

function CardActionButton({ appId, action, onCardAction }: {
  readonly appId: string;
  readonly action: AppCardAction;
  readonly onCardAction: (appId: string, action: AppCardActionId) => void;
}): ReactElement {
  const { t } = useTranslation();
  return (
    <Button data-testid={`apps-action-${appId}-${action.id}`} tone="ghost" size="sm" onClick={() => onCardAction(appId, action.id)}>
      {t('Apps.action.details')}
    </Button>
  );
}

function authorizationStateTone(state: string): 'success' | 'warning' | 'danger' | 'neutral' {
  if (state === 'active' || state === 'running') return 'success';
  if (['denied', 'revoked', 'failed', 'build-failed', 'project-changed'].includes(state)) return 'danger';
  if (['preparing', 'pending-approval', 'building', 'starting', 'restarting', 'runtime-unavailable', 'authorization-required', 'reapproval-required', 'confirmation-required'].includes(state)) return 'warning';
  return 'neutral';
}
