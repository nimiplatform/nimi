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
import {
  importVideo,
  loadSnapshot,
  setVenueConfirmation,
  toggleVenueFavorite,
} from '@renderer/data/api.js';
import { filterImports, filterMapPoints, type ReviewFilter } from '@renderer/data/filter.js';
import type { ImportRecord, MapPoint, VenueRecord, VideoFoodMapSnapshot } from '@renderer/data/types.js';
import { MapSurface } from '@renderer/components/map-surface.js';
import { VenueDetailPanel } from '@renderer/components/venue-detail-panel.js';

const queryClient = new QueryClient();

type SurfaceId = 'discover' | 'nearby-map' | 'video-map' | 'review' | 'menu';

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

function isImportActive(status: ImportRecord['status']) {
  return status === 'queued' || status === 'resolving' || status === 'geocoding' || status === 'running';
}

function venueShowsOnMap(venue: VenueRecord) {
  return (venue.reviewState === 'map_ready' || venue.userConfirmed) && venue.latitude != null && venue.longitude != null;
}

function resolveImportTone(record: ImportRecord) {
  if (record.status === 'queued' || record.status === 'resolving' || record.status === 'geocoding' || record.status === 'running') {
    return 'warning' as const;
  }
  if (record.status === 'failed') {
    return 'danger' as const;
  }
  if (record.venues.some((venue) => venue.userConfirmed || venueShowsOnMap(venue))) {
    return 'success' as const;
  }
  if (record.venues.some((venue) => venue.reviewState === 'review')) {
    return 'warning' as const;
  }
  return 'info' as const;
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
      if (record.venues.some((venue) => venue.userConfirmed)) {
        return '已确认';
      }
      return record.venues.some((venue) => venueShowsOnMap(venue)) ? '已上图' : '待确认';
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

function pickPreferredVenueId(record: ImportRecord | null): string | null {
  if (!record) {
    return null;
  }
  return (
    record.venues.find((venue) => venue.userConfirmed)?.id
    || record.venues.find((venue) => venueShowsOnMap(venue))?.id
    || record.venues[0]?.id
    || null
  );
}

function buildMapPointFromVenue(record: ImportRecord, venue: VenueRecord): MapPoint | null {
  if (venue.latitude == null || venue.longitude == null) {
    return null;
  }
  return {
    venueId: venue.id,
    importId: record.id,
    venueName: venue.venueName,
    creatorName: record.creatorName,
    title: record.title,
    addressText: venue.addressText,
    latitude: venue.latitude,
    longitude: venue.longitude,
    isFavorite: venue.isFavorite,
    userConfirmed: venue.userConfirmed,
  };
}

function SurfaceSwitcher(props: {
  current: SurfaceId;
  onChange: (next: SurfaceId) => void;
}) {
  const items: Array<{ id: SurfaceId; label: string }> = [
    { id: 'discover', label: '视频清单' },
    { id: 'nearby-map', label: '发现地图' },
    { id: 'video-map', label: '单视频地图' },
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
  const [surface, setSurface] = useState<SurfaceId>('discover');
  const [searchText, setSearchText] = useState('');
  const [reviewFilter, setReviewFilter] = useState<ReviewFilter>('all');
  const [selectedImportId, setSelectedImportId] = useState<string | null>(null);
  const [selectedDetailVenueId, setSelectedDetailVenueId] = useState<string | null>(null);
  const [selectedDiscoveryVenueId, setSelectedDiscoveryVenueId] = useState<string | null>(null);
  const [selectedVideoVenueId, setSelectedVideoVenueId] = useState<string | null>(null);

  const refreshSnapshot = async () => {
    await queryClient.invalidateQueries({ queryKey: ['video-food-map', 'snapshot'] });
  };

  const importMutation = useMutation({
    mutationFn: async (url: string) => importVideo(url),
    onSuccess: async (record) => {
      setVideoUrl('');
      setSelectedImportId(record.id);
      const preferredVenueId = pickPreferredVenueId(record);
      setSelectedDetailVenueId(preferredVenueId);
      setSelectedVideoVenueId(preferredVenueId);
      setSelectedDiscoveryVenueId(preferredVenueId);
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

  const allowedImportIds = new Set(filteredImports.map((record) => record.id));
  const discoveryMapPoints = filterMapPoints(snapshot?.mapPoints || [], allowedImportIds);
  const discoveryCreatorCount = new Set(discoveryMapPoints.map((point) => point.creatorName).filter(Boolean)).size;
  const videoMapPoints = useMemo(() => {
    if (!selectedImport) {
      return [];
    }
    return selectedImport.venues
      .map((venue) => buildMapPointFromVenue(selectedImport, venue))
      .filter((point): point is MapPoint => point != null);
  }, [selectedImport]);

  useEffect(() => {
    if (discoveryMapPoints.length === 0) {
      setSelectedDiscoveryVenueId(null);
      return;
    }
    if (!selectedDiscoveryVenueId || !discoveryMapPoints.some((point) => point.venueId === selectedDiscoveryVenueId)) {
      setSelectedDiscoveryVenueId(discoveryMapPoints[0]!.venueId);
    }
  }, [discoveryMapPoints, selectedDiscoveryVenueId]);

  const selectedDiscoveryPoint =
    discoveryMapPoints.find((point) => point.venueId === selectedDiscoveryVenueId)
    || discoveryMapPoints[0]
    || null;
  const selectedVideoPoint =
    videoMapPoints.find((point) => point.venueId === selectedVideoVenueId)
    || videoMapPoints[0]
    || null;
  const selectedDiscoveryImport =
    filteredImports.find((record) => record.id === selectedDiscoveryPoint?.importId) || null;

  const reviewItems = filteredImports.flatMap((record) =>
    record.venues
      .filter((venue) => !venue.userConfirmed && !venueShowsOnMap(venue))
      .map((venue) => ({ venue, record })),
  );

  const favoriteVenues = filteredImports.flatMap((record) =>
    record.venues
      .filter((venue) => venue.isFavorite)
      .map((venue) => ({ venue, record })),
  );

  return (
    <div className="flex h-full flex-col gap-4 p-4">
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
              <div className="mt-1 text-2xl font-semibold text-[var(--nimi-text-primary)]">{snapshot?.stats.importCount || 0}</div>
            </div>
            <div>
              <div className="text-xs text-[var(--nimi-text-muted)]">可上图地点</div>
              <div className="mt-1 text-2xl font-semibold text-[var(--nimi-text-primary)]">{snapshot?.stats.mappedVenueCount || 0}</div>
            </div>
            <div>
              <div className="text-xs text-[var(--nimi-text-muted)]">已确认地点</div>
              <div className="mt-1 text-2xl font-semibold text-[var(--nimi-text-primary)]">{snapshot?.stats.confirmedVenueCount || 0}</div>
            </div>
            <div>
              <div className="text-xs text-[var(--nimi-text-muted)]">已收藏地点</div>
              <div className="mt-1 text-2xl font-semibold text-[var(--nimi-text-primary)]">{snapshot?.stats.favoriteVenueCount || 0}</div>
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
          <SidebarHeader title={<h2 className="nimi-type-section-title text-[var(--nimi-text-primary)]">视频清单</h2>} />
          <div className="grid gap-3 px-3 pb-3">
            <SearchField
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
              placeholder="搜博主、店名、菜品、城市"
            />
            <SelectField
              value={reviewFilter}
              onValueChange={(value) => setReviewFilter(value as ReviewFilter)}
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
            {!snapshotQuery.isPending && favoriteVenues.length > 0 ? (
              <Surface tone="card" elevation="base" className="mb-3 space-y-3 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-medium text-[var(--nimi-text-primary)]">我的收藏</div>
                  <StatusBadge tone="warning">{favoriteVenues.length} 家</StatusBadge>
                </div>
                <div className="space-y-2">
                  {favoriteVenues.slice(0, 3).map(({ venue }) => (
                    <button
                      key={`favorite-${venue.id}`}
                      type="button"
                      className="w-full rounded-2xl border border-[var(--nimi-border-subtle)] px-3 py-2 text-left text-sm text-[var(--nimi-text-primary)]"
                      onClick={() => {
                        setSelectedImportId(venue.importId);
                        setSelectedDetailVenueId(venue.id);
                        setSelectedVideoVenueId(venue.id);
                        setSurface('discover');
                      }}
                    >
                      {venue.venueName || '未明确店名'}
                    </button>
                  ))}
                </div>
              </Surface>
            ) : null}
            {snapshotQuery.isPending ? (
              <div className="space-y-2">
                {Array.from({ length: 5 }).map((_, index) => (
                  <Surface key={index} tone="card" elevation="base" className="h-24 animate-pulse bg-[color-mix(in_srgb,var(--nimi-surface-card)_88%,white)]" />
                ))}
              </div>
            ) : null}
            {!snapshotQuery.isPending && filteredImports.length === 0 ? (
              <Surface tone="card" elevation="base" className="p-4 text-sm text-[var(--nimi-text-secondary)]">
                还没有可看的记录。先导入一条视频，或者换个筛选条件。
              </Surface>
            ) : null}
            {filteredImports.map((record) => (
              <SidebarItem
                key={record.id}
                kind="entity-row"
                active={record.id === selectedImport?.id}
                onClick={() => {
                  setSelectedImportId(record.id);
                  const preferredVenueId = pickPreferredVenueId(record);
                  setSelectedDetailVenueId(preferredVenueId);
                  setSelectedVideoVenueId(preferredVenueId);
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
          {surface === 'discover' ? (
            <ScrollArea className="h-full" contentClassName="space-y-4 pr-1">
              {selectedImport ? (
                <VenueDetailPanel
                  selectedImport={selectedImport}
                  selectedVenue={selectedVenue}
                  selectedDetailVenueId={selectedDetailVenueId}
                  videoMapPoints={videoMapPoints}
                  onSelectVenue={(venueId) => {
                    setSelectedDetailVenueId(venueId);
                    setSelectedVideoVenueId(venueId);
                  }}
                  onSwitchToVideoMap={() => setSurface('video-map')}
                  refreshSnapshot={refreshSnapshot}
                />
              ) : (
                <Surface tone="panel" elevation="base" className="flex h-full items-center justify-center p-8 text-sm text-[var(--nimi-text-secondary)]">
                  先导入一条视频，这里会显示视频、店铺、评论线索和收藏动作。
                </Surface>
              )}
            </ScrollArea>
          ) : null}

          {surface === 'nearby-map' ? (
            <div className="grid h-full gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
              <MapSurface
                points={discoveryMapPoints}
                selectedVenueId={selectedDiscoveryPoint?.venueId || null}
                onSelectVenue={(venueId) => {
                  setSelectedDiscoveryVenueId(venueId);
                }}
              />
              <Surface tone="panel" elevation="base" className="space-y-4 p-5">
                <div>
                  <div className="text-lg font-semibold text-[var(--nimi-text-primary)]">发现地图</div>
                  <p className="mt-2 text-sm leading-6 text-[var(--nimi-text-secondary)]">
                    这里放的是当前筛选条件下已经能落到地图上的店。你可以先用左边搜博主、城市和菜，再回到地图里看这一批店怎么分布。
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Surface tone="card" elevation="base" className="p-3">
                    <div className="text-xs text-[var(--nimi-text-muted)]">当前点位</div>
                    <div className="mt-2 text-lg font-semibold text-[var(--nimi-text-primary)]">{discoveryMapPoints.length}</div>
                  </Surface>
                  <Surface tone="card" elevation="base" className="p-3">
                    <div className="text-xs text-[var(--nimi-text-muted)]">当前博主</div>
                    <div className="mt-2 text-lg font-semibold text-[var(--nimi-text-primary)]">{discoveryCreatorCount}</div>
                  </Surface>
                </div>
                {selectedDiscoveryPoint ? (
                  <Surface tone="card" elevation="base" className="space-y-2 p-4">
                    <div className="text-xs text-[var(--nimi-text-muted)]">当前点位</div>
                    <div className="text-base font-semibold text-[var(--nimi-text-primary)]">{selectedDiscoveryPoint.venueName || '未明确店名'}</div>
                    <div className="text-sm text-[var(--nimi-text-secondary)]">{selectedDiscoveryPoint.addressText || '无地址线索'}</div>
                    <div className="text-xs text-[var(--nimi-text-muted)]">来自 {selectedDiscoveryPoint.creatorName || '未知作者'}</div>
                    <div className="text-xs text-[var(--nimi-text-muted)]">{selectedDiscoveryImport?.title || '未找到所属视频'}</div>
                    <div className="pt-2">
                      <Button
                        tone="secondary"
                        size="sm"
                        onClick={() => {
                          if (!selectedDiscoveryImport) {
                            return;
                          }
                          setSelectedImportId(selectedDiscoveryImport.id);
                          setSelectedDetailVenueId(selectedDiscoveryPoint.venueId);
                          setSelectedVideoVenueId(selectedDiscoveryPoint.venueId);
                          setSurface('discover');
                        }}
                      >
                        查看所属视频
                      </Button>
                    </div>
                  </Surface>
                ) : null}
              </Surface>
            </div>
          ) : null}

          {surface === 'video-map' ? (
            <div className="grid h-full gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
              <MapSurface
                points={videoMapPoints}
                selectedVenueId={selectedVideoPoint?.venueId || null}
                onSelectVenue={(venueId) => {
                  setSelectedVideoVenueId(venueId);
                  setSelectedDetailVenueId(venueId);
                }}
              />
              <Surface tone="panel" elevation="base" className="space-y-4 p-5">
                <div>
                  <div className="text-lg font-semibold text-[var(--nimi-text-primary)]">单视频地图</div>
                  <p className="mt-2 text-sm leading-6 text-[var(--nimi-text-secondary)]">
                    这里只看当前视频里提到的店，方便你判断这条视频到底推荐了几家、哪家已经能在图上落下来。
                  </p>
                </div>
                {selectedImport ? (
                  <Surface tone="card" elevation="base" className="space-y-3 p-4">
                    <div className="text-base font-semibold text-[var(--nimi-text-primary)]">{selectedImport.title || '未命名视频'}</div>
                    <div className="text-sm text-[var(--nimi-text-secondary)]">{selectedImport.creatorName || '未知作者'}</div>
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <div className="text-xs text-[var(--nimi-text-muted)]">可落点</div>
                        <div className="mt-1 text-lg font-semibold text-[var(--nimi-text-primary)]">{videoMapPoints.length}</div>
                      </div>
                      <div>
                        <div className="text-xs text-[var(--nimi-text-muted)]">待确认</div>
                        <div className="mt-1 text-lg font-semibold text-[var(--nimi-text-primary)]">
                          {selectedImport.venues.filter((venue) => !venue.userConfirmed && !venueShowsOnMap(venue)).length}
                        </div>
                      </div>
                    </div>
                  </Surface>
                ) : null}
                {selectedVenue ? (
                  <Surface tone="card" elevation="base" className="space-y-2 p-4">
                    <div className="text-xs text-[var(--nimi-text-muted)]">当前选中</div>
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
                    <p className="mt-1 text-sm text-[var(--nimi-text-secondary)]">
                      这里放的是还没被你确认、或者还没稳定上图的店。确认过的店会从这里退出，进入你的地图。
                    </p>
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
                    {venue.isFavorite ? <StatusBadge tone="warning">已收藏</StatusBadge> : null}
                  </div>
                  <div className="text-sm text-[var(--nimi-text-secondary)]">{venue.addressText || '暂无地址线索'}</div>
                  <div className="flex flex-wrap gap-2">
                    {venue.recommendedDishes.map((dish) => <StatusBadge key={dish} tone="danger">{dish}</StatusBadge>)}
                    {venue.flavorTags.map((tag) => <StatusBadge key={tag} tone="warning">{tag}</StatusBadge>)}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      tone="primary"
                      size="sm"
                      disabled={confirmationMutation.isPending}
                      onClick={() => confirmationMutation.mutate({ venueId: venue.id, confirmed: true })}
                    >
                      确认这家店
                    </Button>
                    <Button
                      tone={venue.isFavorite ? 'primary' : 'secondary'}
                      size="sm"
                      disabled={favoriteMutation.isPending}
                      onClick={() => favoriteMutation.mutate(venue.id)}
                    >
                      {venue.isFavorite ? '取消收藏' : '加入收藏'}
                    </Button>
                    <Button
                      tone="secondary"
                      size="sm"
                      onClick={() => {
                        setSelectedImportId(record.id);
                        setSelectedDetailVenueId(venue.id);
                        setSelectedVideoVenueId(venue.id);
                        setSurface('discover');
                      }}
                    >
                      回到视频详情
                    </Button>
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
                这一版先把视频、评论、地图和确认动作打通。等店铺信息更稳定后，再接菜单拍照和点菜建议。
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
