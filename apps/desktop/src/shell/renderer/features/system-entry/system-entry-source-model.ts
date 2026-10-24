import type { NimiAppActivityViewSnapshot } from '@nimiplatform/sdk/app';
import { AppPackageJobPhase, type AppPackageJob } from '@nimiplatform/sdk/runtime/wire-types';
import { isNimiRuntimeLocalEnvironmentDependencyJobActiveState, type NimiRuntimeLocalEnvironmentDependencyJob, type NimiRuntimeLocalTransferSessionSummary } from '@nimiplatform/sdk/runtime';
import type { SystemEntryItem, SystemEntryLocale, SystemEntrySection } from '../../../shared/system-entry-types.js';
import type { DesktopAppsPanelProjection } from '../apps/apps-panel-projection.js';
import { packageJobIsTerminal, packageJobKey } from '../apps/apps-downloads-observer.js';
import { activitySourceLabel, isOpenable, mergeActivitySnapshots } from '../home/home-app-activity-model.js';
import type { HomeRecentChatPartner } from '../home/home-recent-conversations-model.js';
import { isDownloadTerminal } from '../runtime-config/runtime-config-model-center-utils.js';

export const emptySystemEntrySection = (status: 'loading' | 'unavailable' = 'loading'): SystemEntrySection => ({ status, observedAt: null, total: null, items: [] });
export function systemEntryDisplayText(value: string | null | undefined, limit: number, fallback = ''): string {
  const clean = (value ?? '').replace(/[\u0000-\u001f]/gu, ' ').trim();
  return (clean || fallback).slice(0, limit);
}

export function projectSystemEntryAttention(input: {
  pending: NimiAppActivityViewSnapshot;
  recent: NimiAppActivityViewSnapshot;
  observedAt: string | null;
  downloadFailures: readonly SystemEntryItem[];
  downloadsComplete: boolean;
  locale: SystemEntryLocale;
}): SystemEntrySection {
  const readable = [input.pending, input.recent].filter((view) => view.status === 'ready');
  const records = mergeActivitySnapshots(...readable).filter((record) => record.userView.needsAttention || record.kind === 'todo' && record.todoState === 'open');
  const items: SystemEntryItem[] = records.map((record) => ({
    id: record.activityId,
    title: systemEntryDisplayText(record.title, 256, input.locale === 'zh' ? '需要处理' : 'Needs attention'),
    detail: systemEntryDisplayText(activitySourceLabel(record), 512, input.locale === 'zh' ? '来源暂时无法确认' : 'Source unavailable'),
    action: isOpenable(record) ? { kind: 'open-activity', activityId: record.activityId } : { kind: 'messages' },
  }));
  items.push(...input.downloadFailures);
  const complete = input.pending.status === 'ready' && input.recent.status === 'ready'
    && input.pending.complete && input.recent.complete && input.downloadsComplete;
  return { status: complete ? 'available' : items.length || readable.length ? 'partial'
    : input.pending.status === 'loading' || input.recent.status === 'loading' ? 'loading' : 'unavailable',
    observedAt: input.observedAt, total: complete ? items.length : null, items: items.slice(0, 20) };
}

export function projectSystemEntryRecent(input: { partners: readonly HomeRecentChatPartner[]; agentCount: number; status: 'loading' | 'ready' | 'unavailable'; observedAt: string | null; locale: SystemEntryLocale }): SystemEntrySection {
  if (input.status !== 'ready') return emptySystemEntrySection(input.status === 'loading' ? 'loading' : 'unavailable');
  const known = input.partners.filter((partner) => partner.updatedAtMs !== null);
  const complete = input.agentCount <= 24 && known.length === input.partners.length;
  return { status: complete ? 'available' : 'partial', observedAt: input.observedAt, total: complete ? known.length : null,
    items: known.slice(0, 20).map((partner) => ({ id: partner.localAgentRef,
      title: systemEntryDisplayText(partner.displayName, 256, input.locale === 'zh' ? '伙伴' : 'Partner'),
      detail: partner.hasUnread ? (input.locale === 'zh' ? '有新回复' : 'New reply') : (input.locale === 'zh' ? '继续对话' : 'Continue conversation'),
      action: { kind: 'continue-chat', localAgentRef: partner.localAgentRef } })) };
}

export function projectSystemEntryApps(input: { projection: DesktopAppsPanelProjection | undefined; readable: boolean; failed: boolean; loading: boolean; observedAt: string | null; locale: SystemEntryLocale }): SystemEntrySection {
  if (!input.readable || input.failed || input.projection?.status !== 'loaded') return emptySystemEntrySection(input.loading ? 'loading' : 'unavailable');
  const opened = input.projection.entries.filter((entry) => entry.run && ['running', 'starting', 'launching', 'stopping'].includes(entry.run.state));
  return { status: input.projection.runtimeError ? 'partial' : 'available', observedAt: input.observedAt,
    total: input.projection.runtimeError ? null : opened.length,
    items: opened.slice(0, 20).map((entry, index) => ({
      id: entry.identity.entryKey.length <= 512 ? entry.identity.entryKey : `opened-app:${index}`,
      title: systemEntryDisplayText(entry.identity.displayName, 256, entry.identity.appId),
      detail: entry.run?.state === 'running' ? (input.locale === 'zh' ? '已打开' : 'Open')
        : entry.run?.state === 'stopping' ? (input.locale === 'zh' ? '正在关闭' : 'Closing') : (input.locale === 'zh' ? '正在打开' : 'Opening'),
      action: entry.run?.state === 'running' && entry.identity.entryKey.length <= 512 && (entry.localDevelopment || entry.committedRelease)
        ? { kind: 'focus-app', entryKey: entry.identity.entryKey,
          source: entry.localDevelopment ? { kind: 'local-development', selector: entry.localDevelopment.selector }
            : { kind: 'installed', launchSelector: [...entry.committedRelease!.launchSelector] } } : { kind: 'apps' },
    })) };
}

export function projectSystemEntryDownloads(input: {
  transfers: readonly NimiRuntimeLocalTransferSessionSummary[];
  environments: readonly NimiRuntimeLocalEnvironmentDependencyJob[];
  appJobs: readonly AppPackageJob[];
  loading: boolean;
  unavailable: boolean;
  locale: SystemEntryLocale;
}): { section: SystemEntrySection; failures: readonly SystemEntryItem[]; complete: boolean } {
  const items: SystemEntryItem[] = [], failures: SystemEntryItem[] = [];
  const timestamps: number[] = [];
  const item = (id: string, label: string, state: 'active' | 'paused' | 'failed', percent?: number): SystemEntryItem => ({
    id: id.slice(0, 512), title: systemEntryDisplayText(label, 256, input.locale === 'zh' ? '下载' : 'Download'),
    detail: state === 'failed' ? (input.locale === 'zh' ? '下载失败' : 'Download failed')
      : state === 'paused' ? (input.locale === 'zh' ? '已暂停' : 'Paused')
        : `${input.locale === 'zh' ? '下载中' : 'Downloading'}${percent !== undefined && Number.isFinite(percent) ? ` · ${Math.max(0, Math.min(100, Math.floor(percent)))}%` : ''}`,
    action: { kind: 'downloads' },
  });
  for (const transfer of input.transfers) {
    timestamps.push(Date.parse(transfer.updatedAt));
    const state = transfer.state === 'failed' ? 'failed' : transfer.state === 'paused' ? 'paused' : 'active';
    const row = item(`transfer:${transfer.installSessionId}`, transfer.sourceLabel || transfer.modelAssetId, state,
      transfer.bytesTotal !== undefined && transfer.bytesTotal > 0 ? transfer.bytesReceived / transfer.bytesTotal * 100 : undefined);
    if (transfer.state === 'failed') failures.push(row);
    if (!isDownloadTerminal(transfer.state)) items.push(row);
  }
  for (const environment of input.environments) {
    timestamps.push(Date.parse(environment.updatedAt));
    const row = item(`environment:${environment.jobId}`, environment.dependencyId, environment.state === 'failed' ? 'failed' : 'active', environment.percent);
    if (environment.state === 'failed') failures.push(row);
    if (isNimiRuntimeLocalEnvironmentDependencyJobActiveState(environment.state)) items.push(row);
  }
  for (const job of input.appJobs) {
    if (job.updatedAt) timestamps.push(Number(job.updatedAt.seconds) * 1_000 + job.updatedAt.nanos / 1_000_000);
    const base = item(`app-download:${packageJobKey(job)}`, job.displayName || job.appId,
      job.phase === AppPackageJobPhase.FAILED ? 'failed' : job.phase === AppPackageJobPhase.PAUSED ? 'paused' : 'active');
    const row: SystemEntryItem = { ...base, detail: job.phase === AppPackageJobPhase.FAILED ? (input.locale === 'zh' ? 'App 任务失败' : 'App operation failed')
      : job.phase !== AppPackageJobPhase.PAUSED && job.phase !== AppPackageJobPhase.DOWNLOADING ? (input.locale === 'zh' ? 'App 任务处理中' : 'App operation in progress') : base.detail };
    if (job.phase === AppPackageJobPhase.FAILED) failures.push(row);
    if (!packageJobIsTerminal(job)) items.push(row);
  }
  const validTimes = timestamps.filter(Number.isFinite);
  const complete = !input.loading && !input.unavailable;
  return { complete, failures,
    section: { status: complete ? 'available' : input.loading ? 'loading' : items.length ? 'partial' : 'unavailable',
      observedAt: validTimes.length ? new Date(Math.max(...validTimes)).toISOString() : null,
      total: complete ? items.length : null, items: items.slice(0, 20) } };
}
