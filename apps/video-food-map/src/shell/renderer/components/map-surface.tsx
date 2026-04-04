import { useEffect, useRef, useState } from 'react';
import { Button, Surface } from '@nimiplatform/nimi-kit/ui';
import { openExternalUrl } from '@renderer/data/api.js';
import { formatDistanceLabel, type UserLocation } from '@renderer/data/nearby.js';
import type { MapPoint } from '@renderer/data/types.js';

type MapSurfaceProps = {
  points: MapPoint[];
  selectedVenueId: string | null;
  selectedPoint: MapPoint | null;
  selectedPointDistanceKm?: number | null;
  onSelectVenue: (venueId: string) => void;
  currentLocation?: UserLocation | null;
  focusCenter?: [number, number] | null;
  focusZoom?: number | null;
  focusKey?: string | null;
};

type AMapInstance = {
  Map: new (container: HTMLElement, options: Record<string, unknown>) => AMapMap;
  Marker: new (options: Record<string, unknown>) => AMapMarker;
  Pixel: new (x: number, y: number) => unknown;
  Scale?: new () => unknown;
  ToolBar?: new () => unknown;
};

type AMapMap = {
  addControl: (control: unknown) => void;
  add: (overlays: unknown[]) => void;
  remove: (overlays: unknown[]) => void;
  clearMap: () => void;
  setFitView: (overlays?: unknown[], immediately?: boolean, padding?: number[]) => void;
  setZoomAndCenter: (zoom: number, center: [number, number]) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  getZoom: () => number;
  on: (eventName: string, handler: () => void) => void;
  destroy: () => void;
};

type AMapMarker = {
  on: (eventName: string, handler: () => void) => void;
  setLabel?: (value: Record<string, unknown>) => void;
  setMap?: (map: AMapMap | null) => void;
};

type DisplayItem =
  | {
    kind: 'venue';
    key: string;
    point: MapPoint;
    active: boolean;
  }
  | {
    kind: 'cluster';
    key: string;
    latitude: number;
    longitude: number;
    count: number;
    active: boolean;
  };

type AMapWindow = Window & typeof globalThis & {
  AMap?: AMapInstance;
  _AMapSecurityConfig?: {
    securityJsCode?: string;
  };
};

const DEFAULT_CENTER: [number, number] = [104.1954, 35.8617];
let amapLoaderPromise: Promise<AMapInstance> | null = null;

function readEnv(name: string): string {
  return String(import.meta.env[name] || '').trim();
}

function buildMarkerHtml(active: boolean): string {
  const background = active ? 'var(--nimi-action-primary-bg)' : '#f97316';
  const shadow = active
    ? '0 12px 28px rgba(249, 115, 22, 0.32)'
    : '0 10px 24px rgba(15, 23, 42, 0.18)';
  const size = active ? 20 : 16;
  return [
    `<div style="position:relative;width:${size}px;height:${size}px;">`,
    `<span style="display:block;width:${size}px;height:${size}px;border-radius:999px;background:${background};border:3px solid white;box-shadow:${shadow};"></span>`,
    '<span style="position:absolute;left:50%;top:100%;width:2px;height:14px;background:rgba(249,115,22,0.32);transform:translateX(-50%);"></span>',
    '</div>',
  ].join('');
}

function buildClusterMarkerHtml(count: number, active: boolean): string {
  const background = active ? '#ea580c' : '#fb923c';
  const shadow = active
    ? '0 14px 30px rgba(234, 88, 12, 0.34)'
    : '0 10px 24px rgba(249, 115, 22, 0.24)';
  return [
    '<div style="display:flex;align-items:center;justify-content:center;min-width:34px;height:34px;padding:0 10px;border-radius:999px;',
    `background:${background};color:white;font-size:13px;font-weight:700;border:3px solid white;box-shadow:${shadow};">`,
    `${count}家`,
    '</div>',
  ].join('');
}

function buildCurrentLocationMarkerHtml(): string {
  return [
    '<div style="position:relative;width:18px;height:18px;">',
    '<span style="position:absolute;inset:-8px;border-radius:999px;background:rgba(37,99,235,0.14);"></span>',
    '<span style="position:absolute;inset:0;border-radius:999px;background:#2563eb;border:3px solid white;box-shadow:0 10px 24px rgba(37,99,235,0.24);"></span>',
    '</div>',
  ].join('');
}

function clusterGridSizeForZoom(zoomLevel: number): number {
  if (zoomLevel <= 7) {
    return 0.32;
  }
  if (zoomLevel <= 9) {
    return 0.18;
  }
  if (zoomLevel <= 11) {
    return 0.08;
  }
  if (zoomLevel <= 12) {
    return 0.04;
  }
  return 0;
}

function buildDisplayItems(points: MapPoint[], zoomLevel: number, selectedVenueId: string | null): DisplayItem[] {
  const gridSize = clusterGridSizeForZoom(zoomLevel);
  if (!gridSize || points.length <= 8) {
    return points.map((point) => ({
      kind: 'venue',
      key: point.venueId,
      point,
      active: point.venueId === selectedVenueId,
    }));
  }

  const buckets = new Map<string, MapPoint[]>();
  for (const point of points) {
    const latKey = Math.round(point.latitude / gridSize);
    const lngKey = Math.round(point.longitude / gridSize);
    const key = `${latKey}:${lngKey}`;
    const bucket = buckets.get(key) || [];
    bucket.push(point);
    buckets.set(key, bucket);
  }

  const displayItems: DisplayItem[] = [];
  for (const [key, bucket] of buckets.entries()) {
    if (bucket.length === 1) {
      const point = bucket[0]!;
      displayItems.push({
        kind: 'venue' as const,
        key: point.venueId,
        point,
        active: point.venueId === selectedVenueId,
      });
      continue;
    }

    const latitude = bucket.reduce((sum, point) => sum + point.latitude, 0) / bucket.length;
    const longitude = bucket.reduce((sum, point) => sum + point.longitude, 0) / bucket.length;
    displayItems.push({
      kind: 'cluster' as const,
      key: `cluster:${key}`,
      latitude,
      longitude,
      count: bucket.length,
      active: bucket.some((point) => point.venueId === selectedVenueId),
    });
  }
  return displayItems;
}

function loadAmap(): Promise<AMapInstance> {
  const mapWindow = window as AMapWindow;
  if (mapWindow.AMap) {
    return Promise.resolve(mapWindow.AMap);
  }
  if (amapLoaderPromise) {
    return amapLoaderPromise;
  }

  const jsKey = readEnv('VITE_VIDEO_FOOD_MAP_AMAP_JS_KEY');
  if (!jsKey) {
    return Promise.reject(new Error('missing_amap_js_key'));
  }

  const securityCode = readEnv('VITE_VIDEO_FOOD_MAP_AMAP_SECURITY_JS_CODE');
  if (securityCode) {
    mapWindow._AMapSecurityConfig = {
      securityJsCode: securityCode,
    };
  }

  amapLoaderPromise = new Promise<AMapInstance>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-amap-loader="video-food-map"]');
    if (existing) {
      existing.addEventListener('load', () => {
        if (mapWindow.AMap) resolve(mapWindow.AMap);
      }, { once: true });
      existing.addEventListener('error', () => reject(new Error('amap_script_load_failed')), { once: true });
      return;
    }

    const script = document.createElement('script');
    script.src = `https://webapi.amap.com/maps?v=2.0&key=${encodeURIComponent(jsKey)}`;
    script.async = true;
    script.defer = true;
    script.dataset.amapLoader = 'video-food-map';
    script.onload = () => {
      if (mapWindow.AMap) {
        resolve(mapWindow.AMap);
      } else {
        reject(new Error('amap_global_missing'));
      }
    };
    script.onerror = () => reject(new Error('amap_script_load_failed'));
    document.head.appendChild(script);
  }).catch((error) => {
    amapLoaderPromise = null;
    throw error;
  });

  return amapLoaderPromise;
}

function buildVenueMarker(AMap: AMapInstance, point: MapPoint, active: boolean, onSelectVenue: (venueId: string) => void): AMapMarker {
  const marker = new AMap.Marker({
    position: [point.longitude, point.latitude],
    anchor: 'bottom-center',
    content: buildMarkerHtml(active),
    title: `${point.venueName} · ${point.addressText}`,
  });
  marker.on('click', () => onSelectVenue(point.venueId));
  if (marker.setLabel) {
    marker.setLabel({
      direction: 'top',
      offset: new AMap.Pixel(0, -6),
      content: `<div style="padding:4px 8px;border-radius:999px;background:rgba(255,255,255,0.96);border:1px solid rgba(226,232,240,0.96);font-size:12px;color:#0f172a;box-shadow:0 10px 24px rgba(15,23,42,0.08);white-space:nowrap;">${point.venueName}</div>`,
    });
  }
  return marker;
}

function buildClusterMarker(
  AMap: AMapInstance,
  item: Extract<DisplayItem, { kind: 'cluster' }>,
  map: AMapMap,
): AMapMarker {
  const marker = new AMap.Marker({
    position: [item.longitude, item.latitude],
    anchor: 'center',
    content: buildClusterMarkerHtml(item.count, item.active),
    title: `这一片有 ${item.count} 家店`,
  });
  marker.on('click', () => {
    const nextZoom = Math.min((map.getZoom?.() || 10) + 2, 16);
    map.setZoomAndCenter(nextZoom, [item.longitude, item.latitude]);
  });
  return marker;
}

function buildCurrentLocationMarker(AMap: AMapInstance, currentLocation: UserLocation): AMapMarker {
  const marker = new AMap.Marker({
    position: [currentLocation.longitude, currentLocation.latitude],
    anchor: 'center',
    content: buildCurrentLocationMarkerHtml(),
    title: '你在这里',
    zIndex: 200,
  });
  if (marker.setLabel) {
    marker.setLabel({
      direction: 'top',
      offset: new AMap.Pixel(0, -10),
      content: '<div style="padding:4px 8px;border-radius:999px;background:rgba(37,99,235,0.92);color:white;font-size:12px;font-weight:700;white-space:nowrap;">你在这里</div>',
    });
  }
  return marker;
}

function buildAmapNavigationHref(point: MapPoint): string {
  const destination = `${point.longitude},${point.latitude},${point.venueName || '目的地'}`;
  return `https://uri.amap.com/navigation?to=${encodeURIComponent(destination)}&mode=car&src=nimi-video-food-map&coordinate=gaode&callnative=0`;
}

function buildAmapMarkerHref(point: MapPoint): string {
  return `https://uri.amap.com/marker?position=${encodeURIComponent(`${point.longitude},${point.latitude}`)}&name=${encodeURIComponent(point.venueName || '目的地')}&src=nimi-video-food-map&coordinate=gaode`;
}

export function MapSurface({
  points,
  selectedVenueId,
  selectedPoint,
  selectedPointDistanceKm = null,
  onSelectVenue,
  currentLocation = null,
  focusCenter = null,
  focusZoom = null,
  focusKey = null,
}: MapSurfaceProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<AMapMap | null>(null);
  const markerRefs = useRef<AMapMarker[]>([]);
  const viewportKeyRef = useRef('');
  const [loadState, setLoadState] = useState<'idle' | 'ready' | 'failed'>('idle');
  const [zoomLevel, setZoomLevel] = useState(4);
  const [externalOpenError, setExternalOpenError] = useState('');

  useEffect(() => {
    let disposed = false;

    loadAmap()
      .then((AMap) => {
        if (disposed || !containerRef.current) {
          return;
        }
        const map = new AMap.Map(containerRef.current, {
          viewMode: '2D',
          zoom: 4,
          center: DEFAULT_CENTER,
          mapStyle: 'amap://styles/normal',
          zooms: [3, 19],
          resizeEnable: true,
        });
        if (AMap.Scale) {
          map.addControl(new AMap.Scale());
        }
        if (AMap.ToolBar) {
          map.addControl(new AMap.ToolBar());
        }
        map.on('zoomchange', () => {
          setZoomLevel(map.getZoom?.() || 4);
        });
        mapRef.current = map;
        setZoomLevel(map.getZoom?.() || 4);
        setLoadState('ready');
      })
      .catch(() => {
        if (!disposed) {
          setLoadState('failed');
        }
      });

    return () => {
      disposed = true;
      markerRefs.current.forEach((marker) => marker.setMap?.(null));
      markerRefs.current = [];
      mapRef.current?.destroy();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (loadState !== 'ready' || !mapRef.current) {
      return;
    }
    const mapWindow = window as AMapWindow;
    const AMap = mapWindow.AMap;
    if (!AMap) {
      return;
    }

    if (markerRefs.current.length > 0) {
      mapRef.current.remove(markerRefs.current as unknown[]);
      markerRefs.current.forEach((marker) => marker.setMap?.(null));
      markerRefs.current = [];
    }

    if (points.length === 0 && !currentLocation) {
      mapRef.current.clearMap();
      mapRef.current.setZoomAndCenter(4, DEFAULT_CENTER);
      return;
    }

    const displayItems = points.length > 0 ? buildDisplayItems(points, zoomLevel, selectedVenueId) : [];
    const markers = displayItems.map((item) =>
      item.kind === 'venue'
        ? buildVenueMarker(AMap, item.point, item.active, onSelectVenue)
        : buildClusterMarker(AMap, item, mapRef.current!),
    );
    if (currentLocation) {
      markers.unshift(buildCurrentLocationMarker(AMap, currentLocation));
    }
    markerRefs.current = markers;
    if (markers.length > 0) {
      mapRef.current.add(markers as unknown[]);
    }

    const selected = selectedVenueId
      ? points.find((point) => point.venueId === selectedVenueId) || null
      : null;
    const selectedKey = selected ? `selected:${selected.venueId}:${points.length}` : '';
    const fitKey = `fit:${points.length}:${currentLocation ? 'location' : 'map-only'}`;
    const locationKey = currentLocation
      ? `location:${currentLocation.latitude}:${currentLocation.longitude}:${points.length}`
      : '';
    if (focusCenter && focusZoom && focusKey && viewportKeyRef.current !== focusKey) {
      mapRef.current.setZoomAndCenter(focusZoom, focusCenter);
      viewportKeyRef.current = focusKey;
    } else if (selected && viewportKeyRef.current !== selectedKey) {
      mapRef.current.setZoomAndCenter(16, [selected.longitude, selected.latitude]);
      viewportKeyRef.current = selectedKey;
    } else if (points.length === 0 && currentLocation && viewportKeyRef.current !== locationKey) {
      mapRef.current.setZoomAndCenter(13, [currentLocation.longitude, currentLocation.latitude]);
      viewportKeyRef.current = locationKey;
    } else if (!selected && !focusCenter && viewportKeyRef.current !== fitKey) {
      mapRef.current.setFitView(markers as unknown[], false, [72, 72, 72, 72]);
      viewportKeyRef.current = fitKey;
    }
  }, [currentLocation, focusCenter, focusKey, focusZoom, loadState, onSelectVenue, points, selectedVenueId, zoomLevel]);

  return (
    <Surface tone="canvas" elevation="base" className="relative flex min-h-[520px] overflow-hidden border border-[var(--nimi-border-subtle)]">
      <div ref={containerRef} className="relative h-full min-h-[520px] w-full overflow-hidden" />
      {loadState === 'failed' ? (
        <div className="absolute inset-0 flex items-center justify-center bg-[color-mix(in_srgb,var(--nimi-surface-canvas)_88%,transparent)]">
          <div className="rounded-2xl border border-dashed border-[var(--nimi-border-subtle)] bg-white/96 px-6 py-5 text-center text-sm text-[var(--nimi-text-secondary)] shadow-sm">
            高德地图没有加载成功。
            <br />
            请检查 `.env.local` 里的高德前端配置。
          </div>
        </div>
      ) : null}
      {loadState === 'ready' && points.length === 0 ? (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="rounded-2xl border border-dashed border-[var(--nimi-border-subtle)] bg-white/92 px-6 py-5 text-center text-sm text-[var(--nimi-text-secondary)] shadow-sm">
            {currentLocation
              ? '你附近当前还没有已上图的地点。'
              : '当前还没有可上图的地点。'}
            <br />
            {currentLocation
              ? '可以换个范围，或者导入更多视频后再回来看看。'
              : '有解析结果但没坐标的记录会继续保留在列表里。'}
          </div>
        </div>
      ) : null}
      {selectedPoint ? (
        <div className="absolute left-4 bottom-4 max-w-[320px]">
          <div className="rounded-3xl border border-[color-mix(in_srgb,var(--nimi-action-primary-bg)_28%,transparent)] bg-white/96 p-4 shadow-[0_22px_48px_rgba(15,23,42,0.18)] backdrop-blur">
            <div className="flex flex-wrap items-center gap-2">
              <div className="text-base font-semibold text-[var(--nimi-text-primary)]">{selectedPoint.venueName || '未明确店名'}</div>
              {selectedPointDistanceKm != null ? (
                <span className="rounded-full bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_10%,white)] px-2 py-1 text-xs text-[var(--nimi-text-secondary)]">
                  离你约 {formatDistanceLabel(selectedPointDistanceKm)}
                </span>
              ) : null}
            </div>
            <div className="mt-2 text-sm leading-6 text-[var(--nimi-text-secondary)]">{selectedPoint.addressText || '暂时只有坐标，没有更完整地址。'}</div>
            <div className="mt-2 text-xs text-[var(--nimi-text-muted)]">
              坐标 {selectedPoint.longitude.toFixed(5)}, {selectedPoint.latitude.toFixed(5)}
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  setExternalOpenError('');
                  void openExternalUrl(buildAmapNavigationHref(selectedPoint)).catch((error) => {
                    setExternalOpenError(error instanceof Error ? error.message : '外部导航没有打开成功。');
                  });
                }}
                className="rounded-full bg-[var(--nimi-action-primary-bg)] px-3 py-2 text-sm font-medium text-white shadow-[0_12px_24px_rgba(249,115,22,0.22)]"
              >
                打开高德导航
              </button>
              <button
                type="button"
                onClick={() => {
                  setExternalOpenError('');
                  void openExternalUrl(buildAmapMarkerHref(selectedPoint)).catch((error) => {
                    setExternalOpenError(error instanceof Error ? error.message : '外部地图没有打开成功。');
                  });
                }}
                className="rounded-full border border-[var(--nimi-border-subtle)] bg-white px-3 py-2 text-sm font-medium text-[var(--nimi-text-primary)]"
              >
                先看位置
              </button>
            </div>
            {externalOpenError ? (
              <div className="mt-3 text-xs text-[var(--nimi-status-danger)]">{externalOpenError}</div>
            ) : null}
          </div>
        </div>
      ) : null}
      <div className="absolute top-4 right-4 flex flex-col gap-2">
        <Button tone="secondary" size="sm" onClick={() => mapRef.current?.zoomIn()}>放大</Button>
        <Button tone="secondary" size="sm" onClick={() => mapRef.current?.zoomOut()}>缩小</Button>
      </div>
    </Surface>
  );
}
