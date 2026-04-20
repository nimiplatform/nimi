import type {
  ImportRecord,
  MapPoint,
  VenueRecord,
  VideoFoodMapSnapshot,
  VideoFoodMapRuntimeOptionsCatalog,
  VideoFoodMapSettings,
} from '@renderer/data/types.js';
import type { DiningPreferenceCategoryId } from '@renderer/data/preferences.js';

import type { ReviewItem } from './app-surface-shared.js';
import { PersonalMapSurface } from './app-surface-personal-map.js';
import { PersonalSpaceSurface } from './app-surface-space.js';
import { ReviewSurface } from './app-surface-review.js';
import { SettingsSurface } from './app-surface-settings.js';
import type { PersonalMapMode, RuntimeSettingsCapability, SurfaceId } from './app-helpers.js';
import type { NearbyLocationState } from './app-shell-sections.js';

export function VideoFoodMapSurfaceRouter(props: {
  snapshot: VideoFoodMapSnapshot | undefined;
  surface: SurfaceId;
  selectedImport: ImportRecord | null;
  selectedVenue: VenueRecord | null;
  selectedDetailVenueId: string | null;
  visibleCommentClues: ImportRecord['commentClues'];
  favoriteVenues: ReviewItem[];
  mappedVenues: ReviewItem[];
  recentImports: ImportRecord[];
  creatorSyncs: VideoFoodMapSnapshot['creatorSyncs'];
  mapMode: PersonalMapMode;
  visibleMapPoints: MapPoint[];
  selectedMapPoint: MapPoint | null;
  selectedMapDistance: number | null;
  selectedMapImport: ImportRecord | null;
  currentLocation: NearbyLocationState['location'];
  nearbyLocationState: NearbyLocationState;
  nearbyRadiusKm: number;
  reviewItems: ReviewItem[];
  reviewIndex: number;
  selectedReviewItem: ReviewItem | null;
  diningProfile: VideoFoodMapSettings['diningProfile'];
  currentSettings: VideoFoodMapSettings;
  runtimeOptions: { stt: VideoFoodMapRuntimeOptionsCatalog; text: VideoFoodMapRuntimeOptionsCatalog } | undefined;
  runtimeOptionsPending: boolean;
  settingsPending: boolean;
  settingsErrorText: string | null;
  runtimeOptionsErrorText: string | null;
  saveSettingsErrorText: string | null;
  confirmationPending: boolean;
  favoritePending: boolean;
  retryPending: boolean;
  saveSettingsPending: boolean;
  onSelectDiscoverVenue: (venueId: string) => void;
  onOpenSelectedSource: () => void;
  onConfirmVenue: (venueId: string, confirmed: boolean) => void;
  onToggleFavorite: (venueId: string) => void;
  onOpenMap: () => void;
  onOpenReview: () => void;
  onOpenProfile: () => void;
  onOpenImport: (recordId: string, venueId: string | null) => void;
  onRetryImport: (importId: string) => void;
  onMapModeChange: (next: PersonalMapMode) => void;
  onRequestCurrentLocation: () => void;
  onRadiusChange: (next: number) => void;
  onSelectMapVenue: (venueId: string) => void;
  onViewImportFromPoint: () => void;
  onSelectReviewIndex: (next: number) => void;
  onNextReview: () => void;
  onOpenReviewInDiscover: (recordId: string, venueId: string) => void;
  onToggleDiningPreference: (category: DiningPreferenceCategoryId, value: string) => void;
  onUpdateCapabilitySetting: (capability: RuntimeSettingsCapability, nextSetting: VideoFoodMapSettings['stt']) => void;
  onRefreshRuntimeOptions: () => void;
}) {
  return (
    <>
      {props.surface === 'discover' ? (
        <PersonalSpaceSurface
          snapshot={props.snapshot}
          selectedImport={props.selectedImport}
          selectedVenue={props.selectedVenue}
          favoriteVenues={props.favoriteVenues}
          mappedVenues={props.mappedVenues}
          reviewItems={props.reviewItems}
          creatorSyncs={props.creatorSyncs}
          diningProfile={props.diningProfile}
          selectedDetailVenueId={props.selectedDetailVenueId}
          visibleCommentClues={props.visibleCommentClues}
          recentImports={props.recentImports}
          onSelectVenue={props.onSelectDiscoverVenue}
          onOpenSource={props.onOpenSelectedSource}
          onConfirmVenue={props.onConfirmVenue}
          onToggleFavorite={props.onToggleFavorite}
          onOpenMap={props.onOpenMap}
          onOpenReview={props.onOpenReview}
          onOpenProfile={props.onOpenProfile}
          onOpenImport={props.onOpenImport}
          onRetryImport={props.onRetryImport}
          confirmationPending={props.confirmationPending}
          favoritePending={props.favoritePending}
          retryPending={props.retryPending}
        />
      ) : null}

      {props.surface === 'nearby-map' ? (
        <PersonalMapSurface
          snapshot={props.snapshot}
          selectedImport={props.selectedMapImport}
          mode={props.mapMode}
          points={props.visibleMapPoints}
          selectedPoint={props.selectedMapPoint}
          selectedPointDistanceKm={props.selectedMapDistance}
          currentLocation={props.currentLocation}
          nearbyLocationState={props.nearbyLocationState}
          nearbyRadiusKm={props.nearbyRadiusKm}
          onModeChange={props.onMapModeChange}
          onRequestCurrentLocation={props.onRequestCurrentLocation}
          onRadiusChange={props.onRadiusChange}
          onSelectVenue={props.onSelectMapVenue}
          onOpenSourceImport={props.onOpenSelectedSource}
          onOpenImportFromPoint={props.onViewImportFromPoint}
        />
      ) : null}

      {props.surface === 'review' ? (
        <ReviewSurface
          reviewItems={props.reviewItems}
          reviewIndex={props.reviewIndex}
          selectedReviewItem={props.selectedReviewItem}
          confirmationPending={props.confirmationPending}
          favoritePending={props.favoritePending}
          onSelectIndex={props.onSelectReviewIndex}
          onNext={props.onNextReview}
          onConfirm={props.onConfirmVenue}
          onToggleFavorite={props.onToggleFavorite}
          onOpenInDiscover={props.onOpenReviewInDiscover}
        />
      ) : null}

      {props.surface === 'menu' ? (
        <SettingsSurface
          diningProfile={props.diningProfile}
          saveSettingsPending={props.saveSettingsPending}
          onToggleDiningPreference={props.onToggleDiningPreference}
          currentSettings={props.currentSettings}
          runtimeOptions={props.runtimeOptions}
          runtimeOptionsPending={props.runtimeOptionsPending}
          settingsPending={props.settingsPending}
          settingsErrorText={props.settingsErrorText}
          runtimeOptionsErrorText={props.runtimeOptionsErrorText}
          saveSettingsErrorText={props.saveSettingsErrorText}
          onUpdateCapabilitySetting={props.onUpdateCapabilitySetting}
          onRefreshRuntimeOptions={props.onRefreshRuntimeOptions}
        />
      ) : null}
    </>
  );
}
