import { createFirstPartyAgentCenterSession } from '../src/session.js';
import type { NimiAIConfigCloudConnectorOption, NimiAIConfigCloudTargetOption } from '@nimiplatform/kit/core/sdk-contract';
import type {
  AgentCenterAppearanceAdapter,
  AgentCenterAutonomyProjection,
  AgentCenterSharedAIConfigProjection,
  AgentCenterSession,
  AgentCenterStateInput,
} from '../src/types.js';

export const TEST_LOCAL_AGENT_PARTICIPATION = [
  { role: 'conversation.primary', capabilityContract: 'text.generate' },
  { role: 'memory.embedding', capabilityContract: 'text.embed' },
  { role: 'conversation.input.voice', capabilityContract: 'audio.transcribe' },
  { role: 'conversation.output.voice', capabilityContract: 'audio.synthesize' },
  { role: 'conversation.realtime', capabilityContract: 'realtime.interact' },
  { role: 'conversation.action.image', capabilityContract: 'image.generate' },
] as const;

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
    intents: [],
  };
}

export async function sessionFor(
  projection: AgentCenterStateInput = {},
  appearance?: AgentCenterAppearanceAdapter | null,
  cloudOptions?: {
    readonly connectors: readonly NimiAIConfigCloudConnectorOption[];
    readonly targets: readonly NimiAIConfigCloudTargetOption[];
  },
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
          effectiveSelections: projection.effectiveSelections ?? [],
          participation: projection.participation ?? TEST_LOCAL_AGENT_PARTICIPATION,
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
          intents: projectIntents(capabilities),
        };
        return {
          outcome: 'committed' as const,
          config: sharedAIConfig.aiConfig,
          revision: sharedAIConfig.revision,
          participation: projection.participation ?? TEST_LOCAL_AGENT_PARTICIPATION,
        };
      },
      async listOptions(input) {
        if (input.kind === 'preset-voices') {
          return { kind: input.kind, options: [], truncated: false };
        }
        if (input.kind === 'cloud-connectors') {
          return { kind: input.kind, options: cloudOptions?.connectors ?? [], truncated: false };
        }
        if (input.kind === 'cloud-targets') {
          return {
            kind: input.kind,
            options: (cloudOptions?.targets ?? []).filter((target) => target.connectorRef === input.connectorRef),
            truncated: false,
          };
        }
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
