import { useEffect, useRef, useState } from 'react';
import { Button, Surface } from '@nimiplatform/nimi-kit/ui';
import type { MapPoint } from '@renderer/data/types.js';

type MapSurfaceProps = {
  points: MapPoint[];
  selectedVenueId: string | null;
  onSelectVenue: (venueId: string) => void;
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
  destroy: () => void;
};

type AMapMarker = {
  on: (eventName: string, handler: () => void) => void;
  setLabel?: (value: Record<string, unknown>) => void;
  setMap?: (map: AMapMap | null) => void;
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

function buildMarker(AMap: AMapInstance, point: MapPoint, active: boolean, onSelectVenue: (venueId: string) => void): AMapMarker {
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

export function MapSurface({ points, selectedVenueId, onSelectVenue }: MapSurfaceProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<AMapMap | null>(null);
  const markerRefs = useRef<AMapMarker[]>([]);
  const [loadState, setLoadState] = useState<'idle' | 'ready' | 'failed'>('idle');

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
        mapRef.current = map;
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

    if (points.length === 0) {
      mapRef.current.clearMap();
      mapRef.current.setZoomAndCenter(4, DEFAULT_CENTER);
      return;
    }

    const markers = points.map((point) =>
      buildMarker(AMap, point, point.venueId === selectedVenueId, onSelectVenue),
    );
    markerRefs.current = markers;
    mapRef.current.add(markers as unknown[]);

    const selected = selectedVenueId
      ? points.find((point) => point.venueId === selectedVenueId) || null
      : null;
    if (selected) {
      mapRef.current.setZoomAndCenter(16, [selected.longitude, selected.latitude]);
    } else {
      mapRef.current.setFitView(markers as unknown[], false, [72, 72, 72, 72]);
    }
  }, [loadState, onSelectVenue, points, selectedVenueId]);

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
            当前还没有可上图的地点。
            <br />
            有解析结果但没坐标的记录会继续保留在列表里。
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
