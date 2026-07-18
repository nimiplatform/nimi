import {
  projectAgentCenterSourceContext,
} from '@nimiplatform/kit/features/agent-center';
import type {
  NimiRuntimeAgentSourceContextStatus,
  NimiRuntimeAgentTurnContextSummary,
} from '@nimiplatform/sdk/runtime';
import type { ZhiyuEvidence } from '../app/evidence';

export type ZhiyuRuntimeSourceStatus = ZhiyuEvidence['source'];

export function projectZhiyuRuntimeSourceProjection(input: {
  readonly ownerUserId?: string | null;
  readonly runtimeSourceRef?: string | null;
  readonly localAgentRef?: string | null;
  readonly sourceContextStatus?: NimiRuntimeAgentSourceContextStatus | null;
  readonly turnContextSummary?: NimiRuntimeAgentTurnContextSummary | null;
}): ZhiyuRuntimeSourceStatus {
  const expectedLocalAgentRef = normalized(input.localAgentRef);
  const identityMismatch = Boolean(
    sourceStatusIdentity(input.sourceContextStatus) && sourceStatusIdentity(input.sourceContextStatus) !== expectedLocalAgentRef,
  );
  const projected = identityMismatch ? { status: 'failed' as const, source: null, context: null } : projectAgentCenterSourceContext({
    sourceContextStatus: input.sourceContextStatus ?? null,
    turnContextSummary: input.turnContextSummary ?? null,
  });
  const sourceStatus = input.sourceContextStatus ?? null;
  const sourceRef = sourceStatus?.sourceRef ?? null;
  const ready = sourceStatus?.ready === true
    && (projected.status === 'ready' || projected.status === 'truncated' || projected.status === 'unknown');
  return {
    transport: 'electron-ipc',
    ready,
    reasonCode: sourceProjectionReason(projected.status),
    actionHint: ready ? 'continue_runtime_local_agent' : 'refresh_runtime_local_agent_inventory',
    source: 'sdk',
    message: sourceProjectionMessage(projected.status),
    ownerUserId: normalized(input.ownerUserId),
    runtimeSourceRef: normalized(input.runtimeSourceRef),
    sourceRef,
    projectionState: projected.status,
    sourceContextStatus: sourceStatus,
    turnContextSummary: input.turnContextSummary ?? null,
  };
}

function sourceStatusIdentity(status: NimiRuntimeAgentSourceContextStatus | null | undefined): string | null {
  return status ? normalized(status.localAgentRef) : null;
}

function sourceProjectionReason(status: ZhiyuRuntimeSourceStatus['projectionState']): string {
  return `runtime-source-context-${status}`;
}

function sourceProjectionMessage(status: ZhiyuRuntimeSourceStatus['projectionState']): string {
  const copy = {
    ready: 'Runtime source snapshot and latest turn context are ready.',
    blocked: 'Runtime source or turn context requires attention.',
    truncated: 'Runtime turn context is ready with bounded omissions.',
    failed: 'Runtime source or turn context projection failed closed.',
    unknown: 'Runtime source is available; turn context has not been projected yet.',
  } as const;
  return copy[status];
}

function normalized(value: string | null | undefined): string | null {
  const text = value?.trim();
  return text || null;
}
