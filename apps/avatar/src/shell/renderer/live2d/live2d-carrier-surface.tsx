// Authority: .nimi/spec/avatar/embodiment-surface.authority.yaml.
//
// Live2D BackendSurface adapter — wraps `Live2DCarrierVisualSurface` so
// the embodiment-stage can mount `backend.surface.Component` directly
// without reaching into Live2D internals or the cue-level command bus.
// The wrapper bridges BackendSurfaceProps resource channels:
//
//   * `onAudioConsumerReady` — fires once per mount with the
//     branch-supplied BackendAudioConsumer so the audio pipeline
//     orchestrator can register it as a sink.
//   * `onHitRegionChange` — wires the alpha-mask probe
//     via `createLive2DHitRegion` (canvas-bound construction — needs the
//     mounted cubism canvas to read pixels from). On tier C, fires the
//     bbox-only fallback exactly once.
//
// Authority: rule.nimi.avatar.embodiment.r004 and r041.

import { useEffect, useRef } from 'react';
import type { BackendAudioConsumer } from '@nimiplatform/kit/features/avatar/headless';
import type {
  BackendSurface,
  BackendSurfaceProps,
} from '../carrier/backend-branch.js';
import { createLive2DHitRegion } from '@nimiplatform/kit/features/avatar/headless';
import type { Live2DBackendSession } from './backend-session.js';
import { Live2DCarrierVisualSurface } from './Live2DCarrierVisualSurface.js';
import { getCachedDeviceTier } from '../app-shell/device-tier-detector.js';

export type Live2DCarrierSurfaceDeps = {
  session: Live2DBackendSession;
  audioConsumer: BackendAudioConsumer;
  paramMouthFormSupported: boolean;
};

export function createLive2DCarrierSurface(
  deps: Live2DCarrierSurfaceDeps,
): BackendSurface {
  const Component = (props: BackendSurfaceProps) => {
    const announcedAudioRef = useRef(false);
    const announcedRegionRef = useRef(false);
    const hostRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
      if (announcedAudioRef.current) return;
      announcedAudioRef.current = true;
      props.onAudioConsumerReady?.(deps.audioConsumer);
    }, [props.onAudioConsumerReady]);

    // Build the hit-region with alpha-mask path on
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
          console.warn(`[avatar:live2d] hit-region degraded: ${detail.reason_code}`);
        },
      });
      props.onHitRegionChange?.(hitRegion);
    }, [props.onHitRegionChange]);

    return (
      <div ref={hostRef} style={{ width: '100%', height: '100%' }}>
        <Live2DCarrierVisualSurface
          session={deps.session}
          audioConsumer={deps.audioConsumer}
          paramMouthFormSupported={deps.paramMouthFormSupported}
        />
      </div>
    );
  };
  return { Component };
}
