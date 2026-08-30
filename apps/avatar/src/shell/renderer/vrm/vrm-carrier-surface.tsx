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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  VRM_PRESENTATION_WATCHDOG_TIMEOUT_MS,
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
import {
  deriveVrmLogicalWindowGeometry,
  deriveVrmProjectedHitGeometry,
  type VrmLogicalWindowGeometry,
  type VrmProjectedHitGeometry,
} from './vrm-nominal-bounds.js';
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

export const VRM_PROJECTED_HIT_CHANGE_THRESHOLD_PX = 2;

export function hasMaterialProjectedHitChange(input: {
  previous: VrmProjectedHitGeometry | null;
  next: VrmProjectedHitGeometry;
  viewportWidth: number;
  viewportHeight: number;
}): boolean {
  if (!input.previous) return true;
  const width = Math.max(1, input.viewportWidth);
  const height = Math.max(1, input.viewportHeight);
  const horizontalKeys = ['left', 'right'] as const;
  const verticalKeys = ['top', 'bottom'] as const;
  for (const region of ['body', 'drag'] as const) {
    for (const key of horizontalKeys) {
      if (Math.abs(input.previous[region][key] - input.next[region][key]) * width
        >= VRM_PROJECTED_HIT_CHANGE_THRESHOLD_PX) return true;
    }
    for (const key of verticalKeys) {
      if (Math.abs(input.previous[region][key] - input.next[region][key]) * height
        >= VRM_PROJECTED_HIT_CHANGE_THRESHOLD_PX) return true;
    }
  }
  return false;
}

type VrmRenderableObjectLike = {
  readonly visible?: boolean;
  readonly parent?: VrmRenderableObjectLike | null;
  readonly isMesh?: boolean;
  readonly isSkinnedMesh?: boolean;
  readonly geometry?: {
    readonly attributes?: { readonly position?: { readonly count?: number } };
    getAttribute?: (name: string) => { readonly count?: number } | undefined;
  };
  readonly material?: VrmMaterialLike | readonly VrmMaterialLike[];
};

type VrmMaterialLike = {
  readonly visible?: boolean;
  readonly opacity?: number;
};

type VrmFrameRendererLike = {
  getRenderTarget?: () => unknown;
  readonly info?: {
    readonly render?: {
      readonly calls?: number;
      readonly triangles?: number;
    };
  };
};

export function hasVisibleRenderableVrmScene(vrm: VRM): boolean {
  let renderable = false;
  vrm.scene.traverse((candidate: unknown) => {
    if (renderable || !candidate || typeof candidate !== 'object') return;
    const object = candidate as VrmRenderableObjectLike;
    if (object.isMesh !== true && object.isSkinnedMesh !== true) return;
    for (let current: VrmRenderableObjectLike | null | undefined = object;
      current;
      current = current.parent) {
      if (current.visible === false) return;
    }
    const position = object.geometry?.getAttribute?.('position')
      ?? object.geometry?.attributes?.position;
    if (!Number.isFinite(position?.count) || Number(position?.count) <= 0) return;
    const materials = Array.isArray(object.material)
      ? object.material
      : object.material ? [object.material] : [];
    if (!materials.some((material) => {
      const opacity = material.opacity ?? 1;
      return material.visible !== false && Number.isFinite(opacity) && opacity > 0;
    })) return;
    renderable = true;
  });
  return renderable;
}

export function isVrmSemanticFirstFrame(input: {
  vrm: VRM;
  renderer: VrmFrameRendererLike | null | undefined;
  renderedScene: unknown;
  expectedScene: unknown;
}): boolean {
  const render = input.renderer?.info?.render;
  return typeof input.renderer?.getRenderTarget === 'function'
    && input.renderer.getRenderTarget() === null
    && input.renderedScene === input.expectedScene
    && Number.isFinite(render?.calls)
    && Number(render?.calls) > 0
    && Number.isFinite(render?.triangles)
    && Number(render?.triangles) > 0
    && hasVisibleRenderableVrmScene(input.vrm);
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
    const presentationCallbackRef = useRef(props.onPresentationStateChange);
    presentationCallbackRef.current = props.onPresentationStateChange;
    const reportedPresentationRef = useRef<{
      kind: 'loading' | 'recovering' | 'ready' | 'unavailable';
      reason?: string;
    } | null>(null);
    const [presentationState, setPresentationState] = useState<
      'loading' | 'recovering' | 'ready' | 'failed_closed'
    >('loading');
    const reportPresentation = (
      next: Parameters<NonNullable<typeof props.onPresentationStateChange>>[0],
    ): void => {
      const current = reportedPresentationRef.current;
      const reason = next.kind === 'unavailable' ? next.reason : undefined;
      if (current?.kind === next.kind && current.reason === reason) return;
      reportedPresentationRef.current = { kind: next.kind, ...(reason ? { reason } : {}) };
      setPresentationState(next.kind === 'unavailable' ? 'failed_closed' : next.kind);
      presentationCallbackRef.current?.(next);
    };
    const boundVrmRef = useRef<VRM | null>(null);
    const suppressedMotionRef = useRef<PlayGeneratedMotionInput | null>(null);
    const reducedMotionRef = useRef(props.reducedMotion === true);
    reducedMotionRef.current = props.reducedMotion === true;
    const canvasContainerRef = useRef<HTMLDivElement | null>(null);
    const [state, setState] = useState<VrmRenderState>({ kind: 'idle' });
    const [boundVrm, setBoundVrm] = useState<VRM | null>(null);
    const [canvasError, setCanvasError] = useState(false);
    const [capabilityProfileRef, setCapabilityProfileRef] = useState<string | null>(null);
    const firstFrameWatchdogRef = useRef<number | null>(null);
    const firstFrameWatchdogVrmRef = useRef<VRM | null>(null);
    const lastValidLogicalWindowRef = useRef<VrmLogicalWindowGeometry | null>(null);
    const lastValidProjectedHitRef = useRef<VrmProjectedHitGeometry | null>(null);
    const lastPublishedBoundsRef = useRef<VrmLogicalWindowGeometry['bounds'] | null>(null);
    const lastPublishedProjectedHitRef = useRef<VrmProjectedHitGeometry | null>(null);

    const clearFirstFrameWatchdog = (): void => {
      if (firstFrameWatchdogRef.current !== null) {
        window.clearTimeout(firstFrameWatchdogRef.current);
        firstFrameWatchdogRef.current = null;
      }
      firstFrameWatchdogVrmRef.current = null;
    };

    const armFirstFrameWatchdog = (runtime: VrmRuntime, vrm: VRM): void => {
      clearFirstFrameWatchdog();
      firstFrameWatchdogVrmRef.current = vrm;
      firstFrameWatchdogRef.current = window.setTimeout(() => {
        firstFrameWatchdogRef.current = null;
        if (runtimeRef !== runtime || firstFrameWatchdogVrmRef.current !== vrm) return;
        firstFrameWatchdogVrmRef.current = null;
        runtime.notifyFirstFrameTimedOut(vrm);
      }, VRM_PRESENTATION_WATCHDOG_TIMEOUT_MS);
    };

    // Construct runtime + start it on mount; tear down on unmount.
    useEffect(() => {
      let mounted = true;
      const detachVrmConsumers = (retiredVrm?: VRM): void => {
        if (retiredVrm && boundVrmRef.current !== retiredVrm) {
          // Even an unbound terminal/retry attempt must clear pending cues so
          // a later adapter cannot replay state captured for a failed scene.
          input.resetProjectionAdapter();
          return;
        }
        input.resetProjectionAdapter();
        input.generatedMotionRuntime.dispose();
        input.emoteState.setLipsyncActive(false);
        if (retiredVrm) input.emoteState.reset({ vrm: retiredVrm });
        input.audioConsumer.silent();
        suppressedMotionRef.current = null;
        boundVrmRef.current = null;
        lastValidLogicalWindowRef.current = null;
        lastValidProjectedHitRef.current = null;
        lastPublishedBoundsRef.current = null;
        lastPublishedProjectedHitRef.current = null;
        if (mounted) {
          setBoundVrm(null);
          setCapabilityProfileRef(null);
        }
      };
      const runtime = createVrmRuntime({
        manifest: input.manifest,
        ...input.runtimeOptions,
        beforeDisposeVrm: detachVrmConsumers,
      });
      runtimeRef = runtime;
      const detachDiagnostics = attachVrmDiagnostics(runtime);
      const unsubscribe = runtime.subscribe((next) => {
        if (next.kind === 'context_lost') {
          detachVrmConsumers(next.vrm);
        } else if (next.kind === 'failed_closed') {
          detachVrmConsumers();
        }
        if (next.kind === 'ready') {
          // The scene is loaded, but presentation is not ready until the
          // projection adapter, motion runtime, capability profile, and first
          // visible default-framebuffer render all complete.
          armFirstFrameWatchdog(runtime, next.vrm);
          reportPresentation({ kind: 'loading' });
        } else if (next.kind === 'context_lost') {
          clearFirstFrameWatchdog();
          reportPresentation({ kind: 'recovering' });
        } else if (next.kind === 'failed_closed') {
          clearFirstFrameWatchdog();
          reportPresentation({ kind: 'unavailable', reason: next.reason });
        } else {
          clearFirstFrameWatchdog();
          reportPresentation({ kind: 'loading' });
        }
        if (mounted) setState(next);
      });
      void runtime.start();
      return () => {
        mounted = false;
        unsubscribe();
        detachDiagnostics();
        clearFirstFrameWatchdog();
        runtime.shutdown();
        runtimeRef = null;
      };
    }, []);

    // A staging surface deliberately receives no audio callback. Announce the
    // sink only after this same mounted surface becomes the active layer.
    useEffect(() => {
      if (state.kind !== 'ready') return;
      if (!audioAnnouncedRef.current && props.onAudioConsumerReady) {
        audioAnnouncedRef.current = true;
        props.onAudioConsumerReady(input.audioConsumer);
      }
    }, [state.kind, props.onAudioConsumerReady]);

    const publishCurrentGeometry = useCallback((currentVrm: VRM): void => {
      const logicalDerived = deriveVrmLogicalWindowGeometry({
        vrm: currentVrm,
        intent: 'bottom-companion',
      });
      const logical = logicalDerived.source === 'scene_geometry'
        ? logicalDerived
        : lastValidLogicalWindowRef.current ?? logicalDerived;
      if (logicalDerived.source === 'scene_geometry') {
        lastValidLogicalWindowRef.current = logicalDerived;
      } else if (!lastValidLogicalWindowRef.current) {
        console.warn(`[avatar:vrm] logical window geometry degraded: ${logicalDerived.reasonCode}`);
      }

      const aspect = props.height > 0 ? props.width / props.height : 0.45;
      const projectedDerived = deriveVrmProjectedHitGeometry({
        vrm: currentVrm,
        intent: 'bottom-companion',
        aspect,
      });
      const projected = projectedDerived.source === 'scene_geometry'
        ? projectedDerived
        : lastValidProjectedHitRef.current ?? projectedDerived;
      if (projectedDerived.source === 'scene_geometry') {
        lastValidProjectedHitRef.current = projectedDerived;
      } else if (!lastValidProjectedHitRef.current) {
        console.warn(`[avatar:vrm] projected hit geometry degraded: ${projectedDerived.reasonCode}`);
      }

      const previousBounds = lastPublishedBoundsRef.current;
      const materiallyChanged = !previousBounds
        || Math.abs(previousBounds.width - logical.bounds.width) >= 2
        || Math.abs(previousBounds.height - logical.bounds.height) >= 2
        || previousBounds.bodyCenterX !== logical.bounds.bodyCenterX
        || previousBounds.bodyCenterY !== logical.bounds.bodyCenterY;
      if (materiallyChanged) {
        lastPublishedBoundsRef.current = logical.bounds;
        props.onSurfaceBoundsChange?.({
          bounds: logical.bounds,
          source: logical.source,
          reasonCode: logical.reasonCode,
        });
      }

      if (!props.onHitRegionChange || !hasMaterialProjectedHitChange({
        previous: lastPublishedProjectedHitRef.current,
        next: projected,
        viewportWidth: props.width,
        viewportHeight: props.height,
      })) return;
      lastPublishedProjectedHitRef.current = projected;
      const hitRegion = createVrmHitRegion({
        renderTarget: input.renderTarget,
        body: projected.body,
        drag: projected.drag,
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
      props.onHitRegionChange(hitRegion);
      if (!regionAnnouncedRef.current) {
        regionAnnouncedRef.current = true;
        input.onHitRegionPublished?.();
      }
    }, [
      input.onHitRegionPublished,
      input.renderTarget,
      props.height,
      props.onHitRegionChange,
      props.onSurfaceBoundsChange,
      props.width,
    ]);

    useEffect(() => {
      if (state.kind === 'ready') publishCurrentGeometry(state.vrm);
    }, [publishCurrentGeometry, state]);

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
        const profile = createVrmCapabilityProfile(currentVrm);
        input.onCapabilityProfile?.(profile);
        setCapabilityProfileRef(`avatar.vrm.capability-profile:${profile.profileId}`);
      } catch (error) {
        clearFirstFrameWatchdog();
        input.resetProjectionAdapter();
        input.generatedMotionRuntime.dispose();
        boundVrmRef.current = null;
        setBoundVrm(null);
        setCanvasError(true);
        reportPresentation({
          kind: 'unavailable',
          reason: error instanceof Error ? error.message : String(error),
        });
        console.warn(`[avatar:vrm] failed to bind current VRM consumers: ${error instanceof Error ? error.message : String(error)}`);
      }
    }, [state]);

    const handleFirstRenderedFrame = useCallback((renderedVrm: VRM): void => {
      const runtimeState = runtimeRef?.getState();
      if (runtimeState?.kind !== 'ready'
        || runtimeState.vrm !== renderedVrm
        || boundVrmRef.current !== renderedVrm) return;
      if (firstFrameWatchdogVrmRef.current !== renderedVrm) return;
      clearFirstFrameWatchdog();
      reportPresentation({ kind: 'ready' });
    }, []);

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
        <div data-avatar-vrm-state="failed_closed">
          <PresentationUnavailableSurface
            reason={state.kind === 'failed_closed' ? state.reason : 'webgl_canvas_unavailable'}
            onRestart={props.onPresentationRestart}
          />
        </div>
      );
    }

    return (
      <div
        ref={canvasContainerRef}
        data-testid="avatar-vrm-carrier"
        data-avatar-vrm-state={presentationState}
        data-avatar-vrm-runtime-state={state.kind}
        data-avatar-vrm-capability-profile-ref={capabilityProfileRef ?? undefined}
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
            reportPresentation({
              kind: 'unavailable',
              reason: 'webgl_canvas_unavailable',
            });
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
                onGeometrySample={publishCurrentGeometry}
              />
              <VrmFirstFrameObserver vrm={vrm} onFirstFrame={handleFirstRenderedFrame} />
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
  onGeometrySample,
}: {
  vrm: VRM;
  audioConsumer: BackendAudioConsumer;
  lipsyncDriver: VrmLipsyncDriver;
  emoteState: VrmEmoteState;
  generatedMotionRuntime: VrmGeneratedMotionRuntime<VRM>;
  reducedMotion: boolean;
  onGeometrySample: (vrm: VRM) => void;
}): null {
  const lastGeometrySampleAtMsRef = useRef(-Infinity);
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
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (now - lastGeometrySampleAtMsRef.current >= VRM_GEOMETRY_SAMPLE_INTERVAL_MS) {
      lastGeometrySampleAtMsRef.current = now;
      onGeometrySample(vrm);
    }
  });
  return null;
}

const VRM_GEOMETRY_SAMPLE_INTERVAL_MS = 100;

function VrmFirstFrameObserver({
  vrm,
  onFirstFrame,
}: {
  vrm: VRM;
  onFirstFrame: (vrm: VRM) => void;
}): null {
  const { scene } = useThree();
  const callbackRef = useRef(onFirstFrame);
  callbackRef.current = onFirstFrame;
  useEffect(() => {
    const renderScene = scene as unknown as {
      onAfterRender?: (...args: unknown[]) => void;
    };
    const previous = renderScene.onAfterRender;
    let observed = false;
    const handleAfterRender = (...args: unknown[]): void => {
      previous?.(...args);
      if (observed) return;
      if (!isVrmSemanticFirstFrame({
        vrm,
        renderer: args[0] as VrmFrameRendererLike | undefined,
        renderedScene: args[1],
        expectedScene: renderScene,
      })) return;
      observed = true;
      callbackRef.current(vrm);
    };
    renderScene.onAfterRender = handleAfterRender;
    return () => {
      if (renderScene.onAfterRender === handleAfterRender) {
        renderScene.onAfterRender = previous;
      }
    };
  }, [scene, vrm]);
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
