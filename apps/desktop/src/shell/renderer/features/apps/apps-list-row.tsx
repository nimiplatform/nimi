import { memo, type MouseEvent, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import {
  LoaderCircle,
  MoreHorizontal,
} from 'lucide-react';
import {
  ActionMenu,
  Button,
  IconButton,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@nimiplatform/kit/ui';
import {
  actionPlanForEntry,
  canRequestCatalogUpdate,
  hasAvailableCatalogUpdate,
  type AppCardActionId,
} from './apps-card-actions.js';
import {
  appRunVisualState,
  appSourceForEntry,
  type AppRunVisualState,
} from './apps-card-fields.js';
import {
  AppArtworkIcon,
  AppPackageStatusLine,
  AppSourceBadge,
  appRunStatusLabel,
} from './apps-card-visuals.js';
import { useAppEntryMenu } from './apps-entry-menu.js';
import type { DesktopAppsEntry } from './apps-panel-projection.js';

// @nimi-authority: rule.nimi.platform.app-ecosystem.p-napp-001a

function aiConfigSummaryPresentation(
  entry: DesktopAppsEntry,
  t: ReturnType<typeof useTranslation>['t'],
): { readonly label: string } | null {
  const summary = entry.aiConfigSummary;
  if (!summary) return null;
  // List rows are the consumer surface: only postures that need action earn a
  // pill. Route fractions (AI 本地 · 2/13) and healthy partial setups stay in
  // the detail AI tab, whose audience can act on the precise numbers.
  if (summary.healthPosture === 'blocked') {
    return {
      label: t('Apps.aiConfig.summary.blockedBrief', {
        defaultValue: `AI blocked · ${summary.blockedCount}`,
        blockedCount: summary.blockedCount,
      }),
    };
  }
  if (summary.healthPosture === 'unavailable') {
    return {
      label: t('Apps.aiConfig.summary.unavailableBrief', { defaultValue: 'AI status unavailable' }),
    };
  }
  return null;
}

const RUN_STATUS_TEXT_TONE: Readonly<Record<AppRunVisualState, string>> = Object.freeze({
  running: 'text-[var(--nimi-status-success)]',
  starting: 'text-[var(--nimi-action-primary-bg)]',
  stopped: 'text-[color:var(--nimi-text-muted)]',
  failed: 'text-[var(--nimi-status-danger)]',
});

/**
 * App Store style run status: a plain colored dot (or spinner) plus status
 * copy, no pill chrome. Local-development entries only; Runtime package state
 * stays on AppPackageStatusLine.
 */
export function AppRunStatusText({ entry }: { readonly entry: DesktopAppsEntry }): ReactElement {
  const { t } = useTranslation();
  const visual = appRunVisualState(entry.run?.state ?? null);
  return (
    <span
      data-run-visual={visual}
      title={visual === 'failed' ? entry.run?.message : undefined}
      className={`inline-flex min-w-0 items-center gap-1.5 text-xs font-medium leading-4 ${RUN_STATUS_TEXT_TONE[visual]}`}
    >
      {visual === 'starting' ? (
        <LoaderCircle className="h-3 w-3 shrink-0 animate-spin" aria-hidden="true" />
      ) : (
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" aria-hidden="true" />
      )}
      <span className="truncate">{appRunStatusLabel(t, visual)}</span>
    </span>
  );
}

// App Store capsule action: tinted primary fill, no border, pill radius. The
// failed state keeps the plain bordered secondary look so the retry read as a
// corrective action instead of a launch affordance.
const launchCapsuleClassName = 'rounded-full border-transparent bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_12%,transparent)] px-4 text-[var(--nimi-action-primary-bg)] hover:border-transparent hover:bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_18%,transparent)] hover:shadow-none';

export function AppRowActionButton({
  entry,
  activeAction,
  actionsDisabled,
  onAction,
}: {
  readonly entry: DesktopAppsEntry;
  readonly activeAction: AppCardActionId | null;
  readonly actionsDisabled: boolean;
  readonly onAction: (action: AppCardActionId) => void;
}): ReactElement | null {
  const { t } = useTranslation();
  const { identity, localDevelopment } = entry;
  const visual = appRunVisualState(entry.run?.state ?? null);
  if (localDevelopment === null) {
    const action = actionPlanForEntry(entry).primary?.id;
    if (action !== 'launch') return null;
    return (
      <Button
        data-testid={`apps-entry-${identity.entryKey}-${action}`}
        tone="secondary"
        size="sm"
        className={launchCapsuleClassName}
        loading={activeAction === action}
        disabled={actionsDisabled}
        onClick={(event) => {
          event.stopPropagation();
          onAction(action);
        }}
      >
        {t(visual === 'running' ? 'Apps.action.focus' : 'Apps.action.launch')}
      </Button>
    );
  }

  const launch = (event: MouseEvent): void => {
    event.stopPropagation();
    onAction('launch');
  };

  if (visual === 'starting') {
    return (
      <Button
        data-testid={`apps-entry-${identity.entryKey}-starting`}
        tone="secondary"
        size="sm"
        loading
        disabled
        className={launchCapsuleClassName}
      >
        {t('Apps.runState.starting')}
      </Button>
    );
  }
  if (visual === 'running') {
    return (
      <Button
        data-testid={`apps-entry-${identity.entryKey}-stop`}
        tone="secondary"
        size="sm"
        className={launchCapsuleClassName}
        loading={activeAction === 'stop'}
        disabled={actionsDisabled}
        onClick={(event) => {
          event.stopPropagation();
          onAction('stop');
        }}
      >
        {t('Apps.action.stop')}
      </Button>
    );
  }
  if (visual === 'failed') {
    return (
      <Button
        data-testid={`apps-entry-${identity.entryKey}-retry`}
        tone="secondary"
        size="sm"
        loading={activeAction === 'launch'}
        disabled={actionsDisabled}
        onClick={launch}
      >
        {t('Apps.action.retry')}
      </Button>
    );
  }
  return (
    <Button
      data-testid={`apps-entry-${identity.entryKey}-launch`}
      tone="secondary"
      size="sm"
      className={launchCapsuleClassName}
      loading={activeAction === 'launch'}
      disabled={actionsDisabled}
      onClick={launch}
    >
      {t('Apps.action.launch')}
    </Button>
  );
}

function stopRowEvent(event: MouseEvent): void {
  event.stopPropagation();
}

export const AppListRow = memo(function AppListRow({
  entry,
  activeAction,
  actionsDisabled,
  showSourceBadge = false,
  onAction,
}: {
  readonly entry: DesktopAppsEntry;
  readonly activeAction: AppCardActionId | null;
  readonly actionsDisabled: boolean;
  readonly showSourceBadge?: boolean;
  readonly onAction: (action: AppCardActionId) => void;
}): ReactElement {
  const { t } = useTranslation();
  const { identity, localDevelopment } = entry;
  const aiConfigSummary = aiConfigSummaryPresentation(entry, t);
  const source = appSourceForEntry(entry);
  const { menuItems, confirmElement } = useAppEntryMenu({
    entry,
    actionsDisabled,
    removePending: activeAction === 'remove',
    onAction,
  });

  return (
    <div
      data-app-card
      data-testid={`apps-entry-${identity.entryKey}`}
      data-local-development-shell={localDevelopment?.shell}
      data-source-generation={localDevelopment?.sourceGeneration}
      data-declaration-generation={localDevelopment?.declarationGeneration}
      className="group relative flex min-w-0 items-center gap-4 rounded-2xl px-3 py-3 transition-colors duration-150 hover:bg-[color-mix(in_srgb,var(--nimi-surface-active)_45%,transparent)]"
    >
      <AppArtworkIcon
        appId={identity.appId}
        displayName={identity.displayName}
        iconUrl={entry.iconUrl}
        size="lg"
        className="shadow-[var(--nimi-elevation-base)]"
      />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            data-testid={`apps-entry-${identity.entryKey}-name`}
            className="min-w-0 truncate text-left text-sm font-semibold leading-5 text-[color:var(--nimi-text-primary)] outline-none after:absolute after:inset-0 after:content-[''] focus-visible:text-[var(--nimi-action-primary-bg)]"
            onClick={() => onAction('details')}
          >
            {identity.displayName}
          </button>
          {showSourceBadge || source !== 'local_development' ? (
            <AppSourceBadge source={source} variant="quiet" className="shrink-0" />
          ) : null}
        </div>
        {entry.summary ? (
          <p
            data-testid={`apps-entry-${identity.entryKey}-summary`}
            className="mt-0.5 truncate text-xs leading-4 text-[color:var(--nimi-text-muted)]"
          >
            {entry.summary}
          </p>
        ) : null}
        <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          {localDevelopment !== null || entry.run ? <AppRunStatusText entry={entry} /> : null}
          {entry.run && 'accessAvailable' in entry.run ? (
            <span className="text-xs text-[var(--nimi-text-muted)]">
              {t(entry.run.accessAvailable ? 'Apps.installedAccess.ready' : 'Apps.installedAccess.unavailable')}
            </span>
          ) : null}
          {aiConfigSummary ? (
            <button
              type="button"
              data-testid={`apps-entry-${identity.entryKey}-ai-config-open`}
              title={t('Apps.aiConfig.openSettings')}
              aria-label={t('Apps.aiConfig.openSettings')}
              data-app-ai-config-summary={entry.aiConfigSummary?.routePosture}
              data-app-ai-config-health={entry.aiConfigSummary?.healthPosture}
              className="relative z-10 inline-flex min-w-0 items-center rounded text-xs font-medium leading-4 text-[var(--nimi-status-danger)] outline-none hover:underline focus-visible:ring-[length:var(--nimi-focus-ring-width)] focus-visible:ring-[var(--nimi-focus-ring-color)]"
              onClick={(event) => {
                event.stopPropagation();
                onAction('open-ai-config');
              }}
            >
              <span className="truncate">{aiConfigSummary.label}</span>
            </button>
          ) : null}
          {localDevelopment === null ? <AppPackageStatusLine entry={entry} /> : null}
        </div>
      </div>
      <div className="relative z-10 flex shrink-0 items-center gap-1">
        {hasAvailableCatalogUpdate(entry) ? (
          <Button size="sm" tone="primary" data-testid={`apps-entry-${identity.entryKey}-update`}
            loading={activeAction === 'update'} disabled={actionsDisabled || !canRequestCatalogUpdate(entry)}
            title={!canRequestCatalogUpdate(entry) && entry.run?.state === 'running' ? t('Apps.update.stopRequired') : undefined}
            onClick={() => onAction('update')}>
            {t('Apps.action.update')}
          </Button>
        ) : null}
        <AppRowActionButton entry={entry} activeAction={activeAction} actionsDisabled={actionsDisabled} onAction={onAction} />
        <Popover>
          <PopoverTrigger asChild>
            <IconButton
              data-testid={`apps-entry-${identity.entryKey}-menu`}
              icon={<MoreHorizontal className="h-4 w-4" aria-hidden="true" />}
              tone="ghost"
              size="sm"
              aria-label={t('Apps.library.cardMenuLabel')}
              title={t('Apps.library.cardMenuLabel')}
              className="h-7 w-7"
              onClick={stopRowEvent}
            />
          </PopoverTrigger>
          <PopoverContent align="end" sideOffset={6} className="p-1">
            <ActionMenu items={menuItems} ariaLabel={t('Apps.library.cardMenuLabel')} />
          </PopoverContent>
        </Popover>
      </div>

      {confirmElement}
    </div>
  );
});
