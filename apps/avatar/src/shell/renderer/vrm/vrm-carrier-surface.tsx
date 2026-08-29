// Authority: .nimi/spec/avatar/embodiment-surface.authority.yaml.
//
// VRM BackendBranch surface integrates emote state, generated motion runtime,
// lipsync driver, and projection adapter are all wired through the
// surface useFrame loop.
//
// Wiring follows the r057 resource ownership and r062 audio/hit-region rules:
//
//   * webglcontextlost  → runtime.notifyContextLost()    (preventDefault
//                          to allow Three.js to re-acquire the context)
//   * webglcontextrestored → runtime.notifyContextRestored()
//   * onAudioConsumerReady fires exactly once per surface mount;
//     guarded by a useRef to prevent double-registration of the sink
//   * onHitRegionChange fires once with the full-viewport bbox; alpha-mask
//     hit-test is not available until the model-specific opacity probe is
//     attached (isOpaqueAtClientPoint = null)
//   * terminal failure after backend-local recovery renders the Avatar-owned
//     unavailable surface with restart and close actions
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
import type { BackendAudioConsumer } from '@nimiplatform/kit/features/avatar/headless';
import type {
  BackendProjection,
  BackendSurfaceProps,
} from '../carrier/backend-branch.js';
import type { VrmAvatarModelManifest } from './vrm-model-manifest.js';
import {
  attachVrmDiagnostics,
  updateVrmDiagnosticsFrameStats,
} from './vrm-diagnostics.js';
import { applyVrmFraming } from './vrm-framing.js';
import {
  createVrmRuntime,
  type VrmRenderState,
  type VrmRuntime,
  type VrmRuntimeOptions,
} from './vrm-runtime.js';
import { VrmScene } from './vrm-scene.js';
import type { VrmEmoteState } from './vrm-emote-state.js';
import type {
  PlayGeneratedMotionInput,
  VrmGeneratedMotionRuntime,
} from './vrm-generated-motion-contract.js';
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
import { getCachedDeviceTier } from '../app-shell/device-tier-detector.js';
import { PresentationUnavailableSurface } from '../presentation-unavailable/presentation-unavailable-surface.js';

export type VrmCarrierSurfaceInput = {
  manifest: VrmAvatarModelManifest;
  audioConsumer: BackendAudioConsumer;
  emoteState: VrmEmoteState;
  generatedMotionRuntime: VrmGeneratedMotionRuntime<VRM>;
  lipsyncDriver: VrmLipsyncDriver;
  activityMapping: ActivityMapping;
  /** Receives the real BackendProjection adapter once the VRM is loaded;
   *  the BackendBranch factory's queued projection adapter flushes any
   *  queued calls when this fires. */
  setProjectionAdapter: (adapter: BackendProjection) => void;
  resetProjectionAdapter: () => void;
  onCapabilityProfile?: (profile: VrmCapabilityProfile) => void;
  onHitRegionPublished?: () => void;
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

export function shouldCaptureVrmAlphaMask(deviceTier: string): boolean {
  return deviceTier === 'A' || deviceTier === 'B';
}

export function createVrmCarrierSurface(
  input: VrmCarrierSurfaceInput,
): VrmCarrierSurfaceHandle {
  // Each call mints a fresh runtime; createVrmBackendBranch invokes this
  // once per backend instantiation, and the React Component captures the
  // runtime reference via closure rather than constructing per-mount.
  // shutdown() on the handle is wired through the BackendBranch.shutdown()
  // path (vrm-backend.ts) so embodiment-stage can free resources on swap.
  let runtimeRef: VrmRuntime | null = null;
  const deviceTier = getCachedDeviceTier()?.tier ?? 'C';

  const Component: ComponentType<BackendSurfaceProps> = (props) => {
    const audioAnnouncedRef = useRef(false);
    const regionAnnouncedRef = useRef(false);
    const boundVrmRef = useRef<VRM | null>(null);
    const suppressedMotionRef = useRef<PlayGeneratedMotionInput | null>(null);
    const reducedMotionRef = useRef(props.reducedMotion === true);
    reducedMotionRef.current = props.reducedMotion === true;
    const canvasContainerRef = useRef<HTMLDivElement | null>(null);
    const [state, setState] = useState<VrmRenderState>({ kind: 'idle' });
    const [boundVrm, setBoundVrm] = useState<VRM | null>(null);
    const [canvasError, setCanvasError] = useState(false);

    // Construct runtime + start it on mount; tear down on unmount.
    useEffect(() => {
      const runtime = createVrmRuntime({
        manifest: input.manifest,
        ...input.runtimeOptions,
        beforeDisposeVrm: (retiredVrm) => {
          if (boundVrmRef.current !== retiredVrm) return;
          input.resetProjectionAdapter();
          input.generatedMotionRuntime.dispose();
          input.emoteState.setLipsyncActive(false);
          input.emoteState.reset({ vrm: retiredVrm });
          input.audioConsumer.silent();
          suppressedMotionRef.current = null;
          boundVrmRef.current = null;
          setBoundVrm((current) => current === retiredVrm ? null : current);
        },
      });
      runtimeRef = runtime;
      const detachDiagnostics = attachVrmDiagnostics(runtime);
      const unsubscribe = runtime.subscribe((next) => setState(next));
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
          deviceTier,
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
            console.warn(`[avatar:vrm] hit-region degraded: ${detail.reason_code}`);
          },
        });
        if (props.onHitRegionChange) {
          props.onHitRegionChange(hitRegion);
          input.onHitRegionPublished?.();
        }
      }
    }, [
      state.kind,
      props.onAudioConsumerReady,
      props.onHitRegionChange,
      input.onHitRegionPublished,
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

    // Projection and frame delivery stay detached until the current VRM owns
    // its generated-motion mixer and projection adapter. Runtime retirement
    // synchronously resets both before it releases the old scene.
    useEffect(() => {
      if (state.kind !== 'ready') return;
      const currentVrm = state.vrm;
      if (boundVrmRef.current === currentVrm) return;
      try {
        input.generatedMotionRuntime.attach(currentVrm);
        const adapter = createVrmProjectionAdapter({
          vrm: currentVrm,
          emoteState: input.emoteState,
          generatedMotionRuntime: input.generatedMotionRuntime,
          activityMapping: input.activityMapping,
          isReducedMotion: () => reducedMotionRef.current,
          onSuppressedMotionChange: (motion) => {
            suppressedMotionRef.current = motion;
          },
        });
        input.setProjectionAdapter(adapter);
        boundVrmRef.current = currentVrm;
        setBoundVrm(currentVrm);
        input.onCapabilityProfile?.(createVrmCapabilityProfile(currentVrm));
      } catch (error) {
        input.resetProjectionAdapter();
        input.generatedMotionRuntime.dispose();
        boundVrmRef.current = null;
        setBoundVrm(null);
        setCanvasError(true);
        console.warn(`[avatar:vrm] failed to bind current VRM consumers: ${error instanceof Error ? error.message : String(error)}`);
      }
    }, [state]);

    useEffect(() => {
      if (props.reducedMotion) {
        const snapshot = input.generatedMotionRuntime.snapshot();
        if (snapshot.activeInput
          && (snapshot.activeLoop || snapshot.activeRouteId === 'idle_subtle')) {
          suppressedMotionRef.current = snapshot.activeInput;
          input.generatedMotionRuntime.stopAll();
        }
        return;
      }
      const suppressed = suppressedMotionRef.current;
      if (suppressed) {
        suppressedMotionRef.current = null;
        input.generatedMotionRuntime.play(suppressed);
      }
    }, [props.reducedMotion]);

    // Derive camera framing from validated VRM scene bounds and the local
    // framing intent under rule.nimi.avatar.embodiment.r059.
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
      return (
        <PresentationUnavailableSurface
          reason={state.kind === 'failed_closed' ? state.reason : 'webgl_canvas_unavailable'}
        />
      );
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
          reducedMotion={props.reducedMotion === true}
          onMountError={() => {
            setCanvasError(true);
            console.warn('[avatar:vrm] WebGL canvas failed to mount');
          }}
        >
          <VrmScene vrm={vrm} />
          {state.kind === 'ready' && vrm && boundVrm === vrm ? (
            <>
              <VrmFrameLoop
                vrm={vrm}
                audioConsumer={input.audioConsumer}
                lipsyncDriver={input.lipsyncDriver}
                emoteState={input.emoteState}
                generatedMotionRuntime={input.generatedMotionRuntime}
                reducedMotion={props.reducedMotion === true}
              />
              {shouldCaptureVrmAlphaMask(deviceTier) ? (
                <VrmRenderTargetCaptureLoop
                  vrm={vrm}
                  renderTarget={input.renderTarget}
                />
              ) : null}
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
  reducedMotion,
}: {
  vrm: VRM;
  audioConsumer: BackendAudioConsumer;
  lipsyncDriver: VrmLipsyncDriver;
  emoteState: VrmEmoteState;
  generatedMotionRuntime: VrmGeneratedMotionRuntime<VRM>;
  reducedMotion: boolean;
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
      (vrm as { update: (dt: number) => void }).update(reducedMotion ? 0 : dt);
    }
  });
  return null;
}

/**
 * Drives the alpha-mask hit-test render-target capture at ~10Hz (≥100ms
 * between captures). Per the app-shell contract, capture must not run every
 * frame: full-canvas
 * readPixels is forbidden, and even a 1×1 readback after `renderer.render`
 * is a synchronous GPU stall. 10Hz matches the 100ms hit-region snapshot
 * throttle — finer cadence buys nothing because
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
// On error we notify the owning surface, which renders the local unavailable UI.
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
  reducedMotion: boolean;
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
          frameloop={this.props.reducedMotion ? 'demand' : 'always'}
          onCreated={(state) => {
            state.camera.lookAt(lookAt[0], lookAt[1], lookAt[2]);
            state.camera.updateProjectionMatrix();
          }}
        >
          <ReducedMotionFrameInvalidator active={this.props.reducedMotion} />
          <SafeCanvasCameraController cameraProps={this.props.cameraProps} />
          {this.props.children}
        </Canvas>
      );
    }
    return (
      <Canvas frameloop={this.props.reducedMotion ? 'demand' : 'always'}>
        <ReducedMotionFrameInvalidator active={this.props.reducedMotion} />
        {this.props.children}
      </Canvas>
    );
  }
}

function ReducedMotionFrameInvalidator({ active }: { active: boolean }): null {
  const state = useThree();
  useEffect(() => {
    if (!active || typeof state.invalidate !== 'function') return;
    state.invalidate();
    const timer = window.setInterval(() => state.invalidate(), 100);
    return () => window.clearInterval(timer);
  }, [active, state]);
  return null;
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
