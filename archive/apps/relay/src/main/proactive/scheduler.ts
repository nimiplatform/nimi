// Relay proactive scheduler — adapted from local-chat proactive/scheduler.ts
// Adapted: uses Node.js setTimeout instead of window.setTimeout

import type { LocalChatProactiveSchedulerInput } from './types.js';

const PROACTIVE_HEARTBEAT_MIN_MS = 30 * 60 * 1000;
const PROACTIVE_HEARTBEAT_MAX_MS = 60 * 60 * 1000;

export function randomLocalChatProactiveHeartbeatDelayMs(): number {
  const span = PROACTIVE_HEARTBEAT_MAX_MS - PROACTIVE_HEARTBEAT_MIN_MS;
  return PROACTIVE_HEARTBEAT_MIN_MS + Math.floor(Math.random() * (span + 1));
}

export function startLocalChatProactiveScheduler(
  input: LocalChatProactiveSchedulerInput,
): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  const delayFactory = input.delayMsFactory || randomLocalChatProactiveHeartbeatDelayMs;

  function clearTimer(): void {
    if (timer != null) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function resolveDelayMs(): number {
    const candidate = Number(delayFactory());
    if (!Number.isFinite(candidate) || candidate < 0) {
      return randomLocalChatProactiveHeartbeatDelayMs();
    }
    return Math.round(candidate);
  }

  async function tick(): Promise<void> {
    if (stopped) return;
    try {
      await input.runCycle();
    } catch (error) {
      input.onTickFailed?.(error);
    } finally {
      if (!stopped) {
        timer = setTimeout(() => {
          void tick();
        }, resolveDelayMs());
      }
    }
  }

  timer = setTimeout(() => {
    void tick();
  }, resolveDelayMs());

  return () => {
    stopped = true;
    clearTimer();
  };
}
