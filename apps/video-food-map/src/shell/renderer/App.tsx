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
import type { PersonalMapMode, RuntimeSettingsCapability, SurfaceId } from './app-helpers.js';
import {
  buildMapPointFromVenue,
  createDefaultVideoFoodMapSettings,
  isImportActive,
  pickPreferredVenueId,
  resolveImportProgressText,
  resolveImportStatusLabel,
  venueShowsOnMap,
} from './app-helpers.js';
import { VideoFoodMapShellFrame } from './app-shell-frame.js';
import { type NearbyLocationState } from './app-shell-sections.js';
import { ContextSidebar } from './app-surface-sidebar.js';
import { VideoFoodMapSurfaceRouter } from './app-surface-router.js';
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
  const [mapMode, setMapMode] = useState<PersonalMapMode>('all');
  const [searchText, setSearchText] = useState('');
  const [reviewFilter, setReviewFilter] = useState<ReviewFilter>('all');
  const [selectedImportId, setSelectedImportId] = useState<string | null>(null);
  const [selectedDetailVenueId, setSelectedDetailVenueId] = useState<string | null>(null);
  const [selectedMapVenueId, setSelectedMapVenueId] = useState<string | null>(null);
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
      setSelectedMapVenueId(preferredVenueId);
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
      setSelectedMapVenueId(payload.venueId);
    },
    onSettled: refreshSnapshot,
  });

  const favoriteMutation = useMutation({
    mutationFn: async (venueId: string) => toggleVenueFavorite(venueId),
    onSuccess: async (record, venueId) => {
      setSelectedImportId(record.id);
      setSelectedDetailVenueId(venueId);
      setSelectedMapVenueId(venueId);
    },
    onSettled: refreshSnapshot,
  });

  const retryImportMutation = useMutation({
    mutationFn: async (importId: string) => retryImport(importId),
    onSuccess: async (record) => {
      setSelectedImportId(record.id);
      const preferredVenueId = pickPreferredVenueId(record);
      setSelectedDetailVenueId(preferredVenueId);
      setSelectedMapVenueId(preferredVenueId);
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
      return;
    }
    const preferredVenueId = pickPreferredVenueId(selectedImport);
    if (!selectedDetailVenueId || !selectedImport.venues.some((venue) => venue.id === selectedDetailVenueId)) {
      setSelectedDetailVenueId(preferredVenueId);
    }
  }, [selectedDetailVenueId, selectedImport]);

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

  const mappedVenues = filteredImports.flatMap((record) =>
    record.venues
      .filter((venue) => venueShowsOnMap(venue))
      .map((venue) => ({ venue, record })),
  );

  const allowedImportIds = new Set(filteredImports.map((record) => record.id));
  const allMapPoints = filterMapPoints(snapshot?.mapPoints || [], allowedImportIds);
  const favoriteMapPoints = allMapPoints.filter((point) => point.isFavorite);
  const selectedImportMapPoints = useMemo(() => {
    if (!selectedImport) {
      return [];
    }
    return selectedImport.venues
      .map((venue) => buildMapPointFromVenue(selectedImport, venue))
      .filter((point): point is MapPoint => point != null);
  }, [selectedImport]);

  const currentLocation = nearbyLocationState.status === 'ready' ? nearbyLocationState.location : null;
  const rankedAllMapPoints = useMemo(
    () => (currentLocation ? rankMapPointsByDistance(allMapPoints, currentLocation) : []),
    [allMapPoints, currentLocation],
  );
  const rankedVisibleNearbyPoints = useMemo(
    () => (currentLocation ? filterRankedMapPointsByRadius(rankedAllMapPoints, nearbyRadiusKm) : []),
    [currentLocation, nearbyRadiusKm, rankedAllMapPoints],
  );

  const visibleMapPoints = useMemo(() => {
    switch (mapMode) {
      case 'favorites':
        return favoriteMapPoints;
      case 'selected':
        return selectedImportMapPoints;
      case 'nearby':
        return currentLocation
          ? rankedVisibleNearbyPoints.map(({ distanceKm: _distanceKm, ...point }) => point)
          : allMapPoints;
      default:
        return allMapPoints;
    }
  }, [allMapPoints, currentLocation, favoriteMapPoints, mapMode, rankedVisibleNearbyPoints, selectedImportMapPoints]);

  const rankedVisibleMapPoints = useMemo(
    () => (currentLocation ? rankMapPointsByDistance(visibleMapPoints, currentLocation) : []),
    [currentLocation, visibleMapPoints],
  );

  useEffect(() => {
    if (visibleMapPoints.length === 0) {
      setSelectedMapVenueId(null);
      return;
    }
    if (!selectedMapVenueId || !visibleMapPoints.some((point) => point.venueId === selectedMapVenueId)) {
      setSelectedMapVenueId(visibleMapPoints[0]!.venueId);
    }
  }, [selectedMapVenueId, visibleMapPoints]);

  const selectedMapPoint =
    visibleMapPoints.find((point) => point.venueId === selectedMapVenueId)
    || visibleMapPoints[0]
    || null;
  const selectedMapDistance = currentLocation
    ? rankedVisibleMapPoints.find((point) => point.venueId === selectedMapPoint?.venueId)?.distanceKm ?? null
    : null;
  const selectedMapImport =
    filteredImports.find((record) => record.id === selectedMapPoint?.importId)
    || null;

  const headerFeedbackText = intakeFeedbackText
    || (importMutation.isError ? (importMutation.error instanceof Error ? importMutation.error.message : '导入失败') : null)
    || (creatorImportMutation.isError ? (creatorImportMutation.error instanceof Error ? creatorImportMutation.error.message : '博主同步失败') : null)
    || creatorSyncFeedbackText
    || (activeImport ? `${resolveImportStatusLabel(activeImport)} · ${resolveImportProgressText(activeImport)}` : null)
    || (snapshotQuery.isError ? (snapshotQuery.error instanceof Error ? snapshotQuery.error.message : '加载失败') : null);

  const intakeBusy = importMutation.isPending || creatorImportMutation.isPending;
  const intakeActionLabel = intakeTarget.kind === 'creator' ? '同步最近视频' : '放进我的空间';

  const openImportInSpace = (recordId: string, venueId: string | null) => {
    setSelectedImportId(recordId);
    setSelectedDetailVenueId(venueId);
    setSelectedMapVenueId(venueId);
    setSurface('discover');
    setSidebarOpen(false);
  };

  const openBestAvailableSource = () => {
    const url = selectedMapImport?.sourceUrl || selectedImport?.sourceUrl;
    if (!url) {
      return;
    }
    void openExternalUrl(url);
  };

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
      favoriteCount={snapshot?.stats.favoriteVenueCount || 0}
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
            openImportInSpace(record.id, pickPreferredVenueId(record));
          }}
          onSelectFavoriteVenue={(entry) => {
            openImportInSpace(entry.record.id, entry.venue.id);
          }}
        />
      )}
    >
      <VideoFoodMapSurfaceRouter
        snapshot={snapshot}
        surface={surface}
        selectedImport={selectedImport}
        selectedVenue={selectedVenue}
        selectedDetailVenueId={selectedDetailVenueId}
        visibleCommentClues={visibleCommentClues}
        favoriteVenues={favoriteVenues}
        mappedVenues={mappedVenues}
        recentImports={filteredImports}
        creatorSyncs={snapshot?.creatorSyncs || []}
        mapMode={mapMode}
        visibleMapPoints={visibleMapPoints}
        selectedMapPoint={selectedMapPoint}
        selectedMapDistance={selectedMapDistance}
        selectedMapImport={selectedMapImport}
        currentLocation={currentLocation}
        nearbyLocationState={nearbyLocationState}
        nearbyRadiusKm={nearbyRadiusKm}
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
          setSelectedMapVenueId(venueId);
        }}
        onOpenSelectedSource={openBestAvailableSource}
        onConfirmVenue={(venueId, confirmed) => confirmationMutation.mutate({ venueId, confirmed })}
        onToggleFavorite={(venueId) => favoriteMutation.mutate(venueId)}
        onOpenMap={() => setSurface('nearby-map')}
        onOpenReview={() => setSurface('review')}
        onOpenProfile={() => setSurface('menu')}
        onOpenImport={openImportInSpace}
        onRetryImport={(importId) => retryImportMutation.mutate(importId)}
        onMapModeChange={(next) => {
          setMapMode(next);
          if (next === 'nearby' && nearbyLocationState.status === 'idle') {
            void requestNearbyLocation(setNearbyLocationState);
          }
        }}
        onRequestCurrentLocation={() => requestNearbyLocation(setNearbyLocationState)}
        onRadiusChange={setNearbyRadiusKm}
        onSelectMapVenue={(venueId) => setSelectedMapVenueId(venueId)}
        onViewImportFromPoint={() => {
          if (!selectedMapImport || !selectedMapPoint) {
            return;
          }
          openImportInSpace(selectedMapImport.id, selectedMapPoint.venueId);
        }}
        onSelectReviewIndex={setReviewIndex}
        onNextReview={() => {
          if (reviewItems.length <= 1) {
            return;
          }
          setReviewIndex((current) => (current + 1) % reviewItems.length);
        }}
        onOpenReviewInDiscover={(recordId, venueId) => {
          openImportInSpace(recordId, venueId);
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
