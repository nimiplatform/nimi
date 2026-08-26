import {
  createNimiSharedLocalAgentAISurface,
  type NimiRuntimeAgentScopeRunner,
  type NimiSharedLocalAgentAIConfigCallInput,
  type NimiSharedLocalAgentAIConfigOptionsInput,
  type NimiSharedLocalAgentAIConfigOverwriteInput,
  type NimiSharedLocalAgentAIConfigRuntime,
  type RuntimeTypedCallOptions,
} from '@nimiplatform/sdk/runtime';
import type {
  NimiSharedLocalAgentAIConfigOptionsResult,
  NimiSharedLocalAgentAIConfigOverwriteResult,
  NimiSharedLocalAgentAIConfigSnapshot,
} from '@nimiplatform/sdk/ai';

export type NimiRuntimeAgentAIConfigSnapshot = NimiSharedLocalAgentAIConfigSnapshot;

export interface NimiRuntimeAgentAIConfigAdapter {
  get(input?: NimiSharedLocalAgentAIConfigCallInput): Promise<NimiRuntimeAgentAIConfigSnapshot>;
  update(input: NimiSharedLocalAgentAIConfigOverwriteInput): Promise<NimiSharedLocalAgentAIConfigOverwriteResult>;
  listOptions(input: NimiSharedLocalAgentAIConfigOptionsInput, options?: RuntimeTypedCallOptions): Promise<NimiSharedLocalAgentAIConfigOptionsResult>;
}

type RuntimeAgentAIConfigDeps = {
  runtime: NimiSharedLocalAgentAIConfigRuntime;
  getSubjectUserId?: () => string | undefined | Promise<string | undefined>;
  withScopes?: NimiRuntimeAgentScopeRunner;
};

export function createRuntimeAgentAIConfigAdapter(
  deps: RuntimeAgentAIConfigDeps,
): NimiRuntimeAgentAIConfigAdapter {
  const { sharedAIConfig } = createNimiSharedLocalAgentAISurface({
    runtime: deps.runtime,
    getSubjectUserId: deps.getSubjectUserId ?? (() => undefined),
    ...(deps.withScopes ? { withScopes: deps.withScopes } : {}),
  });

  return Object.freeze({
    async get(input: NimiSharedLocalAgentAIConfigCallInput = {}) {
      return sharedAIConfig.get(input);
    },
    async update(input: NimiSharedLocalAgentAIConfigOverwriteInput) {
      return sharedAIConfig.overwrite(input);
    },
    async listOptions(input: NimiSharedLocalAgentAIConfigOptionsInput, options?: RuntimeTypedCallOptions) {
      return sharedAIConfig.listOptions(input, options);
    },
  });
}
