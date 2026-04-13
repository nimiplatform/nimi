import { Button, SelectField, StatusBadge, Surface } from '@nimiplatform/nimi-kit/ui';
import { formatAccuracyLabel, formatDistanceLabel } from '@renderer/data/nearby.js';
import type { ImportRecord, MapPoint, VenueRecord } from '@renderer/data/types.js';
import { MapSurface } from '@renderer/components/map-surface.js';

import { NEARBY_RADIUS_OPTIONS, formatLocationCapturedAt, type NearbyLocationState } from './app-shell-sections.js';
import { venueShowsOnMap } from './app-helpers.js';
import { InfoPill } from './app-surface-shared.js';

export function SharedMapSection(props: {
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
          <div className="vfm-radius-panel vfm-map-overlay pointer-events-auto border border-black/8 p-5 shadow-[0_22px_48px_rgba(15,23,42,0.14)] backdrop-blur">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-lg font-semibold text-[var(--nimi-text-primary)]">{title}</div>
                <div className="mt-1 text-sm leading-6 text-[var(--nimi-text-secondary)]">{subtitle}</div>
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
                <div className="vfm-map-overlay-note rounded-2xl px-4 py-3 text-sm leading-6">
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
        <Surface tone="panel" elevation="base" className="vfm-radius-panel w-full min-w-0 overflow-hidden p-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <Surface tone="card" elevation="base" className="vfm-radius-tight w-full min-w-0 overflow-hidden p-4">
              <div className="text-xs text-[var(--nimi-text-muted)]">{isNearbyMode ? '当前点位' : '当前视频点位'}</div>
              <div className="mt-2 text-2xl font-semibold text-[var(--nimi-text-primary)]">{props.points.length}</div>
            </Surface>
            <Surface tone="card" elevation="base" className="vfm-radius-tight w-full min-w-0 overflow-hidden p-4">
              <div className="text-xs text-[var(--nimi-text-muted)]">{isNearbyMode ? '当前博主' : '待确认'}</div>
              <div className="mt-2 text-2xl font-semibold text-[var(--nimi-text-primary)]">
                {isNearbyMode
                  ? props.discoveryCreatorCount
                  : props.selectedImport?.venues.filter((venue) => !venue.userConfirmed && !venueShowsOnMap(venue)).length || 0}
              </div>
            </Surface>
          </div>
          {isNearbyMode && props.currentLocation && props.points.length === 0 ? (
            <div className="vfm-radius-tight vfm-warning-callout mt-4 px-4 py-4 text-sm leading-7">
              {props.nearestDiscoveryDistance != null
                ? `当前 ${props.nearbyRadiusKm} 公里内暂时没有，最近的一家离你大约 ${formatDistanceLabel(props.nearestDiscoveryDistance)}。`
                : '你附近还没有已上图的点位，后面导入更多视频后再回来看看。'}
            </div>
          ) : null}
        </Surface>

        {props.selectedPoint ? (
          <Surface tone="panel" elevation="base" className="vfm-radius-panel w-full min-w-0 overflow-hidden p-5">
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
          <Surface tone="panel" elevation="base" className="vfm-radius-panel w-full min-w-0 overflow-hidden p-5">
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
