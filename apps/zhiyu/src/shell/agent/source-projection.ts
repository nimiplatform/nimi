import { projectAgentCenterManagerSourceContext } from '@nimiplatform/kit/features/agent-center';
import type { NimiLocalAppAgentManagerSnapshot } from '@nimiplatform/sdk/app';
import type { ZhiyuEvidence } from '../app/evidence';

export type ZhiyuRuntimeSourceStatus = ZhiyuEvidence['source'];

export function projectZhiyuRuntimeSourceProjection(input: {
  readonly manager?: NimiLocalAppAgentManagerSnapshot | null;
  readonly error?: unknown;
}): ZhiyuRuntimeSourceStatus {
  const projected = input.error
    ? { status: 'failed' as const, source: null, context: null }
    : projectAgentCenterManagerSourceContext(input.manager);
  const ready = input.manager?.source?.ready === true
    && (projected.status === 'ready' || projected.status === 'truncated' || projected.status === 'unknown');
  return {
    transport: 'electron-ipc',
    ready,
    reasonCode: sourceProjectionReason(projected.status),
    actionHint: ready ? 'continue_runtime_local_agent' : 'refresh_runtime_local_agent_inventory',
    source: input.error ? errorSource(input.error) : 'sdk',
    message: input.error ? errorMessage(input.error) : sourceProjectionMessage(projected.status),
    projectionState: projected.status,
  };
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

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim()
    ? error.message.trim()
    : 'Runtime Manager source projection failed closed.';
}

function errorSource(error: unknown): string {
  if (!error || typeof error !== 'object') return 'sdk';
  const value = (error as Readonly<Record<string, unknown>>).source;
  return typeof value === 'string' && value.trim() ? value.trim() : 'sdk';
}
