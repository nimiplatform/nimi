import {
  Button,
  ScrollArea,
  SearchField,
  SelectField,
  SidebarHeader,
  SidebarItem,
  SidebarShell,
  StatusBadge,
  Surface,
} from '@nimiplatform/nimi-kit/ui';
import type { ReviewFilter } from '@renderer/data/filter.js';
import type { UserLocation } from '@renderer/data/nearby.js';
import type { CreatorSyncRecord, ImportRecord, VenueRecord, VideoFoodMapSettings, VideoFoodMapSnapshot } from '@renderer/data/types.js';
import type {
  VideoFoodMapRouteSetting,
  VideoFoodMapRouteSource,
  VideoFoodMapRuntimeOptions,
} from '@renderer/data/types.js';
import {
  buildNextRouteSetting,
  createDefaultVideoFoodMapSettings,
  formatImportTime,
  listConnectorOptions,
  listModelOptions,
  listOptionsBySource,
  resolveImportProgressText,
  resolveImportStatusLabel,
  resolveImportTone,
  type RuntimeSettingsCapability,
  type SurfaceId,
} from './app-helpers.js';

export type NearbyLocationState =
  | { status: 'idle' | 'locating'; location: null; message: string }
  | { status: 'ready'; location: UserLocation; message: string }
  | { status: 'denied' | 'unsupported' | 'failed'; location: null; message: string };

export const NEARBY_RADIUS_OPTIONS = [
  { value: '3', label: '3 公里内' },
  { value: '5', label: '5 公里内' },
  { value: '10', label: '10 公里内' },
  { value: '20', label: '20 公里内' },
  { value: '50', label: '50 公里内' },
] as const;

export function formatLocationCapturedAt(value: number | null): string {
  if (!value) {
    return '';
  }
  return new Date(value).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function SurfaceSwitcher(props: {
  current: SurfaceId;
  onChange: (next: SurfaceId) => void;
}) {
  const items: Array<{ id: SurfaceId; label: string }> = [
    { id: 'discover', label: '我的空间' },
    { id: 'nearby-map', label: '我的地图' },
    { id: 'review', label: '待整理' },
    { id: 'menu', label: '口味档案' },
  ];
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((item) => (
        <Button
          key={item.id}
          tone={props.current === item.id ? 'primary' : 'secondary'}
          size="sm"
          onClick={() => props.onChange(item.id)}
        >
          {item.label}
        </Button>
      ))}
    </div>
  );
}

export function VideoFoodMapHeroSection(props: {
  snapshot: VideoFoodMapSnapshot | undefined;
  activeImport: ImportRecord | null;
  surface: SurfaceId;
  onSurfaceChange: (next: SurfaceId) => void;
  videoUrl: string;
  onVideoUrlChange: (next: string) => void;
  onImport: () => void;
  importPending: boolean;
  creatorUrl: string;
  onCreatorUrlChange: (next: string) => void;
  onImportCreator: () => void;
  creatorImportPending: boolean;
  settings: VideoFoodMapSettings | undefined;
  runtimeOptions: VideoFoodMapRuntimeOptions | undefined;
  runtimeOptionsPending: boolean;
  settingsPending: boolean;
  saveSettingsPending: boolean;
  onUpdateCapabilitySetting: (capability: RuntimeSettingsCapability, nextSetting: VideoFoodMapRouteSetting) => void;
  onRefreshRuntimeOptions: () => void;
  settingsErrorText: string | null;
  runtimeOptionsErrorText: string | null;
  saveSettingsErrorText: string | null;
  importErrorText: string | null;
  creatorImportErrorText: string | null;
  creatorSyncFeedbackText: string | null;
  snapshotErrorText: string | null;
}) {
  const currentSettings = props.settings || createDefaultVideoFoodMapSettings();
  const runtimeOptions = props.runtimeOptions;
  const sttCatalog = runtimeOptions?.stt;
  const textCatalog = runtimeOptions?.text;
  const sttSetting = currentSettings.stt;
  const textSetting = currentSettings.text;
  const sttSourceOptions = [
    { value: 'cloud', label: `云端${listConnectorOptions(sttCatalog).length > 0 ? '' : '（暂无可用项）'}`, disabled: listOptionsBySource(sttCatalog, 'cloud').length === 0 },
    { value: 'local', label: `本地${listOptionsBySource(sttCatalog, 'local').length > 0 ? '' : '（暂无可用项）'}`, disabled: listOptionsBySource(sttCatalog, 'local').length === 0 },
  ];
  const textSourceOptions = [
    { value: 'cloud', label: `云端${listConnectorOptions(textCatalog).length > 0 ? '' : '（暂无可用项）'}`, disabled: listOptionsBySource(textCatalog, 'cloud').length === 0 },
    { value: 'local', label: `本地${listOptionsBySource(textCatalog, 'local').length > 0 ? '' : '（暂无可用项）'}`, disabled: listOptionsBySource(textCatalog, 'local').length === 0 },
  ];
  const sttConnectorOptions = listConnectorOptions(sttCatalog);
  const textConnectorOptions = listConnectorOptions(textCatalog);
  const sttModelOptions = listModelOptions(sttCatalog, sttSetting);
  const textModelOptions = listModelOptions(textCatalog, textSetting);
  const sttConnectorValue = sttConnectorOptions.some((option) => option.value === sttSetting.connectorId) ? sttSetting.connectorId : '';
  const textConnectorValue = textConnectorOptions.some((option) => option.value === textSetting.connectorId) ? textSetting.connectorId : '';
  const sttModelValue = sttModelOptions.some((option) => option.value === sttSetting.model) ? sttSetting.model : '';
  const textModelValue = textModelOptions.some((option) => option.value === textSetting.model) ? textSetting.model : '';
  const runtimeSettingsBusy = props.settingsPending || props.runtimeOptionsPending || props.saveSettingsPending;

  return (
    <Surface tone="hero" elevation="raised" className="vfm-hero flex flex-col gap-4 p-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-2">
          <p className="nimi-type-overline text-[var(--nimi-text-muted)]">Video Food Map</p>
          <h1 className="nimi-type-page-title text-[var(--nimi-text-primary)]">把视频探店结果变成自己的找店地图</h1>
          <p className="max-w-3xl text-sm text-[var(--nimi-text-secondary)]">
            现在这版已经能把视频里的店铺拉出来、补评论线索、落到地图上。接下来你可以先确认靠谱的店，再把喜欢的地方收进自己的列表。
          </p>
        </div>
        <Surface tone="card" elevation="base" className="grid min-w-[360px] grid-cols-2 gap-3 p-4 lg:grid-cols-4">
          <div>
            <div className="text-xs text-[var(--nimi-text-muted)]">视频总数</div>
            <div className="mt-1 text-2xl font-semibold text-[var(--nimi-text-primary)]">{props.snapshot?.stats.importCount || 0}</div>
          </div>
          <div>
            <div className="text-xs text-[var(--nimi-text-muted)]">可上图地点</div>
            <div className="mt-1 text-2xl font-semibold text-[var(--nimi-text-primary)]">{props.snapshot?.stats.mappedVenueCount || 0}</div>
          </div>
          <div>
            <div className="text-xs text-[var(--nimi-text-muted)]">已确认地点</div>
            <div className="mt-1 text-2xl font-semibold text-[var(--nimi-text-primary)]">{props.snapshot?.stats.confirmedVenueCount || 0}</div>
          </div>
          <div>
            <div className="text-xs text-[var(--nimi-text-muted)]">已收藏地点</div>
            <div className="mt-1 text-2xl font-semibold text-[var(--nimi-text-primary)]">{props.snapshot?.stats.favoriteVenueCount || 0}</div>
          </div>
        </Surface>
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto]">
        <div className="grid gap-3">
          <div className="flex flex-col gap-3 lg:flex-row">
            <SearchField
              value={props.videoUrl}
              onChange={(event) => props.onVideoUrlChange(event.target.value)}
              placeholder="贴一个 Bilibili 视频链接，例如 https://www.bilibili.com/video/BV..."
              className="min-w-0 flex-1 bg-white/80"
            />
            <Button
              tone="primary"
              onClick={props.onImport}
              disabled={!props.videoUrl.trim() || props.importPending}
            >
              {props.importPending ? '开始导入中...' : '导入并解析'}
            </Button>
          </div>
          <div className="flex flex-col gap-3 lg:flex-row">
            <SearchField
              value={props.creatorUrl}
              onChange={(event) => props.onCreatorUrlChange(event.target.value)}
              placeholder="贴一个 Bilibili 博主主页链接，例如 https://space.bilibili.com/..."
              className="min-w-0 flex-1 bg-white/80"
            />
            <Button
              tone="secondary"
              onClick={props.onImportCreator}
              disabled={!props.creatorUrl.trim() || props.creatorImportPending}
            >
              {props.creatorImportPending ? '同步中...' : '同步博主最近视频'}
            </Button>
          </div>
        </div>
        <SurfaceSwitcher current={props.surface} onChange={props.onSurfaceChange} />
      </div>
      <Surface tone="card" elevation="base" className="grid gap-4 p-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
        <div className="space-y-3">
          <div>
            <div className="text-sm font-medium text-[var(--nimi-text-primary)]">语音转写</div>
            <div className="text-xs text-[var(--nimi-text-muted)]">决定视频音频先用哪一路做转写。</div>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <SelectField
              value={sttSetting.routeSource}
              disabled={runtimeSettingsBusy}
              options={sttSourceOptions}
              onValueChange={(value) => props.onUpdateCapabilitySetting('stt', buildNextRouteSetting({
                catalog: sttCatalog,
                current: sttSetting,
                nextSource: value as VideoFoodMapRouteSource,
              }))}
            />
            <SelectField
              value={sttConnectorValue || undefined}
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
              value={sttModelValue || undefined}
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
        </div>
        <div className="space-y-3">
          <div>
            <div className="text-sm font-medium text-[var(--nimi-text-primary)]">文字提取</div>
            <div className="text-xs text-[var(--nimi-text-muted)]">决定店名、地址和菜品整理时用哪一路。</div>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <SelectField
              value={textSetting.routeSource}
              disabled={runtimeSettingsBusy}
              options={textSourceOptions}
              onValueChange={(value) => props.onUpdateCapabilitySetting('text', buildNextRouteSetting({
                catalog: textCatalog,
                current: textSetting,
                nextSource: value as VideoFoodMapRouteSource,
              }))}
            />
            <SelectField
              value={textConnectorValue || undefined}
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
              value={textModelValue || undefined}
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
        </div>
        <div className="flex flex-col justify-between gap-3">
          <div className="text-xs text-[var(--nimi-text-muted)]">
            {props.saveSettingsPending
              ? '正在保存设置...'
              : props.runtimeOptionsPending
                ? '正在读取 runtime 里的可用模型...'
                : '这里列出的内容都来自当前 runtime。'}
          </div>
          <Button
            tone="secondary"
            onClick={props.onRefreshRuntimeOptions}
            disabled={props.runtimeOptionsPending}
          >
            {props.runtimeOptionsPending ? '刷新中...' : '刷新模型清单'}
          </Button>
        </div>
      </Surface>
      {props.settingsErrorText ? (
        <div className="text-sm text-[var(--nimi-status-danger)]">{props.settingsErrorText}</div>
      ) : null}
      {props.runtimeOptionsErrorText ? (
        <div className="text-sm text-[var(--nimi-status-danger)]">{props.runtimeOptionsErrorText}</div>
      ) : null}
      {props.saveSettingsErrorText ? (
        <div className="text-sm text-[var(--nimi-status-danger)]">{props.saveSettingsErrorText}</div>
      ) : null}
      {props.activeImport ? (
        <div className="rounded-2xl bg-[color-mix(in_srgb,var(--nimi-status-warning)_8%,white)] px-4 py-3 text-sm text-[var(--nimi-text-secondary)]">
          <span className="font-medium text-[var(--nimi-text-primary)]">{resolveImportStatusLabel(props.activeImport)}</span>
          {' · '}
          {resolveImportProgressText(props.activeImport)}
        </div>
      ) : null}
      {props.importErrorText ? (
        <div className="text-sm text-[var(--nimi-status-danger)]">{props.importErrorText}</div>
      ) : null}
      {props.creatorImportErrorText ? (
        <div className="text-sm text-[var(--nimi-status-danger)]">{props.creatorImportErrorText}</div>
      ) : null}
      {props.creatorSyncFeedbackText ? (
        <div className="text-sm text-[var(--nimi-text-secondary)]">{props.creatorSyncFeedbackText}</div>
      ) : null}
      {props.snapshotErrorText ? (
        <div className="text-sm text-[var(--nimi-status-danger)]">{props.snapshotErrorText}</div>
      ) : null}
    </Surface>
  );
}

export function VideoFoodMapSidebar(props: {
  snapshotPending: boolean;
  creatorSyncs: CreatorSyncRecord[];
  favoriteVenues: Array<{ venue: VenueRecord; record: ImportRecord }>;
  filteredImports: ImportRecord[];
  selectedImport: ImportRecord | null;
  searchText: string;
  onSearchTextChange: (next: string) => void;
  reviewFilter: ReviewFilter;
  onReviewFilterChange: (next: ReviewFilter) => void;
  onSelectImport: (record: ImportRecord) => void;
  onSelectFavoriteVenue: (venue: VenueRecord) => void;
}) {
  return (
    <SidebarShell className="min-h-0 overflow-hidden border-r border-[var(--nimi-sidebar-border)]">
      <SidebarHeader title={<h2 className="nimi-type-section-title text-[var(--nimi-text-primary)]">视频清单</h2>} />
      <div className="grid gap-3 px-3 pb-3">
        <SearchField
          value={props.searchText}
          onChange={(event) => props.onSearchTextChange(event.target.value)}
          placeholder="搜博主、店名、菜品、城市"
        />
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
      </div>
      <ScrollArea className="flex-1" contentClassName="space-y-2 px-3 pb-3">
        {!props.snapshotPending && props.creatorSyncs.length > 0 ? (
          <Surface tone="card" elevation="base" className="mb-3 space-y-3 p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-medium text-[var(--nimi-text-primary)]">最近同步的博主</div>
              <StatusBadge tone="info">{props.creatorSyncs.length} 个</StatusBadge>
            </div>
            <div className="space-y-2">
              {props.creatorSyncs.slice(0, 3).map((record) => (
                <div
                  key={`creator-sync-${record.creatorMid}`}
                  className="rounded-2xl border border-[var(--nimi-border-subtle)] px-3 py-2 text-sm"
                >
                  <div className="font-medium text-[var(--nimi-text-primary)]">{record.creatorName || record.creatorMid}</div>
                  <div className="mt-1 text-[var(--nimi-text-secondary)]">
                    上次扫了 {record.lastScannedCount} 条，新增 {record.lastQueuedCount} 条
                  </div>
                  <div className="mt-1 text-xs text-[var(--nimi-text-muted)]">
                    {formatImportTime(record.lastSyncedAt)}
                  </div>
                </div>
              ))}
            </div>
          </Surface>
        ) : null}
        {!props.snapshotPending && props.favoriteVenues.length > 0 ? (
          <Surface tone="card" elevation="base" className="mb-3 space-y-3 p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-medium text-[var(--nimi-text-primary)]">我的收藏</div>
              <StatusBadge tone="warning">{props.favoriteVenues.length} 家</StatusBadge>
            </div>
            <div className="space-y-2">
              {props.favoriteVenues.slice(0, 3).map(({ venue }) => (
                <button
                  key={`favorite-${venue.id}`}
                  type="button"
                  className="w-full rounded-2xl border border-[var(--nimi-border-subtle)] px-3 py-2 text-left text-sm text-[var(--nimi-text-primary)]"
                  onClick={() => props.onSelectFavoriteVenue(venue)}
                >
                  {venue.venueName || '未明确店名'}
                </button>
              ))}
            </div>
          </Surface>
        ) : null}
        {props.snapshotPending ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, index) => (
              <Surface key={index} tone="card" elevation="base" className="h-24 animate-pulse bg-[color-mix(in_srgb,var(--nimi-surface-card)_88%,white)]" />
            ))}
          </div>
        ) : null}
        {!props.snapshotPending && props.filteredImports.length === 0 ? (
          <Surface tone="card" elevation="base" className="p-4 text-sm text-[var(--nimi-text-secondary)]">
            还没有可看的记录。先导入一条视频，或者换个筛选条件。
          </Surface>
        ) : null}
        {props.filteredImports.map((record) => (
          <SidebarItem
            key={record.id}
            kind="entity-row"
            active={record.id === props.selectedImport?.id}
            onClick={() => props.onSelectImport(record)}
            label={
              <div className="flex items-center gap-2">
                <span className="truncate">{record.title || record.sourceUrl}</span>
                <StatusBadge tone={resolveImportTone(record)}>{resolveImportStatusLabel(record)}</StatusBadge>
              </div>
            }
            description={`${record.creatorName || '未知作者'} · ${record.venues.length} 家候选 · ${formatImportTime(record.createdAt)}`}
            className="mb-2 items-start py-3"
          />
        ))}
      </ScrollArea>
    </SidebarShell>
  );
}
