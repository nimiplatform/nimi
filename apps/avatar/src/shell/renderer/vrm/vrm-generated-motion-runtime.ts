// Authority: .nimi/spec/avatar/embodiment-surface.authority.yaml.
//
// Avatar-owned VRM generated motion runtime. This is downstream of typed
// runtime.agent.* projection and does not load .vrma files; .vrma remains
// interchange/authoring evidence only.

import type { VRM } from '@pixiv/three-vrm';
import { AnimationMixer, LoopOnce, LoopRepeat } from 'three';
import type {
  GeneratedMotionRuntimeSnapshot,
  PlayGeneratedMotionInput,
  PlayGeneratedMotionResult,
  VrmGeneratedMotionProvider,
  VrmGeneratedMotionRuntime,
} from './vrm-generated-motion-contract.js';

export const GENERATED_MOTION_INTENSITY_MIN = 0.5;
export const GENERATED_MOTION_INTENSITY_MAX = 1.4;
export const DEFAULT_GENERATED_MOTION_FADE_SEC = 0.3;

type AnimationMixerInstance = {
  clipAction(clip: unknown): AnimationActionLike;
  update(deltaSec: number): void;
  stopAllAction(): void;
  uncacheRoot(root: unknown): void;
};

type AnimationActionLike = {
  play(): unknown;
  stop(): unknown;
  reset(): unknown;
  crossFadeTo(next: AnimationActionLike, duration: number, warp: boolean): unknown;
  timeScale: number;
  loop: number;
};

export function createMissingVrmGeneratedMotionProvider(): VrmGeneratedMotionProvider<VRM> {
  return {
    generate(input) {
      return {
        status: 'fail_closed',
        routeId: input.routeId,
        reasonCode: 'missing_profile',
        evidence: {
          routeId: input.routeId,
          providerKind: 'missing',
          reasonCode: 'missing_profile',
        },
      };
    },
  };
}

export function createVrmGeneratedMotionRuntime(
  provider: VrmGeneratedMotionProvider<VRM>,
): VrmGeneratedMotionRuntime<VRM> {
  let vrmRef: VRM | null = null;
  let mixer: AnimationMixerInstance | null = null;
  let activeAction: AnimationActionLike | null = null;
  let activeRouteId: string | null = null;
  let activeLoop = false;
  let fadeRemainingSec = 0;

  function attach(vrm: VRM): void {
    if (vrmRef === vrm && mixer) return;
    dispose();
    vrmRef = vrm;
    mixer = new AnimationMixer(vrm.scene) as AnimationMixerInstance;
  }

  function play(input: PlayGeneratedMotionInput): PlayGeneratedMotionResult {
    if (!vrmRef || !mixer) {
      return {
        played: false,
        reason: 'generated_motion_runtime_not_attached',
        evidence: {
          routeId: input.routeId,
          providerKind: 'runtime',
        },
      };
    }
    const loop = input.loop ?? false;
    const generated = provider.generate({
      vrm: vrmRef,
      routeId: input.routeId,
      intensity: input.intensity ?? null,
      loop,
    });
    if (generated.status !== 'ok') {
      return {
        played: false,
        reason: generated.reasonCode,
        evidence: generated.evidence,
      };
    }

    const next = mixer.clipAction(generated.clip);
    next.loop = loop ? LoopRepeat : LoopOnce;
    next.timeScale = clampIntensity(input.intensity);
    const fade = input.fade ?? DEFAULT_GENERATED_MOTION_FADE_SEC;

    if (activeAction && activeAction !== next) {
      if (activeLoop) activeAction.stop();
      activeAction.crossFadeTo(next, fade, true);
      next.play();
      fadeRemainingSec = fade;
    } else if (activeAction === next) {
      next.reset();
      next.play();
      fadeRemainingSec = 0;
    } else {
      next.reset();
      next.play();
      fadeRemainingSec = 0;
    }

    activeAction = next;
    activeRouteId = input.routeId;
    activeLoop = loop;
    return { played: true, evidence: generated.evidence };
  }

  function stopAll(): void {
    if (mixer) mixer.stopAllAction();
    activeAction = null;
    activeRouteId = null;
    activeLoop = false;
    fadeRemainingSec = 0;
  }

  function tick(deltaSec: number): void {
    if (!mixer) return;
    mixer.update(deltaSec);
    if (fadeRemainingSec > 0) {
      fadeRemainingSec = Math.max(0, fadeRemainingSec - deltaSec);
    }
  }

  function snapshot(): GeneratedMotionRuntimeSnapshot {
    return {
      attached: vrmRef !== null && mixer !== null,
      activeRouteId,
      fadeRemainingSec,
    };
  }

  function dispose(): void {
    stopAll();
    if (mixer && vrmRef) {
      mixer.uncacheRoot(vrmRef.scene);
    }
    mixer = null;
    vrmRef = null;
  }

  return { attach, play, stopAll, tick, snapshot, dispose };
}

function clampIntensity(raw: number | null | undefined): number {
  if (raw === undefined || raw === null) return 1;
  if (!Number.isFinite(raw)) return 1;
  if (raw < GENERATED_MOTION_INTENSITY_MIN) return GENERATED_MOTION_INTENSITY_MIN;
  if (raw > GENERATED_MOTION_INTENSITY_MAX) return GENERATED_MOTION_INTENSITY_MAX;
  return raw;
}
