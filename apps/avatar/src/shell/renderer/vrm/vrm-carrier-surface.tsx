// Wave 2 chunk 2-C of topic 2026-04-30-avatar-vrm-backend-branch.
//
// VRM BackendBranch surface — replaces the wave_1 step_5 dev-preview
// placeholder. Mounts an @react-three/fiber <Canvas>, drives the lifecycle
// via VrmRuntime (vrm-runtime.ts), and forwards lifecycle evidence /
// audio-consumer / hit-region back to embodiment-stage via the
// BackendSurfaceProps callbacks.
//
// Wiring rules (vrm-backend-contract.md §2.3 + AGENTS.md "VRM Backend
// Pitfalls"):
//
//   * webglcontextlost  → runtime.notifyContextLost()    (preventDefault
//                          to allow Three.js to re-acquire the context)
//   * webglcontextrestored → runtime.notifyContextRestored()
//   * onAudioConsumerReady fires EXACTLY ONCE per surface lifecycle;
//     guarded by a useRef to prevent double-registration of the sink
//   * onHitRegionChange fires once with the full-viewport bbox; alpha-mask
//     hit-test is deferred to wave_4 (isOpaqueAtClientPoint = null)
//   * fail-close (load_failed / context_lost_recovery_failed /
//     context_lost_twice / no_webgl) renders null; embodiment-stage
//     surfaces its degraded layer above
//
// Audio consumer is constructed by the BackendBranch factory (chunk 2-D
// owns the real implementation; wave_2 carries the existing stub) and
// passed in. The surface itself does not register the consumer with the
// audio pipeline — it only forwards the reference via onAudioConsumerReady.

import { Canvas } from '@react-three/fiber';
import { Component as ReactComponent } from 'react';
import type { ComponentType, ReactNode } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  BackendAudioConsumer,
  BackendSurfaceProps,
} from '../carrier/backend-branch.js';
import type { VrmAvatarModelManifest } from '../carrier/model-resolver.js';
import {
  attachVrmDiagnostics,
  updateVrmDiagnosticsFrameStats,
} from './vrm-diagnostics.js';
import { applyVrmFraming } from './vrm-framing.js';
import {
  createVrmRuntime,
  type VrmLifecycleState,
  type VrmRuntime,
  type VrmRuntimeOptions,
} from './vrm-runtime.js';
import { VrmScene } from './vrm-scene.js';

export type VrmCarrierSurfaceInput = {
  manifest: VrmAvatarModelManifest;
  audioConsumer: BackendAudioConsumer;
  /** Test seam forwarded to createVrmRuntime — keeps unit tests fast and
   *  deterministic without spinning up real Three.js / WebGL. */
  runtimeOptions?: Pick<
    VrmRuntimeOptions,
    'loaderOverride' | 'setTimeoutFn' | 'clearTimeoutFn' | 'nowFn'
  >;
};

export type VrmCarrierSurfaceHandle = {
  Component: ComponentType<BackendSurfaceProps>;
  shutdown(): void;
};

export function createVrmCarrierSurface(
  input: VrmCarrierSurfaceInput,
): VrmCarrierSurfaceHandle {
  // Each call mints a fresh runtime; createVrmBackendBranch invokes this
  // once per backend instantiation, and the React Component captures the
  // runtime reference via closure rather than constructing per-mount.
  // shutdown() on the handle is wired through the BackendBranch.shutdown()
  // path (vrm-backend.ts) so embodiment-stage can free resources on swap.
  let runtimeRef: VrmRuntime | null = null;

  const Component: ComponentType<BackendSurfaceProps> = (props) => {
    const audioAnnouncedRef = useRef(false);
    const regionAnnouncedRef = useRef(false);
    const canvasContainerRef = useRef<HTMLDivElement | null>(null);
    const [state, setState] = useState<VrmLifecycleState>({ kind: 'idle' });
    const [canvasError, setCanvasError] = useState(false);

    // Construct runtime + start it on mount; tear down on unmount.
    useEffect(() => {
      const runtime = createVrmRuntime({
        manifest: input.manifest,
        onEvidence: (kind, detail) => {
          props.onLifecycleEvidence?.(kind, detail);
        },
        ...input.runtimeOptions,
      });
      runtimeRef = runtime;
      const detachDiagnostics = attachVrmDiagnostics(runtime);
      const unsubscribe = runtime.subscribe((next) => setState(next));
      props.onLifecycleEvidence?.('load_started', {
        source: 'vrm-carrier-surface',
        vrm_file: input.manifest.vrm.vrmFile,
      });
      void runtime.start();
      return () => {
        unsubscribe();
        detachDiagnostics();
        runtime.shutdown();
        runtimeRef = null;
      };
    }, []);

    // Once the surface reaches `ready` for the first time, announce the
    // audio consumer and the hit region. Both are guarded by refs so a
    // bounce through context_lost → ready does not re-announce.
    useEffect(() => {
      if (state.kind !== 'ready') return;
      if (!audioAnnouncedRef.current) {
        audioAnnouncedRef.current = true;
        props.onAudioConsumerReady?.(input.audioConsumer);
      }
      if (!regionAnnouncedRef.current) {
        regionAnnouncedRef.current = true;
        props.onHitRegionChange?.({
          body: { left: 0, top: 0, right: 1, bottom: 1 },
          drag: { left: 0, top: 0, right: 1, bottom: 1 },
          // Alpha-mask hit-test is deferred to wave_4. `null` signals
          // bbox-only (carrier abstraction supports both paths).
          isOpaqueAtClientPoint: null,
        });
      }
    }, [state.kind, props.onAudioConsumerReady, props.onHitRegionChange]);

    // Wire webglcontextlost / restored once the canvas DOM mounts.
    useEffect(() => {
      const container = canvasContainerRef.current;
      if (!container) return;
      const canvas = container.querySelector('canvas');
      if (!canvas) return;
      const onLost = (event: Event) => {
        event.preventDefault();
        runtimeRef?.notifyContextLost();
      };
      const onRestored = () => {
        runtimeRef?.notifyContextRestored();
      };
      canvas.addEventListener('webglcontextlost', onLost as EventListener);
      canvas.addEventListener('webglcontextrestored', onRestored as EventListener);
      return () => {
        canvas.removeEventListener('webglcontextlost', onLost as EventListener);
        canvas.removeEventListener('webglcontextrestored', onRestored as EventListener);
      };
    }, [canvasError, state.kind]);

    const vrm = state.kind === 'ready' || state.kind === 'context_lost' ? state.vrm : null;

    // Wave 2 chunk 2-E: derive camera framing from the loaded VRM scene
    // bbox + the bottom-companion default (vrm-backend-contract.md §4).
    // The result is fed into <Canvas camera={...}>; recomputed only when
    // the VRM identity, viewport width, or viewport height changes.
    // Hook MUST sit above the early-return so the call order stays
    // stable across `failed_closed` / canvas error transitions.
    const cameraProps = useMemo(() => {
      if (!vrm) return undefined;
      const aspect = props.height > 0 ? props.width / props.height : 0.45;
      try {
        const framing = applyVrmFraming({ vrm, intent: 'bottom-companion', aspect });
        // Surface the framed dims to the diagnostics global (best-effort).
        updateVrmDiagnosticsFrameStats({
          framedHeight: framing.framedHeight,
          framedWidth: framing.framedWidth,
        });
        return {
          fov: framing.cameraFov,
          position: [
            framing.cameraPosition.x,
            framing.cameraPosition.y,
            framing.cameraPosition.z,
          ] as [number, number, number],
          near: 0.1,
          far: 100,
        };
      } catch {
        // Defensive: a degenerate scene falls back to R3F default camera
        // — frame stats stay at their prior value so diagnostics doesn't
        // regress on a transient compute error.
        return undefined;
      }
    }, [vrm, props.width, props.height]);

    if (state.kind === 'failed_closed' || canvasError) {
      return null;
    }

    return (
      <div
        ref={canvasContainerRef}
        data-testid="avatar-vrm-carrier"
        data-avatar-vrm-state={state.kind}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          pointerEvents: 'none',
        }}
      >
        <SafeCanvas
          cameraProps={cameraProps}
          onMountError={() => {
            setCanvasError(true);
            props.onLifecycleEvidence?.('failed_closed', { reason: 'no_webgl' });
          }}
        >
          <VrmScene vrm={vrm} />
        </SafeCanvas>
      </div>
    );
  };

  return {
    Component,
    shutdown(): void {
      runtimeRef?.shutdown();
      runtimeRef = null;
    },
  };
}

// React error boundary — function components cannot trap render-phase
// errors thrown by <Canvas> when the host has no WebGL (jsdom / SSR).
// On error we render null and notify the parent to emit failed_closed.
type SafeCanvasCameraProps = {
  fov: number;
  position: [number, number, number];
  near: number;
  far: number;
};

type SafeCanvasProps = {
  onMountError: () => void;
  children: ReactNode;
  cameraProps: SafeCanvasCameraProps | undefined;
};

class SafeCanvas extends ReactComponent<SafeCanvasProps, { errored: boolean }> {
  override state = { errored: false };

  static getDerivedStateFromError(): { errored: boolean } {
    return { errored: true };
  }

  override componentDidCatch(): void {
    this.props.onMountError();
  }

  override render(): ReactNode {
    if (this.state.errored) return null;
    if (this.props.cameraProps) {
      return <Canvas camera={this.props.cameraProps}>{this.props.children}</Canvas>;
    }
    return <Canvas>{this.props.children}</Canvas>;
  }
}
