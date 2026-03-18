// Relay logging — adapted from local-chat logging.ts
// Replaced: emitLocalChatLog/logRendererEvent from SDK with console.log

import type { LocalChatTarget, SegmentParseMode } from './types.js';

export function createLocalChatFlowId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function emitLocalChatLog(options: {
  level?: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  flowId?: string;
  source?: string;
  costMs?: number;
  details?: Record<string, unknown>;
}): void {
  const { level = 'info', message, details } = options;
  const consoleMethod = level === 'debug'
    ? console.debug
    : level === 'warn'
      ? console.warn
      : level === 'error'
        ? console.error
        : console.info;
  consoleMethod(`[relay:local-chat] ${message}`, details || {});
}

export function logTurnSendStart(input: {
  flowId: string;
  target: LocalChatTarget;
  sessionId: string;
  turnTxnId: string;
}): void {
  console.info('[relay:local-chat] send-turn:start', {
    targetId: input.target.id,
    worldId: input.target.worldId,
    sessionId: input.sessionId,
    turnTxnId: input.turnTxnId,
  });
}

export function logTurnSendDone(input: {
  flowId: string;
  target: LocalChatTarget;
  latencyMs: number;
  turnTxnId: string;
  planId: string;
  followupSent: boolean;
  segmentCount: number;
  textSegments: number;
  voiceSegments: number;
  schedulerTotalDelayMs: number;
  streamDeltaCount: number;
  streamDurationMs: number;
  segmentParseMode: SegmentParseMode;
}): void {
  console.info('[relay:local-chat] send-turn:done', {
    targetId: input.target.id,
    worldId: input.target.worldId,
    latencyMs: input.latencyMs,
    turnTxnId: input.turnTxnId,
    planId: input.planId,
    planner: 'stream',
    followupSent: input.followupSent,
    segmentCount: input.segmentCount,
    textSegments: input.textSegments,
    voiceSegments: input.voiceSegments,
    schedulerTotalDelayMs: input.schedulerTotalDelayMs,
    streamDeltaCount: input.streamDeltaCount,
    streamDurationMs: input.streamDurationMs,
    segmentParseMode: input.segmentParseMode,
  });
}

export function logTurnScheduleCancelled(input: {
  flowId: string;
  target: LocalChatTarget;
  turnTxnId: string;
  planId: string;
  segmentCount: number;
  textSegments: number;
  voiceSegments: number;
  schedulerTotalDelayMs: number;
  cancelReason: string;
  deliveredCount: number;
  pendingCount: number;
}): void {
  console.info('[relay:local-chat] send-turn:schedule-cancelled', {
    targetId: input.target.id,
    worldId: input.target.worldId,
    turnTxnId: input.turnTxnId,
    planId: input.planId,
    segmentCount: input.segmentCount,
    textSegments: input.textSegments,
    voiceSegments: input.voiceSegments,
    schedulerTotalDelayMs: input.schedulerTotalDelayMs,
    cancelReason: input.cancelReason,
    deliveredCount: input.deliveredCount,
    pendingCount: input.pendingCount,
  });
}

export function logTurnSendFailed(flowId: string, message: string): void {
  console.error('[relay:local-chat] send-turn:failed', { flowId, error: message });
}
