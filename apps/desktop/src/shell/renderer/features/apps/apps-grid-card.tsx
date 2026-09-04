import { useEffect, useRef, useState, type MouseEvent, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { AppWindow, Check, Copy, Info, MoreHorizontal, Play, Square, Trash2, X } from 'lucide-react';
import {
  ActionMenu,
  AppCardSurface,
  Button,
  ConfirmDialog,
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
import { appRunVisualState, appSourceForEntry } from './apps-card-fields.js';
import {
  AppArtworkIcon,
  AppPackageStatusLine,
  AppRunStatusBadge,
  AppSourceBadge,
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
      case 'local': return { label: t('Apps.aiConfig.summary.local', { defaultValue: `AI Local · ${count}`, summaryCount: count }), tone: 'success' as const };
      case 'cloud': return { label: t('Apps.aiConfig.summary.cloud', { defaultValue: `AI Cloud · ${count}`, summaryCount: count }), tone: 'info' as const };
      case 'mixed': return { label: t('Apps.aiConfig.summary.mixed', { defaultValue: `AI Local + Cloud · ${count}`, summaryCount: count }), tone: 'info' as const };
      case 'partial-local': return { label: t('Apps.aiConfig.summary.partialLocal', { defaultValue: `AI Local · ${count}`, summaryCount: count }), tone: 'warning' as const };
      case 'partial-cloud': return { label: t('Apps.aiConfig.summary.partialCloud', { defaultValue: `AI Cloud · ${count}`, summaryCount: count }), tone: 'warning' as const };
      case 'partial-mixed': return { label: t('Apps.aiConfig.summary.partialMixed', { defaultValue: `AI Local + Cloud · ${count}`, summaryCount: count }), tone: 'warning' as const };
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
  // Plain unconfigured is the default for a fresh app, not a signal: repeating
  // a neutral pill on every card would drown out the postures that actually
  // need attention (configured, partial, blocked, unavailable above).
  return summary.routePosture === 'unconfigured' ? null : route;
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
  const { identity, localDevelopment } = entry;
  const visual = appRunVisualState(entry.run?.state ?? null);
  const aiConfigSummary = aiConfigSummaryPresentation(entry, t);
  const actionPlan = actionPlanForEntry(entry);
  const canLaunch = localDevelopment !== null;
  const source = appSourceForEntry(entry);
  const [copiedAppId, setCopiedAppId] = useState(false);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const copyResetTimerRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (copyResetTimerRef.current !== null) {
      window.clearTimeout(copyResetTimerRef.current);
    }
  }, []);

  const copyAppId = (): void => {
    void navigator.clipboard?.writeText(identity.appId).then(() => {
      setCopiedAppId(true);
      if (copyResetTimerRef.current !== null) window.clearTimeout(copyResetTimerRef.current);
      copyResetTimerRef.current = window.setTimeout(() => setCopiedAppId(false), 1_600);
    }).catch(() => {
      // Clipboard is a convenience; a rejected write needs no surface.
    });
  };

  const menuItems: NimiMenuItem[] = [
    {
      id: 'details',
      label: t('Apps.action.details'),
      icon: <Info className="h-4 w-4" aria-hidden="true" />,
      onSelect: () => onAction('details'),
    },
    ...(actionPlan.primary ? [actionPlan.primary.id === 'stop'
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
      }] : []),
    ...(actionPlan.secondary.some((action) => action.id === 'cancel-job') ? [{
      id: 'cancel-job',
      label: t('Apps.action.cancel'),
      icon: <X className="h-4 w-4" aria-hidden="true" />,
      disabled: activeAction !== null,
      onSelect: () => onAction('cancel-job'),
    }] : []),
    {
      id: 'copy-app-id',
      label: copiedAppId ? t('Apps.detail.appIdCopied') : t('Apps.detail.copyAppId'),
      icon: copiedAppId
        ? <Check className="h-4 w-4" aria-hidden="true" />
        : <Copy className="h-4 w-4" aria-hidden="true" />,
      onSelect: copyAppId,
    },
    ...(actionPlan.secondary.some((action) => action.id === 'remove') ? [{
      id: 'remove',
      label: t('Apps.action.removeDevelopment'),
      icon: <Trash2 className="h-4 w-4" aria-hidden="true" />,
      tone: 'danger' as const,
      disabled: activeAction !== null,
      onSelect: () => setConfirmingRemove(true),
    }] : []),
  ];

  return (
    <AppCardSurface
      kind="promoted-glass"
      as="div"
      className="group relative flex flex-col p-4 transition-all duration-200 hover:-translate-y-0.5 hover:border-[var(--nimi-border-strong)] hover:shadow-[var(--nimi-elevation-raised)]"
      data-app-card
      data-testid={`apps-entry-${identity.entryKey}`}
      data-local-development-shell={localDevelopment?.shell}
      data-source-generation={localDevelopment?.sourceGeneration}
      data-declaration-generation={localDevelopment?.declarationGeneration}
    >
      <div className="flex min-w-0 items-start gap-3">
        <AppArtworkIcon
          appId={identity.appId}
          displayName={identity.displayName}
          iconUrl={entry.iconUrl}
          size="xl"
          className="shadow-[var(--nimi-elevation-base)]"
        />
        <div className="min-w-0 flex-1 self-center">
          <button
            type="button"
            data-testid={`apps-entry-${identity.entryKey}-name`}
            className="block w-full break-words text-left text-sm font-semibold leading-5 text-[color:var(--nimi-text-primary)] line-clamp-2 outline-none after:absolute after:inset-0 after:content-[''] focus-visible:text-[var(--nimi-action-primary-bg)]"
            onClick={() => onAction('details')}
          >
            {identity.displayName}
          </button>
          {source !== 'local_development' ? (
            <div className="mt-1 flex min-w-0 items-center">
              <AppSourceBadge source={source} variant="quiet" />
            </div>
          ) : null}
        </div>
        <div className="relative z-10 -mr-1.5 -mt-1.5 shrink-0">
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
      </div>

      {entry.summary ? (
        <p
          data-testid={`apps-entry-${identity.entryKey}-summary`}
          className="mt-2 line-clamp-2 break-words text-xs leading-4 text-[color:var(--nimi-text-muted)]"
        >
          {entry.summary}
        </p>
      ) : null}
      {localDevelopment === null ? (
        <div className="mt-2">
          <AppPackageStatusLine entry={entry} />
        </div>
      ) : null}
      {(visual !== 'stopped' || aiConfigSummary) ? (
        <div className="mt-2 flex min-w-0 flex-wrap items-center gap-1.5">
          {visual !== 'stopped' ? (
            <AppRunStatusBadge entry={entry} shape="dot" />
          ) : null}
          {aiConfigSummary ? (
            <StatusBadge
              tone={aiConfigSummary.tone}
              shape="dot"
              data-app-ai-config-summary={entry.aiConfigSummary?.routePosture}
              data-app-ai-config-health={entry.aiConfigSummary?.healthPosture}
            >
              {aiConfigSummary.label}
            </StatusBadge>
          ) : null}
        </div>
      ) : null}

      {canLaunch ? (
        <div className="relative z-10 mt-auto pt-4">
          {visual === 'starting' ? (
            <Button
              data-testid={`apps-entry-${identity.entryKey}-starting`}
              tone="secondary"
              size="sm"
              className="w-full"
              loading
              disabled
            >
              {t('Apps.runState.starting')}
            </Button>
          ) : visual === 'running' ? (
            <Button
              data-testid={`apps-entry-${identity.entryKey}-open`}
              tone="secondary"
              size="sm"
              className="w-full border-[var(--nimi-action-primary-bg)] text-[var(--nimi-action-primary-bg)] hover:border-[var(--nimi-action-primary-bg-hover)] hover:text-[var(--nimi-action-primary-bg-hover)]"
              loading={activeAction === 'launch'}
              disabled={activeAction !== null}
              onClick={(event) => {
                event.stopPropagation();
                onAction('launch');
              }}
            >
              <AppWindow className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
              {t('Apps.action.open')}
            </Button>
          ) : (
            <Button
              data-testid={`apps-entry-${identity.entryKey}-launch`}
              tone="secondary"
              size="sm"
              className="w-full"
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
      ) : null}

      <ConfirmDialog
        open={confirmingRemove}
        title={t('Apps.confirm.removeDevelopment.title')}
        message={t('Apps.confirm.removeDevelopment.message', { app: identity.displayName })}
        confirmLabel={t('Apps.confirm.removeDevelopment.confirm')}
        cancelLabel={t('Common.cancel')}
        confirmTone="danger"
        pending={activeAction === 'remove'}
        onConfirm={() => {
          setConfirmingRemove(false);
          onAction('remove');
        }}
        onClose={() => setConfirmingRemove(false)}
      />
    </AppCardSurface>
  );
}
