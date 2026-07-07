import type {
  NimiRuntimeAgentExecutionConfigModule,
  NimiRuntimeAgentInspectSurface,
  NimiRuntimeAgentMemoryObservatorySnapshot,
  RuntimeLocalAgentIdentityInput,
} from '@nimiplatform/kit/core/sdk-contract';
import type {
  AgentCenterRuntimeAdapter,
  AgentCenterRuntimeLoadInput,
  AgentCenterRuntimeSnapshot,
} from './types.js';

export interface CreateRuntimeAgentCenterAdapterInput {
  readonly executionConfig: NimiRuntimeAgentExecutionConfigModule;
  readonly inspect?: NimiRuntimeAgentInspectSurface | null;
  readonly identity?: RuntimeLocalAgentIdentityInput;
  readonly loadMemory?: (
    input: RuntimeLocalAgentIdentityInput,
  ) => Promise<NimiRuntimeAgentMemoryObservatorySnapshot | null>;
}

function resolveIdentity(
  base: RuntimeLocalAgentIdentityInput | undefined,
  input: AgentCenterRuntimeLoadInput | undefined,
): RuntimeLocalAgentIdentityInput | null {
  return input?.identity || base || null;
}

export function createRuntimeAgentCenterAdapter(
  input: CreateRuntimeAgentCenterAdapterInput,
): AgentCenterRuntimeAdapter {
  return {
    executionConfig: input.executionConfig,
    inspect: input.inspect || null,
    async loadSnapshot(loadInput = {}): Promise<AgentCenterRuntimeSnapshot> {
      const identity = resolveIdentity(input.identity, loadInput);
      const [executionConfig, readiness, inspect, memory] = await Promise.all([
        input.executionConfig.get({ subjectUserId: loadInput.subjectUserId }),
        input.executionConfig.readiness({ subjectUserId: loadInput.subjectUserId }),
        input.inspect && identity ? input.inspect.getPublicInspect(identity) : Promise.resolve(null),
        input.loadMemory && identity ? input.loadMemory(identity) : Promise.resolve(null),
      ]);
      return {
        executionConfig,
        readiness,
        inspect,
        memory,
      };
    },
    upsertExecutionConfig(upsertInput) {
      return input.executionConfig.upsert(upsertInput);
    },
    setAutonomyConfig(autonomyInput) {
      if (!input.inspect) {
        throw new Error('Runtime Agent inspect surface is required to mutate autonomy.');
      }
      return input.inspect.setAutonomyConfig(autonomyInput);
    },
  };
}
