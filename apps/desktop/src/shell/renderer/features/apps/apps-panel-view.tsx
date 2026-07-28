import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'motion/react';
import { Code2 } from 'lucide-react';
import { Button } from '@nimiplatform/kit/ui';
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

export function AppsPanelView({
  projection,
  onCardAction,
  onOpenDeveloperMode,
  onRetry,
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
        <EmptyLocalDevelopmentApps onOpenDeveloperMode={onOpenDeveloperMode} />
      </section>
    );
  }

  return (
    <section data-testid="apps-view" aria-labelledby="apps-view-title" className="flex h-full flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="apps-view-title" className="text-base font-semibold text-[color:var(--nimi-text-primary)]">{t('Apps.inventoryTitle')}</h2>
          <p className="mt-1 text-sm text-[color:var(--nimi-text-secondary)]">
            {t('LocalDevelopment.management.description')}
          </p>
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
          <AppCard
            key={entry.authorization.selector}
            entry={entry}
            onCardAction={onCardAction}
          />
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

function EmptyLocalDevelopmentApps(props: {
  readonly onOpenDeveloperMode: () => void;
}): ReactElement {
  const { t } = useTranslation();
  return (
    <div data-testid="apps-empty-local-development" data-state="empty" className="flex min-h-[260px] flex-col">
      <h2 id="apps-source-manager-title" className="text-base font-semibold text-[color:var(--nimi-text-primary)]">
        {t('LocalDevelopment.management.title')}
      </h2>
      <div className="mt-3 flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-[color:var(--nimi-border-subtle)] text-[color:var(--nimi-text-primary)]"><Code2 className="h-5 w-5" /></span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-[color:var(--nimi-text-primary)]">{t('DeveloperTools.developerModeTitle')}</p>
            <p className="mt-1 max-w-2xl break-words text-sm leading-6 text-[color:var(--nimi-text-secondary)]">
              {t('LocalDevelopment.management.empty')}
            </p>
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
      className="flex flex-col gap-3 rounded-lg border border-[color:var(--nimi-border-subtle)] bg-[color-mix(in_srgb,var(--nimi-surface-card)_82%,transparent)] px-3 py-3"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span data-testid={`apps-entry-${authorization.appId}-icon`} aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[color-mix(in_srgb,var(--nimi-surface-active)_70%,transparent)] text-sm font-semibold text-[color:var(--nimi-text-primary)]">
            {deriveIconGlyph(authorization.displayName)}
          </span>
          <div className="min-w-0">
            <span data-testid={`apps-entry-${authorization.appId}-name`} className="block break-words text-sm font-medium text-[color:var(--nimi-text-primary)]">{authorization.displayName}</span>
            <span data-testid={`apps-entry-${authorization.appId}-kind`} className="mt-0.5 block text-xs text-[color:var(--nimi-text-muted)]">{t('LocalDevelopment.trustClass')}</span>
          </div>
        </div>
        <div className="flex flex-wrap justify-end gap-1.5">
          <StateBadge
            testId={`apps-entry-${authorization.appId}-state`}
            tone={authorizationStateTone(authorization.state)}
          >
            {t(`LocalDevelopment.state.${authorization.state}`, { defaultValue: authorization.state })}
          </StateBadge>
          <StateBadge testId={`apps-entry-${authorization.appId}-shell`} tone="neutral">
            {t(`LocalDevelopment.shell.${authorization.shell}`, { defaultValue: authorization.shell })}
          </StateBadge>
        </div>
      </div>

      <p data-testid={`apps-entry-${authorization.appId}-project-root`} className="break-all rounded-md bg-[color-mix(in_srgb,var(--nimi-surface-active)_46%,transparent)] px-2 py-1.5 font-mono text-xs leading-5 text-[color:var(--nimi-text-secondary)]">
        {authorization.canonicalProjectRoot}
      </p>

      <div data-testid={`apps-entry-${authorization.appId}-permissions`} className="flex flex-wrap gap-1.5">
        {authorization.permissionRequirements.length === 0 ? (
          <span className="text-xs text-[color:var(--nimi-text-muted)]">{t('LocalDevelopment.field.noExtraPermissions')}</span>
        ) : authorization.permissionRequirements.map((requirement) => (
          <span key={requirement.permissionId} data-permission-id={requirement.permissionId} className="rounded-full bg-[color-mix(in_srgb,var(--nimi-surface-active)_60%,transparent)] px-2 py-0.5 text-xs font-medium text-[color:var(--nimi-text-muted)]">
            {requirement.permissionId}
          </span>
        ))}
      </div>

      <div data-testid={`apps-entry-${authorization.appId}-actions`} className="flex flex-wrap items-center gap-2">
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

function StateBadge({ testId, tone, children }: {
  readonly testId: string;
  readonly tone: 'neutral' | 'success' | 'danger';
  readonly children: string;
}): ReactElement {
  const classes = {
    neutral: 'bg-[color-mix(in_srgb,var(--nimi-text-muted)_10%,transparent)] text-[color:var(--nimi-text-muted)]',
    success: 'bg-[color-mix(in_srgb,var(--nimi-status-success)_14%,transparent)] text-[var(--nimi-status-success)]',
    danger: 'bg-[color-mix(in_srgb,var(--nimi-status-danger)_14%,transparent)] text-[var(--nimi-status-danger)]',
  } as const;
  return <span data-testid={testId} className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${classes[tone]}`}>{children}</span>;
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

function authorizationStateTone(state: string): 'success' | 'danger' | 'neutral' {
  if (state === 'active') return 'success';
  if (state === 'denied' || state === 'revoked') return 'danger';
  return 'neutral';
}
