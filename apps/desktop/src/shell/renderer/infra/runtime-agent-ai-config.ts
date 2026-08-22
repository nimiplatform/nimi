import {
  createNimiSharedLocalAgentAISurface,
  type NimiRuntimeAgentScopeRunner,
  type NimiSharedLocalAgentAIConfigCallInput,
  type NimiSharedLocalAgentAIConfigOptionsInput,
  type NimiSharedLocalAgentAIConfigOverwriteInput,
  type NimiSharedLocalAgentAIConfigRuntime,
} from '@nimiplatform/sdk/runtime';
import type {
  NimiAIConfigOptionsResult,
  NimiAIConfigOverwriteResult,
  NimiAIConfigSnapshot,
} from '@nimiplatform/sdk/ai';

export type NimiRuntimeAgentAIConfigSnapshot = NimiAIConfigSnapshot;

export interface NimiRuntimeAgentAIConfigAdapter {
  get(input?: NimiSharedLocalAgentAIConfigCallInput): Promise<NimiRuntimeAgentAIConfigSnapshot>;
  update(input: NimiSharedLocalAgentAIConfigOverwriteInput): Promise<NimiAIConfigOverwriteResult>;
  listOptions(input: NimiSharedLocalAgentAIConfigOptionsInput): Promise<NimiAIConfigOptionsResult>;
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
    async listOptions(input: NimiSharedLocalAgentAIConfigOptionsInput) {
      return sharedAIConfig.listOptions(input);
    },
  });
}
