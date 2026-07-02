import { hasElectronRuntime } from '@nimiplatform/kit/shell/renderer/bridge';
import {
  createNimiRuntimeAgentClient,
  Runtime,
  type NimiRuntimeAgentDiscoveredLocalAgent,
} from '@nimiplatform/sdk/runtime';
import type { ZhiyuEvidence } from '../app/evidence';
import {
  normalizeZhiyuLocalAgentDiscoveryInput,
  type ZhiyuLocalAgentDiscoveryInput,
  type ZhiyuLocalAgentDiscoveryProjection,
} from './local-agent-discovery-input';
import { withZhiyuElectronRuntimeProtectedScopes } from './runtime-agent-scopes';

export type ZhiyuLocalAgentStatus = ZhiyuEvidence['localAgent'];

export async function probeZhiyuLocalAgentDiscovery(
  input: ZhiyuLocalAgentDiscoveryInput = {},
): Promise<ZhiyuLocalAgentStatus> {
  if (typeof window === 'undefined' || !hasElectronRuntime()) {
    return localAgentUnavailable({
      reasonCode: 'electron-runtime-bridge-unavailable',
      actionHint: 'restart_zhiyu_electron_shell',
      source: 'renderer',
      message: 'Electron Runtime bridge is not available.',
    });
  }

  const projection = normalizeDiscoveryInput(input);
  if (!projection) {
    return localAgentUnavailable({
      reasonCode: 'zhiyu-runtime-source-required',
      actionHint: 'provide_admitted_runtime_source_projection',
      source: 'renderer',
      message: 'Zhiyu requires an admitted Runtime source projection before LocalAgent discovery.',
    });
  }

  const runtime = new Runtime({
    appId: 'nimi.zhiyu',
    transport: { type: 'electron-ipc' },
  });
  const client = createNimiRuntimeAgentClient({
    runtime,
    appId: 'nimi.zhiyu',
    getSubjectUserId: () => projection.ownerUserId,
    withScopes: withZhiyuElectronRuntimeProtectedScopes,
  });

  try {
    const discovered = await client.discoverBySource(projection);
    const first = discovered[0];
    if (!first) {
      return localAgentUnavailable({
        reasonCode: 'zhiyu-local-agent-not-found',
        actionHint: 'materialize_runtime_owned_local_agent',
        source: 'runtime',
        message: 'Runtime inventory has no active LocalAgent for the admitted source projection.',
        ownerUserId: projection.ownerUserId,
        runtimeSourceRef: projection.runtimeSourceRef ?? null,
      });
    }
    return discoveredLocalAgentStatus(first);
  } catch (error) {
    return normalizeDiscoveryError(error);
  }
}

function discoveredLocalAgentStatus(agent: NimiRuntimeAgentDiscoveredLocalAgent): ZhiyuLocalAgentStatus {
  return {
    transport: 'electron-ipc',
    ready: true,
    reasonCode: 'local-agent-discovered',
    actionHint: 'open_runtime_agent_home',
    source: 'runtime',
    message: 'Runtime-owned LocalAgent was discovered from Runtime inventory.',
    ownerUserId: agent.ownerUserId,
    runtimeSourceRef: agent.runtimeSourceRef,
    localAgentRef: agent.localAgentRef,
  };
}

function normalizeDiscoveryInput(input: ZhiyuLocalAgentDiscoveryInput): ZhiyuLocalAgentDiscoveryProjection | null {
  return normalizeZhiyuLocalAgentDiscoveryInput(input);
}

function normalizeDiscoveryError(error: unknown): ZhiyuLocalAgentStatus {
  const record = error && typeof error === 'object' ? error as Record<string, unknown> : {};
  return localAgentUnavailable({
    reasonCode: stringOr(record.reasonCode, 'zhiyu-local-agent-discovery-failed'),
    actionHint: stringOr(record.actionHint, 'check_runtime_agent_inventory'),
    source: stringOr(record.source, 'sdk'),
    message: error instanceof Error && error.message.trim()
      ? error.message.trim()
      : 'LocalAgent discovery failed.',
  });
}

function localAgentUnavailable(input: {
  readonly reasonCode: string;
  readonly actionHint: string;
  readonly source: string;
  readonly message: string;
  readonly ownerUserId?: string | null;
  readonly runtimeSourceRef?: string | null;
}): ZhiyuLocalAgentStatus {
  return {
    transport: 'electron-ipc',
    ready: false,
    reasonCode: input.reasonCode,
    actionHint: input.actionHint,
    source: input.source,
    message: input.message,
    ownerUserId: input.ownerUserId ?? null,
    runtimeSourceRef: input.runtimeSourceRef ?? null,
    localAgentRef: null,
  };
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}
