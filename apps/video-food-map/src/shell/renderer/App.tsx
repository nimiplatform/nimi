import { type MouseEvent, useEffect, useMemo, useState } from 'react';
import { QueryClient, QueryClientProvider, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ShellErrorBoundary } from '@nimiplatform/nimi-kit/telemetry/error-boundary';
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
import { filterRankedMapPointsByRadius, rankMapPointsByDistance } from '@renderer/data/nearby.js';
import type { DiningPreferenceCategoryId } from '@renderer/data/preferences.js';
import type {
  MapPoint,
  VideoFoodMapRouteSetting,
  VideoFoodMapSettings,
  VideoFoodMapSnapshot,
} from '@renderer/data/types.js';
import { requestNearbyLocation } from './app-nearby-location.js';
import { type NearbyLocationState } from './app-shell-sections.js';
import { VideoFoodMapShellFrame } from './app-shell-frame.js';
import { ContextSidebar } from './app-surface-sidebar.js';
import { VideoFoodMapSurfaceRouter } from './app-surface-router.js';
import {
  buildMapPointFromVenue,
  createDefaultVideoFoodMapSettings,
  isImportActive,
  pickPreferredVenueId,
  resolveImportProgressText,
  resolveImportStatusLabel,
  type RuntimeSettingsCapability,
  type SurfaceId,
  venueShowsOnMap,
} from './app-helpers.js';
import { detectVideoFoodMapIntakeTarget } from './intake.js';

function handleWindowDragStart(event: MouseEvent<HTMLDivElement>) {
  if (event.button !== 0) {
    return;
  }
  void startVideoFoodMapWindowDrag().catch(() => {});
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
    <VideoFoodMapShellFrame
      surface={surface}
      sidebarOpen={sidebarOpen}
      intakeInput={intakeInput}
      intakeBusy={intakeBusy}
      intakeActionLabel={intakeActionLabel}
      headerFeedbackText={headerFeedbackText}
      intakeHelperText={intakeTarget.helperText}
      mappedVenueCount={snapshot?.stats.mappedVenueCount || 0}
      reviewCount={reviewItems.length}
      onWindowDragStart={handleWindowDragStart}
      onSurfaceChange={setSurface}
      onSidebarOpen={() => setSidebarOpen(true)}
      onSidebarClose={() => setSidebarOpen(false)}
      onIntakeInputChange={setIntakeInput}
      onIntakeSubmit={submitUnifiedIntake}
      sidebar={(
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
      )}
    >
      <VideoFoodMapSurfaceRouter
        surface={surface}
        selectedImport={selectedImport}
        selectedVenue={selectedVenue}
        selectedDetailVenueId={selectedDetailVenueId}
        visibleCommentClues={visibleCommentClues}
        videoMapPoints={videoMapPoints}
        selectedDiscoveryPoint={selectedDiscoveryPoint}
        selectedDiscoveryDistance={selectedDiscoveryDistance}
        selectedDiscoveryImport={selectedDiscoveryImport}
        currentLocation={currentLocation}
        nearbyLocationState={nearbyLocationState}
        nearbyRadiusKm={nearbyRadiusKm}
        discoveryCreatorCount={discoveryCreatorCount}
        nearestDiscoveryDistance={nearestDiscoveryDistance}
        visibleDiscoveryMapPoints={visibleDiscoveryMapPoints}
        selectedVideoPoint={selectedVideoPoint}
        selectedVideoDistance={selectedVideoDistance}
        reviewItems={reviewItems}
        reviewIndex={reviewIndex}
        selectedReviewItem={selectedReviewItem}
        diningProfile={diningProfile}
        currentSettings={currentSettings}
        runtimeOptions={runtimeOptions}
        runtimeOptionsPending={runtimeOptionsQuery.isPending}
        settingsPending={settingsQuery.isPending}
        settingsErrorText={settingsQuery.isError ? (settingsQuery.error instanceof Error ? settingsQuery.error.message : '设置加载失败') : null}
        runtimeOptionsErrorText={runtimeOptionsQuery.isError ? (runtimeOptionsQuery.error instanceof Error ? runtimeOptionsQuery.error.message : '模型列表加载失败') : null}
        saveSettingsErrorText={saveSettingsMutation.isError ? (saveSettingsMutation.error instanceof Error ? saveSettingsMutation.error.message : '设置保存失败') : null}
        confirmationPending={confirmationMutation.isPending}
        favoritePending={favoriteMutation.isPending}
        retryPending={retryImportMutation.isPending}
        saveSettingsPending={saveSettingsMutation.isPending}
        onSelectDiscoverVenue={(venueId) => {
          setSelectedDetailVenueId(venueId);
          setSelectedVideoVenueId(venueId);
        }}
        onOpenSelectedSource={() => {
          if (!selectedImport?.sourceUrl) {
            return;
          }
          void openExternalUrl(selectedImport.sourceUrl);
        }}
        onConfirmVenue={(venueId, confirmed) => confirmationMutation.mutate({ venueId, confirmed })}
        onToggleFavorite={(venueId) => favoriteMutation.mutate(venueId)}
        onSwitchToVideoMap={() => setSurface('video-map')}
        onRetryImport={(importId) => retryImportMutation.mutate(importId)}
        onRequestCurrentLocation={() => requestNearbyLocation(setNearbyLocationState)}
        onRadiusChange={setNearbyRadiusKm}
        onSelectDiscoveryMapVenue={(venueId) => setSelectedDiscoveryVenueId(venueId)}
        onViewImportFromPoint={() => {
          if (!selectedDiscoveryImport || !selectedDiscoveryPoint) {
            return;
          }
          setSelectedImportId(selectedDiscoveryImport.id);
          setSelectedDetailVenueId(selectedDiscoveryPoint.venueId);
          setSelectedVideoVenueId(selectedDiscoveryPoint.venueId);
          setSurface('discover');
        }}
        onSelectVideoMapVenue={(venueId) => {
          setSelectedVideoVenueId(venueId);
          setSelectedDetailVenueId(venueId);
        }}
        onSelectReviewIndex={setReviewIndex}
        onNextReview={() => {
          if (reviewItems.length <= 1) {
            return;
          }
          setReviewIndex((current) => (current + 1) % reviewItems.length);
        }}
        onOpenReviewInDiscover={(recordId, venueId) => {
          setSelectedImportId(recordId);
          setSelectedDetailVenueId(venueId);
          setSelectedVideoVenueId(venueId);
          setSurface('discover');
        }}
        onToggleDiningPreference={updateDiningPreference}
        onUpdateCapabilitySetting={updateCapabilitySetting}
        onRefreshRuntimeOptions={() => void runtimeOptionsQuery.refetch()}
      />
    </VideoFoodMapShellFrame>
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
