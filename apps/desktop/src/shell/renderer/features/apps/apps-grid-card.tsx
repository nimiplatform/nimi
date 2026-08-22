import type { MouseEvent, ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Info, MoreHorizontal, Play, Square } from 'lucide-react';
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
  actionPlanForLocalDevelopmentEntry,
  type AppCardActionId,
} from './apps-card-actions.js';
import { appRunVisualState, CURRENT_APP_SOURCE } from './apps-card-fields.js';
import {
  AppArtworkCover,
  AppRunStatusBadge,
  AppRunStatusLine,
  AppSourceBadge,
} from './apps-card-visuals.js';
import type { DesktopAppsEntry } from './apps-panel-projection.js';

function aiConfigSummaryPresentation(
  entry: DesktopAppsEntry,
  t: ReturnType<typeof useTranslation>['t'],
): { readonly label: string; readonly tone: 'neutral' | 'success' | 'info' | 'warning' | 'danger' } | null {
  const summary = entry.aiConfigSummary;
  if (!summary) return null;
  const count = `${summary.configuredCount}/${summary.totalCount}`;
  switch (summary.posture) {
    case 'local': return { label: t('Apps.aiConfig.summary.local', { defaultValue: `Local · ${count}`, summaryCount: count }), tone: 'success' };
    case 'cloud': return { label: t('Apps.aiConfig.summary.cloud', { defaultValue: `Cloud · ${count}`, summaryCount: count }), tone: 'info' };
    case 'mixed': return { label: t('Apps.aiConfig.summary.mixed', { defaultValue: `Mixed · ${count}`, summaryCount: count }), tone: 'info' };
    case 'partial-local': return { label: t('Apps.aiConfig.summary.partialLocal', { defaultValue: `Partial Local · ${count}`, summaryCount: count }), tone: 'warning' };
    case 'partial-cloud': return { label: t('Apps.aiConfig.summary.partialCloud', { defaultValue: `Partial Cloud · ${count}`, summaryCount: count }), tone: 'warning' };
    case 'partial-mixed': return { label: t('Apps.aiConfig.summary.partialMixed', { defaultValue: `Partial Mixed · ${count}`, summaryCount: count }), tone: 'warning' };
    case 'unconfigured': return { label: t('Apps.aiConfig.summary.unconfigured', { defaultValue: 'AI not configured' }), tone: 'neutral' };
    case 'unavailable': return { label: t('Apps.aiConfig.summary.unavailable', { defaultValue: 'AI config unavailable' }), tone: 'danger' };
  }
}

function stopCardEvent(event: MouseEvent): void {
  event.stopPropagation();
}

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
  const { registration } = entry;
  const visual = appRunVisualState(entry.run?.state ?? null);
  const aiConfigSummary = aiConfigSummaryPresentation(entry, t);
  const actionPlan = actionPlanForLocalDevelopmentEntry(entry.run?.state ?? null);
  const primary = actionPlan.primary?.id === 'stop' ? 'stop' : 'launch';

  const menuItems: NimiMenuItem[] = [
    {
      id: 'details',
      label: t('Apps.action.details'),
      icon: <Info className="h-4 w-4" aria-hidden="true" />,
      onSelect: () => onAction('details'),
    },
    primary === 'stop'
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
      },
  ];

  return (
    <AppCardSurface
      kind="promoted-glass"
      as="div"
      className="group relative flex flex-col overflow-hidden transition-all duration-200 hover:-translate-y-0.5 hover:border-[var(--nimi-border-strong)] hover:shadow-[var(--nimi-elevation-raised)]"
      data-app-card
      data-testid={`apps-entry-${registration.appId}`}
      data-local-development-shell={registration.shell}
      data-source-generation={registration.sourceGeneration}
      data-declaration-generation={registration.declarationGeneration}
    >
      <div className="relative">
        <AppArtworkCover
          appId={registration.appId}
          displayName={registration.displayName}
          className="aspect-[16/9] w-full"
        />
        {visual !== 'stopped' ? (
          <div className="pointer-events-none absolute left-2.5 top-2.5 z-10">
            <AppRunStatusBadge entry={entry} />
          </div>
        ) : null}
        <div className="absolute right-2.5 top-2.5 z-10 opacity-0 transition-opacity duration-150 group-focus-within:opacity-100 group-hover:opacity-100">
          <Popover>
            <PopoverTrigger asChild>
              <IconButton
                data-testid={`apps-entry-${registration.appId}-menu`}
                icon={<MoreHorizontal className="h-4 w-4" aria-hidden="true" />}
                tone="secondary"
                size="sm"
                aria-label={t('Apps.library.cardMenuLabel')}
                title={t('Apps.library.cardMenuLabel')}
                className="h-7 w-7 border-white/50 bg-white/85 shadow-[var(--nimi-elevation-base)] backdrop-blur"
                onClick={stopCardEvent}
              />
            </PopoverTrigger>
            <PopoverContent align="end" sideOffset={6} className="p-1">
              <ActionMenu items={menuItems} ariaLabel={t('Apps.library.cardMenuLabel')} />
            </PopoverContent>
          </Popover>
        </div>
        <div className="absolute bottom-2.5 right-2.5 z-10 opacity-0 transition-opacity duration-150 group-focus-within:opacity-100 group-hover:opacity-100">
          {primary === 'stop' ? (
            <Button
              data-testid={`apps-entry-${registration.appId}-stop`}
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
          ) : (
            <Button
              data-testid={`apps-entry-${registration.appId}-launch`}
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
          )}
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-1.5 px-3.5 py-3">
        <button
          type="button"
          data-testid={`apps-entry-${registration.appId}-name`}
          className="block w-full truncate text-left text-sm font-semibold text-[color:var(--nimi-text-primary)] outline-none after:absolute after:inset-0 after:content-[''] focus-visible:text-[var(--nimi-action-primary-bg)]"
          onClick={() => onAction('details')}
        >
          {registration.displayName}
        </button>
        <div className="flex min-w-0 items-center justify-between gap-2">
          <AppSourceBadge source={CURRENT_APP_SOURCE} />
          <AppRunStatusLine entry={entry} />
        </div>
        {aiConfigSummary ? (
          <div className="mt-1 flex min-w-0 items-center" data-app-ai-config-summary={entry.aiConfigSummary?.posture}>
            <StatusBadge tone={aiConfigSummary.tone} shape="dot">
              {aiConfigSummary.label}
            </StatusBadge>
          </div>
        ) : null}
      </div>
    </AppCardSurface>
  );
}
