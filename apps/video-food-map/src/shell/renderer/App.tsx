import { type MouseEvent, type ReactNode, useEffect, useMemo, useState } from 'react';
import { QueryClient, QueryClientProvider, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ShellErrorBoundary } from '@nimiplatform/nimi-kit/telemetry/error-boundary';
import {
  Button,
  ScrollArea,
  SelectField,
  StatusBadge,
  Surface,
} from '@nimiplatform/nimi-kit/ui';
import {
  importCreator,
  importVideo,
  loadSnapshot,
  loadVideoFoodMapRuntimeOptions,
  loadVideoFoodMapSettings,
  openExternalUrl,
  retryImport,
  saveVideoFoodMapSettings,
  setVenueConfirmation,
  startVideoFoodMapWindowDrag,
  toggleVenueFavorite,
} from '@renderer/data/api.js';
import { filterImports, filterMapPoints, type ReviewFilter } from '@renderer/data/filter.js';
import {
  filterRankedMapPointsByRadius,
  formatAccuracyLabel,
  formatDistanceLabel,
  rankMapPointsByDistance,
} from '@renderer/data/nearby.js';
import type { DiningPreferenceCategoryId } from '@renderer/data/preferences.js';
import type {
  ImportRecord,
  MapPoint,
  VenueRecord,
  VideoFoodMapRouteSetting,
  VideoFoodMapRuntimeOptionsCatalog,
  VideoFoodMapSettings,
  VideoFoodMapSnapshot,
} from '@renderer/data/types.js';
import { DiningPreferencePanel } from '@renderer/components/dining-preference-panel.js';
import { MapSurface } from '@renderer/components/map-surface.js';
import { NEARBY_RADIUS_OPTIONS, formatLocationCapturedAt, type NearbyLocationState } from './app-shell-sections.js';
import {
  buildMapPointFromVenue,
  buildNextRouteSetting,
  createDefaultVideoFoodMapSettings,
  formatImportTime,
  isImportActive,
  listConnectorOptions,
  listModelOptions,
  listOptionsBySource,
  pickPreferredVenueId,
  resolveImportProgressText,
  resolveImportStatusLabel,
  resolveImportTone,
  type RuntimeSettingsCapability,
  type SurfaceId,
  venueShowsOnMap,
} from './app-helpers.js';
import { detectVideoFoodMapIntakeTarget, type VideoFoodMapIntakeTarget } from './intake.js';

const SURFACES: Array<{ id: SurfaceId; label: string; badge: string; description: string }> = [
  { id: 'discover', label: '发现', badge: '罗', description: '视频与店铺详情' },
  { id: 'nearby-map', label: '附近地图', badge: '位', description: '按当前位置找店' },
  { id: 'video-map', label: '单视频地图', badge: '图', description: '只看当前视频点位' },
  { id: 'review', label: '待确认', badge: '列', description: '逐条审核未上图店铺' },
  { id: 'menu', label: '偏好设置', badge: '设', description: '偏好与模型设置' },
];

type ReviewItem = {
  venue: VenueRecord;
  record: ImportRecord;
};

function InfoPill(props: {
  children: ReactNode;
  tone?: 'neutral' | 'warm' | 'danger' | 'info';
}) {
  const toneClass = props.tone === 'danger'
    ? 'border-[#fecaca] bg-[#fff1f2] text-[#dc2626]'
    : props.tone === 'warm'
      ? 'border-[#fed7aa] bg-[#fff7ed] text-[#c2410c]'
      : props.tone === 'info'
        ? 'border-[#bfdbfe] bg-[#eff6ff] text-[#2563eb]'
        : 'border-black/8 bg-white/80 text-[#4b5563]';

  return (
    <span className={`inline-flex max-w-full items-center overflow-hidden text-ellipsis rounded-full border px-3 py-1.5 text-sm font-medium leading-5 whitespace-nowrap ${toneClass}`}>
      {props.children}
    </span>
  );
}

function resolveVenueStatus(venue: VenueRecord) {
  if (venue.userConfirmed) {
    return { label: '已确认', tone: 'success' as const };
  }
  if (venue.reviewState === 'map_ready') {
    return { label: '已上图', tone: 'success' as const };
  }
  if (venue.reviewState === 'review' || venue.geocodeStatus === 'failed') {
    return { label: venue.geocodeStatus === 'failed' ? '定位失败' : '待确认', tone: 'warning' as const };
  }
  return { label: '仅列表展示', tone: 'info' as const };
}

function formatCommentTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatSelectedModelLabel(value: string): string {
  const normalized = String(value || '').trim();
  if (!normalized) {
    return '按当前默认值';
  }
  if (normalized.startsWith('local/')) {
    return normalized.slice('local/'.length);
  }
  if (normalized.startsWith('cloud/')) {
    return normalized.slice('cloud/'.length);
  }
  return normalized;
}

function formatConfidenceLabel(value: string): string {
  switch (String(value || '').trim()) {
    case 'high':
      return '高';
    case 'medium':
      return '中';
    case 'low':
      return '低';
    default:
      return '待确认';
  }
}

function buildIntakeStatusBadge(target: VideoFoodMapIntakeTarget) {
  if (target.kind === 'video') {
    return <StatusBadge tone="success">视频链接</StatusBadge>;
  }
  if (target.kind === 'creator') {
    return <StatusBadge tone="warning">博主主页</StatusBadge>;
  }
  return <StatusBadge tone="neutral">自动识别</StatusBadge>;
}

function handleWindowDragStart(event: MouseEvent<HTMLDivElement>) {
  if (event.button !== 0) {
    return;
  }
  void startVideoFoodMapWindowDrag().catch(() => {});
}

function RuntimeRouteSettingsPanel(props: {
  settings: VideoFoodMapSettings;
  runtimeOptions: { stt: VideoFoodMapRuntimeOptionsCatalog; text: VideoFoodMapRuntimeOptionsCatalog } | undefined;
  runtimeOptionsPending: boolean;
  saveSettingsPending: boolean;
  settingsPending: boolean;
  settingsErrorText: string | null;
  runtimeOptionsErrorText: string | null;
  saveSettingsErrorText: string | null;
  onUpdateCapabilitySetting: (capability: RuntimeSettingsCapability, nextSetting: VideoFoodMapRouteSetting) => void;
  onRefreshRuntimeOptions: () => void;
}) {
  const currentSettings = props.settings;
  const runtimeOptions = props.runtimeOptions;
  const sttCatalog = runtimeOptions?.stt;
  const textCatalog = runtimeOptions?.text;
  const sttSetting = currentSettings.stt;
  const textSetting = currentSettings.text;
  const runtimeSettingsBusy = props.settingsPending || props.runtimeOptionsPending || props.saveSettingsPending;

  const sttSourceOptions = [
    {
      value: 'cloud',
      label: `云端${listConnectorOptions(sttCatalog).length > 0 ? '' : '（暂无）'}`,
      disabled: listOptionsBySource(sttCatalog, 'cloud').length === 0,
    },
    {
      value: 'local',
      label: `本地${listOptionsBySource(sttCatalog, 'local').length > 0 ? '' : '（暂无）'}`,
      disabled: listOptionsBySource(sttCatalog, 'local').length === 0,
    },
  ];
  const textSourceOptions = [
    {
      value: 'cloud',
      label: `云端${listConnectorOptions(textCatalog).length > 0 ? '' : '（暂无）'}`,
      disabled: listOptionsBySource(textCatalog, 'cloud').length === 0,
    },
    {
      value: 'local',
      label: `本地${listOptionsBySource(textCatalog, 'local').length > 0 ? '' : '（暂无）'}`,
      disabled: listOptionsBySource(textCatalog, 'local').length === 0,
    },
  ];
  const sttConnectorOptions = listConnectorOptions(sttCatalog);
  const textConnectorOptions = listConnectorOptions(textCatalog);
  const sttModelOptions = listModelOptions(sttCatalog, sttSetting);
  const textModelOptions = listModelOptions(textCatalog, textSetting);

  return (
    <Surface tone="panel" elevation="base" className="space-y-6 rounded-[28px] p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xl font-semibold text-[var(--nimi-text-primary)]">模型设置</div>
          <p className="mt-2 text-sm leading-6 text-[var(--nimi-text-secondary)]">
            这里继续沿用现有能力，只是从顶部移到设置页。视频导入时会按这里的选择走。
          </p>
        </div>
        <Button tone="secondary" size="sm" onClick={props.onRefreshRuntimeOptions} disabled={props.runtimeOptionsPending}>
          {props.runtimeOptionsPending ? '刷新中...' : '刷新模型清单'}
        </Button>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Surface tone="card" elevation="base" className="w-full min-w-0 space-y-4 rounded-[24px] p-5 overflow-hidden">
          <div>
            <div className="text-sm font-semibold text-[var(--nimi-text-primary)]">语音转写</div>
            <div className="mt-1 text-sm text-[var(--nimi-text-secondary)]">决定视频音频先走哪一路。</div>
          </div>
          <div className="grid gap-3">
            <SelectField
              value={sttSetting.routeSource}
              disabled={runtimeSettingsBusy}
              options={sttSourceOptions}
              onValueChange={(value) => props.onUpdateCapabilitySetting('stt', buildNextRouteSetting({
                catalog: sttCatalog,
                current: sttSetting,
                nextSource: value as VideoFoodMapRouteSetting['routeSource'],
              }))}
            />
            <SelectField
              value={sttConnectorOptions.some((option) => option.value === sttSetting.connectorId) ? sttSetting.connectorId : undefined}
              disabled={runtimeSettingsBusy || sttSetting.routeSource !== 'cloud'}
              options={sttConnectorOptions}
              placeholder="先选云端连接"
              onValueChange={(value) => props.onUpdateCapabilitySetting('stt', buildNextRouteSetting({
                catalog: sttCatalog,
                current: sttSetting,
                nextSource: 'cloud',
                nextConnectorId: value,
              }))}
            />
            <SelectField
              value={sttModelOptions.some((option) => option.value === sttSetting.model) ? sttSetting.model : undefined}
              disabled={runtimeSettingsBusy || sttModelOptions.length === 0}
              options={sttModelOptions}
              placeholder={sttSetting.routeSource === 'local' ? '先选本地模型' : '先选转写模型'}
              onValueChange={(value) => props.onUpdateCapabilitySetting('stt', buildNextRouteSetting({
                catalog: sttCatalog,
                current: sttSetting,
                nextModel: value,
              }))}
            />
          </div>
        </Surface>

        <Surface tone="card" elevation="base" className="w-full min-w-0 space-y-4 rounded-[24px] p-5 overflow-hidden">
          <div>
            <div className="text-sm font-semibold text-[var(--nimi-text-primary)]">文字提取</div>
            <div className="mt-1 text-sm text-[var(--nimi-text-secondary)]">整理店名、地址和菜品时用哪一路。</div>
          </div>
          <div className="grid gap-3">
            <SelectField
              value={textSetting.routeSource}
              disabled={runtimeSettingsBusy}
              options={textSourceOptions}
              onValueChange={(value) => props.onUpdateCapabilitySetting('text', buildNextRouteSetting({
                catalog: textCatalog,
                current: textSetting,
                nextSource: value as VideoFoodMapRouteSetting['routeSource'],
              }))}
            />
            <SelectField
              value={textConnectorOptions.some((option) => option.value === textSetting.connectorId) ? textSetting.connectorId : undefined}
              disabled={runtimeSettingsBusy || textSetting.routeSource !== 'cloud'}
              options={textConnectorOptions}
              placeholder="先选云端连接"
              onValueChange={(value) => props.onUpdateCapabilitySetting('text', buildNextRouteSetting({
                catalog: textCatalog,
                current: textSetting,
                nextSource: 'cloud',
                nextConnectorId: value,
              }))}
            />
            <SelectField
              value={textModelOptions.some((option) => option.value === textSetting.model) ? textSetting.model : undefined}
              disabled={runtimeSettingsBusy || textModelOptions.length === 0}
              options={textModelOptions}
              placeholder={textSetting.routeSource === 'local' ? '先选本地模型' : '先选文字模型'}
              onValueChange={(value) => props.onUpdateCapabilitySetting('text', buildNextRouteSetting({
                catalog: textCatalog,
                current: textSetting,
                nextModel: value,
              }))}
            />
          </div>
        </Surface>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <Surface tone="card" elevation="base" className="w-full min-w-0 rounded-[22px] p-4 overflow-hidden">
          <div className="text-xs text-[var(--nimi-text-muted)]">当前语音模型</div>
          <div className="mt-2 text-sm font-medium text-[var(--nimi-text-primary)]">{formatSelectedModelLabel(sttSetting.model)}</div>
        </Surface>
        <Surface tone="card" elevation="base" className="w-full min-w-0 rounded-[22px] p-4 overflow-hidden">
          <div className="text-xs text-[var(--nimi-text-muted)]">当前文字模型</div>
          <div className="mt-2 text-sm font-medium text-[var(--nimi-text-primary)]">{formatSelectedModelLabel(textSetting.model)}</div>
        </Surface>
        <Surface tone="card" elevation="base" className="w-full min-w-0 rounded-[22px] p-4 overflow-hidden">
          <div className="text-xs text-[var(--nimi-text-muted)]">模型来源</div>
          <div className="mt-2 text-sm font-medium text-[var(--nimi-text-primary)]">
            {props.runtimeOptionsPending ? '读取中' : '直接来自当前 runtime'}
          </div>
        </Surface>
      </div>

      {props.settingsErrorText ? <div className="text-sm text-[var(--nimi-status-danger)]">{props.settingsErrorText}</div> : null}
      {props.runtimeOptionsErrorText ? <div className="text-sm text-[var(--nimi-status-danger)]">{props.runtimeOptionsErrorText}</div> : null}
      {props.saveSettingsErrorText ? <div className="text-sm text-[var(--nimi-status-danger)]">{props.saveSettingsErrorText}</div> : null}
    </Surface>
  );
}

function ContextSidebar(props: {
  snapshotPending: boolean;
  creatorSyncs: VideoFoodMapSnapshot['creatorSyncs'];
  favoriteVenues: Array<{ venue: VenueRecord; record: ImportRecord }>;
  filteredImports: ImportRecord[];
  selectedImport: ImportRecord | null;
  searchText: string;
  reviewFilter: ReviewFilter;
  onSearchTextChange: (next: string) => void;
  onReviewFilterChange: (next: ReviewFilter) => void;
  onSelectImport: (record: ImportRecord) => void;
  onSelectFavoriteVenue: (entry: { venue: VenueRecord; record: ImportRecord }) => void;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col border-r border-black/6 bg-white/94">
      <div className="border-b border-black/6 px-4 py-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-[15px] font-semibold text-[#111827]">视频清单</div>
          </div>
          <button
            type="button"
            className="inline-flex h-8 items-center justify-center rounded-lg border border-black/8 bg-white px-2.5 text-xs font-medium text-[#6b7280]"
          >
            筛选
          </button>
        </div>
        <div className="mt-4 space-y-3">
          <div className="relative">
            <input
              value={props.searchText}
              onChange={(event) => props.onSearchTextChange(event.target.value)}
              placeholder="搜索视频标题、博主..."
              className="w-full rounded-xl border border-transparent bg-[#f4f4f5] px-4 py-2.5 text-sm text-[#111827] outline-none transition focus:border-[#fb923c] focus:bg-white"
            />
          </div>
          <SelectField
            value={props.reviewFilter}
            onValueChange={(value) => props.onReviewFilterChange(value as ReviewFilter)}
            options={[
              { value: 'all', label: '全部状态' },
              { value: 'map_ready', label: '只看已上图' },
              { value: 'review', label: '只看待确认' },
              { value: 'search_only', label: '只看仅列表展示' },
              { value: 'failed_import', label: '只看解析失败' },
            ]}
          />
          <div className="flex items-center justify-between text-xs text-[#9ca3af]">
            <span>{props.filteredImports.length} 条结果</span>
            <span>按时间排序</span>
          </div>
        </div>
      </div>

      <ScrollArea className="flex-1" contentClassName="space-y-4 p-4">
        {props.snapshotPending ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, index) => (
              <Surface key={index} tone="card" elevation="base" className="h-28 animate-pulse rounded-[24px] bg-white/70" />
            ))}
          </div>
        ) : null}

        {!props.snapshotPending && props.filteredImports.length === 0 ? (
          <Surface tone="card" elevation="base" className="rounded-[24px] p-4 text-sm text-[var(--nimi-text-secondary)]">
            还没有可看的记录。先导入一条视频，或者换个筛选条件。
          </Surface>
        ) : null}

        {props.filteredImports.map((record) => (
          <button
            key={record.id}
            type="button"
            onClick={() => props.onSelectImport(record)}
            className={`w-full min-w-0 overflow-hidden rounded-[26px] border p-4 text-left transition ${
              record.id === props.selectedImport?.id
                ? 'border-[#fdba74] bg-[#fff7ed] shadow-[0_18px_35px_rgba(251,146,60,0.18)]'
                : 'border-black/6 bg-white/82 hover:border-[#fed7aa] hover:bg-white'
            }`}
            title={record.title || record.sourceUrl}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-xs font-medium uppercase tracking-[0.16em] text-[#9ca3af]">
                  {record.creatorName || '未知作者'}
                </div>
                <div className="vfm-clamp-2 vfm-break-anywhere mt-2 text-sm font-semibold leading-6 text-[#111827]">
                  {record.title || record.sourceUrl}
                </div>
              </div>
              <StatusBadge tone={resolveImportTone(record)}>{resolveImportStatusLabel(record)}</StatusBadge>
            </div>
            <div className="mt-3 flex min-w-0 flex-wrap gap-2 text-xs text-[#6b7280]">
              <span className="shrink-0">{formatImportTime(record.createdAt)}</span>
              <span className="shrink-0">{record.venues.length} 家候选</span>
              {record.tags.slice(0, 2).map((tag) => <span key={tag} className="truncate">#{tag}</span>)}
            </div>
          </button>
        ))}

        {!props.snapshotPending && props.favoriteVenues.length > 0 ? (
          <Surface tone="card" elevation="base" className="rounded-[24px] p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="text-sm font-semibold text-[var(--nimi-text-primary)]">我的收藏</div>
              <StatusBadge tone="warning">{props.favoriteVenues.length} 家</StatusBadge>
            </div>
            <div className="space-y-2">
              {props.favoriteVenues.slice(0, 4).map((entry) => (
                <button
                  key={entry.venue.id}
                  type="button"
                  className="w-full rounded-2xl border border-black/6 bg-white/72 px-3 py-3 text-left transition hover:border-[#fdba74]"
                  onClick={() => props.onSelectFavoriteVenue(entry)}
                >
                  <div className="text-sm font-medium text-[#111827]">{entry.venue.venueName || '未明确店名'}</div>
                  <div className="mt-1 text-xs text-[#6b7280]">{entry.record.creatorName || '未知作者'}</div>
                </button>
              ))}
            </div>
          </Surface>
        ) : null}

        {!props.snapshotPending && props.creatorSyncs.length > 0 ? (
          <Surface tone="card" elevation="base" className="rounded-[24px] p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="text-sm font-semibold text-[var(--nimi-text-primary)]">最近同步的博主</div>
              <StatusBadge tone="info">{props.creatorSyncs.length} 个</StatusBadge>
            </div>
            <div className="space-y-2">
              {props.creatorSyncs.slice(0, 3).map((record) => (
                <div key={record.creatorMid} className="rounded-2xl border border-black/6 bg-white/72 px-3 py-3">
                  <div className="text-sm font-medium text-[#111827]">{record.creatorName || record.creatorMid}</div>
                  <div className="mt-1 text-xs text-[#6b7280]">上次扫了 {record.lastScannedCount} 条，新增 {record.lastQueuedCount} 条</div>
                  <div className="mt-1 text-xs text-[#9ca3af]">{formatImportTime(record.lastSyncedAt)}</div>
                </div>
              ))}
            </div>
          </Surface>
        ) : null}
      </ScrollArea>
    </div>
  );
}

function DiscoverSurface(props: {
  selectedImport: ImportRecord | null;
  selectedVenue: VenueRecord | null;
  selectedDetailVenueId: string | null;
  visibleCommentClues: ImportRecord['commentClues'];
  videoMapPoints: MapPoint[];
  onSelectVenue: (venueId: string) => void;
  onOpenSource: () => void;
  onConfirmVenue: (venueId: string, confirmed: boolean) => void;
  onToggleFavorite: (venueId: string) => void;
  onSwitchToVideoMap: () => void;
  onRetryImport: (importId: string) => void;
  confirmationPending: boolean;
  favoritePending: boolean;
  retryPending: boolean;
}) {
  if (!props.selectedImport) {
    return (
      <Surface tone="panel" elevation="base" className="flex h-full min-h-[540px] items-center justify-center rounded-[32px] p-10 text-center">
        <div className="max-w-xl space-y-3">
          <div className="text-2xl font-semibold text-[var(--nimi-text-primary)]">先导入一条视频</div>
          <div className="text-sm leading-7 text-[var(--nimi-text-secondary)]">
            新界面已经准备好。等有第一条视频进来，这里会直接显示店铺结果、评论线索和地图入口。
          </div>
        </div>
      </Surface>
    );
  }

  if (props.selectedImport.status === 'failed') {
    return (
      <Surface tone="panel" elevation="base" className="space-y-5 rounded-[32px] p-6">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge tone="danger">导入失败</StatusBadge>
          <StatusBadge tone="info">{props.selectedImport.creatorName || '未知作者'}</StatusBadge>
        </div>
        <div>
          <div className="text-2xl font-semibold text-[var(--nimi-text-primary)]">{props.selectedImport.title || '未命名视频'}</div>
          <div className="mt-2 text-sm leading-6 text-[var(--nimi-text-secondary)]">
            {props.selectedImport.errorMessage || '这条视频这次没有跑通。'}
          </div>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button tone="primary" onClick={() => props.onRetryImport(props.selectedImport!.id)} disabled={props.retryPending}>
            {props.retryPending ? '正在重试...' : '重试这条视频'}
          </Button>
          <Button tone="secondary" onClick={props.onOpenSource}>查看原始视频</Button>
        </div>
      </Surface>
    );
  }

  const selectedVenueStatus = props.selectedVenue ? resolveVenueStatus(props.selectedVenue) : null;
  const venueCount = props.selectedImport.venues.length;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[var(--nimi-text-primary)]">提取结果</h1>
        </div>
        <button
          type="button"
          onClick={props.onOpenSource}
          className="inline-flex items-center gap-1 text-sm font-medium text-[#f97316] transition hover:text-[#ea580c]"
        >
          查看原始视频
          <span aria-hidden="true">›</span>
        </button>
      </div>

      <div className="grid grid-cols-12 gap-6">
        <Surface tone="panel" elevation="base" className="col-span-12 rounded-[32px] border border-black/6 p-8 lg:col-span-8">
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <div className="text-[36px] font-bold leading-none tracking-[-0.03em] text-[var(--nimi-text-primary)] max-md:text-[30px]">
                  {props.selectedVenue?.venueName || props.selectedImport.title || '未命名视频'}
                </div>
                {selectedVenueStatus ? <StatusBadge tone={selectedVenueStatus.tone}>{selectedVenueStatus.label}</StatusBadge> : null}
              </div>
              <div className="mt-3 text-sm text-[var(--nimi-text-secondary)]">
                {props.selectedVenue?.addressText || '还没有稳定地址线索'}
              </div>
              <div className="mt-5 max-w-[720px] text-sm leading-7 text-[var(--nimi-text-secondary)]">
                {props.selectedImport.videoSummary || props.selectedImport.description || '当前没有摘要，先保留原始结果。'}
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-3">
              <button
                type="button"
                className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-[#f4f4f5] text-xl text-[#6b7280] transition hover:bg-[#e5e7eb]"
                aria-label="更多操作"
              >
                …
              </button>
              {props.selectedVenue ? (
                <Button
                  tone={props.selectedVenue.userConfirmed ? 'secondary' : 'primary'}
                  onClick={() => props.onConfirmVenue(props.selectedVenue!.id, !props.selectedVenue!.userConfirmed)}
                  disabled={props.confirmationPending}
                >
                  {props.selectedVenue.userConfirmed ? '取消确认' : '确认收录'}
                </Button>
              ) : null}
              {props.selectedVenue ? (
                <Button
                  tone={props.selectedVenue.isFavorite ? 'primary' : 'secondary'}
                  onClick={() => props.onToggleFavorite(props.selectedVenue!.id)}
                  disabled={props.favoritePending}
                >
                  {props.selectedVenue.isFavorite ? '取消收藏' : '加入收藏'}
                </Button>
              ) : null}
            </div>
          </div>

          <div className="mt-8 grid gap-6 md:grid-cols-2">
            <Surface tone="card" elevation="base" className="rounded-[24px] border border-black/4 bg-[#fafafa] p-5">
              <div className="text-sm font-semibold text-[var(--nimi-text-primary)]">推荐菜品</div>
              <div className="mt-4 flex flex-wrap gap-2">
                {props.selectedVenue?.recommendedDishes.length
                  ? props.selectedVenue.recommendedDishes.map((dish) => <InfoPill key={dish}>{dish}</InfoPill>)
                  : <span className="text-sm text-[var(--nimi-text-secondary)]">还没有稳定的菜品线索</span>}
              </div>
            </Surface>
            <Surface tone="card" elevation="base" className="rounded-[24px] border border-black/4 bg-[#fafafa] p-5">
              <div className="text-sm font-semibold text-[var(--nimi-text-primary)]">风味标签</div>
              <div className="mt-4 flex flex-wrap gap-2">
                {props.selectedVenue && [...props.selectedVenue.flavorTags, ...props.selectedVenue.cuisineTags].length > 0
                  ? [...props.selectedVenue.flavorTags, ...props.selectedVenue.cuisineTags].map((tag) => <InfoPill key={tag} tone="warm">#{tag}</InfoPill>)
                  : <span className="text-sm text-[var(--nimi-text-secondary)]">还没有稳定的标签线索</span>}
              </div>
            </Surface>
          </div>
        </Surface>

        <Surface tone="panel" elevation="base" className="col-span-12 rounded-[32px] border border-black/6 p-6 lg:col-span-4">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div className="text-lg font-semibold text-[var(--nimi-text-primary)]">评论线索补全</div>
            <StatusBadge tone="info">{props.visibleCommentClues.length} 条</StatusBadge>
          </div>
          {props.visibleCommentClues.length === 0 ? (
            <div className="text-sm leading-7 text-[var(--nimi-text-secondary)]">
              {props.selectedImport.publicCommentCount > 0
                ? `这次拿到了 ${props.selectedImport.publicCommentCount} 条公开评论，但里面没有足够稳的店名或地址线索。`
                : '这次没有拿到可用的公开评论。'}
            </div>
          ) : (
            <div className="max-h-[360px] space-y-3 overflow-y-auto pr-1">
              {props.visibleCommentClues.map((clue) => (
                <div
                  key={clue.commentId}
                  className="rounded-[24px] border border-[#dbeafe] bg-[#f8fbff] p-4"
                >
                  <div className="text-sm leading-7 text-[var(--nimi-text-primary)]">{clue.message}</div>
                  <div className="mt-3 flex items-center justify-between gap-3 text-xs text-[var(--nimi-text-muted)]">
                    <span>{clue.authorName || '匿名评论'}</span>
                    {clue.addressHint ? <span className="text-[#2563eb]">带地址线索</span> : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Surface>
      </div>

      <div className="grid grid-cols-12 gap-6">
        <Surface tone="panel" elevation="base" className="col-span-12 rounded-[28px] border border-black/6 p-5 lg:col-span-4">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div className="text-lg font-semibold text-[var(--nimi-text-primary)]">这条视频提到的店</div>
            <StatusBadge tone="neutral">{venueCount} 家</StatusBadge>
          </div>
          <div className="space-y-3">
            {props.selectedImport.venues.map((venue) => {
              const status = resolveVenueStatus(venue);
              return (
                <button
                  key={venue.id}
                  type="button"
                  data-testid={`discover-venue-${venue.id}`}
                  onClick={() => props.onSelectVenue(venue.id)}
                  className={`w-full rounded-[22px] border p-4 text-left transition ${
                    props.selectedDetailVenueId === venue.id
                      ? 'border-[#fdba74] bg-[#fff7ed]'
                      : 'border-black/6 bg-white/88 hover:border-[#fed7aa]'
                  }`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="text-sm font-semibold text-[#111827]">{venue.venueName || '未明确店名'}</div>
                    <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
                  </div>
                  <div className="mt-2 text-sm text-[#6b7280]">{venue.addressText || '还没有可用地址线索'}</div>
                </button>
              );
            })}
          </div>
        </Surface>

        <Surface tone="panel" elevation="base" className="col-span-12 rounded-[28px] border border-black/6 p-5 lg:col-span-4">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div className="text-lg font-semibold text-[var(--nimi-text-primary)]">证据与转写</div>
            <div className="text-xs text-[var(--nimi-text-muted)]">语音模型：{formatSelectedModelLabel(props.selectedImport.selectedSttModel)}</div>
          </div>
          {props.selectedVenue?.evidence.length ? (
            <div className="space-y-2">
              {props.selectedVenue.evidence.map((evidence) => (
                <div key={evidence} className="rounded-2xl border border-black/6 bg-white/72 px-4 py-3 text-sm leading-6 text-[var(--nimi-text-secondary)]">
                  {evidence}
                </div>
              ))}
            </div>
          ) : null}
          <div className="mt-4 max-h-[280px] overflow-auto whitespace-pre-wrap rounded-[22px] border border-black/6 bg-white/72 p-4 text-sm leading-7 text-[var(--nimi-text-secondary)]">
            {props.selectedImport.transcript || '当前没有转写文本。'}
          </div>
        </Surface>

        <Surface tone="panel" elevation="base" className="col-span-12 rounded-[28px] border border-black/6 p-5 lg:col-span-4">
          <div className="text-lg font-semibold text-[var(--nimi-text-primary)]">视频信息</div>
          <div className="mt-4 space-y-4">
            <Surface tone="card" elevation="base" className="rounded-[22px] p-4">
              <div className="text-xs text-[var(--nimi-text-muted)]">视频摘要</div>
              <div className="mt-2 text-sm leading-7 text-[var(--nimi-text-secondary)]">
                {props.selectedImport.videoSummary || props.selectedImport.description || '当前没有摘要。'}
              </div>
            </Surface>
            <Surface tone="card" elevation="base" className="rounded-[22px] p-4">
              <div className="text-xs text-[var(--nimi-text-muted)]">原始链接</div>
              <div className="mt-2 break-all text-sm text-[var(--nimi-text-primary)]">{props.selectedImport.sourceUrl}</div>
            </Surface>
            <div className="grid gap-3 sm:grid-cols-2">
              <Surface tone="card" elevation="base" className="rounded-[22px] p-4">
                <div className="text-xs text-[var(--nimi-text-muted)]">公开评论</div>
                <div className="mt-2 text-lg font-semibold text-[var(--nimi-text-primary)]">{props.selectedImport.publicCommentCount}</div>
              </Surface>
              <Surface tone="card" elevation="base" className="rounded-[22px] p-4">
                <div className="text-xs text-[var(--nimi-text-muted)]">处理时间</div>
                <div className="mt-2 text-sm font-medium text-[var(--nimi-text-primary)]">{formatCommentTime(props.selectedImport.updatedAt)}</div>
              </Surface>
            </div>
            {props.selectedVenue ? (
              <Button
                tone="secondary"
                onClick={props.onSwitchToVideoMap}
                disabled={!props.videoMapPoints.some((point) => point.venueId === props.selectedVenue!.id)}
              >
                看单视频地图
              </Button>
            ) : null}
          </div>
        </Surface>
      </div>
    </div>
  );
}

function SharedMapSection(props: {
  mode: 'nearby-map' | 'video-map';
  points: MapPoint[];
  selectedPoint: MapPoint | null;
  selectedPointDistanceKm: number | null;
  selectedImport: ImportRecord | null;
  selectedVenue: VenueRecord | null;
  currentLocation: NearbyLocationState['location'];
  nearbyLocationState: NearbyLocationState;
  nearbyRadiusKm: number;
  discoveryCreatorCount: number;
  nearestDiscoveryDistance: number | null;
  onRequestCurrentLocation: () => void;
  onRadiusChange: (next: number) => void;
  onSelectVenue: (venueId: string) => void;
  onOpenSourceImport: () => void;
  onViewImportFromPoint: () => void;
}) {
  const isNearbyMode = props.mode === 'nearby-map';
  const title = isNearbyMode ? '附近可定位店铺' : '当前视频店铺分布';
  const subtitle = isNearbyMode
    ? '获取当前位置后，会按你选择的范围筛附近已经能落点的店。'
    : '这里只看当前视频里提到的店，方便判断这条视频到底推荐了几家。';

  return (
    <div className="grid h-full min-h-[640px] gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="relative min-h-[640px]">
        <MapSurface
          points={props.points}
          selectedVenueId={props.selectedPoint?.venueId || null}
          selectedPoint={props.selectedPoint}
          selectedPointDistanceKm={props.selectedPointDistanceKm}
          currentLocation={props.currentLocation}
          onSelectVenue={props.onSelectVenue}
        />

        <div className="pointer-events-none absolute inset-x-4 top-4 z-10 xl:left-4 xl:right-auto xl:w-[320px]">
          <div className="pointer-events-auto rounded-[28px] border border-black/8 bg-white/92 p-5 shadow-[0_22px_48px_rgba(15,23,42,0.14)] backdrop-blur">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-lg font-semibold text-[#111827]">{title}</div>
                <div className="mt-1 text-sm leading-6 text-[#6b7280]">{subtitle}</div>
              </div>
              <StatusBadge tone="neutral">{props.points.length} 个点</StatusBadge>
            </div>

            {isNearbyMode ? (
              <div className="mt-4 space-y-3">
                <div className="flex flex-wrap gap-2">
                  <Button
                    tone={props.currentLocation ? 'secondary' : 'primary'}
                    size="sm"
                    onClick={props.onRequestCurrentLocation}
                    disabled={props.nearbyLocationState.status === 'locating'}
                  >
                    {props.nearbyLocationState.status === 'locating'
                      ? '定位中...'
                      : props.currentLocation
                        ? '重新获取当前位置'
                        : '获取当前位置'}
                  </Button>
                  <SelectField
                    value={String(props.nearbyRadiusKm)}
                    disabled={!props.currentLocation || props.nearbyLocationState.status === 'locating'}
                    options={NEARBY_RADIUS_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
                    onValueChange={(value) => props.onRadiusChange(Number(value) || 10)}
                  />
                </div>
                <div className="rounded-2xl bg-[#f8fafc] px-4 py-3 text-sm leading-6 text-[#6b7280]">
                  {props.currentLocation
                    ? `已按当前位置筛附近店。${formatAccuracyLabel(props.currentLocation.accuracyMeters)} · ${formatLocationCapturedAt(props.currentLocation.capturedAt)} 更新`
                    : props.nearbyLocationState.message || '还没拿当前位置，所以这里先显示当前筛选下的全部上图店。'}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <Surface tone="panel" elevation="base" className="w-full min-w-0 rounded-[28px] p-5 overflow-hidden">
          <div className="grid gap-3 sm:grid-cols-2">
            <Surface tone="card" elevation="base" className="w-full min-w-0 rounded-[22px] p-4 overflow-hidden">
              <div className="text-xs text-[var(--nimi-text-muted)]">{isNearbyMode ? '当前点位' : '当前视频点位'}</div>
              <div className="mt-2 text-2xl font-semibold text-[var(--nimi-text-primary)]">{props.points.length}</div>
            </Surface>
            <Surface tone="card" elevation="base" className="w-full min-w-0 rounded-[22px] p-4 overflow-hidden">
              <div className="text-xs text-[var(--nimi-text-muted)]">{isNearbyMode ? '当前博主' : '待确认'}</div>
              <div className="mt-2 text-2xl font-semibold text-[var(--nimi-text-primary)]">
                {isNearbyMode
                  ? props.discoveryCreatorCount
                  : props.selectedImport?.venues.filter((venue) => !venue.userConfirmed && !venueShowsOnMap(venue)).length || 0}
              </div>
            </Surface>
          </div>
          {isNearbyMode && props.currentLocation && props.points.length === 0 ? (
            <div className="mt-4 rounded-[22px] bg-[#fff7ed] px-4 py-4 text-sm leading-7 text-[#7c2d12]">
              {props.nearestDiscoveryDistance != null
                ? `当前 ${props.nearbyRadiusKm} 公里内暂时没有，最近的一家离你大约 ${formatDistanceLabel(props.nearestDiscoveryDistance)}。`
                : '你附近还没有已上图的点位，后面导入更多视频后再回来看看。'}
            </div>
          ) : null}
        </Surface>

        {props.selectedPoint ? (
          <Surface tone="panel" elevation="base" className="w-full min-w-0 rounded-[28px] p-5 overflow-hidden">
            <div className="text-xs text-[var(--nimi-text-muted)]">当前选中</div>
            <div className="mt-2 text-xl font-semibold text-[var(--nimi-text-primary)]">{props.selectedPoint.venueName || '未明确店名'}</div>
            <div className="mt-2 text-sm leading-6 text-[var(--nimi-text-secondary)]">{props.selectedPoint.addressText || '无地址线索'}</div>
            {props.selectedPointDistanceKm != null ? (
              <div className="mt-2 text-xs text-[var(--nimi-text-muted)]">离你大约 {formatDistanceLabel(props.selectedPointDistanceKm)}</div>
            ) : null}
            <div className="mt-4 flex flex-wrap gap-2">
              {isNearbyMode ? (
                <Button tone="secondary" size="sm" onClick={props.onViewImportFromPoint}>
                  查看所属视频
                </Button>
              ) : null}
              {!isNearbyMode ? (
                <Button tone="secondary" size="sm" onClick={props.onOpenSourceImport}>
                  查看原始视频
                </Button>
              ) : null}
            </div>
          </Surface>
        ) : null}

        {!isNearbyMode && props.selectedVenue ? (
          <Surface tone="panel" elevation="base" className="w-full min-w-0 rounded-[28px] p-5 overflow-hidden">
            <div className="text-xs text-[var(--nimi-text-muted)]">当前店铺信息</div>
            <div className="mt-2 text-lg font-semibold text-[var(--nimi-text-primary)]">{props.selectedVenue.venueName || '未明确店名'}</div>
            <div className="mt-2 flex flex-wrap gap-2">
              {props.selectedVenue.recommendedDishes.map((dish) => <InfoPill key={dish} tone="danger">{dish}</InfoPill>)}
            </div>
          </Surface>
        ) : null}
      </div>
    </div>
  );
}

function ReviewSurface(props: {
  reviewItems: ReviewItem[];
  reviewIndex: number;
  selectedReviewItem: ReviewItem | null;
  confirmationPending: boolean;
  favoritePending: boolean;
  onSelectIndex: (next: number) => void;
  onNext: () => void;
  onConfirm: (venueId: string, confirmed: boolean) => void;
  onToggleFavorite: (venueId: string) => void;
  onOpenInDiscover: (recordId: string, venueId: string) => void;
}) {
  if (!props.selectedReviewItem) {
    return (
      <Surface tone="panel" elevation="base" className="flex h-full min-h-[540px] items-center justify-center rounded-[32px] p-10 text-center">
        <div className="max-w-xl space-y-3">
          <div className="text-2xl font-semibold text-[var(--nimi-text-primary)]">当前没有待确认项</div>
          <div className="text-sm leading-7 text-[var(--nimi-text-secondary)]">
            已确认或者已经能稳定上图的店都会从这里退出。你可以先回到发现页继续导入更多视频。
          </div>
        </div>
      </Surface>
    );
  }

  const { venue, record } = props.selectedReviewItem;
  const status = resolveVenueStatus(venue);
  const selectedReviewVenueId = props.selectedReviewItem.venue.id;
  const nextButtonLabel = props.reviewItems.length > 1 ? '跳过看下一条' : '留在当前';

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div>
        <Surface tone="panel" elevation="base" className="relative overflow-hidden rounded-[36px] p-8">
          <div className="absolute right-6 top-6 rounded-[18px] bg-[#fff7ed] px-4 py-3 text-sm font-semibold text-[#ea580c] shadow-sm">
            #{props.reviewIndex + 1}
          </div>
          <div className="max-w-3xl">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
              <StatusBadge tone="info">{record.creatorName || '未知作者'}</StatusBadge>
              {venue.isFavorite ? <StatusBadge tone="warning">已收藏</StatusBadge> : null}
            </div>
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[#9ca3af]">提取自：{record.title || record.sourceUrl}</div>
            <div className="mt-4 text-4xl font-semibold tracking-tight text-[var(--nimi-text-primary)]">{venue.venueName || '未明确店名'}</div>
            <div className="mt-3 text-base leading-7 text-[var(--nimi-text-secondary)]">{venue.addressText || '暂无地址线索'}</div>
          </div>

          <div className="mt-8 grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(280px,0.8fr)]">
            <Surface tone="card" elevation="base" className="w-full min-w-0 rounded-[28px] p-5 overflow-hidden">
              <div className="text-sm font-semibold text-[var(--nimi-text-primary)]">审核判断</div>
              <div className="mt-3 text-sm leading-7 text-[var(--nimi-text-secondary)]">
                置信度：{formatConfidenceLabel(venue.confidence)}。{venue.evidence[0] || '当前没有证据句，就按地址和评论线索人工判断。'}
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {venue.recommendedDishes.map((dish) => <InfoPill key={dish} tone="danger">{dish}</InfoPill>)}
                {venue.flavorTags.map((tag) => <InfoPill key={tag} tone="warm">{tag}</InfoPill>)}
              </div>
            </Surface>
            <Surface tone="card" elevation="base" className="w-full min-w-0 rounded-[28px] p-5 overflow-hidden">
              <div className="text-sm font-semibold text-[var(--nimi-text-primary)]">定位状态</div>
              <div className="mt-3 text-sm leading-7 text-[var(--nimi-text-secondary)]">
                {venue.geocodeStatus === 'resolved'
                  ? '已经拿到坐标，但还没确认是否收进地图。'
                  : venue.geocodeStatus === 'failed'
                    ? '这次定位没成功，需要你人工判断。'
                    : '这条记录还没有稳定坐标。'}
              </div>
              {venue.geocodeQuery ? (
                <div className="mt-3 rounded-2xl bg-white/80 px-4 py-3 text-xs text-[var(--nimi-text-muted)]">
                  定位查询词：{venue.geocodeQuery}
                </div>
              ) : null}
            </Surface>
          </div>

          <div className="mt-8 flex flex-wrap gap-3">
            <Button
              tone="primary"
              onClick={() => props.onConfirm(venue.id, true)}
              disabled={props.confirmationPending}
            >
              确认收录
            </Button>
            <Button
              tone={venue.isFavorite ? 'primary' : 'secondary'}
              onClick={() => props.onToggleFavorite(venue.id)}
              disabled={props.favoritePending}
            >
              {venue.isFavorite ? '取消收藏' : '加入收藏'}
            </Button>
            <Button tone="secondary" onClick={props.onNext} disabled={props.reviewItems.length <= 1}>
              {nextButtonLabel}
            </Button>
            <Button tone="secondary" onClick={() => props.onOpenInDiscover(record.id, venue.id)}>
              回到视频详情
            </Button>
          </div>
        </Surface>
      </div>

      <div className="space-y-4">
        <Surface tone="panel" elevation="base" className="rounded-[28px] p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-lg font-semibold text-[var(--nimi-text-primary)]">待确认队列</div>
              <div className="mt-1 text-sm text-[var(--nimi-text-secondary)]">宽窗口会在这里显示其余项，窄窗口就保留主卡片。</div>
            </div>
            <StatusBadge tone="warning">{props.reviewItems.length} 条</StatusBadge>
          </div>
        </Surface>

        <ScrollArea className="max-h-[620px]" contentClassName="space-y-3">
          {props.reviewItems.map((item, index) => (
            <button
              key={item.venue.id}
              type="button"
              data-testid={`review-queue-${item.venue.id}`}
              onClick={() => props.onSelectIndex(index)}
              className={`w-full rounded-[24px] border p-4 text-left transition ${
                item.venue.id === selectedReviewVenueId
                  ? 'border-[#fdba74] bg-[#fff7ed] shadow-[0_16px_30px_rgba(251,146,60,0.14)]'
                  : 'border-black/6 bg-white/88 hover:border-[#fed7aa]'
              }`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <div className="text-sm font-semibold text-[#111827]">{item.venue.venueName || '未明确店名'}</div>
                <StatusBadge tone={resolveVenueStatus(item.venue).tone}>{resolveVenueStatus(item.venue).label}</StatusBadge>
              </div>
              <div className="mt-2 text-sm text-[#6b7280]">{item.venue.addressText || '暂无地址线索'}</div>
            </button>
          ))}
        </ScrollArea>
      </div>
    </div>
  );
}

function SettingsSurface(props: {
  diningProfile: VideoFoodMapSettings['diningProfile'];
  saveSettingsPending: boolean;
  onToggleDiningPreference: (category: DiningPreferenceCategoryId, value: string) => void;
  currentSettings: VideoFoodMapSettings;
  runtimeOptions: { stt: VideoFoodMapRuntimeOptionsCatalog; text: VideoFoodMapRuntimeOptionsCatalog } | undefined;
  runtimeOptionsPending: boolean;
  settingsPending: boolean;
  settingsErrorText: string | null;
  runtimeOptionsErrorText: string | null;
  saveSettingsErrorText: string | null;
  onUpdateCapabilitySetting: (capability: RuntimeSettingsCapability, nextSetting: VideoFoodMapRouteSetting) => void;
  onRefreshRuntimeOptions: () => void;
}) {
  const totalSelections = props.diningProfile.cuisinePreferences.length
    + props.diningProfile.dietaryRestrictions.length
    + props.diningProfile.flavorPreferences.length
    + props.diningProfile.tabooIngredients.length;

  return (
    <div className="space-y-6">
      <Surface tone="panel" elevation="base" className="rounded-[32px] p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-2xl font-semibold text-[var(--nimi-text-primary)]">偏好与设置</div>
            <div className="mt-2 max-w-3xl text-sm leading-7 text-[var(--nimi-text-secondary)]">
              用餐偏好继续单独保存，后面的点菜建议会直接复用。模型设置也统一收进这里，不再挤占首页顶部。
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <StatusBadge tone={totalSelections > 0 ? 'success' : 'neutral'}>
              {totalSelections > 0 ? `已记住 ${totalSelections} 项` : '还没设置偏好'}
            </StatusBadge>
            <StatusBadge tone={props.saveSettingsPending ? 'warning' : 'info'}>
              {props.saveSettingsPending ? '保存中' : '本地保存'}
            </StatusBadge>
          </div>
        </div>
      </Surface>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
        <DiningPreferencePanel
          profile={props.diningProfile}
          disabled={props.saveSettingsPending}
          onToggle={props.onToggleDiningPreference}
        />

        <div className="space-y-6">
          <Surface tone="panel" elevation="base" className="rounded-[28px] p-6">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge tone="info">Stage 3</StatusBadge>
              <StatusBadge tone="neutral">预留入口</StatusBadge>
            </div>
            <div className="mt-4 text-2xl font-semibold text-[var(--nimi-text-primary)]">点菜建议会在后面接上</div>
            <div className="mt-3 text-sm leading-7 text-[var(--nimi-text-secondary)]">
              这一版先把偏好记好。后面接菜单拍照和点菜建议时，会优先避开你的忌口，再结合你喜欢的口味和常吃菜系给建议。
            </div>
          </Surface>

          <Surface tone="panel" elevation="base" className="rounded-[28px] p-6">
            <div className="text-sm font-semibold text-[var(--nimi-text-primary)]">当前生效模型</div>
            <div className="mt-4 grid gap-3">
              <Surface tone="card" elevation="base" className="rounded-[22px] p-4">
                <div className="text-xs text-[var(--nimi-text-muted)]">语音转写</div>
                <div className="mt-2 text-sm font-medium text-[var(--nimi-text-primary)]">{formatSelectedModelLabel(props.currentSettings.stt.model)}</div>
              </Surface>
              <Surface tone="card" elevation="base" className="rounded-[22px] p-4">
                <div className="text-xs text-[var(--nimi-text-muted)]">文字提取</div>
                <div className="mt-2 text-sm font-medium text-[var(--nimi-text-primary)]">{formatSelectedModelLabel(props.currentSettings.text.model)}</div>
              </Surface>
            </div>
          </Surface>
        </div>
      </div>

      <RuntimeRouteSettingsPanel
        settings={props.currentSettings}
        runtimeOptions={props.runtimeOptions}
        runtimeOptionsPending={props.runtimeOptionsPending}
        saveSettingsPending={props.saveSettingsPending}
        settingsPending={props.settingsPending}
        settingsErrorText={props.settingsErrorText}
        runtimeOptionsErrorText={props.runtimeOptionsErrorText}
        saveSettingsErrorText={props.saveSettingsErrorText}
        onUpdateCapabilitySetting={props.onUpdateCapabilitySetting}
        onRefreshRuntimeOptions={props.onRefreshRuntimeOptions}
      />
    </div>
  );
}

function AppBody() {
  const queryClient = useQueryClient();
  const snapshotQuery = useQuery({
    queryKey: ['video-food-map', 'snapshot'],
    queryFn: loadSnapshot,
    refetchInterval: (query) => {
      const data = query.state.data as VideoFoodMapSnapshot | undefined;
      return data?.imports.some((record) => isImportActive(record.status)) ? 1500 : false;
    },
  });
  const settingsQuery = useQuery({
    queryKey: ['video-food-map', 'settings'],
    queryFn: loadVideoFoodMapSettings,
  });
  const runtimeOptionsQuery = useQuery({
    queryKey: ['video-food-map', 'runtime-options'],
    queryFn: loadVideoFoodMapRuntimeOptions,
  });

  const [intakeInput, setIntakeInput] = useState('');
  const [surface, setSurface] = useState<SurfaceId>('discover');
  const [searchText, setSearchText] = useState('');
  const [reviewFilter, setReviewFilter] = useState<ReviewFilter>('all');
  const [selectedImportId, setSelectedImportId] = useState<string | null>(null);
  const [selectedDetailVenueId, setSelectedDetailVenueId] = useState<string | null>(null);
  const [selectedDiscoveryVenueId, setSelectedDiscoveryVenueId] = useState<string | null>(null);
  const [selectedVideoVenueId, setSelectedVideoVenueId] = useState<string | null>(null);
  const [nearbyRadiusKm, setNearbyRadiusKm] = useState(10);
  const [creatorSyncFeedbackText, setCreatorSyncFeedbackText] = useState<string | null>(null);
  const [intakeFeedbackText, setIntakeFeedbackText] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [reviewIndex, setReviewIndex] = useState(0);
  const [nearbyLocationState, setNearbyLocationState] = useState<NearbyLocationState>({
    status: 'idle',
    location: null,
    message: '',
  });

  const intakeTarget = useMemo(() => detectVideoFoodMapIntakeTarget(intakeInput), [intakeInput]);
  const currentSettings = settingsQuery.data || createDefaultVideoFoodMapSettings();
  const runtimeOptions = runtimeOptionsQuery.data;
  const diningProfile = currentSettings.diningProfile;

  const refreshSnapshot = async () => {
    await queryClient.invalidateQueries({ queryKey: ['video-food-map', 'snapshot'] });
  };

  const saveSettingsMutation = useMutation({
    mutationFn: async (settings: VideoFoodMapSettings) => saveVideoFoodMapSettings(settings),
    onSuccess: async (settings) => {
      queryClient.setQueryData(['video-food-map', 'settings'], settings);
    },
  });

  const importMutation = useMutation({
    mutationFn: async (url: string) => importVideo(url),
    onSuccess: async (record) => {
      setIntakeInput('');
      setIntakeFeedbackText(null);
      setCreatorSyncFeedbackText(null);
      setSelectedImportId(record.id);
      const preferredVenueId = pickPreferredVenueId(record);
      setSelectedDetailVenueId(preferredVenueId);
      setSelectedVideoVenueId(preferredVenueId);
      setSelectedDiscoveryVenueId(preferredVenueId);
      setSurface('discover');
    },
    onSettled: refreshSnapshot,
  });

  const creatorImportMutation = useMutation({
    mutationFn: async (url: string) => importCreator(url),
    onSuccess: async (result) => {
      setIntakeInput('');
      setIntakeFeedbackText(null);
      setCreatorSyncFeedbackText(
        `${result.creatorName || '这个博主'}这次扫了 ${result.scannedCount} 条视频，新增 ${result.queuedCount} 条，跳过已存在 ${result.skippedExistingCount} 条。`,
      );
      const firstQueuedItem = result.items.find((item) => item.importId && item.status === 'queued');
      if (firstQueuedItem?.importId) {
        setSelectedImportId(firstQueuedItem.importId);
      }
      setSurface('discover');
    },
    onSettled: refreshSnapshot,
  });

  const confirmationMutation = useMutation({
    mutationFn: async (payload: { venueId: string; confirmed: boolean }) =>
      setVenueConfirmation(payload.venueId, payload.confirmed),
    onSuccess: async (record, payload) => {
      setSelectedImportId(record.id);
      setSelectedDetailVenueId(payload.venueId);
      setSelectedVideoVenueId(payload.venueId);
      setSelectedDiscoveryVenueId(payload.venueId);
    },
    onSettled: refreshSnapshot,
  });

  const favoriteMutation = useMutation({
    mutationFn: async (venueId: string) => toggleVenueFavorite(venueId),
    onSuccess: async (record, venueId) => {
      setSelectedImportId(record.id);
      setSelectedDetailVenueId(venueId);
      setSelectedVideoVenueId(venueId);
      setSelectedDiscoveryVenueId(venueId);
    },
    onSettled: refreshSnapshot,
  });

  const retryImportMutation = useMutation({
    mutationFn: async (importId: string) => retryImport(importId),
    onSuccess: async (record) => {
      setSelectedImportId(record.id);
      const preferredVenueId = pickPreferredVenueId(record);
      setSelectedDetailVenueId(preferredVenueId);
      setSelectedVideoVenueId(preferredVenueId);
      setSelectedDiscoveryVenueId(preferredVenueId);
    },
    onSettled: refreshSnapshot,
  });

  const updateCapabilitySetting = (capability: RuntimeSettingsCapability, nextSetting: VideoFoodMapRouteSetting) => {
    const nextSettings: VideoFoodMapSettings = capability === 'stt'
      ? { ...currentSettings, stt: nextSetting }
      : { ...currentSettings, text: nextSetting };
    saveSettingsMutation.mutate(nextSettings);
  };

  const updateDiningPreference = (category: DiningPreferenceCategoryId, value: string) => {
    const currentValues = diningProfile[category];
    const nextValues = currentValues.includes(value)
      ? currentValues.filter((entry) => entry !== value)
      : [...currentValues, value];
    saveSettingsMutation.mutate({
      ...currentSettings,
      diningProfile: {
        ...diningProfile,
        [category]: nextValues,
      },
    });
  };

  const requestCurrentLocation = () => {
    if (!window.navigator.geolocation) {
      setNearbyLocationState({
        status: 'unsupported',
        location: null,
        message: '这台设备现在拿不到定位能力。',
      });
      return;
    }

    setNearbyLocationState({
      status: 'locating',
      location: null,
      message: '',
    });

    window.navigator.geolocation.getCurrentPosition(
      (position) => {
        setNearbyLocationState({
          status: 'ready',
          location: {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracyMeters: Number.isFinite(position.coords.accuracy) ? position.coords.accuracy : null,
            capturedAt: Date.now(),
          },
          message: '',
        });
      },
      (error) => {
        const message = error.code === error.PERMISSION_DENIED
          ? '定位权限现在是关着的。去系统设置里的定位服务把它重新打开后，再回来重试。'
          : error.code === error.POSITION_UNAVAILABLE
            ? '这次没拿到可用定位，附近地图先继续按普通地图显示。'
            : '定位超时了，你可以再试一次。';
        setNearbyLocationState({
          status: error.code === error.PERMISSION_DENIED ? 'denied' : 'failed',
          location: null,
          message,
        });
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0,
      },
    );
  };

  const submitUnifiedIntake = () => {
    const target = detectVideoFoodMapIntakeTarget(intakeInput);
    if (target.kind === 'invalid') {
      setIntakeFeedbackText(target.helperText);
      return;
    }

    setIntakeFeedbackText(null);
    if (target.kind === 'video') {
      importMutation.mutate(target.normalizedUrl);
      return;
    }
    creatorImportMutation.mutate(target.normalizedUrl);
  };

  const snapshot = snapshotQuery.data;
  const activeImport = snapshot?.imports.find((record) => isImportActive(record.status)) || null;

  const filteredImports = useMemo(
    () => filterImports(snapshot?.imports || [], searchText, reviewFilter),
    [reviewFilter, searchText, snapshot?.imports],
  );

  useEffect(() => {
    if (!selectedImportId && filteredImports.length > 0) {
      setSelectedImportId(filteredImports[0]!.id);
    }
  }, [filteredImports, selectedImportId]);

  useEffect(() => {
    if (!selectedImportId) {
      return;
    }
    const exists = filteredImports.some((record) => record.id === selectedImportId);
    if (!exists) {
      setSelectedImportId(filteredImports[0]?.id || null);
    }
  }, [filteredImports, selectedImportId]);

  const selectedImport = filteredImports.find((record) => record.id === selectedImportId) || filteredImports[0] || null;

  useEffect(() => {
    if (!selectedImport) {
      setSelectedDetailVenueId(null);
      setSelectedVideoVenueId(null);
      return;
    }
    const preferredVenueId = pickPreferredVenueId(selectedImport);
    if (!selectedDetailVenueId || !selectedImport.venues.some((venue) => venue.id === selectedDetailVenueId)) {
      setSelectedDetailVenueId(preferredVenueId);
    }
    if (!selectedVideoVenueId || !selectedImport.venues.some((venue) => venue.id === selectedVideoVenueId)) {
      setSelectedVideoVenueId(preferredVenueId);
    }
  }, [selectedDetailVenueId, selectedImport, selectedVideoVenueId]);

  const selectedVenue = selectedImport?.venues.find((venue) => venue.id === selectedDetailVenueId) || selectedImport?.venues[0] || null;
  const visibleCommentClues = useMemo(() => {
    if (!selectedImport) {
      return [];
    }
    if (!selectedVenue?.venueName) {
      return selectedImport.commentClues;
    }
    const matched = selectedImport.commentClues.filter((clue) =>
      clue.matchedVenueNames.some((name) => name === selectedVenue.venueName),
    );
    return matched.length > 0 ? matched : selectedImport.commentClues;
  }, [selectedImport, selectedVenue]);

  const allowedImportIds = new Set(filteredImports.map((record) => record.id));
  const discoveryMapPoints = filterMapPoints(snapshot?.mapPoints || [], allowedImportIds);
  const videoMapPoints = useMemo(() => {
    if (!selectedImport) {
      return [];
    }
    return selectedImport.venues
      .map((venue) => buildMapPointFromVenue(selectedImport, venue))
      .filter((point): point is MapPoint => point != null);
  }, [selectedImport]);
  const currentLocation = nearbyLocationState.status === 'ready' ? nearbyLocationState.location : null;
  const rankedDiscoveryMapPoints = useMemo(
    () => (currentLocation ? rankMapPointsByDistance(discoveryMapPoints, currentLocation) : []),
    [currentLocation, discoveryMapPoints],
  );
  const nearbyDiscoveryRankedPoints = useMemo(
    () => (currentLocation ? filterRankedMapPointsByRadius(rankedDiscoveryMapPoints, nearbyRadiusKm) : []),
    [currentLocation, nearbyRadiusKm, rankedDiscoveryMapPoints],
  );
  const visibleDiscoveryMapPoints = currentLocation
    ? nearbyDiscoveryRankedPoints.map(({ distanceKm: _distanceKm, ...point }) => point)
    : discoveryMapPoints;
  const discoveryCreatorCount = new Set(visibleDiscoveryMapPoints.map((point) => point.creatorName).filter(Boolean)).size;
  const rankedVideoMapPoints = useMemo(
    () => (currentLocation ? rankMapPointsByDistance(videoMapPoints, currentLocation) : []),
    [currentLocation, videoMapPoints],
  );

  useEffect(() => {
    if (visibleDiscoveryMapPoints.length === 0) {
      setSelectedDiscoveryVenueId(null);
      return;
    }
    if (!selectedDiscoveryVenueId || !visibleDiscoveryMapPoints.some((point) => point.venueId === selectedDiscoveryVenueId)) {
      setSelectedDiscoveryVenueId(visibleDiscoveryMapPoints[0]!.venueId);
    }
  }, [selectedDiscoveryVenueId, visibleDiscoveryMapPoints]);

  const selectedDiscoveryPoint =
    visibleDiscoveryMapPoints.find((point) => point.venueId === selectedDiscoveryVenueId)
    || visibleDiscoveryMapPoints[0]
    || null;
  const selectedVideoPoint =
    videoMapPoints.find((point) => point.venueId === selectedVideoVenueId)
    || videoMapPoints[0]
    || null;
  const selectedDiscoveryDistance = currentLocation
    ? rankedDiscoveryMapPoints.find((point) => point.venueId === selectedDiscoveryPoint?.venueId)?.distanceKm ?? null
    : null;
  const selectedVideoDistance = currentLocation
    ? rankedVideoMapPoints.find((point) => point.venueId === selectedVideoPoint?.venueId)?.distanceKm ?? null
    : null;
  const nearestDiscoveryDistance = currentLocation ? rankedDiscoveryMapPoints[0]?.distanceKm ?? null : null;
  const selectedDiscoveryImport =
    filteredImports.find((record) => record.id === selectedDiscoveryPoint?.importId) || null;

  const reviewItems = filteredImports.flatMap((record) =>
    record.venues
      .filter((venue) => !venue.userConfirmed && !venueShowsOnMap(venue))
      .map((venue) => ({ venue, record })),
  );

  useEffect(() => {
    if (reviewItems.length === 0) {
      setReviewIndex(0);
      return;
    }
    if (reviewIndex >= reviewItems.length) {
      setReviewIndex(0);
    }
  }, [reviewIndex, reviewItems.length]);

  const selectedReviewItem = reviewItems[reviewIndex] || null;

  const favoriteVenues = filteredImports.flatMap((record) =>
    record.venues
      .filter((venue) => venue.isFavorite)
      .map((venue) => ({ venue, record })),
  );

  const headerFeedbackText = intakeFeedbackText
    || (importMutation.isError ? (importMutation.error instanceof Error ? importMutation.error.message : '导入失败') : null)
    || (creatorImportMutation.isError ? (creatorImportMutation.error instanceof Error ? creatorImportMutation.error.message : '博主同步失败') : null)
    || creatorSyncFeedbackText
    || (activeImport ? `${resolveImportStatusLabel(activeImport)} · ${resolveImportProgressText(activeImport)}` : null)
    || (snapshotQuery.isError ? (snapshotQuery.error instanceof Error ? snapshotQuery.error.message : '加载失败') : null);

  const intakeBusy = importMutation.isPending || creatorImportMutation.isPending;
  const intakeActionLabel = intakeTarget.kind === 'creator' ? '同步最近视频' : '解析提取';

  return (
    <div className="vfm-window-frame flex h-full min-h-0 flex-col overflow-hidden">
      <div
        className="vfm-drag-strip flex h-11 shrink-0 items-center justify-center px-28 text-xs font-medium tracking-[0.2em] text-white/42"
        data-tauri-drag-region
        onMouseDown={handleWindowDragStart}
      >
        VIDEO FOOD MAP
      </div>
      <div className="vfm-app-shell flex min-h-0 flex-1 overflow-hidden">
      <nav className="vfm-rail flex w-20 flex-shrink-0 flex-col items-center gap-8 px-3 py-6">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#f97316] text-base font-bold text-white shadow-[0_16px_36px_rgba(249,115,22,0.28)]">
          图
        </div>
        <div className="flex w-full flex-col gap-4">
          {SURFACES.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-label={item.label}
              onClick={() => setSurface(item.id)}
              className={`relative flex aspect-square w-full flex-col items-center justify-center gap-1 rounded-xl text-center transition ${
                surface === item.id
                  ? 'bg-white/10 text-white'
                  : 'text-white/58 hover:bg-white/6 hover:text-white'
              }`}
            >
              <span className={`relative z-10 flex h-6 w-6 items-center justify-center rounded-lg text-sm font-semibold ${surface === item.id ? 'bg-white/10' : ''}`}>
                {item.badge}
              </span>
              <span className="relative z-10 text-[10px] font-medium leading-3">{item.label}</span>
            </button>
          ))}
        </div>
      </nav>

	      <div className="relative flex min-w-0 flex-1 overflow-hidden">
        <div className={`fixed inset-0 z-20 bg-black/28 transition xl:hidden ${sidebarOpen ? 'opacity-100' : 'pointer-events-none opacity-0'}`} onClick={() => setSidebarOpen(false)} />
        <aside
          className={`absolute inset-y-0 left-0 z-30 w-[min(340px,calc(100vw-112px))] max-w-full border-r border-black/6 transition-transform xl:static xl:z-0 xl:w-80 xl:translate-x-0 ${
            sidebarOpen ? 'translate-x-0' : '-translate-x-full'
          }`}
        >
          <ContextSidebar
            snapshotPending={snapshotQuery.isPending}
            creatorSyncs={snapshot?.creatorSyncs || []}
            favoriteVenues={favoriteVenues}
            filteredImports={filteredImports}
            selectedImport={selectedImport}
            searchText={searchText}
            reviewFilter={reviewFilter}
            onSearchTextChange={setSearchText}
            onReviewFilterChange={setReviewFilter}
            onSelectImport={(record) => {
              setSelectedImportId(record.id);
              const preferredVenueId = pickPreferredVenueId(record);
              setSelectedDetailVenueId(preferredVenueId);
              setSelectedVideoVenueId(preferredVenueId);
              setSidebarOpen(false);
            }}
            onSelectFavoriteVenue={(entry) => {
              setSelectedImportId(entry.record.id);
              setSelectedDetailVenueId(entry.venue.id);
              setSelectedVideoVenueId(entry.venue.id);
              setSurface('discover');
              setSidebarOpen(false);
            }}
          />
        </aside>

	        <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
	          <header className="shrink-0 border-b border-black/6 bg-white/70 px-4 py-4 backdrop-blur md:px-6 xl:px-8">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <button
                  type="button"
                  onClick={() => setSidebarOpen(true)}
                  className="inline-flex h-12 items-center justify-center rounded-2xl border border-black/8 bg-white px-4 text-sm font-medium text-[#111827] xl:hidden"
                >
                  打开清单
                </button>
                <div className="min-w-0 max-w-2xl flex-1">
                  <div className="relative">
                    <input
                      value={intakeInput}
                      onChange={(event) => setIntakeInput(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          submitUnifiedIntake();
                        }
                      }}
                      placeholder="粘贴 Bilibili 视频链接或博主主页..."
                      className="w-full rounded-2xl border border-black/8 bg-white px-5 py-3.5 pr-[150px] text-sm text-[#111827] shadow-sm outline-none transition focus:border-[#fb923c]"
                    />
                    <div className="absolute right-2 top-2">
                      <button
                        type="button"
                        onClick={submitUnifiedIntake}
                        disabled={!intakeInput.trim() || intakeBusy}
                        className="inline-flex min-h-[40px] items-center justify-center rounded-xl bg-[#171717] px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#f97316] disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {intakeBusy ? '处理中...' : `+ ${intakeActionLabel}`}
                      </button>
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-[#6b7280]">
                    <span>{headerFeedbackText || intakeTarget.helperText}</span>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-5 self-end xl:self-auto">
                <div className="text-right">
                  <div className="text-2xl font-bold leading-none text-[#111827]">{snapshot?.stats.mappedVenueCount || 0}</div>
                  <div className="mt-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#9ca3af]">已上图店铺</div>
                </div>
                <div className="h-8 w-px bg-black/8" />
                <div className="text-right">
                  <div className="text-2xl font-bold leading-none text-[#f97316]">{reviewItems.length}</div>
                  <div className="mt-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#9ca3af]">待确认</div>
                </div>
              </div>
            </div>

            <div className="mt-3 flex items-center gap-3 text-sm text-[#6b7280]">
              <span>{SURFACES.find((item) => item.id === surface)?.description}</span>
            </div>
          </header>

	          <div className="flex-1 overflow-auto overflow-x-hidden px-4 py-6 md:px-6 xl:px-8 xl:py-8">
            {surface === 'discover' ? (
              <DiscoverSurface
                selectedImport={selectedImport}
                selectedVenue={selectedVenue}
                selectedDetailVenueId={selectedDetailVenueId}
                visibleCommentClues={visibleCommentClues}
                videoMapPoints={videoMapPoints}
                onSelectVenue={(venueId) => {
                  setSelectedDetailVenueId(venueId);
                  setSelectedVideoVenueId(venueId);
                }}
                onOpenSource={() => {
                  if (!selectedImport?.sourceUrl) {
                    return;
                  }
                  void openExternalUrl(selectedImport.sourceUrl);
                }}
                onConfirmVenue={(venueId, confirmed) => confirmationMutation.mutate({ venueId, confirmed })}
                onToggleFavorite={(venueId) => favoriteMutation.mutate(venueId)}
                onSwitchToVideoMap={() => setSurface('video-map')}
                onRetryImport={(importId) => retryImportMutation.mutate(importId)}
                confirmationPending={confirmationMutation.isPending}
                favoritePending={favoriteMutation.isPending}
                retryPending={retryImportMutation.isPending}
              />
            ) : null}

            {surface === 'nearby-map' ? (
              <SharedMapSection
                mode="nearby-map"
                points={visibleDiscoveryMapPoints}
                selectedPoint={selectedDiscoveryPoint}
                selectedPointDistanceKm={selectedDiscoveryDistance}
                selectedImport={selectedDiscoveryImport}
                selectedVenue={selectedVenue}
                currentLocation={currentLocation}
                nearbyLocationState={nearbyLocationState}
                nearbyRadiusKm={nearbyRadiusKm}
                discoveryCreatorCount={discoveryCreatorCount}
                nearestDiscoveryDistance={nearestDiscoveryDistance}
                onRequestCurrentLocation={requestCurrentLocation}
                onRadiusChange={setNearbyRadiusKm}
                onSelectVenue={(venueId) => setSelectedDiscoveryVenueId(venueId)}
                onOpenSourceImport={() => {
                  if (!selectedImport?.sourceUrl) {
                    return;
                  }
                  void openExternalUrl(selectedImport.sourceUrl);
                }}
                onViewImportFromPoint={() => {
                  if (!selectedDiscoveryImport || !selectedDiscoveryPoint) {
                    return;
                  }
                  setSelectedImportId(selectedDiscoveryImport.id);
                  setSelectedDetailVenueId(selectedDiscoveryPoint.venueId);
                  setSelectedVideoVenueId(selectedDiscoveryPoint.venueId);
                  setSurface('discover');
                }}
              />
            ) : null}

            {surface === 'video-map' ? (
              <SharedMapSection
                mode="video-map"
                points={videoMapPoints}
                selectedPoint={selectedVideoPoint}
                selectedPointDistanceKm={selectedVideoDistance}
                selectedImport={selectedImport}
                selectedVenue={selectedVenue}
                currentLocation={currentLocation}
                nearbyLocationState={nearbyLocationState}
                nearbyRadiusKm={nearbyRadiusKm}
                discoveryCreatorCount={discoveryCreatorCount}
                nearestDiscoveryDistance={nearestDiscoveryDistance}
                onRequestCurrentLocation={requestCurrentLocation}
                onRadiusChange={setNearbyRadiusKm}
                onSelectVenue={(venueId) => {
                  setSelectedVideoVenueId(venueId);
                  setSelectedDetailVenueId(venueId);
                }}
                onOpenSourceImport={() => {
                  if (!selectedImport?.sourceUrl) {
                    return;
                  }
                  void openExternalUrl(selectedImport.sourceUrl);
                }}
                onViewImportFromPoint={() => {}}
              />
            ) : null}

            {surface === 'review' ? (
              <ReviewSurface
                reviewItems={reviewItems}
                reviewIndex={reviewIndex}
                selectedReviewItem={selectedReviewItem}
                confirmationPending={confirmationMutation.isPending}
                favoritePending={favoriteMutation.isPending}
                onSelectIndex={setReviewIndex}
                onNext={() => {
                  if (reviewItems.length <= 1) {
                    return;
                  }
                  setReviewIndex((current) => (current + 1) % reviewItems.length);
                }}
                onConfirm={(venueId, confirmed) => confirmationMutation.mutate({ venueId, confirmed })}
                onToggleFavorite={(venueId) => favoriteMutation.mutate(venueId)}
                onOpenInDiscover={(recordId, venueId) => {
                  setSelectedImportId(recordId);
                  setSelectedDetailVenueId(venueId);
                  setSelectedVideoVenueId(venueId);
                  setSurface('discover');
                }}
              />
            ) : null}

            {surface === 'menu' ? (
              <SettingsSurface
                diningProfile={diningProfile}
                saveSettingsPending={saveSettingsMutation.isPending}
                onToggleDiningPreference={updateDiningPreference}
                currentSettings={currentSettings}
                runtimeOptions={runtimeOptions}
                runtimeOptionsPending={runtimeOptionsQuery.isPending}
                settingsPending={settingsQuery.isPending}
                settingsErrorText={settingsQuery.isError ? (settingsQuery.error instanceof Error ? settingsQuery.error.message : '设置加载失败') : null}
                runtimeOptionsErrorText={runtimeOptionsQuery.isError ? (runtimeOptionsQuery.error instanceof Error ? runtimeOptionsQuery.error.message : '模型列表加载失败') : null}
                saveSettingsErrorText={saveSettingsMutation.isError ? (saveSettingsMutation.error instanceof Error ? saveSettingsMutation.error.message : '设置保存失败') : null}
                onUpdateCapabilitySetting={updateCapabilitySetting}
                onRefreshRuntimeOptions={() => void runtimeOptionsQuery.refetch()}
              />
            ) : null}
          </div>
	        </main>
	      </div>
      </div>
	    </div>
  );
}

export function App() {
  const [client] = useState(() => new QueryClient());

  return (
    <ShellErrorBoundary appName="Video Food Map">
      <QueryClientProvider client={client}>
        <AppBody />
      </QueryClientProvider>
    </ShellErrorBoundary>
  );
}
