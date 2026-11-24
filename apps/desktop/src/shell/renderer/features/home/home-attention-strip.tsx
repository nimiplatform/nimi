import { Button, ProgressIndicator } from '@nimiplatform/kit/ui';
import { DesktopAIExecutionRoute, type DesktopAIExecution } from '@nimiplatform/sdk/runtime/generated';
import { Activity, AlertTriangle, Bell, Download, Layers3, SlidersHorizontal } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { formatBytes, formatTransferRate } from '../../components/download-format.js';
import { displayRuntimeConfigCapabilityLabel } from '../runtime-config/runtime-config-capability-labels.js';
import type { HomeActiveDownloadItem } from './home-active-work-card.js';

export const HOME_MAX_ATTENTION_ITEMS = 3;
export const HOME_MAX_ACTIVE_WORK_ITEMS = 3;

export type HomeAttentionTone = 'warning' | 'danger' | 'info' | 'setup';

export type HomeAttentionItem = Readonly<{
  id: string;
  tone: HomeAttentionTone;
  message: string;
  actionLabel: string;
  onAction: () => void;
}>;

export type HomeAttentionStripProps = {
  attention: readonly HomeAttentionItem[];
  executions: readonly DesktopAIExecution[];
  downloads: readonly HomeActiveDownloadItem[];
  onOpenActivity: () => void;
  onOpenDownloads: () => void;
  onViewAllAttention?: () => void;
};

function AttentionIcon({ tone }: { tone: HomeAttentionTone }) {
  if (tone === 'danger' || tone === 'warning') {
    return <AlertTriangle size={14} aria-hidden="true" className="shrink-0" />;
  }
  if (tone === 'setup') {
    return <SlidersHorizontal size={14} aria-hidden="true" className="shrink-0" />;
  }
  return <Bell size={14} aria-hidden="true" className="shrink-0" />;
}

const ATTENTION_TONE_CLASS: Record<HomeAttentionTone, string> = {
  danger: 'bg-[var(--nimi-status-danger-soft-bg)] text-[var(--nimi-status-danger-soft-text)]',
  warning: 'bg-[var(--nimi-status-warning-soft-bg)] text-[var(--nimi-status-warning-soft-text)]',
  info: 'bg-[var(--nimi-status-info-soft-bg)] text-[var(--nimi-action-primary-bg)]',
  setup: 'bg-[var(--nimi-status-info-soft-bg)] text-[var(--nimi-action-primary-bg)]',
};

// @nimi-authority: rule.nimi.desktop.product-surfaces.r015
// @nimi-authority: rule.nimi.desktop.product-surfaces.home-system-activity
export function HomeAttentionStrip({
  attention,
  executions,
  downloads,
  onOpenActivity,
  onOpenDownloads,
  onViewAllAttention,
}: HomeAttentionStripProps) {
  const { t } = useTranslation();

  const visibleAttention = attention.slice(0, HOME_MAX_ATTENTION_ITEMS);
  const hiddenAttentionCount = Math.max(0, attention.length - visibleAttention.length);
  const visibleExecutions = executions.slice(0, HOME_MAX_ACTIVE_WORK_ITEMS);
  const remainingWorkSlots = Math.max(0, HOME_MAX_ACTIVE_WORK_ITEMS - visibleExecutions.length);
  const visibleDownloads = downloads.slice(0, remainingWorkSlots);

  if (visibleAttention.length === 0 && visibleExecutions.length === 0 && visibleDownloads.length === 0) {
    return null;
  }

  return (
    <section
      aria-label={t('runtimeConfig.overview.attention.sectionLabel')}
      data-testid="home-attention-strip"
      className="flex min-w-0 flex-col gap-2"
    >
      {visibleAttention.map((item) => (
        <div
          key={item.id}
          data-testid={`home-attention-item:${item.id}`}
          data-tone={item.tone}
          className={`flex min-w-0 items-center justify-between gap-3 rounded-2xl px-3.5 py-2 text-xs ${ATTENTION_TONE_CLASS[item.tone]}`}
        >
          <span className="flex min-w-0 items-center gap-2.5">
            <AttentionIcon tone={item.tone} />
            <span className="min-w-0 truncate font-medium text-[var(--nimi-text-primary)]">
              {item.message}
            </span>
          </span>
          <Button
            tone="ghost"
            size="sm"
            onClick={item.onAction}
            data-testid={`home-attention-action:${item.id}`}
            className="shrink-0"
          >
            {item.actionLabel} →
          </Button>
        </div>
      ))}
      {hiddenAttentionCount > 0 && onViewAllAttention ? (
        <div className="flex justify-end">
          <Button
            tone="ghost"
            size="sm"
            onClick={onViewAllAttention}
            data-testid="home-attention-view-all"
          >
            {t('runtimeConfig.overview.attention.viewAllPending', { count: attention.length })} →
          </Button>
        </div>
      ) : null}

      {visibleExecutions.map((execution) => {
        const model = execution.models[0];
        const routeLabel = execution.route === DesktopAIExecutionRoute.DESKTOP_AI_EXECUTION_ROUTE_LOCAL
          ? t('runtimeConfig.systemEntry.local')
          : execution.route === DesktopAIExecutionRoute.DESKTOP_AI_EXECUTION_ROUTE_CLOUD
            ? t('runtimeConfig.systemEntry.cloud')
            : t('runtimeConfig.systemEntry.routeUnknown');
        const detail = [
          displayRuntimeConfigCapabilityLabel(execution.capability, t),
          routeLabel,
          model?.displayName || model?.modelId,
        ].filter(Boolean).join(' · ');

        return (
          <div
            key={execution.attemptId}
            data-testid={`home-active-execution:${execution.attemptId}`}
            className="flex min-w-0 items-center justify-between gap-3 rounded-2xl bg-[var(--nimi-home-porcelain-card)] px-4 py-2.5 text-xs shadow-[var(--nimi-home-porcelain-shadow)]"
          >
            <div className="flex min-w-0 flex-1 items-center gap-2.5">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-xl bg-[var(--nimi-home-soft-well)] text-[var(--nimi-action-primary-bg)]">
                {execution.parentWorkId ? <Layers3 size={14} aria-hidden="true" /> : <Activity size={14} aria-hidden="true" />}
              </span>
              <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span className="truncate font-medium text-[var(--nimi-text-primary)]">
                  {execution.sourceLabel || t('runtimeConfig.overview.activeWork.aiRunning')}
                </span>
                {detail ? (
                  <span className="truncate text-[var(--nimi-text-secondary)]">{detail}</span>
                ) : null}
              </div>
            </div>
            <Button tone="ghost" size="sm" onClick={onOpenActivity} className="shrink-0">
              {t('runtimeConfig.overview.activeWork.viewActivity')} →
            </Button>
          </div>
        );
      })}

      {visibleDownloads.map((item) => {
        const meta = [
          item.bytesTotal
            ? `${formatBytes(item.bytesReceived)} / ${formatBytes(item.bytesTotal)}`
            : formatBytes(item.bytesReceived),
          formatTransferRate(item.speedBytesPerSec ?? undefined),
        ].filter(Boolean).join(' · ');

        return (
          <div
            key={item.id}
            data-testid={`home-active-download:${item.id}`}
            className="flex min-w-0 flex-col gap-1.5 rounded-2xl bg-[var(--nimi-home-porcelain-card)] px-4 py-2.5 text-xs shadow-[var(--nimi-home-porcelain-shadow)]"
          >
            <div className="flex min-w-0 items-center justify-between gap-3">
              <span className="flex min-w-0 flex-1 items-center gap-2">
                <Download size={14} aria-hidden="true" className="shrink-0 text-[var(--nimi-action-primary-bg)]" />
                <span className="truncate font-medium text-[var(--nimi-text-primary)]">{item.title}</span>
                {meta ? (
                  <span className="shrink-0 tabular-nums text-[var(--nimi-text-secondary)]">{meta}</span>
                ) : null}
              </span>
              <Button tone="ghost" size="sm" onClick={onOpenDownloads} className="shrink-0">
                {t('runtimeConfig.overview.activeWork.viewDownloads')} →
              </Button>
            </div>
            {item.bytesTotal ? (
              <ProgressIndicator value={item.bytesReceived} max={item.bytesTotal} aria-label={item.title} />
            ) : null}
          </div>
        );
      })}
    </section>
  );
}
