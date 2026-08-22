import { createFirstPartyAgentCenterSession } from '../src/session.js';
import type { ModelConfigCloudAIConfigModule } from '@nimiplatform/kit/features/model-config/headless';
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
    revision: '1',
    capabilities: [],
    intents: [],
  };
}

export async function sessionFor(
  projection: AgentCenterStateInput = {},
  appearance?: AgentCenterAppearanceAdapter | null,
  cloudAIConfig?: ModelConfigCloudAIConfigModule,
): Promise<AgentCenterSession> {
  let sharedAIConfig = projection.sharedAIConfig || defaultAIConfig();
  const session = createFirstPartyAgentCenterSession({
    identity: {
      ownerUserId: 'owner',
      runtimeSourceRef: 'source',
      localAgentRef: 'local-agent:test',
    },
    sharedAIConfig: {
      async get() {
        return {
          config: sharedAIConfig.aiConfig,
          revision: sharedAIConfig.revision,
          effectiveSelections: (projection.localSelections ?? []).map((selection) => ({
            capabilityContract: selection.capabilityContract,
            state: selection.state === 'selected' ? 'ready' as const
              : selection.state === 'missing' ? 'missing' as const
                : selection.state === 'broken' ? 'blocked' as const : 'unavailable' as const,
            resource: selection.loadoutId ? {
              oneofKind: 'local' as const,
              local: {
                loadoutRef: selection.loadoutId,
                label: selection.displayName ?? selection.loadoutId,
                capabilityContract: selection.capabilityContract,
                implementation: { implementationId: 'test.local', driverId: 'test', driverDialect: 'test/local/v1' },
                supportedFeatures: [...selection.supportedFeatures],
                state: selection.state === 'selected' ? 'ready' as const : 'blocked' as const,
                reasons: [...selection.reasons],
              },
            } : null,
            reasons: [...selection.reasons],
          })),
        };
      },
      async overwrite(input) {
        const capabilities = [...input.capabilities];
        sharedAIConfig = {
          aiConfig: {
            ...sharedAIConfig.aiConfig,
            capabilities,
          },
          revision: String(BigInt(sharedAIConfig.revision) + 1n),
          capabilities: capabilities.map((intent) => intent.capabilityContract),
          intents: projectIntents(capabilities),
        };
        return { outcome: 'committed' as const, config: sharedAIConfig.aiConfig, revision: sharedAIConfig.revision };
      },
      async listOptions(input) {
        return {
          kind: 'local-loadouts' as const,
          options: input.capabilityContract === 'text.generate' ? [{
            loadoutRef: 'loadout:text', label: 'Local text model', capabilityContract: 'text.generate',
            implementation: { implementationId: 'local.text', driverId: 'test', driverDialect: 'test/local/v1' },
            supportedFeatures: [], state: 'ready' as const, reasons: [],
          }] : [],
          truncated: false,
        };
      },
    },
    cloudAIConfig,
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
