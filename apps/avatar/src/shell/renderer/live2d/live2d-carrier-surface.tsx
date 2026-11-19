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
import type { Live2DBackendSession } from './backend-session.js';
import { Live2DCarrierVisualSurface } from './Live2DCarrierVisualSurface.js';

export type Live2DCarrierSurfaceDeps = {
  session: Live2DBackendSession;
  audioConsumer: BackendAudioConsumer;
  paramMouthFormSupported: boolean;
  onHitRegionPublished?: () => void;
};

export function createLive2DCarrierSurface(
  deps: Live2DCarrierSurfaceDeps,
): BackendSurface {
  const Component = (props: BackendSurfaceProps) => {
    const announcedAudioRef = useRef(false);
    useEffect(() => {
      if (announcedAudioRef.current || !props.onAudioConsumerReady) return;
      announcedAudioRef.current = true;
      props.onAudioConsumerReady(deps.audioConsumer);
    }, [props.onAudioConsumerReady]);

    return (
      <div style={{ width: '100%', height: '100%' }}>
        <Live2DCarrierVisualSurface
          session={deps.session}
          audioConsumer={deps.audioConsumer}
          paramMouthFormSupported={deps.paramMouthFormSupported}
          reducedMotion={props.reducedMotion}
          onHitRegionChange={props.onHitRegionChange}
          onHitRegionPublished={deps.onHitRegionPublished}
          onPresentationStateChange={props.onPresentationStateChange}
          onPresentationRestart={props.onPresentationRestart}
        />
      </div>
    );
  };
  return { Component };
}
