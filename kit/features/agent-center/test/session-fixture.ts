import { createNimiAIScopeRef } from '@nimiplatform/sdk/ai';
import { createFirstPartyAgentCenterSession } from '../src/session.js';
import type {
  AgentCenterAppearanceAdapter,
  AgentCenterAutonomyProjection,
  AgentCenterRuntimeModelSettingsProjection,
  AgentCenterSession,
  AgentCenterStateInput,
} from '../src/types.js';

function defaultModelSettings(): AgentCenterRuntimeModelSettingsProjection {
  return {
    scopeRef: createNimiAIScopeRef({ kind: 'feature', ownerId: 'runtime.agent.model-settings', surfaceId: 'local-agent:test' }),
    capabilities: [],
    routeIntents: [],
    readiness: [],
    configurationRevision: '0',
  };
}

export async function sessionFor(
  projection: AgentCenterStateInput = {},
  appearance?: AgentCenterAppearanceAdapter | null,
): Promise<AgentCenterSession> {
  let modelSettings = projection.modelSettings || defaultModelSettings();
  const session = createFirstPartyAgentCenterSession({
    identity: {
      ownerUserId: 'owner',
      runtimeSourceRef: 'source',
      localAgentRef: 'local-agent:test',
    },
    modelSettings: {
      async snapshot() { return modelSettings; },
      async update(input) {
        modelSettings = {
          ...modelSettings,
          routeIntents: input.routeIntents,
          configurationRevision: String(BigInt(input.expectedConfigurationRevision) + 1n),
        };
        return modelSettings;
      },
    },
    autonomy: projection.autonomy ? {
      async load() { return projection.autonomy || null; },
      async update(_identity, mutation) {
        return {
          ...projection.autonomy!,
          revision: `next:${mutation.expectedRevision}`,
          enabled: mutation.enabled ?? projection.autonomy!.enabled,
          mode: (mutation.mode ?? projection.autonomy!.mode) as AgentCenterAutonomyProjection['mode'],
          dailyTokenBudget: mutation.dailyTokenBudget == null ? projection.autonomy!.dailyTokenBudget : Number(mutation.dailyTokenBudget),
          maxTokensPerHook: mutation.maxTokensPerHook == null ? projection.autonomy!.maxTokensPerHook : Number(mutation.maxTokensPerHook),
        };
      },
    } : null,
    inspect: projection.inspect ? {
      async getPublicInspect() { return projection.inspect!; },
    } as never : null,
    appearance: appearance || (projection.appearance ? {
      async load() { return projection.appearance!; },
    } : null),
    loadMemory: projection.memory ? async () => projection.memory! : undefined,
    loadSourceContextStatus: projection.sourceContextStatus ? async () => projection.sourceContextStatus! : undefined,
    loadTurnContextSummary: projection.turnContextSummary ? async () => projection.turnContextSummary! : undefined,
  });
  await session.refresh();
  return session;
}
