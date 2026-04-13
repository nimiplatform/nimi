import type {
  ImportRecord,
  MapPoint,
  VenueRecord,
  VideoFoodMapRuntimeOptionsCatalog,
  VideoFoodMapSettings,
} from '@renderer/data/types.js';
import type { DiningPreferenceCategoryId } from '@renderer/data/preferences.js';

import type { ReviewItem } from './app-surface-shared.js';
import { DiscoverSurface } from './app-surface-discover.js';
import { SharedMapSection } from './app-surface-map.js';
import { ReviewSurface } from './app-surface-review.js';
import { SettingsSurface } from './app-surface-settings.js';
import type { RuntimeSettingsCapability, SurfaceId } from './app-helpers.js';
import type { NearbyLocationState } from './app-shell-sections.js';

export function VideoFoodMapSurfaceRouter(props: {
  surface: SurfaceId;
  selectedImport: ImportRecord | null;
  selectedVenue: VenueRecord | null;
  selectedDetailVenueId: string | null;
  visibleCommentClues: ImportRecord['commentClues'];
  videoMapPoints: MapPoint[];
  selectedDiscoveryPoint: MapPoint | null;
  selectedDiscoveryDistance: number | null;
  selectedDiscoveryImport: ImportRecord | null;
  currentLocation: NearbyLocationState['location'];
  nearbyLocationState: NearbyLocationState;
  nearbyRadiusKm: number;
  discoveryCreatorCount: number;
  nearestDiscoveryDistance: number | null;
  visibleDiscoveryMapPoints: MapPoint[];
  selectedVideoPoint: MapPoint | null;
  selectedVideoDistance: number | null;
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
  onSwitchToVideoMap: () => void;
  onRetryImport: (importId: string) => void;
  onRequestCurrentLocation: () => void;
  onRadiusChange: (next: number) => void;
  onSelectDiscoveryMapVenue: (venueId: string) => void;
  onViewImportFromPoint: () => void;
  onSelectVideoMapVenue: (venueId: string) => void;
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
        <DiscoverSurface
          selectedImport={props.selectedImport}
          selectedVenue={props.selectedVenue}
          selectedDetailVenueId={props.selectedDetailVenueId}
          visibleCommentClues={props.visibleCommentClues}
          videoMapPoints={props.videoMapPoints}
          onSelectVenue={props.onSelectDiscoverVenue}
          onOpenSource={props.onOpenSelectedSource}
          onConfirmVenue={props.onConfirmVenue}
          onToggleFavorite={props.onToggleFavorite}
          onSwitchToVideoMap={props.onSwitchToVideoMap}
          onRetryImport={props.onRetryImport}
          confirmationPending={props.confirmationPending}
          favoritePending={props.favoritePending}
          retryPending={props.retryPending}
        />
      ) : null}

      {props.surface === 'nearby-map' ? (
        <SharedMapSection
          mode="nearby-map"
          points={props.visibleDiscoveryMapPoints}
          selectedPoint={props.selectedDiscoveryPoint}
          selectedPointDistanceKm={props.selectedDiscoveryDistance}
          selectedImport={props.selectedDiscoveryImport}
          selectedVenue={props.selectedVenue}
          currentLocation={props.currentLocation}
          nearbyLocationState={props.nearbyLocationState}
          nearbyRadiusKm={props.nearbyRadiusKm}
          discoveryCreatorCount={props.discoveryCreatorCount}
          nearestDiscoveryDistance={props.nearestDiscoveryDistance}
          onRequestCurrentLocation={props.onRequestCurrentLocation}
          onRadiusChange={props.onRadiusChange}
          onSelectVenue={props.onSelectDiscoveryMapVenue}
          onOpenSourceImport={props.onOpenSelectedSource}
          onViewImportFromPoint={props.onViewImportFromPoint}
        />
      ) : null}

      {props.surface === 'video-map' ? (
        <SharedMapSection
          mode="video-map"
          points={props.videoMapPoints}
          selectedPoint={props.selectedVideoPoint}
          selectedPointDistanceKm={props.selectedVideoDistance}
          selectedImport={props.selectedImport}
          selectedVenue={props.selectedVenue}
          currentLocation={props.currentLocation}
          nearbyLocationState={props.nearbyLocationState}
          nearbyRadiusKm={props.nearbyRadiusKm}
          discoveryCreatorCount={props.discoveryCreatorCount}
          nearestDiscoveryDistance={props.nearestDiscoveryDistance}
          onRequestCurrentLocation={props.onRequestCurrentLocation}
          onRadiusChange={props.onRadiusChange}
          onSelectVenue={props.onSelectVideoMapVenue}
          onOpenSourceImport={props.onOpenSelectedSource}
          onViewImportFromPoint={() => {}}
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
