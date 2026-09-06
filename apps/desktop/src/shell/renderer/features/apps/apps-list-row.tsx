import { useEffect, useRef, useState, type MouseEvent, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Check,
  Copy,
  Info,
  LoaderCircle,
  MoreHorizontal,
  Play,
  Square,
  Trash2,
  X,
} from 'lucide-react';
import {
  ActionMenu,
  Button,
  ConfirmDialog,
  IconButton,
  Popover,
  PopoverContent,
  PopoverTrigger,
  type NimiMenuItem,
} from '@nimiplatform/kit/ui';
import {
  actionPlanForEntry,
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
import type { DesktopAppsEntry } from './apps-panel-projection.js';

// @nimi-authority: rule.nimi.platform.app-ecosystem.p-napp-001a

type AIConfigSummaryTone = 'neutral' | 'success' | 'info' | 'warning' | 'danger';

function aiConfigSummaryPresentation(
  entry: DesktopAppsEntry,
  t: ReturnType<typeof useTranslation>['t'],
): { readonly label: string; readonly tone: AIConfigSummaryTone } | null {
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
  // neutral copy on every row would drown out the postures that actually need
  // attention (configured, partial, blocked, unavailable above).
  return summary.routePosture === 'unconfigured' ? null : route;
}

const AI_CONFIG_TEXT_TONE: Readonly<Record<AIConfigSummaryTone, string>> = Object.freeze({
  neutral: 'text-[color:var(--nimi-text-muted)]',
  success: 'text-[var(--nimi-status-success)]',
  info: 'text-[var(--nimi-action-primary-bg)]',
  warning: 'text-[var(--nimi-status-warning)]',
  danger: 'text-[var(--nimi-status-danger)]',
});

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
  onAction,
}: {
  readonly entry: DesktopAppsEntry;
  readonly activeAction: AppCardActionId | null;
  readonly onAction: (action: AppCardActionId) => void;
}): ReactElement | null {
  const { t } = useTranslation();
  const { identity, localDevelopment } = entry;
  const visual = appRunVisualState(entry.run?.state ?? null);
  if (localDevelopment === null) return null;

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
        disabled={activeAction !== null}
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
        disabled={activeAction !== null}
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
      disabled={activeAction !== null}
      onClick={launch}
    >
      {t('Apps.action.launch')}
    </Button>
  );
}

function stopRowEvent(event: MouseEvent): void {
  event.stopPropagation();
}

export function AppListRow({
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
  const aiConfigSummary = aiConfigSummaryPresentation(entry, t);
  const actionPlan = actionPlanForEntry(entry);
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
          {source !== 'local_development' ? (
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
          {localDevelopment !== null ? <AppRunStatusText entry={entry} /> : null}
          {aiConfigSummary ? (
            <button
              type="button"
              data-testid={`apps-entry-${identity.entryKey}-ai-config-open`}
              title={t('Apps.aiConfig.openSettings')}
              aria-label={t('Apps.aiConfig.openSettings')}
              data-app-ai-config-summary={entry.aiConfigSummary?.routePosture}
              data-app-ai-config-health={entry.aiConfigSummary?.healthPosture}
              className={`relative z-10 inline-flex min-w-0 items-center rounded text-xs font-medium leading-4 outline-none hover:underline focus-visible:ring-[length:var(--nimi-focus-ring-width)] focus-visible:ring-[var(--nimi-focus-ring-color)] ${AI_CONFIG_TEXT_TONE[aiConfigSummary.tone]}`}
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
        <AppRowActionButton entry={entry} activeAction={activeAction} onAction={onAction} />
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
    </div>
  );
}
