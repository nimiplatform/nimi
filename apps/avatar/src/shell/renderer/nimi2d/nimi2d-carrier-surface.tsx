import { useEffect, useRef, useState } from 'react';
import type {
  BackendAudioConsumer,
  BackendHitRegion,
  BackendSurface,
  BackendSurfaceProps,
} from '../carrier/backend-branch.js';
import type {
  Nimi2DComposer,
  Nimi2DComposerSnapshot,
  Nimi2DRenderPlan,
} from '@nimiplatform/nimi2d/runtime';
import {
  createNimi2DPixiRenderer,
  type Nimi2DPixiRendererHandle,
} from './nimi2d-pixi-renderer.js';
import {
  createNimi2DAlphaHitProbe,
  type Nimi2DAlphaHitProbe,
} from './nimi2d-carrier-visual-proof.js';

export type Nimi2DCarrierSurfaceInput = {
  loadedPackage: Nimi2DRenderPlan;
  composer: Nimi2DComposer;
  audioConsumer: BackendAudioConsumer;
};

type Nimi2DHitRect = BackendHitRegion['body'];

const UNIT_HIT_RECT: Nimi2DHitRect = { left: 0, top: 0, right: 1, bottom: 1 };

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function visibleCanvasRect(layer: Nimi2DRenderPlan['renderLayers'][number]): {
  left: number;
  top: number;
  right: number;
  bottom: number;
} | null {
  const placement = layer.placementPx;
  const texture = layer.textureBoundsPx;
  const visible = layer.visibleBoundsPx;
  const values = [
    placement.x,
    placement.y,
    texture.x,
    texture.y,
    texture.width,
    texture.height,
    visible.x,
    visible.y,
    visible.width,
    visible.height,
  ];
  if (values.some((value) => !Number.isFinite(value))) return null;
  if (texture.width <= 0 || texture.height <= 0 || visible.width <= 0 || visible.height <= 0) {
    return null;
  }
  const left = placement.x + (visible.x - texture.x);
  const top = placement.y + (visible.y - texture.y);
  return {
    left,
    top,
    right: left + visible.width,
    bottom: top + visible.height,
  };
}

export function createNimi2DPackageHitRect(renderPlan: Nimi2DRenderPlan): Nimi2DHitRect {
  const sourceWidth = Math.max(1, renderPlan.sourceCanvas.width);
  const sourceHeight = Math.max(1, renderPlan.sourceCanvas.height);
  let union: { left: number; top: number; right: number; bottom: number } | null = null;
  for (const layer of renderPlan.renderLayers) {
    const rect = visibleCanvasRect(layer);
    if (!rect) continue;
    union = union
      ? {
        left: Math.min(union.left, rect.left),
        top: Math.min(union.top, rect.top),
        right: Math.max(union.right, rect.right),
        bottom: Math.max(union.bottom, rect.bottom),
      }
      : rect;
  }
  if (!union || union.right <= union.left || union.bottom <= union.top) {
    return UNIT_HIT_RECT;
  }
  const normalized = {
    left: clamp01(union.left / sourceWidth),
    top: clamp01(union.top / sourceHeight),
    right: clamp01(union.right / sourceWidth),
    bottom: clamp01(union.bottom / sourceHeight),
  };
  if (normalized.right <= normalized.left || normalized.bottom <= normalized.top) {
    return UNIT_HIT_RECT;
  }
  return normalized;
}

function createNimi2DHitRegion(
  getAlphaProbe: () => Nimi2DAlphaHitProbe | null,
  bodyRect: Nimi2DHitRect,
): BackendHitRegion {
  return {
    body: bodyRect,
    drag: bodyRect,
    isOpaqueAtClientPoint(clientX, clientY, threshold) {
      return getAlphaProbe()?.isOpaqueAtClientPoint(clientX, clientY, threshold) ?? null;
    },
  };
}

function describeError(error: unknown): string {
  return error instanceof Error && error.message.trim()
    ? error.message.trim()
    : String(error || 'Nimi2D carrier surface failed');
}

function requestFrame(callback: () => void): number {
  if (typeof window.requestAnimationFrame === 'function') {
    return window.requestAnimationFrame(callback);
  }
  return window.setTimeout(callback, 16);
}

function cancelFrame(frame: number): void {
  if (typeof window.cancelAnimationFrame === 'function') {
    window.cancelAnimationFrame(frame);
    return;
  }
  window.clearTimeout(frame);
}

function nowMs(): number {
  if (typeof window.performance?.now === 'function') {
    return window.performance.now();
  }
  return Date.now();
}

function frameDeltaMs(currentMs: number, previousMs: number): number {
  const delta = currentMs - previousMs;
  if (!Number.isFinite(delta) || delta <= 0) return 16;
  return Math.min(100, delta);
}

export function createNimi2DCarrierSurface(input: Nimi2DCarrierSurfaceInput): BackendSurface {
  const packageHitRect = createNimi2DPackageHitRect(input.loadedPackage);
  const Component = (props: BackendSurfaceProps) => {
    const hostRef = useRef<HTMLDivElement | null>(null);
    const pixiHostRef = useRef<HTMLDivElement | null>(null);
    const pixiRendererRef = useRef<Nimi2DPixiRendererHandle | null>(null);
    const alphaProbeRef = useRef<Nimi2DAlphaHitProbe | null>(null);
    const audioAnnouncedRef = useRef(false);
    const hitRegionAnnouncedRef = useRef(false);
    const [snapshot, setSnapshot] = useState<Nimi2DComposerSnapshot>(() => input.composer.snapshot());
    const [rendererStatus, setRendererStatus] = useState<'loading' | 'ready' | 'failed'>('loading');
    const [layerRefs, setLayerRefs] = useState<string[]>([]);

    useEffect(() => input.composer.subscribe(setSnapshot), []);

    useEffect(() => {
      const pixiHost = pixiHostRef.current;
      if (!pixiHost) return undefined;
      let disposed = false;
      setRendererStatus('loading');
      setLayerRefs([]);
      void createNimi2DPixiRenderer({
        host: pixiHost,
        renderPlan: input.loadedPackage,
        initialSnapshot: input.composer.snapshot(),
        width: props.width,
        height: props.height,
        onReady(ready) {
          if (disposed) return;
          setLayerRefs(ready.layerRefs);
          setRendererStatus('ready');
        },
      }).then((renderer) => {
        if (disposed) {
          renderer.destroy();
          return;
        }
        pixiRendererRef.current = renderer;
        renderer.updateSnapshot(input.composer.snapshot());
      }).catch((error: unknown) => {
        if (disposed) return;
        pixiRendererRef.current = null;
        setRendererStatus('failed');
        console.warn(`[avatar:nimi2d] Pixi renderer failed: ${describeError(error)}`);
      });
      return () => {
        disposed = true;
        pixiRendererRef.current?.destroy();
        pixiRendererRef.current = null;
      };
    }, []);

    useEffect(() => {
      pixiRendererRef.current?.updateSnapshot(snapshot);
    }, [snapshot]);

    useEffect(() => {
      pixiRendererRef.current?.resize(props.width, props.height);
    }, [props.width, props.height]);

    useEffect(() => {
      if (audioAnnouncedRef.current) return;
      audioAnnouncedRef.current = true;
      props.onAudioConsumerReady?.(input.audioConsumer);
    }, [props.onAudioConsumerReady]);

    useEffect(() => {
      if (hitRegionAnnouncedRef.current) return;
      hitRegionAnnouncedRef.current = true;
      props.onHitRegionChange?.(createNimi2DHitRegion(() => alphaProbeRef.current, packageHitRect));
    }, [props.onHitRegionChange]);

    useEffect(() => {
      let cancelled = false;
      alphaProbeRef.current = null;
      void createNimi2DAlphaHitProbe({
        renderPlan: input.loadedPackage,
        viewport: () => {
          const host = hostRef.current;
          if (!host) return null;
          const rect = host.getBoundingClientRect();
          if (rect.width <= 0 || rect.height <= 0) return null;
          return {
            left: rect.left,
            top: rect.top,
            width: rect.width,
            height: rect.height,
          };
        },
      }).then((probe) => {
        if (cancelled) return;
        alphaProbeRef.current = probe;
      }).catch((error: unknown) => {
        if (cancelled) return;
        alphaProbeRef.current = null;
        console.warn(`[avatar:nimi2d] alpha hit-region probe unavailable: ${describeError(error)}`);
      });
      return () => {
        cancelled = true;
        alphaProbeRef.current = null;
      };
    }, []);

    useEffect(() => {
      let cancelled = false;
      let frame = 0;
      let previousMs = nowMs();
      const tick = () => {
        if (cancelled) return;
        const currentMs = nowMs();
        const deltaMs = frameDeltaMs(currentMs, previousMs);
        previousMs = currentMs;
        input.composer.setMouthOpen(input.audioConsumer.snapshot()?.volume ?? 0);
        pixiRendererRef.current?.updateSnapshot(input.composer.advanceFrame(deltaMs));
        frame = requestFrame(tick);
      };
      frame = requestFrame(tick);
      return () => {
        cancelled = true;
        cancelFrame(frame);
      };
    }, []);

    const aspectRatio = `${input.loadedPackage.canvas.width} / ${input.loadedPackage.canvas.height}`;

    return (
      <div
        ref={hostRef}
        data-testid="avatar-nimi2d-carrier"
        data-nimi2d-activity={snapshot.activity}
        data-nimi2d-emotion={snapshot.emotion}
        data-nimi2d-expression={snapshot.expression}
        data-nimi2d-motion={snapshot.motion}
        data-nimi2d-motion-queue-length={snapshot.motionQueueLength}
        data-nimi2d-motion-completed-count={snapshot.motionCompletedCount}
        data-nimi2d-motion-interrupted-count={snapshot.motionInterruptedCount}
        data-nimi2d-mouth-open={snapshot.mouthOpen.toFixed(3)}
        data-nimi2d-renderer="pixi.js"
        data-nimi2d-renderer-status={rendererStatus}
        data-nimi2d-layer-refs={layerRefs.join(',')}
        style={{
          position: 'relative',
          width: '100%',
          height: '100%',
          aspectRatio,
          overflow: 'hidden',
          contain: 'layout paint size',
        }}
      >
        <div
          ref={pixiHostRef}
          data-testid="avatar-nimi2d-pixi-host"
          style={{
            position: 'absolute',
            inset: 0,
            overflow: 'hidden',
            pointerEvents: 'none',
          }}
        />
      </div>
    );
  };

  return { Component };
}
