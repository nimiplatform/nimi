import {
  createNimiRuntimeAgentAIConfigModule,
  type NimiRuntimeAgentAIConfigModule,
  type NimiRuntimeAgentAIConfigReadinessSnapshotProjection,
  type NimiRuntimeAgentAIConfigRuntime,
  type NimiRuntimeAgentScopeRunner,
} from '@nimiplatform/sdk/runtime';

export type {
  NimiRuntimeAgentAIConfigBinding,
  NimiRuntimeAgentAIConfigReadinessSnapshotProjection,
  NimiRuntimeAgentAIConfigSnapshot,
} from '@nimiplatform/sdk/runtime';

type RuntimeAgentAIConfigDeps = {
  runtime: NimiRuntimeAgentAIConfigRuntime;
  getSubjectUserId?: () => string | undefined | Promise<string | undefined>;
  withScopes?: NimiRuntimeAgentScopeRunner;
};

export function createRuntimeAgentAIConfigAdapter(
  deps: RuntimeAgentAIConfigDeps,
): NimiRuntimeAgentAIConfigModule {
  return createNimiRuntimeAgentAIConfigModule({
    runtime: deps.runtime,
    getSubjectUserId: deps.getSubjectUserId ?? (() => undefined),
    ...(deps.withScopes ? { withScopes: deps.withScopes } : {}),
  });
}

export function isRuntimeAgentTextReadinessReady(
  readiness: NimiRuntimeAgentAIConfigReadinessSnapshotProjection | null | undefined,
): boolean {
  return readiness?.capabilities.some((entry) => (
    entry.capability === 'text.generate' && entry.state === 'ready'
  )) === true;
}

export function describeRuntimeAgentTextReadiness(
  readiness: NimiRuntimeAgentAIConfigReadinessSnapshotProjection | null | undefined,
  fallback = 'Runtime Agent text execution is unavailable.',
): string {
  const text = readiness?.capabilities.find((entry) => entry.capability === 'text.generate') || null;
  if (!text) {
    return fallback;
  }
  if (text.state === 'ready') {
    return 'Runtime Agent text turns ready.';
  }
  if (text.reasonCode) {
    return `Runtime Agent text execution is ${text.state}: ${text.reasonCode}.`;
  }
  return `Runtime Agent text execution is ${text.state}.`;
}
