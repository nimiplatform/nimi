import { ReasonCode } from '@nimiplatform/sdk/types';
import { logRendererEvent } from '@renderer/infra/telemetry/renderer-log';

export const STREAM_FIRST_PACKET_TIMEOUT_MS = 60_000;
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
  startedAt: number;
  firstPacketAt: number | null;
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

const activeStreams = new Map<string, StreamState>();
const abortControllers = new Map<string, AbortController>();
const firstPacketTimers = new Map<string, ReturnType<typeof setTimeout>>();
const idleTimers = new Map<string, ReturnType<typeof setTimeout>>();
const totalTimers = new Map<string, ReturnType<typeof setTimeout>>();
const terminalCleanupTimers = new Map<string, ReturnType<typeof setTimeout>>();
const listenersByChatId = new Map<string, Set<StreamListener>>();

function emptyState(chatId: string): StreamState {
  return {
    chatId,
    phase: 'idle',
    partialText: '',
    partialReasoningText: '',
    errorMessage: null,
    interrupted: false,
    startedAt: 0,
    firstPacketAt: null,
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
  const fpt = firstPacketTimers.get(chatId);
  if (fpt) {
    clearTimeout(fpt);
    firstPacketTimers.delete(chatId);
  }
  const idle = idleTimers.get(chatId);
  if (idle) {
    clearTimeout(idle);
    idleTimers.delete(chatId);
  }
  const tt = totalTimers.get(chatId);
  if (tt) {
    clearTimeout(tt);
    totalTimers.delete(chatId);
  }
}

function clearTerminalCleanup(chatId: string) {
  const cleanupTimer = terminalCleanupTimers.get(chatId);
  if (cleanupTimer) {
    clearTimeout(cleanupTimer);
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

function scheduleTerminalCleanup(chatId: string) {
  clearTerminalCleanup(chatId);
  const timer = setTimeout(() => {
    clearStream(chatId);
  }, STREAM_TERMINAL_STATE_TTL_MS);
  terminalCleanupTimers.set(chatId, timer);
}

export function getStreamState(chatId: string): StreamState {
  return activeStreams.get(chatId) || emptyState(chatId);
}

export function subscribeStream(chatId: string, listener: StreamListener): () => void;
export function subscribeStream(listener: StreamListener): () => void;
export function subscribeStream(
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

export function startStream(chatId: string, totalTimeoutMs = STREAM_TEXT_TOTAL_TIMEOUT_MS): AbortController {
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
    startedAt: Date.now(),
    firstPacketAt: null,
    lastActivityAt: null,
    idleDeadlineAt: null,
    reasonCode: null,
    traceId: null,
    cancelSource: null,
  };
  setStreamState(chatId, state);

  // First packet timeout
  const fpt = setTimeout(() => {
    const current = activeStreams.get(chatId);
    if (current?.phase === 'waiting') {
      const errorState: StreamState = {
        ...current,
        phase: 'error',
        errorMessage: `No response within ${STREAM_FIRST_PACKET_TIMEOUT_MS / 1000}s`,
        interrupted: true,
        cancelSource: 'timeout',
      };
      setStreamState(chatId, errorState);
      clearTimers(chatId);
      scheduleTerminalCleanup(chatId);
      notify(errorState);
      logRendererEvent({
        level: 'warn',
        area: 'stream-controller',
        message: 'stream:first-packet-timeout',
        details: { chatId },
      });
    }
  }, STREAM_FIRST_PACKET_TIMEOUT_MS);
  firstPacketTimers.set(chatId, fpt);

  // Total timeout
  const tt = setTimeout(() => {
    const current = activeStreams.get(chatId);
    if (current && (current.phase === 'waiting' || current.phase === 'streaming')) {
      const errorState: StreamState = {
        ...current,
        phase: 'error',
        errorMessage: `Stream timed out after ${totalTimeoutMs / 1000}s`,
        interrupted: true,
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
  }, totalTimeoutMs);
  totalTimers.set(chatId, tt);

  notify(state);
  return abortController;
}

function hasPartialContent(state: StreamState): boolean {
  return state.partialText.length > 0 || state.partialReasoningText.length > 0;
}

function resetIdleTimeout(chatId: string, abortController: AbortController) {
  const existing = idleTimers.get(chatId);
  if (existing) {
    clearTimeout(existing);
  }

  const idleDeadlineAt = Date.now() + STREAM_IDLE_TIMEOUT_MS;
  const current = activeStreams.get(chatId);
  if (current && (current.phase === 'waiting' || current.phase === 'streaming')) {
    setStreamState(chatId, {
      ...current,
      idleDeadlineAt,
    });
  }

  const timer = setTimeout(() => {
    const latest = activeStreams.get(chatId);
    if (!latest || (latest.phase !== 'waiting' && latest.phase !== 'streaming')) {
      return;
    }
    const errorState: StreamState = {
      ...latest,
      phase: 'error',
      errorMessage: `No stream activity within ${STREAM_IDLE_TIMEOUT_MS / 1000}s`,
      interrupted: hasPartialContent(latest),
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
  }, STREAM_IDLE_TIMEOUT_MS);

  idleTimers.set(chatId, timer);
}

export function feedStreamEvent(chatId: string, event: StreamEvent) {
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
    const now = Date.now();
    const updated: StreamState = {
      ...current,
      firstPacketAt: current.firstPacketAt ?? now,
      lastActivityAt: now,
      idleDeadlineAt: now + STREAM_IDLE_TIMEOUT_MS,
    };
    setStreamState(chatId, updated);
    if (current.phase === 'waiting') {
      const fpt = firstPacketTimers.get(chatId);
      if (fpt) {
        clearTimeout(fpt);
        firstPacketTimers.delete(chatId);
      }
    }
    const abortController = abortControllers.get(chatId);
    if (abortController) {
      resetIdleTimeout(chatId, abortController);
    }
    notify(updated);
    return;
  }

  if (event.type === 'text_delta' || event.type === 'reasoning_delta') {
    const isFirst = current.phase === 'waiting';
    const now = Date.now();
    const updated: StreamState = {
      ...current,
      phase: 'streaming',
      partialText: event.type === 'text_delta'
        ? current.partialText + event.textDelta
        : current.partialText,
      partialReasoningText: event.type === 'reasoning_delta'
        ? current.partialReasoningText + event.textDelta
        : current.partialReasoningText,
      firstPacketAt: isFirst ? now : current.firstPacketAt,
      lastActivityAt: now,
      idleDeadlineAt: now + STREAM_IDLE_TIMEOUT_MS,
    };
    setStreamState(chatId, updated);

    // Clear first-packet timer on first delta
    if (isFirst) {
      const fpt = firstPacketTimers.get(chatId);
      if (fpt) {
        clearTimeout(fpt);
        firstPacketTimers.delete(chatId);
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
    const now = Date.now();
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
      firstPacketAt: current.firstPacketAt ?? (hasTerminalContent ? now : null),
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

export function cancelStream(chatId: string) {
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

export function clearStream(chatId: string) {
  activeStreams.delete(chatId);
  abortControllers.delete(chatId);
  clearTimers(chatId);
  clearTerminalCleanup(chatId);
}

export function clearAllStreams() {
  for (const chatId of Array.from(activeStreams.keys())) {
    clearStream(chatId);
  }
  listenersByChatId.clear();
}
