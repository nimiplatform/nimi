// Wave 1 (step 2) + Wave 4 chunk 4-C of topic 2026-04-30-avatar-vrm-backend-branch.
//
// Live2D BackendSurface adapter — wraps `Live2DCarrierVisualSurface` so
// the embodiment-stage can mount `backend.surface.Component` directly
// without reaching into Live2D internals or the cue-level command bus.
// The wrapper bridges the BackendSurfaceProps lifecycle channels:
//
//   * `onAudioConsumerReady` — fires once per mount with the
//     branch-supplied BackendAudioConsumer so the audio pipeline
//     orchestrator can register it as a sink.
//   * `onHitRegionChange` — wave_4 chunk 4-C wires the alpha-mask probe
//     via `createLive2DHitRegion` (canvas-bound construction — needs the
//     mounted cubism canvas to read pixels from). On tier C, fires the
//     bbox-only fallback exactly once and `onLifecycleEvidence` carries
//     the degradation reason upstream.
//   * `onLifecycleEvidence` — surfaces mount / unmount / load-error /
//     hit_region_degraded evidence so the embodiment-stage can record
//     events without scraping DOM data attributes.
//
// Spec: backend-branch-contract.md §"BackendSurface lifecycle";
//       app-shell-contract.md §2.3.1; live2d-render-contract.md
//       §"Hit Testing".

import { useEffect, useRef } from 'react';
import type {
  BackendAudioConsumer,
  BackendSurface,
  BackendSurfaceProps,
} from '@nimiplatform/kit/features/avatar/headless';
import { createLive2DHitRegion } from '@nimiplatform/kit/features/avatar/headless';
import type { Live2DBackendSession } from './backend-session.js';
import { Live2DCarrierVisualSurface } from './Live2DCarrierVisualSurface.js';
import { getCachedDeviceTier } from '../app-shell/device-tier-detector.js';

export type Live2DCarrierSurfaceDeps = {
  session: Live2DBackendSession;
  audioConsumer: BackendAudioConsumer;
};

export function createLive2DCarrierSurface(
  deps: Live2DCarrierSurfaceDeps,
): BackendSurface {
  const Component = (props: BackendSurfaceProps) => {
    const announcedAudioRef = useRef(false);
    const announcedRegionRef = useRef(false);
    const hostRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
      props.onLifecycleEvidence?.('mounted', {
        source: 'live2d-carrier-surface',
        embodied: props.embodied,
        width: props.width,
        height: props.height,
      });
      return () => {
        props.onLifecycleEvidence?.('unmounted', {
          source: 'live2d-carrier-surface',
        });
      };
    }, [props.embodied, props.height, props.onLifecycleEvidence, props.width]);

    useEffect(() => {
      if (announcedAudioRef.current) return;
      announcedAudioRef.current = true;
      props.onAudioConsumerReady?.(deps.audioConsumer);
    }, [props.onAudioConsumerReady]);

    // Wave 4 chunk 4-C: build the hit-region with alpha-mask path on
    // tier A/B, bbox-only on tier C. The cubism canvas is created
    // lazily by Live2DCarrierVisualSurface inside `hostRef`; we read
    // it through a closure each probe instead of capturing a stale
    // reference.
    useEffect(() => {
      if (announcedRegionRef.current) return;
      announcedRegionRef.current = true;
      const hitRegion = createLive2DHitRegion({
        getCanvas: () => {
          const host = hostRef.current;
          if (!host) return null;
          return host.querySelector<HTMLCanvasElement>(
            'canvas.avatar-live2d-carrier__canvas',
          );
        },
        getViewport: () => {
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
        deviceTier: getCachedDeviceTier()?.tier ?? 'C',
        onDegraded: (detail) => {
          props.onLifecycleEvidence?.('hit_region_degraded', {
            source: 'live2d-carrier-surface',
            reason_code: detail.reason_code,
            recorded_at: detail.recordedAt,
          });
        },
      });
      props.onHitRegionChange?.(hitRegion);
    }, [props.onHitRegionChange, props.onLifecycleEvidence]);

    return (
      <div ref={hostRef} style={{ width: '100%', height: '100%' }}>
        <Live2DCarrierVisualSurface session={deps.session} />
      </div>
    );
  };
  return { Component };
}
