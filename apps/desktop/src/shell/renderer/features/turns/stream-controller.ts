import { ReasonCode } from '@nimiplatform/sdk/types';
import { logRendererEvent } from '@nimiplatform/kit/telemetry';
import type { DesktopRendererClockView } from '../../renderer/contract.js';

export const STREAM_FIRST_CONTENT_WARNING_DELAY_MS = 10_000;
export const STREAM_IDLE_TIMEOUT_MS = 30_000;
export const STREAM_TEXT_TOTAL_TIMEOUT_MS = 120_000;
export const STREAM_SPEECH_TOTAL_TIMEOUT_MS = 45_000;
export const STREAM_VIDEO_TOTAL_TIMEOUT_MS = 300_000;
export const STREAM_TERMINAL_STATE_TTL_MS = 60_000;
export const STREAM_MAX_CACHED_STATES = 50;

export type StreamPhase = 'idle' | 'waiting' | 'streaming' | 'done' | 'error' | 'cancelled';

export type StreamCancelSource = 'user' | 'timeout' | 'backpressure';

export type StreamState = {
  chatId: string;
  phase: StreamPhase;
  partialText: string;
  partialReasoningText: string;
  errorMessage: string | null;
  interrupted: boolean;
  firstContentWarning: boolean;
  startedAt: number;
  firstContentChunkAt: number | null;
  lastActivityAt: number | null;
  idleDeadlineAt: number | null;
  reasonCode: string | null;
  traceId: string | null;
  cancelSource: StreamCancelSource | null;
};

export type StreamEvent =
  | { type: 'reasoning_delta'; textDelta: string }
  | { type: 'text_delta'; textDelta: string }
  | { type: 'keepalive' }
  | {
    type: 'done';
    usage?: { inputTokens?: number; outputTokens?: number };
    finalText?: string;
    finalReasoningText?: string;
  }
  | { type: 'error'; message: string; reasonCode?: string; traceId?: string };

type StreamListener = (state: StreamState) => void;

export interface StreamController {
  getStreamState(chatId: string): StreamState;
  subscribeStream(chatId: string, listener: StreamListener): () => void;
  subscribeStream(listener: StreamListener): () => void;
  startStream(chatId: string, totalTimeoutMs?: number): AbortController;
  rearmTotalTimeout(chatId: string, totalTimeoutMs?: number): boolean;
  feedStreamEvent(chatId: string, event: StreamEvent): void;
  startKeepalive(chatId: string, intervalMs: number): () => void;
  cancelStream(chatId: string): void;
  clearStream(chatId: string): void;
  clearAllStreams(): void;
  dispose(): void;
}

// @nimi-authority: definition.nimi.desktop.ai-consumption.streaming
// @nimi-authority: rule.nimi.desktop.ai-consumption.r051
// @nimi-authority: rule.nimi.desktop.ai-consumption.r055
export function createStreamController(clock: DesktopRendererClockView): StreamController {
const activeStreams = new Map<string, StreamState>();
const abortControllers = new Map<string, AbortController>();
const firstContentWarningTimers = new Map<string, () => void>();
const idleTimers = new Map<string, () => void>();
const totalTimers = new Map<string, () => void>();
const totalTimeoutDurations = new Map<string, number>();
const terminalCleanupTimers = new Map<string, () => void>();
const listenersByChatId = new Map<string, Set<StreamListener>>();

function emptyState(chatId: string): StreamState {
  return {
    chatId,
    phase: 'idle',
    partialText: '',
    partialReasoningText: '',
    errorMessage: null,
    interrupted: false,
    firstContentWarning: false,
    startedAt: 0,
    firstContentChunkAt: null,
    lastActivityAt: null,
    idleDeadlineAt: null,
    reasonCode: null,
    traceId: null,
    cancelSource: null,
  };
}

function notify(state: StreamState) {
  const listeners = [
    ...(listenersByChatId.get(state.chatId) || []),
    ...(listenersByChatId.get('*') || []),
  ];
  if (listeners.length === 0) {
    return;
  }
  for (const listener of listeners) {
    try {
      listener(state);
    } catch {
      // swallow listener errors
    }
  }
}

function clearTimers(chatId: string) {
  const firstContentWarningTimer = firstContentWarningTimers.get(chatId);
  if (firstContentWarningTimer) {
    firstContentWarningTimer();
    firstContentWarningTimers.delete(chatId);
  }
  const idle = idleTimers.get(chatId);
  if (idle) {
    idle();
    idleTimers.delete(chatId);
  }
  const tt = totalTimers.get(chatId);
  if (tt) {
    tt();
    totalTimers.delete(chatId);
  }
  totalTimeoutDurations.delete(chatId);
}

function clearTerminalCleanup(chatId: string) {
  const cleanupTimer = terminalCleanupTimers.get(chatId);
  if (cleanupTimer) {
    cleanupTimer();
    terminalCleanupTimers.delete(chatId);
  }
}

function isTerminalPhase(phase: StreamPhase): boolean {
  return phase === 'done' || phase === 'error' || phase === 'cancelled';
}

function enforceStreamCacheLimit() {
  if (activeStreams.size <= STREAM_MAX_CACHED_STATES) {
    return;
  }

  for (const [chatId, state] of activeStreams) {
    if (activeStreams.size <= STREAM_MAX_CACHED_STATES) {
      return;
    }
    if (isTerminalPhase(state.phase)) {
      clearStream(chatId);
    }
  }

  while (activeStreams.size > STREAM_MAX_CACHED_STATES) {
    const oldest = activeStreams.keys().next();
    if (oldest.done || oldest.value == null) {
      return;
    }
    clearStream(oldest.value);
  }
}

function setStreamState(chatId: string, state: StreamState) {
  activeStreams.delete(chatId);
  activeStreams.set(chatId, state);
  enforceStreamCacheLimit();
}

function failClockSchedule(chatId: string, error: string) {
  const current = activeStreams.get(chatId);
  if (!current || isTerminalPhase(current.phase)) return;
  const failed: StreamState = {
    ...current,
    phase: 'error',
    errorMessage: `Renderer clock rejected stream timer: ${error}`,
    interrupted: hasPartialContent(current),
    firstContentWarning: false,
    reasonCode: 'DESKTOP_RENDERER_CLOCK_REJECTED',
    cancelSource: 'timeout',
  };
  setStreamState(chatId, failed);
  clearTimers(chatId);
  const abortController = abortControllers.get(chatId);
  abortController?.abort();
  abortControllers.delete(chatId);
  notify(failed);
  logRendererEvent({
    level: 'error',
    area: 'stream-controller',
    message: 'stream:clock-rejected',
    details: { chatId, error },
  });
}

function scheduleTimer(chatId: string, delayMs: number, onElapsed: () => void): () => void {
  return clock.schedule(delayMs, (result) => {
    if (!result.ok) {
      failClockSchedule(chatId, result.error);
      return;
    }
    onElapsed();
  });
}

function scheduleTerminalCleanup(chatId: string) {
  clearTerminalCleanup(chatId);
  const timer = scheduleTimer(chatId, STREAM_TERMINAL_STATE_TTL_MS, () => {
    clearStream(chatId);
  });
  terminalCleanupTimers.set(chatId, timer);
}

function getStreamState(chatId: string): StreamState {
  return activeStreams.get(chatId) || emptyState(chatId);
}

function subscribeStream(chatId: string, listener: StreamListener): () => void;
function subscribeStream(listener: StreamListener): () => void;
function subscribeStream(
  chatIdOrListener: string | StreamListener,
  maybeListener?: StreamListener,
): () => void {
  const chatId = typeof chatIdOrListener === 'string' ? chatIdOrListener : '*';
  const listener = typeof chatIdOrListener === 'function' ? chatIdOrListener : maybeListener;
  if (!listener) {
    return () => undefined;
  }
  const currentListeners = listenersByChatId.get(chatId);
  if (currentListeners) {
    currentListeners.add(listener);
  } else {
    listenersByChatId.set(chatId, new Set([listener]));
  }
  return () => {
    const activeListeners = listenersByChatId.get(chatId);
    if (!activeListeners) {
      return;
    }
    activeListeners.delete(listener);
    if (activeListeners.size === 0) {
      listenersByChatId.delete(chatId);
    }
  };
}

function startStream(chatId: string, totalTimeoutMs = STREAM_TEXT_TOTAL_TIMEOUT_MS): AbortController {
  // Concurrent protection: cancel existing stream for this chat
  const existing = activeStreams.get(chatId);
  if (existing && (existing.phase === 'waiting' || existing.phase === 'streaming')) {
    cancelStream(chatId);
  }

  const abortController = new AbortController();
  abortControllers.set(chatId, abortController);
  clearTerminalCleanup(chatId);

  const state: StreamState = {
    chatId,
    phase: 'waiting',
    partialText: '',
    partialReasoningText: '',
    errorMessage: null,
    interrupted: false,
    firstContentWarning: false,
    startedAt: clock.now(),
    firstContentChunkAt: null,
    lastActivityAt: null,
    idleDeadlineAt: null,
    reasonCode: null,
    traceId: null,
    cancelSource: null,
  };
  setStreamState(chatId, state);

  // @nimi-authority: rule.nimi.desktop.ai-consumption.r054
  const firstContentWarningTimer = scheduleTimer(chatId, STREAM_FIRST_CONTENT_WARNING_DELAY_MS, () => {
    firstContentWarningTimers.delete(chatId);
    const current = activeStreams.get(chatId);
    if (current?.phase === 'waiting' && current.firstContentChunkAt === null) {
      const warningState: StreamState = {
        ...current,
        firstContentWarning: true,
      };
      setStreamState(chatId, warningState);
      notify(warningState);
      logRendererEvent({
        level: 'warn',
        area: 'stream-controller',
        message: 'stream:first-content-warning',
        details: { chatId },
      });
    }
  });
  firstContentWarningTimers.set(chatId, firstContentWarningTimer);

  totalTimeoutDurations.set(chatId, totalTimeoutMs);

  notify(state);
  return abortController;
}

function scheduleTotalTimeout(
  chatId: string,
  totalTimeoutMs: number,
  abortController: AbortController,
) {
  const existing = totalTimers.get(chatId);
  if (existing) {
    existing();
    totalTimers.delete(chatId);
  }
  totalTimeoutDurations.set(chatId, totalTimeoutMs);
  const timer = scheduleTimer(chatId, totalTimeoutMs, () => {
    const current = activeStreams.get(chatId);
    if (current?.phase === 'streaming') {
      const errorState: StreamState = {
        ...current,
        phase: 'error',
        errorMessage: `Stream timed out after ${totalTimeoutMs / 1000}s`,
        interrupted: true,
        firstContentWarning: false,
        cancelSource: 'timeout',
      };
      setStreamState(chatId, errorState);
      clearTimers(chatId);
      abortController.abort();
      abortControllers.delete(chatId);
      scheduleTerminalCleanup(chatId);
      notify(errorState);
      logRendererEvent({
        level: 'warn',
        area: 'stream-controller',
        message: 'stream:total-timeout',
        details: { chatId, totalTimeoutMs },
      });
    }
  });
  totalTimers.set(chatId, timer);
}

function rearmTotalTimeout(
  chatId: string,
  totalTimeoutMs = STREAM_TEXT_TOTAL_TIMEOUT_MS,
): boolean {
  const current = activeStreams.get(chatId);
  const abortController = abortControllers.get(chatId);
  if (
    !current
    || (current.phase !== 'waiting' && current.phase !== 'streaming')
    || !abortController
  ) {
    return false;
  }
  if (current.phase === 'waiting') {
    totalTimeoutDurations.set(chatId, totalTimeoutMs);
  } else {
    scheduleTotalTimeout(chatId, totalTimeoutMs, abortController);
  }
  logRendererEvent({
    level: 'info',
    area: 'stream-controller',
    message: 'stream:total-timeout-rearmed',
    details: {
      chatId,
      totalTimeoutMs,
      elapsedBeforeRearmMs: Math.max(0, clock.now() - current.startedAt),
      deferredUntilFirstContent: current.phase === 'waiting',
    },
  });
  return true;
}

function hasPartialContent(state: StreamState): boolean {
  return state.partialText.length > 0 || state.partialReasoningText.length > 0;
}

function resetIdleTimeout(chatId: string, abortController: AbortController) {
  const existing = idleTimers.get(chatId);
  if (existing) {
    existing();
    idleTimers.delete(chatId);
  }

  const current = activeStreams.get(chatId);
  if (current?.phase !== 'streaming') {
    return;
  }
  const idleDeadlineAt = clock.now() + STREAM_IDLE_TIMEOUT_MS;
  setStreamState(chatId, {
    ...current,
    idleDeadlineAt,
  });

  const timer = scheduleTimer(chatId, STREAM_IDLE_TIMEOUT_MS, () => {
    const latest = activeStreams.get(chatId);
    if (latest?.phase !== 'streaming') {
      return;
    }
    const errorState: StreamState = {
      ...latest,
      phase: 'error',
      errorMessage: `No stream activity within ${STREAM_IDLE_TIMEOUT_MS / 1000}s`,
      interrupted: hasPartialContent(latest),
      firstContentWarning: false,
      cancelSource: 'timeout',
    };
    setStreamState(chatId, errorState);
    clearTimers(chatId);
    abortController.abort();
    abortControllers.delete(chatId);
    scheduleTerminalCleanup(chatId);
    notify(errorState);
    logRendererEvent({
      level: 'warn',
      area: 'stream-controller',
      message: 'stream:idle-timeout',
      details: { chatId, idleTimeoutMs: STREAM_IDLE_TIMEOUT_MS },
    });
  });

  idleTimers.set(chatId, timer);
}

function feedStreamEvent(chatId: string, event: StreamEvent) {
  const current = activeStreams.get(chatId);
  const canRecoverTimeoutWithTerminal = Boolean(
    current
    && current.phase === 'error'
    && current.cancelSource === 'timeout'
    && event.type === 'done',
  );

  if (
    !current
    || (
      current.phase !== 'waiting'
      && current.phase !== 'streaming'
      && !canRecoverTimeoutWithTerminal
    )
  ) {
    return;
  }

  if (event.type === 'keepalive') {
    const now = clock.now();
    const updated: StreamState = {
      ...current,
      lastActivityAt: now,
      idleDeadlineAt: current.phase === 'streaming'
        ? now + STREAM_IDLE_TIMEOUT_MS
        : null,
    };
    setStreamState(chatId, updated);
    const abortController = abortControllers.get(chatId);
    if (abortController && current.phase === 'streaming') {
      resetIdleTimeout(chatId, abortController);
    }
    notify(updated);
    return;
  }

  if (event.type === 'text_delta' || event.type === 'reasoning_delta') {
    const isFirstContentChunk = current.firstContentChunkAt === null;
    const now = clock.now();
    const updated: StreamState = {
      ...current,
      phase: 'streaming',
      partialText: event.type === 'text_delta'
        ? current.partialText + event.textDelta
        : current.partialText,
      partialReasoningText: event.type === 'reasoning_delta'
        ? current.partialReasoningText + event.textDelta
        : current.partialReasoningText,
      firstContentWarning: false,
      firstContentChunkAt: isFirstContentChunk ? now : current.firstContentChunkAt,
      lastActivityAt: now,
      idleDeadlineAt: now + STREAM_IDLE_TIMEOUT_MS,
    };
    setStreamState(chatId, updated);

    if (isFirstContentChunk) {
      const warningTimer = firstContentWarningTimers.get(chatId);
      if (warningTimer) {
        warningTimer();
        firstContentWarningTimers.delete(chatId);
      }
      const totalTimeoutMs = totalTimeoutDurations.get(chatId);
      const abortController = abortControllers.get(chatId);
      if (totalTimeoutMs && abortController) {
        scheduleTotalTimeout(chatId, totalTimeoutMs, abortController);
      }
    }
    const abortController = abortControllers.get(chatId);
    if (abortController) {
      resetIdleTimeout(chatId, abortController);
    }

    notify(updated);
    return;
  }

  if (event.type === 'done') {
    const now = clock.now();
    const finalText = typeof event.finalText === 'string'
      ? event.finalText
      : current.partialText;
    const finalReasoningText = typeof event.finalReasoningText === 'string'
      ? event.finalReasoningText
      : current.partialReasoningText;
    const hasTerminalContent = finalText.length > 0 || finalReasoningText.length > 0;
    const doneState: StreamState = {
      ...current,
      phase: 'done',
      partialText: finalText,
      partialReasoningText: finalReasoningText,
      errorMessage: null,
      interrupted: false,
      firstContentWarning: false,
      lastActivityAt: hasTerminalContent ? now : current.lastActivityAt,
      idleDeadlineAt: null,
      cancelSource: null,
    };
    setStreamState(chatId, doneState);
    clearTimers(chatId);
    abortControllers.delete(chatId);
    scheduleTerminalCleanup(chatId);
    notify(doneState);
    if (canRecoverTimeoutWithTerminal) {
      logRendererEvent({
        level: 'info',
        area: 'stream-controller',
        message: 'stream:late-terminal-recovery',
        details: { chatId },
      });
    }
    return;
  }

  if (event.type === 'error') {
    const reasonCode = event.reasonCode ?? null;
    const isBackpressure =
      reasonCode === ReasonCode.RESOURCE_EXHAUSTED || reasonCode === ReasonCode.RUNTIME_GRPC_CANCELLED;

    if (isBackpressure) {
      // D-STRM-009: backpressure interruption — preserve partial content
      const backpressureState: StreamState = {
        ...current,
        phase: 'cancelled',
        cancelSource: 'backpressure',
        interrupted: hasPartialContent(current),
        firstContentWarning: false,
        reasonCode,
        traceId: event.traceId ?? current.traceId,
      };
      setStreamState(chatId, backpressureState);
      clearTimers(chatId);
      abortControllers.delete(chatId);
      scheduleTerminalCleanup(chatId);
      notify(backpressureState);
      return;
    }

    const errorState: StreamState = {
      ...current,
      phase: 'error',
      errorMessage: event.message,
      interrupted: hasPartialContent(current),
      firstContentWarning: false,
      reasonCode,
      traceId: event.traceId ?? current.traceId,
    };
    setStreamState(chatId, errorState);
    clearTimers(chatId);
    abortControllers.delete(chatId);
    scheduleTerminalCleanup(chatId);
    notify(errorState);
    return;
  }
}

function startKeepalive(chatId: string, intervalMs: number): () => void {
  let cancelled = false;
  let cancelPending: () => void = () => undefined;
  const scheduleNext = () => {
    cancelPending = scheduleTimer(chatId, intervalMs, () => {
      if (cancelled) return;
      feedStreamEvent(chatId, { type: 'keepalive' });
      scheduleNext();
    });
  };
  scheduleNext();
  return () => {
    if (cancelled) return;
    cancelled = true;
    cancelPending();
  };
}

function cancelStream(chatId: string) {
  const current = activeStreams.get(chatId);
  if (!current || (current.phase !== 'waiting' && current.phase !== 'streaming')) {
    return;
  }

  const ac = abortControllers.get(chatId);
  if (ac) {
    ac.abort();
    abortControllers.delete(chatId);
  }

  const cancelledState: StreamState = {
    ...current,
    phase: 'cancelled',
    interrupted: hasPartialContent(current),
    firstContentWarning: false,
    cancelSource: 'user',
  };
  setStreamState(chatId, cancelledState);
  clearTimers(chatId);
  scheduleTerminalCleanup(chatId);
  notify(cancelledState);

  logRendererEvent({
    level: 'info',
    area: 'stream-controller',
    message: 'stream:cancelled',
    details: {
      chatId,
      partialLength: current.partialText.length,
      partialReasoningLength: current.partialReasoningText.length,
    },
  });
}

function clearStream(chatId: string) {
  activeStreams.delete(chatId);
  abortControllers.get(chatId)?.abort();
  abortControllers.delete(chatId);
  clearTimers(chatId);
  clearTerminalCleanup(chatId);
}

function clearAllStreams() {
  for (const chatId of Array.from(activeStreams.keys())) {
    clearStream(chatId);
  }
  listenersByChatId.clear();
}

return Object.freeze({
  getStreamState,
  subscribeStream,
  startStream,
  rearmTotalTimeout,
  feedStreamEvent,
  startKeepalive,
  cancelStream,
  clearStream,
  clearAllStreams,
  dispose: clearAllStreams,
});
}
