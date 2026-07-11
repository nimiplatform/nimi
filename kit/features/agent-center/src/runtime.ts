import type {
  NimiRuntimeAgentAIConfigModule,
  NimiRuntimeAgentInspectSurface,
  NimiRuntimeAgentMemoryObservatorySnapshot,
  NimiRuntimeAgentSourceContextStatus,
  NimiRuntimeAgentTurnContextSummary,
  RuntimeLocalAgentIdentityInput,
} from '@nimiplatform/kit/core/sdk-contract';
import type {
  AgentCenterRuntimeAutonomyConfigInput,
  AgentCenterRuntimeAIConfigUpsertInput,
  AgentCenterRuntimeAdapter,
  AgentCenterRuntimeLoadInput,
  AgentCenterRuntimeSnapshot,
  AgentCenterTurnContextLoadInput,
} from './types.js';

export interface CreateRuntimeAgentCenterAdapterInput {
  readonly agentAIConfig: NimiRuntimeAgentAIConfigModule;
  readonly inspect?: NimiRuntimeAgentInspectSurface | null;
  readonly identity?: RuntimeLocalAgentIdentityInput;
  readonly loadMemory?: (
    input: RuntimeLocalAgentIdentityInput,
  ) => Promise<NimiRuntimeAgentMemoryObservatorySnapshot | null>;
  readonly loadSourceContextStatus?: (
    input: RuntimeLocalAgentIdentityInput,
  ) => Promise<NimiRuntimeAgentSourceContextStatus | null>;
  readonly loadTurnContextSummary?: (
    input: AgentCenterTurnContextLoadInput,
  ) => Promise<NimiRuntimeAgentTurnContextSummary | null>;
}

function resolveAutonomyMutationIdentity(
  base: RuntimeLocalAgentIdentityInput | undefined,
  input: AgentCenterRuntimeAutonomyConfigInput,
): RuntimeLocalAgentIdentityInput {
  if (input.ownerUserId && input.runtimeSourceRef && input.localAgentRef) {
    return {
      ownerUserId: input.ownerUserId,
      runtimeSourceRef: input.runtimeSourceRef,
      localAgentRef: input.localAgentRef,
    };
  }
  if (!base) {
    throw new Error('Agent Center Runtime adapter requires Runtime Local Agent identity.');
  }
  return base;
}

function resolveIdentity(
  base: RuntimeLocalAgentIdentityInput | undefined,
  input: AgentCenterRuntimeLoadInput | undefined,
): RuntimeLocalAgentIdentityInput | null {
  return input?.identity || base || null;
}

function requireIdentity(
  base: RuntimeLocalAgentIdentityInput | undefined,
  input: AgentCenterRuntimeLoadInput | undefined,
): RuntimeLocalAgentIdentityInput {
  const identity = resolveIdentity(base, input);
  if (!identity) {
    throw new Error('Agent Center Runtime adapter requires Runtime Local Agent identity.');
  }
  return identity;
}

function resolveMutationIdentity(
  base: RuntimeLocalAgentIdentityInput | undefined,
  input: AgentCenterRuntimeAIConfigUpsertInput,
): RuntimeLocalAgentIdentityInput {
  if (input.ownerUserId && input.runtimeSourceRef && input.localAgentRef) {
    return {
      ownerUserId: input.ownerUserId,
      runtimeSourceRef: input.runtimeSourceRef,
      localAgentRef: input.localAgentRef,
    };
  }
  if (!base) {
    throw new Error('Agent Center Runtime adapter requires Runtime Local Agent identity.');
  }
  return base;
}

export function createRuntimeAgentCenterAdapter(
  input: CreateRuntimeAgentCenterAdapterInput,
): AgentCenterRuntimeAdapter {
  return {
    agentAIConfig: input.agentAIConfig,
    inspect: input.inspect || null,
    async loadSnapshot(loadInput = {}): Promise<AgentCenterRuntimeSnapshot> {
      const identity = requireIdentity(input.identity, loadInput);
      const callInput = { ...identity, subjectUserId: loadInput.subjectUserId };
      const [
        agentAIConfig,
        readiness,
        inspect,
        memory,
        sourceContextStatus,
        turnContextSummary,
      ] = await Promise.all([
        input.agentAIConfig.get(callInput),
        input.agentAIConfig.readiness(callInput),
        input.inspect ? input.inspect.getPublicInspect(identity) : Promise.resolve(null),
        input.loadMemory && identity ? input.loadMemory(identity) : Promise.resolve(null),
        input.loadSourceContextStatus
          ? input.loadSourceContextStatus(identity)
          : Promise.resolve(null),
        input.loadTurnContextSummary
          ? input.loadTurnContextSummary({
              ...identity,
              ...(loadInput.conversationAnchorId
                ? { conversationAnchorId: loadInput.conversationAnchorId }
                : {}),
            })
          : Promise.resolve(null),
      ]);
      return {
        agentAIConfig,
        readiness,
        inspect,
        memory,
        sourceContextStatus,
        turnContextSummary,
      };
    },
    upsertAgentAIConfig(upsertInput) {
      const identity = resolveMutationIdentity(input.identity, upsertInput);
      return input.agentAIConfig.upsert({
        ...identity,
        subjectUserId: upsertInput.subjectUserId,
        expectedRevision: upsertInput.expectedRevision,
        intents: upsertInput.intents,
      });
    },
    async setAutonomyConfig(autonomyInput) {
      if (!input.inspect) {
        throw new Error('Runtime Agent inspect surface is required to mutate autonomy.');
      }
      const inspect = input.inspect;
      const identity = resolveAutonomyMutationIdentity(input.identity, autonomyInput);
      const mode = autonomyInput.enabled === false ? 'off' : autonomyInput.mode;
      const snapshot = await inspect.setAutonomyConfig({
        ...identity,
        mode,
        dailyTokenBudget: autonomyInput.dailyTokenBudget,
        maxTokensPerHook: autonomyInput.maxTokensPerHook,
      });
      if (autonomyInput.enabled !== true || mode === 'off') {
        return snapshot;
      }
      if (snapshot.enabled === true) {
        return snapshot;
      }
      return inspect.enableAutonomy(identity);
    },
  };
}
