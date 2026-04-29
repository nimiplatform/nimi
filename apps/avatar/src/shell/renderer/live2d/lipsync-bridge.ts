// Wave 3 — Live2D lipsync bridge.
//
// Per feature-matrix.yaml wave_3.scope.live2d_lipsync_bridge this module owns
// the **Live2D-specific** projection of runtime-driven lipsync frames onto
// Cubism parameter ids:
//   - `ParamMouthOpenY`  ← frame.mouthOpenY (core lipsync — mouth aperture)
//   - `ParamMouthForm`   ← derived from frame.audioLevel (vowel-shape proxy)
//
// The voice-lipsync orchestrator (`voice-lipsync/avatar-voice-lipsync.ts`) is
// embodiment-agnostic: it consumes runtime events, emits driver/state-bus
// signals, and delegates to **this bridge** for the Live2D parameter writes.
// That separation lets future embodiment backends (e.g. VRM, custom rigs)
// implement their own bridge without touching the orchestrator.
//
// Time anchoring (K-AGCORE-051 `monotonic_with_wall_anchor`):
// runtime frames carry `offsetMs` relative to `started_at_wall`. To keep
// mouth movement in sync with audio playback (which starts at the same wall
// anchor), the bridge schedules each frame's projection write at
// `audioStartedAtMs + offsetMs`. Frames whose target time is already past
// when the batch arrives (transport lag) fire immediately so the mouth
// catches up rather than starts behind.

import type { EmbodimentProjectionApi } from '../nas/embodiment-projection-api.js';

export const LIVE2D_PARAM_MOUTH_OPEN = 'ParamMouthOpenY';
export const LIVE2D_PARAM_MOUTH_FORM = 'ParamMouthForm';

export type Live2DLipsyncFrame = {
  offsetMs: number;
  mouthOpenY: number;
  audioLevel: number;
};

export type Live2DLipsyncBridgeOptions = {
  projection: EmbodimentProjectionApi;
  // Cubism parameter id used for mouth aperture. Defaults to ParamMouthOpenY.
  mouthOpenSignalId?: string;
  // Cubism parameter id used for mouth form (vowel shape). When provided, the
  // bridge derives a value from `audioLevel` and writes it. Pass null/undefined
  // to opt out (model does not support the parameter).
  mouthFormSignalId?: string | null;
  // Override scheduler — defaults to setTimeout / clearTimeout. Provided so
  // tests can run with a fake timer.
  setTimer?: (handler: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  // Wall-clock source for "now" — defaults to Date.now. Provided so tests
  // can pin time without ambient global state.
  now?: () => number;
};

export type ScheduleFramesInput = {
  frames: ReadonlyArray<Live2DLipsyncFrame>;
  // Wall-clock ms (epoch) at which the audio (and offset_ms=0 frame) starts.
  // When omitted, frames apply immediately in arrival order.
  audioStartedAtMs?: number | null;
};

// Map [0,1] audio_level into a [-1,1] mouth-form value. Cubism ParamMouthForm
// convention: -1 small/round (closed-vowel), +1 wide/spread (open-vowel).
// Higher audio energy ≈ more open-vowel emphasis. Linear mapping is the
// pragmatic baseline; real phoneme-aware mapping is a future strategic upgrade.
export function audioLevelToMouthForm(audioLevel: number): number {
  if (!Number.isFinite(audioLevel)) return 0;
  const clamped = Math.max(0, Math.min(1, audioLevel));
  return clamped * 2 - 1;
}

export class Live2DLipsyncBridge {
  private readonly projection: EmbodimentProjectionApi;
  private readonly mouthOpenSignalId: string;
  private readonly mouthFormSignalId: string | null;
  private readonly setTimer: (handler: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;
  private readonly now: () => number;
  private pending: Set<unknown> = new Set();

  constructor(options: Live2DLipsyncBridgeOptions) {
    this.projection = options.projection;
    this.mouthOpenSignalId = options.mouthOpenSignalId ?? LIVE2D_PARAM_MOUTH_OPEN;
    // ParamMouthForm is **opt-in** per feature-matrix wave_3.scope text
    // ("ParamMouthForm（model 支持时）"). Only set when caller explicitly
    // passes a non-null signal id; default skips it so models without form
    // support don't receive bogus param writes.
    this.mouthFormSignalId = options.mouthFormSignalId ?? null;
    this.setTimer = options.setTimer ?? ((handler, ms) => setTimeout(handler, ms));
    this.clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
    this.now = options.now ?? (() => Date.now());
  }

  // Apply a single frame immediately. Used for offline / non-anchored writes
  // (e.g. interrupt reset) and as the underlying primitive of scheduleFrames.
  applyFrame(frame: Live2DLipsyncFrame): void {
    if (!Number.isFinite(frame.mouthOpenY)) return;
    const clampedOpen = Math.max(0, Math.min(1, frame.mouthOpenY));
    this.projection.setSignal(this.mouthOpenSignalId, clampedOpen, 1);
    if (this.mouthFormSignalId) {
      this.projection.setSignal(this.mouthFormSignalId, audioLevelToMouthForm(frame.audioLevel), 1);
    }
  }

  // Schedule a frame batch. Frames whose target time has already passed at
  // schedule time fire immediately; future frames are queued via setTimer.
  // Pending timers are tracked so cancel() can clear them mid-flight (e.g.
  // when runtime emits a voice_playback_requested with state=interrupted).
  scheduleFrames(input: ScheduleFramesInput): void {
    const audioStartedAtMs = input.audioStartedAtMs ?? null;
    if (audioStartedAtMs === null) {
      // No anchor: apply each frame in arrival order with no delay. Used by
      // synthetic/test paths where the runtime does not emit a wall-clock
      // anchor. Real audio playback always supplies an anchor.
      for (const frame of input.frames) {
        this.applyFrame(frame);
      }
      return;
    }
    const nowMs = this.now();
    for (const frame of input.frames) {
      const targetMs = audioStartedAtMs + frame.offsetMs;
      const delayMs = targetMs - nowMs;
      if (delayMs <= 0) {
        this.applyFrame(frame);
        continue;
      }
      const handle = this.setTimer(() => {
        this.pending.delete(handle);
        this.applyFrame(frame);
      }, delayMs);
      this.pending.add(handle);
    }
  }

  // Reset mouth params to closed/neutral. Called on interrupt and dispose so
  // the avatar's mouth never sticks open after a canceled / failed playback.
  reset(): void {
    this.projection.setSignal(this.mouthOpenSignalId, 0, 1);
    if (this.mouthFormSignalId) {
      this.projection.setSignal(this.mouthFormSignalId, 0, 1);
    }
  }

  // Cancel any pending frame timers. Idempotent.
  cancel(): void {
    for (const handle of this.pending) {
      this.clearTimer(handle);
    }
    this.pending.clear();
  }

  // Convenience: cancel + reset in one call (used on dispose / interrupt).
  cancelAndReset(): void {
    this.cancel();
    this.reset();
  }
}

export function createLive2DLipsyncBridge(options: Live2DLipsyncBridgeOptions): Live2DLipsyncBridge {
  return new Live2DLipsyncBridge(options);
}
