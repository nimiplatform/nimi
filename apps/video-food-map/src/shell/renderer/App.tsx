import { useEffect, useMemo, useState } from 'react';
import { QueryClient, QueryClientProvider, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ShellErrorBoundary } from '@nimiplatform/nimi-kit/telemetry/error-boundary';
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
import { importVideo, loadSnapshot } from '@renderer/data/api.js';
import { filterImports, filterMapPoints, type ReviewFilter } from '@renderer/data/filter.js';
import type { ImportRecord, VideoFoodMapSnapshot } from '@renderer/data/types.js';
import { MapSurface } from '@renderer/components/map-surface.js';

const queryClient = new QueryClient();

type SurfaceId = 'discovery' | 'map' | 'review' | 'menu';

function formatImportTime(value: string): string {
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

function resolveImportTone(record: ImportRecord) {
  if (record.status === 'queued' || record.status === 'resolving' || record.status === 'geocoding' || record.status === 'running') {
    return 'warning' as const;
  }
  if (record.status === 'failed') return 'danger' as const;
  if (record.venues.some((venue) => venue.reviewState === 'review')) return 'warning' as const;
  if (record.venues.some((venue) => venue.reviewState === 'map_ready')) return 'success' as const;
  return 'info' as const;
}

function isImportActive(status: ImportRecord['status']) {
  return status === 'queued' || status === 'resolving' || status === 'geocoding' || status === 'running';
}

function resolveImportStatusLabel(record: ImportRecord) {
  switch (record.status) {
    case 'queued':
      return '排队中';
    case 'resolving':
    case 'running':
      return '解析中';
    case 'geocoding':
      return '定位中';
    case 'failed':
      return '失败';
    default:
      return record.venues.some((venue) => venue.reviewState === 'map_ready') ? '已上图' : '待确认';
  }
}

function resolveImportProgressText(record: ImportRecord | null) {
  if (!record) {
    return '';
  }
  switch (record.status) {
    case 'queued':
      return '已收到导入请求，正在排队开始处理。';
    case 'resolving':
    case 'running':
      return '正在拉取视频信息、字幕或音频，并做初步整理。长视频会更久一些。';
    case 'geocoding':
      return '文字结果已经出来了，正在谨慎处理地点信息。';
    case 'failed':
      return record.errorMessage || '这次导入失败了。';
    default:
      return '';
  }
}

function resolveReviewTone(reviewState: ReviewFilter) {
  switch (reviewState) {
    case 'map_ready':
      return 'success' as const;
    case 'review':
      return 'warning' as const;
    case 'search_only':
      return 'info' as const;
    case 'failed_import':
      return 'danger' as const;
    default:
      return 'neutral' as const;
  }
}

function SurfaceSwitcher(props: {
  current: SurfaceId;
  onChange: (next: SurfaceId) => void;
}) {
  const items: Array<{ id: SurfaceId; label: string }> = [
    { id: 'discovery', label: '发现结果' },
    { id: 'map', label: '地图' },
    { id: 'review', label: '待确认' },
    { id: 'menu', label: '点菜建议' },
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
  const [videoUrl, setVideoUrl] = useState('');
  const [surface, setSurface] = useState<SurfaceId>('discovery');
  const [searchText, setSearchText] = useState('');
  const [reviewFilter, setReviewFilter] = useState<ReviewFilter>('all');
  const [selectedImportId, setSelectedImportId] = useState<string | null>(null);
  const [selectedVenueId, setSelectedVenueId] = useState<string | null>(null);

  const importMutation = useMutation({
    mutationFn: async (url: string) => importVideo(url),
    onSuccess: async (record) => {
      setVideoUrl('');
      setSelectedImportId(record.id);
      setSelectedVenueId(record.venues.find((venue) => venue.reviewState === 'map_ready')?.id || record.venues[0]?.id || null);
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: ['video-food-map', 'snapshot'] });
    },
  });

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
  const selectedVenue = selectedImport?.venues.find((venue) => venue.id === selectedVenueId) || selectedImport?.venues[0] || null;
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
  const mapPoints = filterMapPoints(snapshot?.mapPoints || [], allowedImportIds);
  const reviewItems = filteredImports.flatMap((record) =>
    record.venues
      .filter((venue) => venue.reviewState !== 'map_ready')
      .map((venue) => ({
        venue,
        record,
      })),
  );

  return (
    <div className="flex h-full flex-col gap-4 p-4">
      <Surface tone="hero" elevation="raised" className="vfm-hero flex flex-col gap-4 p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-2">
            <p className="nimi-type-overline text-[var(--nimi-text-muted)]">Video Food Map</p>
            <h1 className="nimi-type-page-title text-[var(--nimi-text-primary)]">把视频探店结果变成可查、可看的本地地图</h1>
            <p className="max-w-3xl text-sm text-[var(--nimi-text-secondary)]">
              第一版专注一件事：输入一个 Bilibili 视频链接，跑完现有解析链路，把结果保存到本地，并按创作者、店名、菜、口味和状态展示出来。
            </p>
          </div>
          <Surface tone="card" elevation="base" className="grid min-w-[320px] grid-cols-2 gap-3 p-4 lg:grid-cols-3">
            <div>
              <div className="text-xs text-[var(--nimi-text-muted)]">导入总数</div>
              <div className="mt-1 text-2xl font-semibold text-[var(--nimi-text-primary)]">{snapshot?.stats.importCount || 0}</div>
            </div>
            <div>
              <div className="text-xs text-[var(--nimi-text-muted)]">可上图地点</div>
              <div className="mt-1 text-2xl font-semibold text-[var(--nimi-text-primary)]">{snapshot?.stats.mappedVenueCount || 0}</div>
            </div>
            <div>
              <div className="text-xs text-[var(--nimi-text-muted)]">待确认地点</div>
              <div className="mt-1 text-2xl font-semibold text-[var(--nimi-text-primary)]">{snapshot?.stats.reviewVenueCount || 0}</div>
            </div>
          </Surface>
        </div>
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto]">
          <div className="flex flex-col gap-3 lg:flex-row">
            <SearchField
              value={videoUrl}
              onChange={(event) => setVideoUrl(event.target.value)}
              placeholder="贴一个 Bilibili 视频链接，例如 https://www.bilibili.com/video/BV..."
              className="min-w-0 flex-1 bg-white/80"
            />
            <Button
              tone="primary"
              onClick={() => importMutation.mutate(videoUrl.trim())}
              disabled={!videoUrl.trim() || importMutation.isPending}
            >
              {importMutation.isPending ? '开始导入中...' : '导入并解析'}
            </Button>
          </div>
          <SurfaceSwitcher current={surface} onChange={setSurface} />
        </div>
        {activeImport ? (
          <div className="rounded-2xl bg-[color-mix(in_srgb,var(--nimi-status-warning)_8%,white)] px-4 py-3 text-sm text-[var(--nimi-text-secondary)]">
            <span className="font-medium text-[var(--nimi-text-primary)]">{resolveImportStatusLabel(activeImport)}</span>
            {' · '}
            {resolveImportProgressText(activeImport)}
          </div>
        ) : null}
        {importMutation.isError ? (
          <div className="text-sm text-[var(--nimi-status-danger)]">
            {importMutation.error instanceof Error ? importMutation.error.message : '导入失败'}
          </div>
        ) : null}
        {snapshotQuery.isError ? (
          <div className="text-sm text-[var(--nimi-status-danger)]">
            {snapshotQuery.error instanceof Error ? snapshotQuery.error.message : '加载失败'}
          </div>
        ) : null}
      </Surface>

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
        <SidebarShell className="min-h-0 overflow-hidden border-r border-[var(--nimi-sidebar-border)]">
          <SidebarHeader title={<h2 className="nimi-type-section-title text-[var(--nimi-text-primary)]">解析记录</h2>} />
          <div className="grid gap-3 px-3 pb-3">
            <SearchField
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
              placeholder="搜创作者、商圈、店名、菜、口味"
            />
            <SelectField
              value={reviewFilter}
              onValueChange={(value) => setReviewFilter(value as ReviewFilter)}
              options={[
                { value: 'all', label: '全部状态' },
                { value: 'map_ready', label: '只看已上图' },
                { value: 'review', label: '只看待确认' },
                { value: 'search_only', label: '只看仅列表可见' },
                { value: 'failed_import', label: '只看解析失败' },
              ]}
            />
          </div>
          <ScrollArea className="flex-1" contentClassName="space-y-2 px-3 pb-3">
            {snapshotQuery.isPending ? (
              <div className="space-y-2">
                {Array.from({ length: 5 }).map((_, index) => (
                  <Surface key={index} tone="card" elevation="base" className="h-24 animate-pulse bg-[color-mix(in_srgb,var(--nimi-surface-card)_88%,white)]" />
                ))}
              </div>
            ) : null}
            {!snapshotQuery.isPending && filteredImports.length === 0 ? (
              <Surface tone="card" elevation="base" className="p-4 text-sm text-[var(--nimi-text-secondary)]">
                还没有记录。先导入一条视频，或者换个筛选条件。
              </Surface>
            ) : null}
            {filteredImports.map((record) => (
              <SidebarItem
                key={record.id}
                kind="entity-row"
                active={record.id === selectedImport?.id}
                onClick={() => {
                  setSelectedImportId(record.id);
                  setSelectedVenueId(record.venues[0]?.id || null);
                }}
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

        <div className="min-h-0">
          {surface === 'discovery' ? (
            <ScrollArea className="h-full" contentClassName="space-y-4 pr-1">
              {selectedImport ? (
                <>
                  <Surface tone="panel" elevation="base" className="grid gap-4 p-5 xl:grid-cols-[minmax(0,1fr)_280px]">
                    <div className="space-y-4">
                      <div className="space-y-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <StatusBadge tone={resolveImportTone(selectedImport)}>
                            {selectedImport.status === 'failed'
                              ? '解析失败'
                              : isImportActive(selectedImport.status)
                                ? resolveImportStatusLabel(selectedImport)
                                : selectedImport.extractionCoverage?.state === 'leading_segments_only'
                                  ? '部分覆盖'
                                  : '完整覆盖'}
                          </StatusBadge>
                          <StatusBadge tone="info">{selectedImport.creatorName || '未知作者'}</StatusBadge>
                          {selectedImport.tags.slice(0, 3).map((tag) => <StatusBadge key={tag} tone="neutral">{tag}</StatusBadge>)}
                        </div>
                        <div>
                          <h2 className="text-2xl font-semibold text-[var(--nimi-text-primary)]">{selectedImport.title || '未命名视频'}</h2>
                          <p className="mt-2 text-sm leading-6 text-[var(--nimi-text-secondary)]">{selectedImport.videoSummary || selectedImport.description || '当前没有摘要，结果里保留了原始转写和提取文本。'}</p>
                        </div>
                      </div>
                      <div className="grid gap-4 md:grid-cols-2">
                        <Surface tone="card" elevation="base" className="p-4">
                          <div className="text-xs text-[var(--nimi-text-muted)]">原始链接</div>
                          <div className="mt-2 break-all text-sm text-[var(--nimi-text-primary)]">{selectedImport.sourceUrl}</div>
                        </Surface>
                        <Surface tone="card" elevation="base" className="p-4">
                          <div className="text-xs text-[var(--nimi-text-muted)]">解析模型</div>
                          <div className="mt-2 text-sm text-[var(--nimi-text-primary)]">{selectedImport.selectedSttModel || (isImportActive(selectedImport.status) ? '正在准备中' : '按脚本默认值')}</div>
                        </Surface>
                      </div>
                    </div>
                    <Surface tone="card" elevation="base" className="space-y-3 p-4">
                      <div className="text-sm font-medium text-[var(--nimi-text-primary)]">本次导入结果</div>
                      <div className="grid grid-cols-2 gap-3 text-sm">
                        <div>
                          <div className="text-xs text-[var(--nimi-text-muted)]">候选店铺</div>
                          <div className="mt-1 text-lg font-semibold text-[var(--nimi-text-primary)]">{selectedImport.venues.length}</div>
                        </div>
                        <div>
                          <div className="text-xs text-[var(--nimi-text-muted)]">可上图</div>
                          <div className="mt-1 text-lg font-semibold text-[var(--nimi-text-primary)]">{selectedImport.venues.filter((venue) => venue.reviewState === 'map_ready').length}</div>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-3 text-sm">
                        <div>
                          <div className="text-xs text-[var(--nimi-text-muted)]">公开评论</div>
                          <div className="mt-1 text-lg font-semibold text-[var(--nimi-text-primary)]">{selectedImport.publicCommentCount}</div>
                        </div>
                        <div>
                          <div className="text-xs text-[var(--nimi-text-muted)]">筛出评论</div>
                          <div className="mt-1 text-lg font-semibold text-[var(--nimi-text-primary)]">{selectedImport.commentClues.length}</div>
                        </div>
                      </div>
                      <div className="text-xs text-[var(--nimi-text-muted)]">处理时间</div>
                      <div className="text-sm text-[var(--nimi-text-primary)]">{formatImportTime(selectedImport.updatedAt)}</div>
                      {isImportActive(selectedImport.status) ? (
                        <div className="rounded-xl bg-[color-mix(in_srgb,var(--nimi-status-warning)_10%,transparent)] p-3 text-sm text-[var(--nimi-text-secondary)]">
                          {resolveImportProgressText(selectedImport)}
                        </div>
                      ) : null}
                      {selectedImport.errorMessage ? (
                        <div className="rounded-xl bg-[color-mix(in_srgb,var(--nimi-status-danger)_10%,transparent)] p-3 text-sm text-[var(--nimi-status-danger)]">
                          {selectedImport.errorMessage}
                        </div>
                      ) : null}
                    </Surface>
                  </Surface>

                  <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
                    <div className="space-y-4">
                      <Surface tone="panel" elevation="base" className="p-5">
                        <div className="mb-4 flex items-center justify-between gap-3">
                          <h3 className="text-lg font-semibold text-[var(--nimi-text-primary)]">店铺候选</h3>
                          <StatusBadge tone="neutral">{selectedImport.venues.length} 条</StatusBadge>
                        </div>
                        <div className="space-y-3">
                          {selectedImport.venues.map((venue) => (
                            <button
                              key={venue.id}
                              type="button"
                              onClick={() => {
                                setSelectedVenueId(venue.id);
                                if (venue.reviewState === 'map_ready') {
                                  setSurface('map');
                                }
                              }}
                              className={`vfm-card-shell w-full rounded-3xl border p-4 text-left transition ${
                                selectedVenue?.id === venue.id ? 'border-[var(--nimi-action-primary-bg)] shadow-[0_16px_40px_rgba(249,115,22,0.14)]' : 'border-[var(--nimi-border-subtle)]'
                              }`}
                            >
                              <div className="flex flex-wrap items-center gap-2">
                                <div className="text-base font-semibold text-[var(--nimi-text-primary)]">{venue.venueName || '未明确店名'}</div>
                                <StatusBadge tone={venue.reviewState === 'map_ready' ? 'success' : venue.reviewState === 'review' ? 'warning' : 'info'}>
                                  {venue.reviewState === 'map_ready' ? '已上图' : venue.reviewState === 'review' ? '待确认' : '仅列表展示'}
                                </StatusBadge>
                              </div>
                              <div className="mt-2 text-sm text-[var(--nimi-text-secondary)]">{venue.addressText || '还没有可用地址线索'}</div>
                              <div className="mt-3 flex flex-wrap gap-2">
                                {venue.recommendedDishes.map((dish) => <StatusBadge key={dish} tone="danger">{dish}</StatusBadge>)}
                                {venue.cuisineTags.map((tag) => <StatusBadge key={tag} tone="info">{tag}</StatusBadge>)}
                                {venue.flavorTags.map((tag) => <StatusBadge key={tag} tone="warning">{tag}</StatusBadge>)}
                              </div>
                            </button>
                          ))}
                        </div>
                      </Surface>

                      <Surface tone="panel" elevation="base" className="p-5">
                        <div className="mb-4 flex items-center justify-between gap-3">
                          <h3 className="text-lg font-semibold text-[var(--nimi-text-primary)]">筛出的评论线索</h3>
                          <StatusBadge tone="info">{visibleCommentClues.length} 条</StatusBadge>
                        </div>
                        {visibleCommentClues.length === 0 ? (
                          <div className="text-sm text-[var(--nimi-text-secondary)]">
                            {selectedImport.publicCommentCount > 0
                              ? `这次拿到了 ${selectedImport.publicCommentCount} 条公开评论，但里面没有足够稳的店名或地址线索，所以先不拿来补结果。`
                              : '这次没有拿到可用的公开评论。'}
                          </div>
                        ) : (
                          <div className="space-y-3">
                            {visibleCommentClues.map((clue) => (
                              <Surface key={clue.commentId} tone="card" elevation="base" className="space-y-3 p-4">
                                <div className="flex flex-wrap items-center gap-2">
                                  <StatusBadge tone="neutral">{clue.authorName || '匿名评论'}</StatusBadge>
                                  {clue.matchedVenueNames.map((name) => (
                                    <StatusBadge key={`${clue.commentId}-${name}`} tone="info">{name}</StatusBadge>
                                  ))}
                                  {clue.addressHint ? (
                                    <StatusBadge tone="warning">带地址线索</StatusBadge>
                                  ) : null}
                                </div>
                                <div className="text-sm leading-6 text-[var(--nimi-text-primary)]">{clue.message}</div>
                                <div className="flex flex-wrap gap-4 text-xs text-[var(--nimi-text-muted)]">
                                  <span>{formatCommentTime(clue.publishedAt) || '时间未知'}</span>
                                  <span>{`点赞 ${clue.likeCount}`}</span>
                                  {clue.addressHint ? <span>{`提到地址：${clue.addressHint}`}</span> : null}
                                </div>
                              </Surface>
                            ))}
                          </div>
                        )}
                      </Surface>

                      <Surface tone="panel" elevation="base" className="p-5">
                        <div className="mb-3 text-lg font-semibold text-[var(--nimi-text-primary)]">转写文本</div>
                        <div className="max-h-[360px] overflow-auto whitespace-pre-wrap text-sm leading-6 text-[var(--nimi-text-secondary)]">
                          {selectedImport.transcript || '当前没有转写文本。'}
                        </div>
                      </Surface>
                    </div>

                    <Surface tone="panel" elevation="base" className="space-y-4 p-5">
                      <div>
                        <div className="text-sm font-medium text-[var(--nimi-text-primary)]">当前选中</div>
                        {selectedVenue ? (
                          <>
                            <div className="mt-2 text-xl font-semibold text-[var(--nimi-text-primary)]">{selectedVenue.venueName || '未明确店名'}</div>
                            <div className="mt-2 text-sm text-[var(--nimi-text-secondary)]">{selectedVenue.addressText || '没有地址线索'}</div>
                          </>
                        ) : (
                          <div className="mt-2 text-sm text-[var(--nimi-text-secondary)]">这条记录里还没有店铺候选。</div>
                        )}
                      </div>
                      {selectedVenue ? (
                        <>
                          <div className="space-y-2">
                            <div className="text-xs text-[var(--nimi-text-muted)]">证据句</div>
                            <div className="space-y-2">
                              {selectedVenue.evidence.map((evidence) => (
                                <Surface key={evidence} tone="card" elevation="base" className="p-3 text-sm text-[var(--nimi-text-secondary)]">
                                  {evidence}
                                </Surface>
                              ))}
                            </div>
                          </div>
                          <div className="grid grid-cols-2 gap-3">
                            <Surface tone="card" elevation="base" className="p-3">
                              <div className="text-xs text-[var(--nimi-text-muted)]">坐标状态</div>
                              <div className="mt-2 text-sm text-[var(--nimi-text-primary)]">{selectedVenue.geocodeStatus === 'resolved' ? '已成功定位' : selectedVenue.geocodeStatus === 'failed' ? '定位失败' : '未尝试定位'}</div>
                            </Surface>
                            <Surface tone="card" elevation="base" className="p-3">
                              <div className="text-xs text-[var(--nimi-text-muted)]">置信度</div>
                              <div className="mt-2 text-sm text-[var(--nimi-text-primary)]">{selectedVenue.confidence || '未标记'}</div>
                            </Surface>
                          </div>
                          <Surface tone="card" elevation="base" className="p-3">
                            <div className="text-xs text-[var(--nimi-text-muted)]">相关评论</div>
                            <div className="mt-2 text-sm text-[var(--nimi-text-primary)]">
                              {selectedImport.commentClues.filter((clue) => clue.matchedVenueNames.includes(selectedVenue.venueName)).length} 条
                            </div>
                          </Surface>
                          {selectedVenue.geocodeQuery ? (
                            <div className="rounded-xl bg-[color-mix(in_srgb,var(--nimi-surface-card)_92%,white)] p-3 text-xs leading-5 text-[var(--nimi-text-muted)]">
                              定位查询词：{selectedVenue.geocodeQuery}
                            </div>
                          ) : null}
                        </>
                      ) : null}
                    </Surface>
                  </div>
                </>
              ) : (
                <Surface tone="panel" elevation="base" className="flex h-full items-center justify-center p-8 text-sm text-[var(--nimi-text-secondary)]">
                  先导入一条视频，这里会显示解析出来的店铺、转写和证据。
                </Surface>
              )}
            </ScrollArea>
          ) : null}

          {surface === 'map' ? (
            <div className="grid h-full gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
              <MapSurface
                points={mapPoints}
                selectedVenueId={selectedVenue?.reviewState === 'map_ready' ? selectedVenue.id : null}
                onSelectVenue={(venueId) => {
                  setSelectedVenueId(venueId);
                  const matchedImport = filteredImports.find((record) => record.venues.some((venue) => venue.id === venueId));
                  if (matchedImport) {
                    setSelectedImportId(matchedImport.id);
                  }
                }}
              />
              <Surface tone="panel" elevation="base" className="space-y-4 p-5">
                <div>
                  <div className="text-lg font-semibold text-[var(--nimi-text-primary)]">地图说明</div>
                  <p className="mt-2 text-sm leading-6 text-[var(--nimi-text-secondary)]">
                    只有地址成功转成坐标的地点才会上图。其余结果会继续保留在发现结果和待确认列表里，不会被假装成已确认地点。
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Surface tone="card" elevation="base" className="p-3">
                    <div className="text-xs text-[var(--nimi-text-muted)]">当前点位</div>
                    <div className="mt-2 text-lg font-semibold text-[var(--nimi-text-primary)]">{mapPoints.length}</div>
                  </Surface>
                  <Surface tone="card" elevation="base" className="p-3">
                    <div className="text-xs text-[var(--nimi-text-muted)]">当前筛选</div>
                    <div className="mt-2 text-sm text-[var(--nimi-text-primary)]">{reviewFilter === 'all' ? '全部' : reviewFilter}</div>
                  </Surface>
                </div>
                {selectedVenue ? (
                  <Surface tone="card" elevation="base" className="space-y-2 p-4">
                    <div className="text-xs text-[var(--nimi-text-muted)]">选中地点</div>
                    <div className="text-base font-semibold text-[var(--nimi-text-primary)]">{selectedVenue.venueName || '未明确店名'}</div>
                    <div className="text-sm text-[var(--nimi-text-secondary)]">{selectedVenue.addressText || '无地址线索'}</div>
                    <div className="flex flex-wrap gap-2">
                      {selectedVenue.recommendedDishes.map((dish) => <StatusBadge key={dish} tone="danger">{dish}</StatusBadge>)}
                    </div>
                  </Surface>
                ) : null}
              </Surface>
            </div>
          ) : null}

          {surface === 'review' ? (
            <ScrollArea className="h-full" contentClassName="space-y-3 pr-1">
              <Surface tone="panel" elevation="base" className="p-5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-xl font-semibold text-[var(--nimi-text-primary)]">待确认队列</h2>
                    <p className="mt-1 text-sm text-[var(--nimi-text-secondary)]">这里列出没有成功上图，或者证据仍不够稳的地点。</p>
                  </div>
                  <StatusBadge tone={resolveReviewTone('review')}>{reviewItems.length} 条</StatusBadge>
                </div>
              </Surface>
              {reviewItems.length === 0 ? (
                <Surface tone="panel" elevation="base" className="p-5 text-sm text-[var(--nimi-text-secondary)]">
                  当前没有待确认项。
                </Surface>
              ) : null}
              {reviewItems.map(({ venue, record }) => (
                <Surface key={venue.id} tone="panel" elevation="base" className="space-y-3 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="text-base font-semibold text-[var(--nimi-text-primary)]">{venue.venueName || '未明确店名'}</div>
                    <StatusBadge tone={venue.geocodeStatus === 'failed' ? 'danger' : 'warning'}>
                      {venue.geocodeStatus === 'failed' ? '定位失败' : '待确认'}
                    </StatusBadge>
                    <StatusBadge tone="info">{record.creatorName || '未知作者'}</StatusBadge>
                  </div>
                  <div className="text-sm text-[var(--nimi-text-secondary)]">{venue.addressText || '暂无地址线索'}</div>
                  <div className="flex flex-wrap gap-2">
                    {venue.recommendedDishes.map((dish) => <StatusBadge key={dish} tone="danger">{dish}</StatusBadge>)}
                    {venue.flavorTags.map((tag) => <StatusBadge key={tag} tone="warning">{tag}</StatusBadge>)}
                  </div>
                  <div className="grid gap-3 md:grid-cols-2">
                    {venue.evidence.map((evidence) => (
                      <Surface key={evidence} tone="card" elevation="base" className="p-3 text-sm text-[var(--nimi-text-secondary)]">
                        {evidence}
                      </Surface>
                    ))}
                  </div>
                </Surface>
              ))}
            </ScrollArea>
          ) : null}

          {surface === 'menu' ? (
            <Surface tone="panel" elevation="base" className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
              <StatusBadge tone="info">Stage 3</StatusBadge>
              <div className="text-2xl font-semibold text-[var(--nimi-text-primary)]">点菜建议会放在后续阶段</div>
              <p className="max-w-xl text-sm leading-6 text-[var(--nimi-text-secondary)]">
                这一版先把视频解析、本地记录、搜索和地图打通。等店铺信息更稳定后，再接菜单拍照和点菜建议。
              </p>
            </Surface>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function App() {
  return (
    <ShellErrorBoundary appName="Video Food Map">
      <QueryClientProvider client={queryClient}>
        <AppBody />
      </QueryClientProvider>
    </ShellErrorBoundary>
  );
}
