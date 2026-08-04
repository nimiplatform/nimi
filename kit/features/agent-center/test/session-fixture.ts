import { createFirstPartyAgentCenterSession } from '../src/session.js';
import type {
  AgentCenterAppearanceAdapter,
  AgentCenterAutonomyProjection,
  AgentCenterSharedAIConfigProjection,
  AgentCenterSession,
  AgentCenterStateInput,
} from '../src/types.js';

function projectIntents(
  capabilities: AgentCenterSharedAIConfigProjection['aiConfig']['capabilities'],
): AgentCenterSharedAIConfigProjection['intents'] {
  return capabilities.map((intent) => ({
    capability: intent.capabilityContract,
    route: intent.route.oneofKind === 'local' ? 'local' : 'cloud',
    requiredFeatures: [...intent.requiredFeatures],
  }));
}

function defaultAIConfig(): AgentCenterSharedAIConfigProjection {
  return {
    aiConfig: {
      owner: {
        owner: { oneofKind: 'runtimeLocalAgentSubsystem', runtimeLocalAgentSubsystem: {} },
      },
      capabilities: [],
    },
    capabilities: [],
    intents: [],
  };
}

export async function sessionFor(
  projection: AgentCenterStateInput = {},
  appearance?: AgentCenterAppearanceAdapter | null,
): Promise<AgentCenterSession> {
  let sharedAIConfig = projection.sharedAIConfig || defaultAIConfig();
  const session = createFirstPartyAgentCenterSession({
    identity: {
      ownerUserId: 'owner',
      runtimeSourceRef: 'source',
      localAgentRef: 'local-agent:test',
    },
    sharedAIConfig: {
      async get() { return sharedAIConfig; },
      async overwrite(input) {
        const capabilities = [...input.capabilities];
        sharedAIConfig = {
          aiConfig: {
            ...sharedAIConfig.aiConfig,
            capabilities,
          },
          capabilities: capabilities.map((intent) => intent.capabilityContract),
          intents: projectIntents(capabilities),
        };
        return sharedAIConfig;
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
