import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Surface } from '@nimiplatform/nimi-kit/ui';
import type { MapPoint } from '@renderer/data/types.js';

const TILE_SIZE = 256;
const MIN_ZOOM = 3;
const MAX_ZOOM = 17;
const DEFAULT_CENTER = { latitude: 35.8617, longitude: 104.1954 };
const TILE_SERVER = 'https://tile.openstreetmap.org';

type MapSurfaceProps = {
  points: MapPoint[];
  selectedVenueId: string | null;
  onSelectVenue: (venueId: string) => void;
};

type Viewport = {
  centerLat: number;
  centerLon: number;
  zoom: number;
};

type Size = {
  width: number;
  height: number;
};

type WorldPoint = {
  x: number;
  y: number;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function project(latitude: number, longitude: number, zoom: number): WorldPoint {
  const scale = TILE_SIZE * (2 ** zoom);
  const lat = clamp(latitude, -85.05112878, 85.05112878);
  const sin = Math.sin((lat * Math.PI) / 180);
  return {
    x: ((longitude + 180) / 360) * scale,
    y: (0.5 - (Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI))) * scale,
  };
}

function unproject(point: WorldPoint, zoom: number): { latitude: number; longitude: number } {
  const scale = TILE_SIZE * (2 ** zoom);
  const longitude = (point.x / scale) * 360 - 180;
  const n = Math.PI - (2 * Math.PI * point.y) / scale;
  const latitude = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
  return { latitude, longitude };
}

function resolveInitialViewport(points: MapPoint[]): Viewport {
  if (points.length === 0) {
    return {
      centerLat: DEFAULT_CENTER.latitude,
      centerLon: DEFAULT_CENTER.longitude,
      zoom: 4,
    };
  }

  const latitudes = points.map((point) => point.latitude);
  const longitudes = points.map((point) => point.longitude);
  return {
    centerLat: latitudes.reduce((sum, value) => sum + value, 0) / latitudes.length,
    centerLon: longitudes.reduce((sum, value) => sum + value, 0) / longitudes.length,
    zoom: points.length === 1 ? 13 : 10,
  };
}

function useContainerSize() {
  const ref = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });

  useEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === 'undefined') {
      return;
    }
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) {
        return;
      }
      const nextWidth = Math.round(entry.contentRect.width);
      const nextHeight = Math.round(entry.contentRect.height);
      setSize({ width: nextWidth, height: nextHeight });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return { ref, size };
}

export function MapSurface({ points, selectedVenueId, onSelectVenue }: MapSurfaceProps) {
  const { ref, size } = useContainerSize();
  const [viewport, setViewport] = useState<Viewport>(() => resolveInitialViewport(points));
  const dragStateRef = useRef<{ pointerId: number; startX: number; startY: number; center: WorldPoint } | null>(null);
  const manualMoveRef = useRef(false);

  useEffect(() => {
    if (manualMoveRef.current) {
      return;
    }
    setViewport(resolveInitialViewport(points));
  }, [points]);

  useEffect(() => {
    if (!selectedVenueId) {
      return;
    }
    const target = points.find((point) => point.venueId === selectedVenueId);
    if (!target) {
      return;
    }
    setViewport((current) => ({
      ...current,
      centerLat: target.latitude,
      centerLon: target.longitude,
      zoom: Math.max(current.zoom, 13),
    }));
  }, [points, selectedVenueId]);

  const centerWorld = useMemo(
    () => project(viewport.centerLat, viewport.centerLon, viewport.zoom),
    [viewport.centerLat, viewport.centerLon, viewport.zoom],
  );

  const tiles = useMemo(() => {
    if (size.width === 0 || size.height === 0) {
      return [];
    }
    const count = 2 ** viewport.zoom;
    const minTileX = Math.floor((centerWorld.x - size.width / 2) / TILE_SIZE);
    const maxTileX = Math.floor((centerWorld.x + size.width / 2) / TILE_SIZE);
    const minTileY = Math.floor((centerWorld.y - size.height / 2) / TILE_SIZE);
    const maxTileY = Math.floor((centerWorld.y + size.height / 2) / TILE_SIZE);
    const result: Array<{ key: string; left: number; top: number; url: string }> = [];

    for (let tileX = minTileX; tileX <= maxTileX; tileX += 1) {
      for (let tileY = minTileY; tileY <= maxTileY; tileY += 1) {
        if (tileY < 0 || tileY >= count) {
          continue;
        }
        const wrappedX = ((tileX % count) + count) % count;
        const left = tileX * TILE_SIZE - (centerWorld.x - size.width / 2);
        const top = tileY * TILE_SIZE - (centerWorld.y - size.height / 2);
        result.push({
          key: `${viewport.zoom}-${tileX}-${tileY}`,
          left,
          top,
          url: `${TILE_SERVER}/${viewport.zoom}/${wrappedX}/${tileY}.png`,
        });
      }
    }
    return result;
  }, [centerWorld.x, centerWorld.y, size.height, size.width, viewport.zoom]);

  const markers = useMemo(() => {
    if (size.width === 0 || size.height === 0) {
      return [];
    }
    return points.map((point) => {
      const world = project(point.latitude, point.longitude, viewport.zoom);
      return {
        ...point,
        left: world.x - centerWorld.x + size.width / 2,
        top: world.y - centerWorld.y + size.height / 2,
      };
    });
  }, [centerWorld.x, centerWorld.y, points, size.height, size.width, viewport.zoom]);

  const beginDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    manualMoveRef.current = true;
    dragStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      center: centerWorld,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const continueDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }
    const nextWorld = {
      x: dragState.center.x - (event.clientX - dragState.startX),
      y: dragState.center.y - (event.clientY - dragState.startY),
    };
    const next = unproject(nextWorld, viewport.zoom);
    setViewport((current) => ({
      ...current,
      centerLat: next.latitude,
      centerLon: next.longitude,
    }));
  };

  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragStateRef.current?.pointerId === event.pointerId) {
      dragStateRef.current = null;
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const changeZoom = (delta: number) => {
    manualMoveRef.current = true;
    setViewport((current) => ({
      ...current,
      zoom: clamp(current.zoom + delta, MIN_ZOOM, MAX_ZOOM),
    }));
  };

  return (
    <Surface tone="canvas" elevation="base" className="relative flex min-h-[520px] overflow-hidden border border-[var(--nimi-border-subtle)]">
      <div
        ref={ref}
        className="vfm-map-grid relative h-full min-h-[520px] w-full touch-none overflow-hidden"
        onPointerDown={beginDrag}
        onPointerMove={continueDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        {tiles.map((tile) => (
          <img
            key={tile.key}
            src={tile.url}
            alt=""
            draggable={false}
            className="absolute h-64 w-64 select-none"
            style={{ left: tile.left, top: tile.top }}
          />
        ))}
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(255,255,255,0)_50%,rgba(17,24,39,0.16)_100%)]" />
        {markers.map((point) => {
          const active = point.venueId === selectedVenueId;
          return (
            <button
              key={point.venueId}
              type="button"
              onClick={() => onSelectVenue(point.venueId)}
              className={`absolute h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-lg transition ${
                active ? 'bg-[var(--nimi-action-primary-bg)] scale-125' : 'bg-[#ef4444] hover:scale-110'
              }`}
              style={{ left: point.left, top: point.top }}
              title={`${point.venueName} · ${point.creatorName}`}
            />
          );
        })}
        {points.length === 0 ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="rounded-2xl border border-dashed border-[var(--nimi-border-subtle)] bg-[color-mix(in_srgb,var(--nimi-surface-panel)_82%,transparent)] px-6 py-5 text-center text-sm text-[var(--nimi-text-secondary)] backdrop-blur">
              当前还没有可上图的地点。
              <br />
              有解析结果但没坐标的记录会继续保留在列表里。
            </div>
          </div>
        ) : null}
      </div>
      <div className="absolute top-4 right-4 flex flex-col gap-2">
        <Button tone="secondary" size="sm" onClick={() => changeZoom(1)}>放大</Button>
        <Button tone="secondary" size="sm" onClick={() => changeZoom(-1)}>缩小</Button>
      </div>
    </Surface>
  );
}
