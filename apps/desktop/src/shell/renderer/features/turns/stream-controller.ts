import { ReasonCode } from '@nimiplatform/sdk/types';
import { logRendererEvent } from '@renderer/infra/telemetry/renderer-log';

export const STREAM_FIRST_PACKET_TIMEOUT_MS = 10_000;
export const STREAM_TEXT_TOTAL_TIMEOUT_MS = 120_000;
export const STREAM_SPEECH_TOTAL_TIMEOUT_MS = 45_000;
export const STREAM_VIDEO_TOTAL_TIMEOUT_MS = 300_000;

export type StreamPhase = 'idle' | 'waiting' | 'streaming' | 'done' | 'error' | 'cancelled';

export type StreamCancelSource = 'user' | 'timeout' | 'backpressure';

export type StreamState = {
  chatId: string;
  phase: StreamPhase;
  partialText: string;
  errorMessage: string | null;
  interrupted: boolean;
  startedAt: number;
  firstPacketAt: number | null;
  reasonCode: string | null;
  traceId: string | null;
  cancelSource: StreamCancelSource | null;
};

export type StreamEvent =
  | { type: 'text_delta'; textDelta: string }
  | { type: 'done'; usage?: { inputTokens?: number; outputTokens?: number } }
  | { type: 'error'; message: string; reasonCode?: string; traceId?: string };

type StreamListener = (state: StreamState) => void;

const activeStreams = new Map<string, StreamState>();
const abortControllers = new Map<string, AbortController>();
const firstPacketTimers = new Map<string, ReturnType<typeof setTimeout>>();
const totalTimers = new Map<string, ReturnType<typeof setTimeout>>();
const listeners = new Set<StreamListener>();

function emptyState(chatId: string): StreamState {
  return {
    chatId,
    phase: 'idle',
    partialText: '',
    errorMessage: null,
    interrupted: false,
    startedAt: 0,
    firstPacketAt: null,
    reasonCode: null,
    traceId: null,
    cancelSource: null,
  };
}

function notify(state: StreamState) {
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
  const tt = totalTimers.get(chatId);
  if (tt) {
    clearTimeout(tt);
    totalTimers.delete(chatId);
  }
}

export function getStreamState(chatId: string): StreamState {
  return activeStreams.get(chatId) || emptyState(chatId);
}

export function subscribeStream(listener: StreamListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function startStream(chatId: string, totalTimeoutMs = STREAM_TEXT_TOTAL_TIMEOUT_MS): AbortController {
  // Concurrent protection: cancel existing stream for this chat
  const existing = activeStreams.get(chatId);
  if (existing && (existing.phase === 'waiting' || existing.phase === 'streaming')) {
    cancelStream(chatId);
  }

  const abortController = new AbortController();
  abortControllers.set(chatId, abortController);

  const state: StreamState = {
    chatId,
    phase: 'waiting',
    partialText: '',
    errorMessage: null,
    interrupted: false,
    startedAt: Date.now(),
    firstPacketAt: null,
    reasonCode: null,
    traceId: null,
    cancelSource: null,
  };
  activeStreams.set(chatId, state);

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
      activeStreams.set(chatId, errorState);
      clearTimers(chatId);
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
      activeStreams.set(chatId, errorState);
      clearTimers(chatId);
      abortController.abort();
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

export function feedStreamEvent(chatId: string, event: StreamEvent) {
  const current = activeStreams.get(chatId);
  if (!current || (current.phase !== 'waiting' && current.phase !== 'streaming')) {
    return;
  }

  if (event.type === 'text_delta') {
    const isFirst = current.phase === 'waiting';
    const updated: StreamState = {
      ...current,
      phase: 'streaming',
      partialText: current.partialText + event.textDelta,
      firstPacketAt: isFirst ? Date.now() : current.firstPacketAt,
    };
    activeStreams.set(chatId, updated);

    // Clear first-packet timer on first delta
    if (isFirst) {
      const fpt = firstPacketTimers.get(chatId);
      if (fpt) {
        clearTimeout(fpt);
        firstPacketTimers.delete(chatId);
      }
    }

    notify(updated);
    return;
  }

  if (event.type === 'done') {
    const doneState: StreamState = {
      ...current,
      phase: 'done',
    };
    activeStreams.set(chatId, doneState);
    clearTimers(chatId);
    abortControllers.delete(chatId);
    notify(doneState);
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
        interrupted: true,
        reasonCode,
        traceId: event.traceId ?? current.traceId,
      };
      activeStreams.set(chatId, backpressureState);
      clearTimers(chatId);
      abortControllers.delete(chatId);
      notify(backpressureState);
      return;
    }

    const errorState: StreamState = {
      ...current,
      phase: 'error',
      errorMessage: event.message,
      interrupted: current.partialText.length > 0,
      reasonCode,
      traceId: event.traceId ?? current.traceId,
    };
    activeStreams.set(chatId, errorState);
    clearTimers(chatId);
    abortControllers.delete(chatId);
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
    interrupted: current.partialText.length > 0,
    cancelSource: 'user',
  };
  activeStreams.set(chatId, cancelledState);
  clearTimers(chatId);
  notify(cancelledState);

  logRendererEvent({
    level: 'info',
    area: 'stream-controller',
    message: 'stream:cancelled',
    details: { chatId, partialLength: current.partialText.length },
  });
}

export function clearStream(chatId: string) {
  activeStreams.delete(chatId);
  abortControllers.delete(chatId);
  clearTimers(chatId);
}
