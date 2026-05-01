// Wave 3 chunk 3-D of topic 2026-04-30-avatar-vrm-backend-branch.
//
// VRM BackendBranch surface — extends the wave_2 chunk 2-C scaffolding
// with the chunk 3-D integration: emote state, generated motion runtime,
// lipsync driver, and projection adapter are all wired through the
// surface useFrame loop.
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
// Adapter construction + generated motion runtime attachment happen in a
// one-shot effect keyed on the loaded VRM identity. Physical .vrma preset
// loading is not part of the runtime APML support proof path.
//
// useFrame chain (per frame, inside <Canvas>):
//   1. lipsyncDriver.tick({vrm, deltaSec, lipsyncSnapshot})
//   2. emoteState.setLipsyncActive(lipResult.active)
//   3. emoteState.tick({vrm, deltaSec})
//   4. generatedMotionRuntime.tick(deltaSec)
//   5. vrm.update(deltaSec)   <-- REQUIRED for VRM expression
//                                interpolation + secondary motion physics

import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Component as ReactComponent } from 'react';
import type { ComponentType, ReactNode } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { VRM } from '@pixiv/three-vrm';
import type {
  BackendAudioConsumer,
  BackendProjection,
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
import type { VrmEmoteState } from './vrm-emote-state.js';
import type { VrmGeneratedMotionRuntime } from './vrm-generated-motion-runtime.js';
import type { VrmLipsyncDriver } from './vrm-lipsync-driver.js';
import {
  createVrmProjectionAdapter,
  type ActivityMapping,
} from './vrm-projection-adapter.js';
import { createVrmHitRegion } from './vrm-hit-region.js';
import type { VrmRenderTarget } from './vrm-render-target.js';
import {
  createVrmCapabilityProfile,
  type VrmCapabilityProfile,
} from './vrm-capability-profile.js';

export type VrmCarrierSurfaceInput = {
  manifest: VrmAvatarModelManifest;
  audioConsumer: BackendAudioConsumer;
  emoteState: VrmEmoteState;
  generatedMotionRuntime: VrmGeneratedMotionRuntime;
  lipsyncDriver: VrmLipsyncDriver;
  activityMapping: ActivityMapping;
  /** Receives the real BackendProjection adapter once the VRM is loaded;
   *  the BackendBranch factory's deferred projection shim flushes any
   *  queued calls when this fires. */
  setProjectionAdapter: (adapter: BackendProjection) => void;
  onCapabilityProfile?: (profile: VrmCapabilityProfile) => void;
  /** Test seam forwarded to createVrmRuntime — keeps unit tests fast and
   *  deterministic without spinning up real Three.js / WebGL. */
  runtimeOptions?: Pick<
    VrmRuntimeOptions,
    'loaderOverride' | 'setTimeoutFn' | 'clearTimeoutFn' | 'nowFn'
  >;
  /** Wave 4 chunk 4-C: render target driving the alpha-mask probe. The
   *  surface drives `capture()` from useFrame at ~10Hz throttle. */
  renderTarget: VrmRenderTarget;
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
    const adapterAnnouncedRef = useRef<VRM | null>(null);
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
        // Wave 4 chunk 4-C: real alpha-mask (or tier-C bbox fallback)
        // hit region. The render target was already constructed at the
        // BackendBranch factory; we wire the viewport through a closure
        // reading the canvas element's bounding rect each probe so the
        // region works correctly across resize / drag.
        const hitRegion = createVrmHitRegion({
          renderTarget: input.renderTarget,
          getViewport: () => {
            const container = canvasContainerRef.current;
            if (!container) return null;
            const canvas = container.querySelector('canvas');
            if (!canvas) return null;
            const rect = canvas.getBoundingClientRect();
            if (rect.width <= 0 || rect.height <= 0) return null;
            return {
              left: rect.left,
              top: rect.top,
              width: rect.width,
              height: rect.height,
            };
          },
          onDegraded: (detail) => {
            props.onLifecycleEvidence?.('hit_region_degraded', {
              source: 'vrm-carrier-surface',
              reason_code: detail.reason_code,
              recorded_at: detail.recordedAt,
            });
          },
        });
        props.onHitRegionChange?.(hitRegion);
      }
    }, [
      state.kind,
      props.onAudioConsumerReady,
      props.onHitRegionChange,
      props.onLifecycleEvidence,
    ]);

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

    // Adapter construction + generated motion runtime attach (one-shot per VRM).
    // Keyed on `vrm` identity so a context_lost → ready bounce that
    // returns the same VRM instance does not re-register the adapter,
    // but a fresh load (post-failed_closed scenario) would.
    useEffect(() => {
      if (!vrm) return;
      if (adapterAnnouncedRef.current === vrm) return;
      adapterAnnouncedRef.current = vrm;
      const adapter = createVrmProjectionAdapter({
        vrm,
        emoteState: input.emoteState,
        generatedMotionRuntime: input.generatedMotionRuntime,
        activityMapping: input.activityMapping,
      });
      input.generatedMotionRuntime.attach(vrm);
      input.setProjectionAdapter(adapter);
      const profile = createVrmCapabilityProfile(vrm);
      input.onCapabilityProfile?.(profile);
      props.onLifecycleEvidence?.('generated_motion_runtime_attached', {
        provider_path: 'avatar_generated_motion',
        vrma_position: 'interchange_only',
        capability_profile_id: profile.profileId,
        generated_motion_routes: profile.supportedRoutes,
        unsupported_generated_motion_routes: profile.unsupportedRoutes.map((route) => route.routeId),
      });
    }, [vrm, props.onLifecycleEvidence]);

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
          lookAt: [
            framing.cameraLookAt.x,
            framing.cameraLookAt.y,
            framing.cameraLookAt.z,
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
          {state.kind === 'ready' && vrm ? (
            <>
              <VrmFrameLoop
                vrm={vrm}
                audioConsumer={input.audioConsumer}
                lipsyncDriver={input.lipsyncDriver}
                emoteState={input.emoteState}
                generatedMotionRuntime={input.generatedMotionRuntime}
              />
              <VrmRenderTargetCaptureLoop
                vrm={vrm}
                renderTarget={input.renderTarget}
              />
            </>
          ) : null}
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

/**
 * Per-frame tick chain. Mounted only when the runtime is `ready` so the
 * VRM instance is guaranteed non-null. Lives inside <Canvas> so it has
 * access to R3F's useFrame context.
 *
 * Tick order (mandated by chunk 3-D contract):
 *   1. lipsync driver — translates wlipsync snapshot to viseme writes
 *      and reports {active} so the emote layer suppresses its viseme
 *      writes for the same frame
 *   2. emote state — flushes bundle + transient overlays to expression
 *      manager (skipping visemes when lipsync is active)
 *   3. generated motion runtime — advances generated AnimationMixer clips
 *   4. vrm.update — REQUIRED to advance VRM expression interpolation +
 *      secondary motion physics (per AGENTS.md pitfall #5/#10)
 */
function VrmFrameLoop({
  vrm,
  audioConsumer,
  lipsyncDriver,
  emoteState,
  generatedMotionRuntime,
}: {
  vrm: VRM;
  audioConsumer: BackendAudioConsumer;
  lipsyncDriver: VrmLipsyncDriver;
  emoteState: VrmEmoteState;
  generatedMotionRuntime: VrmGeneratedMotionRuntime;
}): null {
  useFrame((_state, deltaSec) => {
    const dt = Math.max(0, deltaSec);
    const lipsyncSnapshot = audioConsumer.snapshot();
    const lipResult = lipsyncDriver.tick({ vrm, deltaSec: dt, lipsyncSnapshot });
    emoteState.setLipsyncActive(lipResult.active);
    emoteState.tick({ vrm, deltaSec: dt });
    generatedMotionRuntime.tick(dt);
    // VRM internal animation update is critical: expression interpolation
    // + secondary motion physics depend on this per-frame call.
    if (typeof (vrm as { update?: (dt: number) => void }).update === 'function') {
      (vrm as { update: (dt: number) => void }).update(dt);
    }
  });
  return null;
}

/**
 * Wave 4 chunk 4-C: drives the alpha-mask hit-test render-target capture
 * at ~10Hz (≥100ms between captures). Per packet wave-4
 * forbidden_shortcuts the capture must not run every frame: full-canvas
 * readPixels is forbidden, and even a 1×1 readback after `renderer.render`
 * is a synchronous GPU stall. 10Hz matches the 100ms hit-region snapshot
 * throttle (acceptance_invariant 8) — finer cadence buys nothing because
 * the consumer cannot deliver bbox updates faster.
 */
const VRM_RENDER_TARGET_CAPTURE_INTERVAL_MS = 100;

function VrmRenderTargetCaptureLoop({
  vrm,
  renderTarget,
}: {
  vrm: VRM;
  renderTarget: VrmRenderTarget;
}): null {
  const lastCapturedAtMsRef = useRef<number>(-Infinity);
  const { gl, scene, camera } = useThree();
  useFrame(() => {
    const now =
      typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? performance.now()
        : Date.now();
    if (now - lastCapturedAtMsRef.current < VRM_RENDER_TARGET_CAPTURE_INTERVAL_MS) {
      return;
    }
    lastCapturedAtMsRef.current = now;
    try {
      renderTarget.capture({
        renderer: gl as unknown as Parameters<VrmRenderTarget['capture']>[0]['renderer'],
        scene,
        camera,
        vrm,
      });
    } catch {
      // Render-target capture is best-effort; on transient failure the
      // probe falls back to its last-good FBO (probeAlphaAtClient returns
      // null if no snapshot yet — hit region resolves to false).
    }
  });
  return null;
}

// React error boundary — function components cannot trap render-phase
// errors thrown by <Canvas> when the host has no WebGL (jsdom / SSR).
// On error we render null and notify the parent to emit failed_closed.
type SafeCanvasCameraProps = {
  fov: number;
  position: [number, number, number];
  lookAt: [number, number, number];
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
      const { lookAt, ...cameraInit } = this.props.cameraProps;
      // R3F's Canvas `camera` prop seeds initial position/fov/near/far on
      // the default camera but does not accept a `lookAt`. Apply lookAt
      // via onCreated so the camera orientation matches the framing
      // calculation — without this the camera looks at world (0,0,0)
      // and the VRM (whose feet sit near y=0 and head at y≈totalHeight)
      // ends up tilted off-axis and rendered ~⅓ its intended size.
      return (
        <Canvas
          camera={cameraInit}
          onCreated={(state) => {
            state.camera.lookAt(lookAt[0], lookAt[1], lookAt[2]);
            state.camera.updateProjectionMatrix();
          }}
        >
          <SafeCanvasCameraController cameraProps={this.props.cameraProps} />
          {this.props.children}
        </Canvas>
      );
    }
    return <Canvas>{this.props.children}</Canvas>;
  }
}

function SafeCanvasCameraController({
  cameraProps,
}: {
  cameraProps: SafeCanvasCameraProps;
}): null {
  const { camera } = useThree();
  useEffect(() => {
    const [x, y, z] = cameraProps.position;
    const [lookX, lookY, lookZ] = cameraProps.lookAt;
    camera.position.set(x, y, z);
    camera.near = cameraProps.near;
    camera.far = cameraProps.far;
    if ('fov' in camera) {
      camera.fov = cameraProps.fov;
    }
    camera.lookAt(lookX, lookY, lookZ);
    camera.updateProjectionMatrix();
  }, [
    camera,
    cameraProps.far,
    cameraProps.fov,
    cameraProps.lookAt,
    cameraProps.near,
    cameraProps.position,
  ]);
  return null;
}
