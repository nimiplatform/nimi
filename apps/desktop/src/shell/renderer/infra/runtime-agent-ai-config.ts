import {
  createNimiRuntimeAgentAIConfigModule,
  type NimiRuntimeAgentAIConfigModule,
  type NimiRuntimeAgentAIConfigReadinessSnapshotProjection,
} from '@nimiplatform/sdk/runtime';
import {
  getDesktopAccountRuntime,
  getDesktopAppId,
  getDesktopRuntime,
  withDesktopRuntimeProtectedScopes,
} from './sdk/desktop-nimi-client-session';

export type {
  NimiRuntimeAgentAIConfigBinding,
  NimiRuntimeAgentAIConfigReadinessSnapshotProjection,
  NimiRuntimeAgentAIConfigSnapshot,
} from '@nimiplatform/sdk/runtime';

type RuntimeAgentAIConfigDeps = {
  getSubjectUserId?: () => string | undefined | Promise<string | undefined>;
};

function getDesktopRuntimeAgentAIConfigClient() {
  const accountRuntime = getDesktopAccountRuntime();
  return {
    appId: getDesktopAppId(),
    auth: accountRuntime.auth,
    appAuth: accountRuntime.grants,
    agent: getDesktopRuntime().agents,
  };
}

export function createRuntimeAgentAIConfigAdapter(
  deps: RuntimeAgentAIConfigDeps = {},
): NimiRuntimeAgentAIConfigModule {
  return createNimiRuntimeAgentAIConfigModule({
    runtime: getDesktopRuntimeAgentAIConfigClient(),
    getSubjectUserId: deps.getSubjectUserId ?? (() => undefined),
    withScopes: withDesktopRuntimeProtectedScopes,
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
