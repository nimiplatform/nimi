import { useEffect, useMemo, useState } from 'react';
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
  saveVideoFoodMapSettings,
  setVenueConfirmation,
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
  VideoFoodMapRouteSetting,
  VideoFoodMapSettings,
  VideoFoodMapSnapshot,
} from '@renderer/data/types.js';
import { MapSurface } from '@renderer/components/map-surface.js';
import { DiningPreferencePanel } from '@renderer/components/dining-preference-panel.js';
import { VenueDetailPanel } from '@renderer/components/venue-detail-panel.js';
import {
  formatLocationCapturedAt,
  NEARBY_RADIUS_OPTIONS,
  type NearbyLocationState,
  VideoFoodMapHeroSection,
  VideoFoodMapSidebar,
} from './app-shell-sections.js';
import {
  buildMapPointFromVenue,
  createDefaultVideoFoodMapSettings,
  isImportActive,
  pickPreferredVenueId,
  resolveReviewTone,
  type RuntimeSettingsCapability,
  type SurfaceId,
  venueShowsOnMap,
} from './app-helpers.js';

const queryClient = new QueryClient();

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
  const [videoUrl, setVideoUrl] = useState('');
  const [creatorUrl, setCreatorUrl] = useState('');
  const [surface, setSurface] = useState<SurfaceId>('discover');
  const [searchText, setSearchText] = useState('');
  const [reviewFilter, setReviewFilter] = useState<ReviewFilter>('all');
  const [selectedImportId, setSelectedImportId] = useState<string | null>(null);
  const [selectedDetailVenueId, setSelectedDetailVenueId] = useState<string | null>(null);
  const [selectedDiscoveryVenueId, setSelectedDiscoveryVenueId] = useState<string | null>(null);
  const [selectedVideoVenueId, setSelectedVideoVenueId] = useState<string | null>(null);
  const [nearbyRadiusKm, setNearbyRadiusKm] = useState(10);
  const [creatorSyncFeedbackText, setCreatorSyncFeedbackText] = useState<string | null>(null);
  const [nearbyLocationState, setNearbyLocationState] = useState<NearbyLocationState>({
    status: 'idle',
    location: null,
    message: '',
  });

  const refreshSnapshot = async () => {
    await queryClient.invalidateQueries({ queryKey: ['video-food-map', 'snapshot'] });
  };

  const saveSettingsMutation = useMutation({
    mutationFn: async (settings: VideoFoodMapSettings) => saveVideoFoodMapSettings(settings),
    onSuccess: async (settings) => {
      queryClient.setQueryData(['video-food-map', 'settings'], settings);
    },
  });

  const currentSettings = settingsQuery.data || createDefaultVideoFoodMapSettings();
  const runtimeOptions = runtimeOptionsQuery.data;
  const diningProfile = currentSettings.diningProfile;

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

  const importMutation = useMutation({
    mutationFn: async (url: string) => importVideo(url),
    onSuccess: async (record) => {
      setVideoUrl('');
      setCreatorSyncFeedbackText(null);
      setSelectedImportId(record.id);
      const preferredVenueId = pickPreferredVenueId(record);
      setSelectedDetailVenueId(preferredVenueId);
      setSelectedVideoVenueId(preferredVenueId);
      setSelectedDiscoveryVenueId(preferredVenueId);
    },
    onSettled: refreshSnapshot,
  });

  const creatorImportMutation = useMutation({
    mutationFn: async (url: string) => importCreator(url),
    onSuccess: async (result) => {
      setCreatorUrl('');
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

  const favoriteVenues = filteredImports.flatMap((record) =>
    record.venues
      .filter((venue) => venue.isFavorite)
      .map((venue) => ({ venue, record })),
  );

  return (
    <div className="flex h-full flex-col gap-4 p-4">
      <VideoFoodMapHeroSection
        snapshot={snapshot}
        activeImport={activeImport}
        surface={surface}
        onSurfaceChange={setSurface}
        videoUrl={videoUrl}
        onVideoUrlChange={setVideoUrl}
        onImport={() => importMutation.mutate(videoUrl.trim())}
        importPending={importMutation.isPending}
        creatorUrl={creatorUrl}
        onCreatorUrlChange={setCreatorUrl}
        onImportCreator={() => creatorImportMutation.mutate(creatorUrl.trim())}
        creatorImportPending={creatorImportMutation.isPending}
        settings={settingsQuery.data}
        runtimeOptions={runtimeOptions}
        runtimeOptionsPending={runtimeOptionsQuery.isPending}
        settingsPending={settingsQuery.isPending}
        saveSettingsPending={saveSettingsMutation.isPending}
        onUpdateCapabilitySetting={updateCapabilitySetting}
        onRefreshRuntimeOptions={() => void runtimeOptionsQuery.refetch()}
        settingsErrorText={settingsQuery.isError ? (settingsQuery.error instanceof Error ? settingsQuery.error.message : '设置加载失败') : null}
        runtimeOptionsErrorText={runtimeOptionsQuery.isError ? (runtimeOptionsQuery.error instanceof Error ? runtimeOptionsQuery.error.message : '模型列表加载失败') : null}
        saveSettingsErrorText={saveSettingsMutation.isError ? (saveSettingsMutation.error instanceof Error ? saveSettingsMutation.error.message : '设置保存失败') : null}
        importErrorText={importMutation.isError ? (importMutation.error instanceof Error ? importMutation.error.message : '导入失败') : null}
        creatorImportErrorText={creatorImportMutation.isError ? (creatorImportMutation.error instanceof Error ? creatorImportMutation.error.message : '博主同步失败') : null}
        creatorSyncFeedbackText={creatorSyncFeedbackText}
        snapshotErrorText={snapshotQuery.isError ? (snapshotQuery.error instanceof Error ? snapshotQuery.error.message : '加载失败') : null}
      />

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
        <VideoFoodMapSidebar
          snapshotPending={snapshotQuery.isPending}
          creatorSyncs={snapshot?.creatorSyncs || []}
          favoriteVenues={favoriteVenues}
          filteredImports={filteredImports}
          selectedImport={selectedImport}
          searchText={searchText}
          onSearchTextChange={setSearchText}
          reviewFilter={reviewFilter}
          onReviewFilterChange={setReviewFilter}
          onSelectImport={(record: ImportRecord) => {
            setSelectedImportId(record.id);
            const preferredVenueId = pickPreferredVenueId(record);
            setSelectedDetailVenueId(preferredVenueId);
            setSelectedVideoVenueId(preferredVenueId);
          }}
          onSelectFavoriteVenue={(venue) => {
            setSelectedImportId(venue.importId);
            setSelectedDetailVenueId(venue.id);
            setSelectedVideoVenueId(venue.id);
            setSurface('discover');
          }}
        />

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
                points={visibleDiscoveryMapPoints}
                selectedVenueId={selectedDiscoveryPoint?.venueId || null}
                selectedPoint={selectedDiscoveryPoint}
                selectedPointDistanceKm={selectedDiscoveryDistance}
                currentLocation={currentLocation}
                onSelectVenue={(venueId) => {
                  setSelectedDiscoveryVenueId(venueId);
                }}
              />
              <Surface tone="panel" elevation="base" className="space-y-4 p-5">
                <div>
                  <div className="text-lg font-semibold text-[var(--nimi-text-primary)]">发现地图</div>
                  <p className="mt-2 text-sm leading-6 text-[var(--nimi-text-secondary)]">
                    这里放的是当前筛选条件下已经能落到地图上的店。你可以先拿当前位置，再按范围看离你最近的店；没开定位时，就还是普通发现地图。
                  </p>
                </div>
                <div className="space-y-3">
                  <div className="flex flex-wrap gap-2">
                    <Button
                      tone={currentLocation ? 'secondary' : 'primary'}
                      size="sm"
                      onClick={requestCurrentLocation}
                      disabled={nearbyLocationState.status === 'locating'}
                    >
                      {nearbyLocationState.status === 'locating'
                        ? '定位中...'
                        : currentLocation
                          ? '重新获取当前位置'
                          : '获取当前位置'}
                    </Button>
                    <SelectField
                      value={String(nearbyRadiusKm)}
                      disabled={!currentLocation || nearbyLocationState.status === 'locating'}
                      options={NEARBY_RADIUS_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
                      onValueChange={(value) => setNearbyRadiusKm(Number(value) || 10)}
                    />
                  </div>
                  <Surface tone="card" elevation="base" className="p-3 text-sm text-[var(--nimi-text-secondary)]">
                    {currentLocation ? (
                      <>
                        已按当前位置筛附近店。
                        {` ${formatAccuracyLabel(currentLocation.accuracyMeters)} · ${formatLocationCapturedAt(currentLocation.capturedAt)} 更新`}
                      </>
                    ) : nearbyLocationState.message ? nearbyLocationState.message : '还没拿当前位置，所以这里先显示当前筛选下的全部上图店。'}
                  </Surface>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Surface tone="card" elevation="base" className="p-3">
                    <div className="text-xs text-[var(--nimi-text-muted)]">当前点位</div>
                    <div className="mt-2 text-lg font-semibold text-[var(--nimi-text-primary)]">{visibleDiscoveryMapPoints.length}</div>
                  </Surface>
                  <Surface tone="card" elevation="base" className="p-3">
                    <div className="text-xs text-[var(--nimi-text-muted)]">当前博主</div>
                    <div className="mt-2 text-lg font-semibold text-[var(--nimi-text-primary)]">{discoveryCreatorCount}</div>
                  </Surface>
                </div>
                {currentLocation && visibleDiscoveryMapPoints.length === 0 ? (
                  <Surface tone="card" elevation="base" className="space-y-2 p-4">
                    <div className="text-sm font-medium text-[var(--nimi-text-primary)]">这附近还没有已上图的店</div>
                    <div className="text-sm text-[var(--nimi-text-secondary)]">
                      {nearestDiscoveryDistance != null
                        ? `当前 ${nearbyRadiusKm} 公里内暂时没有，最近的一家离你大约 ${formatDistanceLabel(nearestDiscoveryDistance)}。`
                        : '你附近还没有已上图的点位，后面导入更多视频后再回来看看。'}
                    </div>
                  </Surface>
                ) : null}
                {selectedDiscoveryPoint ? (
                  <Surface tone="card" elevation="base" className="space-y-2 p-4">
                    <div className="text-xs text-[var(--nimi-text-muted)]">当前点位</div>
                    <div className="text-base font-semibold text-[var(--nimi-text-primary)]">{selectedDiscoveryPoint.venueName || '未明确店名'}</div>
                    <div className="text-sm text-[var(--nimi-text-secondary)]">{selectedDiscoveryPoint.addressText || '无地址线索'}</div>
                    {selectedDiscoveryDistance != null ? (
                      <div className="text-xs text-[var(--nimi-text-muted)]">离你大约 {formatDistanceLabel(selectedDiscoveryDistance)}</div>
                    ) : null}
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
                selectedPoint={selectedVideoPoint}
                selectedPointDistanceKm={selectedVideoDistance}
                currentLocation={currentLocation}
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
                    {selectedVideoDistance != null ? (
                      <div className="text-xs text-[var(--nimi-text-muted)]">离你大约 {formatDistanceLabel(selectedVideoDistance)}</div>
                    ) : null}
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
            <ScrollArea className="h-full" contentClassName="space-y-4 pr-1">
              <DiningPreferencePanel
                profile={diningProfile}
                disabled={saveSettingsMutation.isPending}
                onToggle={updateDiningPreference}
              />
              <Surface tone="panel" elevation="base" className="space-y-4 p-5">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge tone="info">Stage 3</StatusBadge>
                  <StatusBadge tone={diningProfile.dietaryRestrictions.length + diningProfile.tabooIngredients.length + diningProfile.flavorPreferences.length + diningProfile.cuisinePreferences.length > 0 ? 'success' : 'neutral'}>
                    {saveSettingsMutation.isPending ? '保存中' : '已本地保存'}
                  </StatusBadge>
                </div>
                <div>
                  <div className="text-2xl font-semibold text-[var(--nimi-text-primary)]">点菜建议会在后面接上</div>
                  <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--nimi-text-secondary)]">
                    这一版先把偏好记好。后面接菜单拍照和点菜建议时，会优先避开你的忌口，再结合你喜欢的口味和常吃菜系给建议。
                  </p>
                </div>
              </Surface>
            </ScrollArea>
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
