import { Button, SelectField, StatusBadge, Surface } from '@nimiplatform/nimi-kit/ui';
import { formatAccuracyLabel, formatDistanceLabel } from '@renderer/data/nearby.js';
import type { ImportRecord, MapPoint, VideoFoodMapSnapshot } from '@renderer/data/types.js';
import { MapSurface } from '@renderer/components/map-surface.js';

import { type PersonalMapMode } from './app-helpers.js';
import { NEARBY_RADIUS_OPTIONS, formatLocationCapturedAt, type NearbyLocationState } from './app-shell-sections.js';

const MAP_MODE_OPTIONS: Array<{ value: PersonalMapMode; label: string }> = [
  { value: 'all', label: '全部已上图' },
  { value: 'favorites', label: '只看收藏' },
  { value: 'selected', label: '当前视频' },
  { value: 'nearby', label: '看我附近' },
];

function resolveMapModeCopy(mode: PersonalMapMode): { title: string; description: string } {
  switch (mode) {
    case 'favorites':
      return {
        title: '我的收藏地图',
        description: '先只看你已经收藏下来的地方，适合快速做决定。',
      };
    case 'selected':
      return {
        title: '当前视频地图',
        description: '只看正在整理的这一条线索里提到的地点。',
      };
    case 'nearby':
      return {
        title: '我附近能去的店',
        description: '显式获取当前位置后，只看你附近已经能稳定落点的地方。',
      };
    default:
      return {
        title: '我的美食地图',
        description: '把已经落到地图上的地点放在一起，看你的空间现在已经长到哪了。',
      };
  }
}

export function PersonalMapSurface(props: {
  snapshot: VideoFoodMapSnapshot | undefined;
  selectedImport: ImportRecord | null;
  mode: PersonalMapMode;
  points: MapPoint[];
  selectedPoint: MapPoint | null;
  selectedPointDistanceKm: number | null;
  currentLocation: NearbyLocationState['location'];
  nearbyLocationState: NearbyLocationState;
  nearbyRadiusKm: number;
  onModeChange: (next: PersonalMapMode) => void;
  onSelectVenue: (venueId: string) => void;
  onRequestCurrentLocation: () => void;
  onRadiusChange: (next: number) => void;
  onOpenImportFromPoint: () => void;
  onOpenSourceImport: () => void;
}) {
  const copy = resolveMapModeCopy(props.mode);

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
      <Surface tone="canvas" material="glass-thick" elevation="raised" className="vfm-radius-stage relative min-h-[680px] overflow-hidden p-3">
        <MapSurface
          points={props.points}
          selectedVenueId={props.selectedPoint?.venueId || null}
          selectedPoint={props.selectedPoint}
          selectedPointDistanceKm={props.selectedPointDistanceKm}
          currentLocation={props.currentLocation}
          onSelectVenue={props.onSelectVenue}
        />

        <div className="pointer-events-none absolute inset-x-4 top-4 z-10">
          <Surface tone="panel" material="glass-regular" elevation="base" className="pointer-events-auto ml-auto max-w-[560px] p-5">
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge tone="info">{copy.title}</StatusBadge>
                <StatusBadge tone="neutral">{props.points.length} 个点</StatusBadge>
              </div>
              <div className="text-sm leading-7 text-[var(--nimi-text-secondary)]">{copy.description}</div>
              <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_180px]">
                <SelectField
                  value={props.mode}
                  options={MAP_MODE_OPTIONS}
                  onValueChange={(value) => props.onModeChange(value as PersonalMapMode)}
                />
                {props.mode === 'nearby' ? (
                  <SelectField
                    value={String(props.nearbyRadiusKm)}
                    options={NEARBY_RADIUS_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
                    onValueChange={(value) => props.onRadiusChange(Number(value) || 10)}
                    disabled={!props.currentLocation || props.nearbyLocationState.status === 'locating'}
                  />
                ) : (
                  <Button tone="secondary" onClick={props.onRequestCurrentLocation}>
                    获取当前位置
                  </Button>
                )}
              </div>
              {props.mode === 'nearby' ? (
                <div className="text-xs leading-6 text-[var(--nimi-text-muted)]">
                  {props.currentLocation
                    ? `${formatAccuracyLabel(props.currentLocation.accuracyMeters)} · ${formatLocationCapturedAt(props.currentLocation.capturedAt)} 更新`
                    : props.nearbyLocationState.message || '还没拿当前位置，先点一次再看附近。'}
                </div>
              ) : null}
            </div>
          </Surface>
        </div>
      </Surface>

      <div className="space-y-6">
        <Surface tone="panel" material="glass-regular" elevation="base" className="vfm-radius-panel space-y-4 p-5">
          <div className="text-lg font-semibold text-[var(--nimi-text-primary)]">当前选中</div>
          {props.selectedPoint ? (
            <>
              <div>
                <div className="text-2xl font-semibold text-[var(--nimi-text-primary)]">{props.selectedPoint.venueName || '未明确店名'}</div>
                <div className="mt-2 text-sm leading-7 text-[var(--nimi-text-secondary)]">{props.selectedPoint.addressText || '暂无地址'}</div>
              </div>
              {props.selectedPointDistanceKm != null ? (
                <div className="text-xs text-[var(--nimi-text-muted)]">离你大约 {formatDistanceLabel(props.selectedPointDistanceKm)}</div>
              ) : null}
              <div className="grid gap-3 sm:grid-cols-2">
                <Button tone="primary" onClick={props.onOpenImportFromPoint}>回到空间详情</Button>
                <Button tone="secondary" onClick={props.onOpenSourceImport}>查看原视频</Button>
              </div>
            </>
          ) : (
            <div className="text-sm leading-7 text-[var(--nimi-text-secondary)]">
              当前模式下还没有可选中的点。你可以换个筛选方式，或者先把更多线索确认下来。
            </div>
          )}
        </Surface>

        <Surface tone="panel" material="glass-regular" elevation="base" className="vfm-radius-panel space-y-4 p-5">
          <div className="text-lg font-semibold text-[var(--nimi-text-primary)]">地图摘要</div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Surface tone="card" material="glass-thin" elevation="base" className="vfm-radius-card p-4">
              <div className="text-xs text-[var(--nimi-text-muted)]">全部已上图</div>
              <div className="mt-2 text-2xl font-semibold text-[var(--nimi-text-primary)]">{props.snapshot?.stats.mappedVenueCount || 0}</div>
            </Surface>
            <Surface tone="card" material="glass-thin" elevation="base" className="vfm-radius-card p-4">
              <div className="text-xs text-[var(--nimi-text-muted)]">收藏地点</div>
              <div className="mt-2 text-2xl font-semibold text-[var(--nimi-text-primary)]">{props.snapshot?.stats.favoriteVenueCount || 0}</div>
            </Surface>
          </div>
          {props.mode === 'selected' ? (
            <div className="text-sm leading-7 text-[var(--nimi-text-secondary)]">
              {props.selectedImport
                ? `当前正在看「${props.selectedImport.title || '未命名视频'}」里的地点分布。`
                : '还没有选中视频，左侧挑一条回来就能看单条线索。'}
            </div>
          ) : null}
        </Surface>
      </div>
    </div>
  );
}
