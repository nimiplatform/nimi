// Wave 1 (step 2) of topic 2026-04-30-avatar-vrm-backend-branch.
//
// Live2D BackendSurface adapter — wraps `Live2DCarrierVisualSurface` so
// the embodiment-stage can mount `backend.surface.Component` directly
// without reaching into Live2D internals or the legacy command bus.
// The wrapper bridges the BackendSurfaceProps lifecycle channels:
//
//   * `onAudioConsumerReady` — fires once per mount with the
//     branch-supplied BackendAudioConsumer so the audio pipeline
//     orchestrator can register it as a sink.
//   * `onHitRegionChange` — fires once on mount with the carrier's
//     current hit-region snapshot (alpha-mask path is wave_4).
//   * `onLifecycleEvidence` — surfaces mount / unmount / load-error
//     evidence so the embodiment-stage can record `avatar.composition`
//     / `avatar.carrier.visual` events without scraping DOM data
//     attributes.
//
// Spec: backend-branch-contract.md §"BackendSurface lifecycle";
//       live2d-render-contract.md §"Backend Frame Loop".

import { useEffect, useRef } from 'react';
import type {
  BackendAudioConsumer,
  BackendHitRegion,
  BackendSurface,
  BackendSurfaceProps,
} from '../carrier/backend-branch.js';
import type { Live2DBackendSession } from './backend-session.js';
import { Live2DCarrierVisualSurface } from './Live2DCarrierVisualSurface.js';

export type Live2DCarrierSurfaceDeps = {
  session: Live2DBackendSession;
  audioConsumer: BackendAudioConsumer;
  hitRegion: BackendHitRegion;
};

export function createLive2DCarrierSurface(
  deps: Live2DCarrierSurfaceDeps,
): BackendSurface {
  const Component = (props: BackendSurfaceProps) => {
    const announcedAudioRef = useRef(false);
    const announcedRegionRef = useRef(false);

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

    useEffect(() => {
      if (announcedRegionRef.current) return;
      announcedRegionRef.current = true;
      props.onHitRegionChange?.(deps.hitRegion);
    }, [props.onHitRegionChange]);

    return <Live2DCarrierVisualSurface session={deps.session} />;
  };
  return { Component };
}
