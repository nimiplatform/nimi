import { createNimiAIScopeRef } from '@nimiplatform/sdk/ai';
import { createFirstPartyAgentCenterSession } from '../src/session.js';
import type {
  AgentCenterAppearanceAdapter,
  AgentCenterAutonomyProjection,
  AgentCenterRuntimeAIConfigProjection,
  AgentCenterRuntimeModelConfigAdapter,
  AgentCenterSession,
  AgentCenterStateInput,
} from '../src/types.js';

function defaultAIConfig(): AgentCenterRuntimeAIConfigProjection {
  const scopeRef = createNimiAIScopeRef({ kind: 'local-agent', ownerId: 'local-agent:test' });
  return {
    aiConfig: {
      scopeRef,
      profileOrigin: null,
      capabilities: {
        logicalModelIds: {},
        targetRefs: {},
        selectedComponents: {},
        selectedParams: {},
      },
    },
    scopeRef,
    capabilities: [],
    routeIntents: [],
    readiness: [],
    configurationRevision: '0',
  };
}

export async function sessionFor(
  projection: AgentCenterStateInput = {},
  appearance?: AgentCenterAppearanceAdapter | null,
  modelConfig?: AgentCenterRuntimeModelConfigAdapter | null,
): Promise<AgentCenterSession> {
  let aiConfig = projection.aiConfig || defaultAIConfig();
  const session = createFirstPartyAgentCenterSession({
    identity: {
      ownerUserId: 'owner',
      runtimeSourceRef: 'source',
      localAgentRef: 'local-agent:test',
    },
    modelConfig,
    aiConfig: {
      async snapshot() { return aiConfig; },
      async update(input) {
        aiConfig = {
          ...aiConfig,
          aiConfig: input.config,
          configurationRevision: String(BigInt(input.expectedConfigurationRevision) + 1n),
        };
        return aiConfig;
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
