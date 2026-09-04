import type { MouseEvent, ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Info, MoreHorizontal, Play, Square, X } from 'lucide-react';
import {
  ActionMenu,
  AppCardSurface,
  Button,
  IconButton,
  Popover,
  PopoverContent,
  PopoverTrigger,
  StatusBadge,
  type NimiMenuItem,
} from '@nimiplatform/kit/ui';
import {
  actionPlanForEntry,
  type AppCardActionId,
} from './apps-card-actions.js';
import { appRunVisualState, appSourceForEntry, type AppRunVisualState } from './apps-card-fields.js';
import {
  AppArtworkIcon,
  AppPackageStatusLine,
  AppRunStatusLine,
  AppSourceBadge,
  appRunStatusLabel,
} from './apps-card-visuals.js';
import type { DesktopAppsEntry } from './apps-panel-projection.js';

function aiConfigSummaryPresentation(
  entry: DesktopAppsEntry,
  t: ReturnType<typeof useTranslation>['t'],
): { readonly label: string; readonly tone: 'neutral' | 'success' | 'info' | 'warning' | 'danger' } | null {
  const summary = entry.aiConfigSummary;
  if (!summary) return null;
  const count = `${summary.intentCount}/${summary.total}`;
  const route = (() => {
    switch (summary.routePosture) {
      case 'local': return { label: t('Apps.aiConfig.summary.local', { defaultValue: `AI: Local · ${count}`, summaryCount: count }), tone: 'success' as const };
      case 'cloud': return { label: t('Apps.aiConfig.summary.cloud', { defaultValue: `AI: Cloud · ${count}`, summaryCount: count }), tone: 'info' as const };
      case 'mixed': return { label: t('Apps.aiConfig.summary.mixed', { defaultValue: `AI: Mixed · ${count}`, summaryCount: count }), tone: 'info' as const };
      case 'partial-local': return { label: t('Apps.aiConfig.summary.partialLocal', { defaultValue: `AI: Partial Local · ${count}`, summaryCount: count }), tone: 'warning' as const };
      case 'partial-cloud': return { label: t('Apps.aiConfig.summary.partialCloud', { defaultValue: `AI: Partial Cloud · ${count}`, summaryCount: count }), tone: 'warning' as const };
      case 'partial-mixed': return { label: t('Apps.aiConfig.summary.partialMixed', { defaultValue: `AI: Partial Mixed · ${count}`, summaryCount: count }), tone: 'warning' as const };
      case 'unconfigured': return { label: t('Apps.aiConfig.summary.unconfigured', { defaultValue: 'AI not configured' }), tone: 'neutral' as const };
    }
  })();
  if (summary.healthPosture === 'blocked') {
    return {
      label: t('Apps.aiConfig.summary.blocked', {
        defaultValue: `${route.label} · ${summary.blockedCount} blocked`,
        routeLabel: route.label,
        blockedCount: summary.blockedCount,
      }),
      tone: 'danger',
    };
  }
  if (summary.healthPosture === 'unavailable') {
    return {
      label: summary.intentCount === 0
        ? t('Apps.aiConfig.summary.unavailable', { defaultValue: 'AI config unavailable' })
        : t('Apps.aiConfig.summary.healthUnavailable', {
            defaultValue: `${route.label} · health unavailable`,
            routeLabel: route.label,
          }),
      tone: 'danger',
    };
  }
  return route;
}

function stopCardEvent(event: MouseEvent): void {
  event.stopPropagation();
}

const ICON_CORNER_DOT_CLASS: Readonly<Record<Exclude<AppRunVisualState, 'stopped'>, string>> = {
  running: 'bg-[var(--nimi-status-success)]',
  starting: 'bg-[var(--nimi-action-primary-bg)]',
  failed: 'bg-[var(--nimi-status-danger)]',
};

export function AppGridCard({
  entry,
  activeAction,
  onAction,
}: {
  readonly entry: DesktopAppsEntry;
  readonly activeAction: AppCardActionId | null;
  readonly onAction: (action: AppCardActionId) => void;
}): ReactElement {
  const { t } = useTranslation();
  const { identity, localDevelopment } = entry;
  const visual = appRunVisualState(entry.run?.state ?? null);
  const aiConfigSummary = aiConfigSummaryPresentation(entry, t);
  const actionPlan = actionPlanForEntry(entry);
  const primary = actionPlan.primary?.id ?? null;

  const menuItems: NimiMenuItem[] = [
    {
      id: 'details',
      label: t('Apps.action.details'),
      icon: <Info className="h-4 w-4" aria-hidden="true" />,
      onSelect: () => onAction('details'),
    },
    ...(primary === null ? [] : [primary === 'stop'
      ? {
        id: 'stop',
        label: t('Apps.action.stop'),
        icon: <Square className="h-4 w-4" aria-hidden="true" />,
        disabled: activeAction !== null,
        onSelect: () => onAction('stop'),
      }
      : {
        id: 'launch',
        label: t('Apps.action.launch'),
        icon: <Play className="h-4 w-4" aria-hidden="true" />,
        disabled: activeAction !== null,
        onSelect: () => onAction('launch'),
      }]),
    ...(actionPlan.secondary.some((action) => action.id === 'cancel-job') ? [{
      id: 'cancel-job',
      label: t('Apps.action.cancel'),
      icon: <X className="h-4 w-4" aria-hidden="true" />,
      disabled: activeAction !== null,
      onSelect: () => onAction('cancel-job'),
    }] : []),
  ];

  return (
    <AppCardSurface
      kind="promoted-glass"
      as="div"
      className="group relative flex flex-col overflow-hidden transition-all duration-200 hover:-translate-y-0.5 hover:border-[var(--nimi-border-strong)] hover:shadow-[var(--nimi-elevation-raised)]"
      data-app-card
      data-testid={`apps-entry-${identity.entryKey}`}
      data-local-development-shell={localDevelopment?.shell}
      data-source-generation={localDevelopment?.sourceGeneration}
      data-declaration-generation={localDevelopment?.declarationGeneration}
    >
      <div className="absolute right-2.5 top-2.5 z-10 opacity-0 transition-opacity duration-150 group-focus-within:opacity-100 group-hover:opacity-100">
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
              onClick={stopCardEvent}
            />
          </PopoverTrigger>
          <PopoverContent align="end" sideOffset={6} className="p-1">
            <ActionMenu items={menuItems} ariaLabel={t('Apps.library.cardMenuLabel')} />
          </PopoverContent>
        </Popover>
      </div>
      <div className="absolute bottom-3 right-3 z-10 opacity-0 transition-opacity duration-150 group-focus-within:opacity-100 group-hover:opacity-100">
        {primary === 'stop' ? (
          <Button
            data-testid={`apps-entry-${identity.entryKey}-stop`}
            tone="secondary"
            size="sm"
            loading={activeAction === 'stop'}
            disabled={activeAction !== null}
            onClick={(event) => {
              event.stopPropagation();
              onAction('stop');
            }}
          >
            <Square className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
            {t('Apps.action.stop')}
          </Button>
        ) : primary === 'launch' ? (
          <Button
            data-testid={`apps-entry-${identity.entryKey}-launch`}
            tone="primary"
            size="sm"
            loading={activeAction === 'launch'}
            disabled={activeAction !== null}
            onClick={(event) => {
              event.stopPropagation();
              onAction('launch');
            }}
          >
            <Play className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
            {t('Apps.action.launch')}
          </Button>
        ) : null}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-2.5 p-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className="relative shrink-0">
            <AppArtworkIcon
              appId={identity.appId}
              displayName={identity.displayName}
              iconUrl={entry.iconUrl}
              size="lg"
              className="shadow-[var(--nimi-elevation-base)]"
            />
            {visual !== 'stopped' ? (
              <span
                className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full ring-2 ring-[var(--nimi-surface-card)] ${ICON_CORNER_DOT_CLASS[visual]}`}
                title={appRunStatusLabel(t, visual)}
                aria-hidden="true"
              />
            ) : null}
          </div>
          <div className="min-w-0 flex-1 pr-5">
            <button
              type="button"
              data-testid={`apps-entry-${identity.entryKey}-name`}
              className="block w-full truncate text-left text-sm font-semibold text-[color:var(--nimi-text-primary)] outline-none after:absolute after:inset-0 after:content-[''] focus-visible:text-[var(--nimi-action-primary-bg)]"
              onClick={() => onAction('details')}
            >
              {identity.displayName}
            </button>
            <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <AppSourceBadge source={appSourceForEntry(entry)} variant="quiet" />
              {localDevelopment || visual !== 'stopped' ? <AppRunStatusLine entry={entry} /> : null}
            </div>
          </div>
        </div>
        <AppPackageStatusLine entry={entry} />
        {aiConfigSummary ? (
          <div
            className="flex min-w-0 items-center"
            data-app-ai-config-summary={entry.aiConfigSummary?.routePosture}
            data-app-ai-config-health={entry.aiConfigSummary?.healthPosture}
          >
            <StatusBadge tone={aiConfigSummary.tone} shape="dot">
              {aiConfigSummary.label}
            </StatusBadge>
          </div>
        ) : null}
      </div>
    </AppCardSurface>
  );
}
