import type { RuntimeAgentConsumeEvent } from '@nimiplatform/sdk/runtime';

export type RuntimeAgentTimelineSummary = {
  turnId: string;
  streamId: string;
  channel: string;
  offsetMs: number;
  sequence: number;
  startedAtWall: string;
  observedAtWall: string;
  timebaseOwner: string;
  projectionRuleId: string;
  clockBasis: string;
  providerNeutral: boolean;
  appLocalAuthority: boolean;
};

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function summarizeRuntimeAgentTimeline(event: RuntimeAgentConsumeEvent): RuntimeAgentTimelineSummary | null {
  const timeline = (event as RuntimeAgentConsumeEvent & {
    timeline?: {
      turnId?: unknown;
      streamId?: unknown;
      channel?: unknown;
      offsetMs?: unknown;
      sequence?: unknown;
      startedAtWall?: unknown;
      observedAtWall?: unknown;
      timebaseOwner?: unknown;
      projectionRuleId?: unknown;
      clockBasis?: unknown;
      providerNeutral?: unknown;
      appLocalAuthority?: unknown;
    };
  }).timeline;
  if (!timeline || typeof timeline !== 'object' || Array.isArray(timeline)) {
    return null;
  }
  return {
    turnId: normalizeText(timeline.turnId),
    streamId: normalizeText(timeline.streamId),
    channel: normalizeText(timeline.channel),
    offsetMs: Number(timeline.offsetMs),
    sequence: Number(timeline.sequence),
    startedAtWall: normalizeText(timeline.startedAtWall),
    observedAtWall: normalizeText(timeline.observedAtWall),
    timebaseOwner: normalizeText(timeline.timebaseOwner),
    projectionRuleId: normalizeText(timeline.projectionRuleId),
    clockBasis: normalizeText(timeline.clockBasis),
    providerNeutral: timeline.providerNeutral === true,
    appLocalAuthority: timeline.appLocalAuthority === true,
  };
}
