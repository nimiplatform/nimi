import {
  createNimiSharedLocalAgentAISurface,
  type NimiRuntimeAgentScopeRunner,
  type NimiSharedLocalAgentAIConfigCallInput,
  type NimiSharedLocalAgentAIConfigClient,
  type NimiSharedLocalAgentAIConfigOverwriteInput,
  type NimiSharedLocalAgentAIConfigRuntime,
} from '@nimiplatform/sdk/runtime';

type SharedLocalAgentAIConfig = Awaited<ReturnType<NimiSharedLocalAgentAIConfigClient['get']>>;

export interface NimiRuntimeAgentAIConfigSnapshot {
  readonly aiConfig: SharedLocalAgentAIConfig;
}

export interface NimiRuntimeAgentAIConfigAdapter {
  get(input?: NimiSharedLocalAgentAIConfigCallInput): Promise<NimiRuntimeAgentAIConfigSnapshot>;
  update(input: NimiSharedLocalAgentAIConfigOverwriteInput): Promise<NimiRuntimeAgentAIConfigSnapshot>;
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
      return Object.freeze({ aiConfig: await sharedAIConfig.get(input) });
    },
    async update(input: NimiSharedLocalAgentAIConfigOverwriteInput) {
      return Object.freeze({ aiConfig: await sharedAIConfig.overwrite(input) });
    },
  });
}
