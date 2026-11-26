import {
  createIdleAppAttentionState,
  resolveAppAttentionStateFromViewport,
  shouldUpdateAppAttentionState,
  type AppAttentionState,
} from './app-attention-state.js';
import type { AppAttentionSource } from './app-attention-source.js';

const ENTRY_BOOTSTRAP_PRESENCE = 0.12;
// Exponential decay rates (per second), matched to 0.32/frame in and 0.18/frame out at 60Hz.
const PRESENCE_DECAY_IN_PER_SEC = -60 * Math.log(1 - 0.32);
const PRESENCE_DECAY_OUT_PER_SEC = -60 * Math.log(1 - 0.18);
const DEFAULT_FRAME_DT_SEC = 1 / 60;
const MAX_FRAME_DT_SEC = 0.1;
const PRESENCE_SETTLE_EPSILON = 0.001;

function easePresence(current: number, target: number, dtSec: number): number {
  const lambda = target > current ? PRESENCE_DECAY_IN_PER_SEC : PRESENCE_DECAY_OUT_PER_SEC;
  const alpha = 1 - Math.exp(-lambda * dtSec);
  const next = current + ((target - current) * alpha);
  return Math.abs(target - next) < PRESENCE_SETTLE_EPSILON ? target : next;
}

export function createBrowserAppAttentionSource(): AppAttentionSource {
  let snapshot = createIdleAppAttentionState();
  let targetPresence = 0;
  let frame: number | null = null;
  let lastFrameTimestamp: number | null = null;
  const listeners = new Set<() => void>();

  function emit(next: AppAttentionState): void {
    if (!shouldUpdateAppAttentionState(snapshot, next)) {
      return;
    }
    snapshot = next;
    for (const listener of listeners) {
      listener();
    }
  }

  function schedulePresenceFrame(): void {
    if (frame !== null) {
      return;
    }
    const tick = (timestamp: number) => {
      frame = null;
      const dtSec = lastFrameTimestamp === null
        ? DEFAULT_FRAME_DT_SEC
        : Math.min(MAX_FRAME_DT_SEC, Math.max(0, (timestamp - lastFrameTimestamp) / 1000));
      lastFrameTimestamp = timestamp;
      const nextPresence = easePresence(snapshot.presence, targetPresence, dtSec);
      emit({
        ...snapshot,
        presence: nextPresence,
        active: nextPresence > PRESENCE_SETTLE_EPSILON,
      });
      if (nextPresence !== targetPresence) {
        frame = window.requestAnimationFrame(tick);
      } else {
        lastFrameTimestamp = null;
      }
    };
    frame = window.requestAnimationFrame(tick);
  }

  function handlePointerMove(event: PointerEvent): void {
    const bootstrapPresence = snapshot.presence > 0
      ? snapshot.presence
      : ENTRY_BOOTSTRAP_PRESENCE;
    targetPresence = 1;
    emit(resolveAppAttentionStateFromViewport({
      clientX: event.clientX,
      clientY: event.clientY,
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
      },
      presence: bootstrapPresence,
    }));
    schedulePresenceFrame();
  }

  function clearAttention(): void {
    targetPresence = 0;
    emit({
      ...snapshot,
      normalizedX: 0,
      normalizedY: 0,
    });
    schedulePresenceFrame();
  }

  function handleVisibilityChange(): void {
    if (document.visibilityState === 'hidden') {
      clearAttention();
    }
  }

  function attach(): void {
    window.addEventListener('pointermove', handlePointerMove, { passive: true });
    window.addEventListener('blur', clearAttention);
    document.documentElement.addEventListener('mouseleave', clearAttention);
    document.addEventListener('visibilitychange', handleVisibilityChange);
  }

  function detach(): void {
    window.removeEventListener('pointermove', handlePointerMove);
    window.removeEventListener('blur', clearAttention);
    document.documentElement.removeEventListener('mouseleave', clearAttention);
    document.removeEventListener('visibilitychange', handleVisibilityChange);
    if (frame !== null) {
      window.cancelAnimationFrame(frame);
      frame = null;
    }
    lastFrameTimestamp = null;
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      const attachRequired = listeners.size === 0;
      listeners.add(listener);
      if (attachRequired) {
        attach();
      }
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          detach();
        }
      };
    },
  };
}

export const productionAppAttentionSource = createBrowserAppAttentionSource();
